import { randomUUID } from "crypto";
import { POST as fetchPage } from "../fetch-page/route";
import { POST as auditBatch } from "../run/route";
import { automaticAdminClient, isAutomaticWorker, requireAutomaticAuditOwner } from "../../../../lib/automaticAuditAuth";
import { AUTO_BATCH_SIZE, AUTO_MAX_ATTEMPTS, previousDhakaDay, dayBounds, completeResult, explainAuditFailure } from "../../../../lib/automaticAuditUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const TERMINAL = ["completed", "completed_with_errors", "failed"];
const resultFields = "id,conversation_id,replied_at,created_at,ai_verdict,review_sentiment,client_sentiment,resolution_status,error,automatic_audit_run_id";

function json(body, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
function checked(result) { if (result.error) throw new Error(result.error.message); return result.data; }
function internalRequest(request, path, body) {
  return new Request(new URL(path, request.url), { method: "POST", headers: { "Content-Type": "application/json", Authorization: request.headers.get("authorization"), "x-automatic-audit": "1" }, body: JSON.stringify(body) });
}

async function completeById(client, ids, day) {
  if (!ids.length) return new Map();
  const data = checked(await client.from("audit_results").select(resultFields).in("conversation_id", ids).order("created_at", { ascending: false }).limit(1000));
  const found = new Map();
  for (const row of data || []) if (completeResult(row, day) && !found.has(String(row.conversation_id))) found.set(String(row.conversation_id), row);
  return found;
}

async function commit(client, run, fields) {
  const data = checked(await client.rpc("commit_automatic_audit_step", { p_run_id: run.id, p_token: run.lease_token, ...fields }));
  return Array.isArray(data) ? data[0] : data;
}

async function workerStep(request, body) {
  const client = automaticAdminClient();
  let runId = body.runId || null;
  if (!runId) {
    const day = body.auditDate || previousDhakaDay();
    const bounds = dayBounds(day);
    if (bounds.scheduledFor > new Date() && body.mode !== "recover") return json({ ok: false, error: "This day's 9 AM GMT+6 schedule has not arrived yet." }, 400);
    if (bounds.scheduledFor <= new Date()) {
      const dates = [day];
      if (body.triggerSource !== "manual") {
        const last = checked(await client.from("automatic_audit_runs").select("audit_date").eq("trigger_source", "scheduled").order("audit_date", { ascending: false }).limit(1));
        if (last?.[0]?.audit_date && last[0].audit_date < day) {
          let cursor = new Date(last[0].audit_date + "T00:00:00Z");
          cursor = new Date(cursor.getTime() + 86400000);
          while (cursor.toISOString().slice(0, 10) < day) { dates.push(cursor.toISOString().slice(0, 10)); cursor = new Date(cursor.getTime() + 86400000); }
        }
      }
      checked(await client.from("automatic_audit_runs").upsert(dates.map((audit_date) => ({ id: randomUUID(), audit_date, scheduled_for: dayBounds(audit_date).scheduledFor.toISOString(), trigger_source: body.triggerSource === "manual" ? "manual" : "scheduled" })), { onConflict: "audit_date", ignoreDuplicates: true }));
      const existing = checked(await client.from("automatic_audit_runs").select("*").eq("audit_date", day).single());
      if (body.retryFailed && ["failed", "completed_with_errors", "paused"].includes(existing.status)) checked(await client.rpc("retry_automatic_audit", { p_run_id: existing.id }));
      if (body.mode !== "recover") runId = existing.id;
    }
  }
  const claimed = checked(await client.rpc("claim_automatic_audit", { p_run_id: runId }));
  const run = claimed?.[0];
  if (!run) {
    const existing = runId ? checked(await client.from("automatic_audit_runs").select("*").eq("id", runId).maybeSingle()) : null;
    return json({ ok: true, done: !existing || TERMINAL.includes(existing.status), busy: Boolean(existing && !TERMINAL.includes(existing.status)), run: existing });
  }
  try {
    let saved;
    if (!run.fetch_complete) {
      const response = await fetchPage(internalRequest(request, "/api/audits/fetch-page", { startDate: run.audit_date, endDate: run.audit_date, conversationRatings: [3,4,5], limiterEnabled: false, alreadyFetchedCount: run.conversation_count, fetchState: run.fetch_state }));
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "The conversation fetch failed.");
      const ids = new Set();
      const items = (data.conversations || []).filter((item) => {
        const id = String(item.conversationId || item.id || "");
        if (!id || ids.has(id)) return false;
        ids.add(id); return true;
      }).map((item) => ({ conversation_id: String(item.conversationId || item.id), payload: { conversationId: String(item.conversationId || item.id), repliedAt: item.repliedAt, csatScore: item.csatScore ?? item.conversationRating, agentName: item.agentName, clientEmail: item.clientEmail } }));
      saved = await commit(client, run, { p_items: items, p_state: data.fetchState, p_fetch_complete: Boolean(data.done), p_event: { kind: "fetch", message: data.done ? "The full previous-day fetch is complete. The saved queue is ready for auditing." : "Fetched and checkpointed the next Intercom pages.", detail: { received: items.length, pages: data.meta?.processedPagesThisCall, totalPages: data.meta?.processedPagesTotal, nextCursorSaved: !data.done } } });
    } else {
      const items = checked(await client.from("automatic_audit_items").select("*").eq("run_id", run.id).eq("status", "pending").order("attempts").order("id").limit(AUTO_BATCH_SIZE)) || [];
      const ids = items.map((item) => item.conversation_id);
      const existing = await completeById(client, ids, run.audit_date);
      const toAudit = items.filter((item) => !existing.has(item.conversation_id) && item.attempts < AUTO_MAX_ATTEMPTS);
      let data = { ok: true, results: [] };
      let batchError = null;
      if (toAudit.length) {
        checked(await client.rpc("begin_automatic_audit_attempt", { p_run_id: run.id, p_token: run.lease_token, p_ids: toAudit.map((item) => item.conversation_id) }));
        const response = await auditBatch(internalRequest(request, "/api/audits/run", { conversations: toAudit.map((item) => item.payload), startDate: run.audit_date, endDate: run.audit_date, limiterEnabled: false, duplicateMode: "skip_existing", automaticRunId: run.id, batchMode: true, batchSize: AUTO_BATCH_SIZE, batchIndex: run.batch_count + 1, totalBatches: Math.ceil(run.conversation_count / AUTO_BATCH_SIZE), totalCount: run.conversation_count, batchLabel: `Automatic daily audit • ${run.audit_date}` }));
        data = await response.json();
        if (!response.ok || !data.ok) batchError = explainAuditFailure(data.error || "The audit batch did not return a successful response.");
      }
      // Read back saved rows. This also recovers a batch saved immediately before
      // a previous request timed out, without charging for another model call.
      const completed = await completeById(client, ids, run.audit_date);
      const updates = items.map((item) => {
        const result = completed.get(item.conversation_id);
        if (result) return { conversation_id: item.conversation_id, status: result.automatic_audit_run_id === run.id ? "success" : "skipped", attempts: item.attempts + (toAudit.some((candidate) => candidate.id === item.id) ? 1 : 0), result_id: result.id, last_error: null };
        const attempts = item.attempts + (toAudit.some((candidate) => candidate.id === item.id) ? 1 : 0);
        const itemResult = (data.results || []).find((result) => String(result.conversationId) === item.conversation_id);
        return { conversation_id: item.conversation_id, status: attempts >= AUTO_MAX_ATTEMPTS ? "failed" : "pending", attempts, last_error: batchError || explainAuditFailure(itemResult?.error || (attempts >= AUTO_MAX_ATTEMPTS ? "No complete saved result was found after three recorded attempts. A request may have timed out before saving. Review the conversation before retrying this day." : "The batch finished without a complete saved result for this conversation. It will be retried.")), result_id: null };
      });
      const successful = updates.filter((item) => item.status === "success").length;
      const skipped = updates.filter((item) => item.status === "skipped").length;
      const failures = updates.filter((item) => item.last_error);
      saved = await commit(client, run, { p_items: updates, p_error: batchError, p_event: { kind: "batch", message: `${successful} complete result(s) saved or recovered; ${skipped} existing complete result(s) skipped; ${failures.length} conversation(s) need attention.`, detail: { batch: run.batch_count + 1, successful, duplicateSkips: skipped, failures: failures.map((item) => ({ conversationId: item.conversation_id, attempt: item.attempts, ...item.last_error })) } } });
    }
    return json({ ok: true, done: TERMINAL.includes(saved.status), run: saved, retryAfter: saved.step_failures ? 20 * saved.step_failures : 1 });
  } catch (error) {
    const failure = explainAuditFailure(error);
    const saved = await commit(client, run, { p_error: failure, p_event: { kind: "error", message: failure.title, detail: failure } });
    return json({ ok: true, done: TERMINAL.includes(saved.status), run: saved, retryAfter: 20 * saved.step_failures });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (isAutomaticWorker(request)) return await workerStep(request, body);
    const client = await requireAutomaticAuditOwner(request);
    if (body.action !== "retry" || !body.runId) return json({ ok: false, error: "Choose a failed day to retry." }, 400);
    checked(await client.rpc("retry_automatic_audit", { p_run_id: body.runId }));
    return json({ ok: true, message: "Retry queued. The recovery schedule will pick it up; you can close this page." });
  } catch (error) { return json({ ok: false, error: error.message, guidance: explainAuditFailure(error) }, error.status || 500); }
}

