import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

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

const SECTION_WINDOWS = [
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "365d", label: "1Y" },
  { key: "all", label: "All" },
];

const TREND_GROUPS = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

function getSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normalizeText(value, fallback = "Unknown") {
  const text = String(value || "").trim();
  return text || fallback;
}

function safeLower(value) {
  return String(value || "").trim().toLowerCase();
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

function formatDateOnly(value) {
  const date = toDate(value);
  if (!date) return "-";

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "0.0%";
  return `${value.toFixed(1)}%`;
}

function parseSearchParams(searchParams) {
  return {
    range: String(searchParams?.range || "30d"),
    start: String(searchParams?.start || ""),
    end: String(searchParams?.end || ""),
    team: String(searchParams?.team || "all"),
    employee: String(searchParams?.employee || "all"),
    review: String(searchParams?.review || "all"),
    client: String(searchParams?.client || "all"),
    resolution: String(searchParams?.resolution || "all"),
    resultType: String(searchParams?.resultType || "all"),
    reviewWindow: String(searchParams?.reviewWindow || "30d"),
    clientWindow: String(searchParams?.clientWindow || "30d"),
    leaderboardWindow: String(searchParams?.leaderboardWindow || "30d"),
    trendWindow: String(searchParams?.trendWindow || "90d"),
    trendGroup: String(searchParams?.trendGroup || "week"),
    spotlightReview: String(searchParams?.spotlightReview || "Missed Opportunity"),
    spotlightClient: String(searchParams?.spotlightClient || "Very Positive"),
  };
}

function buildHref(params, updates = {}) {
  const next = new URLSearchParams();

  const merged = { ...params, ...updates };

  Object.entries(merged).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    const text = String(value).trim();
    if (!text) return;
    next.set(key, text);
  });

  const query = next.toString();
  return query ? `/?${query}` : "/";
}

function getDateRange(params) {
  const today = new Date();
  const end = params.end ? toDate(`${params.end}T23:59:59`) : today;
  const endDate = end || today;

  if (params.range === "all") {
    return { startDate: null, endDate };
  }

  if (params.range === "custom" || params.start || params.end) {
    const startDate = params.start ? toDate(`${params.start}T00:00:00`) : null;
    return { startDate, endDate };
  }

  const rangeMap = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
    "180d": 180,
    "365d": 365,
  };

  const days = rangeMap[params.range] || 30;
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (days - 1));
  startDate.setHours(0, 0, 0, 0);

  return { startDate, endDate };
}

function applyGlobalFilters(rows, params) {
  const { startDate, endDate } = getDateRange(params);

  return rows.filter((row) => {
    const createdAt = toDate(row.created_at);

    if (startDate && createdAt && createdAt < startDate) return false;
    if (endDate && createdAt && createdAt > endDate) return false;

    if (params.team !== "all" && row.team_name !== params.team) return false;
    if (params.employee !== "all" && row.employee_name !== params.employee) return false;
    if (params.review !== "all" && row.review_sentiment !== params.review) return false;
    if (params.client !== "all" && row.client_sentiment !== params.client) return false;
    if (params.resolution !== "all" && row.resolution_status !== params.resolution) return false;

    if (params.resultType !== "all") {
      const review = row.review_sentiment || "";
      const resultType = deriveResultType(review);
      if (resultType !== params.resultType) return false;
    }

    return true;
  });
}

function applySectionWindow(rows, windowKey, endDateInput) {
  if (!rows.length || windowKey === "all") return rows;

  const endDate = endDateInput || new Date();
  const startDate = new Date(endDate);

  const map = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
    "365d": 365,
  };

  const days = map[windowKey] || 30;
  startDate.setDate(startDate.getDate() - (days - 1));
  startDate.setHours(0, 0, 0, 0);

  return rows.filter((row) => {
    const createdAt = toDate(row.created_at);
    return createdAt && createdAt >= startDate && createdAt <= endDate;
  });
}

function deriveResultType(reviewSentiment) {
  const value = String(reviewSentiment || "");
  if (value === "Missed Opportunity") return "Opportunity";
  if (
    value === "Likely Negative Review" ||
    value === "Highly Likely Negative Review" ||
    value === "Negative Outcome - No Review Request"
  ) {
    return "Risk";
  }
  if (
    value === "Likely Positive Review" ||
    value === "Highly Likely Positive Review"
  ) {
    return "Positive";
  }
  return "Other";
}

function dedupeLatestByConversation(rows) {
  const seen = new Map();

  for (const row of rows) {
    const key = String(row.conversation_id || "").trim();
    if (!key) continue;

    const existing = seen.get(key);
    const currentDate = toDate(row.created_at)?.getTime() || 0;
    const existingDate = toDate(existing?.created_at)?.getTime() || 0;

    if (!existing || currentDate > existingDate) {
      seen.set(key, row);
    }
  }

  return Array.from(seen.values()).sort((a, b) => {
    const bDate = toDate(b.created_at)?.getTime() || 0;
    const aDate = toDate(a.created_at)?.getTime() || 0;
    return bDate - aDate;
  });
}

function countBy(rows, key) {
  const map = new Map();

  for (const row of rows) {
    const label = normalizeText(row[key], "Unknown");
    map.set(label, (map.get(label) || 0) + 1);
  }

  return map;
}

function orderedEntries(map, preferredOrder = []) {
  const entries = Array.from(map.entries());
  const orderMap = new Map(preferredOrder.map((item, index) => [item, index]));

  return entries.sort((a, b) => {
    const aIndex = orderMap.has(a[0]) ? orderMap.get(a[0]) : 9999;
    const bIndex = orderMap.has(b[0]) ? orderMap.get(b[0]) : 9999;

    if (aIndex !== bIndex) return aIndex - bIndex;
    return b[1] - a[1] || a[0].localeCompare(b[0]);
  });
}

