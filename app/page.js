"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";

const INTERCOM_BASE_URL =
  "https://app.intercom.com/a/inbox/aphmhtyj/inbox/conversation";

const PAGE_SIZE = 1000;
const MAX_DASHBOARD_ROWS = 50000;

const REVIEW_SENTIMENT_ORDER = [
  "Highly Likely Positive Review",
  "Likely Positive Review",
  "Missed Opportunity",
  "Negative Outcome - No Review Request",
  "Likely Negative Review",
  "Highly Likely Negative Review",
];

const CLIENT_SENTIMENT_ORDER = [
  "Very Positive",
  "Positive",
  "Slightly Positive",
  "Neutral",
  "Slightly Negative",
  "Negative",
  "Very Negative",
];

const RESOLUTION_ORDER = ["Resolved", "Pending", "Unclear", "Unresolved"];

const RANGE_OPTIONS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "past_week", label: "Past week" },
  { key: "past_30_days", label: "Past 30 days" },
  { key: "month_to_date", label: "Month to date" },
  { key: "past_4_weeks", label: "Past 4 weeks" },
  { key: "past_12_weeks", label: "Past 12 weeks" },
  { key: "year_to_date", label: "Year to date" },
  { key: "past_6_months", label: "Past 6 months" },
  { key: "past_12_months", label: "Past 12 months" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];

const WEEKLY_METRIC_OPTIONS = [
  { key: "total", label: "Total conversations" },
  { key: "missed", label: "Missed opportunities" },
  { key: "risk", label: "Negative risk" },
  { key: "veryPositive", label: "Very positive" },
  { key: "unresolved", label: "Unresolved" },
  { key: "resolutionRate", label: "Resolution rate" },
  { key: "positiveRate", label: "Positive review rate" },
];

