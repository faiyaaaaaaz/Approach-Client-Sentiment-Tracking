import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MASTER_ADMIN_EMAIL = "faiyaz@nextventures.io";
const OPENAI_MODEL = "gpt-4.1-mini";

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

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return "";
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function getSupabaseClients() {
  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) throw new Error("Missing Supabase environment variables.");
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

  const { data: profile } = await adminClient.from("profiles").select("id, email, full_name, role, is_active").or(`id.eq.${user.id},email.ilike.${email}`).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (profile?.is_active === true && normalizeText(profile?.role) === "master_admin") return { ok: true, user, email, profile, adminClient };

  const { data: grant } = await adminClient.from("user_role_grants").select("email, full_name, role, is_active").ilike("email", email).eq("is_active", true).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (normalizeText(grant?.role) === "master_admin") return { ok: true, user, email, profile: grant, adminClient };

  return { ok: false, response: json({ ok: false, error: "Only Master Admins can generate calibration snippets." }, { status: 403 }) };
}

async function loadActiveApiKey({ adminClient, keyType, envName, displayName }) {
  const { data, error } = await adminClient
    .from("api_keys")
    .select("secret_value, masked_value, updated_at")
    .eq("key_type", keyType)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error && error.code !== "42P01") throw new Error(error.message || `Could not load active ${displayName} API key.`);
  const savedSecret = String(data?.[0]?.secret_value || "").trim();
  if (savedSecret) return savedSecret;
  const fallbackSecret = getEnv(envName);
  if (fallbackSecret) return fallbackSecret;
  throw new Error(`No active ${displayName} API key found. Save it in Admin -> API key vault first.`);
}

