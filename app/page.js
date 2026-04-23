"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";

const INTERCOM_BASE_URL =
  "https://app.intercom.com/a/inbox/aphmhtyj/inbox/conversation";

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

const RANGE_PRESETS = [
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "180d", label: "180D" },
  { key: "365d", label: "1Y" },
  { key: "all", label: "All" },
];

const TREND_GROUP_OPTIONS = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

function normalizeText(value, fallback = "-") {
  const text = String(value || "").trim();
  return text || fallback;
}

function toDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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

function getNow() {
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  return now;
}

function getPresetStartDate(presetKey, endDate) {
  if (presetKey === "all") return null;
  const daysMap = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
    "180d": 180,
    "365d": 365,
  };
  const days = daysMap[presetKey] || 30;
  const start = new Date(endDate);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  return start;
}

function buildDateRange(rangePreset, startDate, endDate) {
  const end = endDate ? toDate(`${endDate}T23:59:59`) : getNow();
  const safeEnd = end || getNow();

  if (rangePreset === "all") {
    return { start: null, end: safeEnd };
  }

  if (startDate || endDate) {
    const start = startDate ? toDate(`${startDate}T00:00:00`) : null;
    return { start, end: safeEnd };
  }

  return {
    start: getPresetStartDate(rangePreset, safeEnd),
    end: safeEnd,
  };
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
    const aTs = toDate(a?.created_at)?.getTime() || 0;
    const bTs = toDate(b?.created_at)?.getTime() || 0;
    return bTs - aTs;
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

function filterRows(rows, filters) {
  const { start, end } = buildDateRange(
    filters.rangePreset,
    filters.startDate,
    filters.endDate
  );

  return (rows || []).filter((row) => {
    const created = toDate(row?.created_at);

    if (start && created && created < start) return false;
    if (end && created && created > end) return false;

    if (filters.team !== "all" && row?.team_name !== filters.team) return false;
    if (filters.employee !== "all" && row?.employee_name !== filters.employee) return false;
    if (filters.reviewSentiment !== "all" && row?.review_sentiment !== filters.reviewSentiment)
      return false;
    if (filters.clientSentiment !== "all" && row?.client_sentiment !== filters.clientSentiment)
      return false;
    if (filters.resolutionStatus !== "all" && row?.resolution_status !== filters.resolutionStatus)
      return false;
    if (
      filters.resultType !== "all" &&
      deriveResultType(row?.review_sentiment) !== filters.resultType
    )
      return false;
    if (filters.cexOnly && row?.team_name !== "CEx") return false;

    return true;
  });
}

function sectionRangeRows(rows, sectionFilters) {
  const { start, end } = buildDateRange(
    sectionFilters.rangePreset,
    sectionFilters.startDate,
    sectionFilters.endDate
  );

  return (rows || []).filter((row) => {
    const created = toDate(row?.created_at);
    if (start && created && created < start) return false;
    if (end && created && created > end) return false;

    if (sectionFilters.team !== "all" && row?.team_name !== sectionFilters.team) return false;
    if (sectionFilters.employee !== "all" && row?.employee_name !== sectionFilters.employee)
      return false;
    if (
      sectionFilters.reviewSentiment !== "all" &&
      row?.review_sentiment !== sectionFilters.reviewSentiment
    )
      return false;
    if (
      sectionFilters.clientSentiment !== "all" &&
      row?.client_sentiment !== sectionFilters.clientSentiment
    )
      return false;
    if (
      sectionFilters.resolutionStatus !== "all" &&
      row?.resolution_status !== sectionFilters.resolutionStatus
    )
      return false;
    if (
      sectionFilters.resultType !== "all" &&
      deriveResultType(row?.review_sentiment) !== sectionFilters.resultType
    )
      return false;

    return true;
  });
}

function countBy(rows, key) {
  const map = new Map();

  for (const row of rows || []) {
    const label = normalizeText(row?.[key], "Unknown");
    map.set(label, (map.get(label) || 0) + 1);
  }

  return map;
}

function orderedEntries(map, preferredOrder = []) {
  const orderMap = new Map(preferredOrder.map((item, index) => [item, index]));

  return Array.from(map.entries()).sort((a, b) => {
    const aIndex = orderMap.has(a[0]) ? orderMap.get(a[0]) : 9999;
    const bIndex = orderMap.has(b[0]) ? orderMap.get(b[0]) : 9999;

    if (aIndex !== bIndex) return aIndex - bIndex;
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function buildWeeklyData(rows) {
  const map = new Map();

  for (const row of rows || []) {
    const created = toDate(row?.created_at);
    if (!created) continue;

    const weekStart = getWeekStart(created);
    const key = weekStart.toISOString();

    const current = map.get(key) || {
      key,
      weekStart,
      label: `Week of ${weekStart.toLocaleDateString(undefined, {
        month: "short",
        day: "2-digit",
      })}`,
      total: 0,
      missed: 0,
      positive: 0,
      veryPositive: 0,
      unresolved: 0,
      rows: [],
    };

    current.total += 1;
    if (row?.review_sentiment === "Missed Opportunity") current.missed += 1;
    if (
      row?.review_sentiment === "Likely Positive Review" ||
      row?.review_sentiment === "Highly Likely Positive Review"
    ) {
      current.positive += 1;
    }
    if (row?.client_sentiment === "Very Positive") current.veryPositive += 1;
    if (row?.resolution_status === "Unresolved") current.unresolved += 1;
    current.rows.push(row);

    map.set(key, current);
  }

  return Array.from(map.values()).sort(
    (a, b) => b.weekStart.getTime() - a.weekStart.getTime()
  );
}

function buildTrendData(rows, groupBy) {
  const map = new Map();

  for (const row of rows || []) {
    const created = toDate(row?.created_at);
    if (!created) continue;

    let key = "";
    let label = "";

    if (groupBy === "month") {
      key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}`;
      label = created.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
      });
    } else if (groupBy === "week") {
      const weekStart = getWeekStart(created);
      key = weekStart.toISOString().slice(0, 10);
      label = `Week of ${weekStart.toLocaleDateString(undefined, {
        month: "short",
        day: "2-digit",
      })}`;
    } else {
      key = created.toISOString().slice(0, 10);
      label = created.toLocaleDateString(undefined, {
        month: "short",
        day: "2-digit",
      });
    }

    const current = map.get(key) || {
      key,
      label,
      total: 0,
      missed: 0,
      positive: 0,
      unresolved: 0,
      veryPositive: 0,
      rows: [],
    };

    current.total += 1;
    if (row?.review_sentiment === "Missed Opportunity") current.missed += 1;
    if (
      row?.review_sentiment === "Likely Positive Review" ||
      row?.review_sentiment === "Highly Likely Positive Review"
    ) {
      current.positive += 1;
    }
    if (row?.client_sentiment === "Very Positive") current.veryPositive += 1;
    if (row?.resolution_status === "Unresolved") current.unresolved += 1;
    current.rows.push(row);

    map.set(key, current);
  }

  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
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
      sampleRow: row,
      rows: [],
    };

    current.handled += 1;
    if (row?.review_sentiment === "Missed Opportunity") current.missed += 1;
    if (row?.client_sentiment === "Very Positive") current.veryPositive += 1;
    if (row?.resolution_status === "Unresolved") current.unresolved += 1;
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
      opportunityRate: item.handled ? (item.missed / item.handled) * 100 : 0,
      positiveRate: item.handled ? (item.positiveReview / item.handled) * 100 : 0,
      riskRate: item.handled ? (item.unresolved / item.handled) * 100 : 0,
    }))
    .sort((a, b) => {
      if (b.handled !== a.handled) return b.handled - a.handled;
      return a.employee.localeCompare(b.employee);
    });
}

function buildPieSegments(entries, palette) {
  const total = entries.reduce((sum, [, count]) => sum + count, 0) || 1;
  let cumulative = 0;

  return entries.map(([label, count], index) => {
    const value = (count / total) * 100;
    const start = cumulative;
    cumulative += value;
    return {
      label,
      count,
      percent: value,
      color: palette[index % palette.length],
      start,
      end: cumulative,
    };
  });
}

function buildConicGradient(segments) {
  if (!segments.length) return "conic-gradient(#1f2937 0 100%)";

  const parts = segments.map(
    (segment) =>
      `${segment.color} ${segment.start.toFixed(2)}% ${segment.end.toFixed(2)}%`
  );

  return `conic-gradient(${parts.join(", ")})`;
}

function resultTypePalette(resultType) {
  if (resultType === "Opportunity") return "#f59e0b";
  if (resultType === "Positive") return "#10b981";
  if (resultType === "Risk") return "#ef4444";
  return "#8b5cf6";
}

function createBaseSectionFilters() {
  return {
    rangePreset: "30d",
    startDate: "",
    endDate: "",
    team: "all",
    employee: "all",
    reviewSentiment: "all",
    clientSentiment: "all",
    resolutionStatus: "all",
    resultType: "all",
  };
}

function createGlobalFilters() {
  return {
    rangePreset: "30d",
    startDate: "",
    endDate: "",
    team: "all",
    employee: "all",
    reviewSentiment: "all",
    clientSentiment: "all",
    resolutionStatus: "all",
    resultType: "all",
    cexOnly: true,
  };
}

function SectionFilterRow({
  title,
  filters,
  setFilters,
  teams,
  employees,
  reviewSentiments,
  clientSentiments,
  resolutionStatuses,
  showTrendGroup = false,
  trendGroup,
  setTrendGroup,
}) {
  const inputStyle = {
    width: "100%",
    minHeight: "42px",
    borderRadius: "14px",
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(5,8,18,0.86)",
    color: "#e7ecff",
    padding: "0 12px",
    fontSize: "13px",
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle = {
    display: "block",
    fontSize: "11px",
    color: "#8ea0d6",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    marginBottom: "6px",
    fontWeight: 600,
  };

  const pillStyle = (active) => ({
    padding: "7px 10px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 700,
    border: active
      ? "1px solid rgba(96,165,250,0.28)"
      : "1px solid rgba(255,255,255,0.08)",
    background: active
      ? "linear-gradient(135deg, rgba(37,99,235,0.24), rgba(168,85,247,0.18))"
      : "rgba(255,255,255,0.03)",
    color: active ? "#eef3ff" : "#a9b4d0",
    cursor: "pointer",
  });

  return (
    <div
      style={{
        borderRadius: "18px",
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.02)",
        padding: "14px",
        marginBottom: "16px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "12px",
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <div
          style={{
            fontSize: "14px",
            fontWeight: 700,
            color: "#eef3ff",
          }}
        >
          {title}
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {RANGE_PRESETS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  rangePreset: item.key,
                  startDate: "",
                  endDate: "",
                }))
              }
              style={pillStyle(filters.rangePreset === item.key)}
            >
              {item.label}
            </button>
          ))}

          {showTrendGroup
            ? TREND_GROUP_OPTIONS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTrendGroup(item.key)}
                  style={pillStyle(trendGroup === item.key)}
                >
                  {item.label}
                </button>
              ))
            : null}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: "10px",
        }}
      >
        <div>
          <label style={labelStyle}>Start</label>
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                startDate: e.target.value,
                rangePreset: prev.rangePreset === "all" ? "all" : "custom",
              }))
            }
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>End</label>
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                endDate: e.target.value,
                rangePreset: prev.rangePreset === "all" ? "all" : "custom",
              }))
            }
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Team</label>
          <select
            value={filters.team}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, team: e.target.value }))
            }
            style={inputStyle}
          >
            <option value="all">All Teams</option>
            {teams.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>Employee</label>
          <select
            value={filters.employee}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, employee: e.target.value }))
            }
            style={inputStyle}
          >
            <option value="all">All Employees</option>
            {employees.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>Review</label>
          <select
            value={filters.reviewSentiment}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, reviewSentiment: e.target.value }))
            }
            style={inputStyle}
          >
            <option value="all">All Review</option>
            {reviewSentiments.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>Client</label>
          <select
            value={filters.clientSentiment}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, clientSentiment: e.target.value }))
            }
            style={inputStyle}
          >
            <option value="all">All Client</option>
            {clientSentiments.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>Resolution</label>
          <select
            value={filters.resolutionStatus}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, resolutionStatus: e.target.value }))
            }
            style={inputStyle}
          >
            <option value="all">All Resolution</option>
            {resolutionStatuses.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>Type</label>
          <select
            value={filters.resultType}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, resultType: e.target.value }))
            }
            style={inputStyle}
          >
            <option value="all">All Types</option>
            <option value="Positive">Positive</option>
            <option value="Opportunity">Opportunity</option>
            <option value="Risk">Risk</option>
            <option value="Other">Other</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function DonutChart({ title, entries, total, onSelect }) {
  const palette = [
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#6366f1",
  ];
  const segments = buildPieSegments(entries, palette);
  const gradient = buildConicGradient(segments);

  return (
    <div
      style={{
        borderRadius: "22px",
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.025)",
        padding: "18px",
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ fontSize: "20px", fontWeight: 700, marginBottom: "12px" }}>{title}</div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(220px, 260px) minmax(0, 1fr)",
          gap: "18px",
          alignItems: "center",
          flex: 1,
          minHeight: 0,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "240px",
            aspectRatio: "1 / 1",
            margin: "0 auto",
            borderRadius: "50%",
            background: gradient,
            display: "grid",
            placeItems: "center",
            boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
          }}
        >
          <div
            style={{
              width: "58%",
              aspectRatio: "1 / 1",
              borderRadius: "50%",
              background: "linear-gradient(180deg, rgba(12,18,34,0.98), rgba(7,10,22,1))",
              border: "1px solid rgba(255,255,255,0.06)",
              display: "grid",
              placeItems: "center",
              textAlign: "center",
            }}
          >
            <div>
              <div style={{ fontSize: "34px", fontWeight: 800 }}>{total}</div>
              <div style={{ fontSize: "11px", color: "#8ea0d6", letterSpacing: "0.08em" }}>
                TOTAL
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gap: "10px",
            alignContent: "start",
            minWidth: 0,
          }}
        >
          {segments.length ? (
            segments.map((segment) => (
              <button
                key={segment.label}
                type="button"
                onClick={() => onSelect(segment.label)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "12px minmax(0, 1fr) auto",
                  gap: "10px",
                  alignItems: "center",
                  padding: "12px 14px",
                  borderRadius: "16px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  color: "#eef3ff",
                  cursor: "pointer",
                  textAlign: "left",
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    width: "12px",
                    height: "12px",
                    borderRadius: "999px",
                    background: segment.color,
                    boxShadow: `0 0 16px ${segment.color}`,
                  }}
                />
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {segment.label}
                </span>
                <span
                  style={{
                    fontSize: "12px",
                    color: "#cdd7ff",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}
                >
                  {segment.count} · {formatPercent(segment.percent)}
                </span>
              </button>
            ))
          ) : (
            <div
              style={{
                borderRadius: "16px",
                border: "1px dashed rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.02)",
                padding: "18px",
                color: "#9fb0d4",
                fontSize: "14px",
              }}
            >
              No data for this section.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HorizontalBarChart({ title, entries, total, onSelect, kind }) {
  const max = Math.max(...entries.map((item) => item[1]), 1);

  return (
    <div
      style={{
        borderRadius: "22px",
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.025)",
        padding: "18px",
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ fontSize: "20px", fontWeight: 700, marginBottom: "12px" }}>{title}</div>

      <div style={{ display: "grid", gap: "12px", flex: 1 }}>
        {entries.length ? (
          entries.map(([label, count]) => {
            const percent = total ? (count / total) * 100 : 0;
            const width = Math.max((count / max) * 100, 5);
            const color =
              kind === "resolution"
                ? label === "Resolved"
                  ? "linear-gradient(90deg, #10b981, #06b6d4)"
                  : label === "Pending"
                  ? "linear-gradient(90deg, #f59e0b, #f97316)"
                  : label === "Unclear"
                  ? "linear-gradient(90deg, #8b5cf6, #ec4899)"
                  : "linear-gradient(90deg, #ef4444, #7f1d1d)"
                : resultTypePalette(deriveResultType(label));

            return (
              <button
                key={label}
                type="button"
                onClick={() => onSelect(label)}
                style={{
                  borderRadius: "16px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  padding: "12px 14px",
                  textAlign: "left",
                  cursor: "pointer",
                  color: "#eef3ff",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "12px",
                    marginBottom: "10px",
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 700,
                      maxWidth: "70%",
                    }}
                  >
                    {label}
                  </div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#cdd7ff" }}>
                    {count} · {formatPercent(percent)}
                  </div>
                </div>

                <div
                  style={{
                    width: "100%",
                    height: "12px",
                    borderRadius: "999px",
                    background: "rgba(255,255,255,0.05)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${width}%`,
                      height: "100%",
                      borderRadius: "999px",
                      background: color,
                    }}
                  />
                </div>
              </button>
            );
          })
        ) : (
          <div
            style={{
              borderRadius: "16px",
              border: "1px dashed rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.02)",
              padding: "18px",
              color: "#9fb0d4",
              fontSize: "14px",
            }}
          >
            No data for this section.
          </div>
        )}
      </div>
    </div>
  );
}

