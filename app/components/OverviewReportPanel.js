"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const REPORT_DATE_PRESETS = [
  { key: "yesterday", label: "Yesterday" },
  { key: "past_week", label: "Past Week" },
  { key: "past_4_weeks", label: "Past 4 Weeks" },
  { key: "month_to_date", label: "Month to Date" },
];

const HEADING_LINES = new Set([
  "Analysis of Missed Review Approaches",
  "Client Sentiment Breakdown",
  "Overall Signal",
  "Dashboard Reference",
  "Agent Focus",
  "Required Action",
  "Note:",
]);

function CalendarIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 2V5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 2V5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M3.5 9H20.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="3.5" y="4.5" width="17" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

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
  return {
    startDate: addDaysToDateString(today, -6),
    endDate: today,
  };
}

function dateStringToLocalDate(dateString) {
  const match = String(dateString || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function normalizeToStartOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDateInput(date) {
  const local = normalizeToStartOfDay(date);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sameCalendarDay(a, b) {
  return a && b && formatDateInput(a) === formatDateInput(b);
}

function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthEnd(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function shiftMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return normalizeToStartOfDay(next);
}

function formatMonthTitle(date) {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function buildCalendarDays(monthDate) {
  const first = monthStart(monthDate);
  const last = monthEnd(monthDate);
  const startOffset = first.getDay();
  const days = [];

  for (let index = 0; index < startOffset; index += 1) {
    const date = new Date(first);
    date.setDate(first.getDate() - (startOffset - index));
    days.push({ date, muted: true });
  }

  for (let day = 1; day <= last.getDate(); day += 1) {
    days.push({ date: new Date(first.getFullYear(), first.getMonth(), day), muted: false });
  }

  while (days.length % 7 !== 0) {
    const lastDate = days[days.length - 1].date;
    const date = new Date(lastDate);
    date.setDate(lastDate.getDate() + 1);
    days.push({ date, muted: true });
  }

  return days;
}

function isDateInDraftRange(date, draftStart, draftEnd) {
  if (!draftStart || !draftEnd) return false;
  const value = normalizeToStartOfDay(date).getTime();
  return value >= normalizeToStartOfDay(draftStart).getTime() && value <= normalizeToStartOfDay(draftEnd).getTime();
}

function formatDateForDisplay(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateString || ""))) return "Select date";
  return dateString;
}

function formatReportRangeLabel(startDate, endDate) {
  if (!startDate && !endDate) return "Select a range";
  if (startDate && endDate && startDate === endDate) return startDate;
  return `${formatDateForDisplay(startDate)} to ${formatDateForDisplay(endDate)}`;
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

function CalendarMonth({ monthDate, draftStart, draftEnd, onSelectDate }) {
  const days = buildCalendarDays(monthDate);

  return (
    <div className="calendar-month-card">
      <h4>{formatMonthTitle(monthDate)}</h4>
      <div className="calendar-weekdays notranslate" translate="no">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <span key={day} className="notranslate" translate="no">{day}</span>
        ))}
      </div>
      <div className="calendar-day-grid">
        {days.map(({ date, muted }) => {
          const isStart = draftStart && sameCalendarDay(date, draftStart);
          const isEnd = draftEnd && sameCalendarDay(date, draftEnd);
          const inRange = isDateInDraftRange(date, draftStart, draftEnd);
          return (
            <button
              key={formatDateInput(date)}
              type="button"
              className={["calendar-day", muted ? "muted" : "", inRange ? "in-range" : "", isStart ? "range-start" : "", isEnd ? "range-end" : ""].filter(Boolean).join(" ")}
              onClick={() => onSelectDate(date)}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReportDateRangePicker({ startDate, endDate, selectedDatePreset, selectedPresetLabel, onApplyPreset, onApplyCustom, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(() => {
    const date = dateStringToLocalDate(startDate);
    return date ? normalizeToStartOfDay(date) : null;
  });
  const [draftEnd, setDraftEnd] = useState(() => {
    const date = dateStringToLocalDate(endDate);
    return date ? normalizeToStartOfDay(date) : null;
  });
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(dateStringToLocalDate(startDate) || new Date()));
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const nextStart = dateStringToLocalDate(startDate);
    const nextEnd = dateStringToLocalDate(endDate);
    setDraftStart(nextStart ? normalizeToStartOfDay(nextStart) : null);
    setDraftEnd(nextEnd ? normalizeToStartOfDay(nextEnd) : null);
    setVisibleMonth(monthStart(nextStart || new Date()));
  }, [open, startDate, endDate]);

  useEffect(() => {
    function handleOutside(event) {
      if (!ref.current) return;
      if (!ref.current.contains(event.target)) setOpen(false);
    }

    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  function selectDate(date) {
    const normalized = normalizeToStartOfDay(date);

    if (!draftStart || (draftStart && draftEnd)) {
      setDraftStart(normalized);
      setDraftEnd(null);
      return;
    }

    if (normalized < draftStart) {
      setDraftEnd(draftStart);
      setDraftStart(normalized);
      return;
    }

    setDraftEnd(normalized);
  }

  function applyCustomRange() {
    const safeStart = draftStart || draftEnd;
    const safeEnd = draftEnd || draftStart;
    if (!safeStart || !safeEnd) return;
    onApplyCustom(formatDateInput(safeStart), formatDateInput(safeEnd));
    setOpen(false);
  }

  function applyPreset(key) {
    onApplyPreset(key);
    setOpen(false);
  }

  const displayRange = startDate && endDate ? `${startDate} to ${endDate}` : "Select a range";
  const secondMonth = shiftMonths(visibleMonth, 1);

  return (
    <div className={open ? "run-date-range-picker open" : "run-date-range-picker"} ref={ref}>
      <label>
        <span className="label-with-tip">Date Range</span>
        <button type="button" className="run-date-button" onClick={() => !disabled && setOpen((prev) => !prev)} disabled={disabled}>
          <strong><CalendarIcon /> {selectedPresetLabel}</strong>
          <small>{displayRange}</small>
          <b>{open ? "Up" : "Down"}</b>
        </button>
      </label>

      {open ? (
        <div className="run-date-popover">
          <div className="date-popover-tabs">
            <div>
              <span>From</span>
              <strong>{draftStart ? formatDateInput(draftStart) : "Choose Start"}</strong>
            </div>
            <div className={draftEnd ? "active" : ""}>
              <span>To</span>
              <strong>{draftEnd ? formatDateInput(draftEnd) : "Choose End"}</strong>
            </div>
          </div>
          <div className="date-popover-body">
            <aside className="date-preset-column">
              {REPORT_DATE_PRESETS.map((item) => (
                <button key={item.key} type="button" className={item.key === selectedDatePreset ? "active" : ""} onClick={() => applyPreset(item.key)}>
                  {item.label}
                </button>
              ))}
            </aside>
            <div className="date-calendar-zone">
              <div className="calendar-nav-row">
                <button type="button" onClick={() => setVisibleMonth((prev) => shiftMonths(prev, -1))}>‹</button>
                <strong>{formatMonthTitle(visibleMonth)} - {formatMonthTitle(secondMonth)}</strong>
                <button type="button" onClick={() => setVisibleMonth((prev) => shiftMonths(prev, 1))}>›</button>
              </div>
              <div className="calendar-months-grid">
                <CalendarMonth monthDate={visibleMonth} draftStart={draftStart} draftEnd={draftEnd} onSelectDate={selectDate} />
                <CalendarMonth monthDate={secondMonth} draftStart={draftStart} draftEnd={draftEnd} onSelectDate={selectDate} />
              </div>
            </div>
          </div>
          <div className="date-popover-actions">
            <button type="button" className="ghost-btn" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="primary-btn light" onClick={applyCustomRange} disabled={!draftStart && !draftEnd}>Apply</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderReportLine(line, index) {
  const text = String(line || "");
  if (!text.trim()) return <div key={`blank-${index}`} className="report-preview-gap" />;

  const trimmed = text.trim();
  const isHeading = HEADING_LINES.has(trimmed) || (trimmed.length <= 34 && !trimmed.startsWith("•") && !trimmed.startsWith("◦") && !trimmed.includes("."));
  const isSubBullet = trimmed.startsWith("◦");
  const isBullet = trimmed.startsWith("•");
  const className = [
    "report-preview-line",
    isHeading ? "heading" : "",
    isBullet ? "bullet" : "",
    isSubBullet ? "sub-bullet" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return <p key={`line-${index}`} className={className}>{text}</p>;
}

export default function OverviewReportPanel({ session }) {
  const defaultRange = useMemo(() => getDefaultRange(), []);
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [selectedPreset, setSelectedPreset] = useState("past_week");
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
    setSelectedPreset(key);

    if (key === "yesterday") {
      setStartDate(yesterday);
      setEndDate(yesterday);
      return;
    }

    if (key === "past_week") {
      setStartDate(addDaysToDateString(today, -6));
      setEndDate(today);
      return;
    }

    if (key === "past_4_weeks") {
      setStartDate(addDaysToDateString(today, -27));
      setEndDate(today);
      return;
    }

    if (key === "month_to_date") {
      setStartDate(`${today.slice(0, 8)}01`);
      setEndDate(today);
    }
  }

  function applyCustomDateRange(nextStartDate, nextEndDate) {
    setSelectedPreset("custom");
    setStartDate(nextStartDate);
    setEndDate(nextEndDate);
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
      setSuccess("Plain-text report copied. You can paste it into ClickUp now.");
    } catch (_error) {
      setError("Copy failed. Select the report text manually and copy it.");
    } finally {
      setCopying(false);
    }
  }

  const breakdown = summary?.sentimentBreakdown || [];
  const sourceLabel = reportSource === "openai" ? "AI-written from verified platform data" : reportSource ? "Server fallback from verified platform data" : "Not generated yet";
  const activePresetLabel = REPORT_DATE_PRESETS.find((item) => item.key === selectedPreset)?.label || "Custom";
  const displayRangeLabel = formatReportRangeLabel(startDate, endDate);
  const previewLines = report ? report.split("\n") : [];

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

          <div className="report-command-control date-control-wide">
            <ReportDateRangePicker
              startDate={startDate}
              endDate={endDate}
              selectedDatePreset={selectedPreset}
              selectedPresetLabel={activePresetLabel}
              onApplyPreset={applyPreset}
              onApplyCustom={applyCustomDateRange}
              disabled={loading}
            />
          </div>

          <div className="filter-summary-grid">
            <div><span>Date Range</span><strong>{displayRangeLabel}</strong></div>
            <div><span>Scope</span><strong>CEx only</strong></div>
          </div>

          <button type="button" className="generate-btn" onClick={generateReport} disabled={loading || !session?.access_token}>
            {loading ? "Generating Report..." : "Generate Report"}
          </button>

          <div className="scope-note">
            <strong>Included scope:</strong> CEx team only · Missed Opportunity + Very Positive, Positive, and Slightly Positive client sentiment.
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
                <small>Stored CEx result rows in range</small>
              </div>
              <div className="summary-tile danger">
                <span>Missed Approaches</span>
                <strong>{formatNumber(summary.totalMissedPositive)}</strong>
                <small>Positive-side only</small>
              </div>
              <div className="summary-tile warning">
                <span>Miss Rate</span>
                <strong>{formatPercent(summary.missedPositiveRate)}</strong>
                <small>Of CEx audited conversations</small>
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

          {summary?.excludedNonCexMissedPositiveRows ? (
            <div className="data-quality-note">
              Excluded {formatNumber(summary.excludedNonCexMissedPositiveRows)} positive-side missed row(s) because they were not confirmed as CEx team records.
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
            <p>Review the wording once before pasting it into the ClickUp channel. The copied text is plain text, with no markdown asterisks.</p>
          </div>
          <button type="button" className="copy-btn" onClick={copyReport} disabled={!report || copying}>
            {copying ? "Copying..." : "Copy Report"}
          </button>
        </div>

        {report ? (
          <div className="report-preview-panel" aria-label="Report preview">
            {previewLines.map((line, index) => renderReportLine(line, index))}
          </div>
        ) : null}

        <label className="editable-report-label">
          <span>Plain copy text</span>
          <textarea
            className="report-textarea"
            value={report}
            onChange={(event) => setReport(event.target.value)}
            placeholder="Your generated plain-text ClickUp report will appear here."
            rows={18}
          />
        </label>
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

        .report-command-control {
          border: 1px solid rgba(255, 255, 255, 0.07);
          background: rgba(15, 23, 42, 0.56);
          border-radius: 16px;
          padding: 12px;
          position: relative;
          overflow: visible;
        }

        .run-date-range-picker {
          position: relative;
          z-index: 25;
        }

        .run-date-range-picker.open {
          z-index: 9000;
        }

        .run-date-range-picker label {
          display: grid;
          gap: 10px;
        }

        .label-with-tip {
          color: #93c5fd;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          font-size: 0.72rem;
          font-weight: 900;
        }

        .run-date-button {
          width: 100%;
          min-height: 56px;
          display: grid;
          grid-template-columns: max-content minmax(0, 1fr) max-content;
          align-items: center;
          gap: 10px;
          padding: 0 14px;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.09);
          background: rgba(2, 6, 23, 0.72);
          color: #f8fbff;
          font: inherit;
          text-align: left;
          cursor: pointer;
        }

        .run-date-button strong {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          min-width: max-content;
          flex-shrink: 0;
          overflow: visible;
          white-space: nowrap;
          font-size: 16px;
          font-weight: 900;
        }

        .run-date-button strong svg {
          flex: 0 0 17px;
          width: 17px;
          height: 17px;
        }

        .run-date-button small {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #a9b4d0;
          font-size: 14px;
          font-weight: 800;
        }

        .run-date-button b {
          color: #9fb2ee;
          font-size: 13px;
          font-weight: 900;
        }

        .run-date-popover {
          position: absolute;
          z-index: 9999;
          top: calc(100% + 12px);
          left: 0;
          width: min(940px, calc(100vw - 52px));
          border-radius: 24px;
          border: 1px solid rgba(96, 165, 250, 0.22);
          background: rgba(8, 13, 28, 0.98);
          box-shadow: 0 34px 90px rgba(0, 0, 0, 0.55);
          padding: 18px;
        }

        .date-popover-tabs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          padding-bottom: 12px;
          margin-bottom: 14px;
        }

        .date-popover-tabs div {
          padding: 10px 12px;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.035);
        }

        .date-popover-tabs div.active {
          border-bottom: 2px solid #22c55e;
        }

        .date-popover-tabs span,
        .date-popover-tabs strong {
          display: block;
        }

        .date-popover-tabs span {
          color: #8ea0d6;
          font-size: 13px;
          font-weight: 900;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 4px;
        }

        .date-popover-tabs strong {
          color: #f8fbff;
          font-size: 16px;
        }

        .date-popover-body {
          display: grid;
          grid-template-columns: 170px minmax(0, 1fr);
          gap: 16px;
        }

        .date-preset-column {
          display: grid;
          align-content: start;
          gap: 8px;
        }

        .date-preset-column button,
        .calendar-nav-row button {
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.04);
          color: #dbe7ff;
          min-height: 38px;
          padding: 0 10px;
          font: inherit;
          font-size: 14px;
          font-weight: 900;
          cursor: pointer;
        }

        .date-preset-column button.active,
        .date-preset-column button:hover,
        .calendar-nav-row button:hover {
          border-color: rgba(34, 211, 238, 0.24);
          background: rgba(14, 165, 233, 0.12);
        }

        .calendar-nav-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 14px;
        }

        .calendar-nav-row strong {
          color: #f8fbff;
          font-size: 17px;
        }

        .calendar-months-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
        }

        .calendar-month-card h4 {
          margin: 0 0 12px;
          color: #f8fbff;
          font-size: 17px;
        }

        .calendar-weekdays,
        .calendar-day-grid {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 4px;
        }

        .calendar-weekdays span {
          color: #8ea0d6;
          font-size: 12px;
          font-weight: 900;
          text-align: center;
          padding: 6px 0;
        }

        .calendar-day {
          min-height: 36px;
          border-radius: 10px;
          border: 1px solid transparent;
          background: transparent;
          color: #dbe7ff;
          font: inherit;
          font-size: 15px;
          font-weight: 850;
          cursor: pointer;
        }

        .calendar-day.muted {
          color: rgba(148, 163, 184, 0.36);
        }

        .calendar-day.in-range {
          background: rgba(34, 197, 94, 0.12);
        }

        .calendar-day.range-start,
        .calendar-day.range-end {
          color: #ffffff;
          border-color: rgba(34, 197, 94, 0.4);
          background: rgba(22, 163, 74, 0.72);
          box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.16), 0 0 20px rgba(34, 197, 94, 0.18);
        }

        .date-popover-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 16px;
        }

        .ghost-btn,
        .primary-btn.light,
        .copy-btn,
        .generate-btn {
          border: 1px solid rgba(148, 163, 184, 0.22);
          color: #f8fafc;
          font-weight: 900;
          cursor: pointer;
          transition: transform 160ms ease, border-color 160ms ease, opacity 160ms ease;
        }

        .ghost-btn,
        .copy-btn {
          background: rgba(15, 23, 42, 0.82);
          border-radius: 14px;
          padding: 11px 14px;
        }

        .primary-btn.light {
          border-radius: 14px;
          padding: 11px 14px;
          background: #f8fafc;
          color: #0f172a;
        }

        .copy-btn:hover,
        .generate-btn:hover,
        .ghost-btn:hover,
        .primary-btn.light:hover {
          transform: translateY(-1px);
          border-color: rgba(34, 211, 238, 0.45);
        }

        button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
          transform: none !important;
        }

        .filter-summary-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 12px;
        }

        .filter-summary-grid div {
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(15, 23, 42, 0.6);
          border-radius: 12px;
          padding: 10px 12px;
        }

        .filter-summary-grid span,
        .summary-tile span,
        .breakdown-list span {
          display: block;
          color: #93c5fd;
          font-size: 0.72rem;
          font-weight: 900;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .filter-summary-grid strong {
          display: block;
          margin-top: 4px;
          color: #f8fafc;
          font-size: 0.92rem;
          line-height: 1.35;
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

        .data-quality-note {
          margin-top: 14px;
          border: 1px solid rgba(251, 191, 36, 0.22);
          background: rgba(120, 53, 15, 0.14);
          color: #fde68a;
          border-radius: 14px;
          padding: 12px 14px;
          line-height: 1.45;
          font-weight: 800;
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

        .report-preview-panel {
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(2, 6, 23, 0.4);
          border-radius: 18px;
          padding: 18px;
          margin-bottom: 16px;
          color: #e5e7eb;
          line-height: 1.62;
        }

        .report-preview-line {
          margin: 0 0 8px;
        }

        .report-preview-line.heading {
          margin-top: 16px;
          margin-bottom: 8px;
          color: #f8fafc;
          font-weight: 950;
          font-size: 1.08rem;
        }

        .report-preview-line.heading:first-child {
          margin-top: 0;
          color: #facc15;
          text-align: center;
          font-size: 1.24rem;
        }

        .report-preview-line.bullet {
          padding-left: 10px;
        }

        .report-preview-line.sub-bullet {
          padding-left: 30px;
          color: #bfdbfe;
        }

        .report-preview-gap {
          height: 10px;
        }

        .editable-report-label {
          display: grid;
          gap: 8px;
          color: #93c5fd;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-size: 0.72rem;
          font-weight: 900;
        }

        .report-textarea {
          width: 100%;
          min-height: 320px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(2, 6, 23, 0.58);
          color: #f8fafc;
          border-radius: 14px;
          padding: 13px 14px;
          outline: none;
          font: inherit;
          line-height: 1.55;
          resize: vertical;
          white-space: pre-wrap;
          text-transform: none;
          letter-spacing: normal;
          font-size: 0.92rem;
          font-weight: 500;
        }

        .report-textarea:focus {
          border-color: rgba(34, 211, 238, 0.55);
          box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.12);
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
          .summary-grid,
          .filter-summary-grid,
          .date-popover-body,
          .calendar-months-grid {
            grid-template-columns: 1fr;
          }

          .overview-report-hero,
          .report-card-head,
          .output-head {
            flex-direction: column;
          }

          .run-date-popover {
            width: min(94vw, 520px);
          }
        }
      `}</style>

      <style jsx global>{`
        .overview-report-shell .run-date-range-picker {
          position: relative;
          z-index: 25;
        }

        .overview-report-shell .run-date-range-picker.open {
          z-index: 9000;
        }

        .overview-report-shell .run-date-range-picker label {
          display: grid;
          gap: 10px;
          margin: 0;
        }

        .overview-report-shell .label-with-tip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: #93c5fd;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          font-size: 0.72rem;
          font-weight: 900;
        }

        .overview-report-shell .run-date-button {
          width: 100%;
          min-height: 56px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          grid-template-rows: auto auto;
          align-items: center;
          gap: 3px 10px;
          padding: 10px 14px;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.09);
          background: rgba(2, 6, 23, 0.72);
          color: #f8fbff;
          font: inherit;
          text-align: left;
          cursor: pointer;
        }

        .overview-report-shell .run-date-button:hover {
          transform: translateY(-1px);
          border-color: rgba(34, 211, 238, 0.32);
        }

        .overview-report-shell .run-date-button strong {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          min-width: 0;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 16px;
          font-weight: 900;
          color: #ffffff;
          grid-column: 1;
          grid-row: 1;
        }

        .overview-report-shell .run-date-button strong svg {
          flex: 0 0 17px;
          width: 17px;
          height: 17px;
          color: #93c5fd;
        }

        .overview-report-shell .run-date-button small {
          display: block;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #a9b4d0;
          font-size: 13px;
          font-weight: 800;
          grid-column: 1;
          grid-row: 2;
        }

        .overview-report-shell .run-date-button b {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #9fb2ee;
          font-size: 12px;
          font-weight: 900;
          grid-column: 2;
          grid-row: 1 / span 2;
          min-width: 40px;
        }

        .overview-report-shell .run-date-popover {
          position: absolute;
          z-index: 9999;
          top: calc(100% + 12px);
          left: 0;
          width: min(900px, calc(100vw - 76px));
          border-radius: 24px;
          border: 1px solid rgba(96, 165, 250, 0.22);
          background: rgba(8, 13, 28, 0.98);
          box-shadow: 0 34px 90px rgba(0, 0, 0, 0.55);
          padding: 18px;
        }

        .overview-report-shell .date-popover-tabs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          padding-bottom: 12px;
          margin-bottom: 14px;
        }

        .overview-report-shell .date-popover-tabs div {
          padding: 10px 12px;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.035);
          border: 1px solid rgba(255, 255, 255, 0.06);
        }

        .overview-report-shell .date-popover-tabs div.active {
          border-color: rgba(34, 197, 94, 0.34);
          box-shadow: inset 0 -2px 0 rgba(34, 197, 94, 0.72);
        }

        .overview-report-shell .date-popover-tabs span,
        .overview-report-shell .date-popover-tabs strong {
          display: block;
        }

        .overview-report-shell .date-popover-tabs span {
          color: #8ea0d6;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 4px;
        }

        .overview-report-shell .date-popover-tabs strong {
          color: #f8fbff;
          font-size: 15px;
        }

        .overview-report-shell .date-popover-body {
          display: grid;
          grid-template-columns: 170px minmax(0, 1fr);
          gap: 16px;
        }

        .overview-report-shell .date-preset-column {
          display: grid;
          align-content: start;
          gap: 8px;
        }

        .overview-report-shell .date-preset-column button,
        .overview-report-shell .calendar-nav-row button {
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.04);
          color: #dbe7ff;
          min-height: 38px;
          padding: 0 10px;
          font: inherit;
          font-size: 14px;
          font-weight: 900;
          cursor: pointer;
        }

        .overview-report-shell .date-preset-column button.active,
        .overview-report-shell .date-preset-column button:hover,
        .overview-report-shell .calendar-nav-row button:hover {
          border-color: rgba(34, 211, 238, 0.24);
          background: rgba(14, 165, 233, 0.12);
        }

        .overview-report-shell .calendar-nav-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 14px;
        }

        .overview-report-shell .calendar-nav-row strong {
          color: #f8fbff;
          font-size: 16px;
          text-align: center;
        }

        .overview-report-shell .calendar-months-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
        }

        .overview-report-shell .calendar-month-card h4 {
          margin: 0 0 12px;
          color: #f8fbff;
          font-size: 16px;
        }

        .overview-report-shell .calendar-weekdays,
        .overview-report-shell .calendar-day-grid {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 4px;
        }

        .overview-report-shell .calendar-weekdays span {
          color: #8ea0d6;
          font-size: 11px;
          font-weight: 900;
          text-align: center;
          padding: 6px 0;
        }

        .overview-report-shell .calendar-day {
          min-height: 34px;
          border-radius: 10px;
          border: 1px solid transparent;
          background: transparent;
          color: #dbe7ff;
          font: inherit;
          font-size: 14px;
          font-weight: 850;
          cursor: pointer;
        }

        .overview-report-shell .calendar-day:hover {
          border-color: rgba(34, 211, 238, 0.2);
          background: rgba(14, 165, 233, 0.1);
        }

        .overview-report-shell .calendar-day.muted {
          color: rgba(148, 163, 184, 0.36);
        }

        .overview-report-shell .calendar-day.in-range {
          background: rgba(34, 197, 94, 0.12);
        }

        .overview-report-shell .calendar-day.range-start,
        .overview-report-shell .calendar-day.range-end {
          color: #ffffff;
          border-color: rgba(34, 197, 94, 0.4);
          background: rgba(22, 163, 74, 0.72);
          box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.16), 0 0 20px rgba(34, 197, 94, 0.18);
        }

        .overview-report-shell .date-popover-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 16px;
        }

        @media (max-width: 980px) {
          .overview-report-shell .date-popover-body,
          .overview-report-shell .calendar-months-grid {
            grid-template-columns: 1fr;
          }

          .overview-report-shell .run-date-popover {
            width: min(94vw, 520px);
          }
        }

        /* ── LIGHT MODE ── */
        html[data-theme="light"] .overview-report-hero,
        html[data-theme="light"] .overview-report-card {
          background: rgba(255,255,255,0.93) !important;
          border-color: rgba(0,0,0,0.08) !important;
          box-shadow: 0 4px 24px rgba(0,0,0,0.07) !important;
        }
        html[data-theme="light"] .overview-report-hero::before,
        html[data-theme="light"] .overview-report-hero::after { display: none !important; }
        html[data-theme="light"] .overview-report-shell h2 { color: #0f172a !important; }
        html[data-theme="light"] .overview-report-shell h3 { color: #0f172a !important; }
        html[data-theme="light"] .overview-report-shell p { color: #475569 !important; }
        html[data-theme="light"] .overview-report-shell .eyebrow { color: #64748b !important; }
        html[data-theme="light"] .overview-report-shell strong { color: #0f172a !important; }
        html[data-theme="light"] .overview-report-shell small { color: #64748b !important; }
        html[data-theme="light"] .report-command-control { background: rgba(248,250,252,0.9) !important; border-color: rgba(0,0,0,0.08) !important; }
        html[data-theme="light"] .report-command-control label { color: #64748b !important; }
        html[data-theme="light"] .ghost-btn,
        html[data-theme="light"] .copy-btn { background: rgba(0,0,0,0.05) !important; border-color: rgba(0,0,0,0.1) !important; color: #1e293b !important; }
        html[data-theme="light"] .filter-summary-grid div { background: rgba(248,250,252,0.9) !important; border-color: rgba(0,0,0,0.08) !important; color: #475569 !important; }
        html[data-theme="light"] .filter-summary-grid strong { color: #0f172a !important; }
        html[data-theme="light"] .summary-tile { background: rgba(255,255,255,0.93) !important; border-color: rgba(0,0,0,0.08) !important; color: #1e293b !important; }
        html[data-theme="light"] .summary-tile strong { color: #0f172a !important; }
        html[data-theme="light"] .summary-tile small { color: #64748b !important; }
        html[data-theme="light"] .agent-table th { background: rgba(248,250,252,0.98) !important; color: #64748b !important; border-bottom-color: rgba(0,0,0,0.08) !important; }
        html[data-theme="light"] .agent-table td { color: #1e293b !important; border-bottom-color: rgba(0,0,0,0.05) !important; }
        html[data-theme="light"] .overview-report-shell input,
        html[data-theme="light"] .overview-report-shell select,
        html[data-theme="light"] .overview-report-shell textarea { background: rgba(248,250,252,0.96) !important; border-color: rgba(0,0,0,0.1) !important; color: #1e293b !important; color-scheme: light !important; }
        html[data-theme="light"] .overview-report-shell .run-date-popover { background: #ffffff !important; border-color: rgba(0,0,0,0.1) !important; box-shadow: 0 20px 60px rgba(0,0,0,0.14) !important; }
        html[data-theme="light"] .overview-report-shell .run-multi-button,
        html[data-theme="light"] .overview-report-shell .admin-date-button { background: rgba(248,250,252,0.96) !important; border-color: rgba(0,0,0,0.1) !important; color: #1e293b !important; }
        html[data-theme="light"] .overview-report-shell .date-popover-tabs div { background: rgba(0,0,0,0.03) !important; }
        html[data-theme="light"] .overview-report-shell .date-popover-tabs span { color: #64748b !important; }
        html[data-theme="light"] .overview-report-shell .date-popover-tabs strong { color: #0f172a !important; }
        html[data-theme="light"] .overview-report-shell .calendar-nav-row button { color: #1e293b !important; background: rgba(0,0,0,0.04) !important; }
        html[data-theme="light"] .overview-report-shell .calendar-nav-row strong { color: #0f172a !important; }
        html[data-theme="light"] .overview-report-shell .calendar-day { color: #1e293b !important; background: transparent !important; }
        html[data-theme="light"] .overview-report-shell .calendar-day.muted { color: rgba(0,0,0,0.3) !important; }
        html[data-theme="light"] .overview-report-shell .calendar-day.range-start,
        html[data-theme="light"] .overview-report-shell .calendar-day.range-end { color: #ffffff !important; }

      `}</style>
    </section>
  );
}