async function intercomGet(intercomApiKey, conversationId) {
  const params = new URLSearchParams({ display_as: "plaintext" });
  const response = await fetch(`https://api.intercom.io/conversations/${conversationId}?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Intercom-Version": "2.12",
      Authorization: `Bearer ${intercomApiKey}`,
    },
    cache: "no-store",
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) throw new Error(`Intercom conversation fetch failed: ${response.status} ${text.slice(0, 800)}`);
  return data;
}

function collectParts(conversation) {
  const lists = [
    conversation?.conversation_parts?.conversation_parts,
    conversation?.conversation_parts?.data,
    conversation?.conversation_parts,
    conversation?.parts?.data,
    conversation?.parts,
    conversation?.messages,
    conversation?.conversation_messages,
  ];
  for (const list of lists) if (Array.isArray(list)) return list;
  return [];
}

function getAuthorName(part) {
  return firstNonEmpty(part?.author?.name, part?.author?.email, part?.assigned_to?.name, part?.type, "Unknown");
}

function getPartText(part) {
  return firstNonEmpty(part?.body, part?.text, part?.message, part?.summary, part?.content, part?.title);
}

function buildTranscript(conversation) {
  const rows = [];
  const sourceText = getPartText(conversation?.source);
  if (sourceText) rows.push(`[Initial message] (${getAuthorName(conversation?.source)}): ${stripHtml(sourceText)}`);
  for (const part of collectParts(conversation)) {
    const text = stripHtml(getPartText(part));
    if (!text) continue;
    rows.push(`[${part?.created_at || part?.updated_at || "time unknown"}] (${getAuthorName(part)}): ${text}`);
  }
  return rows.join("\n\n").slice(0, 65000);
}

async function runOpenAI({ openAiApiKey, dispute, transcript, existingSnippets }) {
  const activeSnippetSummary = existingSnippets.length
    ? existingSnippets.map((item, index) => `${index + 1}. ${item.title}: ${item.rule_text}`).join("\n")
    : "No active snippets.";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiApiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: `You create concise calibration snippets for a FundedNext AI audit system. Return valid JSON only. The snippet must target Review Status only. It must be reusable, not too broad, not too narrow, and must not change Client Sentiment or Resolution Status. Do not duplicate existing snippets.`,
        },
        {
          role: "user",
          content: `Approved dispute details:\nConversation ID: ${dispute.conversation_id || dispute.result_id}\nOriginal AI Review Status: ${dispute.current_review_status}\nCorrected Review Status: ${dispute.corrected_review_status}\nDispute reason: ${dispute.reason || ""}\nMaster Admin decision note: ${dispute.master_admin_decision_note || ""}\n\nExisting active snippets:\n${activeSnippetSummary}\n\nFull conversation transcript:\n${transcript || "(No transcript available)"}\n\nReturn JSON with these exact keys: title, wrong_verdict, correct_verdict, rule_text, applies_when, does_not_apply_when, example_context.`,
        },
      ],
    }),
    cache: "no-store",
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "OpenAI snippet generation failed.");
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned an empty snippet response.");
  try { return JSON.parse(content); } catch { throw new Error("OpenAI returned invalid JSON for the snippet."); }
}

export async function POST(request) {
  try {
    const auth = await getAuthenticatedMasterAdmin(request);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const disputeId = normalizeText(body.dispute_id || body.disputeId);
    if (!disputeId) return json({ ok: false, error: "Missing dispute id." }, { status: 400 });

    const { data: dispute, error: disputeError } = await auth.adminClient
      .from("verdict_disputes")
      .select("*")
      .eq("id", disputeId)
      .maybeSingle();
    if (disputeError) throw new Error(disputeError.message || "Could not load dispute.");
    if (!dispute) return json({ ok: false, error: "Dispute not found." }, { status: 404 });
    if (dispute.status !== "approved") return json({ ok: false, error: "Only approved disputes can generate snippets." }, { status: 400 });
    if (!normalizeText(dispute.corrected_review_status)) return json({ ok: false, error: "Approved dispute does not have a corrected Review Status." }, { status: 400 });

    const conversationId = normalizeText(dispute.conversation_id || dispute.result_id);
    if (!conversationId) return json({ ok: false, error: "The approved dispute has no conversation ID." }, { status: 400 });

    const [{ data: existingSnippets }, intercomApiKey, openAiApiKey] = await Promise.all([
      auth.adminClient.from("ai_calibration_snippets").select("title, rule_text").eq("is_active", true).eq("applies_to", "review_status").limit(25),
      loadActiveApiKey({ adminClient: auth.adminClient, keyType: "intercom", envName: "INTERCOM_API_KEY", displayName: "Intercom" }),
      loadActiveApiKey({ adminClient: auth.adminClient, keyType: "openai", envName: "OPENAI_API_KEY", displayName: "OpenAI" }),
    ]);

    const conversation = await intercomGet(intercomApiKey, conversationId);
    const transcript = buildTranscript(conversation);
    const draft = await runOpenAI({ openAiApiKey, dispute, transcript, existingSnippets: Array.isArray(existingSnippets) ? existingSnippets : [] });

    const payload = {
      title: normalizeText(draft.title) || `Calibration from dispute ${conversationId}`,
      applies_to: "review_status",
      wrong_verdict: normalizeText(draft.wrong_verdict) || dispute.current_review_status || null,
      correct_verdict: normalizeText(draft.correct_verdict) || dispute.corrected_review_status || null,
      rule_text: normalizeText(draft.rule_text) || "Review this approved dispute before applying the original verdict pattern again.",
      applies_when: normalizeText(draft.applies_when) || null,
      does_not_apply_when: normalizeText(draft.does_not_apply_when) || null,
      example_context: normalizeText(draft.example_context) || null,
      source_dispute_id: dispute.id,
      source_conversation_id: conversationId,
      is_active: false,
      generated_by_ai: true,
      generation_status: "draft",
      created_by_user_id: auth.user.id,
      created_by_name: auth.profile?.full_name || auth.email,
      created_by_email: auth.email,
    };

    const { data: snippet, error: insertError } = await auth.adminClient
      .from("ai_calibration_snippets")
      .insert(payload)
      .select("*")
      .single();
    if (insertError) throw new Error(insertError.message || "Could not save generated snippet.");

    return json({ ok: true, snippet });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Could not generate calibration snippet." }, { status: 500 });
  }
}
