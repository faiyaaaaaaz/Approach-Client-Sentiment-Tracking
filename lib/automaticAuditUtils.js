export const AUTO_BATCH_SIZE = 8;
export const AUTO_MAX_ATTEMPTS = 3;

export function previousDhakaDay(now = new Date()) {
  const local = new Date(now.getTime() + 6 * 3600000);
  local.setUTCDate(local.getUTCDate() - 1);
  return local.toISOString().slice(0, 10);
}

export function dayBounds(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) throw new Error("Audit date must be YYYY-MM-DD.");
  const start = new Date(`${day}T00:00:00+06:00`);
  const dateCheck = new Date(start.getTime() + 6 * 3600000).toISOString().slice(0, 10);
  if (dateCheck !== day) throw new Error("Audit date is not a valid calendar day.");
  return { start, end: new Date(start.getTime() + 86400000), scheduledFor: new Date(start.getTime() + 86400000 + 9 * 3600000) };
}

export function completeResult(row, day) {
  if (!row || String(row.error || "").trim()) return false;
  if (![row.ai_verdict, row.review_sentiment, row.client_sentiment, row.resolution_status].every((value) => String(value || "").trim())) return false;
  const date = new Date(row.replied_at);
  const { start, end } = dayBounds(day);
  return Number.isFinite(date.getTime()) && date >= start && date < end;
}

export function explainAuditFailure(value) {
  const raw = String(value?.message || value || "Unknown failure").slice(0, 1600);
  let title = "This step could not finish";
  let advice = "Review the technical detail below. Retry after the underlying problem is fixed; completed conversations will be retained.";
  if (/429|rate.?limit|quota|insufficient_quota/i.test(raw)) { title = "A provider refused more requests"; advice = "Check the OpenAI balance and usage limits, and Intercom rate limits. Temporary limits retry automatically up to three times; exhausted credit needs to be topped up first."; }
  else if (/401|403|unauthori|api.?key|authentication/i.test(raw)) { title = "An API key or permission was rejected"; advice = "Open Admin → API Vault and check the active Intercom and OpenAI keys and their permissions. Save a valid key, then retry this day."; }
  else if (/timeout|timed out|504|abort|fetch failed|ECONN/i.test(raw)) { title = "The service did not respond in time"; advice = "The database checkpoint is retained. The worker will retry. If this repeats, check provider availability and Vercel function logs before retrying the day."; }
  else if (/42P01|does not exist|schema cache|automatic_audit/i.test(raw)) { title = "The automatic audit database is not ready"; advice = "Run the supplied automatic-audit.sql in Supabase's SQL Editor, then retry. Check that Vercel points to the same Supabase project."; }
  else if (/save|insert|database|supabase|persist/i.test(raw)) { title = "Results or progress could not be saved"; advice = "Check Supabase availability and the service-role setting in Vercel. The next attempt checks for already saved complete results before auditing again."; }
  else if (/JSON|verdict|sentiment|validation/i.test(raw)) { title = "The AI response could not be validated"; advice = "The conversation stays eligible for another attempt. If it repeatedly fails, review the conversation and current audit prompt in Admin."; }
  return { title, advice, detail: raw };
}
