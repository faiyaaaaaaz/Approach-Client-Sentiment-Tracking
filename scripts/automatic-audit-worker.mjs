// Runs on GitHub's runner, not in the user's browser. All queue state is in Supabase.
const baseUrl = String(process.env.AUDIT_SITE_URL || "").replace(/\/$/, "");
const secret = process.env.AUTOMATIC_AUDIT_SECRET || "";
if (!/^https:\/\//.test(baseUrl) || secret.length < 32) throw new Error("Set AUDIT_SITE_URL to the production HTTPS site and AUTOMATIC_AUDIT_SECRET to a shared random secret of at least 32 characters in GitHub Actions secrets.");
const dispatched = process.env.GITHUB_EVENT_NAME === "workflow_dispatch";
const mode = dispatched ? process.env.AUDIT_MODE || "daily" : process.env.AUDIT_SCHEDULE === "0 3 * * *" ? "daily" : "recover";
let runId = null;
let networkFailures = 0;
const deadline = Date.now() + 335 * 60000;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

while (Date.now() < deadline) {
  let payload;
  try {
    const response = await fetch(`${baseUrl}/api/audits/automatic`, {
      method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", "x-automatic-audit": "1" },
      body: JSON.stringify({ mode, runId, triggerSource: dispatched ? "manual" : "scheduled", ...(dispatched && process.env.AUDIT_DATE ? { auditDate: process.env.AUDIT_DATE } : {}), retryFailed: !runId && dispatched && process.env.AUDIT_RETRY === "true" }),
      signal: AbortSignal.timeout(90000), redirect: "error",
    });
    payload = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 403) throw new Error("Scheduler authentication was rejected. Check the matching AUTOMATIC_AUDIT_SECRET in GitHub and Vercel, and deployment access protection.");
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || `The production site returned HTTP ${response.status}. Check deployment and database setup.`);
    networkFailures = 0;
  } catch (error) {
    networkFailures += 1;
    console.error(`Request attempt ${networkFailures} failed: ${error.message}`);
    if (networkFailures >= 5) throw new Error("The production endpoint could not be reached after five attempts. Its durable checkpoint will be picked up by the next recovery run. See the request errors above.");
    await pause(Math.min(150000, networkFailures * 30000));
    continue;
  }
  if (payload.run?.id) runId = payload.run.id;
  if (payload.run) console.log(`${payload.run.audit_date}: ${payload.run.status}; fetched ${payload.run.conversation_count}, saved ${payload.run.success_count}, duplicates ${payload.run.duplicate_count}, failed ${payload.run.failed_count}, pending ${payload.run.pending_count}`);
  if (payload.done) {
    if (["failed", "completed_with_errors"].includes(payload.run?.status)) throw new Error("The daily run needs attention. Expand this day in Admin → Automatic Audit Run for the failure report and retry controls.");
    if (mode === "recover" && runId) { runId = null; continue; }
    console.log("Worker finished. All progress is saved in the database.");
    process.exit(0);
  }
  await pause((payload.busy ? 20 : Math.max(1, payload.retryAfter || 1)) * 1000);
}
console.log("Worker time window ended. Remaining conversations and fetch cursor are retained for the next hourly recovery run.");