function groupTrend(rows, groupKey) {
  const map = new Map();

  for (const row of rows) {
    const date = toDate(row.created_at);
    if (!date) continue;

    let label = "";
    let sortValue = "";

    if (groupKey === "month") {
      label = date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
      });
      sortValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    } else if (groupKey === "week") {
      const weekStart = new Date(date);
      const day = weekStart.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      weekStart.setDate(weekStart.getDate() + diff);
      weekStart.setHours(0, 0, 0, 0);

      label = `Week of ${weekStart.toLocaleDateString(undefined, {
        month: "short",
        day: "2-digit",
      })}`;
      sortValue = weekStart.toISOString();
    } else {
      label = date.toLocaleDateString(undefined, {
        month: "short",
        day: "2-digit",
      });
      sortValue = date.toISOString().slice(0, 10);
    }

    const current = map.get(sortValue) || {
      label,
      sortValue,
      total: 0,
      missed: 0,
      positive: 0,
      unresolved: 0,
      veryPositive: 0,
    };

    current.total += 1;

    if (row.review_sentiment === "Missed Opportunity") current.missed += 1;
    if (
      row.review_sentiment === "Likely Positive Review" ||
      row.review_sentiment === "Highly Likely Positive Review"
    ) {
      current.positive += 1;
    }
    if (row.resolution_status === "Unresolved") current.unresolved += 1;
    if (row.client_sentiment === "Very Positive") current.veryPositive += 1;

    map.set(sortValue, current);
  }

  return Array.from(map.values()).sort((a, b) =>
    a.sortValue.localeCompare(b.sortValue)
  );
}

