"use client";

import { useCallback, useEffect, useState } from "react";

const statusLabels = { queued: "Waiting for worker", fetching: "Fetching conversations", auditing: "Auditing", completed: "Completed", completed_with_errors: "Completed · needs review", failed: "Stopped · needs review", paused: "Waiting to resume" };
const fmt = (value) => Number(value || 0).toLocaleString();
function time(value) { return value ? new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }) + " GMT+6" : "Not started"; }
function dateLabel(value) { return new Date(value + "T00:00:00+06:00").toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka", day: "numeric", month: "long", year: "numeric" }); }
function nextSchedule() {
  const shifted = new Date(Date.now() + 6 * 3600000);
  const day = shifted.toISOString().slice(0, 10);
  let scheduled = new Date(day + "T09:00:00+06:00");
  if (scheduled <= new Date()) scheduled = new Date(scheduled.getTime() + 86400000);
  return time(scheduled);
}
function FailureNote({ failure, label }) {
  if (!failure) return null;
  return <div className="auto-failure"><strong>{label || failure.title}</strong><p>{failure.advice}</p><details><summary>Technical detail</summary><pre>{failure.detail}</pre></details></div>;
}

export default function AutomaticAuditPanel({ session }) {
  const [runs, setRuns] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [dates, setDates] = useState({ from: "", to: "" });
  const [appliedDates, setAppliedDates] = useState({ from: "", to: "" });
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState(null);
  const [failurePage, setFailurePage] = useState(0);
  const [eventPage, setEventPage] = useState(0);
  const [busy, setBusy] = useState(true);
  const [detailBusy, setDetailBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retrying, setRetrying] = useState(null);
  const [configured, setConfigured] = useState(false);
  const token = session?.access_token;

  const request = useCallback(async (suffix = "", body) => {
    if (!token) throw new Error("Sign in to load automatic audit history.");
    const response = await fetch(`/api/audits/automatic${suffix}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.guidance ? `${data.guidance.title}. ${data.guidance.advice}` : data?.error || "The audit history could not be loaded.");
    return data;
  }, [token]);

  const refresh = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (appliedDates.from) params.set("from", appliedDates.from);
      if (appliedDates.to) params.set("to", appliedDates.to);
      const data = await request("?" + params);
      setRuns(data.runs || []); setTotal(data.total || 0); setConfigured(data.configured); setError("");
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }, [page, appliedDates, request]);
  const loadDetail = useCallback(async () => {
    if (!expanded) return;
    try { setDetail(await request(`?runId=${encodeURIComponent(expanded)}&page=${failurePage}&eventPage=${eventPage}`)); }
    catch (failure) { setError(failure.message); }
    finally { setDetailBusy(false); }
  }, [expanded, failurePage, eventPage, request]);
  useEffect(() => { setBusy(true); refresh(); }, [refresh]);
  useEffect(() => { setDetail(null); setDetailBusy(Boolean(expanded)); loadDetail(); }, [loadDetail]);
  useEffect(() => {
    const interval = setInterval(() => { if (!document.hidden) { refresh(); loadDetail(); } }, 15000);
    return () => clearInterval(interval);
  }, [refresh, loadDetail]);
  async function retry(runId) {
    setRetrying(runId); setMessage("");
    try { const data = await request("", { action: "retry", runId }); setMessage(data.message); await refresh(); await loadDetail(); }
    catch (failure) { setError(failure.message); }
    finally { setRetrying(null); }
  }
  const latest = runs[0];
  const attention = runs.filter((run) => run.failed_count || run.status === "failed").length;
  return <section className="automatic-audit-panel">
    <header className="auto-hero">
      <div><span className="auto-eyebrow">Daily quality coverage</span><h2>Automatic Audit Run</h2><p>A complete day’s queue. Saved progress. Clear answers when something needs attention.</p><div className="auto-policy"><span>09:00 GMT+6</span><span>Yesterday · 00:00–23:59:59</span><span>CSAT 3, 4, 5</span><span>8 per batch</span><span>GPT‑4.1 mini</span></div></div>
      <aside><small>Next scheduled trigger</small><strong>{nextSchedule()}</strong><p>Runs independently of manual audits and browser tabs. Scheduler delays are shown by the actual start time.</p></aside>
    </header>
    {!configured && !busy ? <div className="auto-warning">The server secret is not configured. Complete the supplied setup steps to enable the scheduler.</div> : null}
    {configured ? <p className="auto-caption">Server key configured. Scheduling is handled by the GitHub workflow; a configured key alone does not confirm the workflow is enabled.</p> : null}
    <div className="auto-stats">
      <div><span>Latest day · saved</span><strong>{fmt(latest?.success_count)}</strong><small>New or recovered complete results</small></div>
      <div><span>Latest day · duplicates</span><strong>{fmt(latest?.duplicate_count)}</strong><small>Complete results skipped before AI</small></div>
      <div><span>Days needing attention</span><strong>{fmt(attention)}</strong><small>On this history page</small></div>
      <div><span>Recorded days</span><strong>{fmt(total)}</strong><small>Within your history filters</small></div>
    </div>
    <div className="auto-history-head"><div><h3>Daily run history</h3><p>Open a day for progress, timestamps, failure notes, and the saved activity timeline.</p></div><button onClick={() => { refresh(); loadDetail(); }} type="button">Refresh history</button></div>
    <form className="auto-date-filter" onSubmit={(event) => { event.preventDefault(); if (dates.from && dates.to && dates.from > dates.to) { setError("The start date must be on or before the end date."); return; } setPage(0); setAppliedDates({ ...dates }); }}><label>Audit day from<input type="date" value={dates.from} onChange={(event) => setDates((current) => ({ ...current, from: event.target.value }))} /></label><label>Audit day to<input type="date" value={dates.to} onChange={(event) => setDates((current) => ({ ...current, to: event.target.value }))} /></label><button type="submit">Apply dates</button><button type="button" onClick={() => { setDates({ from: "", to: "" }); setAppliedDates({ from: "", to: "" }); setPage(0); }}>All dates</button></form>
    {error ? <div role="alert" className="auto-warning">{error}</div> : null}
    {message ? <div role="status" className="auto-notice">{message}</div> : null}
    {busy ? <div className="auto-empty">Loading daily history…</div> : !runs.length ? <div className="auto-empty"><strong>No daily runs yet</strong><p>After setup, the 9 AM schedule will create yesterday’s run here. Manual audits do not cancel that daily run.</p></div> : runs.map((run) => {
      const handled = run.success_count + run.duplicate_count + run.failed_count;
      const percent = run.conversation_count ? Math.round(handled / run.conversation_count * 100) : 0;
      const open = expanded === run.id;
      const current = open && detail?.run?.id === run.id ? detail.run : run;
      return <article className={`auto-day ${open ? "auto-day-open" : ""}`} key={run.id}>
        <button className="auto-day-toggle" type="button" aria-expanded={open} onClick={() => { setFailurePage(0); setEventPage(0); setExpanded(open ? null : run.id); }}><div><strong>{dateLabel(run.audit_date)}</strong><small>Conversation day · GMT+6</small></div><span className={`auto-status ${run.status}`}>{statusLabels[run.status]}</span><div className="auto-day-numbers"><span><b>{fmt(run.conversation_count)}</b> found</span><span><b>{fmt(run.success_count)}</b> saved</span><span><b>{fmt(run.duplicate_count)}</b> skipped</span><span><b>{fmt(run.failed_count)}</b> failed</span></div><i aria-hidden="true">{open ? "−" : "+"}</i></button>
        <div className="auto-progress" title={run.fetch_complete ? `${percent}% of the fetched queue handled` : "Fetching the entire conversation day before auditing"}><i style={{ width: run.fetch_complete ? `${percent}%` : "12%" }} /></div>
        {open ? <div className="auto-day-detail">
          <div className="auto-day-summary"><span>{run.fetch_complete ? `${fmt(handled)} of ${fmt(run.conversation_count)} handled · ${fmt(run.pending_count)} waiting` : "Fetching the full day. Counts may rise until pagination finishes."}</span>{["failed", "completed_with_errors", "paused"].includes(current.status) ? <button type="button" disabled={Boolean(retrying)} onClick={() => retry(run.id)}>{retrying === run.id ? "Queueing retry…" : "Retry unfinished / failed work"}</button> : null}</div>
          <div className="auto-times"><div><span>Scheduled</span><strong>{time(run.scheduled_for)}</strong></div><div><span>Actually started</span><strong>{time(run.started_at)}</strong></div><div><span>Last worker update</span><strong>{time(current.heartbeat_at)}</strong></div><div><span>Finished</span><strong>{run.finished_at ? time(run.finished_at) : "Not finished"}</strong></div><div><span>Batch checkpoints</span><strong>{fmt(current.batch_count)}</strong></div></div>
          <FailureNote failure={current.last_error} />
          {detailBusy ? <p>Loading this day’s details…</p> : detail?.run?.id === run.id ? <>
            <div className="auto-detail-columns"><div><h4>Conversations needing attention <span>{fmt(detail.failureCount)}</span></h4>{detail.failures?.length ? detail.failures.map((item) => <div className="auto-item-failure" key={item.conversation_id}><div><strong>Conversation {item.conversation_id}</strong><span>{item.status === "pending" ? "Retry pending" : "Failed after retries"} · {item.attempts}/3 attempts</span></div><FailureNote failure={item.last_error} /></div>) : <p className="auto-empty-copy">No conversation failures recorded for this day.</p>}{detail.failureCount > 50 ? <div className="auto-pagination"><button disabled={!failurePage} onClick={() => setFailurePage((value) => value - 1)}>Previous failures</button><span>Page {failurePage + 1} of {Math.ceil(detail.failureCount / 50)}</span><button disabled={(failurePage + 1) * 50 >= detail.failureCount} onClick={() => setFailurePage((value) => value + 1)}>Next failures</button></div> : null}</div>
            <div><h4>Worker activity timeline</h4><p className="auto-caption">{fmt(detail.eventCount)} saved entries · newest first. Earlier failures stay available after a successful retry.</p><div className="auto-timeline">{detail.events?.map((event) => <details key={event.id}><summary><span className={`auto-event-dot ${event.kind}`} /><div><strong>{event.message}</strong><small>{time(event.created_at)}</small></div></summary><pre>{JSON.stringify(event.detail, null, 2)}</pre></details>)}</div>{detail.eventCount > 50 ? <div className="auto-pagination"><button disabled={!eventPage} onClick={() => setEventPage((value) => value - 1)}>Newer activity</button><span>{eventPage + 1}/{Math.ceil(detail.eventCount / 50)}</span><button disabled={(eventPage + 1) * 50 >= detail.eventCount} onClick={() => setEventPage((value) => value + 1)}>Older activity</button></div> : null}</div></div>
          </> : null}
          <p className="auto-footnote">Duplicate skips require a saved AI verdict, review approach, client sentiment, resolution status, and no error for this conversation day. Retries retain completed results. Unmapped employees can still be audited; mapping does not determine AI-result completeness.</p>
        </div> : null}
      </article>;
    })}
    <div className="auto-pagination"><button disabled={!page || busy} onClick={() => { setExpanded(null); setPage((value) => value - 1); }}>Previous days</button><span>{total ? `Page ${page + 1} of ${Math.ceil(total / 20)}` : "0 days"}</span><button disabled={(page + 1) * 20 >= total || busy} onClick={() => { setExpanded(null); setPage((value) => value + 1); }}>Next days</button></div>
    <style jsx global>{`
      .automatic-audit-panel{color:var(--text);font-size:15px;line-height:1.55}
      .auto-hero{display:grid;grid-template-columns:minmax(0,1.8fr) minmax(250px,1fr);gap:28px;padding:30px;border:1px solid var(--border);border-radius:22px;background:linear-gradient(120deg,var(--brand-soft),transparent 80%),var(--card)}
      .auto-eyebrow{font-size:12px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--brand-hover)}
      .auto-hero h2{margin:6px 0 10px;font-size:30px;letter-spacing:-.04em}.auto-hero p{margin:0;color:var(--muted);font-size:15px;max-width:630px}
      .auto-policy{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}.auto-policy span{padding:6px 11px;border:1px solid var(--border);border-radius:999px;background:var(--raised);font-size:13px;font-weight:700}
      .auto-hero aside{align-self:center;padding:20px;border:1px solid var(--border);border-radius:16px;background:var(--raised)}.auto-hero aside small{color:var(--muted);font-size:13px}.auto-hero aside strong{display:block;margin:6px 0 10px;font-size:18px}.auto-hero aside p{font-size:13px}
      .auto-caption{font-size:13px;color:var(--muted);margin:10px 0}.auto-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:20px 0 28px}.auto-stats>div{padding:18px 20px;border:1px solid var(--border);border-radius:16px;background:var(--card)}.auto-stats span,.auto-stats strong,.auto-stats small{display:block}.auto-stats span{color:var(--muted);font-size:13px;font-weight:700}.auto-stats strong{font-size:30px;line-height:1.3;margin:6px 0}.auto-stats small{font-size:12px;color:var(--muted)}
      .auto-history-head{display:flex;align-items:center;justify-content:space-between;gap:20px}.auto-history-head h3{font-size:22px;margin:0}.auto-history-head p{margin:5px 0 0;color:var(--muted)}
      .automatic-audit-panel button{font:inherit;cursor:pointer;border:1px solid var(--border);background:var(--raised);color:var(--text);border-radius:10px;padding:9px 13px;font-weight:700}.automatic-audit-panel button:hover{background:var(--hover)}.automatic-audit-panel button:focus-visible{outline:2px solid var(--brand);outline-offset:3px}.automatic-audit-panel button:disabled{opacity:.45;cursor:default}
      .auto-date-filter{position:relative;z-index:2;display:flex;align-items:end;flex-wrap:wrap;gap:12px;padding:16px;margin:18px 0;border:1px solid var(--border);border-radius:16px;background:var(--card)}.auto-date-filter label{display:grid;gap:6px;font-size:13px;font-weight:700}.auto-date-filter input{width:190px;min-height:42px;padding:8px 10px;border-radius:9px;border:1px solid var(--border);background:var(--raised);color:var(--text);font:inherit}
      .auto-warning,.auto-notice{padding:15px 18px;margin:14px 0;border-radius:12px;line-height:1.6}.auto-warning{background:color-mix(in srgb,var(--danger) 9%,var(--card));border:1px solid color-mix(in srgb,var(--danger) 30%,var(--border));color:var(--text)}.auto-notice{background:var(--brand-soft);border:1px solid var(--border)}
      .auto-day{margin:12px 0;border:1px solid var(--border);border-radius:16px;background:var(--card);overflow:visible}.auto-day-open{border-color:color-mix(in srgb,var(--brand) 45%,var(--border))}.automatic-audit-panel .auto-day-toggle{width:100%;display:grid;grid-template-columns:minmax(170px,1fr) minmax(170px,auto) minmax(300px,1.5fr) 24px;align-items:center;gap:16px;text-align:left;border:0;background:transparent;padding:19px 20px}.auto-day-toggle strong{font-size:16px}.auto-day-toggle small{display:block;font-size:12px;color:var(--muted);font-weight:400;margin-top:3px}.auto-day-toggle i{font-style:normal;font-size:24px;color:var(--muted)}
      .auto-status{font-size:12px;border-radius:999px;padding:6px 10px;background:var(--brand-soft);color:var(--brand-hover);white-space:nowrap;text-align:center}.auto-status.completed{background:color-mix(in srgb,var(--success) 12%,transparent);color:var(--success)}.auto-status.failed,.auto-status.completed_with_errors{background:color-mix(in srgb,var(--danger) 12%,transparent);color:var(--danger)}.auto-day-numbers{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:16px}.auto-day-numbers span{font-size:12px;font-weight:400;color:var(--muted)}.auto-day-numbers b{display:block;color:var(--text);font-size:17px}
      .auto-progress{height:4px;background:var(--hover);margin:0 20px;border-radius:4px;overflow:hidden}.auto-progress i{display:block;height:100%;background:linear-gradient(90deg,var(--brand),var(--info));transition:width .25s}
      .auto-day-detail{padding:20px}.auto-day-summary{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:16px;font-size:14px}.auto-day-summary button{background:var(--brand)!important;color:white!important}.auto-times{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;padding:16px;background:var(--raised);border-radius:12px;margin:12px 0 20px}.auto-times span{display:block;color:var(--muted);font-size:12px;margin-bottom:5px}.auto-times strong{font-size:13px}
      .auto-detail-columns{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:20px 0}.auto-detail-columns h4{font-size:16px;margin:0 0 12px}.auto-detail-columns h4 span{color:var(--danger)}.auto-failure{padding:14px;border:1px solid color-mix(in srgb,var(--danger) 22%,var(--border));border-radius:12px;background:color-mix(in srgb,var(--danger) 5%,var(--card));margin:10px 0}.auto-failure strong{font-size:14px}.auto-failure p{font-size:13px;margin:7px 0;color:var(--muted)}.auto-failure summary{cursor:pointer;font-size:12px;color:var(--brand-hover)}
      .automatic-audit-panel pre{background:var(--raised)!important;color:var(--text)!important;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:260px;overflow:auto;padding:12px;border:1px solid var(--border);border-radius:9px;line-height:1.65}.auto-item-failure{padding:12px 0;border-bottom:1px solid var(--border)}.auto-item-failure>div:first-child{display:flex;justify-content:space-between;gap:10px;font-size:13px}.auto-item-failure>div:first-child span{color:var(--muted);font-size:12px}.auto-timeline{max-height:540px;overflow:auto;padding-right:5px}.auto-timeline details{padding:12px 0;border-bottom:1px solid var(--border)}.auto-timeline summary{display:flex;gap:10px;align-items:start;cursor:pointer}.auto-timeline strong{font-size:13px;font-weight:600}.auto-timeline small{display:block;font-size:12px;color:var(--muted);margin-top:5px}.auto-event-dot{width:8px;height:8px;border-radius:50%;background:var(--brand);margin-top:7px;flex-shrink:0}.auto-event-dot.error{background:var(--danger)}.auto-event-dot.batch{background:var(--info)}.auto-footnote{padding:14px;background:var(--raised);border-radius:10px;font-size:12px;color:var(--muted);margin:16px 0 0}.auto-empty{padding:32px;text-align:center;border:1px dashed var(--border);border-radius:16px;background:var(--card);color:var(--muted)}.auto-empty strong{font-size:18px;color:var(--text)}.auto-empty p{margin:8px auto;max-width:580px}.auto-empty-copy{color:var(--muted);font-size:13px}.auto-pagination{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:20px 0;color:var(--muted);font-size:13px}
      @media(max-width:1100px){.auto-day-toggle{grid-template-columns:1fr auto!important}.auto-day-numbers{justify-content:flex-start}.auto-times{grid-template-columns:repeat(3,1fr)}.auto-detail-columns{grid-template-columns:1fr}}
      @media(max-width:760px){.auto-hero{grid-template-columns:1fr;padding:22px}.auto-stats{grid-template-columns:1fr 1fr}.auto-times{grid-template-columns:1fr 1fr}.auto-history-head{align-items:start;flex-direction:column}.auto-day-summary{flex-direction:column;align-items:start}.auto-hero h2{font-size:26px}}
    `}</style>
  </section>;
}
