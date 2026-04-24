"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

const INTERCOM_CONVERSATION_URL_PREFIX =
  "https://app.intercom.com/a/inbox/aphmhtyj/inbox/conversation";

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

const RESOLUTION_STATUS_OPTIONS = ["Resolved", "Unresolved", "Pending", "Unclear"];

const MAPPING_STATUS_OPTIONS = [
  { value: "all", label: "All Mapping" },
  { value: "mapped", label: "Mapped" },
  { value: "unmapped", label: "Unmapped" },
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
      return { startDate: formatDateInput(yesterday), endDate: formatDateInput(yesterday) };
    }
    case "past_7_days":
      return { startDate: formatDateInput(shiftDays(today, -6)), endDate: formatDateInput(today) };
    case "past_30_days":
      return { startDate: formatDateInput(shiftDays(today, -29)), endDate: formatDateInput(today) };
    case "this_month":
      return { startDate: formatDateInput(startOfMonth(today)), endDate: formatDateInput(today) };
    case "past_90_days":
      return { startDate: formatDateInput(shiftDays(today, -89)), endDate: formatDateInput(today) };
    default:
      return null;
  }
}

function safeText(value, fallback = "-") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function toValidDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateInputFromValue(value) {
  const date = toValidDate(value);
  return date ? formatDateInput(date) : "";
}