function getUniqueValues(rows, key) {
  return Array.from(
    new Set(rows.map((row) => String(row[key] || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
}

function buildEmployeeLeaderboard(rows) {
  const map = new Map();

  for (const row of rows) {
    const employee = normalizeText(row.employee_name, "Unmapped");
    const current = map.get(employee) || {
      employee_name: employee,
      team_name: row.team_name || "-",
      handled: 0,
      missed: 0,
      positive: 0,
      veryPositive: 0,
      unresolved: 0,
      mapped: row.employee_match_status === "mapped" ? 1 : 0,
      sampleConversationId: row.conversation_id || "",
    };

    current.handled += 1;

    if (row.review_sentiment === "Missed Opportunity") current.missed += 1;
    if (
      row.review_sentiment === "Likely Positive Review" ||
      row.review_sentiment === "Highly Likely Positive Review"
    ) {
      current.positive += 1;
    }
    if (row.client_sentiment === "Very Positive") current.veryPositive += 1;
    if (row.resolution_status === "Unresolved") current.unresolved += 1;

    map.set(employee, current);
  }

  return Array.from(map.values())
    .map((item) => ({
      ...item,
      opportunityRate: item.handled ? (item.missed / item.handled) * 100 : 0,
      positiveRate: item.handled ? (item.positive / item.handled) * 100 : 0,
      riskRate: item.handled ? (item.unresolved / item.handled) * 100 : 0,
    }))
    .sort((a, b) => b.handled - a.handled || a.employee_name.localeCompare(b.employee_name));
}

function makeConversationUrl(conversationId) {
  const id = String(conversationId || "").trim();
  return id ? `${INTERCOM_BASE_URL}/${id}` : "#";
}

function buildSpotlightRows(rows, spotlightReview, spotlightClient) {
  return rows
    .filter((row) => {
      const reviewMatch =
        spotlightReview === "all" ? true : row.review_sentiment === spotlightReview;
      const clientMatch =
        spotlightClient === "all" ? true : row.client_sentiment === spotlightClient;
      return reviewMatch && clientMatch;
    })
    .slice(0, 12);
}

function renderPillLinks(params, paramName, activeValue, values) {
  return (
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
      {values.map((item) => {
        const isActive = activeValue === item.key;
        return (
          <Link
            key={item.key}
            href={buildHref(params, { [paramName]: item.key })}
            style={{
              padding: "8px 12px",
              borderRadius: "999px",
              textDecoration: "none",
              fontSize: "12px",
              fontWeight: 700,
              border: isActive
                ? "1px solid rgba(96,165,250,0.28)"
                : "1px solid rgba(255,255,255,0.08)",
              background: isActive
                ? "linear-gradient(135deg, rgba(37,99,235,0.24), rgba(168,85,247,0.18))"
                : "rgba(255,255,255,0.03)",
              color: isActive ? "#eaf0ff" : "#a9b4d0",
              boxShadow: isActive ? "0 0 18px rgba(59,130,246,0.16)" : "none",
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

function DistributionBars({
  entries,
  total,
  color,
  params,
  filterKey,
  activeValue,
}) {
  if (!entries.length) {
    return (
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
        No records match this section yet.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "12px" }}>
      {entries.map(([label, count]) => {
        const width = total ? Math.max((count / total) * 100, 4) : 0;
        const isActive = activeValue === label;

        return (
          <Link
            key={label}
            href={buildHref(params, {
              [filterKey]: isActive ? "all" : label,
            })}
            style={{
              textDecoration: "none",
              color: "inherit",
              display: "block",
            }}
          >
            <div
              style={{
                borderRadius: "18px",
                border: isActive
                  ? "1px solid rgba(96,165,250,0.28)"
                  : "1px solid rgba(255,255,255,0.08)",
                background: isActive
                  ? "rgba(37,99,235,0.08)"
                  : "rgba(255,255,255,0.025)",
                padding: "14px",
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
                <div style={{ fontSize: "14px", fontWeight: 700, color: "#eef3ff" }}>
                  {label}
                </div>
                <div
                  style={{
                    fontSize: "13px",
                    color: "#c8d6ff",
                    fontWeight: 700,
                  }}
                >
                  {count} · {formatPercent((count / total) * 100)}
                </div>
              </div>

              <div
                style={{
                  width: "100%",
                  height: "10px",
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
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export default async function DashboardPage({ searchParams }) {
  const params = parseSearchParams(await searchParams);
  const supabase = getSupabaseAdminClient();

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
    maxWidth: "1480px",
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
    padding: "28px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)",
  };

  const cardStyle = {
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(9, 13, 28, 0.84)",
    borderRadius: "22px",
    padding: "22px",
    boxShadow: "0 14px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.03)",
  };

  const sectionCardStyle = {
    border: "1px solid rgba(255,255,255,0.08)",
    background: "linear-gradient(180deg, rgba(10,15,32,0.9), rgba(7,10,22,0.96))",
    borderRadius: "24px",
    padding: "24px",
    boxShadow: "0 18px 40px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.03)",
  };

  const labelStyle = {
    display: "block",
    fontSize: "12px",
    color: "#8ea0d6",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    marginBottom: "8px",
    fontWeight: 600,
  };

  const inputStyle = {
    width: "100%",
    minHeight: "52px",
    borderRadius: "16px",
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(5,8,18,0.9)",
    color: "#e7ecff",
    padding: "0 16px",
    fontSize: "14px",
    outline: "none",
    boxSizing: "border-box",
  };

  const buttonStyle = {
    border: "none",
    borderRadius: "16px",
    padding: "14px 20px",
    fontSize: "14px",
    fontWeight: 700,
    color: "#ffffff",
    cursor: "pointer",
    background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 50%, #db2777 100%)",
    boxShadow: "0 14px 30px rgba(91,33,182,0.35)",
  };

  if (!supabase) {
    return (
      <main style={pageStyle}>
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
              <div style={{ fontSize: "24px", fontWeight: 700 }}>
                Review Approach &amp; Client Sentiment Tracking
              </div>
            </div>
          </div>

          <section style={panelStyle}>
            <h1
              style={{
                fontSize: "40px",
                lineHeight: 1.08,
                letterSpacing: "-0.04em",
                margin: "0 0 16px",
              }}
            >
              Dashboard cannot load yet.
            </h1>
            <p style={{ margin: 0, color: "#a9b4d0", fontSize: "18px", lineHeight: 1.7 }}>
              Supabase server credentials are missing. This page reads directly from Supabase, not
              from the Results UI, so it needs the server environment variables to exist first.
            </p>
          </section>
        </div>
      </main>
    );
  }

  const { data, error } = await supabase
    .from("audit_results")
    .select(
      `
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
      created_at,
      audit_runs (
        requested_by_email,
        audit_mode,
        start_date,
        end_date,
        created_at
      )
    `
    )
    .order("created_at", { ascending: false })
    .limit(10000);

  const rows = error ? [] : Array.isArray(data) ? data : [];
  const latestUniqueRows = dedupeLatestByConversation(rows);
  const filteredRows = applyGlobalFilters(latestUniqueRows, params);

  const rangeInfo = getDateRange(params);
  const reviewRows = applySectionWindow(filteredRows, params.reviewWindow, rangeInfo.endDate);
  const clientRows = applySectionWindow(filteredRows, params.clientWindow, rangeInfo.endDate);
  const leaderboardRows = applySectionWindow(
    filteredRows,
    params.leaderboardWindow,
    rangeInfo.endDate
  );
  const trendRows = applySectionWindow(filteredRows, params.trendWindow, rangeInfo.endDate);

  const reviewEntries = orderedEntries(
    countBy(reviewRows, "review_sentiment"),
    REVIEW_SENTIMENT_ORDER
  );
  const clientEntries = orderedEntries(
    countBy(clientRows, "client_sentiment"),
    CLIENT_SENTIMENT_ORDER
  );
  const resolutionEntries = orderedEntries(
    countBy(filteredRows, "resolution_status"),
    RESOLUTION_ORDER
  );
  const trendEntries = groupTrend(trendRows, params.trendGroup);
  const employeeLeaderboard = buildEmployeeLeaderboard(leaderboardRows).slice(0, 12);
  const spotlightRows = buildSpotlightRows(
    filteredRows,
    params.spotlightReview,
    params.spotlightClient
  );

  const teams = getUniqueValues(latestUniqueRows, "team_name");
  const employees = getUniqueValues(latestUniqueRows, "employee_name");
  const reviewSentiments = getUniqueValues(latestUniqueRows, "review_sentiment");
  const clientSentiments = getUniqueValues(latestUniqueRows, "client_sentiment");
  const resolutionStatuses = getUniqueValues(latestUniqueRows, "resolution_status");

  const total = filteredRows.length;
  const positiveOutcomes = filteredRows.filter((row) =>
    ["Likely Positive Review", "Highly Likely Positive Review"].includes(row.review_sentiment)
  ).length;
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
  const cexCount = filteredRows.filter((row) => row.team_name === "CEx").length;
  const mappedCount = filteredRows.filter(
    (row) => row.employee_match_status === "mapped"
  ).length;
  const errorCount = filteredRows.filter((row) => Boolean(row.error)).length;

  const kpiCards = [
    {
      label: "Unique Audited Conversations",
      value: total,
      subtext: "Latest stored row per conversation only. Dashboard ignores duplicate audit saves.",
      accent: "linear-gradient(135deg, rgba(37,99,235,0.22), rgba(168,85,247,0.14))",
    },
    {
      label: "Missed Opportunities",
      value: missedCount,
      subtext: "Review requests that were likely left on the table inside the filtered result set.",
      accent: "linear-gradient(135deg, rgba(245,158,11,0.18), rgba(249,115,22,0.14))",
    },
    {
      label: "Very Positive Clients",
      value: veryPositiveCount,
      subtext: "Conversations where the client ended in a very positive emotional state.",
      accent: "linear-gradient(135deg, rgba(16,185,129,0.18), rgba(6,182,212,0.14))",
    },
    {
      label: "Positive Resolution Rate",
      value: formatPercent(total ? (resolvedCount / total) * 100 : 0),
      subtext: "Share of filtered conversations that ended with resolution status = Resolved.",
      accent: "linear-gradient(135deg, rgba(14,165,233,0.16), rgba(34,197,94,0.14))",
    },
    {
      label: "Unresolved Risk Count",
      value: unresolvedCount,
      subtext: "Rows still marked as unresolved in the deduped filtered data.",
      accent: "linear-gradient(135deg, rgba(244,63,94,0.18), rgba(168,85,247,0.14))",
    },
    {
      label: "Mapped Employee Records",
      value: `${mappedCount}/${total}`,
      subtext: `CEx rows in current view: ${cexCount}. Dashboard is now reading mapped employee fields from Supabase.`,
      accent: "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(16,185,129,0.12))",
    },
  ];

  return (
    <main style={pageStyle}>
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
            Real Supabase Analytics
          </div>
        </div>

        <section style={{ ...panelStyle, marginBottom: "24px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)",
              gap: "24px",
              alignItems: "start",
            }}
          >
            <div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 12px",
                  borderRadius: "999px",
                  background: "rgba(99,102,241,0.14)",
                  border: "1px solid rgba(129,140,248,0.2)",
                  color: "#cdd7ff",
                  fontSize: "12px",
                  fontWeight: 600,
                  marginBottom: "18px",
                }}
              >
                Premium Intelligence Layer
              </div>

              <h1
                style={{
                  fontSize: "56px",
                  lineHeight: 1.01,
                  letterSpacing: "-0.055em",
                  margin: "0 0 18px",
                  maxWidth: "900px",
                }}
              >
                Premium QA intelligence from deduped stored audits, not fake dashboard filler.
              </h1>

              <p
                style={{
                  margin: "0 0 20px",
                  color: "#a9b4d0",
                  fontSize: "18px",
                  lineHeight: 1.75,
                  maxWidth: "920px",
                }}
              >
                This Dashboard reads directly from Supabase, dedupes by conversation ID, keeps the
                latest stored result, and turns your mapped audit records into real insight panels,
                trend views, employee intelligence, and Intercom drilldowns.
              </p>

              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <Link
                  href="/run"
                  style={{
                    ...buttonStyle,
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  Run New Audit
                </Link>

                <Link
                  href="/results"
                  style={{
                    textDecoration: "none",
                    borderRadius: "16px",
                    padding: "14px 18px",
                    fontSize: "14px",
                    fontWeight: 700,
                    color: "#e5ebff",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  Open Results Archive
                </Link>

                <Link
                  href="/admin"
                  style={{
                    textDecoration: "none",
                    borderRadius: "16px",
                    padding: "14px 18px",
                    fontSize: "14px",
                    fontWeight: 700,
                    color: "#e5ebff",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  Admin Controls
                </Link>
              </div>
            </div>

            <div style={{ ...cardStyle, minHeight: "100%" }}>
              <div style={labelStyle}>Dashboard Foundation</div>
              <div
                style={{
                  fontSize: "26px",
                  fontWeight: 700,
                  lineHeight: 1.15,
                  marginBottom: "14px",
                }}
              >
                What this page is pulling from
              </div>

              <div
                style={{
                  display: "grid",
                  gap: "12px",
                  color: "#dbe7ff",
                  fontSize: "15px",
                  lineHeight: 1.8,
                }}
              >
                <div
                  style={{
                    borderRadius: "18px",
                    background: "rgba(16,185,129,0.08)",
                    border: "1px solid rgba(16,185,129,0.18)",
                    padding: "14px 16px",
                  }}
                >
                  <strong>Source of truth:</strong> Supabase `audit_results`, `audit_runs`, and
                  mapped employee fields.
                </div>

                <div
                  style={{
                    borderRadius: "18px",
                    background: "rgba(59,130,246,0.08)",
                    border: "1px solid rgba(59,130,246,0.18)",
                    padding: "14px 16px",
                  }}
                >
                  <strong>Duplicate protection:</strong> only the latest saved row per
                  conversation_id is counted in analytics.
                </div>

                <div
                  style={{
                    borderRadius: "18px",
                    background: "rgba(245,158,11,0.08)",
                    border: "1px solid rgba(245,158,11,0.18)",
                    padding: "14px 16px",
                  }}
                >
                  <strong>Drilldown behavior:</strong> each conversation ID can open directly in
                  Intercom.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section style={{ ...panelStyle, marginBottom: "24px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "18px",
              flexWrap: "wrap",
              alignItems: "end",
              marginBottom: "18px",
            }}
          >
            <div>
              <div style={labelStyle}>Global Dashboard Controls</div>
              <div
                style={{
                  fontSize: "28px",
                  fontWeight: 700,
                  lineHeight: 1.12,
                  marginBottom: "8px",
                }}
              >
                Filter the entire analytics layer
              </div>
              <div style={{ color: "#a9b4d0", fontSize: "15px", lineHeight: 1.7 }}>
                Change the date range, employee slice, team, or sentiment focus. Every section
                below reads from this filtered foundation first.
              </div>
            </div>

            <div style={{ color: "#a9b4d0", fontSize: "14px", lineHeight: 1.7 }}>
              Active range:{" "}
              <strong style={{ color: "#eef3ff" }}>
                {rangeInfo.startDate
                  ? `${formatDateOnly(rangeInfo.startDate)} to ${formatDateOnly(
                      rangeInfo.endDate
                    )}`
                  : `All available data until ${formatDateOnly(rangeInfo.endDate)}`}
              </strong>
            </div>
          </div>

          <form method="get">
            <input type="hidden" name="reviewWindow" value={params.reviewWindow} />
            <input type="hidden" name="clientWindow" value={params.clientWindow} />
            <input type="hidden" name="leaderboardWindow" value={params.leaderboardWindow} />
            <input type="hidden" name="trendWindow" value={params.trendWindow} />
            <input type="hidden" name="trendGroup" value={params.trendGroup} />
            <input type="hidden" name="spotlightReview" value={params.spotlightReview} />
            <input type="hidden" name="spotlightClient" value={params.spotlightClient} />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: "14px",
                marginBottom: "14px",
              }}
            >
              <div>
                <label style={labelStyle}>Range Preset</label>
                <select name="range" defaultValue={params.range} style={inputStyle}>
                  <option value="7d">Past 7 Days</option>
                  <option value="30d">Past 30 Days</option>
                  <option value="90d">Past 90 Days</option>
                  <option value="180d">Past 6 Months</option>
                  <option value="365d">Past 12 Months</option>
                  <option value="all">All Time</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              <div>
                <label style={labelStyle}>Start Date</label>
                <input type="date" name="start" defaultValue={params.start} style={inputStyle} />
              </div>

              <div>
                <label style={labelStyle}>End Date</label>
                <input type="date" name="end" defaultValue={params.end} style={inputStyle} />
              </div>

              <div>
                <label style={labelStyle}>Team</label>
                <select name="team" defaultValue={params.team} style={inputStyle}>
                  <option value="all">All Teams</option>
                  {teams.map((team) => (
                    <option key={team} value={team}>
                      {team}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Employee</label>
                <select name="employee" defaultValue={params.employee} style={inputStyle}>
                  <option value="all">All Employees</option>
                  {employees.map((employee) => (
                    <option key={employee} value={employee}>
                      {employee}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Review Sentiment</label>
                <select name="review" defaultValue={params.review} style={inputStyle}>
                  <option value="all">All Review Sentiments</option>
                  {reviewSentiments.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Client Sentiment</label>
                <select name="client" defaultValue={params.client} style={inputStyle}>
                  <option value="all">All Client Sentiments</option>
                  {clientSentiments.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Resolution</label>
                <select name="resolution" defaultValue={params.resolution} style={inputStyle}>
                  <option value="all">All Resolution Statuses</option>
                  {resolutionStatuses.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) 220px 220px auto",
                gap: "14px",
                alignItems: "end",
              }}
            >
              <div>
                <label style={labelStyle}>Insight Focus Review Type</label>
                <select
                  name="spotlightReview"
                  defaultValue={params.spotlightReview}
                  style={inputStyle}
                >
                  <option value="all">All Review Types</option>
                  {reviewSentiments.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Insight Focus Client Sentiment</label>
                <select
                  name="spotlightClient"
                  defaultValue={params.spotlightClient}
                  style={inputStyle}
                >
                  <option value="all">All Client Sentiments</option>
                  {clientSentiments.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Result Type</label>
                <select
                  name="resultType"
                  defaultValue={params.resultType}
                  style={inputStyle}
                >
                  <option value="all">All Result Types</option>
                  <option value="Positive">Positive</option>
                  <option value="Opportunity">Opportunity</option>
                  <option value="Risk">Risk</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <button type="submit" style={buttonStyle}>
                Apply Dashboard Filters
              </button>
            </div>
          </form>
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
            gap: "18px",
            marginBottom: "24px",
          }}
        >
          {kpiCards.map((card) => (
            <div key={card.label} style={{ ...cardStyle, background: card.accent }}>
              <div
                style={{
                  color: "#8ea0d6",
                  fontSize: "12px",
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  marginBottom: "10px",
                }}
              >
                {card.label}
              </div>
              <div
                style={{
                  fontSize: "34px",
                  fontWeight: 800,
                  letterSpacing: "-0.04em",
                  marginBottom: "10px",
                }}
              >
                {card.value}
              </div>
              <div style={{ color: "#d8e3ff", fontSize: "14px", lineHeight: 1.7 }}>
                {card.subtext}
              </div>
            </div>
          ))}
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: "18px",
            marginBottom: "24px",
          }}
        >
          <div style={sectionCardStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
                flexWrap: "wrap",
                alignItems: "center",
                marginBottom: "18px",
              }}
            >
              <div>
                <div style={labelStyle}>Review Sentiment Distribution</div>
                <div style={{ fontSize: "26px", fontWeight: 700, lineHeight: 1.15 }}>
                  Outcome mix inside your filtered archive
                </div>
              </div>

              {renderPillLinks(params, "reviewWindow", params.reviewWindow, SECTION_WINDOWS)}
            </div>

            <div style={{ color: "#a9b4d0", fontSize: "15px", lineHeight: 1.7, marginBottom: "18px" }}>
              Your old logic emphasized Missed Opportunity. This section keeps that visible, but it
              also lets you pivot to any review outcome through the global filter bar.
            </div>

            <DistributionBars
              entries={reviewEntries}
              total={reviewRows.length}
              color="linear-gradient(90deg, #06b6d4, #8b5cf6, #ec4899)"
              params={params}
              filterKey="review"
              activeValue={params.review}
            />
          </div>

          <div style={sectionCardStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
                flexWrap: "wrap",
                alignItems: "center",
                marginBottom: "18px",
              }}
            >
              <div>
                <div style={labelStyle}>Client Sentiment Distribution</div>
                <div style={{ fontSize: "26px", fontWeight: 700, lineHeight: 1.15 }}>
                  Emotional direction across deduped conversations
                </div>
              </div>

              {renderPillLinks(params, "clientWindow", params.clientWindow, SECTION_WINDOWS)}
            </div>

            <div style={{ color: "#a9b4d0", fontSize: "15px", lineHeight: 1.7, marginBottom: "18px" }}>
              Your old sheet focused on Very Positive. This section preserves that but keeps the
              whole emotional range visible, with one-click drill filters.
            </div>

            <DistributionBars
              entries={clientEntries}
              total={clientRows.length}
              color="linear-gradient(90deg, #22c55e, #06b6d4, #8b5cf6)"
              params={params}
              filterKey="client"
              activeValue={params.client}
            />
          </div>
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 0.95fr) minmax(0, 1.05fr)",
            gap: "18px",
            marginBottom: "24px",
          }}
        >
          <div style={sectionCardStyle}>
            <div style={labelStyle}>Resolution and Risk</div>
            <div
              style={{
                fontSize: "26px",
                fontWeight: 700,
                lineHeight: 1.15,
                marginBottom: "12px",
              }}
            >
              Resolution pressure and quality-state mix
            </div>

            <div style={{ display: "grid", gap: "12px", marginBottom: "18px" }}>
              {resolutionEntries.map(([label, count]) => {
                const width = total ? Math.max((count / total) * 100, 4) : 0;
                const active = params.resolution === label;

                return (
                  <Link
                    key={label}
                    href={buildHref(params, { resolution: active ? "all" : label })}
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <div
                      style={{
                        borderRadius: "18px",
                        border: active
                          ? "1px solid rgba(96,165,250,0.28)"
                          : "1px solid rgba(255,255,255,0.08)",
                        background: active
                          ? "rgba(37,99,235,0.08)"
                          : "rgba(255,255,255,0.025)",
                        padding: "14px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "12px",
                          marginBottom: "10px",
                        }}
                      >
                        <div style={{ fontSize: "14px", fontWeight: 700 }}>{label}</div>
                        <div style={{ fontSize: "13px", color: "#c8d6ff", fontWeight: 700 }}>
                          {count} · {formatPercent(total ? (count / total) * 100 : 0)}
                        </div>
                      </div>

                      <div
                        style={{
                          width: "100%",
                          height: "10px",
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
                            background:
                              label === "Resolved"
                                ? "linear-gradient(90deg, #10b981, #06b6d4)"
                                : label === "Pending"
                                ? "linear-gradient(90deg, #f59e0b, #f97316)"
                                : label === "Unclear"
                                ? "linear-gradient(90deg, #8b5cf6, #ec4899)"
                                : "linear-gradient(90deg, #ef4444, #b91c1c)",
                          }}
                        />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: "12px",
              }}
            >
              {[
                {
                  title: "Positive Review Outcomes",
                  value: positiveOutcomes,
                  desc: "Likely Positive + Highly Likely Positive",
                },
                {
                  title: "Rows With Errors",
                  value: errorCount,
                  desc: "Stored audit rows carrying an error message",
                },
                {
                  title: "Mapped Rows",
                  value: mappedCount,
                  desc: "Rows with mapped employee identity",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  style={{
                    borderRadius: "18px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    padding: "16px",
                  }}
                >
                  <div style={{ color: "#8ea0d6", fontSize: "12px", marginBottom: "8px" }}>
                    {item.title}
                  </div>
                  <div style={{ fontSize: "28px", fontWeight: 800, marginBottom: "8px" }}>
                    {item.value}
                  </div>
                  <div style={{ color: "#a9b4d0", fontSize: "13px", lineHeight: 1.6 }}>
                    {item.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={sectionCardStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
                flexWrap: "wrap",
                alignItems: "center",
                marginBottom: "18px",
              }}
            >
              <div>
                <div style={labelStyle}>Insight Spotlight</div>
                <div style={{ fontSize: "26px", fontWeight: 700, lineHeight: 1.15 }}>
                  Deep focus on the combinations you care about most
                </div>
              </div>

              <div style={{ color: "#a9b4d0", fontSize: "13px", lineHeight: 1.6 }}>
                Current focus: <strong>{params.spotlightReview}</strong> +{" "}
                <strong>{params.spotlightClient}</strong>
              </div>
            </div>

            <div style={{ color: "#a9b4d0", fontSize: "15px", lineHeight: 1.7, marginBottom: "18px" }}>
              This is where you can keep looking at Missed Opportunity + Very Positive by default,
              but the filter bar above lets you switch to any combination you want.
            </div>

            {spotlightRows.length === 0 ? (
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
                No conversations match this spotlight combination in the current filter scope.
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gap: "12px",
                  maxHeight: "620px",
                  overflowY: "auto",
                  paddingRight: "4px",
                }}
              >
                {spotlightRows.map((row) => (
                  <a
                    key={row.conversation_id}
                    href={makeConversationUrl(row.conversation_id)}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <div
                      style={{
                        borderRadius: "18px",
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.03)",
                        padding: "16px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "12px",
                          flexWrap: "wrap",
                          marginBottom: "10px",
                        }}
                      >
                        <div>
                          <div style={{ color: "#8ea0d6", fontSize: "12px", marginBottom: "6px" }}>
                            Conversation
                          </div>
                          <div style={{ fontSize: "18px", fontWeight: 800 }}>
                            {row.conversation_id}
                          </div>
                        </div>

                        <div style={{ textAlign: "right" }}>
                          <div style={{ color: "#8ea0d6", fontSize: "12px", marginBottom: "6px" }}>
                            Replied At
                          </div>
                          <div style={{ fontSize: "14px", fontWeight: 700 }}>
                            {formatDateTime(row.replied_at || row.created_at)}
                          </div>
                        </div>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                          gap: "12px",
                          marginBottom: "12px",
                        }}
                      >
                        <div>
                          <div style={{ color: "#8ea0d6", fontSize: "12px", marginBottom: "4px" }}>
                            Employee
                          </div>
                          <div style={{ fontSize: "14px", fontWeight: 700 }}>
                            {row.employee_name || "Unmapped"}
                          </div>
                        </div>

                        <div>
                          <div style={{ color: "#8ea0d6", fontSize: "12px", marginBottom: "4px" }}>
                            Team
                          </div>
                          <div style={{ fontSize: "14px", fontWeight: 700 }}>
                            {row.team_name || "-"}
                          </div>
                        </div>

                        <div>
                          <div style={{ color: "#8ea0d6", fontSize: "12px", marginBottom: "4px" }}>
                            Review Sentiment
                          </div>
                          <div style={{ fontSize: "14px", fontWeight: 700 }}>
                            {row.review_sentiment || "-"}
                          </div>
                        </div>

                        <div>
                          <div style={{ color: "#8ea0d6", fontSize: "12px", marginBottom: "4px" }}>
                            Client Sentiment
                          </div>
                          <div style={{ fontSize: "14px", fontWeight: 700 }}>
                            {row.client_sentiment || "-"}
                          </div>
                        </div>
                      </div>

                      <div style={{ color: "#dbe7ff", fontSize: "14px", lineHeight: 1.7 }}>
                        {row.ai_verdict || row.error || "No verdict text stored."}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </section>

        <section style={{ ...sectionCardStyle, marginBottom: "24px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "12px",
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: "18px",
            }}
          >
            <div>
              <div style={labelStyle}>Employee Intelligence</div>
              <div style={{ fontSize: "28px", fontWeight: 700, lineHeight: 1.12 }}>
                Who is driving opportunity, positivity, and risk?
              </div>
            </div>

            {renderPillLinks(
              params,
              "leaderboardWindow",
              params.leaderboardWindow,
              SECTION_WINDOWS
            )}
          </div>

          <div style={{ color: "#a9b4d0", fontSize: "15px", lineHeight: 1.7, marginBottom: "18px" }}>
            This section is designed to go beyond your old sheet. It still respects employee-level
            logic, but adds positive rate, opportunity rate, unresolved risk rate, and drillable
            conversation samples.
          </div>

          {employeeLeaderboard.length === 0 ? (
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
              No employee leaderboard data matches the current filters.
            </div>
          ) : (
            <div
              style={{
                overflow: "hidden",
                borderRadius: "20px",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(4,8,20,0.72)",
              }}
            >
              <div style={{ maxHeight: "680px", overflow: "auto" }}>
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
                        "Missed Opportunity",
                        "Very Positive",
                        "Positive Rate",
                        "Risk Rate",
                        "Sample Conversation",
                      ].map((label) => (
                        <th
                          key={label}
                          style={{
                            padding: "16px 14px",
                            textAlign: "left",
                            fontSize: "12px",
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
                    {employeeLeaderboard.map((row, index) => (
                      <tr
                        key={`${row.employee_name}-${index}`}
                        style={{
                          background: index % 2 === 0 ? "rgba(255,255,255,0.018)" : "transparent",
                        }}
                      >
                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            color: "#f5f7ff",
                            fontWeight: 800,
                            verticalAlign: "top",
                          }}
                        >
                          {row.employee_name}
                        </td>
                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            color: "#dbe7ff",
                            verticalAlign: "top",
                          }}
                        >
                          {row.team_name || "-"}
                        </td>
                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            color: "#dbe7ff",
                            verticalAlign: "top",
                            fontWeight: 700,
                          }}
                        >
                          {row.handled}
                        </td>
                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            color: "#fde68a",
                            verticalAlign: "top",
                            fontWeight: 700,
                          }}
                        >
                          {row.missed}
                        </td>
                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            color: "#bbf7d0",
                            verticalAlign: "top",
                            fontWeight: 700,
                          }}
                        >
                          {row.veryPositive}
                        </td>
                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            color: "#dbe7ff",
                            verticalAlign: "top",
                            fontWeight: 700,
                          }}
                        >
                          {formatPercent(row.positiveRate)}
                        </td>
                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            color: "#fecdd3",
                            verticalAlign: "top",
                            fontWeight: 700,
                          }}
                        >
                          {formatPercent(row.riskRate)}
                        </td>
                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            verticalAlign: "top",
                          }}
                        >
                          <a
                            href={makeConversationUrl(row.sampleConversationId)}
                            target="_blank"
                            rel="noreferrer"
                            style={{
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
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: "18px",
            marginBottom: "24px",
          }}
        >
          <div style={sectionCardStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
                flexWrap: "wrap",
                alignItems: "center",
                marginBottom: "18px",
              }}
            >
              <div>
                <div style={labelStyle}>Trend Signal</div>
                <div style={{ fontSize: "26px", fontWeight: 700, lineHeight: 1.15 }}>
                  Time-series movement across the archive
                </div>
              </div>

              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                {renderPillLinks(params, "trendWindow", params.trendWindow, SECTION_WINDOWS)}
                {renderPillLinks(params, "trendGroup", params.trendGroup, TREND_GROUPS)}
              </div>
            </div>

            <div style={{ color: "#a9b4d0", fontSize: "15px", lineHeight: 1.7, marginBottom: "18px" }}>
              This section lets you switch the timeframe and grouping however you want. It is not
              locked to one weekly-only view.
            </div>

            {trendEntries.length === 0 ? (
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
                No trend data matches the current filters.
              </div>
            ) : (
              <div style={{ display: "grid", gap: "14px" }}>
                {trendEntries.map((item) => {
                  const totalMax = Math.max(...trendEntries.map((entry) => entry.total), 1);

                  return (
                    <div
                      key={item.sortValue}
                      style={{
                        borderRadius: "18px",
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.025)",
                        padding: "14px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "12px",
                          flexWrap: "wrap",
                          marginBottom: "10px",
                        }}
                      >
                        <div style={{ fontSize: "14px", fontWeight: 800 }}>{item.label}</div>
                        <div style={{ color: "#c8d6ff", fontSize: "13px", fontWeight: 700 }}>
                          {item.total} total
                        </div>
                      </div>

                      <div
                        style={{
                          width: "100%",
                          height: "12px",
                          borderRadius: "999px",
                          background: "rgba(255,255,255,0.05)",
                          overflow: "hidden",
                          marginBottom: "12px",
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.max((item.total / totalMax) * 100, 5)}%`,
                            height: "100%",
                            borderRadius: "999px",
                            background: "linear-gradient(90deg, #2563eb, #7c3aed, #db2777)",
                          }}
                        />
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                          gap: "10px",
                          color: "#dbe7ff",
                          fontSize: "13px",
                          lineHeight: 1.6,
                        }}
                      >
                        <div>
                          <strong>Missed:</strong> {item.missed}
                        </div>
                        <div>
                          <strong>Positive:</strong> {item.positive}
                        </div>
                        <div>
                          <strong>Very Positive:</strong> {item.veryPositive}
                        </div>
                        <div>
                          <strong>Unresolved:</strong> {item.unresolved}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={sectionCardStyle}>
            <div style={labelStyle}>Conversation Drilldown</div>
            <div
              style={{
                fontSize: "26px",
                fontWeight: 700,
                lineHeight: 1.15,
                marginBottom: "12px",
              }}
            >
              Click straight into Intercom from the analytics layer
            </div>

            <div style={{ color: "#a9b4d0", fontSize: "15px", lineHeight: 1.7, marginBottom: "18px" }}>
              Every row below is deduped already. You asked for each data point to be useful, so
              each conversation ID can open the real Intercom conversation directly.
            </div>

            <div
              style={{
                overflow: "hidden",
                borderRadius: "20px",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(4,8,20,0.72)",
              }}
            >
              <div style={{ maxHeight: "760px", overflow: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    minWidth: "1380px",
                    borderCollapse: "collapse",
                  }}
                >
                  <thead>
                    <tr style={{ background: "rgba(10,18,34,0.96)" }}>
                      {[
                        "Conversation",
                        "Employee",
                        "Team",
                        "Review Sentiment",
                        "Client Sentiment",
                        "Resolution",
                        "Verdict / Error",
                        "Replied At",
                        "Open",
                      ].map((label) => (
                        <th
                          key={label}
                          style={{
                            padding: "16px 14px",
                            textAlign: "left",
                            fontSize: "12px",
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
                    {filteredRows.slice(0, 60).map((row, index) => (
                      <tr
                        key={`${row.conversation_id}-${index}`}
                        style={{
                          background: index % 2 === 0 ? "rgba(255,255,255,0.018)" : "transparent",
                        }}
                      >
                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            verticalAlign: "top",
                          }}
                        >
                          <div style={{ fontWeight: 800, marginBottom: "6px" }}>
                            {row.conversation_id}
                          </div>
                          <div style={{ color: "#8ea0d6", fontSize: "12px", lineHeight: 1.6 }}>
                            Agent: {row.agent_name || "Unassigned"}
                            <br />
                            Client: {row.client_email || "-"}
                            <br />
                            CSAT: {row.csat_score || "-"}
                          </div>
                        </td>

                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            verticalAlign: "top",
                            fontWeight: 700,
                          }}
                        >
                          {row.employee_name || "Unmapped"}
                        </td>

                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            verticalAlign: "top",
                          }}
                        >
                          {row.team_name || "-"}
                        </td>

                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            verticalAlign: "top",
                          }}
                        >
                          {row.review_sentiment || "-"}
                        </td>

                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            verticalAlign: "top",
                          }}
                        >
                          {row.client_sentiment || "-"}
                        </td>

                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            verticalAlign: "top",
                          }}
                        >
                          {row.resolution_status || "-"}
                        </td>

                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            verticalAlign: "top",
                            color: row.error ? "#fecdd3" : "#dbe7ff",
                            lineHeight: 1.65,
                            maxWidth: "420px",
                          }}
                        >
                          {row.error || row.ai_verdict || "-"}
                        </td>

                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            verticalAlign: "top",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {formatDateTime(row.replied_at || row.created_at)}
                        </td>

                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            verticalAlign: "top",
                          }}
                        >
                          <a
                            href={makeConversationUrl(row.conversation_id)}
                            target="_blank"
                            rel="noreferrer"
                            style={{
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
                            View
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
      </div>
    </main>
  );
}
