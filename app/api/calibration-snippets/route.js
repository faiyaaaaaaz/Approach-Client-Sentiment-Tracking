import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MASTER_ADMIN_EMAIL = "faiyaz@nextventures.io";
const REVIEW_STATUS_OPTIONS = new Set([
  "Likely Negative Review",
  "Likely Positive Review",
  "Highly Likely Negative Review",
  "Highly Likely Positive Review",
  "Missed Opportunity",
  "Negative Outcome - No Review Request",
]);

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      ...(init.headers || {}),
    },
  });
}

function getEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function getSupabaseClients() {
  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new Error("Missing Supabase environment variables.");
  }

  return {
    authClient: createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    adminClient: createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}

async function getAuthenticatedMasterAdmin(request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (!token) return { ok: false, response: json({ ok: false, error: "Missing access token." }, { status: 401 }) };

  const { authClient, adminClient } = getSupabaseClients();
  const { data: { user }, error } = await authClient.auth.getUser(token);
  if (error || !user) return { ok: false, response: json({ ok: false, error: "Invalid or expired session." }, { status: 401 }) };

  const email = normalizeEmail(user.email);
  if (!email.endsWith("@nextventures.io")) return { ok: false, response: json({ ok: false, error: "Only nextventures.io accounts are allowed." }, { status: 403 }) };

  if (email === MASTER_ADMIN_EMAIL) return { ok: true, user, email, profile: { full_name: "Faiyaz Muhtasim Ahmed", role: "master_admin" }, adminClient };

  const { data: profile } = await adminClient
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .or(`id.eq.${user.id},email.ilike.${email}`)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const role = normalizeText(profile?.role);
  if (profile?.is_active === true && role === "master_admin") return { ok: true, user, email, profile, adminClient };

  const { data: grant } = await adminClient
    .from("user_role_grants")
    .select("email, full_name, role, is_active")
    .ilike("email", email)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (normalizeText(grant?.role) === "master_admin") return { ok: true, user, email, profile: grant, adminClient };

  return { ok: false, response: json({ ok: false, error: "Only Master Admins can manage calibration snippets." }, { status: 403 }) };
}

function cleanSnippet(input) {
  const snippet = input && typeof input === "object" ? input : {};
  const wrong = normalizeText(snippet.wrong_verdict);
  const correct = normalizeText(snippet.correct_verdict);

  if (wrong && !REVIEW_STATUS_OPTIONS.has(wrong)) throw new Error("Wrong verdict must be a valid Review Status.");
  if (correct && !REVIEW_STATUS_OPTIONS.has(correct)) throw new Error("Correct verdict must be a valid Review Status.");

  return {
    title: normalizeText(snippet.title),
    applies_to: "review_status",
    wrong_verdict: wrong || null,
    correct_verdict: correct || null,
    rule_text: normalizeText(snippet.rule_text),
    applies_when: normalizeText(snippet.applies_when) || null,
    does_not_apply_when: normalizeText(snippet.does_not_apply_when) || null,
    example_context: normalizeText(snippet.example_context) || null,
    source_dispute_id: normalizeText(snippet.source_dispute_id) || null,
    is_active: snippet.is_active === true,
  };
}

export async function GET(request) {
  try {
    const auth = await getAuthenticatedMasterAdmin(request);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const includeDisputes = url.searchParams.get("include_disputes") === "approved";

    const { data: snippets, error } = await auth.adminClient
      .from("ai_calibration_snippets")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) throw new Error(error.message || "Could not load calibration snippets.");

    let approvedDisputes = [];
    if (includeDisputes) {
      const { data, error: disputesError } = await auth.adminClient
        .from("verdict_disputes")
        .select("id, result_id, conversation_id, agent_name, employee_name, employee_email, team_name, current_review_status, corrected_review_status, reason, master_admin_decision_note, reviewed_at, created_at")
        .eq("status", "approved")
        .order("reviewed_at", { ascending: false })
        .limit(100);
      if (disputesError) throw new Error(disputesError.message || "Could not load approved disputes.");
      approvedDisputes = Array.isArray(data) ? data : [];
    }

    return json({ ok: true, snippets: Array.isArray(snippets) ? snippets : [], approvedDisputes });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Could not load calibration snippets." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const auth = await getAuthenticatedMasterAdmin(request);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const action = normalizeText(body.action || "create");
    const id = normalizeText(body.id || body?.snippet?.id);

    if (action === "delete") {
      if (!id) return json({ ok: false, error: "Missing snippet id." }, { status: 400 });
      const { error } = await auth.adminClient.from("ai_calibration_snippets").delete().eq("id", id);
      if (error) throw new Error(error.message || "Could not delete snippet.");
      return json({ ok: true, deletedId: id });
    }

    if (action === "toggle_active") {
      if (!id) return json({ ok: false, error: "Missing snippet id." }, { status: 400 });
      const { data, error } = await auth.adminClient
        .from("ai_calibration_snippets")
        .update({ is_active: body.is_active === true, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message || "Could not update snippet.");
      return json({ ok: true, snippet: data });
    }

    const cleaned = cleanSnippet(body.snippet || body);
    if (!cleaned.title) return json({ ok: false, error: "Snippet title is required." }, { status: 400 });
    if (!cleaned.rule_text) return json({ ok: false, error: "Snippet rule is required." }, { status: 400 });

    if (action === "update" || id) {
      if (!id) return json({ ok: false, error: "Missing snippet id." }, { status: 400 });
      const { data, error } = await auth.adminClient
        .from("ai_calibration_snippets")
        .update({ ...cleaned, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message || "Could not save snippet.");
      return json({ ok: true, snippet: data });
    }

    const { data, error } = await auth.adminClient
      .from("ai_calibration_snippets")
      .insert({
        ...cleaned,
        created_by_user_id: auth.user.id,
        created_by_name: auth.profile?.full_name || auth.email,
        created_by_email: auth.email,
        generated_by_ai: false,
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message || "Could not create snippet.");
    return json({ ok: true, snippet: data });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Could not save calibration snippet." }, { status: 500 });
  }
}
