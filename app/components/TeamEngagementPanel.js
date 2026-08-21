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
  return "All published results opened";
}

function SearchMultiSelect({ label, options, selected, onChange, placeholder }) {
  const [query, setQuery] = useState("");
  const visible = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));
  function toggle(value) {
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }
  return (
    <details className="engagement-multiselect">
      <summary><span>{label}</span><strong>{selected.length ? `${selected.length} selected` : placeholder}</strong><i>⌄</i></summary>
      <div className="engagement-multiselect-menu">
        <div className="engagement-option-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} /></div>
        <div className="engagement-option-actions"><button type="button" onClick={() => onChange(options.map((option) => option.value))}>Select all</button><button type="button" onClick={() => onChange([])}>Clear</button></div>
        <div className="engagement-option-list">
          {visible.map((option) => <label key={option.value}><input type="checkbox" checked={selected.includes(option.value)} onChange={() => toggle(option.value)} /><span>{option.label}</span><i>✓</i></label>)}
          {!visible.length ? <p>No matching options.</p> : null}
        </div>
      </div>
    </details>
  );
}

export default function TeamEngagementPanel({ session }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [supervisorTeams, setSupervisorTeams] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [cexOnly, setCexOnly] = useState(true);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 12;

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

  const allRows = Array.isArray(data?.rows) ? data.rows : [];
  const supervisorTeamOptions = useMemo(() => Array.from(new Set(allRows.flatMap((row) => row.supervisor_team_names || []))).sort().map((item) => ({ value: item, label: item })), [allRows]);
  const employeeOptions = useMemo(() => allRows.map((row) => ({ value: row.employee_email, label: row.employee_name })).sort((a, b) => a.label.localeCompare(b.label)), [allRows]);
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allRows.filter((row) => {
      if (supervisorTeams.length && !supervisorTeams.some((team) => (row.supervisor_team_names || []).includes(team))) return false;
      if (employees.length && !employees.includes(row.employee_email)) return false;
      if (cexOnly && String(row.team_name || "").trim().toLowerCase() !== "cex") return false;
      return !query || [row.employee_name, row.employee_email, row.team_name, ...(row.supervisor_team_names || [])].join(" ").toLowerCase().includes(query);
    });
  }, [allRows, search, supervisorTeams, employees, cexOnly]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const rows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, supervisorTeams, employees, cexOnly]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  return (
    <section className="team-engagement-panel panel" aria-busy={loading}>
      <div className="team-engagement-head">
        <div>
          <p>Agent adoption and review coverage</p>
          <h2>Team Engagement</h2>
          <span>{data?.scope === "own" ? "Your own activity and review coverage." : "All mapped agents. Times are displayed in GMT+6."}</span>
        </div>
        <div className="team-engagement-filters">
          <SearchMultiSelect label="Supervisor team" options={supervisorTeamOptions} selected={supervisorTeams} onChange={setSupervisorTeams} placeholder="All supervisor teams" />
          <SearchMultiSelect label="Employee" options={employeeOptions} selected={employees} onChange={setEmployees} placeholder="All employees" />
          <label className="engagement-global-search"><span>Search engagement</span><div><i>⌕</i><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, or team" /></div></label>
          <label className="engagement-cex-toggle"><input type="checkbox" checked={cexOnly} onChange={(event) => setCexOnly(event.target.checked)} /><i><b /></i><span><strong>CEx only</strong><small>Limit engagement to the CEx team</small></span></label>
        </div>
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
          <div className="team-engagement-pagination"><span>Showing {filteredRows.length ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, filteredRows.length)} of {filteredRows.length}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><strong>Page {page} of {pageCount}</strong><button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
          <p className="team-engagement-definition"><strong>All published results opened</strong> means the agent has opened every result currently published to them. It does not evaluate whether their performance improved afterward.</p>
        </>
      )}
      <style>{`
        .team-engagement-panel{padding:22px;overflow:visible}.team-engagement-head{display:grid;gap:18px;margin-bottom:18px}.team-engagement-head p{margin:0 0 5px;color:var(--brand-hover);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.team-engagement-head h2{margin:0;color:var(--text);font-size:24px}.team-engagement-head>div>span{display:block;margin-top:5px;color:var(--muted);font-size:14px}.team-engagement-filters{position:relative;z-index:5;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:14px;border:1px solid var(--border);border-radius:17px;background:linear-gradient(135deg,var(--raised),var(--card));box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}.engagement-multiselect{position:relative}.engagement-multiselect summary,.engagement-global-search{min-width:0}.engagement-multiselect summary{display:grid;grid-template-columns:1fr auto;gap:3px 10px;min-height:54px;padding:9px 12px;border:1px solid var(--border);border-radius:13px;background:var(--card);cursor:pointer;list-style:none}.engagement-multiselect summary::-webkit-details-marker{display:none}.engagement-multiselect summary span,.engagement-global-search>span{color:var(--subtle);font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.09em}.engagement-multiselect summary strong{overflow:hidden;color:var(--text);font-size:13px;text-overflow:ellipsis;white-space:nowrap}.engagement-multiselect summary i{grid-column:2;grid-row:1/3;align-self:center;color:var(--brand-hover);font-style:normal;font-size:18px}.engagement-multiselect[open] summary{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}.engagement-multiselect-menu{position:absolute;top:calc(100% + 8px);left:0;width:max(100%,310px);padding:10px;border:1px solid var(--border);border-radius:15px;background:var(--card);box-shadow:0 20px 55px rgba(0,0,0,.28)}.engagement-option-search,.engagement-global-search>div{display:flex;align-items:center;gap:8px;border:1px solid var(--border);border-radius:11px;background:var(--raised)}.engagement-option-search{padding:0 10px}.engagement-option-search span,.engagement-global-search i{color:var(--brand-hover);font-style:normal}.engagement-option-search input,.engagement-global-search input{width:100%;min-width:0;min-height:40px;padding:0;border:0!important;outline:0;background:transparent!important;color:var(--text)}.engagement-option-actions{display:flex;justify-content:space-between;margin:8px 0}.engagement-option-actions button{border:0;background:transparent;color:var(--brand-hover);font-size:11px;font-weight:800}.engagement-option-list{max-height:230px;overflow:auto;display:grid;gap:3px}.engagement-option-list label{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;padding:8px;border-radius:9px;color:var(--text);cursor:pointer}.engagement-option-list label:hover{background:var(--hover)}.engagement-option-list input{accent-color:var(--brand)}.engagement-option-list label i{opacity:0;color:var(--success);font-style:normal}.engagement-option-list label:has(input:checked) i{opacity:1}.engagement-option-list p{padding:12px;color:var(--muted);text-align:center}.engagement-global-search{display:grid;gap:5px}.engagement-global-search>div{min-height:54px;padding:0 11px}.team-engagement-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}.team-engagement-stats div{padding:14px;border:1px solid var(--border);border-radius:14px;background:var(--raised)}.team-engagement-stats span,.team-engagement-stats strong{display:block}.team-engagement-stats span{color:var(--muted);font-size:12px}.team-engagement-stats strong{margin-top:5px;color:var(--text);font-size:24px}.team-engagement-table-wrap{max-height:610px;overflow:auto;border:1px solid var(--border);border-radius:15px}.team-engagement-table{width:100%;min-width:1120px;border-collapse:collapse}.team-engagement-table th,.team-engagement-table td{padding:13px;text-align:left;border-bottom:1px solid var(--border);vertical-align:middle}.team-engagement-table th{position:sticky;top:0;z-index:1;background:var(--card);color:var(--subtle);font-size:11px;text-transform:uppercase;letter-spacing:.07em;white-space:nowrap}.team-engagement-table td{color:var(--text);font-size:13px}.team-engagement-table td strong,.team-engagement-table td small,.team-engagement-table td em{display:block}.team-engagement-table td small{max-width:220px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.team-engagement-table td em{margin-top:3px;color:var(--subtle);font-style:normal}.engagement-time{min-width:175px;white-space:normal;line-height:1.45}.engagement-status{display:inline-flex;padding:6px 9px;border-radius:999px;background:var(--brand-soft);color:var(--brand-hover);font-size:12px;font-weight:800;white-space:nowrap}.engagement-status.never_logged_in,.engagement-status.misses_unopened{background:rgba(255,90,99,.12);color:var(--danger)}.engagement-status.results_unopened{background:rgba(247,144,9,.12);color:var(--warning)}.engagement-status.up_to_date{background:rgba(51,245,117,.1);color:var(--success)}.team-engagement-pagination{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:12px;color:var(--muted);font-size:12px}.team-engagement-pagination div{display:flex;align-items:center;gap:10px}.team-engagement-pagination button{padding:7px 11px;border:1px solid var(--border);border-radius:9px;background:var(--raised);color:var(--text)}.team-engagement-pagination button:disabled{opacity:.45}.team-engagement-definition{margin:14px 0 0;padding:12px;border-radius:12px;background:var(--raised);color:var(--muted);font-size:12px}.team-engagement-loading{display:flex;align-items:center;gap:14px;min-height:130px;padding:20px;border:1px dashed var(--border);border-radius:15px}.team-engagement-loading i{width:34px;height:34px;border:3px solid var(--border);border-top-color:var(--brand);border-radius:50%;animation:engagementSpin .8s linear infinite}.team-engagement-loading strong,.team-engagement-loading span{display:block}.team-engagement-loading span{margin-top:5px;color:var(--muted)}.team-engagement-error{padding:18px;border-radius:14px;background:rgba(255,90,99,.1);color:var(--danger)}.team-engagement-empty{text-align:center!important;color:var(--muted)!important}@keyframes engagementSpin{to{transform:rotate(360deg)}}@media(max-width:900px){.team-engagement-filters{grid-template-columns:1fr}.engagement-multiselect-menu{width:100%}.team-engagement-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.team-engagement-stats{grid-template-columns:1fr}.team-engagement-pagination{align-items:flex-start;flex-direction:column}}
      `}</style>
      <style>{`
        .team-engagement-filters{grid-template-columns:repeat(3,minmax(0,1fr)) 190px}.engagement-cex-toggle{display:flex;align-items:center;gap:10px;min-height:54px;padding:8px 11px;border:1px solid var(--border);border-radius:13px;background:var(--card);cursor:pointer}.engagement-cex-toggle>input{position:absolute;opacity:0;pointer-events:none}.engagement-cex-toggle>i{position:relative;width:38px;height:22px;flex:0 0 auto;border-radius:999px;background:var(--border);transition:.2s}.engagement-cex-toggle>i b{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 2px 6px rgba(0,0,0,.25)}.engagement-cex-toggle>input:checked+i{background:var(--brand)}.engagement-cex-toggle>input:checked+i b{transform:translateX(16px)}.engagement-cex-toggle>span{display:grid;gap:2px}.engagement-cex-toggle strong{color:var(--text);font-size:13px}.engagement-cex-toggle small{color:var(--muted);font-size:10px;line-height:1.25}@media(max-width:1180px){.team-engagement-filters{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:900px){.team-engagement-filters{grid-template-columns:1fr}}
      `}</style>
    </section>
  );
}
