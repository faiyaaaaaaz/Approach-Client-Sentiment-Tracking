"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

const AUTO_DUPLICATE_OVERWRITE_LIMIT = 20;
const AUDIT_BATCH_SIZE = 8;
const SESSION_REFRESH_BUFFER_MS = 2 * 60 * 1000;

const DATE_PRESET_OPTIONS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "past_week", label: "Past Week" },
  { key: "month_to_date", label: "Month to Date" },
  { key: "past_4_weeks", label: "Past 4 Weeks" },
  { key: "past_12_weeks", label: "Past 12 Weeks" },
  { key: "year_to_date", label: "Year to Date" },
  { key: "past_6_months", label: "Past 6 Months" },
  { key: "past_12_months", label: "Past 12 Months" },
  { key: "custom", label: "Custom" },
];

const FETCH_STEPS = [
  "Preparing request",
  "Checking access",
  "Connecting to Intercom",
  "Finding low-CSAT conversations",
  "Hydrating conversation details",
  "Preparing audit queue",
];

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

function buildFallbackProfile(user) {
  const email = user?.email?.toLowerCase() || "";

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

function canRunAudits(profile) {
  return Boolean(
    profile?.is_active === true &&
      (profile?.role === "master_admin" ||
        profile?.role === "admin" ||
        profile?.can_run_tests === true)
  );
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

function shiftDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return normalizeToStartOfDay(next);
}

function shiftMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return normalizeToStartOfDay(next);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfYear(date) {
  return new Date(date.getFullYear(), 0, 1);
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
    case "past_week":
      return { startDate: formatDateInput(shiftDays(today, -6)), endDate: formatDateInput(today) };
    case "month_to_date":
      return { startDate: formatDateInput(startOfMonth(today)), endDate: formatDateInput(today) };
    case "past_4_weeks":
      return { startDate: formatDateInput(shiftDays(today, -27)), endDate: formatDateInput(today) };
    case "past_12_weeks":
      return { startDate: formatDateInput(shiftDays(today, -83)), endDate: formatDateInput(today) };
    case "year_to_date":
      return { startDate: formatDateInput(startOfYear(today)), endDate: formatDateInput(today) };
    case "past_6_months":
      return { startDate: formatDateInput(shiftMonths(today, -6)), endDate: formatDateInput(today) };
    case "past_12_months":
      return { startDate: formatDateInput(shiftMonths(today, -12)), endDate: formatDateInput(today) };
    default:
      return null;
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function formatClock(value) {
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

function formatElapsed(startedAt) {
  if (!startedAt) return "0s";

  const diff = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(diff / 60);
  const seconds = diff % 60;

  if (!minutes) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function splitIntoBatches(items, size) {
  const batches = [];

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
}

async function readJsonSafely(response) {
  const text = await response.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_error) {
    const trimmed = text.replace(/\s+/g, " ").trim();
    throw new Error(
      `Server returned a non-JSON response. Status ${response.status}. ${trimmed.slice(0, 260)}`
    );
  }
}

function getResultStatusLabel(item) {
  if (item?.error) return "Error";
  if (item?.resolutionStatus) return item.resolutionStatus;
  return "Completed";
}

function getStatusTone(value) {
  if (value === "Resolved" || value === "Completed") return "success";
  if (value === "Pending") return "notice";
  if (value === "Unresolved" || value === "Error") return "danger";
  return "neutral";
}

function getResultSummary(item) {
  if (item?.error) return item.error;
  if (item?.aiVerdict) return item.aiVerdict;
  if (item?.summary) return item.summary;
  return "Audit completed.";
}

function getFindingsList(item) {
  const findings = [];

  if (item?.reviewSentiment) findings.push(`Review Sentiment: ${item.reviewSentiment}`);
  if (item?.clientSentiment) findings.push(`Client Sentiment: ${item.clientSentiment}`);
  if (item?.resolutionStatus) findings.push(`Resolution Status: ${item.resolutionStatus}`);

  if (Array.isArray(item?.findings) && item.findings.length > 0) {
    findings.push(...item.findings);
  }

  return findings;
}

function DuplicateWarningModal({
  open,
  duplicateSummary,
  processing,
  onCancel,
  onSkip,
  onOverwrite,
}) {
  if (!open) return null;

  const sampleIds = Array.isArray(duplicateSummary?.sampleConversationIds)
    ? duplicateSummary.sampleConversationIds
    : [];

  const duplicateCount = Number(duplicateSummary?.duplicateCount || 0);

  return (
    <div className="modal-backdrop">
      <div className="duplicate-modal">
        <div className="modal-badge warning">Duplicate audit warning</div>
        <h2>Duplicates Found</h2>
        <p>{formatNumber(duplicateCount)} selected conversation audit(s) already exist in Results.</p>

        <div className="duplicate-sample-box">
          <span>Sample Conversation IDs</span>
          {sampleIds.length ? (
            <div className="duplicate-list">
              {sampleIds.map((id) => (
                <strong key={id}>{id}</strong>
              ))}
            </div>
          ) : (
            <small>No sample conversation IDs were returned.</small>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onCancel} disabled={processing}>
            Cancel
          </button>
          <button type="button" className="secondary-btn" onClick={onSkip} disabled={processing}>
            Skip Existing
          </button>
          <button type="button" className="primary-btn" onClick={onOverwrite} disabled={processing}>
            Overwrite Existing
          </button>
        </div>
      </div>
    </div>
  );
}

function ProgressPanel({
  type,
  label,
  detail,
  percent,
  elapsed,
  handled,
  total,
  batchIndex,
  totalBatches,
  savedRows,
  skippedRows,
  failedRows,
  onCancel,
}) {
  return (
    <div className="progress-panel">
      <div className="progress-head">
        <div>
          <span>{type}</span>
          <strong>{label}</strong>
          <small>{detail}</small>
        </div>
        <div className="progress-percent">{Math.round(percent)}%</div>
      </div>

      <div className="progress-shell">
        <div className="progress-bar" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
      </div>

      <div className="progress-foot">
        <span>
          {total ? `${formatNumber(handled)} / ${formatNumber(total)} handled` : "Preparing"}
        </span>
        <span>
          {totalBatches ? `Batch ${formatNumber(batchIndex)} of ${formatNumber(totalBatches)}` : ""}
        </span>
        <span>Saved: {formatNumber(savedRows || 0)}</span>
        <span>Skipped: {formatNumber(skippedRows || 0)}</span>
        <span>Failed: {formatNumber(failedRows || 0)}</span>
        <span>Elapsed: {elapsed}</span>
      </div>

      <button type="button" className="danger-btn compact" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

export default function RunPage() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedDatePreset, setSelectedDatePreset] = useState("custom");
  const [showPresetMenu, setShowPresetMenu] = useState(false);

  const [limiterEnabled, setLimiterEnabled] = useState(true);
  const [limitCount, setLimitCount] = useState("10");
  const [autoRunAfterFetch, setAutoRunAfterFetch] = useState(false);

  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMessage, setAuthMessage] = useState("");

  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchStepIndex, setFetchStepIndex] = useState(0);
  const [fetchStartedAt, setFetchStartedAt] = useState(null);
  const [fetchError, setFetchError] = useState("");
  const [fetchSuccess, setFetchSuccess] = useState("");
  const [fetchData, setFetchData] = useState(null);

  const [runLoading, setRunLoading] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState(null);
  const [runError, setRunError] = useState("");
  const [runSuccess, setRunSuccess] = useState("");
  const [runData, setRunData] = useState(null);

  const [operationStatus, setOperationStatus] = useState("idle");
  const [executionLog, setExecutionLog] = useState([]);
  const [showAllResults, setShowAllResults] = useState(false);
  const [showJumpTop, setShowJumpTop] = useState(false);
  const [_elapsedTick, setElapsedTick] = useState(0);

  const [duplicateWarningOpen, setDuplicateWarningOpen] = useState(false);
  const [duplicateSummary, setDuplicateSummary] = useState(null);
  const [duplicateDecisionLoading, setDuplicateDecisionLoading] = useState(false);
  const [pendingDuplicateConversations, setPendingDuplicateConversations] = useState([]);

  const [auditProgress, setAuditProgress] = useState({
    handled: 0,
    total: 0,
    batchIndex: 0,
    totalBatches: 0,
    percent: 0,
    savedRows: 0,
    skippedRows: 0,
    failedRows: 0,
    label: "Ready",
    detail: "Audit has not started.",
  });

  const startDateRef = useRef(null);
  const endDateRef = useRef(null);
  const presetMenuRef = useRef(null);
  const fetchAbortRef = useRef(null);
  const runAbortRef = useRef(null);
  const cancelRequestedRef = useRef(false);

  const canRunTests = canRunAudits(profile);
  const isBusy = fetchLoading || runLoading || duplicateDecisionLoading;

  const fetchedConversations = Array.isArray(fetchData?.conversations)
    ? fetchData.conversations
    : [];

  const dailySummary = Array.isArray(fetchData?.debug?.dailySummary)
    ? fetchData.debug.dailySummary
    : [];

  const results = Array.isArray(runData?.results) ? runData.results : [];
  const successCount = results.filter((item) => !item?.error).length;
  const errorCount = results.filter((item) => item?.error).length;
  const visibleResults = showAllResults ? results : results.slice(0, 8);
  const selectedPresetLabel =
    DATE_PRESET_OPTIONS.find((item) => item.key === selectedDatePreset)?.label || "Custom";

  function addLog(message, tone = "info") {
    const now = new Date();
    const time = now.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    setExecutionLog((prev) =>
      [{ time, message, tone, id: `${Date.now()}-${Math.random()}` }, ...prev].slice(0, 50)
    );
  }

  async function getFreshAccessToken() {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      throw new Error(error.message || "Could not check the current login session.");
    }

    let activeSession = data?.session || session;

    if (!activeSession?.access_token) {
      throw new Error("Your login session is missing. Please sign in again.");
    }

    const expiresAtMs = activeSession?.expires_at ? activeSession.expires_at * 1000 : 0;
    const shouldRefresh = expiresAtMs && expiresAtMs - Date.now() < SESSION_REFRESH_BUFFER_MS;

    if (shouldRefresh) {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();

      if (refreshError || !refreshData?.session?.access_token) {
        throw new Error("Your login session expired during the audit. Please sign in again before continuing.");
      }

      activeSession = refreshData.session;
      setSession(activeSession);
      addLog("Session refreshed before the next batch.", "notice");
    } else {
      setSession(activeSession);
    }

    return activeSession.access_token;
  }

  function resetRunStateForInputChange() {
    setFetchData(null);
    setFetchError("");
    setFetchSuccess("");
    setRunData(null);
    setRunError("");
    setRunSuccess("");
    setShowAllResults(false);
    setDuplicateWarningOpen(false);
    setDuplicateSummary(null);
    setDuplicateDecisionLoading(false);
    setPendingDuplicateConversations([]);
    setOperationStatus("idle");
    setAuditProgress({
      handled: 0,
      total: 0,
      batchIndex: 0,
      totalBatches: 0,
      percent: 0,
      savedRows: 0,
      skippedRows: 0,
      failedRows: 0,
      label: "Ready",
      detail: "Audit has not started.",
    });
  }

  function openPicker(inputRef) {
    const el = inputRef.current;
    if (!el) return;

    if (typeof el.showPicker === "function") {
      el.showPicker();
      return;
    }

    el.focus();
    el.click();
  }

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
    resetRunStateForInputChange();
    setShowPresetMenu(false);
  }

  async function loadProfile(user) {
    const email = user?.email?.toLowerCase() || "";
    const domain = email.split("@")[1] || "";

    if (!user) return { profile: null, message: "" };

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

      if (data) return { profile: data, message: "" };
      if (fallbackProfile) return { profile: fallbackProfile, message: "" };

      return {
        profile: null,
        message: "Signed in, but no profile record is available yet.",
      };
    } catch (_error) {
      if (fallbackProfile) return { profile: fallbackProfile, message: "" };
      return { profile: null, message: "Signed in, but profile loading failed." };
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
          setAuthMessage("");
          setAuthLoading(false);
          return;
        }

        const result = await loadProfile(currentSession.user);

        if (!active) return;

        setProfile(result.profile);
        setAuthMessage(result.message);
        setAuthLoading(false);
      } catch (_error) {
        if (!active) return;
        setAuthMessage("Could not complete session check.");
        setAuthLoading(false);
      }
    }

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!active) return;

      setSession(newSession ?? null);

      if (!newSession?.user) {
        setProfile(null);
        setAuthMessage("");
        setAuthLoading(false);
        return;
      }

      loadProfile(newSession.user)
        .then((result) => {
          if (!active) return;
          setProfile(result.profile);
          setAuthMessage(result.message);
          setAuthLoading(false);
        })
        .catch(() => {
          if (!active) return;
          setAuthMessage("Could not complete profile check.");
          setAuthLoading(false);
        });
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!fetchLoading) return undefined;

    const interval = setInterval(() => {
      setFetchStepIndex((prev) => (prev >= FETCH_STEPS.length - 1 ? prev : prev + 1));
    }, 1300);

    return () => clearInterval(interval);
  }, [fetchLoading]);

  useEffect(() => {
    if (!fetchLoading && !runLoading) return undefined;

    const interval = setInterval(() => {
      setElapsedTick((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [fetchLoading, runLoading]);

  useEffect(() => {
    function handleScroll() {
      setShowJumpTop(window.scrollY > 700);
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
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

  useEffect(() => {
    return () => {
      if (fetchAbortRef.current) fetchAbortRef.current.abort();
      if (runAbortRef.current) runAbortRef.current.abort();
    };
  }, []);

  async function handleGoogleLogin() {
    setAuthMessage("");

    const redirectTo =
      typeof window !== "undefined" ? `${window.location.origin}/run` : undefined;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) setAuthMessage(error.message || "Google sign-in failed.");
  }

  async function handleLogout() {
    if (fetchAbortRef.current) fetchAbortRef.current.abort();
    if (runAbortRef.current) runAbortRef.current.abort();

    await supabase.auth.signOut();

    setSession(null);
    setProfile(null);
    setAuthMessage("");
    setAuthLoading(false);
    setFetchData(null);
    setRunData(null);
    setFetchError("");
    setFetchSuccess("");
    setRunError("");
    setRunSuccess("");
    setDuplicateWarningOpen(false);
    setDuplicateSummary(null);
    setDuplicateDecisionLoading(false);
    setPendingDuplicateConversations([]);
    setOperationStatus("idle");
    addLog("Signed out.", "neutral");
  }

  function handleCancelFetch() {
    cancelRequestedRef.current = true;

    if (fetchAbortRef.current) fetchAbortRef.current.abort();

    setFetchLoading(false);
    setFetchError("Fetch cancelled.");
    setOperationStatus("cancelled");
    addLog("Fetch cancelled by user.", "warning");
  }

  function handleCancelAudit() {
    cancelRequestedRef.current = true;

    if (runAbortRef.current) runAbortRef.current.abort();

    setRunLoading(false);
    setDuplicateDecisionLoading(false);
    setDuplicateWarningOpen(false);
    setRunError(
      "Audit cancelled. Already completed batches may still be saved in Results."
    );
    setOperationStatus("cancelled");
    addLog("Audit cancelled. Check Results before rerunning the same batch.", "warning");
  }

  function getQueuedConversations(conversations) {
    const list = Array.isArray(conversations) ? conversations : [];

    if (!limiterEnabled) return list;

    const parsedLimit = Number(limitCount);
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1) return list;

    return list.slice(0, parsedLimit);
  }

  async function checkDuplicates(conversations) {
    const accessToken = await getFreshAccessToken();
    const controller = new AbortController();
    runAbortRef.current = controller;

    const response = await fetch("/api/audits/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        conversations,
        limiterEnabled: false,
        limitCount: null,
        startDate,
        endDate,
        duplicateMode: "",
        checkOnly: true,
        batchMode: false,
      }),
      signal: controller.signal,
    });

    const data = await readJsonSafely(response);

    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || "Duplicate check failed.");
    }

    return data;
  }

  async function runSingleBatch({
    batch,
    batchIndex,
    totalBatches,
    totalCount,
    duplicateMode,
  }) {
    const accessToken = await getFreshAccessToken();
    const controller = new AbortController();
    runAbortRef.current = controller;

    const response = await fetch("/api/audits/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        conversations: batch,
        limiterEnabled: false,
        limitCount: null,
        startDate,
        endDate,
        duplicateMode,
        batchMode: true,
        batchIndex,
        totalBatches,
        batchSize: batch.length,
        totalCount,
        batchLabel: `Batch ${batchIndex} of ${totalBatches}`,
      }),
      signal: controller.signal,
    });

    const data = await readJsonSafely(response);

    if (response.status === 409 && data?.requiresDuplicateDecision) {
      throw new Error(
        "A duplicate appeared during a batch after the duplicate check. Please retry with Skip Existing or Overwrite Existing."
      );
    }

    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || `Batch ${batchIndex} failed.`);
    }

    return data;
  }

  function buildPartialRunData({
    queuedConversations,
    batches,
    allResults,
    storedRunIds,
    modeToUse,
    totalSkipped,
    totalOverwritten,
    totalMapped,
    totalUnmapped,
    handled,
    failedCount,
    partialReason,
  }) {
    const safeBatches = Array.isArray(batches) ? batches : [];

    return {
      ok: false,
      partial: true,
      message: "Partial batch audit saved before the run stopped.",
      meta: {
        requestedBy: session?.user?.email || "",
        receivedCount: queuedConversations.length,
        handledCount: handled,
        auditedCount: allResults.length,
        successCount: allResults.filter((item) => !item?.error).length,
        errorCount: allResults.filter((item) => item?.error).length + failedCount,
        duplicateModeApplied: modeToUse || "none",
        skippedCount: totalSkipped,
        overwrittenCount: totalOverwritten,
        mappedCount: totalMapped,
        unmappedCount: totalUnmapped,
        auditMode: "live_gpt_batch_client_partial",
        storageStatus: "partial_save_to_supabase",
        storedRunIds,
        batchSize: AUDIT_BATCH_SIZE,
        totalBatches: safeBatches.length,
        partialReason,
      },
      results: allResults,
    };
  }

  async function startBatchAudit({
    conversationsOverride = null,
    duplicateMode = "",
    autoTriggered = false,
  } = {}) {
    setRunError("");
    setRunSuccess("");
    setRunData(null);
    setShowAllResults(false);
    setDuplicateWarningOpen(false);
    setDuplicateSummary(null);
    setDuplicateDecisionLoading(false);

    const sourceConversations = Array.isArray(conversationsOverride)
      ? conversationsOverride
      : fetchedConversations;

    const queuedConversations = getQueuedConversations(sourceConversations);

    if (!queuedConversations.length) {
      setRunError("Please fetch conversations first.");
      return;
    }

    if (!session?.access_token) {
      setRunError("Your login session is missing. Please sign in again.");
      return;
    }

    cancelRequestedRef.current = false;
    setRunLoading(true);
    setRunStartedAt(Date.now());
    setOperationStatus("auditing");

    setAuditProgress({
      handled: 0,
      total: queuedConversations.length,
      batchIndex: 0,
      totalBatches: 0,
      percent: 3,
      savedRows: 0,
      skippedRows: 0,
      failedRows: 0,
      label: "Checking Duplicates",
      detail: "Checking stored Results before starting the batch audit.",
    });

    addLog(
      `Audit started for ${formatNumber(queuedConversations.length)} conversation(s). Mode: ${
        duplicateMode || "duplicate check"
      }.`,
      "info"
    );

    let modeToUse = duplicateMode;
    let batches = [];
    const allResults = [];
    const storedRunIds = [];

    let handled = 0;
    let totalSkipped = 0;
    let totalOverwritten = 0;
    let totalMapped = 0;
    let totalUnmapped = 0;
    let totalFailedRows = 0;

    try {
      if (!modeToUse) {
        const duplicateCheck = await checkDuplicates(queuedConversations);
        const duplicateCount = Number(duplicateCheck?.duplicateSummary?.duplicateCount || 0);

        if (duplicateCount > 0) {
          if (autoTriggered) {
            modeToUse =
              duplicateCount < AUTO_DUPLICATE_OVERWRITE_LIMIT
                ? "overwrite_existing"
                : "skip_existing";

            addLog(
              `${formatNumber(duplicateCount)} duplicate(s) found. Auto-${
                modeToUse === "overwrite_existing" ? "overwrite" : "skip"
              } applied.`,
              modeToUse === "overwrite_existing" ? "warning" : "notice"
            );
          } else {
            setPendingDuplicateConversations(queuedConversations);
            setDuplicateSummary(duplicateCheck.duplicateSummary || null);
            setDuplicateWarningOpen(true);
            setRunLoading(false);
            setOperationStatus("paused");
            setRunError("Audit paused. Duplicate decision required.");
            addLog(`${formatNumber(duplicateCount)} duplicate conversation(s) need a decision.`, "warning");
            return;
          }
        }
      }

      batches = splitIntoBatches(queuedConversations, AUDIT_BATCH_SIZE);

      setAuditProgress({
        handled: 0,
        total: queuedConversations.length,
        batchIndex: 1,
        totalBatches: batches.length,
        percent: 5,
        savedRows: 0,
        skippedRows: 0,
        failedRows: 0,
        label: "Starting Batch Audit",
        detail: `${formatNumber(batches.length)} batch(es) created. ${formatNumber(AUDIT_BATCH_SIZE)} conversation(s) per batch.`,
      });

      for (let index = 0; index < batches.length; index += 1) {
        if (cancelRequestedRef.current) {
          throw new Error("Audit cancelled by user.");
        }

        const batchNumber = index + 1;
        const batch = batches[index];

        setAuditProgress({
          handled,
          total: queuedConversations.length,
          batchIndex: batchNumber,
          totalBatches: batches.length,
          percent: Math.max(6, Math.round((handled / queuedConversations.length) * 100)),
          savedRows: allResults.length,
          skippedRows: totalSkipped,
          failedRows: totalFailedRows,
          label: `Running Batch ${batchNumber} of ${batches.length}`,
          detail: `Auditing ${formatNumber(batch.length)} conversation(s) in this batch.`,
        });

        addLog(`Batch ${batchNumber}/${batches.length} started with ${formatNumber(batch.length)} conversation(s).`, "info");

        const batchData = await runSingleBatch({
          batch,
          batchIndex: batchNumber,
          totalBatches: batches.length,
          totalCount: queuedConversations.length,
          duplicateMode: modeToUse,
        });

        const batchResults = Array.isArray(batchData?.results) ? batchData.results : [];
        allResults.push(...batchResults);

        if (batchData?.meta?.storedRunId) storedRunIds.push(batchData.meta.storedRunId);

        const skippedThisBatch = Number(batchData?.meta?.skippedCount || 0);
        const overwrittenThisBatch = Number(batchData?.meta?.overwrittenCount || 0);
        const mappedThisBatch = Number(batchData?.meta?.mappedCount || 0);
        const unmappedThisBatch = Number(batchData?.meta?.unmappedCount || 0);
        const batchErrorRows = batchResults.filter((item) => item?.error).length;

        totalSkipped += skippedThisBatch;
        totalOverwritten += overwrittenThisBatch;
        totalMapped += mappedThisBatch;
        totalUnmapped += unmappedThisBatch;
        totalFailedRows += batchErrorRows;

        handled += batch.length;

        setAuditProgress({
          handled: Math.min(handled, queuedConversations.length),
          total: queuedConversations.length,
          batchIndex: batchNumber,
          totalBatches: batches.length,
          percent: Math.min(100, Math.round((handled / queuedConversations.length) * 100)),
          savedRows: allResults.length,
          skippedRows: totalSkipped,
          failedRows: totalFailedRows,
          label: `Batch ${batchNumber} Saved`,
          detail: `${formatNumber(handled)} of ${formatNumber(queuedConversations.length)} conversation(s) handled. ${formatNumber(allResults.length)} result row(s) returned.`,
        });

        const skippedText = skippedThisBatch ? ` ${formatNumber(skippedThisBatch)} skipped.` : "";

        addLog(
          `Batch ${batchNumber}/${batches.length} saved. Handled ${formatNumber(handled)}/${formatNumber(queuedConversations.length)}.${skippedText}`,
          "success"
        );
      }

      const finalData = {
        ok: true,
        message: "Batch audit completed successfully.",
        meta: {
          requestedBy: session?.user?.email || "",
          receivedCount: queuedConversations.length,
          handledCount: handled,
          auditedCount: allResults.length,
          successCount: allResults.filter((item) => !item?.error).length,
          errorCount: allResults.filter((item) => item?.error).length,
          duplicateModeApplied: modeToUse || "none",
          skippedCount: totalSkipped,
          overwrittenCount: totalOverwritten,
          mappedCount: totalMapped,
          unmappedCount: totalUnmapped,
          auditMode: "live_gpt_batch_client",
          storageStatus: "saved_to_supabase_in_batches",
          storedRunIds,
          batchSize: AUDIT_BATCH_SIZE,
          totalBatches: batches.length,
        },
        results: allResults,
      };

      setRunData(finalData);
      setRunSuccess(
        `Audit completed in ${formatNumber(batches.length)} batch(es). ${formatNumber(allResults.length)} result row(s) returned. ${formatNumber(totalSkipped)} skipped.`
      );
      setOperationStatus("completed");
      setAuditProgress({
        handled: queuedConversations.length,
        total: queuedConversations.length,
        batchIndex: batches.length,
        totalBatches: batches.length,
        percent: 100,
        savedRows: allResults.length,
        skippedRows: totalSkipped,
        failedRows: finalData.meta.errorCount,
        label: "Audit Completed",
        detail: "All batches finished. Completed batch results were saved to Results.",
      });

      addLog("Batch audit completed successfully.", "success");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Audit run failed.";

      if (allResults.length || handled > 0) {
        const partialData = buildPartialRunData({
          queuedConversations,
          batches,
          allResults,
          storedRunIds,
          modeToUse,
          totalSkipped,
          totalOverwritten,
          totalMapped,
          totalUnmapped,
          handled,
          failedCount: totalFailedRows,
          partialReason: message,
        });

        setRunData(partialData);
        setRunSuccess(
          `Partial save available: ${formatNumber(allResults.length)} result row(s) returned before the run stopped.`
        );
      }

      if (error?.name === "AbortError") {
        setRunError("Audit cancelled. Completed batches may already be saved in Results.");
        setOperationStatus("cancelled");
        addLog("Audit request was aborted.", "warning");
      } else {
        setRunError(message);
        setOperationStatus(message.toLowerCase().includes("cancelled") ? "cancelled" : "failed");
        addLog(message, "danger");
      }

      setAuditProgress((prev) => ({
        ...prev,
        handled,
        total: queuedConversations.length,
        savedRows: allResults.length,
        skippedRows: totalSkipped,
        failedRows: totalFailedRows,
        label: message.toLowerCase().includes("cancelled") ? "Audit Cancelled" : "Audit Stopped",
        detail:
          allResults.length || handled
            ? `Stopped after handling ${formatNumber(handled)} of ${formatNumber(queuedConversations.length)} conversation(s). Completed batch results may already be saved.`
            : message,
      }));
    } finally {
      setRunLoading(false);
      setDuplicateDecisionLoading(false);
      runAbortRef.current = null;
    }
  }

  async function handleFetchConversations() {
    setFetchError("");
    setFetchSuccess("");
    setFetchData(null);
    setRunData(null);
    setRunError("");
    setRunSuccess("");
    setShowAllResults(false);
    setDuplicateWarningOpen(false);
    setDuplicateSummary(null);
    setDuplicateDecisionLoading(false);
    setPendingDuplicateConversations([]);

    if (!startDate || !endDate) {
      setFetchError("Please choose both a start date and an end date.");
      return;
    }

    if (limiterEnabled) {
      const parsedLimit = Number(limitCount);
      if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
        setFetchError("Please enter a valid limiter number greater than 0.");
        return;
      }
    }

    let accessToken = "";

    try {
      accessToken = await getFreshAccessToken();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Your login session is missing. Please sign in again.";
      setFetchError(message);
      setAuthMessage(message);
      addLog(message, "danger");
      return;
    }

    const controller = new AbortController();
    fetchAbortRef.current = controller;
    cancelRequestedRef.current = false;

    setFetchLoading(true);
    setFetchStartedAt(Date.now());
    setFetchStepIndex(0);
    setOperationStatus("fetching");

    addLog(`Fetch started for ${startDate} to ${endDate}.`, "info");

    try {
      const response = await fetch("/api/audits/fetch-conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          startDate,
          endDate,
          limiterEnabled,
          limitCount,
          debug: true,
        }),
        signal: controller.signal,
      });

      const data = await readJsonSafely(response);

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Conversation fetch failed.");
      }

      setFetchData(data);
      setFetchStepIndex(FETCH_STEPS.length - 1);

      const fetchedCount = Number(data?.meta?.fetchedCount || 0);

      if (fetchedCount > 0) {
        setFetchSuccess(`${formatNumber(fetchedCount)} low-CSAT conversation(s) fetched.`);
        setOperationStatus("fetched");
        addLog(`${formatNumber(fetchedCount)} conversation(s) fetched.`, "success");
      } else {
        setFetchSuccess(data?.message || "Fetch completed with no conversations found.");
        setOperationStatus("completed");
        addLog("Fetch completed with no conversations found.", "neutral");
      }

      setFetchLoading(false);
      fetchAbortRef.current = null;

      if (autoRunAfterFetch && fetchedCount > 0) {
        addLog("Auto-run enabled. Starting batch audit automatically.", "success");
        await startBatchAudit({
          conversationsOverride: Array.isArray(data?.conversations) ? data.conversations : [],
          duplicateMode: "",
          autoTriggered: true,
        });
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        setFetchError("Fetch cancelled.");
        addLog("Fetch request was aborted.", "warning");
        setOperationStatus("cancelled");
      } else {
        const message = error instanceof Error ? error.message : "Conversation fetch failed.";
        setFetchError(message);
        addLog(message, "danger");
        setOperationStatus("failed");
      }
    } finally {
      setFetchLoading(false);
      fetchAbortRef.current = null;
    }
  }

  async function handleRunAudit() {
    await startBatchAudit({ duplicateMode: "", autoTriggered: false });
  }

  async function handleDuplicateSkip() {
    if (duplicateDecisionLoading) return;

    setDuplicateDecisionLoading(true);
    setDuplicateWarningOpen(false);
    setRunError("");
    addLog("Manual duplicate choice: skip existing.", "notice");

    await startBatchAudit({
      conversationsOverride: pendingDuplicateConversations,
      duplicateMode: "skip_existing",
      autoTriggered: false,
    });
  }

  async function handleDuplicateOverwrite() {
    if (duplicateDecisionLoading) return;

    setDuplicateDecisionLoading(true);
    setDuplicateWarningOpen(false);
    setRunError("");
    addLog("Manual duplicate choice: overwrite existing.", "warning");

    await startBatchAudit({
      conversationsOverride: pendingDuplicateConversations,
      duplicateMode: "overwrite_existing",
      autoTriggered: false,
    });
  }

  function handleDuplicateCancel() {
    setDuplicateWarningOpen(false);
    setDuplicateSummary(null);
    setDuplicateDecisionLoading(false);
    setRunError("Audit paused. Duplicate conversations need your decision.");
    setOperationStatus("paused");
    addLog("Duplicate decision modal cancelled.", "warning");
  }

  const summaryText = useMemo(() => {
    if (authLoading) return "Checking access.";
    if (!session?.user) return "Sign in to continue.";
    if (profile && !canRunTests) return "This account does not have test-run access.";
    if (fetchLoading) return FETCH_STEPS[fetchStepIndex] || "Fetching.";
    if (runLoading) return auditProgress.detail;
    if (operationStatus === "cancelled") return "Current operation was cancelled.";
    if (operationStatus === "paused") return "Audit is paused and needs your decision.";
    if (operationStatus === "failed") return "The last operation failed.";
    if (runData?.partial) {
      return `Partial run: ${formatNumber(runData.meta?.auditedCount || 0)} result row(s) returned before the run stopped.`;
    }
    if (runData?.meta?.auditedCount >= 0) {
      return `Latest audit processed ${formatNumber(runData.meta.auditedCount)} result row(s).`;
    }
    if (fetchData?.meta?.fetchedCount > 0) {
      return `${formatNumber(fetchData.meta.fetchedCount)} conversation(s) are ready for audit.`;
    }
    if (startDate && endDate) {
      return limiterEnabled
        ? `Ready to fetch ${formatNumber(limitCount || 0)} conversation(s) from ${startDate} to ${endDate}.`
        : `Ready to fetch all eligible conversations from ${startDate} to ${endDate}.`;
    }
    return "Choose a date range to start.";
  }, [
    authLoading,
    session,
    profile,
    canRunTests,
    fetchLoading,
    runLoading,
    operationStatus,
    auditProgress,
    runData,
    fetchData,
    startDate,
    endDate,
    limiterEnabled,
    limitCount,
    fetchStepIndex,
  ]);

  const statCards = [
    {
      label: "Fetch",
      value: fetchData?.meta?.fetchedCount ? formatNumber(fetchData.meta.fetchedCount) : "Ready",
      subtext: "Conversation queue",
      tone: fetchData?.meta?.fetchedCount ? "success" : "neutral",
    },
    {
      label: "Audit",
      value: runData?.meta?.auditedCount ? formatNumber(runData.meta.auditedCount) : "Pending",
      subtext: runData?.partial ? "Partial result rows" : "Processed result rows",
      tone: runData?.partial ? "warning" : runData?.meta?.auditedCount ? "success" : "neutral",
    },
    {
      label: "Auto-run",
      value: autoRunAfterFetch ? "On" : "Off",
      subtext: autoRunAfterFetch ? "Starts after fetch" : "Manual start",
      tone: autoRunAfterFetch ? "success" : "neutral",
    },
    {
      label: "Batch Size",
      value: String(AUDIT_BATCH_SIZE),
      subtext: "Conversations per request",
      tone: "notice",
    },
  ];

  return (
    <main className="run-page">
      <style>{runStyles}</style>

      <DuplicateWarningModal
        open={duplicateWarningOpen}
        duplicateSummary={duplicateSummary}
        processing={duplicateDecisionLoading}
        onCancel={handleDuplicateCancel}
        onSkip={handleDuplicateSkip}
        onOverwrite={handleDuplicateOverwrite}
      />

      <nav className="topbar">
        <div>
          <p className="eyebrow">NEXT Ventures</p>
          <strong>Review Approach & Client Sentiment Tracking</strong>
        </div>

        <span className={`live-pill ${isBusy ? "busy" : "ready"}`}>
          {fetchLoading ? "Fetching" : runLoading ? "Batch Auditing" : duplicateWarningOpen ? "Paused" : "Run Audit"}
        </span>
      </nav>

      <section className="hero">
        <div>
          <div className="hero-badge">Run Audit</div>
          <h1>Audit Control</h1>
          <p>Fetch low-CSAT conversations, run GPT audits in batches, and save results.</p>
        </div>

        <div className="hero-panel">
          <span>Current State</span>
          <strong>{summaryText}</strong>
        </div>
      </section>

      <section className="stats-grid">
        {statCards.map((card) => (
          <article key={card.label} className={`stat-card ${card.tone}`}>
            <p>{card.label}</p>
            <strong>{card.value}</strong>
            <span>{card.subtext}</span>
          </article>
        ))}
      </section>

      <section className="main-grid">
        <div className="panel control-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Controls</p>
              <h2>Setup</h2>
            </div>
            <button
              type="button"
              className={autoRunAfterFetch ? "toggle-chip on" : "toggle-chip"}
              onClick={() => {
                setAutoRunAfterFetch((prev) => !prev);
                addLog(`Auto-run ${!autoRunAfterFetch ? "enabled" : "disabled"}.`, !autoRunAfterFetch ? "success" : "neutral");
              }}
            >
              <span />
              {autoRunAfterFetch ? "Auto-run enabled" : "Auto-run after fetch"}
            </button>
          </div>

          <div className="auth-card">
            <span>Login</span>
            {authLoading ? (
              <strong>Checking session...</strong>
            ) : session?.user ? (
              <>
                <strong>{session.user.email}</strong>
                <small>Role: {profile?.role || "viewer"} | Can run tests: {canRunTests ? "Yes" : "No"}</small>
              </>
            ) : (
              <strong>Not signed in</strong>
            )}
            {authMessage ? <em>{authMessage}</em> : null}
          </div>

          <div ref={presetMenuRef} className="preset-box">
            <label>Date Range Preset</label>
            <button type="button" className="preset-button" onClick={() => setShowPresetMenu((prev) => !prev)}>
              <span><CalendarIcon /> {selectedPresetLabel}</span>
              <small>{startDate && endDate ? `${startDate} - ${endDate}` : "Select range"}</small>
              <b>{showPresetMenu ? "▲" : "▼"}</b>
            </button>

            {showPresetMenu ? (
              <div className="preset-menu">
                {DATE_PRESET_OPTIONS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={item.key === selectedDatePreset ? "active" : ""}
                    onClick={() => applyDatePreset(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="form-grid two">
            <label>
              <span>Start Date</span>
              <div className="date-control">
                <input
                  ref={startDateRef}
                  type="date"
                  value={startDate}
                  onChange={(event) => {
                    setStartDate(event.target.value);
                    setSelectedDatePreset("custom");
                    resetRunStateForInputChange();
                  }}
                  onFocus={() => openPicker(startDateRef)}
                />
                <button type="button" className="icon-btn" onClick={() => openPicker(startDateRef)}>
                  <CalendarIcon />
                </button>
              </div>
            </label>

            <label>
              <span>End Date</span>
              <div className="date-control">
                <input
                  ref={endDateRef}
                  type="date"
                  value={endDate}
                  onChange={(event) => {
                    setEndDate(event.target.value);
                    setSelectedDatePreset("custom");
                    resetRunStateForInputChange();
                  }}
                  onFocus={() => openPicker(endDateRef)}
                />
                <button type="button" className="icon-btn" onClick={() => openPicker(endDateRef)}>
                  <CalendarIcon />
                </button>
              </div>
            </label>
          </div>

          <div className="limiter-card">
            <div>
              <span>Limiter</span>
              <strong>{limiterEnabled ? "On" : "Off"}</strong>
            </div>

            <button
              type="button"
              className={limiterEnabled ? "switch on" : "switch"}
              onClick={() => {
                setLimiterEnabled((prev) => !prev);
                resetRunStateForInputChange();
              }}
            >
              <span />
            </button>
          </div>

          {limiterEnabled ? (
            <label>
              <span>Conversation Limit</span>
              <input
                type="number"
                min="1"
                step="1"
                value={limitCount}
                onChange={(event) => {
                  setLimitCount(event.target.value);
                  resetRunStateForInputChange();
                }}
                placeholder="Enter number"
              />
            </label>
          ) : null}

          <div className="button-row">
            {!session?.user ? (
              <button type="button" className="primary-btn" onClick={handleGoogleLogin}>
                Sign in with Google
              </button>
            ) : (
              <button type="button" className="secondary-btn" onClick={handleLogout} disabled={isBusy}>
                Sign out
              </button>
            )}

            {!fetchLoading ? (
              <button
                type="button"
                className="primary-btn"
                onClick={handleFetchConversations}
                disabled={!canRunTests || !session?.user || !startDate || !endDate || runLoading}
              >
                Fetch Conversations
              </button>
            ) : (
              <button type="button" className="danger-btn" onClick={handleCancelFetch}>
                Cancel Fetch
              </button>
            )}

            {fetchedConversations.length > 0 && !runLoading ? (
              <button type="button" className="secondary-btn" onClick={handleRunAudit} disabled={fetchLoading}>
                Run Audit
              </button>
            ) : null}

            {runLoading ? (
              <button type="button" className="danger-btn" onClick={handleCancelAudit}>
                Cancel Audit
              </button>
            ) : null}
          </div>

          {(fetchError || fetchSuccess || runError || runSuccess) ? (
            <div className="message-stack">
              {fetchError ? <div className="message error">{fetchError}</div> : null}
              {fetchSuccess ? <div className="message success">{fetchSuccess}</div> : null}
              {runError ? <div className="message error">{runError}</div> : null}
              {runSuccess ? <div className="message success">{runSuccess}</div> : null}
            </div>
          ) : null}

          {fetchLoading ? (
            <ProgressPanel
              type="Fetch Progress"
              label={FETCH_STEPS[fetchStepIndex] || "Fetching"}
              detail="Fetching and hydrating eligible Intercom conversations."
              percent={Math.min(96, ((fetchStepIndex + 1) / FETCH_STEPS.length) * 100)}
              elapsed={formatElapsed(fetchStartedAt)}
              handled={0}
              total={0}
              batchIndex={0}
              totalBatches={0}
              savedRows={0}
              skippedRows={0}
              failedRows={0}
              onCancel={handleCancelFetch}
            />
          ) : null}

          {runLoading ? (
            <ProgressPanel
              type="Audit Progress"
              label={auditProgress.label}
              detail={auditProgress.detail}
              percent={auditProgress.percent}
              elapsed={formatElapsed(runStartedAt)}
              handled={auditProgress.handled}
              total={auditProgress.total}
              batchIndex={auditProgress.batchIndex}
              totalBatches={auditProgress.totalBatches}
              savedRows={auditProgress.savedRows}
              skippedRows={auditProgress.skippedRows}
              failedRows={auditProgress.failedRows}
              onCancel={handleCancelAudit}
            />
          ) : null}
        </div>

        <div className="side-stack">
          <section className="panel log-panel">
            <div className="section-head compact">
              <div>
                <p className="eyebrow">Execution Log</p>
                <h2>Activity</h2>
              </div>
              <button type="button" className="secondary-btn small" onClick={() => setExecutionLog([])}>
                Clear
              </button>
            </div>

            {executionLog.length ? (
              <div className="log-list">
                {executionLog.map((item) => (
                  <div key={item.id} className={`log-item ${item.tone}`}>
                    <span>{item.time}</span>
                    <strong>{item.message}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-box small">No activity yet.</div>
            )}
          </section>

          <section className="panel fetch-summary">
            <p className="eyebrow">Current Run</p>
            <h2>Summary</h2>
            <p>{summaryText}</p>

            {fetchData ? (
              <div className="mini-grid">
                <div>
                  <span>Fetched</span>
                  <strong>{formatNumber(fetchData?.meta?.fetchedCount || 0)}</strong>
                </div>
                <div>
                  <span>Range</span>
                  <strong>{fetchData?.meta?.startDate || "-"} to {fetchData?.meta?.endDate || "-"}</strong>
                </div>
                <div>
                  <span>Limiter</span>
                  <strong>{fetchData?.meta?.limiterEnabled ? `On (${fetchData?.meta?.limitCount})` : "Off"}</strong>
                </div>
                <div>
                  <span>Batch Size</span>
                  <strong>{AUDIT_BATCH_SIZE}</strong>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </section>

      <section className="panel preview-panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">Fetched Conversations</p>
            <h2>Preview</h2>
          </div>
          <span className="count-pill">{formatNumber(fetchedConversations.length)} found</span>
        </div>

        {!fetchData ? (
          <div className="empty-box">Fetch conversations first.</div>
        ) : fetchedConversations.length === 0 ? (
          <div className="empty-box">No conversations were returned for this range.</div>
        ) : (
          <div className="conversation-grid">
            {fetchedConversations.slice(0, 12).map((item, index) => (
              <article key={item?.conversationId || `fetched-${index}`} className="conversation-card">
                <div className="conversation-head">
                  <div>
                    <span>Conversation</span>
                    <strong>{item?.conversationId || "-"}</strong>
                  </div>
                  <span className="pill notice">Low CSAT</span>
                </div>

                <div className="conversation-details">
                  <div><span>Agent</span><strong>{item?.agentName || "Unassigned"}</strong></div>
                  <div><span>Client</span><strong>{item?.clientEmail || "-"}</strong></div>
                  <div><span>CSAT</span><strong>{item?.csatScore || "-"}</strong></div>
                  <div><span>Replied</span><strong>{formatClock(item?.repliedAt)}</strong></div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel output-panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">Audit Output</p>
            <h2>Result Cards</h2>
          </div>

          <div className="result-metrics">
            <span>{formatNumber(runData?.meta?.auditedCount || 0)} result rows</span>
            <span>{formatNumber(runData?.meta?.handledCount || 0)} handled</span>
            <span>{formatNumber(runData?.meta?.skippedCount || 0)} skipped</span>
            <span>{formatNumber(successCount)} success</span>
            <span>{formatNumber(errorCount)} errors</span>
          </div>
        </div>

        {!runData ? (
          <div className="empty-box">Audit results will appear here after Run Audit completes.</div>
        ) : (
          <>
            <div className="run-meta-card">
              <div><span>Requested By</span><strong>{runData?.meta?.requestedBy || "-"}</strong></div>
              <div><span>Duplicate Handling</span><strong>{runData?.meta?.duplicateModeApplied || "none"}</strong></div>
              <div><span>Storage</span><strong>{runData?.meta?.storageStatus || "-"}</strong></div>
              <div><span>Mapped</span><strong>{formatNumber(runData?.meta?.mappedCount || 0)}</strong></div>
              <div><span>Batches</span><strong>{formatNumber(runData?.meta?.totalBatches || 0)}</strong></div>
            </div>

            <div className="results-grid">
              {visibleResults.map((item, index) => {
                const statusLabel = getResultStatusLabel(item);
                const findings = getFindingsList(item);

                return (
                  <article key={item?.conversationId || `result-${index}`} className={item?.error ? "result-card error" : "result-card"}>
                    <div className="conversation-head">
                      <div>
                        <span>Conversation</span>
                        <strong>{item?.conversationId || "Unknown"}</strong>
                      </div>
                      <span className={`pill ${getStatusTone(statusLabel)}`}>{statusLabel}</span>
                    </div>

                    <div className="conversation-details four">
                      <div><span>Agent</span><strong>{item?.agentName || "Unassigned"}</strong></div>
                      <div><span>Client</span><strong>{item?.clientEmail || "-"}</strong></div>
                      <div><span>CSAT</span><strong>{item?.csatScore || "-"}</strong></div>
                      <div><span>Replied</span><strong>{formatClock(item?.repliedAt)}</strong></div>
                    </div>

                    <div className="verdict-box">
                      <span>{item?.error ? "Error" : "AI Verdict"}</span>
                      <p>{getResultSummary(item)}</p>
                    </div>

                    {!item?.error ? (
                      <div className="findings-box">
                        {findings.length ? findings.join(" | ") : "No additional findings."}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>

            {results.length > 8 ? (
              <div className="show-more-row">
                <button type="button" className="secondary-btn" onClick={() => setShowAllResults((prev) => !prev)}>
                  {showAllResults ? "Show Less" : `Show More (${formatNumber(results.length - visibleResults.length)} more)`}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      {fetchData ? (
        <section className="panel diagnostics-panel">
          <details>
            <summary>Fetch Diagnostics</summary>
            <div className="diagnostics-grid">
              <div><span>Intercom Per Page</span><strong>{fetchData?.debug?.intercomPerPage ?? "-"}</strong></div>
              <div><span>Max Pages / Day</span><strong>{fetchData?.debug?.maxFetchPagesPerDay ?? "-"}</strong></div>
              <div><span>Daily Summaries</span><strong>{formatNumber(dailySummary.length)}</strong></div>
            </div>
          </details>
        </section>
      ) : null}

      {showJumpTop ? (
        <button
          type="button"
          className="jump-top"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          Jump to Top
        </button>
      ) : null}
    </main>
  );
}

const runStyles = `
  .run-page {
    min-height: 100vh;
    padding: 32px 20px 64px;
    color: #f5f7ff;
    background:
      radial-gradient(circle at top left, rgba(59,130,246,0.17), transparent 24%),
      radial-gradient(circle at top right, rgba(168,85,247,0.15), transparent 22%),
      radial-gradient(circle at bottom center, rgba(6,182,212,0.08), transparent 24%),
      linear-gradient(180deg, #040714 0%, #060b1d 46%, #04060d 100%);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .topbar,
  .hero,
  .stats-grid,
  .main-grid,
  .panel {
    max-width: 1400px;
    margin-left: auto;
    margin-right: auto;
  }

  .topbar,
  .hero,
  .panel,
  .stat-card {
    border: 1px solid rgba(255,255,255,0.08);
    background: linear-gradient(180deg, rgba(15,22,43,0.9), rgba(7,10,24,0.96));
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

  .eyebrow,
  label span,
  .auth-card span,
  .conversation-head span,
  .conversation-details span,
  .run-meta-card span,
  .mini-grid span,
  .verdict-box span,
  .diagnostics-grid span {
    margin: 0 0 8px;
    color: #8ea0d6;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .live-pill,
  .hero-badge,
  .primary-btn,
  .secondary-btn,
  .danger-btn,
  .pill,
  .count-pill,
  .toggle-chip,
  .modal-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: fit-content;
    border-radius: 999px;
    text-decoration: none;
    white-space: nowrap;
  }

  .live-pill {
    min-height: 40px;
    padding: 0 14px;
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .live-pill.ready {
    color: #bbf7d0;
    border: 1px solid rgba(16,185,129,0.24);
    background: rgba(16,185,129,0.1);
  }

  .live-pill.busy {
    color: #fde68a;
    border: 1px solid rgba(245,158,11,0.24);
    background: rgba(245,158,11,0.1);
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
    width: min(420px, 100%);
    padding: 18px;
    border-radius: 22px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.04);
  }

  .hero-panel span {
    display: block;
    margin-bottom: 8px;
    color: #8ea0d6;
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  .hero-panel strong {
    color: #f5f7ff;
    font-size: 15px;
    line-height: 1.6;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
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
    background: rgba(59,130,246,0.14);
  }

  .stat-card.success::before { background: rgba(16,185,129,0.15); }
  .stat-card.warning::before { background: rgba(245,158,11,0.15); }
  .stat-card.danger::before { background: rgba(244,63,94,0.15); }
  .stat-card.notice::before { background: rgba(34,211,238,0.14); }

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
    font-size: 29px;
    letter-spacing: -0.04em;
    margin-bottom: 6px;
  }

  .stat-card span {
    color: #a9b4d0;
    font-size: 13px;
    font-weight: 800;
  }

  .main-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(340px, 0.75fr);
    gap: 18px;
    margin-bottom: 18px;
  }

  .side-stack {
    display: grid;
    gap: 18px;
    align-self: start;
  }

  .panel {
    padding: 24px;
    margin-bottom: 18px;
    border-radius: 26px;
  }

  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 14px;
    margin-bottom: 18px;
  }

  .section-head.compact {
    align-items: center;
  }

  .auth-card,
  .preset-box,
  .limiter-card,
  .progress-panel,
  .run-meta-card,
  .verdict-box,
  .findings-box,
  .empty-box {
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03);
    border-radius: 18px;
  }

  .auth-card {
    padding: 16px;
    margin-bottom: 14px;
  }

  .auth-card strong,
  .auth-card small,
  .auth-card em {
    display: block;
  }

  .auth-card strong {
    color: #f5f7ff;
    font-size: 15px;
    line-height: 1.5;
  }

  .auth-card small {
    margin-top: 6px;
    color: #a9b4d0;
    line-height: 1.5;
  }

  .auth-card em {
    margin-top: 10px;
    color: #fda4af;
    font-style: normal;
    line-height: 1.5;
  }

  .toggle-chip {
    gap: 9px;
    min-height: 40px;
    padding: 0 13px;
    color: #dbe7ff;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.04);
    font-size: 13px;
    font-weight: 900;
    cursor: pointer;
  }

  .toggle-chip span {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: #94a3b8;
  }

  .toggle-chip.on {
    color: #bbf7d0;
    border-color: rgba(16,185,129,0.24);
    background: rgba(16,185,129,0.1);
  }

  .toggle-chip.on span {
    background: #34d399;
    box-shadow: 0 0 14px rgba(52,211,153,0.8);
  }

  .preset-box {
    position: relative;
    padding: 16px;
    margin-bottom: 14px;
  }

  .preset-box label {
    display: block;
  }

  .preset-button {
    width: 100%;
    min-height: 52px;
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 10px;
    align-items: center;
    padding: 0 14px;
    color: #e7ecff;
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 16px;
    background: rgba(5,8,18,0.9);
    cursor: pointer;
  }

  .preset-button span {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    font-weight: 900;
  }

  .preset-button small,
  .preset-button b {
    color: #8ea0d6;
    font-size: 12px;
  }

  .preset-menu {
    position: absolute;
    left: 16px;
    right: 16px;
    top: calc(100% - 4px);
    z-index: 20;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 18px;
    background: rgba(7,10,24,0.98);
    box-shadow: 0 18px 50px rgba(0,0,0,0.45);
  }

  .preset-menu button {
    width: 100%;
    min-height: 44px;
    padding: 0 16px;
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

  .form-grid {
    display: grid;
    gap: 14px;
    margin-bottom: 14px;
  }

  .form-grid.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  label {
    display: block;
  }

  input,
  button,
  select {
    font: inherit;
  }

  input {
    width: 100%;
    min-height: 50px;
    box-sizing: border-box;
    color: #e7ecff;
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 16px;
    outline: none;
    background: rgba(5,8,18,0.9);
    padding: 0 14px;
    color-scheme: dark;
  }

  .date-control {
    display: grid;
    grid-template-columns: 1fr 48px;
    gap: 10px;
  }

  .icon-btn {
    min-height: 50px;
    color: #bfdbfe;
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 16px;
    background: rgba(255,255,255,0.04);
    cursor: pointer;
  }

  .limiter-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 14px;
    padding: 16px;
    margin-bottom: 14px;
  }

  .limiter-card span,
  .limiter-card strong {
    display: block;
  }

  .limiter-card strong {
    color: #f5f7ff;
    font-size: 16px;
  }

  .switch {
    position: relative;
    width: 72px;
    height: 40px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.08);
    cursor: pointer;
  }

  .switch span {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 30px;
    height: 30px;
    border-radius: 999px;
    background: #fff;
    box-shadow: 0 6px 14px rgba(0,0,0,0.35);
    transition: left 180ms ease;
  }

  .switch.on {
    border-color: rgba(96,165,250,0.45);
    background: linear-gradient(135deg, rgba(37,99,235,0.9), rgba(168,85,247,0.85));
  }

  .switch.on span {
    left: 36px;
  }

  .button-row,
  .message-stack {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 14px;
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

  .secondary-btn.small,
  .danger-btn.compact {
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

  .message {
    width: 100%;
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

  .progress-panel {
    padding: 18px;
    margin-top: 14px;
  }

  .progress-head {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
  }

  .progress-head span,
  .progress-head strong,
  .progress-head small {
    display: block;
  }

  .progress-head span {
    color: #8ea0d6;
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    margin-bottom: 8px;
  }

  .progress-head strong {
    color: #f5f7ff;
    font-size: 22px;
    letter-spacing: -0.03em;
  }

  .progress-head small {
    margin-top: 6px;
    color: #a9b4d0;
    line-height: 1.5;
  }

  .progress-percent {
    min-width: 70px;
    height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #cffafe;
    border: 1px solid rgba(34,211,238,0.22);
    border-radius: 999px;
    background: rgba(34,211,238,0.1);
    font-weight: 900;
  }

  .progress-shell {
    height: 11px;
    overflow: hidden;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.07);
    margin-bottom: 12px;
  }

  .progress-bar {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(135deg, #2563eb, #7c3aed, #db2777);
    box-shadow: 0 0 30px rgba(139,92,246,0.42);
    transition: width 420ms ease;
  }

  .progress-foot {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    color: #a9b4d0;
    font-size: 13px;
    font-weight: 800;
    margin-bottom: 12px;
  }

  .log-list {
    display: grid;
    gap: 10px;
    max-height: 460px;
    overflow: auto;
    padding-right: 4px;
  }

  .log-item {
    display: grid;
    gap: 5px;
    padding: 12px;
    border-radius: 15px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03);
  }

  .log-item span {
    color: #8ea0d6;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .log-item strong {
    color: #dbe7ff;
    font-size: 13px;
    line-height: 1.5;
  }

  .log-item.success {
    border-color: rgba(16,185,129,0.2);
    background: rgba(16,185,129,0.08);
  }

  .log-item.warning,
  .log-item.notice {
    border-color: rgba(245,158,11,0.2);
    background: rgba(245,158,11,0.08);
  }

  .log-item.danger {
    border-color: rgba(244,63,94,0.2);
    background: rgba(244,63,94,0.08);
  }

  .fetch-summary p {
    margin: 0 0 16px;
    color: #a9b4d0;
    line-height: 1.7;
  }

  .mini-grid,
  .conversation-details,
  .run-meta-card,
  .diagnostics-grid {
    display: grid;
    gap: 10px;
  }

  .mini-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .mini-grid div,
  .conversation-details div,
  .run-meta-card div,
  .diagnostics-grid div {
    padding: 12px;
    border-radius: 15px;
    background: rgba(0,0,0,0.16);
  }

  .mini-grid strong,
  .conversation-details strong,
  .run-meta-card strong,
  .diagnostics-grid strong {
    display: block;
    color: #f5f7ff;
    font-size: 13px;
    line-height: 1.45;
    word-break: break-word;
  }

  .empty-box {
    padding: 22px;
    color: #a9b4d0;
    border-style: dashed;
    line-height: 1.7;
  }

  .empty-box.small {
    padding: 16px;
  }

  .preview-panel,
  .output-panel,
  .diagnostics-panel {
    margin-bottom: 18px;
  }

  .count-pill,
  .pill {
    padding: 7px 11px;
    font-size: 12px;
    font-weight: 900;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.05);
    color: #dbe7ff;
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

  .conversation-grid,
  .results-grid {
    display: grid;
    gap: 14px;
  }

  .conversation-card,
  .result-card {
    padding: 16px;
    border-radius: 20px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03);
  }

  .result-card.error {
    border-color: rgba(244,63,94,0.18);
    background: rgba(244,63,94,0.08);
  }

  .conversation-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
    margin-bottom: 12px;
  }

  .conversation-head strong {
    display: block;
    color: #f5f7ff;
    font-size: 18px;
    letter-spacing: -0.02em;
    word-break: break-word;
  }

  .conversation-details {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .conversation-details.four {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin-bottom: 14px;
  }

  .result-metrics {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .result-metrics span {
    color: #a9b4d0;
    font-size: 13px;
    font-weight: 900;
  }

  .run-meta-card {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    padding: 14px;
    margin-bottom: 16px;
  }

  .verdict-box {
    padding: 14px;
    margin-bottom: 12px;
  }

  .verdict-box p {
    margin: 0;
    color: #dbe7ff;
    line-height: 1.7;
  }

  .findings-box {
    padding: 14px;
    color: #dbe7ff;
    line-height: 1.7;
  }

  .show-more-row {
    display: flex;
    justify-content: flex-end;
    margin-top: 14px;
  }

  .diagnostics-panel summary {
    cursor: pointer;
    color: #dbe7ff;
    font-weight: 900;
  }

  .diagnostics-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-top: 14px;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(2,6,23,0.72);
    backdrop-filter: blur(12px);
  }

  .duplicate-modal {
    width: min(760px, 100%);
    max-height: 88vh;
    overflow: auto;
    padding: 28px;
    border-radius: 28px;
    border: 1px solid rgba(255,255,255,0.08);
    background: linear-gradient(180deg, rgba(15,22,43,0.98), rgba(7,10,24,0.98));
    box-shadow: 0 24px 80px rgba(0,0,0,0.55);
  }

  .modal-badge {
    padding: 8px 12px;
    margin-bottom: 16px;
    font-size: 12px;
    font-weight: 900;
  }

  .modal-badge.warning {
    color: #fde68a;
    border: 1px solid rgba(251,191,36,0.18);
    background: rgba(245,158,11,0.12);
  }

  .duplicate-modal h2 {
    margin: 0 0 10px;
    font-size: 34px;
    letter-spacing: -0.04em;
  }

  .duplicate-modal p {
    margin: 0 0 18px;
    color: #a9b4d0;
    line-height: 1.7;
  }

  .duplicate-sample-box {
    padding: 16px;
    margin-bottom: 18px;
    border-radius: 18px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03);
  }

  .duplicate-sample-box > span {
    display: block;
    margin-bottom: 10px;
    color: #8ea0d6;
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  .duplicate-list {
    display: grid;
    gap: 8px;
    max-height: 220px;
    overflow: auto;
  }

  .duplicate-list strong {
    padding: 10px 12px;
    border-radius: 12px;
    color: #e5ebff;
    background: rgba(0,0,0,0.16);
    font-size: 14px;
  }

  .modal-actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .jump-top {
    position: fixed;
    right: 24px;
    bottom: 24px;
    z-index: 1100;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 999px;
    padding: 14px 16px;
    color: #ffffff;
    font-weight: 900;
    font-size: 14px;
    cursor: pointer;
    background: linear-gradient(135deg, rgba(37,99,235,0.92), rgba(124,58,237,0.9), rgba(219,39,119,0.88));
    box-shadow: 0 16px 36px rgba(0,0,0,0.35);
  }

  @media (max-width: 1100px) {
    .main-grid {
      grid-template-columns: 1fr;
    }

    .stats-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .run-meta-card,
    .conversation-details,
    .conversation-details.four,
    .diagnostics-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 760px) {
    .topbar,
    .hero,
    .section-head,
    .conversation-head,
    .progress-head {
      flex-direction: column;
      align-items: stretch;
    }

    .stats-grid,
    .form-grid.two,
    .mini-grid,
    .run-meta-card,
    .conversation-details,
    .conversation-details.four,
    .diagnostics-grid,
    .modal-actions {
      grid-template-columns: 1fr;
    }

    .preset-button {
      grid-template-columns: 1fr auto;
    }

    .preset-button small {
      grid-column: 1 / -1;
    }
  }
`;
