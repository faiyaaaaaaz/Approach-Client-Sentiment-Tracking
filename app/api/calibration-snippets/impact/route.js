import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MASTER_ADMIN_EMAIL = "faiyaz@nextventures.io";
const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 1000;

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
    authClient: createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    adminClient: createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

async function getAuthenticatedMasterAdmin(request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!token) {
    return { ok: false, response: json({ ok: false, error: "Missing access token." }, { status: 401 }) };
  }

  const { authClient, adminClient } = getSupabaseClients();
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(token);

  if (error || !user) {
    return { ok: false, response: json({ ok: false, error: "Invalid or expired session." }, { status: 401 }) };
  }

  const email = normalizeEmail(user.email);

  if (!email.endsWith("@nextventures.io")) {
    return { ok: false, response: json({ ok: false, error: "Only nextventures.io accounts are allowed." }, { status: 403 }) };
  }

  if (email === MASTER_ADMIN_EMAIL) {
    return {
      ok: true,
      user,
      email,
      profile: { full_name: "Faiyaz Muhtasim Ahmed", role: "master_admin" },
      adminClient,
    };
  }

  const { data: profile } = await adminClient
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .or(`id.eq.${user.id},email.ilike.${email}`)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (profile?.is_active === true && normalizeText(profile?.role) === "master_admin") {
    return { ok: true, user, email, profile, adminClient };
  }

  const { data: grant } = await adminClient
    .from("user_role_grants")
    .select("email, full_name, role, is_active")
    .ilike("email", email)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (normalizeText(grant?.role) === "master_admin") {
    return { ok: true, user, email, profile: grant, adminClient };
  }

  return {
    ok: false,
    response: json({ ok: false, error: "Only Master Admins can view snippet impact tracking." }, { status: 403 }),
  };
}

function parseLimit(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function summarizeLogs(logs) {
  const rows = Array.isArray(logs) ? logs : [];
  const uniqueRuns = new Set();
  const uniqueConversations = new Set();
  const uniqueSnippets = new Set();
  let verdictChangedCount = 0;
  let possibleCorrectionCount = 0;
  let erroredCount = 0;
  let latestActivityAt = "";

  for (const row of rows) {
    if (row?.run_id) uniqueRuns.add(row.run_id);
    if (row?.conversation_id) uniqueConversations.add(row.conversation_id);
    if (row?.snippet_id) uniqueSnippets.add(row.snippet_id);
    if (row?.verdict_changed === true) verdictChangedCount += 1;
    if (row?.possible_snippet_correction === true) possibleCorrectionCount += 1;
    if (row?.result_error) erroredCount += 1;

    const createdAt = normalizeText(row?.created_at);
    if (createdAt && (!latestActivityAt || new Date(createdAt).getTime() > new Date(latestActivityAt).getTime())) {
      latestActivityAt = createdAt;
    }
  }

  return {
    totalRows: rows.length,
    uniqueRuns: uniqueRuns.size,
    uniqueConversations: uniqueConversations.size,
    uniqueSnippets: uniqueSnippets.size,
    verdictChangedCount,
    possibleCorrectionCount,
    erroredCount,
    latestActivityAt: latestActivityAt || null,
  };
}

export async function GET(request) {
  try {
    const auth = await getAuthenticatedMasterAdmin(request);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const snippetId = normalizeText(url.searchParams.get("snippet_id"));
    const conversationId = normalizeText(url.searchParams.get("conversation_id"));

    let query = auth.adminClient
      .from("snippet_impact_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (snippetId) query = query.eq("snippet_id", snippetId);
    if (conversationId) query = query.eq("conversation_id", conversationId);

    const { data, error } = await query;

    if (error) {
      if (error.code === "42P01") {
        return json({
          ok: true,
          tableReady: false,
          logs: [],
          summary: summarizeLogs([]),
          message: "Snippet impact tracking table has not been created yet.",
        });
      }

      throw new Error(error.message || "Could not load snippet impact tracking.");
    }

    const logs = Array.isArray(data) ? data : [];

    return json({
      ok: true,
      tableReady: true,
      logs,
      summary: summarizeLogs(logs),
      explanation:
        "Impact tracking confirms which active snippets were sent with each audited conversation and compares old vs new Review Status. A possible correction is flagged only when the previous status matched the snippet's wrong verdict and the rerun matched its corrected verdict.",
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not load snippet impact tracking.",
      },
      { status: 500 }
    );
  }
}
