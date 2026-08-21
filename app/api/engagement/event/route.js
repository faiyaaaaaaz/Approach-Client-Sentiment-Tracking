import { authenticateServerRequest, normalizeServerEmail } from "../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EVENTS = new Set([
  "result_opened",
  "conversation_preview_loaded",
  "ai_verdict_expanded",
  "intercom_link_clicked",
  "result_acknowledged",
]);

function json(data, init = {}) {
  return Response.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init.headers || {}) } });
}

function text(value) {
  return String(value || "").trim();
}

export async function POST(request) {
  try {
    const auth = await authenticateServerRequest(request);
    if (!auth.ok) return json({ ok: false, error: auth.error }, { status: auth.status });

    const body = await request.json().catch(() => ({}));
    const eventType = text(body.event_type);
    const resultId = text(body.result_id);
    const conversationId = text(body.conversation_id);
    const sourcePage = text(body.source_page).slice(0, 100) || null;
    if (!ALLOWED_EVENTS.has(eventType)) return json({ ok: false, error: "Unsupported engagement event." }, { status: 400 });
    if (!resultId) return json({ ok: false, error: "A saved result ID is required." }, { status: 400 });

    const { data: result, error: resultError } = await auth.adminClient
      .from("audit_results")
      .select("id,conversation_id,employee_email,review_sentiment,created_at")
      .eq("id", resultId)
      .maybeSingle();
    if (resultError) throw new Error(resultError.message || "Could not verify the audit result.");
    if (!result?.id) return json({ ok: false, error: "Audit result not found." }, { status: 404 });

    const resultOwner = normalizeServerEmail(result.employee_email);
    if (!auth.canViewAllEngagement && resultOwner !== auth.email) {
      return json({ ok: false, error: "You cannot record engagement for this result." }, { status: 403 });
    }

    const isMissed = String(result.review_sentiment || "").trim().toLowerCase() === "missed opportunity";
    const now = new Date().toISOString();
    const resolvedConversationId = conversationId || text(result.conversation_id) || null;
    const dedupeKey = eventType === "conversation_preview_loaded"
      ? `${auth.email}:${resultId}:${eventType}:${now.slice(0, 13)}`
      : null;

    const { error: eventError } = await auth.adminClient.from("agent_engagement_events").insert({
      actor_user_id: auth.user.id,
      actor_email: auth.email,
      event_type: eventType,
      result_id: resultId,
      conversation_id: resolvedConversationId,
      session_id: text(body.session_id) || null,
      source_page: sourcePage,
      is_missed_approach: isMissed,
      occurred_at: now,
      metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
      dedupe_key: dedupeKey,
    });
    if (eventError && eventError.code !== "23505") throw new Error(eventError.message || "Could not record engagement.");

    const { data: existing } = await auth.adminClient
      .from("result_engagement_state")
      .select("id,first_opened_at,last_opened_at,open_count,conversation_opened_at,acknowledged_at")
      .eq("actor_email", auth.email)
      .eq("result_id", resultId)
      .maybeSingle();

    const openingEvent = ["result_opened", "conversation_preview_loaded"].includes(eventType);
    const statePayload = {
      actor_user_id: auth.user.id,
      actor_email: auth.email,
      result_id: resultId,
      conversation_id: resolvedConversationId,
      is_missed_approach: isMissed,
      first_opened_at: existing?.first_opened_at || (openingEvent ? now : null),
      last_opened_at: openingEvent ? now : existing?.last_opened_at || null,
      open_count: Math.max(0, Number(existing?.open_count || 0)) + (openingEvent ? 1 : 0),
      conversation_opened_at: eventType === "conversation_preview_loaded" ? now : existing?.conversation_opened_at || null,
      acknowledged_at: eventType === "result_acknowledged" ? now : existing?.acknowledged_at || null,
      source_page: sourcePage,
      updated_at: now,
    };

    const { error: stateError } = await auth.adminClient
      .from("result_engagement_state")
      .upsert(statePayload, { onConflict: "actor_email,result_id" });
    if (stateError) throw new Error(stateError.message || "Could not update result engagement.");

    return json({ ok: true, recorded_at: now });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Could not record engagement." }, { status: 500 });
  }
}