function KPIStat({ label, value, accent }) {
  return (
    <div
      style={{
        borderRadius: "20px",
        border: "1px solid rgba(255,255,255,0.08)",
        background: accent,
        padding: "18px",
        minHeight: "120px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <div
        style={{
          color: "#8ea0d6",
          fontSize: "11px",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          marginBottom: "8px",
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "38px",
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: "-0.04em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function DetailModal({ open, onClose, title, rows, highlightValue }) {
  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2,5,14,0.75)",
        backdropFilter: "blur(8px)",
        zIndex: 1000,
        display: "grid",
        placeItems: "center",
        padding: "24px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1280px, 96vw)",
          maxHeight: "90vh",
          overflow: "hidden",
          borderRadius: "28px",
          border: "1px solid rgba(255,255,255,0.08)",
          background:
            "linear-gradient(180deg, rgba(15,22,43,0.97), rgba(7,10,24,0.99))",
          boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
        }}
      >
        <div
          style={{
            padding: "22px 24px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontSize: "28px", fontWeight: 800 }}>{title}</div>
            <div style={{ color: "#8ea0d6", fontSize: "14px", marginTop: "6px" }}>
              {highlightValue} · {rows.length} conversation(s)
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              borderRadius: "14px",
              padding: "10px 14px",
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.03)",
              color: "#eef3ff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>

        <div style={{ maxHeight: "calc(90vh - 96px)", overflow: "auto", padding: "20px 24px" }}>
          <div style={{ display: "grid", gap: "12px" }}>
            {rows.map((row) => (
              <div
                key={`${row.conversation_id}-${row.created_at}`}
                style={{
                  borderRadius: "18px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  padding: "16px",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "220px repeat(4, minmax(0, 1fr)) auto",
                    gap: "14px",
                    alignItems: "start",
                  }}
                >
                  <div>
                    <div style={{ color: "#8ea0d6", fontSize: "11px", marginBottom: "6px" }}>
                      Conversation
                    </div>
                    <div style={{ fontSize: "18px", fontWeight: 800, marginBottom: "8px" }}>
                      {row.conversation_id}
                    </div>
                    <div style={{ color: "#9fb0d4", fontSize: "12px", lineHeight: 1.7 }}>
                      Agent: {row.agent_name || "Unassigned"}
                      <br />
                      Client: {row.client_email || "-"}
                      <br />
                      Replied: {formatDateTime(row.replied_at || row.created_at)}
                    </div>
                  </div>

                  <div>
                    <div style={{ color: "#8ea0d6", fontSize: "11px", marginBottom: "6px" }}>
                      Employee
                    </div>
                    <div style={{ fontWeight: 700 }}>{row.employee_name || "Unmapped"}</div>
                  </div>

                  <div>
                    <div style={{ color: "#8ea0d6", fontSize: "11px", marginBottom: "6px" }}>
                      Team
                    </div>
                    <div style={{ fontWeight: 700 }}>{row.team_name || "-"}</div>
                  </div>

                  <div>
                    <div style={{ color: "#8ea0d6", fontSize: "11px", marginBottom: "6px" }}>
                      Review
                    </div>
                    <div style={{ fontWeight: 700 }}>{row.review_sentiment || "-"}</div>
                  </div>

                  <div>
                    <div style={{ color: "#8ea0d6", fontSize: "11px", marginBottom: "6px" }}>
                      Client
                    </div>
                    <div style={{ fontWeight: 700 }}>{row.client_sentiment || "-"}</div>
                  </div>

                  <div>
                    <div style={{ color: "#8ea0d6", fontSize: "11px", marginBottom: "6px" }}>
                      Resolution
                    </div>
                    <div style={{ fontWeight: 700 }}>{row.resolution_status || "-"}</div>
                  </div>

                  <a
                    href={conversationUrl(row.conversation_id)}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      alignSelf: "center",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "10px 12px",
                      borderRadius: "14px",
                      textDecoration: "none",
                      fontSize: "13px",
                      fontWeight: 700,
                      color: "#ecf2ff",
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    Open in Intercom
                  </a>
                </div>

                <div
                  style={{
                    marginTop: "14px",
                    color: row.error ? "#fecdd3" : "#dbe7ff",
                    fontSize: "14px",
                    lineHeight: 1.7,
                  }}
                >
                  {row.error || row.ai_verdict || "-"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [rawRows, setRawRows] = useState([]);
  const [error, setError] = useState("");

  const [globalFilters, setGlobalFilters] = useState(createGlobalFilters());

  const [reviewFilters, setReviewFilters] = useState(createBaseSectionFilters());
  const [clientFilters, setClientFilters] = useState(createBaseSectionFilters());
  const [resolutionFilters, setResolutionFilters] = useState(createBaseSectionFilters());
  const [weeklyFilters, setWeeklyFilters] = useState({
    ...createBaseSectionFilters(),
    rangePreset: "90d",
  });
  const [leaderboardFilters, setLeaderboardFilters] = useState({
    ...createBaseSectionFilters(),
    rangePreset: "90d",
  });
  const [trendFilters, setTrendFilters] = useState({
    ...createBaseSectionFilters(),
    rangePreset: "90d",
  });
  const [trendGroup, setTrendGroup] = useState("week");

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
        .limit(10000);

      if (!active) return;

      if (fetchError) {
        setError(fetchError.message || "Could not load dashboard data.");
        setRawRows([]);
      } else {
        setRawRows(Array.isArray(data) ? data : []);
      }

      setLoading(false);
    }

    loadRows();

    return () => {
      active = false;
    };
  }, []);

  const dedupedRows = useMemo(() => dedupeLatestByConversation(rawRows), [rawRows]);

  const teams = useMemo(() => uniqueValues(dedupedRows, "team_name"), [dedupedRows]);
  const employees = useMemo(() => uniqueValues(dedupedRows, "employee_name"), [dedupedRows]);
  const reviewSentiments = useMemo(
    () => uniqueValues(dedupedRows, "review_sentiment"),
    [dedupedRows]
  );
  const clientSentiments = useMemo(
    () => uniqueValues(dedupedRows, "client_sentiment"),
    [dedupedRows]
  );
  const resolutionStatuses = useMemo(
    () => uniqueValues(dedupedRows, "resolution_status"),
    [dedupedRows]
  );

  const filteredRows = useMemo(
    () => filterRows(dedupedRows, globalFilters),
    [dedupedRows, globalFilters]
  );

  const reviewRows = useMemo(
    () => sectionRangeRows(filteredRows, reviewFilters),
    [filteredRows, reviewFilters]
  );

  const clientRows = useMemo(
    () => sectionRangeRows(filteredRows, clientFilters),
    [filteredRows, clientFilters]
  );

  const resolutionRows = useMemo(
    () => sectionRangeRows(filteredRows, resolutionFilters),
    [filteredRows, resolutionFilters]
  );

  const weeklyRows = useMemo(
    () => sectionRangeRows(filteredRows, weeklyFilters),
    [filteredRows, weeklyFilters]
  );

  const leaderboardRows = useMemo(
    () => sectionRangeRows(filteredRows, leaderboardFilters),
    [filteredRows, leaderboardFilters]
  );

  const trendRows = useMemo(
    () => sectionRangeRows(filteredRows, trendFilters),
    [filteredRows, trendFilters]
  );

  const reviewEntries = useMemo(
    () => orderedEntries(countBy(reviewRows, "review_sentiment"), REVIEW_SENTIMENT_ORDER),
    [reviewRows]
  );

  const clientEntries = useMemo(
    () => orderedEntries(countBy(clientRows, "client_sentiment"), CLIENT_SENTIMENT_ORDER),
    [clientRows]
  );

  const resolutionEntries = useMemo(
    () => orderedEntries(countBy(resolutionRows, "resolution_status"), RESOLUTION_ORDER),
    [resolutionRows]
  );

  const weeklyData = useMemo(() => buildWeeklyData(weeklyRows), [weeklyRows]);
  const leaderboard = useMemo(() => buildLeaderboard(leaderboardRows), [leaderboardRows]);
  const trendData = useMemo(() => buildTrendData(trendRows, trendGroup), [trendRows, trendGroup]);

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
  const mappedCount = filteredRows.filter(
    (row) => row.employee_match_status === "mapped"
  ).length;
  const latestStoredAt = filteredRows[0]?.created_at || dedupedRows[0]?.created_at || "";

  function openDetail(title, value, rows) {
    setDetailState({
      open: true,
      title,
      value,
      rows: (rows || []).slice(0, 120),
    });
  }

  const pageStyle = {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top left, rgba(59,130,246,0.16), transparent 22%), radial-gradient(circle at top right, rgba(168,85,247,0.14), transparent 20%), radial-gradient(circle at bottom center, rgba(6,182,212,0.08), transparent 22%), linear-gradient(180deg, #040714 0%, #060b1d 45%, #04060d 100%)",
    color: "#f5f7ff",
    padding: "32px 20px 60px",
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  };

  const shellStyle = {
    maxWidth: "1500px",
    margin: "0 auto",
  };

  const topBarStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "16px",
    padding: "18px 20px",
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(9, 13, 29, 0.72)",
    backdropFilter: "blur(14px)",
    borderRadius: "22px",
    boxShadow: "0 10px 40px rgba(0,0,0,0.35)",
    marginBottom: "28px",
    flexWrap: "wrap",
  };

  const panelStyle = {
    border: "1px solid rgba(255,255,255,0.08)",
    background: "linear-gradient(180deg, rgba(15,22,43,0.9), rgba(7,10,24,0.96))",
    borderRadius: "28px",
    padding: "20px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)",
  };

  const sectionCardStyle = {
    border: "1px solid rgba(255,255,255,0.08)",
    background: "linear-gradient(180deg, rgba(10,15,32,0.9), rgba(7,10,22,0.96))",
    borderRadius: "24px",
    padding: "20px",
    boxShadow: "0 18px 40px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.03)",
    minHeight: "100%",
  };

  const inputStyle = {
    width: "100%",
    minHeight: "48px",
    borderRadius: "16px",
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(5,8,18,0.9)",
    color: "#e7ecff",
    padding: "0 16px",
    fontSize: "14px",
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle = {
    display: "block",
    fontSize: "11px",
    color: "#8ea0d6",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    marginBottom: "6px",
    fontWeight: 600,
  };

  const compactButtonStyle = {
    borderRadius: "14px",
    padding: "12px 16px",
    fontSize: "13px",
    fontWeight: 700,
    color: "#ffffff",
    cursor: "pointer",
    background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 50%, #db2777 100%)",
    border: "none",
    boxShadow: "0 14px 30px rgba(91,33,182,0.35)",
  };

  const sectionPairStyle = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
    gap: "18px",
    marginBottom: "22px",
    alignItems: "stretch",
  };

  const innerTwoColStyle = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(340px, 0.9fr)",
    gap: "16px",
    alignItems: "stretch",
  };

  return (
    <main style={pageStyle}>
      <DetailModal
        open={detailState.open}
        onClose={() => setDetailState({ open: false, title: "", value: "", rows: [] })}
        title={detailState.title}
        highlightValue={detailState.value}
        rows={detailState.rows}
      />

      <div style={shellStyle}>
        <div style={topBarStyle}>
          <div>
            <div
              style={{
                fontSize: "12px",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "#8ea0d6",
                marginBottom: "8px",
              }}
            >
              NEXT Ventures
            </div>
            <div
              style={{
                fontSize: "24px",
                fontWeight: 700,
                letterSpacing: "-0.03em",
              }}
            >
              Review Approach &amp; Client Sentiment Tracking
            </div>
          </div>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 14px",
              borderRadius: "999px",
              border: "1px solid rgba(96,165,250,0.25)",
              background:
                "linear-gradient(135deg, rgba(37,99,235,0.18), rgba(168,85,247,0.14))",
              color: "#dbe7ff",
              fontSize: "14px",
              fontWeight: 600,
              boxShadow: "0 0 24px rgba(59,130,246,0.15)",
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "999px",
                background: "#34d399",
                boxShadow: "0 0 12px #34d399",
                display: "inline-block",
              }}
            />
            Live Dashboard
          </div>
        </div>

        <section style={{ ...panelStyle, marginBottom: "22px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: "18px",
              alignItems: "center",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "12px",
                  color: "#8ea0d6",
                  textTransform: "uppercase",
                  letterSpacing: "0.16em",
                  marginBottom: "10px",
                  fontWeight: 700,
                }}
              >
                Dashboard
              </div>
              <div
                style={{
                  fontSize: "44px",
                  lineHeight: 1.02,
                  letterSpacing: "-0.05em",
                  fontWeight: 800,
                  marginBottom: "10px",
                }}
              >
                QA intelligence
              </div>
              <div
                style={{
                  color: "#a9b4d0",
                  fontSize: "14px",
                  lineHeight: 1.7,
                }}
              >
                Latest stored result: {formatDateTime(latestStoredAt)}
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <Link href="/run" style={{ ...compactButtonStyle, textDecoration: "none" }}>
                Run Audit
              </Link>
              <Link
                href="/results"
                style={{
                  textDecoration: "none",
                  borderRadius: "14px",
                  padding: "12px 16px",
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "#e5ebff",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                Results
              </Link>
              <Link
                href="/admin"
                style={{
                  textDecoration: "none",
                  borderRadius: "14px",
                  padding: "12px 16px",
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "#e5ebff",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                Admin
              </Link>
            </div>
          </div>
        </section>

        <section style={{ ...panelStyle, marginBottom: "22px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, minmax(0, 1fr)) auto",
              gap: "12px",
              alignItems: "end",
            }}
          >
            <div>
              <label style={labelStyle}>Range</label>
              <select
                value={globalFilters.rangePreset}
                onChange={(e) =>
                  setGlobalFilters((prev) => ({
                    ...prev,
                    rangePreset: e.target.value,
                    startDate: "",
                    endDate: "",
                  }))
                }
                style={inputStyle}
              >
                <option value="7d">Past 7 Days</option>
                <option value="30d">Past 30 Days</option>
                <option value="90d">Past 90 Days</option>
                <option value="180d">Past 180 Days</option>
                <option value="365d">Past 1 Year</option>
                <option value="all">All Time</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Start</label>
              <input
                type="date"
                value={globalFilters.startDate}
                onChange={(e) =>
                  setGlobalFilters((prev) => ({
                    ...prev,
                    startDate: e.target.value,
                    rangePreset: prev.rangePreset === "all" ? "all" : "custom",
                  }))
                }
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>End</label>
              <input
                type="date"
                value={globalFilters.endDate}
                onChange={(e) =>
                  setGlobalFilters((prev) => ({
                    ...prev,
                    endDate: e.target.value,
                    rangePreset: prev.rangePreset === "all" ? "all" : "custom",
                  }))
                }
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Team</label>
              <select
                value={globalFilters.team}
                onChange={(e) =>
                  setGlobalFilters((prev) => ({ ...prev, team: e.target.value }))
                }
                style={inputStyle}
              >
                <option value="all">All Teams</option>
                {teams.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Employee</label>
              <select
                value={globalFilters.employee}
                onChange={(e) =>
                  setGlobalFilters((prev) => ({ ...prev, employee: e.target.value }))
                }
                style={inputStyle}
              >
                <option value="all">All Employees</option>
                {employees.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                color: "#dbe7ff",
                fontSize: "14px",
                fontWeight: 600,
                paddingBottom: "12px",
              }}
            >
              <input
                type="checkbox"
                checked={globalFilters.cexOnly}
                onChange={(e) =>
                  setGlobalFilters((prev) => ({ ...prev, cexOnly: e.target.checked }))
                }
              />
              CEx only
            </label>

            <div>
              <label style={labelStyle}>Review</label>
              <select
                value={globalFilters.reviewSentiment}
                onChange={(e) =>
                  setGlobalFilters((prev) => ({
                    ...prev,
                    reviewSentiment: e.target.value,
                  }))
                }
                style={inputStyle}
              >
                <option value="all">All Review</option>
                {reviewSentiments.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Client</label>
              <select
                value={globalFilters.clientSentiment}
                onChange={(e) =>
                  setGlobalFilters((prev) => ({
                    ...prev,
                    clientSentiment: e.target.value,
                  }))
                }
                style={inputStyle}
              >
                <option value="all">All Client</option>
                {clientSentiments.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Resolution</label>
              <select
                value={globalFilters.resolutionStatus}
                onChange={(e) =>
                  setGlobalFilters((prev) => ({
                    ...prev,
                    resolutionStatus: e.target.value,
                  }))
                }
                style={inputStyle}
              >
                <option value="all">All Resolution</option>
                {resolutionStatuses.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Type</label>
              <select
                value={globalFilters.resultType}
                onChange={(e) =>
                  setGlobalFilters((prev) => ({
                    ...prev,
                    resultType: e.target.value,
                  }))
                }
                style={inputStyle}
              >
                <option value="all">All Types</option>
                <option value="Positive">Positive</option>
                <option value="Opportunity">Opportunity</option>
                <option value="Risk">Risk</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => setGlobalFilters(createGlobalFilters())}
              style={compactButtonStyle}
            >
              Reset
            </button>
          </div>
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
            gap: "14px",
            marginBottom: "22px",
            alignItems: "stretch",
          }}
        >
          <KPIStat
            label="Unique Conversations"
            value={total}
            accent="linear-gradient(135deg, rgba(37,99,235,0.18), rgba(99,102,241,0.12))"
          />
          <KPIStat
            label="Missed Opportunities"
            value={missedCount}
            accent="linear-gradient(135deg, rgba(245,158,11,0.18), rgba(249,115,22,0.12))"
          />
          <KPIStat
            label="Very Positive"
            value={veryPositiveCount}
            accent="linear-gradient(135deg, rgba(16,185,129,0.18), rgba(6,182,212,0.12))"
          />
          <KPIStat
            label="Resolution Rate"
            value={formatPercent(total ? (resolvedCount / total) * 100 : 0)}
            accent="linear-gradient(135deg, rgba(14,165,233,0.18), rgba(34,197,94,0.12))"
          />
          <KPIStat
            label="Unresolved"
            value={unresolvedCount}
            accent="linear-gradient(135deg, rgba(244,63,94,0.18), rgba(168,85,247,0.12))"
          />
          <KPIStat
            label="Mapped Records"
            value={`${mappedCount}/${total}`}
            accent="linear-gradient(135deg, rgba(59,130,246,0.14), rgba(16,185,129,0.12))"
          />
        </section>

        {loading ? (
          <section style={panelStyle}>
            <div style={{ fontSize: "24px", fontWeight: 700, marginBottom: "8px" }}>
              Loading dashboard...
            </div>
          </section>
        ) : error ? (
          <section style={panelStyle}>
            <div
              style={{
                borderRadius: "18px",
                border: "1px solid rgba(244,63,94,0.22)",
                background: "rgba(244,63,94,0.08)",
                padding: "16px",
                color: "#fecdd3",
              }}
            >
              {error}
            </div>
          </section>
        ) : (
          <>
            <section style={sectionPairStyle}>
              <div style={sectionCardStyle}>
                <SectionFilterRow
                  title="Review section filters"
                  filters={reviewFilters}
                  setFilters={setReviewFilters}
                  teams={teams}
                  employees={employees}
                  reviewSentiments={reviewSentiments}
                  clientSentiments={clientSentiments}
                  resolutionStatuses={resolutionStatuses}
                />

                <div style={innerTwoColStyle}>
                  <HorizontalBarChart
                    title="Review sentiment"
                    entries={reviewEntries}
                    total={reviewRows.length}
                    kind="review"
                    onSelect={(label) =>
                      openDetail(
                        "Review Sentiment Drilldown",
                        label,
                        reviewRows.filter((row) => row.review_sentiment === label)
                      )
                    }
                  />

                  <DonutChart
                    title="Result type mix"
                    entries={orderedEntries(
                      countBy(
                        reviewRows.map((row) => ({
                          ...row,
                          result_type: deriveResultType(row.review_sentiment),
                        })),
                        "result_type"
                      )
                    )}
                    total={reviewRows.length}
                    onSelect={(label) =>
                      openDetail(
                        "Result Type Drilldown",
                        label,
                        reviewRows.filter(
                          (row) => deriveResultType(row.review_sentiment) === label
                        )
                      )
                    }
                  />
                </div>
              </div>

              <div style={sectionCardStyle}>
                <SectionFilterRow
                  title="Client section filters"
                  filters={clientFilters}
                  setFilters={setClientFilters}
                  teams={teams}
                  employees={employees}
                  reviewSentiments={reviewSentiments}
                  clientSentiments={clientSentiments}
                  resolutionStatuses={resolutionStatuses}
                />

                <div style={innerTwoColStyle}>
                  <HorizontalBarChart
                    title="Client sentiment"
                    entries={clientEntries}
                    total={clientRows.length}
                    kind="client"
                    onSelect={(label) =>
                      openDetail(
                        "Client Sentiment Drilldown",
                        label,
                        clientRows.filter((row) => row.client_sentiment === label)
                      )
                    }
                  />

                  <DonutChart
                    title="Client sentiment share"
                    entries={clientEntries}
                    total={clientRows.length}
                    onSelect={(label) =>
                      openDetail(
                        "Client Sentiment Drilldown",
                        label,
                        clientRows.filter((row) => row.client_sentiment === label)
                      )
                    }
                  />
                </div>
              </div>
            </section>

            <section style={sectionPairStyle}>
              <div style={sectionCardStyle}>
                <SectionFilterRow
                  title="Resolution section filters"
                  filters={resolutionFilters}
                  setFilters={setResolutionFilters}
                  teams={teams}
                  employees={employees}
                  reviewSentiments={reviewSentiments}
                  clientSentiments={clientSentiments}
                  resolutionStatuses={resolutionStatuses}
                />

                <div style={innerTwoColStyle}>
                  <HorizontalBarChart
                    title="Resolution status"
                    entries={resolutionEntries}
                    total={resolutionRows.length}
                    kind="resolution"
                    onSelect={(label) =>
                      openDetail(
                        "Resolution Drilldown",
                        label,
                        resolutionRows.filter((row) => row.resolution_status === label)
                      )
                    }
                  />

                  <DonutChart
                    title="Resolution share"
                    entries={resolutionEntries}
                    total={resolutionRows.length}
                    onSelect={(label) =>
                      openDetail(
                        "Resolution Drilldown",
                        label,
                        resolutionRows.filter((row) => row.resolution_status === label)
                      )
                    }
                  />
                </div>
              </div>

              <div style={sectionCardStyle}>
                <SectionFilterRow
                  title="Week-by-week filters"
                  filters={weeklyFilters}
                  setFilters={setWeeklyFilters}
                  teams={teams}
                  employees={employees}
                  reviewSentiments={reviewSentiments}
                  clientSentiments={clientSentiments}
                  resolutionStatuses={resolutionStatuses}
                />

                <div
                  style={{
                    display: "grid",
                    gap: "12px",
                    maxHeight: "560px",
                    overflowY: "auto",
                    paddingRight: "4px",
                  }}
                >
                  {weeklyData.length ? (
                    weeklyData.map((week) => (
                      <button
                        key={week.key}
                        type="button"
                        onClick={() => openDetail("Weekly Drilldown", week.label, week.rows)}
                        style={{
                          textAlign: "left",
                          borderRadius: "18px",
                          border: "1px solid rgba(255,255,255,0.08)",
                          background: "rgba(255,255,255,0.03)",
                          padding: "16px",
                          color: "#eef3ff",
                          cursor: "pointer",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: "12px",
                            marginBottom: "12px",
                            alignItems: "center",
                          }}
                        >
                          <div style={{ fontSize: "16px", fontWeight: 800 }}>{week.label}</div>
                          <div style={{ fontSize: "13px", color: "#cdd7ff", fontWeight: 700 }}>
                            {week.total} total
                          </div>
                        </div>

                        <div
                          style={{
                            width: "100%",
                            height: "10px",
                            borderRadius: "999px",
                            background: "rgba(255,255,255,0.05)",
                            overflow: "hidden",
                            marginBottom: "12px",
                          }}
                        >
                          <div
                            style={{
                              width: "100%",
                              height: "100%",
                              borderRadius: "999px",
                              background:
                                "linear-gradient(90deg, #2563eb, #7c3aed, #db2777)",
                            }}
                          />
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                            gap: "10px",
                            color: "#dbe7ff",
                            fontSize: "12px",
                            lineHeight: 1.6,
                          }}
                        >
                          <div>
                            <strong>Missed</strong>
                            <br />
                            {week.missed}
                          </div>
                          <div>
                            <strong>Positive</strong>
                            <br />
                            {week.positive}
                          </div>
                          <div>
                            <strong>Very Positive</strong>
                            <br />
                            {week.veryPositive}
                          </div>
                          <div>
                            <strong>Unresolved</strong>
                            <br />
                            {week.unresolved}
                          </div>
                          <div>
                            <strong>Resolution Rate</strong>
                            <br />
                            {formatPercent(
                              week.total ? ((week.total - week.unresolved) / week.total) * 100 : 0
                            )}
                          </div>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div
                      style={{
                        borderRadius: "18px",
                        border: "1px dashed rgba(255,255,255,0.12)",
                        background: "rgba(255,255,255,0.02)",
                        padding: "18px",
                        color: "#9fb0d4",
                        fontSize: "14px",
                      }}
                    >
                      No week-by-week data.
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section style={{ ...sectionCardStyle, marginBottom: "22px" }}>
              <SectionFilterRow
                title="Leaderboard filters"
                filters={leaderboardFilters}
                setFilters={setLeaderboardFilters}
                teams={teams}
                employees={employees}
                reviewSentiments={reviewSentiments}
                clientSentiments={clientSentiments}
                resolutionStatuses={resolutionStatuses}
              />

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                  gap: "16px",
                  marginBottom: "18px",
                  alignItems: "stretch",
                }}
              >
                {[
                  {
                    title: "Top Volume",
                    rows: [...leaderboard].sort((a, b) => b.handled - a.handled).slice(0, 5),
                    field: "handled",
                  },
                  {
                    title: "Top Missed Opportunity",
                    rows: [...leaderboard].sort((a, b) => b.missed - a.missed).slice(0, 5),
                    field: "missed",
                  },
                  {
                    title: "Top Very Positive",
                    rows: [...leaderboard]
                      .sort((a, b) => b.veryPositive - a.veryPositive)
                      .slice(0, 5),
                    field: "veryPositive",
                  },
                  {
                    title: "Top Risk Rate",
                    rows: [...leaderboard]
                      .sort((a, b) => b.riskRate - a.riskRate)
                      .slice(0, 5),
                    field: "riskRate",
                  },
                ].map((block) => (
                  <div
                    key={block.title}
                    style={{
                      borderRadius: "20px",
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.03)",
                      padding: "16px",
                      minHeight: "100%",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "18px",
                        fontWeight: 800,
                        marginBottom: "12px",
                      }}
                    >
                      {block.title}
                    </div>

                    <div style={{ display: "grid", gap: "10px", flex: 1 }}>
                      {block.rows.length ? (
                        block.rows.map((row) => (
                          <button
                            key={`${block.title}-${row.employee}`}
                            type="button"
                            onClick={() =>
                              openDetail(
                                "Leaderboard Drilldown",
                                `${block.title}: ${row.employee}`,
                                row.rows
                              )
                            }
                            style={{
                              textAlign: "left",
                              borderRadius: "16px",
                              border: "1px solid rgba(255,255,255,0.08)",
                              background: "rgba(255,255,255,0.02)",
                              padding: "12px",
                              color: "#eef3ff",
                              cursor: "pointer",
                              minHeight: "80px",
                              display: "flex",
                              flexDirection: "column",
                              justifyContent: "space-between",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                gap: "12px",
                                marginBottom: "6px",
                              }}
                            >
                              <div style={{ fontWeight: 700 }}>{row.employee}</div>
                              <div style={{ color: "#cdd7ff", fontWeight: 700 }}>
                                {block.field.includes("Rate")
                                  ? formatPercent(row[block.field])
                                  : row[block.field]}
                              </div>
                            </div>
                            <div style={{ color: "#8ea0d6", fontSize: "12px" }}>
                              {row.team} · handled {row.handled}
                            </div>
                          </button>
                        ))
                      ) : (
                        <div style={{ color: "#9fb0d4", fontSize: "13px" }}>
                          No leaderboard data.
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  overflow: "hidden",
                  borderRadius: "20px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(4,8,20,0.72)",
                }}
              >
                <div style={{ maxHeight: "520px", overflow: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      minWidth: "1180px",
                      borderCollapse: "collapse",
                    }}
                  >
                    <thead>
                      <tr style={{ background: "rgba(10,18,34,0.96)" }}>
                        {[
                          "Employee",
                          "Team",
                          "Handled",
                          "Missed",
                          "Very Positive",
                          "Positive Rate",
                          "Risk Rate",
                          "Drilldown",
                        ].map((label) => (
                          <th
                            key={label}
                            style={{
                              padding: "14px 12px",
                              textAlign: "left",
                              fontSize: "11px",
                              color: "#8ea0d6",
                              textTransform: "uppercase",
                              letterSpacing: "0.12em",
                              fontWeight: 700,
                              borderBottom: "1px solid rgba(255,255,255,0.08)",
                              position: "sticky",
                              top: 0,
                              zIndex: 2,
                              background: "rgba(10,18,34,0.96)",
                            }}
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody>
                      {leaderboard.map((row, index) => (
                        <tr
                          key={`${row.employee}-${index}`}
                          style={{
                            background: index % 2 === 0 ? "rgba(255,255,255,0.018)" : "transparent",
                          }}
                        >
                          <td
                            style={{
                              padding: "14px 12px",
                              borderBottom: "1px solid rgba(255,255,255,0.06)",
                              fontWeight: 800,
                            }}
                          >
                            {row.employee}
                          </td>
                          <td
                            style={{
                              padding: "14px 12px",
                              borderBottom: "1px solid rgba(255,255,255,0.06)",
                            }}
                          >
                            {row.team}
                          </td>
                          <td
                            style={{
                              padding: "14px 12px",
                              borderBottom: "1px solid rgba(255,255,255,0.06)",
                              fontWeight: 700,
                            }}
                          >
                            {row.handled}
                          </td>
                          <td
                            style={{
                              padding: "14px 12px",
                              borderBottom: "1px solid rgba(255,255,255,0.06)",
                              color: "#fde68a",
                              fontWeight: 700,
                            }}
                          >
                            {row.missed}
                          </td>
                          <td
                            style={{
                              padding: "14px 12px",
                              borderBottom: "1px solid rgba(255,255,255,0.06)",
                              color: "#bbf7d0",
                              fontWeight: 700,
                            }}
                          >
                            {row.veryPositive}
                          </td>
                          <td
                            style={{
                              padding: "14px 12px",
                              borderBottom: "1px solid rgba(255,255,255,0.06)",
                              fontWeight: 700,
                            }}
                          >
                            {formatPercent(row.positiveRate)}
                          </td>
                          <td
                            style={{
                              padding: "14px 12px",
                              borderBottom: "1px solid rgba(255,255,255,0.06)",
                              color: "#fecdd3",
                              fontWeight: 700,
                            }}
                          >
                            {formatPercent(row.riskRate)}
                          </td>
                          <td
                            style={{
                              padding: "14px 12px",
                              borderBottom: "1px solid rgba(255,255,255,0.06)",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                openDetail("Employee Drilldown", row.employee, row.rows)
                              }
                              style={{
                                borderRadius: "12px",
                                padding: "10px 12px",
                                border: "1px solid rgba(255,255,255,0.1)",
                                background: "rgba(255,255,255,0.03)",
                                color: "#eef3ff",
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section style={sectionPairStyle}>
              <div style={sectionCardStyle}>
                <SectionFilterRow
                  title="Trend filters"
                  filters={trendFilters}
                  setFilters={setTrendFilters}
                  teams={teams}
                  employees={employees}
                  reviewSentiments={reviewSentiments}
                  clientSentiments={clientSentiments}
                  resolutionStatuses={resolutionStatuses}
                  showTrendGroup
                  trendGroup={trendGroup}
                  setTrendGroup={setTrendGroup}
                />

                <div
                  style={{
                    display: "grid",
                    gap: "12px",
                    maxHeight: "540px",
                    overflowY: "auto",
                    paddingRight: "4px",
                  }}
                >
                  {trendData.length ? (
                    trendData.map((item) => {
                      const maxTotal = Math.max(...trendData.map((entry) => entry.total), 1);

                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => openDetail("Trend Drilldown", item.label, item.rows)}
                          style={{
                            textAlign: "left",
                            borderRadius: "18px",
                            border: "1px solid rgba(255,255,255,0.08)",
                            background: "rgba(255,255,255,0.03)",
                            padding: "14px",
                            color: "#eef3ff",
                            cursor: "pointer",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: "12px",
                              marginBottom: "10px",
                              alignItems: "center",
                            }}
                          >
                            <div style={{ fontSize: "15px", fontWeight: 800 }}>{item.label}</div>
                            <div style={{ color: "#cdd7ff", fontSize: "13px", fontWeight: 700 }}>
                              {item.total}
                            </div>
                          </div>

                          <div
                            style={{
                              width: "100%",
                              height: "12px",
                              borderRadius: "999px",
                              background: "rgba(255,255,255,0.05)",
                              overflow: "hidden",
                              marginBottom: "10px",
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.max((item.total / maxTotal) * 100, 5)}%`,
                                height: "100%",
                                borderRadius: "999px",
                                background:
                                  "linear-gradient(90deg, #2563eb, #7c3aed, #db2777)",
                              }}
                            />
                          </div>

                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                              gap: "10px",
                              color: "#dbe7ff",
                              fontSize: "12px",
                              lineHeight: 1.6,
                            }}
                          >
                            <div>Missed: {item.missed}</div>
                            <div>Positive: {item.positive}</div>
                            <div>Very Positive: {item.veryPositive}</div>
                            <div>Unresolved: {item.unresolved}</div>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div
                      style={{
                        borderRadius: "18px",
                        border: "1px dashed rgba(255,255,255,0.12)",
                        background: "rgba(255,255,255,0.02)",
                        padding: "18px",
                        color: "#9fb0d4",
                        fontSize: "14px",
                      }}
                    >
                      No trend data.
                    </div>
                  )}
                </div>
              </div>

              <div style={sectionCardStyle}>
                <div
                  style={{
                    fontSize: "24px",
                    fontWeight: 700,
                    marginBottom: "14px",
                  }}
                >
                  Conversation explorer
                </div>

                <div
                  style={{
                    overflow: "hidden",
                    borderRadius: "20px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(4,8,20,0.72)",
                  }}
                >
                  <div style={{ maxHeight: "700px", overflow: "auto" }}>
                    <table
                      style={{
                        width: "100%",
                        minWidth: "1180px",
                        borderCollapse: "collapse",
                      }}
                    >
                      <thead>
                        <tr style={{ background: "rgba(10,18,34,0.96)" }}>
                          {[
                            "Conversation",
                            "Employee",
                            "Team",
                            "Review",
                            "Client",
                            "Resolution",
                            "Open",
                          ].map((label) => (
                            <th
                              key={label}
                              style={{
                                padding: "14px 12px",
                                textAlign: "left",
                                fontSize: "11px",
                                color: "#8ea0d6",
                                textTransform: "uppercase",
                                letterSpacing: "0.12em",
                                fontWeight: 700,
                                borderBottom: "1px solid rgba(255,255,255,0.08)",
                                position: "sticky",
                                top: 0,
                                zIndex: 2,
                                background: "rgba(10,18,34,0.96)",
                              }}
                            >
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>

                      <tbody>
                        {filteredRows.slice(0, 80).map((row, index) => (
                          <tr
                            key={`${row.conversation_id}-${index}`}
                            style={{
                              background: index % 2 === 0 ? "rgba(255,255,255,0.018)" : "transparent",
                            }}
                          >
                            <td
                              style={{
                                padding: "14px 12px",
                                borderBottom: "1px solid rgba(255,255,255,0.06)",
                                verticalAlign: "top",
                              }}
                            >
                              <div style={{ fontWeight: 800, marginBottom: "6px" }}>
                                {row.conversation_id}
                              </div>
                              <div style={{ color: "#8ea0d6", fontSize: "12px", lineHeight: 1.6 }}>
                                {row.agent_name || "Unassigned"}
                                <br />
                                {row.client_email || "-"}
                              </div>
                            </td>

                            <td
                              style={{
                                padding: "14px 12px",
                                borderBottom: "1px solid rgba(255,255,255,0.06)",
                                fontWeight: 700,
                                verticalAlign: "top",
                              }}
                            >
                              {row.employee_name || "Unmapped"}
                            </td>

                            <td
                              style={{
                                padding: "14px 12px",
                                borderBottom: "1px solid rgba(255,255,255,0.06)",
                                verticalAlign: "top",
                              }}
                            >
                              {row.team_name || "-"}
                            </td>

                            <td
                              style={{
                                padding: "14px 12px",
                                borderBottom: "1px solid rgba(255,255,255,0.06)",
                                verticalAlign: "top",
                              }}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  openDetail(
                                    "Review Sentiment Drilldown",
                                    row.review_sentiment || "Unknown",
                                    filteredRows.filter(
                                      (item) => item.review_sentiment === row.review_sentiment
                                    )
                                  )
                                }
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  color: "#eef3ff",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  padding: 0,
                                }}
                              >
                                {row.review_sentiment || "-"}
                              </button>
                            </td>

                            <td
                              style={{
                                padding: "14px 12px",
                                borderBottom: "1px solid rgba(255,255,255,0.06)",
                                verticalAlign: "top",
                              }}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  openDetail(
                                    "Client Sentiment Drilldown",
                                    row.client_sentiment || "Unknown",
                                    filteredRows.filter(
                                      (item) => item.client_sentiment === row.client_sentiment
                                    )
                                  )
                                }
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  color: "#eef3ff",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  padding: 0,
                                }}
                              >
                                {row.client_sentiment || "-"}
                              </button>
                            </td>

                            <td
                              style={{
                                padding: "14px 12px",
                                borderBottom: "1px solid rgba(255,255,255,0.06)",
                                verticalAlign: "top",
                              }}
                            >
                              {row.resolution_status || "-"}
                            </td>

                            <td
                              style={{
                                padding: "14px 12px",
                                borderBottom: "1px solid rgba(255,255,255,0.06)",
                                verticalAlign: "top",
                              }}
                            >
                              <a
                                href={conversationUrl(row.conversation_id)}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  padding: "10px 12px",
                                  borderRadius: "12px",
                                  textDecoration: "none",
                                  fontSize: "13px",
                                  fontWeight: 700,
                                  color: "#ecf2ff",
                                  background: "rgba(255,255,255,0.03)",
                                  border: "1px solid rgba(255,255,255,0.1)",
                                }}
                              >
                                Open
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
