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

  if (
    safeText(item?.review_sentiment, "") === "Missed Opportunity" &&
    safeText(item?.client_sentiment, "") === "Very Positive"
  ) {
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

function PresetCalendarIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
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
        <linearGradient
          id="resultsCalendarGradient"
          x1="3.5"
          y1="4.5"
          x2="20.5"
          y2="20.5"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#60A5FA" />
          <stop offset="0.5" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#EC4899" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function statusToneClasses(kind) {
  if (kind === "resolved" || kind === "positive_signal") {
    return "border-emerald-400/20 bg-emerald-500/10 text-emerald-200";
  }

  if (kind === "opportunity_case" || kind === "pending") {
    return "border-amber-300/20 bg-amber-400/10 text-amber-100";
  }

  if (kind === "negative_risk" || kind === "unresolved" || kind === "error") {
    return "border-rose-400/20 bg-rose-500/10 text-rose-200";
  }

  return "border-cyan-400/20 bg-cyan-500/10 text-cyan-200";
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

  async function loadStoredResults() {
    setLoading(true);
    setPageError("");
    setPageSuccess("");

    try {
      const [runsResponse, resultsResponse] = await Promise.all([
        supabase.from("audit_runs").select("*").order("created_at", { ascending: false }).limit(500),
        supabase
          .from("audit_results")
          .select("*")
          .order("replied_at", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(5000),
      ]);

      if (runsResponse.error) {
        throw new Error(runsResponse.error.message || "Could not load stored runs.");
      }

      if (resultsResponse.error) {
        throw new Error(resultsResponse.error.message || "Could not load stored results.");
      }

      setRuns(Array.isArray(runsResponse.data) ? runsResponse.data : []);
      setResults(Array.isArray(resultsResponse.data) ? resultsResponse.data : []);
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
          await loadStoredResults();
          return;
        }

        const profileResult = await loadProfile(currentSession.user);

        if (!active) return;

        setProfile(profileResult.profile);
        setAuthMessage(profileResult.message);
        setAuthLoading(false);

        await loadStoredResults();
      } catch (_error) {
        if (!active) return;
        setAuthMessage("Could not complete session check.");
        setAuthLoading(false);
        await loadStoredResults();
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
        await loadStoredResults();
        return;
      }

      const profileResult = await loadProfile(newSession.user);
      if (!active) return;

      setProfile(profileResult.profile);
      setAuthMessage(profileResult.message);
      setAuthLoading(false);

      await loadStoredResults();
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

  const visibleResults = showAllRows ? filteredResults : filteredResults.slice(0, 50);
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
      helper: "Real stored result rows in the current filtered view",
      tone: "violet",
    },
    {
      label: "Stored Runs",
      value: totalStoredRuns.toLocaleString(),
      helper: "Unique saved audit batches in the filtered range",
      tone: "cyan",
    },
    {
      label: "Missed Opportunities",
      value: totalMissedOpportunities.toLocaleString(),
      helper: "Stored rows where a review opportunity was missed",
      tone: "amber",
    },
    {
      label: "Positive Resolution Rate",
      value: `${positiveResolutionRate.toFixed(1)}%`,
      helper: "Resolved rows in the filtered range",
      tone: "emerald",
    },
  ];

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#030614] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-10%] top-[-15%] h-[28rem] w-[28rem] rounded-full bg-violet-600/18 blur-3xl" />
        <div className="absolute right-[-8%] top-[8%] h-[26rem] w-[26rem] rounded-full bg-cyan-500/12 blur-3xl" />
        <div className="absolute bottom-[-10%] left-[18%] h-[30rem] w-[30rem] rounded-full bg-fuchsia-500/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(91,33,182,0.16),transparent_28%),radial-gradient(circle_at_80%_20%,rgba(6,182,212,0.11),transparent_22%),linear-gradient(180deg,#050816_0%,#030614_48%,#02030A_100%)]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 py-8 md:px-8 lg:px-10">
        <section className="mb-8 overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_30px_120px_rgba(2,6,23,0.68)] backdrop-blur-2xl">
          <div className="grid gap-8 px-6 py-7 md:px-8 lg:grid-cols-[1.3fr_0.9fr] lg:px-10 lg:py-10">
            <div>
              <div className="mb-4 inline-flex items-center rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-200">
                Premium Results Archive
              </div>

              <h1 className="max-w-4xl text-3xl font-semibold leading-tight tracking-tight text-white md:text-5xl">
                Stored audit results, designed as a premium management archive instead of a fake dashboard.
              </h1>

              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 md:text-base">
                This page is now only for real stored results. No dummy charts. No fake employee blocks.
                No placeholder weekly trend sections. Results stay here until you delete them.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/run"
                  className="inline-flex items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(96,165,250,0.96),rgba(168,85,247,0.95),rgba(236,72,153,0.95))] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(147,51,234,0.28)] transition hover:scale-[1.01]"
                >
                  Run New Audit
                </Link>

                <button
                  type="button"
                  onClick={handleExportFiltered}
                  className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10"
                >
                  Export Filtered CSV
                </button>

                {!session?.user ? (
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    className="inline-flex items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-5 py-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/15"
                  >
                    Sign in with Google
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10"
                  >
                    Sign out
                  </button>
                )}
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-[#081121]/80 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_20px_60px_rgba(0,0,0,0.32)]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">Archive status</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Latest stored result: {latestStoredAt}
                  </p>
                </div>
                <div className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                  Real Supabase data
                </div>
              </div>

              <div className="space-y-4">
                <div ref={presetMenuRef} className="relative">
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Quick Range
                  </label>

                  <button
                    type="button"
                    onClick={() => setShowPresetMenu((prev) => !prev)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#07101f] px-4 py-3 text-left text-sm text-white outline-none transition hover:bg-[#0b1426]"
                  >
                    <span className="inline-flex items-center gap-3">
                      <PresetCalendarIcon />
                      <span className="font-medium">
                        {DATE_PRESET_OPTIONS.find((item) => item.key === selectedDatePreset)?.label ||
                          "Custom"}
                      </span>
                      <span className="text-xs text-slate-400">
                        {startDate} - {endDate}
                      </span>
                    </span>
                    <span className="text-slate-400">{showPresetMenu ? "▲" : "▼"}</span>
                  </button>

                  {showPresetMenu ? (
                    <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-white/10 bg-[#081120] shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
                      {DATE_PRESET_OPTIONS.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => applyDatePreset(option.key)}
                          className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm transition ${
                            selectedDatePreset === option.key
                              ? "bg-violet-500/15 text-violet-100"
                              : "text-slate-200 hover:bg-white/5"
                          }`}
                        >
                          <span>{option.label}</span>
                          {selectedDatePreset === option.key ? (
                            <span className="text-emerald-300">✓</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setSelectedDatePreset("custom");
                        setStartDate(e.target.value);
                      }}
                      className="w-full rounded-2xl border border-white/10 bg-[#07101f] px-4 py-3 text-sm text-white outline-none transition focus:border-violet-400/40 focus:ring-2 focus:ring-violet-500/20"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      End Date
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => {
                        setSelectedDatePreset("custom");
                        setEndDate(e.target.value);
                      }}
                      className="w-full rounded-2xl border border-white/10 bg-[#07101f] px-4 py-3 text-sm text-white outline-none transition focus:border-violet-400/40 focus:ring-2 focus:ring-violet-500/20"
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-400/15 bg-emerald-500/8 px-4 py-3 text-sm text-emerald-100">
                  Results tab = storage, filtering, export, selection, and delete. Dashboard will handle charts later.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="relative overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] p-5 shadow-[0_20px_60px_rgba(2,6,23,0.45)] backdrop-blur-xl"
            >
              <div
                className={`mb-4 inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                  stat.tone === "violet"
                    ? "border-violet-400/20 bg-violet-500/10 text-violet-200"
                    : stat.tone === "cyan"
                    ? "border-cyan-400/20 bg-cyan-500/10 text-cyan-200"
                    : stat.tone === "amber"
                    ? "border-amber-300/20 bg-amber-400/10 text-amber-100"
                    : "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                }`}
              >
                Stored
              </div>
              <p className="text-sm text-slate-400">{stat.label}</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-white">
                {stat.value}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-400">{stat.helper}</p>
            </div>
          ))}
        </section>

        {(authMessage || pageError || pageSuccess) ? (
          <section className="mb-8 space-y-3">
            {authMessage ? (
              <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {authMessage}
              </div>
            ) : null}

            {pageError ? (
              <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {pageError}
              </div>
            ) : null}

            {pageSuccess ? (
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                {pageSuccess}
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="mb-8 rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_20px_80px_rgba(2,6,23,0.45)] backdrop-blur-xl">
          <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                Stored result controls
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                Filter real stored audit results only. Search, narrow down, select rows, export, or delete selected rows.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={loadStoredResults}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10"
              >
                Reload Results
              </button>

              <button
                type="button"
                onClick={selectAllVisible}
                disabled={!allVisibleIds.length}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Select Visible
              </button>

              <button
                type="button"
                onClick={selectAllFiltered}
                disabled={!allFilteredIds.length}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Select All Filtered
              </button>

              <button
                type="button"
                onClick={clearSelection}
                disabled={!selectedIds.length}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear Selection
              </button>

              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={!selectedIds.length || deleting}
                className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-100 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? "Deleting..." : `Delete Selected (${selectedIds.length})`}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search conversation, agent, client email, verdict, or requester"
              className="rounded-2xl border border-white/10 bg-[#07101f] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-violet-400/40 focus:ring-2 focus:ring-violet-500/20"
            />

            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="rounded-2xl border border-white/10 bg-[#07101f] px-4 py-3 text-sm text-white outline-none focus:border-violet-400/40 focus:ring-2 focus:ring-violet-500/20"
            >
              <option value="all">All Agents</option>
              {agentOptions.map((agent) => (
                <option key={agent} value={agent}>
                  {agent}
                </option>
              ))}
            </select>

            <select
              value={resultTypeFilter}
              onChange={(e) => setResultTypeFilter(e.target.value)}
              className="rounded-2xl border border-white/10 bg-[#07101f] px-4 py-3 text-sm text-white outline-none focus:border-violet-400/40 focus:ring-2 focus:ring-violet-500/20"
            >
              {RESULT_TYPE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>

            <select
              value={reviewSentimentFilter}
              onChange={(e) => setReviewSentimentFilter(e.target.value)}
              className="rounded-2xl border border-white/10 bg-[#07101f] px-4 py-3 text-sm text-white outline-none focus:border-violet-400/40 focus:ring-2 focus:ring-violet-500/20"
            >
              <option value="all">All Review Sentiments</option>
              {REVIEW_SENTIMENT_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>

            <select
              value={clientSentimentFilter}
              onChange={(e) => setClientSentimentFilter(e.target.value)}
              className="rounded-2xl border border-white/10 bg-[#07101f] px-4 py-3 text-sm text-white outline-none focus:border-violet-400/40 focus:ring-2 focus:ring-violet-500/20"
            >
              <option value="all">All Client Sentiments</option>
              {CLIENT_SENTIMENT_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>

            <select
              value={resolutionStatusFilter}
              onChange={(e) => setResolutionStatusFilter(e.target.value)}
              className="rounded-2xl border border-white/10 bg-[#07101f] px-4 py-3 text-sm text-white outline-none focus:border-violet-400/40 focus:ring-2 focus:ring-violet-500/20"
            >
              <option value="all">All Resolution Statuses</option>
              {RESOLUTION_STATUS_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_20px_80px_rgba(2,6,23,0.45)] backdrop-blur-xl">
          <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                Real Stored Results Table
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                This is the live table for stored audit results. No dummy employee cards. No fake review distribution blocks. Just real rows you can manage.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#081120] px-4 py-3 text-sm text-slate-300">
              Showing <span className="font-semibold text-white">{visibleResults.length}</span> of{" "}
              <span className="font-semibold text-white">{filteredResults.length}</span> filtered result(s)
            </div>
          </div>

          {loading || authLoading ? (
            <div className="rounded-2xl border border-white/10 bg-[#081120] px-5 py-10 text-center text-sm text-slate-300">
              Loading stored audit results...
            </div>
          ) : !filteredResults.length ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-[#081120] px-5 py-10 text-center text-sm text-slate-300">
              No stored results match the current filters.
            </div>
          ) : (
            <div className="overflow-hidden rounded-[24px] border border-white/10 bg-[#06101f]/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="max-h-[900px] overflow-auto">
                <table className="min-w-[1280px] w-full border-collapse">
                  <thead className="sticky top-0 z-10 bg-[rgba(10,18,34,0.94)] backdrop-blur-xl">
                    <tr className="border-b border-white/10">
                      <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
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
                          className="h-4 w-4 rounded border-white/20 bg-[#07101f] text-violet-500 focus:ring-violet-500/30"
                        />
                      </th>
                      <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Conversation
                      </th>
                      <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Agent
                      </th>
                      <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Review Sentiment
                      </th>
                      <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Client Sentiment
                      </th>
                      <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Resolution
                      </th>
                      <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Verdict / Error
                      </th>
                      <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Replied At
                      </th>
                      <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Run Info
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {visibleResults.map((item, index) => {
                      const resultType = getResultType(item);
                      const resolution = safeText(item.resolution_status, "");
                      const rowTone =
                        index % 2 === 0 ? "bg-white/[0.025]" : "bg-transparent";

                      return (
                        <tr
                          key={item.id}
                          className={`${rowTone} border-b border-white/8 transition hover:bg-white/[0.045]`}
                        >
                          <td className="px-4 py-4 align-top">
                            <input
                              type="checkbox"
                              checked={selectedIdSet.has(item.id)}
                              onChange={() => toggleSingle(item.id)}
                              className="mt-1 h-4 w-4 rounded border-white/20 bg-[#07101f] text-violet-500 focus:ring-violet-500/30"
                            />
                          </td>

                          <td className="px-4 py-4 align-top">
                            <div className="space-y-1">
                              <div className="text-sm font-semibold text-white">
                                {safeText(item.conversation_id, "Unknown Conversation")}
                              </div>
                              <div className="text-xs text-slate-400">
                                Client: {safeText(item.client_email)}
                              </div>
                              <div className="text-xs text-slate-500">
                                CSAT: {safeText(item.csat_score)}
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-4 align-top">
                            <div className="space-y-2">
                              <div className="text-sm font-medium text-slate-100">
                                {safeText(item.agent_name, "Unassigned")}
                              </div>
                              <span
                                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${
                                  resultType === "error"
                                    ? statusToneClasses("error")
                                    : resultType === "opportunity_case"
                                    ? statusToneClasses("opportunity_case")
                                    : resultType === "positive_signal"
                                    ? statusToneClasses("positive_signal")
                                    : resultType === "negative_risk"
                                    ? statusToneClasses("negative_risk")
                                    : statusToneClasses("pending")
                                }`}
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
                            </div>
                          </td>

                          <td className="px-4 py-4 align-top">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${
                                safeText(item.review_sentiment, "") === "Missed Opportunity"
                                  ? statusToneClasses("opportunity_case")
                                  : safeText(item.review_sentiment, "") ===
                                      "Likely Positive Review" ||
                                    safeText(item.review_sentiment, "") ===
                                      "Highly Likely Positive Review"
                                  ? statusToneClasses("positive_signal")
                                  : safeText(item.review_sentiment, "") ===
                                      "Likely Negative Review" ||
                                    safeText(item.review_sentiment, "") ===
                                      "Highly Likely Negative Review" ||
                                    safeText(item.review_sentiment, "") ===
                                      "Negative Outcome - No Review Request"
                                  ? statusToneClasses("negative_risk")
                                  : statusToneClasses("pending")
                              }`}
                            >
                              {safeText(item.review_sentiment)}
                            </span>
                          </td>

                          <td className="px-4 py-4 align-top">
                            <div className="text-sm text-slate-200">
                              {safeText(item.client_sentiment)}
                            </div>
                          </td>

                          <td className="px-4 py-4 align-top">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${
                                resolution === "Resolved"
                                  ? statusToneClasses("resolved")
                                  : resolution === "Pending"
                                  ? statusToneClasses("pending")
                                  : resolution === "Unresolved"
                                  ? statusToneClasses("unresolved")
                                  : statusToneClasses("pending")
                              }`}
                            >
                              {safeText(item.resolution_status)}
                            </span>
                          </td>

                          <td className="px-4 py-4 align-top">
                            {item.error ? (
                              <div className="max-w-[320px] rounded-2xl border border-rose-400/15 bg-rose-500/8 px-3 py-2 text-xs leading-5 text-rose-100">
                                {safeText(item.error)}
                              </div>
                            ) : (
                              <div className="max-w-[360px] text-sm leading-6 text-slate-200">
                                {safeText(item.ai_verdict)}
                              </div>
                            )}
                          </td>

                          <td className="px-4 py-4 align-top">
                            <div className="space-y-1">
                              <div className="text-sm text-slate-100">
                                {formatDateTime(item.replied_at || item.created_at)}
                              </div>
                              <div className="text-xs text-slate-500">
                                {formatShortDate(item.replied_at || item.created_at)}
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-4 align-top">
                            <div className="space-y-1">
                              <div className="text-sm text-slate-100">
                                {safeText(item.runMeta?.requested_by_email)}
                              </div>
                              <div className="text-xs text-slate-400">
                                {safeText(item.runMeta?.audit_mode, "live_gpt")}
                              </div>
                              <div className="text-xs text-slate-500">
                                {formatShortDate(item.runMeta?.created_at)}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {filteredResults.length > 50 ? (
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setShowAllRows((prev) => !prev)}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10"
              >
                {showAllRows
                  ? "Show Less"
                  : `Show More (${filteredResults.length - visibleResults.length} more)`}
              </button>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>Successful: {totalSuccess}</span>
            <span>•</span>
            <span>Errors: {totalErrors}</span>
            <span>•</span>
            <span>Selected: {selectedIds.length}</span>
          </div>
        </section>
      </div>
    </main>
  );
}
