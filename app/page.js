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

const RESULT_TYPE_OPTIONS = ["Positive", "Opportunity", "Risk", "Other"];
const MAPPING_OPTIONS = ["Mapped", "Unmapped"];

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
  { key: "likelyPositive", label: "Likely positive reviews" },
  { key: "missed", label: "Missed opportunities" },
  { key: "veryPositive", label: "Very positive" },
  { key: "likelyNegative", label: "Likely negative reviews" },
  { key: "unresolved", label: "Unresolved" },
  { key: "resolutionRate", label: "Resolution rate" },
];

function normalizeText(value, fallback = "-") {
  const text = String(value || "").trim();
  return text || fallback;
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
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

function isLikelyPositiveReview(row) {
  return (
    row?.review_sentiment === "Likely Positive Review" ||
    row?.review_sentiment === "Highly Likely Positive Review"
  );
}

function isLikelyNegativeReview(row) {
  return (
    row?.review_sentiment === "Likely Negative Review" ||
    row?.review_sentiment === "Highly Likely Negative Review"
  );
}

function isMapped(row) {
  return Boolean(row?.employee_name || row?.employee_match_status === "mapped");
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

function matchesMulti(selected, value) {
  if (!Array.isArray(selected) || selected.length === 0) return true;
  return selected.includes(String(value || ""));
}

function buildSupervisorLookup(supervisorTeams) {
  const lookup = new Map();

  for (const team of supervisorTeams || []) {
    const memberNames = new Set();
    const memberEmails = new Set();

    for (const member of team?.members || []) {
      const name = normalizeKey(member?.employee_name);
      const email = normalizeEmail(member?.employee_email);

      if (name) memberNames.add(name);
      if (email) memberEmails.add(email);
    }

    lookup.set(team.id, {
      ...team,
      memberNames,
      memberEmails,
    });
  }

  return lookup;
}

function rowMatchesSupervisorTeams(row, selectedSupervisorTeamIds, supervisorLookup) {
  if (!Array.isArray(selectedSupervisorTeamIds) || selectedSupervisorTeamIds.length === 0) {
    return true;
  }

  const employeeName = normalizeKey(row?.employee_name);
  const employeeEmail = normalizeEmail(row?.employee_email);

  if (!employeeName && !employeeEmail) return false;

  return selectedSupervisorTeamIds.some((teamId) => {
    const team = supervisorLookup.get(teamId);
    if (!team) return false;

    if (employeeEmail && team.memberEmails.has(employeeEmail)) return true;
    if (employeeName && team.memberNames.has(employeeName)) return true;

    return false;
  });
}

function filterRows(rows, filters, supervisorLookup = new Map()) {
  const { start, end } = buildDateRange(filters);

  return (rows || []).filter((row) => {
    const analyticsDate = toDate(getAnalyticsDate(row));

    if ((start || end) && !analyticsDate) return false;
    if (start && analyticsDate < start) return false;
    if (end && analyticsDate > end) return false;

    if (!rowMatchesSupervisorTeams(row, filters.supervisorTeamIds, supervisorLookup)) return false;

    if (!matchesMulti(filters.teams, row?.team_name)) return false;
    if (!matchesMulti(filters.employees, row?.employee_name)) return false;
    if (!matchesMulti(filters.reviewSentiments, row?.review_sentiment)) return false;
    if (!matchesMulti(filters.clientSentiments, row?.client_sentiment)) return false;
    if (!matchesMulti(filters.resolutionStatuses, row?.resolution_status)) return false;
    if (!matchesMulti(filters.resultTypes, deriveResultType(row?.review_sentiment))) return false;

    if (Array.isArray(filters.mappingStatuses) && filters.mappingStatuses.length > 0) {
      const status = isMapped(row) ? "Mapped" : "Unmapped";
      if (!filters.mappingStatuses.includes(status)) return false;
    }

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

function createBaseFilters(rangePreset = "past_30_days", cexOnly = true) {
  const range = getPresetRange(rangePreset);

  return {
    rangePreset,
    startDate: formatInputDate(range.start),
    endDate: formatInputDate(range.end),
    supervisorTeamIds: [],
    teams: [],
    employees: [],
    reviewSentiments: [],
    clientSentiments: [],
    resolutionStatuses: [],
    resultTypes: [],
    mappingStatuses: [],
    cexOnly,
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
    end = datedRows[datedRows.length - 1]
      ? endOfDay(datedRows[datedRows.length - 1])
      : endOfDay(new Date());
  }

  if (!start) {
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
  if (metric === "likelyPositive") return rows.filter(isLikelyPositiveReview);
  if (metric === "missed") return rows.filter((row) => row.review_sentiment === "Missed Opportunity");
  if (metric === "veryPositive") return rows.filter((row) => row.client_sentiment === "Very Positive");
  if (metric === "likelyNegative") return rows.filter(isLikelyNegativeReview);
  if (metric === "unresolved") return rows.filter((row) => row.resolution_status === "Unresolved");
  if (metric === "resolutionRate") return rows.filter((row) => row.resolution_status === "Resolved");
  return rows;
}

function metricValue(rows, metric) {
  if (metric === "resolutionRate") {
    return rows.length ? (metricRows(rows, metric).length / rows.length) * 100 : 0;
  }

  return metricRows(rows, metric).length;
}

function formatMetricValue(rows, metric) {
  const value = metricValue(rows, metric);

  if (metric === "resolutionRate") {
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
      likelyPositive: 0,
      missed: 0,
      veryPositive: 0,
      likelyNegative: 0,
      unresolved: 0,
      rows: [],
    };

    current.handled += 1;

    if (isLikelyPositiveReview(row)) current.likelyPositive += 1;
    if (row?.review_sentiment === "Missed Opportunity") current.missed += 1;
    if (row?.client_sentiment === "Very Positive") current.veryPositive += 1;
    if (isLikelyNegativeReview(row)) current.likelyNegative += 1;
    if (row?.resolution_status === "Unresolved") current.unresolved += 1;

    current.rows.push(row);

    map.set(employee, current);
  }

  return Array.from(map.values())
    .map((item) => ({
      ...item,
      likelyPositiveRate: item.handled ? (item.likelyPositive / item.handled) * 100 : 0,
      missedRate: item.handled ? (item.missed / item.handled) * 100 : 0,
      likelyNegativeRate: item.handled ? (item.likelyNegative / item.handled) * 100 : 0,
      resolutionRate: item.handled ? ((item.handled - item.unresolved) / item.handled) * 100 : 0,
    }))
    .sort((a, b) => {
      if (b.handled !== a.handled) return b.handled - a.handled;
      return a.employee.localeCompare(b.employee);
    });
}

function MultiSelect({ label, options, selected, onChange, placeholder = "All" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);

  const normalizedOptions = useMemo(
    () =>
      (options || [])
        .filter(Boolean)
        .map((item) =>
          typeof item === "string" ? { value: item, label: item, searchText: item } : item
        ),
    [options]
  );

  const filteredOptions = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return normalizedOptions;

    return normalizedOptions.filter((item) =>
      String(`${item.label || ""} ${item.searchText || ""}`).toLowerCase().includes(search)
    );
  }, [query, normalizedOptions]);

  useEffect(() => {
    function handleOutside(event) {
      if (!ref.current) return;
      if (!ref.current.contains(event.target)) setOpen(false);
    }

    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const selectedSet = new Set(selected || []);
  const allSelected = !selected || selected.length === 0;

  function toggleValue(value) {
    const next = new Set(selected || []);

    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }

    onChange(Array.from(next));
  }

  function displayValue() {
    if (allSelected) return placeholder;

    if (selected.length === 1) {
      const found = normalizedOptions.find((item) => item.value === selected[0]);
      return found?.label || selected[0];
    }

    return `${selected.length} selected`;
  }

  return (
    <div ref={ref} className="multi-wrap">
      <label>
        <span>{label}</span>
        <button type="button" className="multi-button" onClick={() => setOpen((prev) => !prev)}>
          <strong>{displayValue()}</strong>
          <b>{open ? "Up" : "Down"}</b>
        </button>
      </label>

      {open ? (
        <div className="multi-menu">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${label.toLowerCase()}`}
          />

          <button type="button" className="multi-option all" onClick={() => onChange([])}>
            <span>{allSelected ? "Selected" : "Select"}</span>
            <strong>{placeholder}</strong>
          </button>

          <div className="multi-options">
            {filteredOptions.map((item) => (
              <button
                key={item.value}
                type="button"
                className={selectedSet.has(item.value) ? "multi-option active" : "multi-option"}
                onClick={() => toggleValue(item.value)}
              >
                <span>{selectedSet.has(item.value) ? "Selected" : "Select"}</span>
                <strong>{item.label}</strong>
              </button>
            ))}

            {!filteredOptions.length ? (
              <div className="multi-empty">No matching options.</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
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
      <label>
        <span>Date range</span>
        <button type="button" className="date-picker-button" onClick={() => setOpen((prev) => !prev)}>
          <strong>{getRangeDisplay(filters)}</strong>
          <b>{open ? "Up" : "Down"}</b>
        </button>
      </label>

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

function DashboardFilterBar({
  filters,
  setFilters,
  supervisorTeams,
  employees,
  reviewOptions,
  clientOptions,
  resolutionOptions,
  showMapping = true,
  resetTo,
}) {
  function update(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  const supervisorOptions = useMemo(
    () =>
      (supervisorTeams || []).map((team) => ({
        value: team.id,
        label: team.supervisor_name,
        searchText: [
          team.supervisor_name,
          team.supervisor_email,
          ...(team.members || []).map((member) =>
            [member.employee_name, member.employee_email, member.intercom_agent_name, member.team_name]
              .filter(Boolean)
              .join(" ")
          ),
        ].join(" "),
      })),
    [supervisorTeams]
  );

  return (
    <div className="filter-panel">
      <div className="filter-row first">
        <DateRangePicker filters={filters} setFilters={setFilters} />

        <MultiSelect
          label="Supervisor team"
          options={supervisorOptions}
          selected={filters.supervisorTeamIds}
          onChange={(value) => update("supervisorTeamIds", value)}
          placeholder="All supervisors"
        />

        <MultiSelect
          label="Employee"
          options={employees}
          selected={filters.employees}
          onChange={(value) => update("employees", value)}
          placeholder="All employees"
        />

        <label className="cex-check">
          <input
            type="checkbox"
            checked={filters.cexOnly}
            onChange={(event) => update("cexOnly", event.target.checked)}
          />
          CEx only
        </label>
      </div>

      <div className="filter-row second">
        <MultiSelect
          label="Review"
          options={reviewOptions}
          selected={filters.reviewSentiments}
          onChange={(value) => update("reviewSentiments", value)}
          placeholder="All review"
        />

        <MultiSelect
          label="Client"
          options={clientOptions}
          selected={filters.clientSentiments}
          onChange={(value) => update("clientSentiments", value)}
          placeholder="All client"
        />

        <MultiSelect
          label="Resolution"
          options={resolutionOptions}
          selected={filters.resolutionStatuses}
          onChange={(value) => update("resolutionStatuses", value)}
          placeholder="All resolution"
        />

        <MultiSelect
          label="Type"
          options={RESULT_TYPE_OPTIONS}
          selected={filters.resultTypes}
          onChange={(value) => update("resultTypes", value)}
          placeholder="All types"
        />

        {showMapping ? (
          <MultiSelect
            label="Mapping"
            options={MAPPING_OPTIONS}
            selected={filters.mappingStatuses}
            onChange={(value) => update("mappingStatuses", value)}
            placeholder="All mapping"
          />
        ) : null}

        <button type="button" className="primary-btn reset-btn" onClick={() => setFilters(resetTo())}>
          Reset filters
        </button>
      </div>
    </div>
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

function ChartCard({ title, subtitle, onDrill, children, larger = false }) {
  return (
    <article className={larger ? "chart-card large" : "chart-card"}>
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
  const visibleEntries = entries.filter((entry) => entry.count > 0);
  const max = Math.max(...visibleEntries.map((item) => item.count), 1);

  if (!visibleEntries.length) {
    return <div className="empty-box">No data for this section.</div>;
  }

  return (
    <div className="bar-list">
      {visibleEntries.map((entry) => {
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
  const palette = ["#10b981", "#ef4444", "#06b6d4", "#8b5cf6", "#f59e0b", "#ec4899", "#6366f1"];
  const visibleEntries = entries.filter((entry) => entry.count > 0);
  const segments = buildPieSegments(visibleEntries, palette);
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

function DetailModal({
  open,
  onClose,
  title,
  value,
  rows,
  supervisorTeams,
  supervisorLookup,
  employees,
  reviewOptions,
  clientOptions,
  resolutionOptions,
}) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(createBaseFilters("all", false));

  useEffect(() => {
    if (!open) return;

    setQuery("");
    setFilters(createBaseFilters("all", false));
  }, [open, title, value]);

  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    const dateFilteredRows = filterRows(rows, filters, supervisorLookup);

    if (!search) return dateFilteredRows;

    return dateFilteredRows.filter((row) => {
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

      return haystack.includes(search);
    });
  }, [rows, filters, query, supervisorLookup]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="drill-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p>Chart drill in</p>
            <h2>{title}</h2>
            <span>
              {value} · {formatNumber(filteredRows.length)} of {formatNumber(rows.length)} conversation(s)
            </span>
          </div>

          <div className="modal-actions">
            <button type="button" className="secondary-btn" onClick={() => downloadCsv(filteredRows, "dashboard-drill-in.csv")}>
              Export CSV
            </button>
            <button type="button" className="light-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="modal-filter-block">
          <DashboardFilterBar
            filters={filters}
            setFilters={setFilters}
            supervisorTeams={supervisorTeams}
            employees={employees}
            reviewOptions={reviewOptions}
            clientOptions={clientOptions}
            resolutionOptions={resolutionOptions}
            showMapping={false}
            resetTo={() => createBaseFilters("all", false)}
          />

          <label className="modal-search">
            <span>Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Conversation, agent, employee, client, verdict"
            />
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
              Showing first 500 rows. Use Export CSV for the full filtered drill in.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function WeeklyAgentTable({
  rows,
  filters,
  setFilters,
  metric,
  setMetric,
  onOpenDetail,
  supervisorTeams,
  supervisorLookup,
  employees,
  reviewOptions,
  clientOptions,
  resolutionOptions,
}) {
  const weeklyRows = useMemo(
    () => filterRows(rows, filters, supervisorLookup),
    [rows, filters, supervisorLookup]
  );

  const { periods, tableRows } = useMemo(
    () => buildAgentWeeklyRows(weeklyRows, filters, metric),
    [weeklyRows, filters, metric]
  );

  const metricLabel = WEEKLY_METRIC_OPTIONS.find((item) => item.key === metric)?.label || "Metric";

  return (
    <section className="panel weekly-panel">
      <div className="section-title-row">
        <div>
          <p>Weekly performance table</p>
          <h2>Agent week by week view</h2>
          <span>Click an employee or weekly cell to open the underlying conversations.</span>
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

      <DashboardFilterBar
        filters={filters}
        setFilters={setFilters}
        supervisorTeams={supervisorTeams}
        employees={employees}
        reviewOptions={reviewOptions}
        clientOptions={clientOptions}
        resolutionOptions={resolutionOptions}
        showMapping={false}
        resetTo={() => createBaseFilters("past_12_weeks", true)}
      />

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
                      onClick={() => onOpenDetail("Employee drill in", employeeRow.employee, employeeRow.totalRows)}
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
                            ? onOpenDetail("Weekly agent drill in", `${employeeRow.employee} · ${period.label}`, period.rows)
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
  const [supervisorTeams, setSupervisorTeams] = useState([]);
  const [error, setError] = useState("");
  const [globalFilters, setGlobalFilters] = useState(createBaseFilters("past_30_days", true));
  const [leaderboardFilters, setLeaderboardFilters] = useState(createBaseFilters("past_30_days", true));
  const [weeklyFilters, setWeeklyFilters] = useState(createBaseFilters("past_12_weeks", true));
  const [weeklyMetric, setWeeklyMetric] = useState("missed");
  const [showJumpTop, setShowJumpTop] = useState(false);

  const [detailState, setDetailState] = useState({
    open: false,
    title: "",
    value: "",
    rows: [],
  });

  useEffect(() => {
    let active = true;

    async function loadSupervisorTeams() {
      const { data: teamsData, error: teamsError } = await supabase
        .from("supervisor_teams")
        .select("id, supervisor_name, supervisor_email, notes, is_active, created_at, updated_at")
        .eq("is_active", true)
        .order("supervisor_name", { ascending: true });

      if (teamsError) {
        throw new Error(teamsError.message || "Could not load Supervisor Teams.");
      }

      const teams = Array.isArray(teamsData) ? teamsData : [];
      const teamIds = teams.map((team) => team.id).filter(Boolean);

      if (!teamIds.length) {
        return [];
      }

      const { data: membersData, error: membersError } = await supabase
        .from("supervisor_team_members")
        .select(
          "id, supervisor_team_id, employee_name, employee_email, intercom_agent_name, team_name, is_active, created_at, updated_at"
        )
        .in("supervisor_team_id", teamIds)
        .eq("is_active", true)
        .order("employee_name", { ascending: true });

      if (membersError) {
        throw new Error(membersError.message || "Could not load Supervisor Team members.");
      }

      const members = Array.isArray(membersData) ? membersData : [];
      const membersByTeam = new Map();

      for (const member of members) {
        const current = membersByTeam.get(member.supervisor_team_id) || [];
        current.push(member);
        membersByTeam.set(member.supervisor_team_id, current);
      }

      return teams.map((team) => ({
        ...team,
        members: membersByTeam.get(team.id) || [],
      }));
    }

    async function loadRows() {
      setLoading(true);
      setError("");

      try {
        const [loadedSupervisorTeams] = await Promise.all([loadSupervisorTeams()]);
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

        setSupervisorTeams(loadedSupervisorTeams);
        setRawRows(allRows);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Could not load dashboard data.");
        setRawRows([]);
        setSupervisorTeams([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadRows();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function handleScroll() {
      setShowJumpTop(window.scrollY > 700);
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const dedupedRows = useMemo(() => dedupeLatestByConversation(rawRows), [rawRows]);

  const supervisorLookup = useMemo(
    () => buildSupervisorLookup(supervisorTeams),
    [supervisorTeams]
  );

  const employees = useMemo(() => uniqueValues(dedupedRows, "employee_name"), [dedupedRows]);

  const reviewOptions = REVIEW_SENTIMENT_ORDER;
  const clientOptions = CLIENT_SENTIMENT_ORDER;
  const resolutionOptions = RESOLUTION_ORDER;

  const filteredRows = useMemo(
    () => filterRows(dedupedRows, globalFilters, supervisorLookup),
    [dedupedRows, globalFilters, supervisorLookup]
  );

  const leaderboardFilteredRows = useMemo(
    () => filterRows(dedupedRows, leaderboardFilters, supervisorLookup),
    [dedupedRows, leaderboardFilters, supervisorLookup]
  );

  const reviewEntries = useMemo(
    () => countRowsBy(filteredRows, (row) => row.review_sentiment, REVIEW_SENTIMENT_ORDER).filter((entry) => REVIEW_SENTIMENT_ORDER.includes(entry.label)),
    [filteredRows]
  );

  const clientEntries = useMemo(
    () => countRowsBy(filteredRows, (row) => row.client_sentiment, CLIENT_SENTIMENT_ORDER).filter((entry) => CLIENT_SENTIMENT_ORDER.includes(entry.label)),
    [filteredRows]
  );

  const resolutionEntries = useMemo(
    () => countRowsBy(filteredRows, (row) => row.resolution_status, RESOLUTION_ORDER).filter((entry) => RESOLUTION_ORDER.includes(entry.label)),
    [filteredRows]
  );

  const resultTypeEntries = useMemo(
    () => countRowsBy(filteredRows, (row) => deriveResultType(row.review_sentiment), RESULT_TYPE_OPTIONS),
    [filteredRows]
  );

  const leaderboard = useMemo(() => buildLeaderboard(leaderboardFilteredRows), [leaderboardFilteredRows]);

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
        supervisorTeams={supervisorTeams}
        supervisorLookup={supervisorLookup}
        employees={employees}
        reviewOptions={reviewOptions}
        clientOptions={clientOptions}
        resolutionOptions={resolutionOptions}
      />

      <div className="dashboard-shell">
        <section className="hero-panel">
          <div className="hero-copy">
            <p>Dashboard intelligence</p>
            <h1>Review approach & client sentiment tracking</h1>
            <strong>QA intelligence command center</strong>
            <span>Latest stored result: {formatDateTime(latestStoredAt)}</span>
          </div>

          <div className="hero-command-card">
            <div>
              <span>Current view</span>
              <strong>{formatNumber(total)} conversations</strong>
              <small>{getRangeDisplay(globalFilters)} · {globalFilters.cexOnly ? "CEx only" : "All teams"}</small>
            </div>

            <div className="hero-metric-grid">
              <span>
                <b>{formatNumber(missedCount)}</b>
                Missed
              </span>
              <span>
                <b>{formatPercent(total ? (resolvedCount / total) * 100 : 0)}</b>
                Resolved
              </span>
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
          </div>
        </section>

        <DashboardFilterBar
          filters={globalFilters}
          setFilters={setGlobalFilters}
          supervisorTeams={supervisorTeams}
          employees={employees}
          reviewOptions={reviewOptions}
          clientOptions={clientOptions}
          resolutionOptions={resolutionOptions}
          showMapping
          resetTo={() => createBaseFilters("past_30_days", true)}
        />

        <section className="kpi-grid">
          <KPIStat
            label="Unique conversations"
            value={formatNumber(total)}
            accent="linear-gradient(135deg, rgba(37,99,235,0.26), rgba(99,102,241,0.12))"
            onClick={() => openDetail("KPI drill in", "Unique conversations", filteredRows)}
          />
          <KPIStat
            label="Missed opportunities"
            value={formatNumber(missedCount)}
            accent="linear-gradient(135deg, rgba(239,68,68,0.25), rgba(249,115,22,0.12))"
            onClick={() =>
              openDetail(
                "KPI drill in",
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
                "KPI drill in",
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
                "KPI drill in",
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
                "KPI drill in",
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
                "KPI drill in",
                "Mapped records",
                filteredRows.filter(isMapped)
              )
            }
          />
        </section>

        {loading ? (
          <section className="panel loading-panel">
            <p className="panel-eyebrow">Loading</p>
            <h2>Preparing the intelligence view...</h2>
            <p className="muted">Reading stored audit results and Supervisor Teams from Supabase.</p>
          </section>
        ) : error ? (
          <section className="panel">
            <div className="error-box">{error}</div>
          </section>
        ) : (
          <>
            <section className="insight-strip">
              <div>
                <span>Active date range</span>
                <strong>{getRangeDisplay(globalFilters)}</strong>
              </div>
              <div>
                <span>Filtered records</span>
                <strong>{formatNumber(filteredRows.length)}</strong>
              </div>
              <div>
                <span>Leaderboard scope</span>
                <strong>{getRangeDisplay(leaderboardFilters)}</strong>
              </div>
              <div>
                <span>Supervisor teams</span>
                <strong>{formatNumber(supervisorTeams.length)}</strong>
              </div>
            </section>

            <section className="chart-grid">
              <ChartCard
                title="Review sentiment"
                subtitle={`${formatNumber(filteredRows.length)} filtered conversations`}
                onDrill={() => openDetail("Review sentiment drill in", "All review sentiments", filteredRows)}
              >
                <HorizontalBarChart
                  entries={reviewEntries}
                  total={filteredRows.length}
                  kind="review"
                  onSelect={(entry) => openDetail("Review sentiment drill in", entry.label, entry.rows)}
                />
              </ChartCard>

              <ChartCard
                title="Result type mix"
                subtitle="Positive, opportunity, risk, and other"
                larger
                onDrill={() => openDetail("Result type drill in", "All result types", filteredRows)}
              >
                <DonutChart
                  entries={resultTypeEntries}
                  total={filteredRows.length}
                  onSelect={(entry) => openDetail("Result type drill in", entry.label, entry.rows)}
                />
              </ChartCard>

              <ChartCard
                title="Client sentiment"
                subtitle="Client emotional outcome"
                onDrill={() => openDetail("Client sentiment drill in", "All client sentiments", filteredRows)}
              >
                <HorizontalBarChart
                  entries={clientEntries}
                  total={filteredRows.length}
                  kind="client"
                  onSelect={(entry) => openDetail("Client sentiment drill in", entry.label, entry.rows)}
                />
              </ChartCard>

              <ChartCard
                title="Resolution share"
                subtitle="Resolved, pending, unclear, unresolved"
                larger
                onDrill={() => openDetail("Resolution drill in", "All resolution statuses", filteredRows)}
              >
                <DonutChart
                  entries={resolutionEntries}
                  total={filteredRows.length}
                  onSelect={(entry) => openDetail("Resolution drill in", entry.label, entry.rows)}
                />
              </ChartCard>
            </section>

            <section className="panel leaderboard-panel">
              <div className="section-title-row">
                <div>
                  <p>Performance command</p>
                  <h2>Agent leaderboard</h2>
                  <span>Use date, supervisor, employee, and outcome filters to rank agents for the selected period.</span>
                </div>

                <button type="button" className="secondary-btn" onClick={() => downloadCsv(leaderboardFilteredRows, "leaderboard-filtered-results.csv")}>
                  Export filtered CSV
                </button>
              </div>

              <DashboardFilterBar
                filters={leaderboardFilters}
                setFilters={setLeaderboardFilters}
                supervisorTeams={supervisorTeams}
                employees={employees}
                reviewOptions={reviewOptions}
                clientOptions={clientOptions}
                resolutionOptions={resolutionOptions}
                showMapping={false}
                resetTo={() => createBaseFilters("past_30_days", true)}
              />

              <div className="leaderboard-cards">
                {[
                  {
                    title: "Top likely positive reviews",
                    theme: "green",
                    rows: [...leaderboard].sort((a, b) => b.likelyPositive - a.likelyPositive).slice(0, 5),
                    value: (row) => formatNumber(row.likelyPositive),
                    rowsFor: (row) => row.rows.filter(isLikelyPositiveReview),
                  },
                  {
                    title: "Top missed opportunities",
                    theme: "red",
                    rows: [...leaderboard].sort((a, b) => b.missed - a.missed).slice(0, 5),
                    value: (row) => formatNumber(row.missed),
                    rowsFor: (row) => row.rows.filter((item) => item.review_sentiment === "Missed Opportunity"),
                  },
                  {
                    title: "Top very positive",
                    theme: "green",
                    rows: [...leaderboard].sort((a, b) => b.veryPositive - a.veryPositive).slice(0, 5),
                    value: (row) => formatNumber(row.veryPositive),
                    rowsFor: (row) => row.rows.filter((item) => item.client_sentiment === "Very Positive"),
                  },
                  {
                    title: "Top likely negative reviews",
                    theme: "red",
                    rows: [...leaderboard].sort((a, b) => b.likelyNegative - a.likelyNegative).slice(0, 5),
                    value: (row) => formatNumber(row.likelyNegative),
                    rowsFor: (row) => row.rows.filter(isLikelyNegativeReview),
                  },
                ].map((block) => (
                  <div key={block.title} className={`mini-rank-card ${block.theme}`}>
                    <h3>{block.title}</h3>
                    {block.rows.length ? (
                      block.rows.map((row) => (
                        <button
                          key={`${block.title}-${row.employee}`}
                          type="button"
                          onClick={() => openDetail("Leaderboard drill in", `${block.title}: ${row.employee}`, block.rowsFor(row))}
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

              <div className="table-wrap leaderboard-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Team</th>
                      <th>Handled</th>
                      <th>Likely positive</th>
                      <th>Missed</th>
                      <th>Very positive</th>
                      <th>Likely negative</th>
                      <th>Resolution rate</th>
                      <th>Drill in</th>
                    </tr>
                  </thead>

                  <tbody>
                    {leaderboard.map((row) => (
                      <tr key={row.employee}>
                        <td>
                          <button type="button" className="text-link" onClick={() => openDetail("Employee drill in", row.employee, row.rows)}>
                            {row.employee}
                          </button>
                        </td>
                        <td>{row.team || "-"}</td>
                        <td>{formatNumber(row.handled)}</td>
                        <td className="good">{formatNumber(row.likelyPositive)}</td>
                        <td className="bad">{formatNumber(row.missed)}</td>
                        <td className="good">{formatNumber(row.veryPositive)}</td>
                        <td className="bad">{formatNumber(row.likelyNegative)}</td>
                        <td>{formatPercent(row.resolutionRate)}</td>
                        <td>
                          <button type="button" className="small-btn" onClick={() => openDetail("Employee drill in", row.employee, row.rows)}>
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
              rows={dedupedRows}
              filters={weeklyFilters}
              setFilters={setWeeklyFilters}
              metric={weeklyMetric}
              setMetric={setWeeklyMetric}
              supervisorTeams={supervisorTeams}
              supervisorLookup={supervisorLookup}
              employees={employees}
              reviewOptions={reviewOptions}
              clientOptions={clientOptions}
              resolutionOptions={resolutionOptions}
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

      {showJumpTop ? (
        <button type="button" className="jump-top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          Jump to top
        </button>
      ) : null}
    </main>
  );
}

const dashboardStyles = `
  .dashboard-page {
    min-height: 100vh;
    padding: 22px 18px 76px;
    color: #f5f7ff;
    background:
      radial-gradient(circle at 8% 0%, rgba(37, 99, 235, 0.14), transparent 24%),
      radial-gradient(circle at 88% 2%, rgba(139, 92, 246, 0.17), transparent 26%),
      radial-gradient(circle at 48% 100%, rgba(6, 182, 212, 0.08), transparent 24%),
      linear-gradient(180deg, #040714 0%, #050918 46%, #04060d 100%);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .dashboard-shell {
    width: min(1440px, 100%);
    margin: 0 auto;
  }

  .hero-panel,
  .filter-panel,
  .panel,
  .chart-card,
  .kpi-card,
  .insight-strip {
    border: 1px solid rgba(255, 255, 255, 0.08);
    background:
      linear-gradient(180deg, rgba(14, 20, 40, 0.92), rgba(7, 10, 24, 0.96));
    box-shadow:
      0 24px 80px rgba(0, 0, 0, 0.34),
      inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }

  .hero-panel {
    position: relative;
    overflow: hidden;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(310px, 390px);
    gap: 22px;
    align-items: stretch;
    padding: 30px;
    border-radius: 30px;
    margin-bottom: 18px;
  }

  .hero-panel::before {
    content: "";
    position: absolute;
    inset: -160px auto auto -130px;
    width: 390px;
    height: 390px;
    border-radius: 999px;
    background: rgba(37, 99, 235, 0.14);
    filter: blur(62px);
    pointer-events: none;
  }

  .hero-panel::after {
    content: "";
    position: absolute;
    inset: -150px -130px auto auto;
    width: 460px;
    height: 460px;
    border-radius: 999px;
    background: rgba(124, 58, 237, 0.22);
    filter: blur(58px);
    pointer-events: none;
  }

  .hero-panel > * {
    position: relative;
    z-index: 1;
  }

  .hero-copy {
    align-self: center;
  }

  .hero-panel p,
  .section-title-row p,
  .modal-head p,
  .panel-eyebrow {
    margin: 0 0 10px;
    color: #8ea0d6;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .hero-panel h1 {
    max-width: 930px;
    margin: 0 0 12px;
    font-size: clamp(44px, 5vw, 76px);
    line-height: 0.96;
    letter-spacing: -0.075em;
  }

  .hero-panel strong {
    display: block;
    margin-bottom: 8px;
    color: #ffffff;
    font-size: 28px;
    letter-spacing: -0.04em;
  }

  .hero-panel span,
  .section-title-row span,
  .muted {
    color: #a9b4d0;
    font-size: 14px;
    line-height: 1.7;
  }

  .hero-command-card {
    display: grid;
    gap: 16px;
    align-content: center;
    padding: 20px;
    border-radius: 24px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background:
      radial-gradient(circle at top right, rgba(139, 92, 246, 0.16), transparent 42%),
      rgba(255, 255, 255, 0.04);
  }

  .hero-command-card > div:first-child span,
  .hero-command-card small {
    display: block;
  }

  .hero-command-card > div:first-child span {
    margin: 0 0 8px;
    color: #8ea0d6;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .hero-command-card > div:first-child strong {
    margin: 0 0 6px;
    font-size: 30px;
  }

  .hero-command-card small {
    color: #a9b4d0;
    line-height: 1.6;
  }

  .hero-metric-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .hero-metric-grid span {
    display: block;
    padding: 13px;
    border-radius: 16px;
    color: #a9b4d0;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.035);
    font-size: 13px;
    font-weight: 800;
  }

  .hero-metric-grid b {
    display: block;
    margin-bottom: 4px;
    color: #f5f7ff;
    font-size: 22px;
    letter-spacing: -0.04em;
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
    transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, opacity 0.18s ease;
  }

  .primary-link:hover,
  .secondary-link:hover,
  .primary-btn:hover,
  .secondary-btn:hover,
  .drill-btn:hover,
  .small-btn:hover,
  .jump-top:hover {
    transform: translateY(-1px);
  }

  .primary-link,
  .primary-btn {
    color: #fff;
    border: 0;
    background: linear-gradient(135deg, #2563eb 0%, #7c3aed 52%, #db2777 100%);
    box-shadow: 0 16px 34px rgba(91, 33, 182, 0.34);
  }

  .secondary-link,
  .secondary-btn,
  .drill-btn,
  .small-btn {
    color: #e5ebff;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
  }

  .light-btn {
    color: #0f172a;
    border: 0;
    background: #ffffff;
  }

  .filter-panel {
    position: relative;
    padding: 18px;
    border-radius: 28px;
    margin-bottom: 18px;
    z-index: 100;
    isolation: isolate;
  }

  .leaderboard-panel,
  .weekly-panel,
  .modal-filter-block {
    overflow: visible;
  }

  .leaderboard-panel .filter-panel,
  .weekly-panel .filter-panel,
  .modal-filter-block .filter-panel {
    z-index: 300;
  }

  .leaderboard-cards,
  .weekly-table-wrap,
  .table-wrap {
    position: relative;
    z-index: 1;
  }

  .filter-row {
    display: grid;
    gap: 12px;
    align-items: end;
  }

  .filter-row.first {
    grid-template-columns: minmax(300px, 1.45fr) minmax(240px, 1fr) minmax(240px, 1fr) auto;
    margin-bottom: 12px;
  }

  .filter-row.second {
    grid-template-columns: repeat(5, minmax(0, 1fr)) auto;
  }

  label span,
  .custom-range-panel small {
    display: block;
    margin-bottom: 7px;
    color: #8ea0d6;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.13em;
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
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 15px;
    outline: none;
    background: rgba(5, 8, 18, 0.9);
    padding: 0 13px;
    color-scheme: dark;
  }

  input:focus,
  select:focus,
  .date-picker-button:focus,
  .multi-button:focus {
    border-color: rgba(96, 165, 250, 0.38);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
  }

  .cex-check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: #dbe7ff;
    font-size: 14px;
    font-weight: 900;
    padding-bottom: 10px;
    white-space: nowrap;
  }

  .cex-check input {
    width: auto;
    min-height: auto;
  }

  .date-picker-wrap,
  .multi-wrap {
    position: relative;
  }

  .date-picker-button,
  .multi-button {
    width: 100%;
    min-height: 48px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 0 14px;
    color: #e7ecff;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 15px;
    background: rgba(5, 8, 18, 0.9);
    cursor: pointer;
    text-align: left;
  }

  .date-picker-button strong,
  .multi-button strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .date-picker-button b,
  .multi-button b {
    color: #8ea0d6;
    font-size: 11px;
  }

  .date-picker-popover,
  .multi-menu {
    position: absolute;
    top: calc(100% + 10px);
    left: 0;
    z-index: 2000;
    overflow: hidden;
    border-radius: 22px;
    border: 1px solid rgba(147, 197, 253, 0.26);
    background: #0b1122;
    box-shadow:
      0 28px 90px rgba(0, 0, 0, 0.78),
      0 0 0 1px rgba(255, 255, 255, 0.04),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
    backdrop-filter: none;
  }

  .date-picker-popover::before,
  .multi-menu::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    background:
      radial-gradient(circle at top right, rgba(124, 58, 237, 0.14), transparent 35%),
      linear-gradient(180deg, #101827 0%, #0b1122 100%);
  }

  .date-picker-popover {
    width: min(760px, 92vw);
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
  }

  .multi-menu {
    width: min(360px, 88vw);
    padding: 10px;
  }

  .multi-menu input {
    margin-bottom: 8px;
  }

  .multi-options {
    display: grid;
    gap: 6px;
    max-height: 260px;
    overflow: auto;
  }

  .multi-option {
    width: 100%;
    min-height: 38px;
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 8px;
    align-items: center;
    border: 1px solid transparent;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.015);
    color: #e5ebff;
    padding: 0 10px;
    text-align: left;
    cursor: pointer;
  }

  .multi-option span {
    color: #8ea0d6;
    font-size: 11px;
    font-weight: 900;
  }

  .multi-option strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .multi-option.active,
  .multi-option:hover,
  .multi-option.all:hover {
    border-color: rgba(96, 165, 250, 0.22);
    background: rgba(59, 130, 246, 0.16);
  }

  .multi-option.active span {
    color: #34d399;
  }

  .multi-empty {
    padding: 12px;
    color: #a9b4d0;
    border: 1px dashed rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.025);
    font-size: 13px;
  }

  .date-preset-list {
    position: relative;
    z-index: 1;
    padding: 10px;
    border-right: 1px solid rgba(255, 255, 255, 0.08);
    background: #0b1122;
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
    font-weight: 900;
    text-align: left;
  }

  .date-preset-list button.active,
  .date-preset-list button:hover {
    background: rgba(255, 255, 255, 0.07);
  }

  .date-preset-list b {
    color: #f97316;
    font-size: 11px;
  }

  .custom-range-panel {
    position: relative;
    z-index: 1;
    padding: 18px;
    background: #101827;
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

  .insight-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0;
    overflow: hidden;
    margin-bottom: 18px;
    border-radius: 24px;
  }

  .insight-strip div {
    padding: 18px;
    border-right: 1px solid rgba(255, 255, 255, 0.07);
  }

  .insight-strip div:last-child {
    border-right: 0;
  }

  .insight-strip span,
  .insight-strip strong {
    display: block;
  }

  .insight-strip span {
    margin-bottom: 8px;
    color: #8ea0d6;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  .insight-strip strong {
    color: #f5f7ff;
    font-size: 20px;
    letter-spacing: -0.035em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 14px;
    margin-bottom: 18px;
  }

  .kpi-card {
    position: relative;
    overflow: hidden;
    min-height: 124px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    border-radius: 24px;
    padding: 18px;
    color: #ffffff;
    cursor: pointer;
    text-align: left;
    background: var(--accent);
    transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
  }

  .kpi-card::after {
    content: "";
    position: absolute;
    inset: -80px -80px auto auto;
    width: 160px;
    height: 160px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    filter: blur(24px);
  }

  .kpi-card:hover {
    transform: translateY(-2px);
    border-color: rgba(255, 255, 255, 0.14);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.42);
  }

  .kpi-card span,
  .kpi-card strong,
  .kpi-card small {
    position: relative;
    z-index: 1;
  }

  .kpi-card span {
    color: #c4d0ff;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .kpi-card strong {
    font-size: 38px;
    line-height: 1;
    letter-spacing: -0.05em;
  }

  .kpi-card small {
    color: #d6ddff;
    font-size: 12px;
    font-weight: 900;
  }

  .chart-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.12fr);
    gap: 18px;
    margin-bottom: 18px;
  }

  .chart-card,
  .panel {
    position: relative;
    overflow: visible;
    border-radius: 28px;
    padding: 20px;
  }

  .chart-card {
    overflow: hidden;
  }

  .chart-card::before,
  .panel::before {
    content: "";
    position: absolute;
    inset: -110px auto auto -110px;
    width: 250px;
    height: 250px;
    border-radius: 999px;
    background: rgba(59, 130, 246, 0.06);
    filter: blur(42px);
    pointer-events: none;
  }

  .chart-card > *,
  .panel > * {
    position: relative;
    z-index: 1;
  }

  .chart-card.large {
    min-height: 430px;
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
    font-size: 26px;
    letter-spacing: -0.045em;
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
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
    padding: 13px;
    color: #eef3ff;
    cursor: pointer;
    transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
  }

  .bar-item:hover {
    transform: translateY(-1px);
    border-color: rgba(96, 165, 250, 0.24);
    background: rgba(59, 130, 246, 0.06);
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
    background: rgba(255, 255, 255, 0.06);
  }

  .bar-fill {
    height: 100%;
    border-radius: 999px;
  }

  .donut-layout {
    display: grid;
    grid-template-columns: 300px minmax(0, 1fr);
    gap: 22px;
    align-items: center;
    min-height: 320px;
  }

  .donut {
    width: 300px;
    height: 300px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.35);
  }

  .donut-hole {
    width: 58%;
    height: 58%;
    display: grid;
    place-items: center;
    text-align: center;
    border-radius: 50%;
    background: linear-gradient(180deg, rgba(12, 18, 34, 0.98), rgba(7, 10, 22, 1));
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .donut-hole strong {
    display: block;
    font-size: 36px;
    letter-spacing: -0.04em;
  }

  .donut-hole span {
    display: block;
    color: #8ea0d6;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.1em;
    text-transform: uppercase;
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
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
    color: #eef3ff;
    cursor: pointer;
    text-align: left;
    transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
  }

  .donut-legend button:hover {
    transform: translateY(-1px);
    border-color: rgba(96, 165, 250, 0.24);
    background: rgba(59, 130, 246, 0.06);
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

  .leaderboard-panel {
    margin-bottom: 18px;
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
    border-radius: 22px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
    padding: 16px;
  }

  .mini-rank-card.green {
    background:
      radial-gradient(circle at top left, rgba(16, 185, 129, 0.12), transparent 36%),
      linear-gradient(180deg, rgba(16, 185, 129, 0.08), rgba(255, 255, 255, 0.025));
  }

  .mini-rank-card.red {
    background:
      radial-gradient(circle at top left, rgba(239, 68, 68, 0.13), transparent 36%),
      linear-gradient(180deg, rgba(239, 68, 68, 0.09), rgba(255, 255, 255, 0.025));
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
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(255, 255, 255, 0.025);
    color: #eef3ff;
    padding: 12px;
    cursor: pointer;
    transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
  }

  .mini-rank-card button:hover {
    transform: translateY(-1px);
    border-color: rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.045);
  }

  .mini-rank-card button span {
    color: #ffffff;
    font-weight: 900;
  }

  .mini-rank-card button small {
    color: #8ea0d6;
    font-weight: 900;
  }

  .leaderboard-table-wrap {
    max-height: 660px;
  }

  .table-wrap,
  .weekly-table-wrap,
  .modal-table-wrap {
    overflow: auto;
    border-radius: 22px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(4, 8, 20, 0.72);
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
    background: rgba(10, 18, 34, 0.96);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  td {
    padding: 14px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    color: #e5ebff;
    vertical-align: top;
  }

  tr:nth-child(even) td {
    background: rgba(255, 255, 255, 0.018);
  }

  tr:hover td {
    background: rgba(59, 130, 246, 0.035);
  }

  td.good {
    color: #bbf7d0;
    font-weight: 900;
  }

  td.bad {
    color: #fecdd3;
    font-weight: 900;
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
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.03);
    font-weight: 900;
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
    min-width: 260px;
  }

  .weekly-table-wrap {
    max-height: 620px;
  }

  .sticky-col {
    position: sticky;
    left: 0;
    z-index: 3;
    background: rgba(10, 18, 34, 0.98);
  }

  td.sticky-col {
    background: rgba(7, 12, 25, 0.98);
  }

  .metric-cell {
    width: 100%;
    min-height: 36px;
    border-radius: 12px;
    color: #7684a7;
    border: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(255, 255, 255, 0.025);
    cursor: default;
    font-weight: 900;
  }

  .metric-cell.has-data {
    color: #ffffff;
    cursor: pointer;
    border-color: rgba(96, 165, 250, 0.18);
    background: linear-gradient(135deg, rgba(37, 99, 235, 0.22), rgba(168, 85, 247, 0.14));
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200000;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgba(2, 5, 14, 0.76);
    backdrop-filter: blur(14px);
  }

  .drill-modal {
    position: relative;
    z-index: 200001;
    width: min(1440px, 96vw);
    max-height: 92vh;
    overflow: visible;
    border-radius: 28px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: linear-gradient(180deg, rgba(15, 22, 43, 0.98), rgba(7, 10, 24, 0.99));
    box-shadow: 0 30px 90px rgba(0, 0, 0, 0.58);
  }

  .modal-head {
    display: flex;
    justify-content: space-between;
    gap: 18px;
    padding: 22px 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
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

  .modal-filter-block {
    position: relative;
    z-index: 30;
    padding: 16px 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    background: #0b1122;
  }

  .modal-filter-block .filter-panel {
    position: relative;
    z-index: 40;
    isolation: auto;
    padding: 0;
    margin: 0 0 12px;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }

  .modal-filter-block .filter-row.first {
    grid-template-columns: minmax(260px, 1.2fr) minmax(210px, 1fr) minmax(210px, 1fr) auto;
  }

  .modal-filter-block .filter-row.second {
    grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
  }

  .modal-filter-block .date-picker-popover,
  .modal-filter-block .multi-menu {
    z-index: 200010;
  }

  .modal-search {
    display: block;
  }

  .modal-table-wrap {
    position: relative;
    z-index: 1;
    max-height: calc(92vh - 360px);
    border-radius: 0 0 28px 28px;
    border-left: 0;
    border-right: 0;
    border-bottom: 0;
  }

  .table-note,
  .empty-box {
    padding: 18px;
    color: #a9b4d0;
    border-radius: 16px;
    border: 1px dashed rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.02);
  }

  .empty-box.compact {
    padding: 12px;
  }

  .error-box {
    border-radius: 18px;
    border: 1px solid rgba(244, 63, 94, 0.22);
    background: rgba(244, 63, 94, 0.08);
    padding: 16px;
    color: #fecdd3;
  }

  .loading-panel {
    padding: 34px;
  }

  .explorer-panel {
    margin-top: 18px;
  }

  .jump-top {
    position: fixed;
    right: 22px;
    bottom: 22px;
    z-index: 1500;
    min-height: 46px;
    padding: 0 16px;
    border-radius: 999px;
    border: 1px solid rgba(59, 130, 246, 0.22);
    background: rgba(8, 13, 28, 0.92);
    color: #dbeafe;
    font: inherit;
    font-size: 13px;
    font-weight: 900;
    cursor: pointer;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.34);
  }

  @media (max-width: 1250px) {
    .hero-panel {
      grid-template-columns: 1fr;
    }

    .filter-row.first,
    .filter-row.second,
    .kpi-grid,
    .leaderboard-cards,
    .insight-strip {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .chart-grid {
      grid-template-columns: 1fr;
    }

    .donut-layout {
      grid-template-columns: 1fr;
      justify-items: center;
    }
  }

  @media (max-width: 760px) {
    .dashboard-page {
      padding: 18px 12px 60px;
    }

    .hero-panel,
    .chart-head,
    .section-title-row,
    .modal-head {
      flex-direction: column;
      align-items: stretch;
    }

    .hero-panel {
      padding: 24px;
    }

    .filter-row.first,
    .filter-row.second,
    .kpi-grid,
    .leaderboard-cards,
    .custom-range-grid,
    .insight-strip,
    .hero-metric-grid {
      grid-template-columns: 1fr;
    }

    .insight-strip div {
      border-right: 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    }

    .insight-strip div:last-child {
      border-bottom: 0;
    }

    .date-picker-popover {
      width: 92vw;
      grid-template-columns: 1fr;
    }

    .modal-filter-block .filter-row.first,
    .modal-filter-block .filter-row.second {
      grid-template-columns: 1fr;
    }

    .date-preset-list {
      border-right: 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .hero-panel h1 {
      font-size: 42px;
    }

    .hero-panel strong {
      font-size: 24px;
    }

    .donut {
      width: 240px;
      height: 240px;
    }

    .primary-link,
    .secondary-link,
    .primary-btn,
    .secondary-btn {
      width: 100%;
    }
  }
`;
