"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

const DATE_PRESET_OPTIONS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "past_7_days", label: "Past 7 Days" },
  { key: "past_30_days", label: "Past 30 Days" },
  { key: "this_month", label: "This Month" },
  { key: "past_90_days", label: "Past 90 Days" },
  { key: "custom", label: "Custom" },
];

const RESULT_TYPE_OPTIONS = [
  { value: "all", label: "All Results" },
  { value: "success_only", label: "Successful Only" },
  { value: "errors_only", label: "Errors Only" },
  { value: "opportunity_cases", label: "Missed Opportunities" },
  { value: "positive_signals", label: "Positive Signals" },
  { value: "negative_risk", label: "Negative Risk" },
];

const REVIEW_SENTIMENT_OPTIONS = [
  "Likely Negative Review",
  "Likely Positive Review",
  "Highly Likely Negative Review",
  "Highly Likely Positive Review",
  "Missed Opportunity",
  "Negative Outcome - No Review Request",
];

const CLIENT_SENTIMENT_OPTIONS = [
  "Very Negative",
  "Negative",
  "Slightly Negative",
  "Neutral",
  "Slightly Positive",
  "Positive",
  "Very Positive",
];

const RESOLUTION_STATUS_OPTIONS = [
  "Resolved",
  "Unresolved",
  "Pending",
  "Unclear",
];

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

function shiftDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return normalizeToStartOfDay(next);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getPresetRange(key) {
  const today = normalizeToStartOfDay(new Date());

  switch (key) {
    case "today":
      return { startDate: formatDateInput(today), endDate: formatDateInput(today) };
    case "yesterday": {
      const yesterday = shiftDays(today, -1);
      return {
        startDate: formatDateInput(yesterday),
        endDate: formatDateInput(yesterday),
      };
    }
    case "past_7_days":
      return {
        startDate: formatDateInput(shiftDays(today, -6)),
        endDate: formatDateInput(today),
      };
    case "past_30_days":
      return {
        startDate: formatDateInput(shiftDays(today, -29)),
        endDate: formatDateInput(today),
      };
    case "this_month":
      return {
        startDate: formatDateInput(startOfMonth(today)),
        endDate: formatDateInput(today),
      };
    case "past_90_days":
      return {
        startDate: formatDateInput(shiftDays(today, -89)),
        endDate: formatDateInput(today),
      };
    default:
      return null;
  }
}

function safeText(value, fallback = "-") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatShortDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function buildFallbackProfile(user) {
  const email = String(user?.email || "").toLowerCase();

  if (email === "faiyaz@nextventures.io") {
    return {
      id: user.id,
      email,
      full_name: user.user_metadata?.full_name || "Faiyaz Muhtasim Ahmed",
      role: "master_admin",
      can_run_tests: true,
      is_active: true,
    };
  }

  return null;
}

function canManageResults(profile) {
  return Boolean(
    profile?.is_active === true &&
      (profile?.role === "master_admin" ||
        profile?.role === "admin" ||
        profile?.can_run_tests === true)
  );
}

function getResultType(item) {
  if (item?.error) return "error";

  if (safeText(item?.review_sentiment, "") === "Missed Opportunity") {
    return "opportunity_case";
  }

  if (
    safeText(item?.review_sentiment, "") === "Likely Positive Review" ||
    safeText(item?.review_sentiment, "") === "Highly Likely Positive Review"
  ) {
    return "positive_signal";
  }

  if (
    safeText(item?.review_sentiment, "") === "Likely Negative Review" ||
    safeText(item?.review_sentiment, "") === "Highly Likely Negative Review" ||
    safeText(item?.review_sentiment, "") === "Negative Outcome - No Review Request"
  ) {
    return "negative_risk";
  }

  return "success";
}

function matchesResultType(item, value) {
  if (value === "all") return true;
  if (value === "success_only") return !item?.error;
  if (value === "errors_only") return Boolean(item?.error);
  if (value === "opportunity_cases") return getResultType(item) === "opportunity_case";
  if (value === "positive_signals") return getResultType(item) === "positive_signal";
  if (value === "negative_risk") return getResultType(item) === "negative_risk";
  return true;
}

function downloadCsv(filename, rows) {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? "");
          return `"${value.replace(/"/g, '""')}"`;
        })
        .join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function getPillStyle(kind) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "7px 12px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.02em",
    border: "1px solid rgba(255,255,255,0.08)",
    whiteSpace: "nowrap",
  };

  if (kind === "resolved" || kind === "positive_signal") {
    return {
      ...base,
      background: "rgba(16,185,129,0.12)",
      border: "1px solid rgba(52,211,153,0.18)",
      color: "#d1fae5",
      boxShadow: "0 0 0 1px rgba(16,185,129,0.03), 0 0 24px rgba(16,185,129,0.08)",
    };
  }

  if (kind === "opportunity_case" || kind === "pending") {
    return {
      ...base,
      background: "rgba(245,158,11,0.12)",
      border: "1px solid rgba(251,191,36,0.18)",
      color: "#fef3c7",
      boxShadow: "0 0 0 1px rgba(245,158,11,0.03), 0 0 24px rgba(245,158,11,0.08)",
    };
  }

  if (kind === "negative_risk" || kind === "unresolved" || kind === "error") {
    return {
      ...base,
      background: "rgba(244,63,94,0.12)",
      border: "1px solid rgba(251,113,133,0.18)",
      color: "#ffe4e6",
      boxShadow: "0 0 0 1px rgba(244,63,94,0.03), 0 0 24px rgba(244,63,94,0.08)",
    };
  }

  return {
    ...base,
    background: "rgba(59,130,246,0.12)",
    border: "1px solid rgba(96,165,250,0.18)",
    color: "#dbeafe",
    boxShadow: "0 0 0 1px rgba(59,130,246,0.03), 0 0 24px rgba(59,130,246,0.08)",
  };
}

function PresetCalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M8 2V5" stroke="#DCE7FF" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 2V5" stroke="#DCE7FF" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M3.5 9H20.5" stroke="#7FA2FF" strokeWidth="1.8" strokeLinecap="round" />
      <rect
        x="3.5"
        y="4.5"
        width="17"
        height="16"
        rx="3"
        stroke="url(#resultsCalendarGradient)"
        strokeWidth="1.5"
      />
      <defs>
        <linearGradient id="resultsCalendarGradient" x1="3.5" y1="4.5" x2="20.5" y2="20.5">
          <stop stopColor="#60A5FA" />
          <stop offset="0.5" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#EC4899" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default function ResultsPage() {
  const initialRange = getPresetRange("past_7_days");

  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMessage, setAuthMessage] = useState("");

  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [pageSuccess, setPageSuccess] = useState("");

  const [runs, setRuns] = useState([]);
  const [results, setResults] = useState([]);

  const [selectedDatePreset, setSelectedDatePreset] = useState("past_7_days");
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const [startDate, setStartDate] = useState(initialRange.startDate);
  const [endDate, setEndDate] = useState(initialRange.endDate);

  const [searchText, setSearchText] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [reviewSentimentFilter, setReviewSentimentFilter] = useState("all");
  const [clientSentimentFilter, setClientSentimentFilter] = useState("all");
  const [resolutionStatusFilter, setResolutionStatusFilter] = useState("all");
  const [resultTypeFilter, setResultTypeFilter] = useState("all");

  const [selectedIds, setSelectedIds] = useState([]);
  const [deleting, setDeleting] = useState(false);
  const [expandedRows, setExpandedRows] = useState({});
  const [showAllRows, setShowAllRows] = useState(false);

  const presetMenuRef = useRef(null);

  async function loadProfile(user) {
    const email = user?.email?.toLowerCase() || "";
    const domain = email.split("@")[1] || "";

    if (!user) {
      return { profile: null, message: "" };
    }

    if (domain !== "nextventures.io") {
      await supabase.auth.signOut();
      return {
        profile: null,
        message: "Access blocked. Only nextventures.io Google accounts are allowed.",
      };
    }

    const fallbackProfile = buildFallbackProfile(user);

    try {
      const { data } = await supabase
        .from("profiles")
        .select("id, email, full_name, role, can_run_tests, is_active")
        .eq("id", user.id)
        .maybeSingle();

      if (data) {
        return { profile: data, message: "" };
      }

      if (fallbackProfile) {
        return { profile: fallbackProfile, message: "" };
      }

      return {
        profile: null,
        message: "Signed in, but no profile record is available yet.",
      };
    } catch (_error) {
      if (fallbackProfile) {
        return { profile: fallbackProfile, message: "" };
      }

      return {
        profile: null,
        message: "Signed in, but profile loading failed.",
      };
    }
  }

  async function loadStoredResults(activeSession = session) {
    setLoading(true);
    setPageError("");
    setPageSuccess("");

    try {
      if (!activeSession?.access_token) {
        setRuns([]);
        setResults([]);
        setSelectedIds([]);
        setLoading(false);
        return;
      }

      const response = await fetch("/api/results", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeSession.access_token}`,
        },
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Could not load stored results.");
      }

      setRuns(Array.isArray(data?.runs) ? data.runs : []);
      setResults(Array.isArray(data?.results) ? data.results : []);
      setSelectedIds([]);
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Could not load stored results."
      );
      setRuns([]);
      setResults([]);
      setSelectedIds([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function init() {
      try {
        const {
          data: { session: currentSession },
        } = await supabase.auth.getSession();

        if (!active) return;

        setSession(currentSession ?? null);

        if (!currentSession?.user) {
          setProfile(null);
          setAuthLoading(false);
          setLoading(false);
          return;
        }

        const profileResult = await loadProfile(currentSession.user);

        if (!active) return;

        setProfile(profileResult.profile);
        setAuthMessage(profileResult.message);
        setAuthLoading(false);

        await loadStoredResults(currentSession);
      } catch (_error) {
        if (!active) return;
        setAuthMessage("Could not complete session check.");
        setAuthLoading(false);
        setLoading(false);
      }
    }

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!active) return;

      setSession(newSession ?? null);

      if (!newSession?.user) {
        setProfile(null);
        setAuthMessage("");
        setAuthLoading(false);
        setRuns([]);
        setResults([]);
        setLoading(false);
        return;
      }

      const profileResult = await loadProfile(newSession.user);
      if (!active) return;

      setProfile(profileResult.profile);
      setAuthMessage(profileResult.message);
      setAuthLoading(false);

      await loadStoredResults(newSession);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (!presetMenuRef.current) return;
      if (!presetMenuRef.current.contains(event.target)) {
        setShowPresetMenu(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function applyDatePreset(presetKey) {
    setSelectedDatePreset(presetKey);

    if (presetKey === "custom") {
      setShowPresetMenu(false);
      return;
    }

    const range = getPresetRange(presetKey);
    if (!range) {
      setShowPresetMenu(false);
      return;
    }

    setStartDate(range.startDate);
    setEndDate(range.endDate);
    setShowPresetMenu(false);
  }

  async function handleGoogleLogin() {
    setAuthMessage("");
    const redirectTo =
      typeof window !== "undefined" ? `${window.location.origin}/results` : undefined;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) {
      setAuthMessage(error.message || "Google sign-in failed.");
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setAuthMessage("");
    setAuthLoading(false);
    setRuns([]);
    setResults([]);
  }

  const runsById = useMemo(() => {
    const map = new Map();

    for (const run of runs) {
      if (run?.id) {
        map.set(run.id, run);
      }
    }

    return map;
  }, [runs]);

  const decoratedResults = useMemo(() => {
    return results.map((item) => ({
      ...item,
      runMeta: item?.run_id ? runsById.get(item.run_id) || null : null,
    }));
  }, [results, runsById]);

  const agentOptions = useMemo(() => {
    return Array.from(
      new Set(
        decoratedResults
          .map((item) => safeText(item.agent_name, "Unassigned"))
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [decoratedResults]);

  const filteredResults = useMemo(() => {
    return decoratedResults.filter((item) => {
      const sourceDate = item?.replied_at || item?.created_at || null;
      const sourceDateOnly = sourceDate ? formatDateInput(new Date(sourceDate)) : "";

      if (startDate && sourceDateOnly && sourceDateOnly < startDate) return false;
      if (endDate && sourceDateOnly && sourceDateOnly > endDate) return false;

      if (agentFilter !== "all" && safeText(item.agent_name, "Unassigned") !== agentFilter) {
        return false;
      }

      if (
        reviewSentimentFilter !== "all" &&
        safeText(item.review_sentiment, "") !== reviewSentimentFilter
      ) {
        return false;
      }

      if (
        clientSentimentFilter !== "all" &&
        safeText(item.client_sentiment, "") !== clientSentimentFilter
      ) {
        return false;
      }

      if (
        resolutionStatusFilter !== "all" &&
        safeText(item.resolution_status, "") !== resolutionStatusFilter
      ) {
        return false;
      }

      if (!matchesResultType(item, resultTypeFilter)) {
        return false;
      }

      const haystack = [
        item?.conversation_id,
        item?.agent_name,
        item?.client_email,
        item?.review_sentiment,
        item?.client_sentiment,
        item?.resolution_status,
        item?.ai_verdict,
        item?.error,
        item?.runMeta?.requested_by_email,
      ]
        .map((value) => String(value ?? "").toLowerCase())
        .join(" ");

      if (searchText.trim() && !haystack.includes(searchText.trim().toLowerCase())) {
        return false;
      }

      return true;
    });
  }, [
    decoratedResults,
    startDate,
    endDate,
    agentFilter,
    reviewSentimentFilter,
    clientSentimentFilter,
    resolutionStatusFilter,
    resultTypeFilter,
    searchText,
  ]);

  const visibleResults = showAllRows ? filteredResults : filteredResults.slice(0, 20);
  const allVisibleIds = visibleResults.map((item) => item.id).filter(Boolean);
  const allFilteredIds = filteredResults.map((item) => item.id).filter(Boolean);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const totalStoredRuns = useMemo(() => {
    return new Set(filteredResults.map((item) => item.run_id).filter(Boolean)).size;
  }, [filteredResults]);

  const totalErrors = filteredResults.filter((item) => item?.error).length;
  const totalSuccess = filteredResults.length - totalErrors;

  const positiveResolutionRate = useMemo(() => {
    if (!filteredResults.length) return 0;
    const positiveCount = filteredResults.filter(
      (item) => safeText(item.resolution_status, "") === "Resolved"
    ).length;
    return (positiveCount / filteredResults.length) * 100;
  }, [filteredResults]);

  const totalMissedOpportunities = useMemo(() => {
    return filteredResults.filter(
      (item) => safeText(item.review_sentiment, "") === "Missed Opportunity"
    ).length;
  }, [filteredResults]);

  const latestStoredAt = useMemo(() => {
    const latest = decoratedResults[0]?.created_at || decoratedResults[0]?.replied_at;
    return latest ? formatDateTime(latest) : "No stored results yet";
  }, [decoratedResults]);

  function toggleSingle(id) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  function selectAllVisible() {
    setSelectedIds((prev) => Array.from(new Set([...prev, ...allVisibleIds])));
  }

  function selectAllFiltered() {
    setSelectedIds(Array.from(new Set(allFilteredIds)));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  function toggleRowExpanded(id) {
    setExpandedRows((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }

  async function handleDeleteSelected() {
    if (!selectedIds.length) {
      setPageError("Please select at least one stored result first.");
      setPageSuccess("");
      return;
    }

    if (!canManageResults(profile)) {
      setPageError("This account does not have permission to delete stored results.");
      setPageSuccess("");
      return;
    }

    const confirmed = window.confirm(
      `Delete ${selectedIds.length} selected stored result(s)? This cannot be undone.`
    );

    if (!confirmed) return;

    setDeleting(true);
    setPageError("");
    setPageSuccess("");

    try {
      const targetRunIds = decoratedResults
        .filter((item) => selectedIdSet.has(item.id))
        .map((item) => item.run_id)
        .filter(Boolean);

      const { error: deleteResultsError } = await supabase
        .from("audit_results")
        .delete()
        .in("id", selectedIds);

      if (deleteResultsError) {
        throw new Error(deleteResultsError.message || "Could not delete selected results.");
      }

      if (targetRunIds.length) {
        const uniqueRunIds = Array.from(new Set(targetRunIds));

        const { data: remainingRows, error: remainingError } = await supabase
          .from("audit_results")
          .select("run_id")
          .in("run_id", uniqueRunIds);

        if (remainingError) {
          throw new Error(remainingError.message || "Could not verify remaining run records.");
        }

        const remainingRunSet = new Set(
          (remainingRows || []).map((item) => item.run_id).filter(Boolean)
        );

        const emptyRunIds = uniqueRunIds.filter((id) => !remainingRunSet.has(id));

        if (emptyRunIds.length) {
          const { error: deleteRunsError } = await supabase
            .from("audit_runs")
            .delete()
            .in("id", emptyRunIds);

          if (deleteRunsError) {
            throw new Error(deleteRunsError.message || "Could not clean up empty runs.");
          }
        }
      }

      setSelectedIds([]);
      setPageSuccess(`${selectedIds.length} stored result(s) deleted successfully.`);
      await loadStoredResults();
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Could not delete selected results."
      );
    } finally {
      setDeleting(false);
    }
  }

  function handleExportFiltered() {
    if (!filteredResults.length) {
      setPageError("There are no filtered results to export.");
      setPageSuccess("");
      return;
    }

    const rows = [
      [
        "Result ID",
        "Run ID",
        "Conversation ID",
        "Replied At",
        "Agent Name",
        "Client Email",
        "CSAT Score",
        "Review Sentiment",
        "Client Sentiment",
        "Resolution Status",
        "AI Verdict",
        "Error",
        "Requested By",
        "Run Created At",
      ],
      ...filteredResults.map((item) => [
        item.id,
        item.run_id,
        item.conversation_id,
        item.replied_at || item.created_at || "",
        item.agent_name || "",
        item.client_email || "",
        item.csat_score || "",
        item.review_sentiment || "",
        item.client_sentiment || "",
        item.resolution_status || "",
        item.ai_verdict || "",
        item.error || "",
        item.runMeta?.requested_by_email || "",
        item.runMeta?.created_at || "",
      ]),
    ];

    downloadCsv(
      `stored-results-${startDate || "start"}-to-${endDate || "end"}.csv`,
      rows
    );

    setPageSuccess("Filtered results exported successfully.");
    setPageError("");
  }

  const stats = [
    {
      label: "Stored Results",
      value: filteredResults.length.toLocaleString(),
      helper: "Live stored audit rows in the current filtered view",
    },
    {
      label: "Stored Runs",
      value: totalStoredRuns.toLocaleString(),
      helper: "Unique saved audit batches in the filtered range",
    },
    {
      label: "Missed Opportunities",
      value: totalMissedOpportunities.toLocaleString(),
      helper: "Review opportunities that were not used",
    },
    {
      label: "Positive Resolution Rate",
      value: `${positiveResolutionRate.toFixed(1)}%`,
      helper: "Resolved conversations in the current filtered range",
    },
  ];

  const pageStyle = {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top left, rgba(59,130,246,0.16), transparent 20%), radial-gradient(circle at top right, rgba(168,85,247,0.14), transparent 22%), radial-gradient(circle at bottom center, rgba(236,72,153,0.08), transparent 20%), linear-gradient(180deg, #040714 0%, #060b1d 45%, #04060d 100%)",
    color: "#f5f7ff",
    padding: "32px 20px 60px",
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  };

  const shellStyle = {
    width: "min(1520px, 100%)",
    margin: "0 auto",
  };

  const panelStyle = {
    border: "1px solid rgba(255,255,255,0.08)",
    background: "linear-gradient(180deg, rgba(15,22,43,0.88), rgba(7,10,24,0.96))",
    borderRadius: "28px",
    padding: "28px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)",
  };

  const subPanelStyle = {
    borderRadius: "20px",
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: "18px",
  };

  const labelStyle = {
    display: "block",
    fontSize: "12px",
    color: "#8ea0d6",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    marginBottom: "8px",
    fontWeight: 600,
  };

  const inputStyle = {
    width: "100%",
    height: "52px",
    borderRadius: "14px",
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(5,8,18,0.92)",
    color: "#e7ecff",
    padding: "0 16px",
    fontSize: "15px",
    outline: "none",
    boxSizing: "border-box",
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
    colorScheme: "dark",
  };

  const actionButtonStyle = {
    height: "42px",
    borderRadius: "14px",
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.04)",
    color: "#f5f7ff",
    padding: "0 14px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
  };

  const primaryActionStyle = {
    ...actionButtonStyle,
    border: "1px solid rgba(168,85,247,0.22)",
    background:
      "linear-gradient(135deg, rgba(59,130,246,0.92), rgba(139,92,246,0.96), rgba(236,72,153,0.92))",
    boxShadow: "0 14px 40px rgba(139,92,246,0.24)",
  };

  const tableHeadCellStyle = {
    padding: "16px 14px",
    textAlign: "left",
    fontSize: "12px",
    color: "#8ea0d6",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    fontWeight: 700,
    position: "sticky",
    top: 0,
    background: "rgba(10,18,34,0.96)",
    backdropFilter: "blur(18px)",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    zIndex: 2,
    whiteSpace: "nowrap",
  };

  const tableCellStyle = {
    padding: "16px 14px",
    verticalAlign: "top",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    fontSize: "14px",
    color: "#dbe7ff",
  };

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <section style={{ ...panelStyle, marginBottom: "24px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.15fr) minmax(320px, 0.85fr)",
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
                  fontWeight: 700,
                  marginBottom: "18px",
                }}
              >
                Premium Results Archive
              </div>

              <h1
                style={{
                  fontSize: "52px",
                  lineHeight: 1.02,
                  letterSpacing: "-0.05em",
                  margin: "0 0 16px",
                  maxWidth: "900px",
                }}
              >
                Stored audit results with a clean premium archive layout.
              </h1>

              <p
                style={{
                  margin: "0 0 22px",
                  color: "#a9b4d0",
                  fontSize: "17px",
                  lineHeight: 1.75,
                  maxWidth: "900px",
                }}
              >
                This page is now focused on real stored results only. The table is the main product
                here. Dashboard will later handle the visual analytics and world-class charts.
              </p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", marginBottom: "12px" }}>
                <Link
                  href="/run"
                  style={{
                    ...primaryActionStyle,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textDecoration: "none",
                  }}
                >
                  Run New Audit
                </Link>

                <button type="button" onClick={handleExportFiltered} style={actionButtonStyle}>
                  Export Filtered CSV
                </button>

                <button type="button" onClick={() => loadStoredResults()} style={actionButtonStyle}>
                  Reload Results
                </button>

                {!session?.user ? (
                  <button type="button" onClick={handleGoogleLogin} style={actionButtonStyle}>
                    Sign in with Google
                  </button>
                ) : (
                  <button type="button" onClick={handleLogout} style={actionButtonStyle}>
                    Sign out
                  </button>
                )}
              </div>
            </div>

            <div style={subPanelStyle}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  marginBottom: "16px",
                }}
              >
                <div>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#f5f7ff" }}>
                    Archive status
                  </div>
                  <div style={{ marginTop: "6px", fontSize: "13px", color: "#a9b4d0" }}>
                    Latest stored result: {latestStoredAt}
                  </div>
                </div>

                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "8px 12px",
                    borderRadius: "999px",
                    background: "rgba(34,211,238,0.12)",
                    border: "1px solid rgba(34,211,238,0.18)",
                    color: "#cffafe",
                    fontSize: "11px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                  }}
                >
                  Real Supabase Data
                </div>
              </div>

              <div ref={presetMenuRef} style={{ position: "relative", marginBottom: "14px" }}>
                <label style={labelStyle}>Quick Range</label>
                <button
                  type="button"
                  onClick={() => setShowPresetMenu((prev) => !prev)}
                  style={{
                    ...inputStyle,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                    paddingRight: "14px",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
                    <PresetCalendarIcon />
                    <span style={{ fontWeight: 600, color: "#f5f7ff" }}>
                      {DATE_PRESET_OPTIONS.find((item) => item.key === selectedDatePreset)?.label ||
                        "Custom"}
                    </span>
                    <span style={{ fontSize: "12px", color: "#8ea0d6" }}>
                      {startDate} - {endDate}
                    </span>
                  </span>
                  <span style={{ color: "#8ea0d6" }}>{showPresetMenu ? "▲" : "▼"}</span>
                </button>

                {showPresetMenu ? (
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: "calc(100% + 8px)",
                      borderRadius: "18px",
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(7,10,24,0.98)",
                      boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
                      overflow: "hidden",
                      zIndex: 10,
                    }}
                  >
                    {DATE_PRESET_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => applyDatePreset(option.key)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "12px 16px",
                          background:
                            selectedDatePreset === option.key
                              ? "rgba(139,92,246,0.14)"
                              : "transparent",
                          color: selectedDatePreset === option.key ? "#f5f3ff" : "#dbe7ff",
                          border: "none",
                          borderBottom: "1px solid rgba(255,255,255,0.04)",
                          cursor: "pointer",
                          fontSize: "14px",
                          fontWeight: 600,
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={labelStyle}>Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setSelectedDatePreset("custom");
                      setStartDate(e.target.value);
                    }}
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={labelStyle}>End Date</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      setSelectedDatePreset("custom");
                      setEndDate(e.target.value);
                    }}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div
                style={{
                  marginTop: "14px",
                  fontSize: "14px",
                  lineHeight: 1.65,
                  color: "#a9b4d0",
                }}
              >
                Results = storage, filtering, export, selection, expansion, and delete.
              </div>
            </div>
          </div>
        </section>

        {(authMessage || pageError || pageSuccess) ? (
          <section style={{ marginBottom: "24px", display: "grid", gap: "10px" }}>
            {authMessage ? (
              <div
                style={{
                  borderRadius: "16px",
                  border: "1px solid rgba(251,113,133,0.18)",
                  background: "rgba(244,63,94,0.10)",
                  color: "#ffe4e6",
                  padding: "14px 16px",
                  fontSize: "14px",
                }}
              >
                {authMessage}
              </div>
            ) : null}

            {pageError ? (
              <div
                style={{
                  borderRadius: "16px",
                  border: "1px solid rgba(251,113,133,0.18)",
                  background: "rgba(244,63,94,0.10)",
                  color: "#ffe4e6",
                  padding: "14px 16px",
                  fontSize: "14px",
                }}
              >
                {pageError}
              </div>
            ) : null}

            {pageSuccess ? (
              <div
                style={{
                  borderRadius: "16px",
                  border: "1px solid rgba(52,211,153,0.18)",
                  background: "rgba(16,185,129,0.10)",
                  color: "#d1fae5",
                  padding: "14px 16px",
                  fontSize: "14px",
                }}
              >
                {pageSuccess}
              </div>
            ) : null}
          </section>
        ) : null}

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              style={{
                ...subPanelStyle,
                background:
                  index === 0
                    ? "linear-gradient(180deg, rgba(99,102,241,0.14), rgba(255,255,255,0.03))"
                    : index === 1
                    ? "linear-gradient(180deg, rgba(34,211,238,0.12), rgba(255,255,255,0.03))"
                    : index === 2
                    ? "linear-gradient(180deg, rgba(245,158,11,0.12), rgba(255,255,255,0.03))"
                    : "linear-gradient(180deg, rgba(16,185,129,0.12), rgba(255,255,255,0.03))",
              }}
            >
              <div
                style={{
                  display: "inline-flex",
                  padding: "7px 11px",
                  borderRadius: "999px",
                  marginBottom: "14px",
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color:
                    index === 0
                      ? "#ddd6fe"
                      : index === 1
                      ? "#cffafe"
                      : index === 2
                      ? "#fde68a"
                      : "#d1fae5",
                  border:
                    index === 0
                      ? "1px solid rgba(196,181,253,0.18)"
                      : index === 1
                      ? "1px solid rgba(103,232,249,0.18)"
                      : index === 2
                      ? "1px solid rgba(253,224,71,0.18)"
                      : "1px solid rgba(110,231,183,0.18)",
                }}
              >
                Stored
              </div>

              <div style={{ color: "#8ea0d6", fontSize: "13px", marginBottom: "10px" }}>
                {stat.label}
              </div>
              <div
                style={{
                  fontSize: "34px",
                  fontWeight: 800,
                  letterSpacing: "-0.04em",
                  color: "#f5f7ff",
                  marginBottom: "8px",
                }}
              >
                {stat.value}
              </div>
              <div style={{ color: "#a9b4d0", fontSize: "13px", lineHeight: 1.6 }}>
                {stat.helper}
              </div>
            </div>
          ))}
        </section>

        <section style={{ ...panelStyle, marginBottom: "24px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 1fr 1fr",
              gap: "14px",
              marginBottom: "18px",
            }}
          >
            <div>
              <label style={labelStyle}>Search</label>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Conversation ID, agent, client email, verdict, requester"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Agent</label>
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                style={inputStyle}
              >
                <option value="all">All Agents</option>
                {agentOptions.map((agent) => (
                  <option key={agent} value={agent}>
                    {agent}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Result Type</label>
              <select
                value={resultTypeFilter}
                onChange={(e) => setResultTypeFilter(e.target.value)}
                style={inputStyle}
              >
                {RESULT_TYPE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "14px",
              marginBottom: "20px",
            }}
          >
            <div>
              <label style={labelStyle}>Review Sentiment</label>
              <select
                value={reviewSentimentFilter}
                onChange={(e) => setReviewSentimentFilter(e.target.value)}
                style={inputStyle}
              >
                <option value="all">All Review Sentiments</option>
                {REVIEW_SENTIMENT_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Client Sentiment</label>
              <select
                value={clientSentimentFilter}
                onChange={(e) => setClientSentimentFilter(e.target.value)}
                style={inputStyle}
              >
                <option value="all">All Client Sentiments</option>
                {CLIENT_SENTIMENT_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Resolution Status</label>
              <select
                value={resolutionStatusFilter}
                onChange={(e) => setResolutionStatusFilter(e.target.value)}
                style={inputStyle}
              >
                <option value="all">All Resolution Statuses</option>
                {RESOLUTION_STATUS_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "10px",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
              <button type="button" onClick={selectAllVisible} style={actionButtonStyle}>
                Select Visible
              </button>
              <button type="button" onClick={selectAllFiltered} style={actionButtonStyle}>
                Select All Filtered
              </button>
              <button type="button" onClick={clearSelection} style={actionButtonStyle}>
                Clear Selection
              </button>
              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={!selectedIds.length || deleting}
                style={{
                  ...actionButtonStyle,
                  opacity: !selectedIds.length || deleting ? 0.55 : 1,
                  cursor: !selectedIds.length || deleting ? "not-allowed" : "pointer",
                  border: "1px solid rgba(251,113,133,0.18)",
                  background: "rgba(244,63,94,0.10)",
                  color: "#ffe4e6",
                }}
              >
                {deleting ? "Deleting..." : `Delete Selected (${selectedIds.length})`}
              </button>
            </div>

            <div
              style={{
                color: "#a9b4d0",
                fontSize: "13px",
              }}
            >
              Showing {visibleResults.length} of {filteredResults.length} filtered result(s)
            </div>
          </div>
        </section>

        <section style={panelStyle}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "end",
              justifyContent: "space-between",
              gap: "12px",
              marginBottom: "18px",
            }}
          >
            <div>
              <h2
                style={{
                  margin: 0,
                  fontSize: "28px",
                  letterSpacing: "-0.03em",
                  color: "#f5f7ff",
                }}
              >
                Stored Results Table
              </h2>
              <p
                style={{
                  margin: "8px 0 0",
                  color: "#a9b4d0",
                  fontSize: "14px",
                  lineHeight: 1.7,
                  maxWidth: "880px",
                }}
              >
                Agent names now stand cleanly on their own. Result state, review sentiment,
                client sentiment, and resolution all have separate columns.
              </p>
            </div>

            <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ color: "#8ea0d6", fontSize: "13px" }}>
                Successful: {totalSuccess}
              </div>
              <div style={{ color: "#8ea0d6", fontSize: "13px" }}>•</div>
              <div style={{ color: "#8ea0d6", fontSize: "13px" }}>Errors: {totalErrors}</div>
              <div style={{ color: "#8ea0d6", fontSize: "13px" }}>•</div>
              <div style={{ color: "#8ea0d6", fontSize: "13px" }}>
                Selected: {selectedIds.length}
              </div>
            </div>
          </div>

          {loading || authLoading ? (
            <div
              style={{
                ...subPanelStyle,
                textAlign: "center",
                color: "#a9b4d0",
                fontSize: "15px",
                padding: "42px 20px",
              }}
            >
              Loading stored audit results...
            </div>
          ) : !filteredResults.length ? (
            <div
              style={{
                ...subPanelStyle,
                textAlign: "center",
                color: "#a9b4d0",
                fontSize: "15px",
                padding: "42px 20px",
              }}
            >
              No stored results match the current filters.
            </div>
          ) : (
            <>
              <div
                style={{
                  overflow: "hidden",
                  borderRadius: "22px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(4,8,20,0.72)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
                }}
              >
                <div style={{ maxHeight: "920px", overflow: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      minWidth: "1480px",
                      borderCollapse: "collapse",
                    }}
                  >
                    <thead>
                      <tr>
                        <th style={tableHeadCellStyle}>
                          <input
                            type="checkbox"
                            checked={
                              allVisibleIds.length > 0 &&
                              allVisibleIds.every((id) => selectedIdSet.has(id))
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                selectAllVisible();
                              } else {
                                setSelectedIds((prev) =>
                                  prev.filter((id) => !allVisibleIds.includes(id))
                                );
                              }
                            }}
                          />
                        </th>
                        <th style={tableHeadCellStyle}>Conversation</th>
                        <th style={tableHeadCellStyle}>Agent</th>
                        <th style={tableHeadCellStyle}>Type</th>
                        <th style={tableHeadCellStyle}>Review Sentiment</th>
                        <th style={tableHeadCellStyle}>Client Sentiment</th>
                        <th style={tableHeadCellStyle}>Resolution</th>
                        <th style={tableHeadCellStyle}>Replied At</th>
                        <th style={tableHeadCellStyle}>Requested By</th>
                        <th style={tableHeadCellStyle}>Details</th>
                      </tr>
                    </thead>

                    <tbody>
                      {visibleResults.map((item, index) => {
                        const resultType = getResultType(item);
                        const resolution = safeText(item.resolution_status, "");
                        const rowBackground =
                          index % 2 === 0 ? "rgba(255,255,255,0.018)" : "transparent";
                        const isExpanded = Boolean(expandedRows[item.id]);

                        return (
                          <>
                            <tr key={item.id} style={{ background: rowBackground }}>
                              <td style={tableCellStyle}>
                                <input
                                  type="checkbox"
                                  checked={selectedIdSet.has(item.id)}
                                  onChange={() => toggleSingle(item.id)}
                                />
                              </td>

                              <td style={tableCellStyle}>
                                <div style={{ color: "#f5f7ff", fontWeight: 700, marginBottom: "6px" }}>
                                  {safeText(item.conversation_id, "Unknown Conversation")}
                                </div>
                                <div style={{ color: "#a9b4d0", fontSize: "12px", marginBottom: "4px" }}>
                                  Client: {safeText(item.client_email)}
                                </div>
                                <div style={{ color: "#7f8db3", fontSize: "12px" }}>
                                  CSAT: {safeText(item.csat_score)}
                                </div>
                              </td>

                              <td style={tableCellStyle}>
                                <div style={{ color: "#f5f7ff", fontWeight: 600 }}>
                                  {safeText(item.agent_name, "Unassigned")}
                                </div>
                              </td>

                              <td style={tableCellStyle}>
                                <span
                                  style={
                                    resultType === "error"
                                      ? getPillStyle("error")
                                      : resultType === "opportunity_case"
                                      ? getPillStyle("opportunity_case")
                                      : resultType === "positive_signal"
                                      ? getPillStyle("positive_signal")
                                      : resultType === "negative_risk"
                                      ? getPillStyle("negative_risk")
                                      : getPillStyle("pending")
                                  }
                                >
                                  {resultType === "error"
                                    ? "Error"
                                    : resultType === "opportunity_case"
                                    ? "Opportunity"
                                    : resultType === "positive_signal"
                                    ? "Positive"
                                    : resultType === "negative_risk"
                                    ? "Risk"
                                    : "Stored"}
                                </span>
                              </td>

                              <td style={tableCellStyle}>
                                <span
                                  style={
                                    safeText(item.review_sentiment, "") === "Missed Opportunity"
                                      ? getPillStyle("opportunity_case")
                                      : safeText(item.review_sentiment, "") ===
                                          "Likely Positive Review" ||
                                        safeText(item.review_sentiment, "") ===
                                          "Highly Likely Positive Review"
                                      ? getPillStyle("positive_signal")
                                      : safeText(item.review_sentiment, "") ===
                                          "Likely Negative Review" ||
                                        safeText(item.review_sentiment, "") ===
                                          "Highly Likely Negative Review" ||
                                        safeText(item.review_sentiment, "") ===
                                          "Negative Outcome - No Review Request"
                                      ? getPillStyle("negative_risk")
                                      : getPillStyle("pending")
                                  }
                                >
                                  {safeText(item.review_sentiment)}
                                </span>
                              </td>

                              <td style={tableCellStyle}>
                                <div style={{ color: "#dbe7ff", fontWeight: 600 }}>
                                  {safeText(item.client_sentiment)}
                                </div>
                              </td>

                              <td style={tableCellStyle}>
                                <span
                                  style={
                                    resolution === "Resolved"
                                      ? getPillStyle("resolved")
                                      : resolution === "Pending"
                                      ? getPillStyle("pending")
                                      : resolution === "Unresolved"
                                      ? getPillStyle("unresolved")
                                      : getPillStyle("pending")
                                  }
                                >
                                  {safeText(item.resolution_status)}
                                </span>
                              </td>

                              <td style={tableCellStyle}>
                                <div style={{ color: "#f5f7ff", fontWeight: 600, marginBottom: "4px" }}>
                                  {formatDateTime(item.replied_at || item.created_at)}
                                </div>
                                <div style={{ color: "#7f8db3", fontSize: "12px" }}>
                                  {formatShortDate(item.replied_at || item.created_at)}
                                </div>
                              </td>

                              <td style={tableCellStyle}>
                                <div style={{ color: "#f5f7ff", fontWeight: 600, marginBottom: "4px" }}>
                                  {safeText(item.runMeta?.requested_by_email)}
                                </div>
                                <div style={{ color: "#7f8db3", fontSize: "12px", marginBottom: "2px" }}>
                                  {safeText(item.runMeta?.audit_mode, "live_gpt")}
                                </div>
                                <div style={{ color: "#7f8db3", fontSize: "12px" }}>
                                  {formatShortDate(item.runMeta?.created_at)}
                                </div>
                              </td>

                              <td style={tableCellStyle}>
                                <button
                                  type="button"
                                  onClick={() => toggleRowExpanded(item.id)}
                                  style={{
                                    ...actionButtonStyle,
                                    height: "38px",
                                    fontSize: "13px",
                                  }}
                                >
                                  {isExpanded ? "Hide" : "View"}
                                </button>
                              </td>
                            </tr>

                            {isExpanded ? (
                              <tr key={`${item.id}-expanded`} style={{ background: "rgba(255,255,255,0.02)" }}>
                                <td colSpan={10} style={{ ...tableCellStyle, paddingTop: "0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                                  <div
                                    style={{
                                      margin: "0 0 8px",
                                      borderRadius: "18px",
                                      border: item.error
                                        ? "1px solid rgba(251,113,133,0.18)"
                                        : "1px solid rgba(255,255,255,0.08)",
                                      background: item.error
                                        ? "rgba(244,63,94,0.08)"
                                        : "rgba(255,255,255,0.03)",
                                      padding: "18px",
                                    }}
                                  >
                                    <div
                                      style={{
                                        fontSize: "12px",
                                        color: "#8ea0d6",
                                        textTransform: "uppercase",
                                        letterSpacing: "0.12em",
                                        marginBottom: "10px",
                                        fontWeight: 700,
                                      }}
                                    >
                                      {item.error ? "Error Details" : "Full Verdict"}
                                    </div>

                                    <div
                                      style={{
                                        color: item.error ? "#ffe4e6" : "#dbe7ff",
                                        fontSize: "14px",
                                        lineHeight: 1.8,
                                        whiteSpace: "pre-wrap",
                                      }}
                                    >
                                      {safeText(item.error || item.ai_verdict)}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {filteredResults.length > 20 ? (
                <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => setShowAllRows((prev) => !prev)}
                    style={actionButtonStyle}
                  >
                    {showAllRows
                      ? "Show Less"
                      : `Show More (${filteredResults.length - visibleResults.length} more)`}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