function formatDateTime(value) {
  const date = toValidDate(value);
  if (!date) return value ? String(value) : "-";

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatShortDate(value) {
  const date = toValidDate(value);
  if (!date) return value ? String(value) : "-";

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
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

  const reviewSentiment = safeText(item?.review_sentiment, "");

  if (reviewSentiment === "Missed Opportunity") return "opportunity_case";

  if (
    reviewSentiment === "Likely Positive Review" ||
    reviewSentiment === "Highly Likely Positive Review"
  ) {
    return "positive_signal";
  }

  if (
    reviewSentiment === "Likely Negative Review" ||
    reviewSentiment === "Highly Likely Negative Review" ||
    reviewSentiment === "Negative Outcome - No Review Request"
  ) {
    return "negative_risk";
  }

  return "success";
}

function getResultTypeLabel(type) {
  if (type === "error") return "Error";
  if (type === "opportunity_case") return "Opportunity";
  if (type === "positive_signal") return "Positive";
  if (type === "negative_risk") return "Risk";
  return "Stored";
}

function getResultTypeTone(type) {
  if (type === "error") return "danger";
  if (type === "opportunity_case") return "warning";
  if (type === "positive_signal") return "success";
  if (type === "negative_risk") return "danger";
  return "neutral";
}

function getReviewTone(value) {
  const text = safeText(value, "");
  if (text.includes("Positive")) return "success";
  if (text === "Missed Opportunity") return "warning";
  if (text.includes("Negative")) return "danger";
  return "neutral";
}

function getResolutionTone(value) {
  const text = safeText(value, "");
  if (text === "Resolved") return "success";
  if (text === "Pending") return "warning";
  if (text === "Unresolved") return "danger";
  return "neutral";
}

function getClientTone(value) {
  const text = safeText(value, "");
  if (text.includes("Positive")) return "success";
  if (text.includes("Negative")) return "danger";
  if (text === "Neutral") return "neutral";
  return "notice";
}

function getMappingStatus(item) {
  const status = safeText(item?.employee_match_status, "").toLowerCase();
  if (status === "mapped") return "mapped";
  if (status === "unmapped") return "unmapped";
  if (safeText(item?.employee_name, "") || safeText(item?.employee_email, "")) return "mapped";
  return "unmapped";
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

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 2V5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 2V5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M3.5 9H20.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="3.5" y="4.5" width="17" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" />
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
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [mappingStatusFilter, setMappingStatusFilter] = useState("all");
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

    if (!user) return { profile: null, message: "" };

    if (domain !== "nextventures.io") {
      await supabase.auth.signOut();
      return { profile: null, message: "Access blocked. Use a nextventures.io Google account." };
    }

    const fallbackProfile = buildFallbackProfile(user);

    try {
      const { data } = await supabase
        .from("profiles")
        .select("id, email, full_name, role, can_run_tests, is_active")
        .eq("id", user.id)
        .maybeSingle();

      if (data) return { profile: data, message: "" };
      if (fallbackProfile) return { profile: fallbackProfile, message: "" };

      return { profile: null, message: "Signed in, but no profile record is available." };
    } catch (_error) {
      if (fallbackProfile) return { profile: fallbackProfile, message: "" };
      return { profile: null, message: "Signed in, but profile loading failed." };
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
      setExpandedRows({});
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not load stored results.");
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
      setPageError("");
      setPageSuccess("");

      if (!newSession?.user) {
        setProfile(null);
        setAuthMessage("");
        setAuthLoading(false);
        setRuns([]);
        setResults([]);
        setSelectedIds([]);
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
      if (!presetMenuRef.current.contains(event.target)) setShowPresetMenu(false);
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

  function resetFilters() {
    const range = getPresetRange("past_7_days");
    setSelectedDatePreset("past_7_days");
    setStartDate(range.startDate);
    setEndDate(range.endDate);
    setSearchText("");
    setAgentFilter("all");
    setEmployeeFilter("all");
    setTeamFilter("all");
    setMappingStatusFilter("all");
    setReviewSentimentFilter("all");
    setClientSentimentFilter("all");
    setResolutionStatusFilter("all");
    setResultTypeFilter("all");
    setSelectedIds([]);
    setShowAllRows(false);
  }

  async function handleGoogleLogin() {
    setAuthMessage("");

    const redirectTo =
      typeof window !== "undefined" ? `${window.location.origin}/results` : undefined;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) setAuthMessage(error.message || "Google sign-in failed.");
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setAuthMessage("");
    setAuthLoading(false);
    setRuns([]);
    setResults([]);
    setSelectedIds([]);
  }

  const runsById = useMemo(() => {
    const map = new Map();
    for (const run of runs) {
      if (run?.id) map.set(run.id, run);
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
      new Set(decoratedResults.map((item) => safeText(item.agent_name, "Unassigned")).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
  }, [decoratedResults]);

  const employeeOptions = useMemo(() => {
    return Array.from(
      new Set(
        decoratedResults
          .map((item) => safeText(item.employee_name, getMappingStatus(item) === "mapped" ? "Mapped Employee" : "Unmapped"))
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [decoratedResults]);

  const teamOptions = useMemo(() => {
    return Array.from(
      new Set(decoratedResults.map((item) => safeText(item.team_name, "No Team")).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
  }, [decoratedResults]);

  const filteredResults = useMemo(() => {
    return decoratedResults.filter((item) => {
      const sourceDateOnly = toDateInputFromValue(item?.replied_at || item?.created_at);

      if (startDate && sourceDateOnly && sourceDateOnly < startDate) return false;
      if (endDate && sourceDateOnly && sourceDateOnly > endDate) return false;

      if (agentFilter !== "all" && safeText(item.agent_name, "Unassigned") !== agentFilter) return false;

      const employeeName = safeText(
        item.employee_name,
        getMappingStatus(item) === "mapped" ? "Mapped Employee" : "Unmapped"
      );
      if (employeeFilter !== "all" && employeeName !== employeeFilter) return false;

      if (teamFilter !== "all" && safeText(item.team_name, "No Team") !== teamFilter) return false;

      if (mappingStatusFilter !== "all" && getMappingStatus(item) !== mappingStatusFilter) return false;

      if (reviewSentimentFilter !== "all" && safeText(item.review_sentiment, "") !== reviewSentimentFilter) {
        return false;
      }

      if (clientSentimentFilter !== "all" && safeText(item.client_sentiment, "") !== clientSentimentFilter) {
        return false;
      }

      if (resolutionStatusFilter !== "all" && safeText(item.resolution_status, "") !== resolutionStatusFilter) {
        return false;
      }

      if (!matchesResultType(item, resultTypeFilter)) return false;

      const haystack = [
        item?.conversation_id,
        item?.agent_name,
        item?.employee_name,
        item?.employee_email,
        item?.team_name,
        item?.client_email,
        item?.review_sentiment,
        item?.client_sentiment,
        item?.resolution_status,
        item?.ai_verdict,
        item?.error,
        item?.employee_match_status,
        item?.runMeta?.requested_by_email,
      ]
        .map((value) => String(value ?? "").toLowerCase())
        .join(" ");

      if (searchText.trim() && !haystack.includes(searchText.trim().toLowerCase())) return false;

      return true;
    });
  }, [
    decoratedResults,
    startDate,
    endDate,
    agentFilter,
    employeeFilter,
    teamFilter,
    mappingStatusFilter,
    reviewSentimentFilter,
    clientSentimentFilter,
    resolutionStatusFilter,
    resultTypeFilter,
    searchText,
  ]);

  const visibleResults = showAllRows ? filteredResults : filteredResults.slice(0, 25);
  const allVisibleIds = visibleResults.map((item) => item.id).filter(Boolean);
  const allFilteredIds = filteredResults.map((item) => item.id).filter(Boolean);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const totalStoredRuns = useMemo(() => {
    return new Set(filteredResults.map((item) => item.run_id).filter(Boolean)).size;
  }, [filteredResults]);

  const uniqueConversations = useMemo(() => {
    return new Set(filteredResults.map((item) => item.conversation_id).filter(Boolean)).size;
  }, [filteredResults]);

  const totalErrors = filteredResults.filter((item) => item?.error).length;
  const totalSuccess = filteredResults.length - totalErrors;
  const totalMissedOpportunities = filteredResults.filter(
    (item) => safeText(item.review_sentiment, "") === "Missed Opportunity"
  ).length;
  const totalNegativeRisk = filteredResults.filter((item) => getResultType(item) === "negative_risk").length;
  const mappedRowsCount = filteredResults.filter((item) => getMappingStatus(item) === "mapped").length;

  const resolutionRate = useMemo(() => {
    if (!filteredResults.length) return 0;
    const resolvedCount = filteredResults.filter(
      (item) => safeText(item.resolution_status, "") === "Resolved"
    ).length;
    return (resolvedCount / filteredResults.length) * 100;
  }, [filteredResults]);

  const latestStoredAt = useMemo(() => {
    const latest = decoratedResults[0]?.created_at || decoratedResults[0]?.replied_at;
    return latest ? formatDateTime(latest) : "No stored results";
  }, [decoratedResults]);

  function toggleSingle(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
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
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleDeleteSelected() {
    if (!selectedIds.length) {
      setPageError("Select at least one stored result first.");
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

        const remainingRunSet = new Set((remainingRows || []).map((item) => item.run_id).filter(Boolean));
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
      setPageSuccess(`${selectedIds.length} stored result(s) deleted.`);
      await loadStoredResults();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not delete selected results.");
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
        "Intercom Link",
        "Replied At",
        "Agent Name",
        "Employee Name",
        "Employee Email",
        "Team Name",
        "Mapping Status",
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
        item.conversation_id ? `${INTERCOM_CONVERSATION_URL_PREFIX}/${item.conversation_id}` : "",
        item.replied_at || item.created_at || "",
        item.agent_name || "",
        item.employee_name || "",
        item.employee_email || "",
        item.team_name || "",
        item.employee_match_status || getMappingStatus(item),
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

    downloadCsv(`stored-results-${startDate || "start"}-to-${endDate || "end"}.csv`, rows);
    setPageSuccess("Filtered results exported.");
    setPageError("");
  }

  const stats = [
    { label: "Stored Results", value: formatNumber(filteredResults.length), tone: "violet" },
    { label: "Conversations", value: formatNumber(uniqueConversations), tone: "cyan" },
    { label: "Missed Opportunities", value: formatNumber(totalMissedOpportunities), tone: "amber" },
    { label: "Resolution Rate", value: `${resolutionRate.toFixed(1)}%`, tone: "emerald" },
    { label: "Mapped Rows", value: formatNumber(mappedRowsCount), tone: "blue" },
    { label: "Negative Risk", value: formatNumber(totalNegativeRisk), tone: "rose" },
  ];

  if (authLoading) {
    return (
      <main className="results-page">
        <style>{resultsStyles}</style>
        <section className="hero compact">
          <p className="eyebrow">NEXT Ventures</p>
          <h1>Loading Results...</h1>
        </section>
      </main>
    );
  }

  return (
    <main className="results-page">
      <style>{resultsStyles}</style>

      <nav className="topbar">
        <div>
          <p className="eyebrow">NEXT Ventures</p>
          <strong>Review Approach & Client Sentiment Tracking</strong>
        </div>
        <div className="nav-actions">
          <Link href="/" className="nav-link">Dashboard</Link>
          <Link href="/run" className="nav-link">Run Audit</Link>
          <Link href="/admin" className="nav-link">Admin</Link>
          <span className={session?.user ? "access-pill active" : "access-pill"}>
            {session?.user ? "Signed In" : "Signed Out"}
          </span>
        </div>
      </nav>

      <section className="hero">
        <div>
          <div className="hero-badge">Results Archive</div>
          <h1>Stored Results</h1>
          <p>Search, filter, export, and manage saved audit records.</p>
        </div>

        <div className="hero-panel">
          <span>Latest Save</span>
          <strong>{latestStoredAt}</strong>
          <small>{formatNumber(results.length)} total stored row(s)</small>
        </div>
      </section>

      <section className="action-strip">
        <div className="action-row">
          <Link href="/run" className="primary-btn">Run New Audit</Link>
          <button type="button" className="secondary-btn" onClick={handleExportFiltered}>Export CSV</button>
          <button type="button" className="secondary-btn" onClick={() => loadStoredResults()}>Reload</button>
          {!session?.user ? (
            <button type="button" className="secondary-btn" onClick={handleGoogleLogin}>Sign in</button>
          ) : (
            <button type="button" className="secondary-btn" onClick={handleLogout}>Sign out</button>
          )}
        </div>
        <div className="mini-status">
          <span>{formatNumber(totalSuccess)} successful</span>
          <span>{formatNumber(totalErrors)} errors</span>
          <span>{formatNumber(totalStoredRuns)} run(s)</span>
          <span>{formatNumber(selectedIds.length)} selected</span>
        </div>
      </section>

      {(authMessage || pageError || pageSuccess) ? (
        <section className="message-stack">
          {authMessage ? <div className="message error">{authMessage}</div> : null}
          {pageError ? <div className="message error">{pageError}</div> : null}
          {pageSuccess ? <div className="message success">{pageSuccess}</div> : null}
        </section>
      ) : null}

      <section className="stats-grid">
        {stats.map((stat) => (
          <article key={stat.label} className={`stat-card ${stat.tone}`}>
            <p>{stat.label}</p>
            <strong>{stat.value}</strong>
          </article>
        ))}
      </section>

      <section className="filters-panel">
        <div className="filters-top">
          <div ref={presetMenuRef} className="preset-wrap">
            <label>Quick Range</label>
            <button type="button" className="date-preset-btn" onClick={() => setShowPresetMenu((prev) => !prev)}>
              <span><CalendarIcon />{DATE_PRESET_OPTIONS.find((item) => item.key === selectedDatePreset)?.label || "Custom"}</span>
              <small>{startDate} - {endDate}</small>
              <b>{showPresetMenu ? "▲" : "▼"}</b>
            </button>

            {showPresetMenu ? (
              <div className="preset-menu">
                {DATE_PRESET_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={selectedDatePreset === option.key ? "active" : ""}
                    onClick={() => applyDatePreset(option.key)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <label>
            <span>Start Date</span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => {
                setSelectedDatePreset("custom");
                setStartDate(event.target.value);
              }}
            />
          </label>

          <label>
            <span>End Date</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => {
                setSelectedDatePreset("custom");
                setEndDate(event.target.value);
              }}
            />
          </label>

          <label className="search-field">
            <span>Search</span>
            <input
              type="text"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Conversation, agent, employee, client, verdict"
            />
          </label>
        </div>

        <div className="filters-grid">
          <label>
            <span>Agent</span>
            <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}>
              <option value="all">All Agents</option>
              {agentOptions.map((agent) => <option key={agent} value={agent}>{agent}</option>)}
            </select>
          </label>

          <label>
            <span>Employee</span>
            <select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}>
              <option value="all">All Employees</option>
              {employeeOptions.map((employee) => <option key={employee} value={employee}>{employee}</option>)}
            </select>
          </label>

          <label>
            <span>Team</span>
            <select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
              <option value="all">All Teams</option>
              {teamOptions.map((team) => <option key={team} value={team}>{team}</option>)}
            </select>
          </label>

          <label>
            <span>Mapping</span>
            <select value={mappingStatusFilter} onChange={(event) => setMappingStatusFilter(event.target.value)}>
              {MAPPING_STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>

          <label>
            <span>Result Type</span>
            <select value={resultTypeFilter} onChange={(event) => setResultTypeFilter(event.target.value)}>
              {RESULT_TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>

          <label>
            <span>Review</span>
            <select value={reviewSentimentFilter} onChange={(event) => setReviewSentimentFilter(event.target.value)}>
              <option value="all">All Review Sentiments</option>
              {REVIEW_SENTIMENT_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>

          <label>
            <span>Client</span>
            <select value={clientSentimentFilter} onChange={(event) => setClientSentimentFilter(event.target.value)}>
              <option value="all">All Client Sentiments</option>
              {CLIENT_SENTIMENT_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>

          <label>
            <span>Resolution</span>
            <select value={resolutionStatusFilter} onChange={(event) => setResolutionStatusFilter(event.target.value)}>
              <option value="all">All Resolution Statuses</option>
              {RESOLUTION_STATUS_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>

        <div className="selection-row">
          <div className="action-row">
            <button type="button" className="secondary-btn" onClick={selectAllVisible}>Select Visible</button>
            <button type="button" className="secondary-btn" onClick={selectAllFiltered}>Select All Filtered</button>
            <button type="button" className="secondary-btn" onClick={clearSelection}>Clear Selection</button>
            <button type="button" className="secondary-btn" onClick={resetFilters}>Reset Filters</button>
            <button
              type="button"
              className="danger-btn"
              onClick={handleDeleteSelected}
              disabled={!selectedIds.length || deleting}
            >
              {deleting ? "Deleting..." : `Delete (${selectedIds.length})`}
            </button>
          </div>
          <span>Showing {formatNumber(visibleResults.length)} of {formatNumber(filteredResults.length)}</span>
        </div>
      </section>

      <section className="table-panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">Archive Table</p>
            <h2>Audit Results</h2>
          </div>
          <div className="table-summary">
            <span>{formatNumber(totalSuccess)} successful</span>
            <span>{formatNumber(totalErrors)} errors</span>
            <span>{formatNumber(selectedIds.length)} selected</span>
          </div>
        </div>

        {loading || authLoading ? (
          <div className="empty-box">Loading stored audit results...</div>
        ) : !session?.user ? (
          <div className="empty-box">Sign in to view stored results.</div>
        ) : !filteredResults.length ? (
          <div className="empty-box">No stored results match the current filters.</div>
        ) : (
          <>
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedIdSet.has(id))}
                        onChange={(event) => {
                          if (event.target.checked) {
                            selectAllVisible();
                          } else {
                            setSelectedIds((prev) => prev.filter((id) => !allVisibleIds.includes(id)));
                          }
                        }}
                      />
                    </th>
                    <th>Conversation</th>
                    <th>Agent</th>
                    <th>Employee</th>
                    <th>Type</th>
                    <th>Review</th>
                    <th>Client</th>
                    <th>Resolution</th>
                    <th>Date</th>
                    <th>Requester</th>
                    <th>Details</th>
                  </tr>
                </thead>

                <tbody>
                  {visibleResults.map((item) => {
                    const resultType = getResultType(item);
                    const isExpanded = Boolean(expandedRows[item.id]);
                    const conversationUrl = item.conversation_id
                      ? `${INTERCOM_CONVERSATION_URL_PREFIX}/${item.conversation_id}`
                      : "";
                    const mappingStatus = getMappingStatus(item);

                    return (
                      <Fragment key={item.id || item.conversation_id}>
                        <tr>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedIdSet.has(item.id)}
                              onChange={() => toggleSingle(item.id)}
                            />
                          </td>
                          <td>
                            <strong>{safeText(item.conversation_id, "Unknown")}</strong>
                            <small>{safeText(item.client_email)}</small>
                            {conversationUrl ? (
                              <a href={conversationUrl} target="_blank" rel="noreferrer" className="mini-link">Open Intercom</a>
                            ) : null}
                          </td>
                          <td>
                            <strong>{safeText(item.agent_name, "Unassigned")}</strong>
                            <small>CSAT {safeText(item.csat_score)}</small>
                          </td>
                          <td>
                            <strong>{safeText(item.employee_name, mappingStatus === "mapped" ? "Mapped" : "Unmapped")}</strong>
                            <small>{safeText(item.employee_email, mappingStatus)}</small>
                            <span className="team-chip">{safeText(item.team_name, "No Team")}</span>
                          </td>
                          <td><span className={`pill ${getResultTypeTone(resultType)}`}>{getResultTypeLabel(resultType)}</span></td>
                          <td><span className={`pill ${getReviewTone(item.review_sentiment)}`}>{safeText(item.review_sentiment)}</span></td>
                          <td><span className={`pill ${getClientTone(item.client_sentiment)}`}>{safeText(item.client_sentiment)}</span></td>
                          <td><span className={`pill ${getResolutionTone(item.resolution_status)}`}>{safeText(item.resolution_status)}</span></td>
                          <td>
                            <strong>{formatDateTime(item.replied_at || item.created_at)}</strong>
                            <small>{formatShortDate(item.replied_at || item.created_at)}</small>
                          </td>
                          <td>
                            <strong>{safeText(item.runMeta?.requested_by_email)}</strong>
                            <small>{safeText(item.runMeta?.audit_mode, "live_gpt")}</small>
                          </td>
                          <td>
                            <button type="button" className="secondary-btn small" onClick={() => toggleRowExpanded(item.id)}>
                              {isExpanded ? "Hide" : "View"}
                            </button>
                          </td>
                        </tr>

                        {isExpanded ? (
                          <tr className="expanded-row">
                            <td colSpan={11}>
                              <div className={item.error ? "verdict-box error" : "verdict-box"}>
                                <div className="verdict-head">
                                  <span>{item.error ? "Error Details" : "Full Verdict"}</span>
                                  <small>Run {safeText(item.run_id)}</small>
                                </div>
                                <pre>{safeText(item.error || item.ai_verdict)}</pre>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {filteredResults.length > 25 ? (
              <div className="show-more-row">
                <button type="button" className="secondary-btn" onClick={() => setShowAllRows((prev) => !prev)}>
                  {showAllRows ? "Show Less" : `Show More (${formatNumber(filteredResults.length - visibleResults.length)} more)`}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}

const resultsStyles = `
  .results-page {
    min-height: 100vh;
    padding: 32px 20px 64px;
    color: #f5f7ff;
    background:
      radial-gradient(circle at top left, rgba(59,130,246,0.17), transparent 24%),
      radial-gradient(circle at top right, rgba(168,85,247,0.15), transparent 22%),
      radial-gradient(circle at bottom center, rgba(236,72,153,0.08), transparent 22%),
      linear-gradient(180deg, #040714 0%, #060b1d 46%, #04060d 100%);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .topbar,
  .hero,
  .action-strip,
  .message-stack,
  .stats-grid,
  .filters-panel,
  .table-panel {
    max-width: 1520px;
    margin-left: auto;
    margin-right: auto;
  }

  .topbar,
  .hero,
  .action-strip,
  .filters-panel,
  .table-panel,
  .stat-card {
    border: 1px solid rgba(255,255,255,0.08);
    background: linear-gradient(180deg, rgba(15,22,43,0.88), rgba(7,10,24,0.96));
    box-shadow: 0 20px 60px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04);
  }

  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 18px;
    padding: 18px 20px;
    margin-bottom: 24px;
    border-radius: 22px;
    background: rgba(9,13,29,0.72);
    backdrop-filter: blur(14px);
  }

  .topbar strong {
    display: block;
    font-size: 22px;
    letter-spacing: -0.03em;
  }

  .nav-actions,
  .action-row,
  .mini-status,
  .selection-row,
  .table-summary {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }

  .nav-link,
  .access-pill,
  .hero-badge,
  .primary-btn,
  .secondary-btn,
  .danger-btn,
  .pill,
  .team-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: fit-content;
    border-radius: 999px;
    text-decoration: none;
    white-space: nowrap;
  }

  .nav-link {
    min-height: 38px;
    padding: 0 13px;
    color: #dbe7ff;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.035);
    font-size: 13px;
    font-weight: 800;
  }

  .access-pill {
    min-height: 38px;
    padding: 0 13px;
    color: #fde68a;
    border: 1px solid rgba(245,158,11,0.24);
    background: rgba(245,158,11,0.11);
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .access-pill.active {
    color: #bbf7d0;
    border-color: rgba(16,185,129,0.25);
    background: rgba(16,185,129,0.12);
  }

  .eyebrow,
  label span,
  .preset-wrap label {
    margin: 0 0 8px;
    color: #8ea0d6;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .hero {
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 24px;
    padding: 30px;
    margin-bottom: 18px;
    border-radius: 28px;
  }

  .hero::after {
    content: "";
    position: absolute;
    inset: auto -80px -120px auto;
    width: 360px;
    height: 360px;
    border-radius: 50%;
    background: rgba(124,58,237,0.18);
    filter: blur(50px);
    pointer-events: none;
  }

  .hero.compact {
    max-width: 900px;
    margin-top: 80px;
  }

  .hero-badge {
    padding: 8px 12px;
    margin-bottom: 18px;
    color: #dbe7ff;
    border: 1px solid rgba(129,140,248,0.22);
    background: rgba(99,102,241,0.14);
    font-size: 12px;
    font-weight: 900;
  }

  h1,
  h2,
  p {
    position: relative;
  }

  h1 {
    margin: 0 0 12px;
    font-size: clamp(42px, 5vw, 72px);
    line-height: 0.98;
    letter-spacing: -0.07em;
  }

  h2 {
    margin: 0;
    font-size: 30px;
    letter-spacing: -0.04em;
  }

  .hero p {
    margin: 0;
    color: #a9b4d0;
    font-size: 18px;
    line-height: 1.6;
  }

  .hero-panel {
    position: relative;
    z-index: 1;
    min-width: 300px;
    padding: 18px;
    border-radius: 22px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.04);
  }

  .hero-panel span,
  .hero-panel small {
    display: block;
    color: #8ea0d6;
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  .hero-panel strong {
    display: block;
    margin: 8px 0;
    color: #f5f7ff;
    font-size: 16px;
    line-height: 1.5;
  }

  .action-strip {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    padding: 16px;
    margin-bottom: 18px;
    border-radius: 22px;
    background: rgba(9,13,29,0.66);
  }

  .primary-btn,
  .secondary-btn,
  .danger-btn {
    min-height: 44px;
    padding: 0 16px;
    border-radius: 14px;
    font-size: 14px;
    font-weight: 900;
    cursor: pointer;
  }

  .primary-btn {
    color: #fff;
    border: 0;
    background: linear-gradient(135deg, #2563eb 0%, #7c3aed 50%, #db2777 100%);
    box-shadow: 0 14px 30px rgba(91,33,182,0.35);
  }

  .secondary-btn {
    color: #e5ebff;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.035);
  }

  .secondary-btn.small {
    min-height: 36px;
    padding: 0 12px;
    font-size: 12px;
  }

  .danger-btn {
    color: #ffe4e6;
    border: 1px solid rgba(251,113,133,0.2);
    background: rgba(244,63,94,0.1);
  }

  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .mini-status span,
  .table-summary span {
    color: #a9b4d0;
    font-size: 13px;
    font-weight: 800;
  }

  .message-stack {
    display: grid;
    gap: 10px;
    margin-bottom: 18px;
  }

  .message {
    padding: 14px 16px;
    border-radius: 16px;
    font-size: 14px;
    line-height: 1.6;
  }

  .message.error {
    color: #fecdd3;
    border: 1px solid rgba(244,63,94,0.23);
    background: rgba(244,63,94,0.08);
  }

  .message.success {
    color: #bbf7d0;
    border: 1px solid rgba(16,185,129,0.23);
    background: rgba(16,185,129,0.08);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 14px;
    margin-bottom: 18px;
  }

  .stat-card {
    position: relative;
    overflow: hidden;
    padding: 18px;
    border-radius: 22px;
  }

  .stat-card::before {
    content: "";
    position: absolute;
    left: -48px;
    top: -48px;
    width: 130px;
    height: 130px;
    border-radius: 50%;
    filter: blur(30px);
    background: rgba(59,130,246,0.16);
  }

  .stat-card.violet::before { background: rgba(139,92,246,0.18); }
  .stat-card.cyan::before { background: rgba(34,211,238,0.16); }
  .stat-card.amber::before { background: rgba(245,158,11,0.16); }
  .stat-card.emerald::before { background: rgba(16,185,129,0.16); }
  .stat-card.rose::before { background: rgba(244,63,94,0.16); }

  .stat-card p {
    margin: 0 0 10px;
    color: #8ea0d6;
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  .stat-card strong {
    display: block;
    color: #f5f7ff;
    font-size: 30px;
    letter-spacing: -0.04em;
  }

  .filters-panel,
  .table-panel {
    padding: 22px;
    margin-bottom: 18px;
    border-radius: 26px;
  }

  .filters-top,
  .filters-grid {
    display: grid;
    gap: 14px;
  }

  .filters-top {
    grid-template-columns: 340px 180px 180px minmax(260px, 1fr);
    margin-bottom: 14px;
  }

  .filters-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin-bottom: 16px;
  }

  label {
    display: block;
  }

  input,
  select,
  button {
    font: inherit;
  }

  input,
  select,
  .date-preset-btn {
    width: 100%;
    min-height: 50px;
    box-sizing: border-box;
    color: #e7ecff;
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 16px;
    outline: none;
    background: rgba(5,8,18,0.9);
  }

  input,
  select {
    padding: 0 14px;
    color-scheme: dark;
  }

  .preset-wrap {
    position: relative;
  }

  .date-preset-btn {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    cursor: pointer;
  }

  .date-preset-btn span {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-weight: 900;
  }

  .date-preset-btn small {
    color: #8ea0d6;
    font-size: 12px;
  }

  .date-preset-btn b {
    color: #8ea0d6;
    font-size: 11px;
  }

  .preset-menu {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    right: 0;
    z-index: 10;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 18px;
    background: rgba(7,10,24,0.98);
    box-shadow: 0 18px 50px rgba(0,0,0,0.45);
  }

  .preset-menu button {
    width: 100%;
    padding: 13px 16px;
    color: #dbe7ff;
    border: 0;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    background: transparent;
    text-align: left;
    font-size: 14px;
    font-weight: 800;
    cursor: pointer;
  }

  .preset-menu button.active,
  .preset-menu button:hover {
    color: #f5f3ff;
    background: rgba(139,92,246,0.16);
  }

  .selection-row {
    justify-content: space-between;
    padding-top: 4px;
  }

  .selection-row > span {
    color: #a9b4d0;
    font-size: 13px;
    font-weight: 800;
  }

  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 18px;
    margin-bottom: 18px;
  }

  .empty-box {
    padding: 36px 20px;
    color: #a9b4d0;
    text-align: center;
    border: 1px dashed rgba(255,255,255,0.12);
    border-radius: 20px;
    background: rgba(255,255,255,0.025);
    line-height: 1.7;
  }

  .table-shell {
    overflow: auto;
    max-height: 920px;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 22px;
    background: rgba(4,8,20,0.72);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
  }

  table {
    width: 100%;
    min-width: 1640px;
    border-collapse: collapse;
  }

  th,
  td {
    padding: 15px 14px;
    text-align: left;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    vertical-align: top;
  }

  th {
    position: sticky;
    top: 0;
    z-index: 2;
    color: #8ea0d6;
    background: rgba(10,18,34,0.98);
    backdrop-filter: blur(18px);
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  tr:nth-child(even) td {
    background: rgba(255,255,255,0.018);
  }

  td strong,
  td small,
  td em {
    display: block;
  }

  td strong {
    color: #f5f7ff;
    margin-bottom: 5px;
    font-size: 14px;
    line-height: 1.35;
  }

  td small {
    color: #a9b4d0;
    line-height: 1.5;
    font-size: 12px;
  }

  .mini-link {
    display: inline-flex;
    margin-top: 8px;
    color: #93c5fd;
    font-size: 12px;
    font-weight: 900;
    text-decoration: none;
  }

  .team-chip {
    margin-top: 8px;
    padding: 6px 10px;
    color: #dbe7ff;
    border: 1px solid rgba(96,165,250,0.2);
    background: rgba(59,130,246,0.1);
    font-size: 12px;
    font-weight: 900;
  }

  .pill {
    padding: 7px 11px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.05);
    color: #dbe7ff;
    font-size: 12px;
    font-weight: 900;
    line-height: 1.25;
  }

  .pill.success {
    color: #bbf7d0;
    border-color: rgba(16,185,129,0.22);
    background: rgba(16,185,129,0.1);
  }

  .pill.warning {
    color: #fde68a;
    border-color: rgba(245,158,11,0.24);
    background: rgba(245,158,11,0.1);
  }

  .pill.danger {
    color: #fecdd3;
    border-color: rgba(244,63,94,0.24);
    background: rgba(244,63,94,0.1);
  }

  .pill.notice,
  .pill.neutral {
    color: #bfdbfe;
    border-color: rgba(96,165,250,0.24);
    background: rgba(59,130,246,0.1);
  }

  .expanded-row td {
    padding-top: 0;
    background: rgba(255,255,255,0.02) !important;
  }

  .verdict-box {
    margin: 0 0 8px;
    padding: 18px;
    border-radius: 18px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03);
  }

  .verdict-box.error {
    border-color: rgba(251,113,133,0.18);
    background: rgba(244,63,94,0.08);
  }

  .verdict-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }

  .verdict-head span,
  .verdict-head small {
    color: #8ea0d6;
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  pre {
    margin: 0;
    white-space: pre-wrap;
    color: #dbe7ff;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.8;
  }

  .show-more-row {
    display: flex;
    justify-content: flex-end;
    margin-top: 16px;
  }

  @media (max-width: 1200px) {
    .stats-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .filters-top,
    .filters-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 820px) {
    .topbar,
    .hero,
    .action-strip,
    .section-head {
      flex-direction: column;
      align-items: stretch;
    }

    .hero-panel {
      min-width: 0;
    }

    .stats-grid,
    .filters-top,
    .filters-grid {
      grid-template-columns: 1fr;
    }
  }
`;