function normalizeText(value, fallback = "-") {
  const text = String(value || "").trim();
  return text || fallback;
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfYear(date) {
  return new Date(date.getFullYear(), 0, 1);
}

function formatInputDate(date) {
  if (!date) return "";
  const local = startOfDay(date);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseInputDate(value, end = false) {
  if (!value) return null;
  const date = toDate(`${value}T00:00:00`);
  if (!date) return null;
  return end ? endOfDay(date) : startOfDay(date);
}

function formatDateShort(date) {
  if (!date) return "-";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return "-";

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "0.0%";
  return `${value.toFixed(1)}%`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function getAnalyticsDate(row) {
  return row?.replied_at || row?.created_at || null;
}

function getPresetRange(key) {
  const today = startOfDay(new Date());
  const yesterday = startOfDay(addDays(today, -1));

  if (key === "today") {
    return { start: startOfDay(today), end: endOfDay(today) };
  }

  if (key === "yesterday") {
    return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
  }

  if (key === "past_week") {
    return { start: startOfDay(addDays(yesterday, -6)), end: endOfDay(yesterday) };
  }

  if (key === "past_30_days") {
    return { start: startOfDay(addDays(yesterday, -29)), end: endOfDay(yesterday) };
  }

  if (key === "month_to_date") {
    return { start: startOfDay(startOfMonth(today)), end: endOfDay(today) };
  }

  if (key === "past_4_weeks") {
    return { start: startOfDay(addDays(yesterday, -27)), end: endOfDay(yesterday) };
  }

  if (key === "past_12_weeks") {
    return { start: startOfDay(addDays(yesterday, -83)), end: endOfDay(yesterday) };
  }

  if (key === "year_to_date") {
    return { start: startOfDay(startOfYear(today)), end: endOfDay(today) };
  }

  if (key === "past_6_months") {
    return { start: startOfDay(addMonths(yesterday, -6)), end: endOfDay(yesterday) };
  }

  if (key === "past_12_months") {
    return { start: startOfDay(addMonths(yesterday, -12)), end: endOfDay(yesterday) };
  }

  return { start: null, end: null };
}

function buildDateRange(filters) {
  if (filters.rangePreset === "all") {
    return { start: null, end: null };
  }

  if (filters.rangePreset === "custom") {
    return {
      start: parseInputDate(filters.startDate, false),
      end: parseInputDate(filters.endDate, true),
    };
  }

  return getPresetRange(filters.rangePreset);
}

function getRangeDisplay(filters) {
  const option = RANGE_OPTIONS.find((item) => item.key === filters.rangePreset);
  const label = option?.label || "Custom";
  const { start, end } = buildDateRange(filters);

  if (filters.rangePreset === "all") return "All time";
  if (!start && !end) return label;

  return `${formatDateShort(start)} - ${formatDateShort(end)}`;
}

function deriveResultType(reviewSentiment) {
  const value = String(reviewSentiment || "");

  if (value === "Missed Opportunity") return "Opportunity";

  if (
    value === "Likely Positive Review" ||
    value === "Highly Likely Positive Review"
  ) {
    return "Positive";
  }

  if (
    value === "Likely Negative Review" ||
    value === "Highly Likely Negative Review" ||
    value === "Negative Outcome - No Review Request"
  ) {
    return "Risk";
  }

  return "Other";
}

function conversationUrl(conversationId) {
  const id = String(conversationId || "").trim();
  return id ? `${INTERCOM_BASE_URL}/${id}` : "#";
}

function dedupeLatestByConversation(rows) {
  const byConversation = new Map();

  for (const row of rows || []) {
    const key = String(row?.conversation_id || "").trim();
    if (!key) continue;

    const existing = byConversation.get(key);
    const currentTs = toDate(row?.created_at)?.getTime() || 0;
    const existingTs = toDate(existing?.created_at)?.getTime() || 0;

    if (!existing || currentTs > existingTs) {
      byConversation.set(key, row);
    }
  }

  return Array.from(byConversation.values()).sort((a, b) => {
    const aDate = toDate(getAnalyticsDate(a))?.getTime() || 0;
    const bDate = toDate(getAnalyticsDate(b))?.getTime() || 0;
    return bDate - aDate;
  });
}

function uniqueValues(rows, key) {
  return Array.from(
    new Set(
      (rows || [])
        .map((row) => String(row?.[key] || "").trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
}

function isMapped(row) {
  return Boolean(row?.employee_name || row?.employee_match_status === "mapped");
}

function filterRows(rows, filters) {
  const { start, end } = buildDateRange(filters);

  return (rows || []).filter((row) => {
    const analyticsDate = toDate(getAnalyticsDate(row));

    if ((start || end) && !analyticsDate) return false;
    if (start && analyticsDate < start) return false;
    if (end && analyticsDate > end) return false;

    if (filters.team !== "all" && row?.team_name !== filters.team) return false;
    if (filters.employee !== "all" && row?.employee_name !== filters.employee) return false;

    if (
      filters.reviewSentiment !== "all" &&
      row?.review_sentiment !== filters.reviewSentiment
    ) {
      return false;
    }

    if (
      filters.clientSentiment !== "all" &&
      row?.client_sentiment !== filters.clientSentiment
    ) {
      return false;
    }

    if (
      filters.resolutionStatus !== "all" &&
      row?.resolution_status !== filters.resolutionStatus
    ) {
      return false;
    }

    if (
      filters.resultType !== "all" &&
      deriveResultType(row?.review_sentiment) !== filters.resultType
    ) {
      return false;
    }

    if (filters.mappingStatus === "mapped" && !isMapped(row)) return false;
    if (filters.mappingStatus === "unmapped" && isMapped(row)) return false;

    if (filters.cexOnly && row?.team_name !== "CEx") return false;

    return true;
  });
}

function countRowsBy(rows, getter, preferredOrder = []) {
  const map = new Map();

  for (const row of rows || []) {
    const label = normalizeText(getter(row), "Unknown");
    const current = map.get(label) || { label, count: 0, rows: [] };

    current.count += 1;
    current.rows.push(row);

    map.set(label, current);
  }

  const orderMap = new Map(preferredOrder.map((item, index) => [item, index]));

  return Array.from(map.values()).sort((a, b) => {
    const aIndex = orderMap.has(a.label) ? orderMap.get(a.label) : 9999;
    const bIndex = orderMap.has(b.label) ? orderMap.get(b.label) : 9999;

    if (aIndex !== bIndex) return aIndex - bIndex;
    if (b.count !== a.count) return b.count - a.count;

    return a.label.localeCompare(b.label);
  });
}

function buildPieSegments(entries, palette) {
  const total = entries.reduce((sum, item) => sum + item.count, 0) || 1;
  let cumulative = 0;

  return entries.map((entry, index) => {
    const percent = (entry.count / total) * 100;
    const start = cumulative;
    cumulative += percent;

    return {
      ...entry,
      percent,
      color: palette[index % palette.length],
      start,
      end: cumulative,
    };
  });
}

function buildConicGradient(segments) {
  if (!segments.length) return "conic-gradient(#1f2937 0 100%)";

  return `conic-gradient(${segments
    .map((segment) => `${segment.color} ${segment.start.toFixed(2)}% ${segment.end.toFixed(2)}%`)
    .join(", ")})`;
}

function resultTypeColor(label) {
  if (label === "Opportunity") return "#f59e0b";
  if (label === "Positive") return "#10b981";
  if (label === "Risk") return "#ef4444";
  return "#8b5cf6";
}

function createGlobalFilters() {
  const range = getPresetRange("past_30_days");

  return {
    rangePreset: "past_30_days",
    startDate: formatInputDate(range.start),
    endDate: formatInputDate(range.end),
    team: "all",
    employee: "all",
    reviewSentiment: "all",
    clientSentiment: "all",
    resolutionStatus: "all",
    resultType: "all",
    mappingStatus: "all",
    cexOnly: true,
  };
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(rows, filename = "dashboard-drilldown.csv") {
  const columns = [
    ["conversation_id", "Conversation ID"],
    ["replied_at", "Conversation Date"],
    ["created_at", "Saved At"],
    ["agent_name", "Intercom Agent"],
    ["employee_name", "Employee"],
    ["employee_email", "Employee Email"],
    ["team_name", "Team"],
    ["client_email", "Client Email"],
    ["csat_score", "CSAT"],
    ["review_sentiment", "Review Sentiment"],
    ["client_sentiment", "Client Sentiment"],
    ["resolution_status", "Resolution Status"],
    ["ai_verdict", "AI Verdict"],
    ["error", "Error"],
  ];

  const header = columns.map(([, label]) => escapeCsv(label)).join(",");
  const body = (rows || [])
    .map((row) => columns.map(([key]) => escapeCsv(row?.[key] ?? "")).join(","))
    .join("\n");

  const csv = `${header}\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}

function buildPeriodsForRange(rows, filters) {
  const range = buildDateRange(filters);
  let start = range.start;
  let end = range.end;

  const datedRows = (rows || [])
    .map((row) => toDate(getAnalyticsDate(row)))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());

  if (!end) {
    end = datedRows[datedRows.length - 1] ? endOfDay(datedRows[datedRows.length - 1]) : endOfDay(new Date());
  }

  if (!start) {
    start = datedRows.length
      ? startOfDay(datedRows[Math.max(0, datedRows.length - 1)])
      : startOfDay(addDays(end, -27));

    start = startOfDay(addDays(end, -83));
  }

  const maxDays = 120;
  const minStart = startOfDay(addDays(end, -maxDays + 1));
  if (start < minStart) start = minStart;

  const periods = [];
  let cursor = startOfDay(start);
  const finalEnd = endOfDay(end);

  while (cursor <= finalEnd) {
    const periodStart = startOfDay(cursor);
    const periodEnd = endOfDay(addDays(cursor, 6));
    const safeEnd = periodEnd > finalEnd ? finalEnd : periodEnd;

    periods.push({
      key: `${formatInputDate(periodStart)}_${formatInputDate(safeEnd)}`,
      start: periodStart,
      end: safeEnd,
      label: formatPeriodLabel(periodStart, safeEnd),
    });

    cursor = addDays(cursor, 7);
  }

  return periods;
}

function formatPeriodLabel(start, end) {
  if (!start || !end) return "-";

  const sameMonth =
    start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();

  if (sameMonth) {
    return `${start.toLocaleDateString(undefined, {
      month: "short",
    })} ${start.getDate()}-${end.getDate()}`;
  }

  return `${start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} - ${end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}

function rowsInPeriod(rows, period) {
  return (rows || []).filter((row) => {
    const date = toDate(getAnalyticsDate(row));
    if (!date) return false;
    return date >= period.start && date <= period.end;
  });
}

function metricRows(rows, metric) {
  if (metric === "missed") {
    return rows.filter((row) => row.review_sentiment === "Missed Opportunity");
  }

  if (metric === "risk") {
    return rows.filter((row) => deriveResultType(row.review_sentiment) === "Risk");
  }

  if (metric === "veryPositive") {
    return rows.filter((row) => row.client_sentiment === "Very Positive");
  }

  if (metric === "unresolved") {
    return rows.filter((row) => row.resolution_status === "Unresolved");
  }

  if (metric === "resolutionRate") {
    return rows.filter((row) => row.resolution_status === "Resolved");
  }

  if (metric === "positiveRate") {
    return rows.filter(
      (row) =>
        row.review_sentiment === "Likely Positive Review" ||
        row.review_sentiment === "Highly Likely Positive Review"
    );
  }

  return rows;
}

function metricValue(rows, metric) {
  if (metric === "resolutionRate" || metric === "positiveRate") {
    return rows.length ? (metricRows(rows, metric).length / rows.length) * 100 : 0;
  }

  return metricRows(rows, metric).length;
}

function formatMetricValue(rows, metric) {
  const value = metricValue(rows, metric);

  if (metric === "resolutionRate" || metric === "positiveRate") {
    return rows.length ? formatPercent(value) : "-";
  }

  return value ? formatNumber(value) : "-";
}

function buildAgentWeeklyRows(rows, filters, metric) {
  const periods = buildPeriodsForRange(rows, filters);
  const employees = new Map();

  for (const row of rows || []) {
    const employee = normalizeText(row?.employee_name, "Unmapped");
    const current = employees.get(employee) || {
      employee,
      team: row?.team_name || "-",
      totalRows: [],
      periods: [],
    };

    current.totalRows.push(row);
    if (!current.team || current.team === "-") current.team = row?.team_name || "-";

    employees.set(employee, current);
  }

  const tableRows = Array.from(employees.values()).map((employeeRow) => ({
    ...employeeRow,
    periods: periods.map((period) => {
      const periodRows = rowsInPeriod(employeeRow.totalRows, period);
      return {
        ...period,
        rows: periodRows,
        value: metricValue(periodRows, metric),
        label: formatMetricValue(periodRows, metric),
      };
    }),
    totalValue: metricValue(employeeRow.totalRows, metric),
  }));

  tableRows.sort((a, b) => {
    if (b.totalRows.length !== a.totalRows.length) return b.totalRows.length - a.totalRows.length;
    return a.employee.localeCompare(b.employee);
  });

  return { periods, tableRows };
}

function buildLeaderboard(rows) {
  const map = new Map();

  for (const row of rows || []) {
    const employee = normalizeText(row?.employee_name, "Unmapped");
    const current = map.get(employee) || {
      employee,
      team: row?.team_name || "-",
      handled: 0,
      missed: 0,
      veryPositive: 0,
      unresolved: 0,
      positiveReview: 0,
      risk: 0,
      rows: [],
    };

    current.handled += 1;

    if (row?.review_sentiment === "Missed Opportunity") current.missed += 1;
    if (row?.client_sentiment === "Very Positive") current.veryPositive += 1;
    if (row?.resolution_status === "Unresolved") current.unresolved += 1;
    if (deriveResultType(row?.review_sentiment) === "Risk") current.risk += 1;

    if (
      row?.review_sentiment === "Likely Positive Review" ||
      row?.review_sentiment === "Highly Likely Positive Review"
    ) {
      current.positiveReview += 1;
    }

    current.rows.push(row);

    map.set(employee, current);
  }

  return Array.from(map.values())
    .map((item) => ({
      ...item,
      missedRate: item.handled ? (item.missed / item.handled) * 100 : 0,
      positiveRate: item.handled ? (item.positiveReview / item.handled) * 100 : 0,
      riskRate: item.handled ? (item.risk / item.handled) * 100 : 0,
      resolutionRate: item.handled ? ((item.handled - item.unresolved) / item.handled) * 100 : 0,
    }))
    .sort((a, b) => {
      if (b.handled !== a.handled) return b.handled - a.handled;
      return a.employee.localeCompare(b.employee);
    });
}

function DateRangePicker({ filters, setFilters }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(event.target)) setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function applyPreset(key) {
    if (key === "custom") {
      setFilters((prev) => ({ ...prev, rangePreset: "custom" }));
      return;
    }

    if (key === "all") {
      setFilters((prev) => ({
        ...prev,
        rangePreset: "all",
        startDate: "",
        endDate: "",
      }));
      setOpen(false);
      return;
    }

    const range = getPresetRange(key);

    setFilters((prev) => ({
      ...prev,
      rangePreset: key,
      startDate: formatInputDate(range.start),
      endDate: formatInputDate(range.end),
    }));

    setOpen(false);
  }

  function applyCustom() {
    setFilters((prev) => ({
      ...prev,
      rangePreset: "custom",
    }));
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="date-picker-wrap">
      <button type="button" className="date-picker-button" onClick={() => setOpen((prev) => !prev)}>
        <span>Calendar</span>
        <strong>{getRangeDisplay(filters)}</strong>
        <b>{open ? "Up" : "Down"}</b>
      </button>

      {open ? (
        <div className="date-picker-popover">
          <div className="date-preset-list">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={filters.rangePreset === option.key ? "active" : ""}
                onClick={() => applyPreset(option.key)}
              >
                <span>{option.label}</span>
                {filters.rangePreset === option.key ? <b>Selected</b> : null}
              </button>
            ))}
          </div>

          <div className="custom-range-panel">
            <div>
              <small>Custom date range</small>
              <strong>{getRangeDisplay({ ...filters, rangePreset: "custom" })}</strong>
            </div>

            <div className="custom-range-grid">
              <label>
                <span>From</span>
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      startDate: event.target.value,
                      rangePreset: "custom",
                    }))
                  }
                />
              </label>

              <label>
                <span>To</span>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      endDate: event.target.value,
                      rangePreset: "custom",
                    }))
                  }
                />
              </label>
            </div>

            <div className="custom-actions">
              <button type="button" className="secondary-btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className="light-btn" onClick={applyCustom}>
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FilterBar({
  filters,
  setFilters,
  teams,
  employees,
  reviewSentiments,
  clientSentiments,
  resolutionStatuses,
}) {
  function update(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <section className="filter-panel">
      <div className="filter-top-row">
        <DateRangePicker filters={filters} setFilters={setFilters} />

        <label>
          <span>Team</span>
          <select value={filters.team} onChange={(event) => update("team", event.target.value)}>
            <option value="all">All Teams</option>
            {teams.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Employee</span>
          <select value={filters.employee} onChange={(event) => update("employee", event.target.value)}>
            <option value="all">All Employees</option>
            {employees.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="cex-check">
          <input
            type="checkbox"
            checked={filters.cexOnly}
            onChange={(event) => update("cexOnly", event.target.checked)}
          />
          CEx only
        </label>
      </div>

      <div className="filter-bottom-row">
        <label>
          <span>Review</span>
          <select value={filters.reviewSentiment} onChange={(event) => update("reviewSentiment", event.target.value)}>
            <option value="all">All Review</option>
            {reviewSentiments.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Client</span>
          <select value={filters.clientSentiment} onChange={(event) => update("clientSentiment", event.target.value)}>
            <option value="all">All Client</option>
            {clientSentiments.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Resolution</span>
          <select value={filters.resolutionStatus} onChange={(event) => update("resolutionStatus", event.target.value)}>
            <option value="all">All Resolution</option>
            {resolutionStatuses.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Type</span>
          <select value={filters.resultType} onChange={(event) => update("resultType", event.target.value)}>
            <option value="all">All Types</option>
            <option value="Positive">Positive</option>
            <option value="Opportunity">Opportunity</option>
            <option value="Risk">Risk</option>
            <option value="Other">Other</option>
          </select>
        </label>

        <label>
          <span>Mapping</span>
          <select value={filters.mappingStatus} onChange={(event) => update("mappingStatus", event.target.value)}>
            <option value="all">All Mapping</option>
            <option value="mapped">Mapped</option>
            <option value="unmapped">Unmapped</option>
          </select>
        </label>

        <button type="button" className="primary-btn" onClick={() => setFilters(createGlobalFilters())}>
          Reset filters
        </button>
      </div>
    </section>
  );
}

function KPIStat({ label, value, accent, onClick }) {
  return (
    <button type="button" className="kpi-card" onClick={onClick} style={{ "--accent": accent }}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>Drill in</small>
    </button>
  );
}

function ChartCard({ title, subtitle, onDrill, children }) {
  return (
    <article className="chart-card">
      <div className="chart-head">
        <div>
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>

        {onDrill ? (
          <button type="button" className="drill-btn card-action" onClick={onDrill}>
            Drill in
          </button>
        ) : null}
      </div>

      {children}
    </article>
  );
}

function HorizontalBarChart({ entries, total, onSelect, kind = "review" }) {
  const max = Math.max(...entries.map((item) => item.count), 1);

  if (!entries.length) {
    return <div className="empty-box">No data for this section.</div>;
  }

  return (
    <div className="bar-list">
      {entries.map((entry) => {
        const percent = total ? (entry.count / total) * 100 : 0;
        const width = Math.max((entry.count / max) * 100, 5);
        const color =
          kind === "resolution"
            ? entry.label === "Resolved"
              ? "linear-gradient(90deg, #10b981, #06b6d4)"
              : entry.label === "Pending"
              ? "linear-gradient(90deg, #f59e0b, #f97316)"
              : entry.label === "Unclear"
              ? "linear-gradient(90deg, #8b5cf6, #ec4899)"
              : "linear-gradient(90deg, #ef4444, #7f1d1d)"
            : resultTypeColor(deriveResultType(entry.label));

        return (
          <button key={entry.label} type="button" className="bar-item" onClick={() => onSelect(entry)}>
            <div className="bar-line">
              <strong title={entry.label}>{entry.label}</strong>
              <span>
                {formatNumber(entry.count)} · {formatPercent(percent)}
              </span>
            </div>

            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${width}%`, background: color }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DonutChart({ entries, total, onSelect }) {
  const palette = ["#8b5cf6", "#ec4899", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#6366f1"];
  const segments = buildPieSegments(entries, palette);
  const gradient = buildConicGradient(segments);

  return (
    <div className="donut-layout">
      <div className="donut" style={{ background: gradient }}>
        <div className="donut-hole">
          <strong>{formatNumber(total)}</strong>
          <span>Total</span>
        </div>
      </div>

      <div className="donut-legend">
        {segments.length ? (
          segments.map((segment) => (
            <button key={segment.label} type="button" onClick={() => onSelect(segment)}>
              <i style={{ background: segment.color }} />
              <strong title={segment.label}>{segment.label}</strong>
              <span>
                {formatNumber(segment.count)} · {formatPercent(segment.percent)}
              </span>
            </button>
          ))
        ) : (
          <div className="empty-box compact">No data.</div>
        )}
      </div>
    </div>
  );
}

function DetailModal({ open, onClose, title, value, rows }) {
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState("all");
  const [employee, setEmployee] = useState("all");
  const [review, setReview] = useState("all");
  const [client, setClient] = useState("all");
  const [resolution, setResolution] = useState("all");

  useEffect(() => {
    if (!open) return;

    setQuery("");
    setTeam("all");
    setEmployee("all");
    setReview("all");
    setClient("all");
    setResolution("all");
  }, [open, title, value]);

  const teams = useMemo(() => uniqueValues(rows, "team_name"), [rows]);
  const employees = useMemo(() => uniqueValues(rows, "employee_name"), [rows]);
  const reviews = useMemo(() => uniqueValues(rows, "review_sentiment"), [rows]);
  const clients = useMemo(() => uniqueValues(rows, "client_sentiment"), [rows]);
  const resolutions = useMemo(() => uniqueValues(rows, "resolution_status"), [rows]);

  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase();

    return (rows || []).filter((row) => {
      if (team !== "all" && row?.team_name !== team) return false;
      if (employee !== "all" && row?.employee_name !== employee) return false;
      if (review !== "all" && row?.review_sentiment !== review) return false;
      if (client !== "all" && row?.client_sentiment !== client) return false;
      if (resolution !== "all" && row?.resolution_status !== resolution) return false;

      if (search) {
        const haystack = [
          row?.conversation_id,
          row?.agent_name,
          row?.employee_name,
          row?.employee_email,
          row?.team_name,
          row?.client_email,
          row?.review_sentiment,
          row?.client_sentiment,
          row?.resolution_status,
          row?.ai_verdict,
          row?.error,
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(search)) return false;
      }

      return true;
    });
  }, [rows, query, team, employee, review, client, resolution]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="drill-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p>Chart drill-in</p>
            <h2>{title}</h2>
            <span>
              {value} · {formatNumber(filteredRows.length)} of {formatNumber(rows.length)} conversation(s)
            </span>
          </div>

          <div className="modal-actions">
            <button type="button" className="secondary-btn" onClick={() => downloadCsv(filteredRows, "dashboard-drilldown.csv")}>
              Export CSV
            </button>
            <button type="button" className="light-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="modal-filter-grid">
          <label>
            <span>Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Conversation, agent, employee, client, verdict"
            />
          </label>

          <label>
            <span>Team</span>
            <select value={team} onChange={(event) => setTeam(event.target.value)}>
              <option value="all">All Teams</option>
              {teams.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Employee</span>
            <select value={employee} onChange={(event) => setEmployee(event.target.value)}>
              <option value="all">All Employees</option>
              {employees.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Review</span>
            <select value={review} onChange={(event) => setReview(event.target.value)}>
              <option value="all">All Review</option>
              {reviews.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Client</span>
            <select value={client} onChange={(event) => setClient(event.target.value)}>
              <option value="all">All Client</option>
              {clients.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Resolution</span>
            <select value={resolution} onChange={(event) => setResolution(event.target.value)}>
              <option value="all">All Resolution</option>
              {resolutions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="modal-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Conversation</th>
                <th>Employee</th>
                <th>Team</th>
                <th>Review</th>
                <th>Client</th>
                <th>Resolution</th>
                <th>Date</th>
                <th>Open</th>
              </tr>
            </thead>

            <tbody>
              {filteredRows.slice(0, 500).map((row, index) => (
                <tr key={`${row.conversation_id}-${row.created_at}-${index}`}>
                  <td>
                    <strong>{row.conversation_id || "-"}</strong>
                    <small>
                      {row.agent_name || "Unassigned"}
                      <br />
                      {row.client_email || "-"}
                    </small>
                  </td>
                  <td>{row.employee_name || "Unmapped"}</td>
                  <td>{row.team_name || "-"}</td>
                  <td>{row.review_sentiment || "-"}</td>
                  <td>{row.client_sentiment || "-"}</td>
                  <td>{row.resolution_status || "-"}</td>
                  <td>{formatDateTime(row.replied_at || row.created_at)}</td>
                  <td>
                    <a href={conversationUrl(row.conversation_id)} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredRows.length > 500 ? (
            <div className="table-note">
              Showing first 500 rows. Use Export CSV for the full filtered drill-in.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function WeeklyAgentTable({ rows, filters, metric, setMetric, onOpenDetail }) {
  const { periods, tableRows } = useMemo(
    () => buildAgentWeeklyRows(rows, filters, metric),
    [rows, filters, metric]
  );

  const metricLabel = WEEKLY_METRIC_OPTIONS.find((item) => item.key === metric)?.label || "Metric";

  return (
    <section className="panel weekly-panel">
      <div className="section-title-row">
        <div>
          <p>Weekly performance table</p>
          <h2>Agent week-by-week view</h2>
          <span>Click an employee or a weekly cell to drill into the underlying conversations.</span>
        </div>

        <div className="weekly-controls">
          <label>
            <span>Metric</span>
            <select value={metric} onChange={(event) => setMetric(event.target.value)}>
              {WEEKLY_METRIC_OPTIONS.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <button type="button" className="secondary-btn" onClick={() => downloadWeeklyCsv(tableRows, periods, metric, metricLabel)}>
            Export table CSV
          </button>
        </div>
      </div>

      <div className="weekly-table-wrap">
        <table>
          <thead>
            <tr>
              <th className="sticky-col">Employee</th>
              <th>Team</th>
              <th>Total</th>
              {periods.map((period) => (
                <th key={period.key}>{period.label}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {tableRows.length ? (
              tableRows.map((employeeRow) => (
                <tr key={employeeRow.employee}>
                  <td className="sticky-col">
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => onOpenDetail("Employee Drill-in", employeeRow.employee, employeeRow.totalRows)}
                    >
                      {employeeRow.employee}
                    </button>
                  </td>
                  <td>{employeeRow.team || "-"}</td>
                  <td>{formatMetricValue(employeeRow.totalRows, metric)}</td>
                  {employeeRow.periods.map((period) => (
                    <td key={`${employeeRow.employee}-${period.key}`}>
                      <button
                        type="button"
                        className={period.rows.length ? "metric-cell has-data" : "metric-cell"}
                        onClick={() =>
                          period.rows.length
                            ? onOpenDetail("Weekly Agent Drill-in", `${employeeRow.employee} · ${period.label}`, period.rows)
                            : null
                        }
                      >
                        {period.label}
                      </button>
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3 + periods.length}>No weekly agent data for the selected filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function downloadWeeklyCsv(tableRows, periods, metric, metricLabel) {
  const header = ["Employee", "Team", `Total ${metricLabel}`, ...periods.map((period) => period.label)];

  const rows = tableRows.map((row) => [
    row.employee,
    row.team,
    formatMetricValue(row.totalRows, metric),
    ...row.periods.map((period) => period.label),
  ]);

  const csv = [header, ...rows]
    .map((line) => line.map((item) => escapeCsv(item)).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "weekly-agent-table.csv";
  a.click();

  URL.revokeObjectURL(url);
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [rawRows, setRawRows] = useState([]);
  const [error, setError] = useState("");
  const [globalFilters, setGlobalFilters] = useState(createGlobalFilters());
  const [weeklyMetric, setWeeklyMetric] = useState("missed");

  const [detailState, setDetailState] = useState({
    open: false,
    title: "",
    value: "",
    rows: [],
  });

  useEffect(() => {
    let active = true;

    async function loadRows() {
      setLoading(true);
      setError("");

      try {
        const allRows = [];
        let from = 0;

        while (from < MAX_DASHBOARD_ROWS) {
          const to = from + PAGE_SIZE - 1;

          const { data, error: fetchError } = await supabase
            .from("audit_results")
            .select(`
              id,
              run_id,
              conversation_id,
              replied_at,
              csat_score,
              client_email,
              agent_name,
              employee_name,
              employee_email,
              team_name,
              employee_match_status,
              ai_verdict,
              review_sentiment,
              client_sentiment,
              resolution_status,
              error,
              created_at
            `)
            .order("created_at", { ascending: false })
            .range(from, to);

          if (fetchError) {
            throw new Error(fetchError.message || "Could not load dashboard data.");
          }

          const rows = Array.isArray(data) ? data : [];
          allRows.push(...rows);

          if (rows.length < PAGE_SIZE) break;

          from += PAGE_SIZE;
        }

        if (!active) return;
        setRawRows(allRows);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Could not load dashboard data.");
        setRawRows([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadRows();

    return () => {
      active = false;
    };
  }, []);

  const dedupedRows = useMemo(() => dedupeLatestByConversation(rawRows), [rawRows]);

  const teams = useMemo(() => uniqueValues(dedupedRows, "team_name"), [dedupedRows]);
  const employees = useMemo(() => uniqueValues(dedupedRows, "employee_name"), [dedupedRows]);
  const reviewSentiments = useMemo(() => uniqueValues(dedupedRows, "review_sentiment"), [dedupedRows]);
  const clientSentiments = useMemo(() => uniqueValues(dedupedRows, "client_sentiment"), [dedupedRows]);
  const resolutionStatuses = useMemo(() => uniqueValues(dedupedRows, "resolution_status"), [dedupedRows]);

  const filteredRows = useMemo(
    () => filterRows(dedupedRows, globalFilters),
    [dedupedRows, globalFilters]
  );

  const reviewEntries = useMemo(
    () => countRowsBy(filteredRows, (row) => row.review_sentiment, REVIEW_SENTIMENT_ORDER),
    [filteredRows]
  );

  const clientEntries = useMemo(
    () => countRowsBy(filteredRows, (row) => row.client_sentiment, CLIENT_SENTIMENT_ORDER),
    [filteredRows]
  );

  const resolutionEntries = useMemo(
    () => countRowsBy(filteredRows, (row) => row.resolution_status, RESOLUTION_ORDER),
    [filteredRows]
  );

  const resultTypeEntries = useMemo(
    () => countRowsBy(filteredRows, (row) => deriveResultType(row.review_sentiment)),
    [filteredRows]
  );

  const leaderboard = useMemo(() => buildLeaderboard(filteredRows), [filteredRows]);

  const total = filteredRows.length;

  const missedCount = filteredRows.filter(
    (row) => row.review_sentiment === "Missed Opportunity"
  ).length;

  const veryPositiveCount = filteredRows.filter(
    (row) => row.client_sentiment === "Very Positive"
  ).length;

  const resolvedCount = filteredRows.filter(
    (row) => row.resolution_status === "Resolved"
  ).length;

  const unresolvedCount = filteredRows.filter(
    (row) => row.resolution_status === "Unresolved"
  ).length;

  const mappedCount = filteredRows.filter(isMapped).length;
  const latestStoredAt = dedupedRows[0]?.created_at || "";

  function openDetail(title, value, rows) {
    setDetailState({
      open: true,
      title,
      value,
      rows: rows || [],
    });
  }

  return (
    <main className="dashboard-page">
      <style>{dashboardStyles}</style>

      <DetailModal
        open={detailState.open}
        onClose={() => setDetailState({ open: false, title: "", value: "", rows: [] })}
        title={detailState.title}
        value={detailState.value}
        rows={detailState.rows}
      />

      <div className="dashboard-shell">
        <nav className="topbar">
          <div>
            <p>NEXT Ventures</p>
            <strong>Review Approach & Client Sentiment Tracking Dashboard</strong>
          </div>

          <span>Secure workspace</span>
        </nav>

        <section className="hero-panel">
          <div>
            <p>Dashboard</p>
            <h1>QA intelligence</h1>
            <span>Latest stored result: {formatDateTime(latestStoredAt)}</span>
          </div>

          <div className="hero-actions">
            <Link href="/run" className="primary-link">
              Run Audit
            </Link>
            <Link href="/results" className="secondary-link">
              Results
            </Link>
            <Link href="/admin" className="secondary-link">
              Admin
            </Link>
          </div>
        </section>

        <FilterBar
          filters={globalFilters}
          setFilters={setGlobalFilters}
          teams={teams}
          employees={employees}
          reviewSentiments={reviewSentiments}
          clientSentiments={clientSentiments}
          resolutionStatuses={resolutionStatuses}
        />

        <section className="kpi-grid">
          <KPIStat
            label="Unique conversations"
            value={formatNumber(total)}
            accent="linear-gradient(135deg, rgba(37,99,235,0.26), rgba(99,102,241,0.12))"
            onClick={() => openDetail("KPI Drill-in", "Unique conversations", filteredRows)}
          />
          <KPIStat
            label="Missed opportunities"
            value={formatNumber(missedCount)}
            accent="linear-gradient(135deg, rgba(245,158,11,0.25), rgba(249,115,22,0.12))"
            onClick={() =>
              openDetail(
                "KPI Drill-in",
                "Missed opportunities",
                filteredRows.filter((row) => row.review_sentiment === "Missed Opportunity")
              )
            }
          />
          <KPIStat
            label="Very positive"
            value={formatNumber(veryPositiveCount)}
            accent="linear-gradient(135deg, rgba(16,185,129,0.24), rgba(6,182,212,0.12))"
            onClick={() =>
              openDetail(
                "KPI Drill-in",
                "Very positive",
                filteredRows.filter((row) => row.client_sentiment === "Very Positive")
              )
            }
          />
          <KPIStat
            label="Resolution rate"
            value={formatPercent(total ? (resolvedCount / total) * 100 : 0)}
            accent="linear-gradient(135deg, rgba(14,165,233,0.22), rgba(34,197,94,0.12))"
            onClick={() =>
              openDetail(
                "KPI Drill-in",
                "Resolved",
                filteredRows.filter((row) => row.resolution_status === "Resolved")
              )
            }
          />
          <KPIStat
            label="Unresolved"
            value={formatNumber(unresolvedCount)}
            accent="linear-gradient(135deg, rgba(244,63,94,0.24), rgba(168,85,247,0.12))"
            onClick={() =>
              openDetail(
                "KPI Drill-in",
                "Unresolved",
                filteredRows.filter((row) => row.resolution_status === "Unresolved")
              )
            }
          />
          <KPIStat
            label="Mapped records"
            value={`${formatNumber(mappedCount)}/${formatNumber(total)}`}
            accent="linear-gradient(135deg, rgba(59,130,246,0.18), rgba(16,185,129,0.12))"
            onClick={() =>
              openDetail(
                "KPI Drill-in",
                "Mapped records",
                filteredRows.filter(isMapped)
              )
            }
          />
        </section>

        {loading ? (
          <section className="panel">
            <h2>Loading dashboard...</h2>
            <p className="muted">Reading stored audit results from Supabase.</p>
          </section>
        ) : error ? (
          <section className="panel">
            <div className="error-box">{error}</div>
          </section>
        ) : (
          <>
            <section className="chart-grid">
              <ChartCard
                title="Review sentiment"
                subtitle={`${formatNumber(filteredRows.length)} filtered conversations`}
                onDrill={() => openDetail("Review Sentiment Drill-in", "All review sentiments", filteredRows)}
              >
                <HorizontalBarChart
                  entries={reviewEntries}
                  total={filteredRows.length}
                  kind="review"
                  onSelect={(entry) => openDetail("Review Sentiment Drill-in", entry.label, entry.rows)}
                />
              </ChartCard>

              <ChartCard
                title="Result type mix"
                subtitle="Positive, opportunity, risk, and other"
                onDrill={() => openDetail("Result Type Drill-in", "All result types", filteredRows)}
              >
                <DonutChart
                  entries={resultTypeEntries}
                  total={filteredRows.length}
                  onSelect={(entry) => openDetail("Result Type Drill-in", entry.label, entry.rows)}
                />
              </ChartCard>

              <ChartCard
                title="Client sentiment"
                subtitle="Client emotional outcome"
                onDrill={() => openDetail("Client Sentiment Drill-in", "All client sentiments", filteredRows)}
              >
                <HorizontalBarChart
                  entries={clientEntries}
                  total={filteredRows.length}
                  kind="client"
                  onSelect={(entry) => openDetail("Client Sentiment Drill-in", entry.label, entry.rows)}
                />
              </ChartCard>

              <ChartCard
                title="Resolution share"
                subtitle="Resolved, pending, unclear, unresolved"
                onDrill={() => openDetail("Resolution Drill-in", "All resolution statuses", filteredRows)}
              >
                <DonutChart
                  entries={resolutionEntries}
                  total={filteredRows.length}
                  onSelect={(entry) => openDetail("Resolution Drill-in", entry.label, entry.rows)}
                />
              </ChartCard>
            </section>

            <section className="panel leaderboard-panel">
              <div className="section-title-row">
                <div>
                  <p>Performance command</p>
                  <h2>Agent leaderboard</h2>
                  <span>Sorted by volume. Click any row to drill into the saved audit records.</span>
                </div>

                <button type="button" className="secondary-btn" onClick={() => downloadCsv(filteredRows, "dashboard-filtered-results.csv")}>
                  Export filtered CSV
                </button>
              </div>

              <div className="leaderboard-cards">
                {[
                  {
                    title: "Top volume",
                    rows: [...leaderboard].sort((a, b) => b.handled - a.handled).slice(0, 5),
                    value: (row) => formatNumber(row.handled),
                  },
                  {
                    title: "Missed opportunity",
                    rows: [...leaderboard].sort((a, b) => b.missed - a.missed).slice(0, 5),
                    value: (row) => formatNumber(row.missed),
                  },
                  {
                    title: "Very positive",
                    rows: [...leaderboard].sort((a, b) => b.veryPositive - a.veryPositive).slice(0, 5),
                    value: (row) => formatNumber(row.veryPositive),
                  },
                  {
                    title: "Risk rate",
                    rows: [...leaderboard].sort((a, b) => b.riskRate - a.riskRate).slice(0, 5),
                    value: (row) => formatPercent(row.riskRate),
                  },
                ].map((block) => (
                  <div key={block.title} className="mini-rank-card">
                    <h3>{block.title}</h3>
                    {block.rows.length ? (
                      block.rows.map((row) => (
                        <button
                          key={`${block.title}-${row.employee}`}
                          type="button"
                          onClick={() => openDetail("Leaderboard Drill-in", `${block.title}: ${row.employee}`, row.rows)}
                        >
                          <strong>{row.employee}</strong>
                          <span>{block.value(row)}</span>
                          <small>
                            {row.team || "-"} · {formatNumber(row.handled)} handled
                          </small>
                        </button>
                      ))
                    ) : (
                      <p>No data.</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Team</th>
                      <th>Handled</th>
                      <th>Missed</th>
                      <th>Very positive</th>
                      <th>Resolution rate</th>
                      <th>Risk rate</th>
                      <th>Drill-in</th>
                    </tr>
                  </thead>

                  <tbody>
                    {leaderboard.map((row) => (
                      <tr key={row.employee}>
                        <td>
                          <button type="button" className="text-link" onClick={() => openDetail("Employee Drill-in", row.employee, row.rows)}>
                            {row.employee}
                          </button>
                        </td>
                        <td>{row.team || "-"}</td>
                        <td>{formatNumber(row.handled)}</td>
                        <td>{formatNumber(row.missed)}</td>
                        <td>{formatNumber(row.veryPositive)}</td>
                        <td>{formatPercent(row.resolutionRate)}</td>
                        <td>{formatPercent(row.riskRate)}</td>
                        <td>
                          <button type="button" className="small-btn" onClick={() => openDetail("Employee Drill-in", row.employee, row.rows)}>
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <WeeklyAgentTable
              rows={filteredRows}
              filters={globalFilters}
              metric={weeklyMetric}
              setMetric={setWeeklyMetric}
              onOpenDetail={openDetail}
            />

            <section className="panel explorer-panel">
              <div className="section-title-row">
                <div>
                  <p>Conversation explorer</p>
                  <h2>Latest filtered conversations</h2>
                  <span>Showing the first 100 records from the current dashboard filter.</span>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Conversation</th>
                      <th>Employee</th>
                      <th>Team</th>
                      <th>Review</th>
                      <th>Client</th>
                      <th>Resolution</th>
                      <th>Date</th>
                      <th>Open</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredRows.slice(0, 100).map((row, index) => (
                      <tr key={`${row.conversation_id}-${index}`}>
                        <td>
                          <strong>{row.conversation_id}</strong>
                          <small>
                            {row.agent_name || "Unassigned"}
                            <br />
                            {row.client_email || "-"}
                          </small>
                        </td>
                        <td>{row.employee_name || "Unmapped"}</td>
                        <td>{row.team_name || "-"}</td>
                        <td>{row.review_sentiment || "-"}</td>
                        <td>{row.client_sentiment || "-"}</td>
                        <td>{row.resolution_status || "-"}</td>
                        <td>{formatDateTime(row.replied_at || row.created_at)}</td>
                        <td>
                          <a href={conversationUrl(row.conversation_id)} target="_blank" rel="noreferrer">
                            Open
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

const dashboardStyles = `
  .dashboard-page {
    min-height: 100vh;
    padding: 32px 20px 72px;
    color: #f5f7ff;
    background:
      radial-gradient(circle at top left, rgba(59,130,246,0.16), transparent 22%),
      radial-gradient(circle at top right, rgba(168,85,247,0.16), transparent 20%),
      radial-gradient(circle at bottom center, rgba(6,182,212,0.08), transparent 22%),
      linear-gradient(180deg, #040714 0%, #060b1d 45%, #04060d 100%);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .dashboard-shell {
    width: min(1500px, 100%);
    margin: 0 auto;
  }

  .topbar,
  .hero-panel,
  .filter-panel,
  .panel,
  .chart-card,
  .kpi-card {
    border: 1px solid rgba(255,255,255,0.08);
    background: linear-gradient(180deg, rgba(15,22,43,0.9), rgba(7,10,24,0.96));
    box-shadow: 0 20px 60px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04);
  }

  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 18px 20px;
    border-radius: 22px;
    margin-bottom: 24px;
    background: rgba(9,13,29,0.72);
    backdrop-filter: blur(14px);
  }

  .topbar p,
  .hero-panel p,
  .section-title-row p {
    margin: 0 0 8px;
    color: #8ea0d6;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .topbar strong {
    display: block;
    font-size: 22px;
    letter-spacing: -0.03em;
  }

  .topbar span {
    padding: 8px 12px;
    border-radius: 999px;
    color: #bbf7d0;
    border: 1px solid rgba(16,185,129,0.24);
    background: rgba(16,185,129,0.1);
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .hero-panel {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 18px;
    padding: 28px;
    border-radius: 28px;
    margin-bottom: 18px;
  }

  .hero-panel h1 {
    margin: 0 0 10px;
    font-size: clamp(42px, 5vw, 62px);
    line-height: 0.98;
    letter-spacing: -0.07em;
  }

  .hero-panel span,
  .section-title-row span,
  .muted {
    color: #a9b4d0;
    font-size: 14px;
    line-height: 1.7;
  }

  .hero-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .primary-link,
  .secondary-link,
  .primary-btn,
  .secondary-btn,
  .light-btn,
  .drill-btn,
  .small-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 42px;
    padding: 0 16px;
    border-radius: 14px;
    font-size: 13px;
    font-weight: 900;
    cursor: pointer;
    text-decoration: none;
  }

  .primary-link,
  .primary-btn {
    color: #fff;
    border: 0;
    background: linear-gradient(135deg, #2563eb 0%, #7c3aed 50%, #db2777 100%);
    box-shadow: 0 14px 30px rgba(91,33,182,0.35);
  }

  .secondary-link,
  .secondary-btn,
  .drill-btn,
  .small-btn {
    color: #e5ebff;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.035);
  }

  .light-btn {
    color: #0f172a;
    border: 0;
    background: #ffffff;
  }

  .filter-panel {
    padding: 18px;
    border-radius: 26px;
    margin-bottom: 18px;
  }

  .filter-top-row,
  .filter-bottom-row {
    display: grid;
    gap: 12px;
    align-items: end;
  }

  .filter-top-row {
    grid-template-columns: minmax(280px, 1.4fr) minmax(180px, 1fr) minmax(220px, 1fr) auto;
    margin-bottom: 12px;
  }

  .filter-bottom-row {
    grid-template-columns: repeat(5, minmax(0, 1fr)) auto;
  }

  label span,
  .custom-range-panel small {
    display: block;
    margin-bottom: 7px;
    color: #8ea0d6;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  input,
  select,
  button {
    font: inherit;
  }

  input,
  select {
    width: 100%;
    min-height: 46px;
    box-sizing: border-box;
    color: #e7ecff;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 14px;
    outline: none;
    background: rgba(5,8,18,0.9);
    padding: 0 13px;
    color-scheme: dark;
  }

  .cex-check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: #dbe7ff;
    font-size: 14px;
    font-weight: 800;
    padding-bottom: 10px;
    white-space: nowrap;
  }

  .cex-check input {
    width: auto;
    min-height: auto;
  }

  .date-picker-wrap {
    position: relative;
  }

  .date-picker-button {
    width: 100%;
    min-height: 52px;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 0 14px;
    color: #e7ecff;
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 16px;
    background: rgba(5,8,18,0.9);
    cursor: pointer;
    text-align: left;
  }

  .date-picker-button span,
  .date-picker-button b {
    color: #8ea0d6;
    font-size: 12px;
    font-weight: 900;
  }

  .date-picker-button strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .date-picker-popover {
    position: absolute;
    top: calc(100% + 10px);
    left: 0;
    z-index: 100;
    width: min(760px, 92vw);
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    overflow: hidden;
    border-radius: 22px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(16,22,36,0.98);
    box-shadow: 0 24px 70px rgba(0,0,0,0.55);
  }

  .date-preset-list {
    padding: 10px;
    border-right: 1px solid rgba(255,255,255,0.08);
  }

  .date-preset-list button {
    width: 100%;
    min-height: 42px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    border: 0;
    border-radius: 12px;
    color: #e5ebff;
    background: transparent;
    padding: 0 12px;
    cursor: pointer;
    font-weight: 800;
    text-align: left;
  }

  .date-preset-list button.active,
  .date-preset-list button:hover {
    background: rgba(255,255,255,0.07);
  }

  .date-preset-list b {
    color: #f97316;
    font-size: 11px;
  }

  .custom-range-panel {
    padding: 18px;
  }

  .custom-range-panel strong {
    display: block;
    margin-bottom: 18px;
    color: #ffffff;
    font-size: 18px;
  }

  .custom-range-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 18px;
  }

  .custom-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }

  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 14px;
    margin-bottom: 18px;
  }

  .kpi-card {
    position: relative;
    min-height: 124px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    border-radius: 22px;
    padding: 18px;
    color: #ffffff;
    cursor: pointer;
    text-align: left;
    background: var(--accent);
    transition: transform 160ms ease, box-shadow 160ms ease;
  }

  .kpi-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 18px 48px rgba(0,0,0,0.42);
  }

  .kpi-card span {
    color: #a8b7ef;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .kpi-card strong {
    font-size: 38px;
    line-height: 1;
    letter-spacing: -0.05em;
  }

  .kpi-card small {
    color: #cbd5ff;
    font-size: 12px;
    font-weight: 900;
  }

  .chart-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
    margin-bottom: 18px;
  }

  .chart-card,
  .panel {
    border-radius: 26px;
    padding: 20px;
  }

  .chart-head,
  .section-title-row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
    margin-bottom: 16px;
  }

  .chart-head h3,
  .section-title-row h2,
  .panel h2 {
    margin: 0 0 6px;
    font-size: 24px;
    letter-spacing: -0.04em;
  }

  .chart-head p {
    margin: 0;
    color: #a9b4d0;
    font-size: 13px;
  }

  .chart-card .card-action {
    opacity: 0.86;
    transition: opacity 160ms ease, transform 160ms ease;
  }

  .chart-card:hover .card-action {
    opacity: 1;
    transform: translateY(-1px);
  }

  .bar-list {
    display: grid;
    gap: 12px;
  }

  .bar-item {
    width: 100%;
    text-align: left;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03);
    padding: 13px;
    color: #eef3ff;
    cursor: pointer;
  }

  .bar-line {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
    align-items: center;
  }

  .bar-line strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar-line span {
    color: #cdd7ff;
    font-size: 12px;
    font-weight: 900;
    white-space: nowrap;
  }

  .bar-track {
    height: 11px;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(255,255,255,0.06);
  }

  .bar-fill {
    height: 100%;
    border-radius: 999px;
  }

  .donut-layout {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    gap: 18px;
    align-items: center;
  }

  .donut {
    width: 220px;
    height: 220px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    box-shadow: 0 16px 36px rgba(0,0,0,0.35);
  }

  .donut-hole {
    width: 58%;
    height: 58%;
    display: grid;
    place-items: center;
    text-align: center;
    border-radius: 50%;
    background: linear-gradient(180deg, rgba(12,18,34,0.98), rgba(7,10,22,1));
    border: 1px solid rgba(255,255,255,0.06);
  }

  .donut-hole strong {
    display: block;
    font-size: 32px;
    letter-spacing: -0.04em;
  }

  .donut-hole span {
    display: block;
    color: #8ea0d6;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .donut-legend {
    display: grid;
    gap: 10px;
  }

  .donut-legend button {
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 10px 12px;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03);
    color: #eef3ff;
    cursor: pointer;
    text-align: left;
  }

  .donut-legend i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .donut-legend strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .donut-legend span {
    color: #cdd7ff;
    font-size: 12px;
    font-weight: 900;
    white-space: nowrap;
  }

  .leaderboard-cards {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
    margin-bottom: 18px;
  }

  .mini-rank-card {
    display: grid;
    gap: 10px;
    border-radius: 20px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03);
    padding: 16px;
  }

  .mini-rank-card h3 {
    margin: 0 0 4px;
    font-size: 18px;
  }

  .mini-rank-card button {
    min-height: 74px;
    display: grid;
    gap: 5px;
    text-align: left;
    border-radius: 15px;
    border: 1px solid rgba(255,255,255,0.07);
    background: rgba(255,255,255,0.025);
    color: #eef3ff;
    padding: 12px;
    cursor: pointer;
  }

  .mini-rank-card button span {
    color: #ffffff;
    font-weight: 900;
  }

  .mini-rank-card button small {
    color: #8ea0d6;
    font-weight: 800;
  }

  .table-wrap,
  .weekly-table-wrap,
  .modal-table-wrap {
    overflow: auto;
    border-radius: 20px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(4,8,20,0.72);
  }

  table {
    width: 100%;
    min-width: 1120px;
    border-collapse: collapse;
  }

  th {
    position: sticky;
    top: 0;
    z-index: 2;
    padding: 14px 12px;
    text-align: left;
    color: #8ea0d6;
    background: rgba(10,18,34,0.96);
    border-bottom: 1px solid rgba(255,255,255,0.08);
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  td {
    padding: 14px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    color: #e5ebff;
    vertical-align: top;
  }

  td small {
    display: block;
    margin-top: 6px;
    color: #8ea0d6;
    line-height: 1.55;
  }

  td a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 34px;
    padding: 0 10px;
    border-radius: 11px;
    color: #ecf2ff;
    text-decoration: none;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.03);
    font-weight: 800;
    font-size: 12px;
  }

  .text-link {
    border: 0;
    padding: 0;
    color: #ffffff;
    background: transparent;
    font-weight: 900;
    cursor: pointer;
    text-align: left;
  }

  .weekly-panel {
    margin-bottom: 18px;
  }

  .weekly-controls {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    flex-wrap: wrap;
  }

  .weekly-controls label {
    min-width: 240px;
  }

  .weekly-table-wrap {
    max-height: 620px;
  }

  .sticky-col {
    position: sticky;
    left: 0;
    z-index: 3;
    background: rgba(10,18,34,0.98);
  }

  td.sticky-col {
    background: rgba(7,12,25,0.98);
  }

  .metric-cell {
    width: 100%;
    min-height: 36px;
    border-radius: 12px;
    color: #7684a7;
    border: 1px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.025);
    cursor: default;
    font-weight: 900;
  }

  .metric-cell.has-data {
    color: #ffffff;
    cursor: pointer;
    border-color: rgba(96,165,250,0.18);
    background: linear-gradient(135deg, rgba(37,99,235,0.22), rgba(168,85,247,0.14));
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgba(2,5,14,0.76);
    backdrop-filter: blur(10px);
  }

  .drill-modal {
    width: min(1440px, 96vw);
    max-height: 92vh;
    overflow: hidden;
    border-radius: 28px;
    border: 1px solid rgba(255,255,255,0.08);
    background: linear-gradient(180deg, rgba(15,22,43,0.98), rgba(7,10,24,0.99));
    box-shadow: 0 30px 90px rgba(0,0,0,0.58);
  }

  .modal-head {
    display: flex;
    justify-content: space-between;
    gap: 18px;
    padding: 22px 24px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }

  .modal-head p {
    margin: 0 0 8px;
    color: #8ea0d6;
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  .modal-head h2 {
    margin: 0 0 8px;
    font-size: 30px;
    letter-spacing: -0.04em;
  }

  .modal-head span {
    color: #a9b4d0;
  }

  .modal-actions {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .modal-filter-grid {
    display: grid;
    grid-template-columns: 1.5fr repeat(5, minmax(0, 1fr));
    gap: 12px;
    padding: 18px 24px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }

  .modal-table-wrap {
    max-height: calc(92vh - 230px);
    border-radius: 0;
    border-left: 0;
    border-right: 0;
    border-bottom: 0;
  }

  .table-note,
  .empty-box {
    padding: 18px;
    color: #a9b4d0;
    border-radius: 16px;
    border: 1px dashed rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.02);
  }

  .empty-box.compact {
    padding: 12px;
  }

  .error-box {
    border-radius: 18px;
    border: 1px solid rgba(244,63,94,0.22);
    background: rgba(244,63,94,0.08);
    padding: 16px;
    color: #fecdd3;
  }

  .explorer-panel {
    margin-top: 18px;
  }

  @media (max-width: 1250px) {
    .filter-top-row,
    .filter-bottom-row,
    .kpi-grid,
    .leaderboard-cards {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .chart-grid {
      grid-template-columns: 1fr;
    }

    .donut-layout {
      grid-template-columns: 1fr;
      justify-items: center;
    }

    .modal-filter-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 760px) {
    .dashboard-page {
      padding: 20px 12px 56px;
    }

    .topbar,
    .hero-panel,
    .chart-head,
    .section-title-row,
    .modal-head {
      flex-direction: column;
      align-items: stretch;
    }

    .filter-top-row,
    .filter-bottom-row,
    .kpi-grid,
    .leaderboard-cards,
    .custom-range-grid,
    .modal-filter-grid {
      grid-template-columns: 1fr;
    }

    .date-picker-popover {
      width: 92vw;
      grid-template-columns: 1fr;
    }

    .date-preset-list {
      border-right: 0;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }

    .hero-panel h1 {
      font-size: 42px;
    }
  }
`;