export async function GET(request) {
  try {
    const client = await requireAutomaticAuditOwner(request);
    const params = new URL(request.url).searchParams;
    const runId = params.get("runId");
    if (runId) {
      const page = Math.max(0, Number(params.get("page")) || 0);
      const eventPage = Math.max(0, Number(params.get("eventPage")) || 0);
      const [run, events, failures] = await Promise.all([
        client.from("automatic_audit_runs").select("*").eq("id", runId).single(),
        client.from("automatic_audit_events").select("*", { count: "exact" }).eq("run_id", runId).order("id", { ascending: false }).range(eventPage * 50, eventPage * 50 + 49),
        client.from("automatic_audit_items").select("conversation_id,status,attempts,last_error,updated_at", { count: "exact" }).eq("run_id", runId).not("last_error", "is", null).order("id").range(page * 50, page * 50 + 49),
      ]);
      return json({ ok: true, run: checked(run), events: checked(events), eventCount: events.count, eventPage, failures: checked(failures), failureCount: failures.count, page });
    }
    const page = Math.max(0, Number(params.get("page")) || 0);
    let query = client.from("automatic_audit_runs").select("*", { count: "exact" }).order("audit_date", { ascending: false }).range(page * 20, page * 20 + 19);
    if (params.get("from")) query = query.gte("audit_date", params.get("from"));
    if (params.get("to")) query = query.lte("audit_date", params.get("to"));
    const result = await query;
    const schedulerResult = await client.rpc("automatic_audit_scheduler_health");
    const scheduler = schedulerResult.error
      ? { installed: false, error: "Supabase scheduler health is unavailable. Install the scheduler SQL, or check its database permissions." }
      : schedulerResult.data;
    const secret = String(process.env.AUTOMATIC_AUDIT_SECRET || "");
    const configured = secret.length >= 32;
    const configurationIssue = !secret
      ? "AUTOMATIC_AUDIT_SECRET is missing from the deployment serving this site. Add it to this Vercel project's Production environment and redeploy the Production deployment."
      : !configured
        ? "AUTOMATIC_AUDIT_SECRET is present, but shorter than the required 32 characters. Replace it with a random value of at least 32 characters in both Vercel and GitHub, then redeploy Production."
        : "";
    return json({ ok: true, runs: checked(result), total: result.count, page, configured, configurationIssue, scheduler });
  } catch (error) { return json({ ok: false, error: error.message, guidance: explainAuditFailure(error) }, error.status || 500); }
}
