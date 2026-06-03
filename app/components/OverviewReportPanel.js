"use client";

import { useMemo, useState } from "react";

function getDhakaDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";

  return `${year}-${month}-${day}`;
}

function addDaysToDateString(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultRange() {
  const today = getDhakaDateString();
  const yesterday = addDaysToDateString(today, -1);
  return {
    startDate: addDaysToDateString(yesterday, -6),
    endDate: yesterday,
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "0.0%";
  return `${value.toFixed(1)}%`;
}

function buildPlatformUrl() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export default function OverviewReportPanel({ session }) {
  const defaultRange = useMemo(() => getDefaultRange(), []);
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [report, setReport] = useState("");
  const [summary, setSummary] = useState(null);
  const [reportSource, setReportSource] = useState("");

  function applyPreset(key) {
    const today = getDhakaDateString();
    const yesterday = addDaysToDateString(today, -1);

    if (key === "yesterday") {
      setStartDate(yesterday);
      setEndDate(yesterday);
      return;
    }

    if (key === "past_week") {
      setStartDate(addDaysToDateString(yesterday, -6));
      setEndDate(yesterday);
      return;
    }

    if (key === "past_4_weeks") {
      setStartDate(addDaysToDateString(yesterday, -27));
      setEndDate(yesterday);
      return;
    }

    if (key === "month_to_date") {
      setStartDate(`${today.slice(0, 8)}01`);
      setEndDate(today);
    }
  }

  async function generateReport() {
    setError("");
    setSuccess("");
    setReport("");
    setSummary(null);
    setReportSource("");

    if (!session?.access_token) {
      setError("Please sign in again before generating the report.");
      return;
    }

    if (!startDate || !endDate) {
      setError("Select both start and end date before generating the report.");
      return;
    }

    if (startDate > endDate) {
      setError("Start date cannot be after end date.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/admin/overview-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          startDate,
          endDate,
          platformUrl: buildPlatformUrl(),
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Could not generate overview report.");
      }

      setReport(data.report || "");
      setSummary(data.summary || null);
      setReportSource(data.reportSource || "");
      setSuccess("Overview report generated. Review it once, then copy it to ClickUp.");
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Could not generate overview report.");
    } finally {
      setLoading(false);
    }
  }

  async function copyReport() {
    if (!report) return;

    setCopying(true);
    setError("");
    setSuccess("");

    try {
      await navigator.clipboard.writeText(report);
      setSuccess("Report copied. You can paste it into ClickUp now.");
    } catch (_error) {
      setError("Copy failed. Select the report text manually and copy it.");
    } finally {
      setCopying(false);
    }
  }

  const breakdown = summary?.sentimentBreakdown || [];
  const sourceLabel = reportSource === "openai" ? "AI-written from verified platform data" : reportSource ? "Server fallback from verified platform data" : "Not generated yet";

  return (
    <section className="overview-report-shell">
      <div className="overview-report-hero">
        <div>
          <p className="eyebrow">Platform Owner Only</p>
          <h2>Overview Report Generator</h2>
          <p>
            Generate a ClickUp-ready missed review approach report from stored audit results only. This does not run new audits.
          </p>
        </div>
        <span className="owner-lock">Owner Locked</span>
      </div>

      <div className="overview-report-grid">
        <article className="overview-report-card setup-card">
          <div className="report-card-head">
            <div>
              <p className="eyebrow">Report Setup</p>
              <h3>Date Range</h3>
              <p>Select the period you want to summarize. Neutral and negative client sentiment categories are excluded from this report.</p>
            </div>
          </div>

          <div className="preset-row">
            <button type="button" className="mini-btn" onClick={() => applyPreset("yesterday")} disabled={loading}>Yesterday</button>
            <button type="button" className="mini-btn" onClick={() => applyPreset("past_week")} disabled={loading}>Past Week</button>
            <button type="button" className="mini-btn" onClick={() => applyPreset("past_4_weeks")} disabled={loading}>Past 4 Weeks</button>
            <button type="button" className="mini-btn" onClick={() => applyPreset("month_to_date")} disabled={loading}>Month To Date</button>
          </div>

          <div className="date-grid">
            <label>
              <span>Start Date</span>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} disabled={loading} />
            </label>
            <label>
              <span>End Date</span>
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} disabled={loading} />
            </label>
          </div>

          <button type="button" className="generate-btn" onClick={generateReport} disabled={loading || !session?.access_token}>
            {loading ? "Generating Report..." : "Generate Report"}
          </button>

          <div className="scope-note">
            <strong>Included scope:</strong> Missed Opportunity + Very Positive, Positive, and Slightly Positive client sentiment only.
          </div>
        </article>

        <article className="overview-report-card summary-card">
          <div className="report-card-head">
            <div>
              <p className="eyebrow">Verified Data Summary</p>
              <h3>Report Facts</h3>
              <p>The AI receives these calculated facts and must not invent numbers.</p>
            </div>
          </div>

          {summary ? (
            <div className="summary-grid">
              <div className="summary-tile">
                <span>Total Audited</span>
                <strong>{formatNumber(summary.totalAudited)}</strong>
                <small>Stored result rows in range</small>
              </div>
              <div className="summary-tile danger">
                <span>Missed Approaches</span>
                <strong>{formatNumber(summary.totalMissedPositive)}</strong>
                <small>Positive-side only</small>
              </div>
              <div className="summary-tile warning">
                <span>Miss Rate</span>
                <strong>{formatPercent(summary.missedPositiveRate)}</strong>
                <small>Of audited conversations</small>
              </div>
              <div className="summary-tile">
                <span>Report Source</span>
                <strong>{reportSource === "openai" ? "AI" : "Fallback"}</strong>
                <small>{sourceLabel}</small>
              </div>
            </div>
          ) : (
            <div className="empty-state">Generate a report to see the verified summary.</div>
          )}

          {breakdown.length ? (
            <div className="breakdown-list">
              {breakdown.map((item) => (
                <div key={item.sentiment}>
                  <span>{item.sentiment}</span>
                  <strong>{formatNumber(item.count)}</strong>
                </div>
              ))}
            </div>
          ) : null}
        </article>
      </div>

      {(error || success) ? (
        <div className="report-message-stack">
          {error ? <div className="report-message error">{error}</div> : null}
          {success ? <div className="report-message success">{success}</div> : null}
        </div>
      ) : null}

      <article className="overview-report-card report-output-card">
        <div className="report-card-head output-head">
          <div>
            <p className="eyebrow">ClickUp Output</p>
            <h3>Generated Report</h3>
            <p>Review the wording once before pasting it into the ClickUp channel.</p>
          </div>
          <button type="button" className="copy-btn" onClick={copyReport} disabled={!report || copying}>
            {copying ? "Copying..." : "Copy Report"}
          </button>
        </div>

        <textarea
          className="report-textarea"
          value={report}
          onChange={(event) => setReport(event.target.value)}
          placeholder="Your generated ClickUp-ready report will appear here."
          rows={18}
        />
      </article>

      {summary?.topAgents?.length ? (
        <article className="overview-report-card insight-card">
          <div className="report-card-head">
            <div>
              <p className="eyebrow">Agent Focus</p>
              <h3>Top Missed Approach Counts</h3>
            </div>
          </div>
          <div className="agent-table-wrap">
            <table className="agent-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Team</th>
                  <th>Total</th>
                  <th>Very Positive</th>
                  <th>Positive</th>
                  <th>Slightly Positive</th>
                </tr>
              </thead>
              <tbody>
                {summary.topAgents.slice(0, 8).map((agent) => (
                  <tr key={agent.employee}>
                    <td>{agent.employee}</td>
                    <td>{agent.team || "-"}</td>
                    <td>{formatNumber(agent.total)}</td>
                    <td>{formatNumber(agent.veryPositive)}</td>
                    <td>{formatNumber(agent.positive)}</td>
                    <td>{formatNumber(agent.slightlyPositive)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}

      <style jsx>{`
        .overview-report-shell {
          display: grid;
          gap: 18px;
        }

        .overview-report-hero,
        .overview-report-card {
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: linear-gradient(135deg, rgba(15, 23, 42, 0.94), rgba(30, 27, 75, 0.72));
          box-shadow: 0 24px 70px rgba(2, 6, 23, 0.34);
          border-radius: 24px;
        }

        .overview-report-hero {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          padding: 28px;
        }

        .overview-report-hero h2,
        .overview-report-card h3 {
          margin: 0;
          color: #f8fafc;
          letter-spacing: -0.04em;
        }

        .overview-report-hero h2 {
          font-size: clamp(2rem, 4vw, 4rem);
          line-height: 0.95;
        }

        .overview-report-hero p,
        .overview-report-card p,
        .scope-note,
        .empty-state,
        .summary-tile small {
          color: #bfdbfe;
        }

        .overview-report-hero p {
          max-width: 820px;
          margin: 14px 0 0;
          font-size: 1.02rem;
          line-height: 1.65;
        }

        .eyebrow {
          margin: 0 0 8px;
          color: #93c5fd;
          text-transform: uppercase;
          font-size: 0.72rem;
          font-weight: 900;
          letter-spacing: 0.18em;
        }

        .owner-lock {
          display: inline-flex;
          align-items: center;
          border: 1px solid rgba(34, 211, 238, 0.28);
          background: rgba(8, 145, 178, 0.14);
          color: #a7f3d0;
          padding: 8px 12px;
          border-radius: 999px;
          font-size: 0.78rem;
          font-weight: 900;
          white-space: nowrap;
        }

        .overview-report-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 18px;
        }

        .overview-report-card {
          padding: 22px;
        }

        .report-card-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 18px;
        }

        .report-card-head p {
          margin: 8px 0 0;
          line-height: 1.55;
        }

        .preset-row {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 16px;
        }

        .mini-btn,
        .copy-btn,
        .generate-btn {
          border: 1px solid rgba(148, 163, 184, 0.22);
          color: #f8fafc;
          font-weight: 900;
          cursor: pointer;
          transition: transform 160ms ease, border-color 160ms ease, opacity 160ms ease;
        }

        .mini-btn,
        .copy-btn {
          background: rgba(15, 23, 42, 0.82);
          border-radius: 14px;
          padding: 11px 14px;
        }

        .mini-btn:hover,
        .copy-btn:hover,
        .generate-btn:hover {
          transform: translateY(-1px);
          border-color: rgba(34, 211, 238, 0.45);
        }

        button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
          transform: none !important;
        }

        .date-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        .date-grid label {
          display: grid;
          gap: 8px;
          color: #c7d2fe;
          font-size: 0.78rem;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.12em;
        }

        .date-grid input,
        .report-textarea {
          width: 100%;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(2, 6, 23, 0.58);
          color: #f8fafc;
          border-radius: 14px;
          padding: 13px 14px;
          outline: none;
          font: inherit;
        }

        .date-grid input:focus,
        .report-textarea:focus {
          border-color: rgba(34, 211, 238, 0.55);
          box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.12);
        }

        .generate-btn {
          width: 100%;
          margin-top: 16px;
          border-radius: 16px;
          padding: 14px 18px;
          background: linear-gradient(135deg, #4f46e5, #c026d3);
          box-shadow: 0 16px 35px rgba(79, 70, 229, 0.26);
        }

        .scope-note {
          margin-top: 14px;
          border: 1px solid rgba(34, 211, 238, 0.18);
          background: rgba(8, 47, 73, 0.2);
          border-radius: 16px;
          padding: 13px 14px;
          line-height: 1.5;
        }

        .summary-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .summary-tile {
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(15, 23, 42, 0.7);
          border-radius: 16px;
          padding: 16px;
          display: grid;
          gap: 6px;
        }

        .summary-tile span,
        .breakdown-list span {
          color: #93c5fd;
          font-size: 0.72rem;
          font-weight: 900;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .summary-tile strong {
          color: #f8fafc;
          font-size: 1.8rem;
          line-height: 1;
        }

        .summary-tile.danger {
          border-color: rgba(244, 63, 94, 0.3);
          background: rgba(76, 5, 25, 0.22);
        }

        .summary-tile.warning {
          border-color: rgba(251, 191, 36, 0.28);
          background: rgba(120, 53, 15, 0.16);
        }

        .empty-state {
          border: 1px dashed rgba(148, 163, 184, 0.24);
          border-radius: 18px;
          padding: 22px;
        }

        .breakdown-list {
          display: grid;
          gap: 10px;
          margin-top: 14px;
        }

        .breakdown-list div {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border: 1px solid rgba(148, 163, 184, 0.16);
          background: rgba(2, 6, 23, 0.34);
          border-radius: 14px;
          padding: 12px 14px;
        }

        .breakdown-list strong {
          color: #fef3c7;
          font-size: 1.1rem;
        }

        .report-message-stack {
          display: grid;
          gap: 10px;
        }

        .report-message {
          border-radius: 16px;
          padding: 14px 16px;
          font-weight: 800;
        }

        .report-message.error {
          color: #fecaca;
          border: 1px solid rgba(244, 63, 94, 0.35);
          background: rgba(76, 5, 25, 0.3);
        }

        .report-message.success {
          color: #bbf7d0;
          border: 1px solid rgba(16, 185, 129, 0.35);
          background: rgba(6, 78, 59, 0.25);
        }

        .output-head {
          align-items: center;
        }

        .copy-btn {
          min-width: 130px;
        }

        .report-textarea {
          min-height: 420px;
          line-height: 1.55;
          resize: vertical;
          white-space: pre-wrap;
        }

        .agent-table-wrap {
          overflow: auto;
          border: 1px solid rgba(148, 163, 184, 0.14);
          border-radius: 18px;
        }

        .agent-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 720px;
        }

        .agent-table th,
        .agent-table td {
          text-align: left;
          padding: 13px 14px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.12);
        }

        .agent-table th {
          color: #93c5fd;
          background: rgba(15, 23, 42, 0.66);
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-size: 0.72rem;
        }

        .agent-table td {
          color: #e5e7eb;
        }

        .agent-table tbody tr:last-child td {
          border-bottom: 0;
        }

        @media (max-width: 980px) {
          .overview-report-grid,
          .date-grid,
          .summary-grid {
            grid-template-columns: 1fr;
          }

          .overview-report-hero,
          .report-card-head,
          .output-head {
            flex-direction: column;
          }
        }
      `}</style>
    </section>
  );
}
