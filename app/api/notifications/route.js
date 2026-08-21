import { authenticateServerRequest } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data, init = {}) {
  return Response.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init.headers || {}) } });
}

export async function GET(request) {
  try {
    const auth = await authenticateServerRequest(request);
    if (!auth.ok) return json({ ok: false, error: auth.error }, { status: auth.status });
    const reminderCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: reminderCandidates } = await auth.adminClient
      .from("audit_results")
      .select("id,conversation_id,created_at")
      .eq("employee_email", auth.email)
      .ilike("review_sentiment", "Missed Opportunity")
      .lte("created_at", reminderCutoff)
      .order("created_at", { ascending: false })
      .limit(100);
    const candidateIds = (Array.isArray(reminderCandidates) ? reminderCandidates : []).map((row) => String(row.id));
    let openedIds = new Set();
    if (candidateIds.length) {
      const { data: openedRows } = await auth.adminClient
        .from("result_engagement_state")
        .select("result_id")
        .eq("actor_email", auth.email)
        .in("result_id", candidateIds)
        .not("conversation_opened_at", "is", null);
      openedIds = new Set((Array.isArray(openedRows) ? openedRows : []).map((row) => String(row.result_id)));
      const reminders = reminderCandidates.filter((row) => !openedIds.has(String(row.id))).map((row) => ({
        recipient_email: auth.email,
        notification_type: "unopened_miss_reminder",
        title: "Missed approach waiting for review",
        message: "A missed approach has remained unopened for more than 24 hours.",
        severity: "warning",
        result_id: String(row.id),
        conversation_id: row.conversation_id ? String(row.conversation_id) : null,
        href: "/results",
        dedupe_key: `miss-reminder:${row.id}:${auth.email}`,
      }));
      if (reminders.length) await auth.adminClient.from("user_notifications").upsert(reminders, { onConflict: "dedupe_key", ignoreDuplicates: true });
    }
    const { data, error } = await auth.adminClient
      .from("user_notifications")
      .select("id,notification_type,title,message,severity,result_id,conversation_id,dispute_id,href,read_at,created_at,metadata")
      .eq("recipient_email", auth.email)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("created_at", { ascending: false })
      .limit(80);
    if (error) throw new Error(error.message || "Could not load notifications.");
    const notifications = Array.isArray(data) ? data : [];
    return json({ ok: true, notifications, unread_count: notifications.filter((item) => !item.read_at).length });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Could not load notifications." }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const auth = await authenticateServerRequest(request);
    if (!auth.ok) return json({ ok: false, error: auth.error }, { status: auth.status });
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean).slice(0, 100) : [];
    let query = auth.adminClient.from("user_notifications").update({ read_at: new Date().toISOString() }).eq("recipient_email", auth.email).is("read_at", null);
    if (!body.mark_all) {
      if (!ids.length) return json({ ok: false, error: "Choose a notification to mark as read." }, { status: 400 });
      query = query.in("id", ids);
    }
    const { error } = await query;
    if (error) throw new Error(error.message || "Could not update notifications.");
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Could not update notifications." }, { status: 500 });
  }
}
