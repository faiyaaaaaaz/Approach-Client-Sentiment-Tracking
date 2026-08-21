"use client";

import { useEffect, useMemo, useState } from "react";

const DHAKA_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Dhaka",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function formatDhaka(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return `${DHAKA_FORMAT.format(date)} GMT+6`;
}

function number(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function statusLabel(value) {
  if (value === "never_logged_in") return "Never logged in";
  if (value === "misses_unopened") return "Misses unopened";
  if (value === "results_unopened") return "Results unopened";
  return "Up to date";
}

export default function TeamEngagementPanel({ session }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      if (!session?.access_token) {
        if (active) setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/engagement/dashboard", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not load Team Engagement.");
        if (active) setData(payload);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load Team Engagement.");
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [session?.access_token]);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const source = Array.isArray(data?.rows) ? data.rows : [];
    if (!query) return source;
    return source.filter((row) => [row.employee_name, row.employee_email, row.team_name].join(" ").toLowerCase().includes(query));
  }, [data?.rows, search]);

  return (
    <section className="team-engagement-panel panel" aria-busy={loading}>
      <div className="team-engagement-head">
        <div>
          <p>Agent adoption and review coverage</p>
          <h2>Team Engagement</h2>
          <span>{data?.scope === "own" ? "Your own activity and review coverage." : "All mapped agents. Times are displayed in GMT+6."}</span>
        </div>
        <label className="team-engagement-search">
          <span>Find agent</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email, or team" />
        </label>
      </div>

      {loading ? (
        <div className="team-engagement-loading" aria-live="polite">
          <i /><div><strong>Loading engagement signals…</strong><span>Checking sign-ins, conversations opened, and weekly review coverage.</span></div>
        </div>
      ) : error ? (
        <div className="team-engagement-error">{error}</div>
      ) : (
        <>
          <div className="team-engagement-stats">
            <div><span>Visible agents</span><strong>{number(data?.summary?.agents)}</strong></div>
            <div><span>Never logged in</span><strong>{number(data?.summary?.never_logged_in)}</strong></div>
            <div><span>Agents with unopened misses</span><strong>{number(data?.summary?.agents_with_unopened_misses)}</strong></div>
            <div><span>Conversations opened this week</span><strong>{number(data?.summary?.results_opened_this_week)}</strong></div>
          </div>
          <div className="team-engagement-table-wrap">
            <table className="team-engagement-table">
              <thead><tr><th>Agent</th><th>Last login</th><th>Last active</th><th>Last conversation opened</th><th>Weekly review</th><th>Unopened</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.employee_email}>
                    <td><strong>{row.employee_name}</strong><small title={row.employee_email}>{row.employee_email}</small><em>{row.team_name}</em></td>
                    <td className="engagement-time">{formatDhaka(row.last_login_at)}</td>
                    <td className="engagement-time">{formatDhaka(row.last_active_at)}</td>
                    <td className="engagement-time">{formatDhaka(row.last_conversation_opened_at)}</td>
                    <td><strong>{Number(row.weekly_review_rate || 0).toFixed(0)}%</strong><small>{number(row.results_opened_this_week)} of {number(row.new_results_this_week)} opened</small></td>
                    <td><strong>{number(row.unopened_misses)} misses</strong><small>{number(row.unopened_results)} total results</small></td>
                    <td><span className={`engagement-status ${row.status}`}>{statusLabel(row.status)}</span></td>
                  </tr>
                ))}
                {!rows.length ? <tr><td colSpan="7" className="team-engagement-empty">No matching agents.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      )}
      <style>{`
        .team-engagement-panel{padding:22px;overflow:hidden}.team-engagement-head{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:18px}.team-engagement-head p{margin:0 0 5px;color:var(--brand-hover);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.team-engagement-head h2{margin:0;color:var(--text);font-size:24px}.team-engagement-head span{display:block;margin-top:5px;color:var(--muted);font-size:14px}.team-engagement-search{display:grid;gap:6px;width:min(300px,100%)}.team-engagement-search span{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.team-engagement-search input{min-height:42px;padding:0 12px}.team-engagement-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}.team-engagement-stats div{padding:14px;border:1px solid var(--border);border-radius:14px;background:var(--raised)}.team-engagement-stats span,.team-engagement-stats strong{display:block}.team-engagement-stats span{color:var(--muted);font-size:12px}.team-engagement-stats strong{margin-top:5px;color:var(--text);font-size:24px}.team-engagement-table-wrap{overflow:auto;border:1px solid var(--border);border-radius:15px}.team-engagement-table{width:100%;min-width:1120px;border-collapse:collapse}.team-engagement-table th,.team-engagement-table td{padding:13px;text-align:left;border-bottom:1px solid var(--border);vertical-align:middle}.team-engagement-table th{position:sticky;top:0;background:var(--card);color:var(--subtle);font-size:11px;text-transform:uppercase;letter-spacing:.07em;white-space:nowrap}.team-engagement-table td{color:var(--text);font-size:13px}.team-engagement-table td strong,.team-engagement-table td small,.team-engagement-table td em{display:block}.team-engagement-table td small{max-width:220px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.team-engagement-table td em{margin-top:3px;color:var(--subtle);font-style:normal}.engagement-time{min-width:175px;white-space:normal;line-height:1.45}.engagement-status{display:inline-flex;padding:6px 9px;border-radius:999px;background:var(--brand-soft);color:var(--brand-hover);font-size:12px;font-weight:800;white-space:nowrap}.engagement-status.never_logged_in,.engagement-status.misses_unopened{background:rgba(255,90,99,.12);color:var(--danger)}.engagement-status.results_unopened{background:rgba(247,144,9,.12);color:var(--warning)}.engagement-status.up_to_date{background:rgba(51,245,117,.1);color:var(--success)}.team-engagement-loading{display:flex;align-items:center;gap:14px;min-height:130px;padding:20px;border:1px dashed var(--border);border-radius:15px}.team-engagement-loading i{width:34px;height:34px;border:3px solid var(--border);border-top-color:var(--brand);border-radius:50%;animation:engagementSpin .8s linear infinite}.team-engagement-loading strong,.team-engagement-loading span{display:block}.team-engagement-loading span{margin-top:5px;color:var(--muted)}.team-engagement-error{padding:18px;border-radius:14px;background:rgba(255,90,99,.1);color:var(--danger)}.team-engagement-empty{text-align:center!important;color:var(--muted)!important}@keyframes engagementSpin{to{transform:rotate(360deg)}}@media(max-width:900px){.team-engagement-head{align-items:stretch;flex-direction:column}.team-engagement-search{width:100%}.team-engagement-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.team-engagement-stats{grid-template-columns:1fr}}
      `}</style>
    </section>
  );
}
