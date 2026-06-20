"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabase";
import DisputeVerdictButton, { canUserDisputeResult } from "./components/DisputeVerdictButton";

const INTERCOM_BASE_URL =
  "https://app.intercom.com/a/inbox/aphmhtyj/inbox/conversation";

const PAGE_SIZE = 1000;
const MAX_DASHBOARD_ROWS = 50000;
const DASHBOARD_CACHE_PREFIX = "cx-insights-dashboard-cache-v4";
const DASHBOARD_CACHE_TTL_MS = 0;
const DASHBOARD_WELCOME_PREFIX = "cx-insights-dashboard-welcome-seen";

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

const CRITICAL_CLIENT_SENTIMENTS = ["Very Positive", "Positive"];

const RESOLUTION_ORDER = ["Resolved", "Pending", "Unclear", "Unresolved"];

const RESULT_TYPE_OPTIONS = ["Positive", "Opportunity", "Risk", "Other"];
const MAPPING_OPTIONS = ["Mapped", "Unmapped"];

const RANGE_OPTIONS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "past_week", label: "Past Week" },
  { key: "past_30_days", label: "Past 30 Days" },
  { key: "month_to_date", label: "Month To Date" },
  { key: "past_4_weeks", label: "Past 4 Weeks" },
  { key: "past_12_weeks", label: "Past 12 Weeks" },
  { key: "year_to_date", label: "Year To Date" },
  { key: "past_6_months", label: "Past 6 Months" },
  { key: "past_12_months", label: "Past 12 Months" },
  { key: "all", label: "All Time" },
  { key: "custom", label: "Custom" },
];

const WEEKLY_METRIC_OPTIONS = [
  { key: "missed", label: "Missed Opportunities" },
  { key: "veryPositive", label: "Very Positive" },
  { key: "total", label: "Total Conversations" },
  { key: "likelyPositive", label: "Likely Positive Reviews" },
  { key: "likelyNegative", label: "Likely Negative Reviews" },
  { key: "unresolved", label: "Unresolved" },
  { key: "resolutionRate", label: "Resolution Rate" },
];

const TIMEFRAME_OPTIONS = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "yearly", label: "Yearly" },
];


function readClientCache(key) {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function writeClientCache(key, value) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch (_error) {
    // Ignore quota or serialization failures.
  }
}

function getDashboardCacheKey(email) {
  const normalized = String(email || "").trim().toLowerCase();
  return `${DASHBOARD_CACHE_PREFIX}:${normalized || "anonymous"}`;
}

function getDashboardWelcomeKey(email) {
  const normalized = String(email || "").trim().toLowerCase();
  return `${DASHBOARD_WELCOME_PREFIX}:${normalized || "anonymous"}`;
}

function hasSeenDashboardWelcome(email) {
  if (typeof window === "undefined" || !email) return true;

  try {
    return window.sessionStorage.getItem(getDashboardWelcomeKey(email)) === "true";
  } catch (_error) {
    return true;
  }
}

function markDashboardWelcomeSeen(email) {
  if (typeof window === "undefined" || !email) return;

  try {
    window.sessionStorage.setItem(getDashboardWelcomeKey(email), "true");
  } catch (_error) {
    // Ignore storage failures.
  }
}

function roleLabel(value) {
  const normalized = String(value || "viewer")
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ");

  return normalized
    .split(" ")
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ") || "Viewer";
}

function getInitials(nameOrEmail) {
  const text = String(nameOrEmail || "").trim();
  if (!text) return "NV";

  const namePart = text.includes("@") ? text.split("@")[0] : text;
  const words = namePart.split(/[\s._-]+/).filter(Boolean);

  if (!words.length) return "NV";

  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

function getSessionAvatarUrl(session, profile = null) {
  return (
    session?.user?.user_metadata?.avatar_url ||
    session?.user?.identities?.[0]?.identity_data?.avatar_url ||
    profile?.avatar_url ||
    ""
  );
}

function buildWelcomeIdentity(session, profile = null) {
  const user = session?.user || null;
  const email = normalizeEmail(profile?.email || user?.email);

  if (!user || !email) return null;

  const displayName =
    normalizeText(profile?.full_name, "") ||
    normalizeText(user?.user_metadata?.full_name, "") ||
    normalizeText(user?.user_metadata?.name, "") ||
    normalizeText(user?.identities?.[0]?.identity_data?.full_name, "") ||
    normalizeText(user?.identities?.[0]?.identity_data?.name, "") ||
    email;

  return {
    email,
    displayName,
    role: roleLabel(profile?.role || "viewer"),
    avatarUrl: getSessionAvatarUrl(session, profile),
    initials: getInitials(displayName || email),
  };
}

async function fetchWelcomeProfile(activeSession) {
  if (!activeSession?.access_token) return null;

  try {
    const response = await fetch("/api/auth/profile", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${activeSession.access_token}`,
      },
      cache: "no-store",
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.ok || !data?.profile) return null;

    return data.profile;
  } catch (_error) {
    return null;
  }
}

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

  if (filters.rangePreset === "all") return "All Time";
  if (!start && !end) return label;

  return `${formatDateShort(start)} - ${formatDateShort(end)}`;
}

function createPreviousPeriodFilters(filters) {
  const { start, end } = buildDateRange(filters || {});

  if (!start || !end) return null;

  const durationMs = end.getTime() - start.getTime() + 1;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;

  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - durationMs + 1);

  return {
    ...cloneFilters(filters, "custom", true),
    rangePreset: "custom",
    startDate: formatInputDate(previousStart),
    endDate: formatInputDate(previousEnd),
  };
}

function buildMetricTrend(currentValue, previousValue, options = {}) {
  const { type = "number", inverse = false } = options;
  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);
  const diff = current - previous;

  if (!Number.isFinite(diff)) return null;

  if (Math.abs(diff) < 0.0001) {
    return { label: "No Change", tone: "neutral" };
  }

  const isImprovement = inverse ? diff < 0 : diff > 0;
  const direction = diff > 0 ? "▲" : "▼";
  const amount =
    type === "percent"
      ? `${Math.abs(diff).toFixed(1)} pts`
      : formatNumber(Math.abs(diff));

  return {
    label: `${direction} ${amount}`,
    tone: isImprovement ? "positive" : "negative",
  };
}

function sameText(value, expected) {
  return normalizeText(value, "") === expected;
}

function isCriticalClientSentiment(row) {
  return CRITICAL_CLIENT_SENTIMENTS.some((sentiment) => sameText(row?.client_sentiment, sentiment));
}

function isCriticalMiss(row) {
  return sameText(row?.review_sentiment, "Missed Opportunity") && isCriticalClientSentiment(row);
}

function getCriticalMissRate(rows) {
  const handled = Array.isArray(rows) ? rows.length : 0;
  if (!handled) return 0;
  return (rows.filter(isCriticalMiss).length / handled) * 100;
}

function deriveResultType(reviewSentiment) {
  const value = normalizeText(reviewSentiment, "");

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
    sameText(row?.review_sentiment, "Likely Positive Review") ||
    sameText(row?.review_sentiment, "Highly Likely Positive Review")
  );
}

function isLikelyNegativeReview(row) {
  return (
    sameText(row?.review_sentiment, "Likely Negative Review") ||
    sameText(row?.review_sentiment, "Highly Likely Negative Review")
  );
}

function isMapped(row) {
  return Boolean(normalizeText(row?.employee_name, "") || normalizeKey(row?.employee_match_status) === "mapped");
}

function conversationUrl(conversationId) {
  const id = String(conversationId || "").trim();
  return id ? `${INTERCOM_BASE_URL}/${id}` : "#";
}

function normalizePreviewMessages(data) {
  return Array.isArray(data?.messages) ? data.messages : [];
}

function previewText(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const joined = value.map((item) => String(item ?? "").trim()).filter(Boolean).join(", ");
      if (joined) return joined;
      continue;
    }
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function previewTags(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const list = value.map((item) => String(item ?? "").trim()).filter(Boolean);
      if (list.length) return Array.from(new Set(list));
    }
    const text = String(value ?? "").trim();
    if (text) return [text];
  }
  return [];
}


function formatPreviewAttributeLabel(label) {
  return String(label || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function previewAttributeValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => previewAttributeValue(item))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    const direct = previewText(value.name, value.label, value.title, value.value, value.text, value.status);
    if (direct) return direct;
    return Object.entries(value)
      .map(([key, item]) => {
        const itemText = previewAttributeValue(item);
        return itemText ? `${formatPreviewAttributeLabel(key)}: ${itemText}` : "";
      })
      .filter(Boolean)
      .join(", ");
  }
  const text = String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/^(null|undefined|nan)$/i.test(text)) return "";
  if (/\.(png|jpe?g|gif|webp|mp4|mov|avi|mkv)(\?|$)/i.test(text)) return "";
  return text;
}

function isPreviewValueFilled(value) {
  const text = String(value ?? "").trim();
  return Boolean(text && text !== "-" && !/^(null|undefined|nan)$/i.test(text));
}

function previewAttributes(...values) {
  const rows = [];
  const seen = new Set();

  const pushRow = (label, value) => {
    const cleanLabel = formatPreviewAttributeLabel(label);
    const cleanValue = previewAttributeValue(value);
    if (!cleanLabel || !cleanValue) return;
    const key = `${cleanLabel.toLowerCase()}::${cleanValue.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ label: cleanLabel, value: cleanValue });
  };

  for (const value of values) {
    if (!value) continue;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (!item) return;
        if (typeof item === "object" && !Array.isArray(item)) {
          pushRow(item.label || item.name || item.key || item.title, item.value ?? item.text ?? item.content ?? item.body);
        } else {
          pushRow("Attribute", item);
        }
      });
      continue;
    }
    if (typeof value === "object") {
      Object.entries(value).forEach(([key, item]) => pushRow(key, item));
    }
  }

  return rows.slice(0, 80);
}

function buildPreviewMetadata(serverMetadata = {}, previewContext = null) {
  const context = previewContext && typeof previewContext === "object" ? previewContext : {};
  return {
    conversationId: previewText(serverMetadata.conversationId, context.conversationId, context.conversation_id, context.id),
    clientEmail: previewText(serverMetadata.clientEmail, context.clientEmail, context.client_email),
    contactName: previewText(serverMetadata.clientName, serverMetadata.contactName, context.clientName, context.client_name),
    assignedAgent: previewText(
      serverMetadata.assignedAdmin,
      context.agentName,
      context.agent_name,
      context.assignedAdmin,
      context.assigned_admin
    ),
    rating: previewText(
      serverMetadata.rating,
      context.conversationRating,
      context.conversation_rating,
      context.csatScore,
      context.csat_score,
      context.rating
    ),
    status: previewText(serverMetadata.state, context.status, context.state),
    createdAt: previewText(serverMetadata.createdAt, context.createdAt, context.created_at),
    updatedAt: previewText(serverMetadata.updatedAt, context.updatedAt, context.updated_at, context.repliedAt, context.replied_at),
    reviewApproach: previewText(context.reviewSentiment, context.review_sentiment, context.reviewApproach, context.review_approach),
    clientSentiment: previewText(context.clientSentiment, context.client_sentiment),
    resolutionStatus: previewText(context.resolutionStatus, context.resolution_status),
    aiVerdict: previewText(context.aiVerdict, context.ai_verdict, context.error),
    teamName: previewText(serverMetadata.teamName, context.teamName, context.team_name),
    inboxName: previewText(serverMetadata.inboxName, context.inboxName, context.inbox_name),
    workflowName: previewText(serverMetadata.workflowName, context.workflowName, context.workflow_name),
    subject: previewText(serverMetadata.subject, context.subject),
    tags: previewTags(serverMetadata.tags, context.tags),
    customAttributes: previewAttributes(serverMetadata.attributes, serverMetadata.customAttributes, context.attributes, context.customAttributes, context.custom_attributes),
  };
}

function isCompactPreviewEvent(message) {
  const type = String(message?.messageType || "").toLowerCase();
  const body = previewText(message?.body).toLowerCase();

  if (message?.authorType === "system") return true;

  const systemTypeHints = [
    "assignment",
    "assign",
    "workflow",
    "sla",
    "attribute",
    "tag",
    "close",
    "open",
    "snooze",
    "custom_action",
    "operator_workflow",
    "language_detection",
    "conversation_rating",
  ];

  if (systemTypeHints.some((hint) => type.includes(hint))) return true;

  return /\b(conversation\s+(sla|attribute|status|rating|tag|assigned|assignment|reopened|closed|snoozed|updated)|sla\s+target\s+missed|operator\s+workflow|default\s+assignment|custom\s+action|message\s+strategy\s+assignment|language\s+detection|fin\s+(guidance|customisation)|queue\s+position|workflow\s+event|attribute\s+updated)\b/i.test(body);
}

function compactPreviewEventText(message) {
  return previewText(message?.body, message?.messageType, "Conversation event.");
}

function ConversationPreviewModal({ conversationId, previewContext = null, profile = null, supervisorTeams = [], onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeSubmitted, setDisputeSubmitted] = useState(false);

  useEffect(() => {
    setDisputeOpen(false);
    setDisputeSubmitted(false);
  }, [conversationId]);

  useEffect(() => {
    let cancelled = false;
    let controller = null;
    let hardTimeoutId = null;

    async function loadPreview() {
      if (!conversationId) return;
      setLoading(true);
      setError("");
      setData(null);

      controller = new AbortController();
      hardTimeoutId = setTimeout(() => {
        if (cancelled) return;
        controller?.abort();
        setError("The full Intercom preview is taking too long to load. You can still review the stored AI verdict and open the conversation on Intercom.");
        setLoading(false);
      }, 58000);

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) throw new Error("Your session expired. Please refresh and sign in again.");

        const response = await fetch("/api/intercom/conversation-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify({ conversationId, resultId: previewContext?.id || previewContext?.result_id || null }),
          cache: "no-store",
          signal: controller.signal,
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Preview is not available for this conversation.");
        if (!cancelled) setData(payload);
      } catch (previewError) {
        if (!cancelled) {
          setError(previewError?.name === "AbortError" ? "The full Intercom preview is taking too long to load. You can still review the stored AI verdict and open the conversation on Intercom." : (previewError instanceof Error ? previewError.message : "Preview is not available for this conversation."));
        }
      } finally {
        if (hardTimeoutId) clearTimeout(hardTimeoutId);
        if (!cancelled) setLoading(false);
      }
    }

    loadPreview();

    return () => {
      cancelled = true;
      if (hardTimeoutId) clearTimeout(hardTimeoutId);
      controller?.abort();
    };
  }, [conversationId, previewContext?.id, previewContext?.result_id]);

  if (!conversationId) return null;
  const messages = normalizePreviewMessages(data);
  const mergedMetadata = useMemo(() => buildPreviewMetadata(data?.metadata || {}, previewContext), [data, previewContext]);
  const disputeResultContext = useMemo(() => ({
    ...(previewContext || {}),
    conversation_id: conversationId,
    agent_name: previewText(previewContext?.agent_name, mergedMetadata.assignedAgent),
    employee_name: previewText(previewContext?.employee_name, mergedMetadata.assignedAgent),
    employee_email: previewText(previewContext?.employee_email),
    team_name: previewText(previewContext?.team_name, mergedMetadata.teamName),
    review_sentiment: previewText(previewContext?.review_sentiment, mergedMetadata.reviewApproach),
    client_sentiment: previewText(previewContext?.client_sentiment, mergedMetadata.clientSentiment),
    resolution_status: previewText(previewContext?.resolution_status, mergedMetadata.resolutionStatus),
    replied_at: previewContext?.replied_at || previewContext?.created_at || mergedMetadata.updatedAt || mergedMetadata.createdAt || null,
  }), [previewContext, conversationId, mergedMetadata]);
  const auditResultCards = [
    { label: "Review Approach", value: mergedMetadata.reviewApproach || "", tone: "review" },
    { label: "Client Sentiment", value: mergedMetadata.clientSentiment || "", tone: "client" },
    { label: "Resolution", value: mergedMetadata.resolutionStatus || "", tone: "resolution" },
  ].filter((card) => isPreviewValueFilled(card.value));
  const primaryRows = [
    { label: "Assigned Agent", value: mergedMetadata.assignedAgent || "Unassigned" },
    { label: "Rating", value: mergedMetadata.rating || "-" },
    { label: "Status", value: mergedMetadata.status || "-" },
    { label: "Created", value: mergedMetadata.createdAt ? formatDateTime(mergedMetadata.createdAt) : "-" },
    { label: "Updated", value: mergedMetadata.updatedAt ? formatDateTime(mergedMetadata.updatedAt) : "-" },
  ].filter((row) => isPreviewValueFilled(row.value));
  const contextRows = [
    { label: "Contact", value: mergedMetadata.contactName || mergedMetadata.clientEmail || "" },
    { label: "Team", value: mergedMetadata.teamName || "" },
    { label: "Inbox", value: mergedMetadata.inboxName || "" },
    { label: "Workflow", value: mergedMetadata.workflowName || "" },
    { label: "Topic", value: mergedMetadata.subject || "" },
  ].filter((row) => isPreviewValueFilled(row.value));
  const attributeSections = [
    { title: "Conversation Details", subtitle: "Core Intercom fields", rows: primaryRows },
    { title: "Intercom Context", subtitle: "Routing and contact data", rows: contextRows },
    { title: "Intercom Attributes", subtitle: "Additional populated fields", rows: mergedMetadata.customAttributes || [] },
  ].filter((section) => section.rows.length);
  const tags = mergedMetadata.tags || [];
  const canDisputePreview = canUserDisputeResult(profile, supervisorTeams, disputeResultContext);

  return createPortal(
    <div className="conversation-preview-backdrop" onClick={onClose}>
      <div className="conversation-preview-modal" onClick={(event) => event.stopPropagation()}>
        <div className="conversation-preview-head">
          <div>
            <p>Conversation Preview</p>
            <h2>{conversationId}</h2>
            <span>
              {mergedMetadata.clientEmail || "Client email unavailable"} · {formatNumber(messages.length)} message(s)
            </span>
          </div>
          <div className="conversation-preview-actions">
            {canDisputePreview || disputeSubmitted ? (
              <button
                type="button"
                className={`secondary-btn dispute-action ${disputeOpen ? "active" : ""} ${disputeSubmitted ? "submitted" : ""}`}
                onClick={() => { if (!disputeSubmitted) setDisputeOpen((current) => !current); }}
                disabled={disputeSubmitted || !canDisputePreview}
                title={disputeSubmitted ? "Dispute request submitted." : "Dispute this Review Status verdict."}
              >
                {disputeSubmitted ? "Dispute Request Submitted" : disputeOpen ? "Close Dispute" : "Dispute Verdict"}
              </button>
            ) : null}
            <a href={conversationUrl(conversationId)} target="_blank" rel="noreferrer" className="secondary-btn">Open on Intercom</a>
            <button type="button" className="secondary-btn light-action" onClick={onClose}>Close</button>
          </div>
        </div>
        {loading ? (
          <div className="conversation-preview-loading">Loading the full Intercom conversation...</div>
        ) : (
          <div className="conversation-preview-loaded">
            {error ? (
              <div className="conversation-preview-error inline"><strong>Preview Not Available</strong><span>{error}</span><small>Open on Intercom to see this conversation.</small></div>
            ) : null}
            {auditResultCards.length ? (
              <div className="conversation-preview-result-strip">
                {auditResultCards.map((card) => (
                  <div key={card.label} className={`conversation-preview-result-card ${card.tone}`}>
                    <span>{card.label}</span>
                    <strong>{card.value}</strong>
                  </div>
                ))}
              </div>
            ) : null}
            <div className={`conversation-preview-body ${disputeOpen ? "has-dispute" : ""}`}>
              <aside className="conversation-preview-sidebar">
                <div className="conversation-preview-sidebar-title">
                  <span>Case Details</span>
                  <small>Compact audit and Intercom context</small>
                </div>
                {attributeSections.map((section) => (
                  <section key={section.title} className="conversation-preview-compact-section">
                    <div className="conversation-preview-section-head">
                      <span>{section.title}</span>
                      <small>{section.subtitle}</small>
                    </div>
                    <div className="conversation-preview-attribute-list">
                      {section.rows.map((row) => (
                        <div key={`${section.title}-${row.label}`} className="conversation-preview-attr-row">
                          <span>{row.label}</span>
                          <strong>{row.value}</strong>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
                {tags.length ? (
                  <section className="conversation-preview-compact-section">
                    <div className="conversation-preview-section-head">
                      <span>Tags</span>
                      <small>Labels and workflow markers</small>
                    </div>
                    <div className="conversation-preview-tags">
                      {tags.map((tag) => <i key={tag}>{tag}</i>)}
                    </div>
                  </section>
                ) : null}
              </aside>
              <section className="conversation-preview-main">
                {mergedMetadata.aiVerdict ? (
                  <div className="conversation-preview-verdict">
                    <div className="conversation-preview-verdict-head">
                      <span>AI Verdict Snapshot</span>
                      <small>From the stored audit result</small>
                    </div>
                    <pre>{mergedMetadata.aiVerdict}</pre>
                  </div>
                ) : null}
                <div className="conversation-transcript-list">
                  {messages.length ? messages.map((message) => {
                    const isEvent = isCompactPreviewEvent(message);
                    return isEvent ? (
                      <div key={message.id} className="conversation-timeline-event">
                        <span>{formatDateTime(message.createdAt)}</span>
                        <p>{compactPreviewEventText(message)}</p>
                      </div>
                    ) : (
                      <article key={message.id} className={`conversation-message ${message.authorType || "system"}`}>
                        <div className="conversation-message-top"><strong>{message.authorName || "Unknown"}</strong><span>{formatDateTime(message.createdAt)}</span></div>
                        <p>{message.body || "Open on Intercom to see this message."}</p>
                        {!message.isRenderableText ? <small>Open on Intercom to see this message.</small> : null}
                      </article>
                    );
                  }) : <div className="conversation-preview-empty">No renderable text was returned. Open on Intercom to see this conversation.</div>}
                </div>
              </section>
              {disputeOpen ? (
                <aside className="conversation-preview-dispute-panel">
                  <DisputeVerdictButton
                    result={disputeResultContext}
                    profile={profile}
                    supervisorTeams={supervisorTeams}
                    panelMode="inline"
                    hideButton
                    open={disputeOpen}
                    onOpenChange={setDisputeOpen}
                    onSubmitted={() => setDisputeSubmitted(true)}
                  />
                </aside>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function ConversationActionButtons({
  conversationId,
  previewContext = null,
  onPreview,
  onToggleVerdict = null,
  verdictVisible = false,
}) {
  const id = String(conversationId || "").trim();
  if (!id) return <span className="preview-unavailable">Preview Not Available</span>;
  return (
    <div className="conversation-action-buttons">
      <button type="button" className="mini-preview-btn" onClick={() => onPreview(id, previewContext)}>Preview Conversation</button>
      <a href={conversationUrl(id)} target="_blank" rel="noreferrer" className="mini-open-link">Open on Intercom</a>
      {typeof onToggleVerdict === "function" ? (
        <button type="button" className={`mini-verdict-btn ${verdictVisible ? "active" : ""}`} onClick={onToggleVerdict}>
          {verdictVisible ? "Hide AI Verdict" : "See AI Verdict"}
        </button>
      ) : null}
    </div>
  );
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

function parseConversationIdQuery(value) {
  return Array.from(
    new Set(
      String(value || "")
        .split(/[\s,;]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function rowConversationId(row) {
  return String(row?.conversation_id || row?.conversationId || row?.id || "").trim();
}


function matchesMulti(selected, value) {
  if (!Array.isArray(selected) || selected.length === 0) return true;

  const normalizedValue = normalizeText(value, "");
  return selected.some((item) => normalizeText(item, "") === normalizedValue);
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

    if (filters.cexOnly && normalizeText(row?.team_name, "") !== "CEx") return false;

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
  if (label === "Opportunity") return "#d8a63a";
  if (label === "Positive") return "#55bfa4";
  if (label === "Risk") return "#d9667d";
  return "#7f78d8";
}

function reviewSentimentColor(label) {
  if (label === "Highly Likely Positive Review") return "#55bfa4";
  if (label === "Likely Positive Review") return "#87ad5d";
  if (label === "Missed Opportunity") return "#d8a63a";
  if (label === "Negative Outcome - No Review Request") return "#b66fc2";
  if (label === "Likely Negative Review") return "#d77a50";
  if (label === "Highly Likely Negative Review") return "#d9667d";
  return "#7f78d8";
}

function clientSentimentColor(label) {
  if (label === "Very Positive") return "#55bfa4";
  if (label === "Positive") return "#5fb989";
  if (label === "Slightly Positive") return "#5aaaa3";
  if (label === "Neutral") return "#7f78d8";
  if (label === "Slightly Negative") return "#d8a63a";
  if (label === "Negative") return "#d77a50";
  if (label === "Very Negative") return "#d9667d";
  return "#7f78d8";
}

function resolutionStatusColor(label) {
  if (label === "Resolved") return "#55bfa4";
  if (label === "Pending") return "#d8a63a";
  if (label === "Unclear") return "#7f78d8";
  if (label === "Unresolved") return "#d9667d";
  return "#6699d8";
}

function chartColor(label, kind, index = 0) {
  const fallback = ["#55bfa4", "#87ad5d", "#6699d8", "#7f78d8", "#d8a63a", "#b66fc2", "#d9667d"];
  if (kind === "client") return clientSentimentColor(label);
  if (kind === "resolution") return resolutionStatusColor(label);
  if (kind === "review") return reviewSentimentColor(label);
  if (kind === "result") return resultTypeColor(label);
  return fallback[index % fallback.length];
}

function chartGradient(label, kind, index = 0) {
  const color = chartColor(label, kind, index);

  if (kind === "client") {
    if (["Very Positive", "Positive", "Slightly Positive"].includes(label)) return `linear-gradient(90deg, ${color}, #60bfb7)`;
    if (label === "Neutral") return `linear-gradient(90deg, ${color}, #6699d8)`;
    return `linear-gradient(90deg, ${color}, #d77a50)`;
  }

  if (kind === "resolution") {
    if (label === "Resolved") return "linear-gradient(90deg, #55bfa4, #60bfb7)";
    if (label === "Pending") return "linear-gradient(90deg, #d8a63a, #d77a50)";
    if (label === "Unclear") return "linear-gradient(90deg, #7f78d8, #b66fc2)";
    return "linear-gradient(90deg, #d9667d, #b4535f)";
  }

  if (kind === "review") {
    if (label.includes("Positive")) return `linear-gradient(90deg, ${color}, #60bfb7)`;
    if (label === "Missed Opportunity") return "linear-gradient(90deg, #d8a63a, #d77a50)";
    if (label.includes("Negative")) return `linear-gradient(90deg, ${color}, #b4535f)`;
    return `linear-gradient(90deg, ${color}, #7f78d8)`;
  }

  return `linear-gradient(90deg, ${color}, #6699d8)`;
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

function createWeeklyDefaultFilters() {
  const filters = createBaseFilters("past_4_weeks", true);
  filters.reviewSentiments = ["Missed Opportunity"];
  filters.clientSentiments = ["Very Positive", "Positive"];
  return filters;
}

function detailFiltersWith(baseFilters, overrides = {}) {
  const next = cloneFilters(baseFilters, "all", false);

  for (const [key, value] of Object.entries(overrides || {})) {
    if (Array.isArray(value)) {
      next[key] = [...value];
    } else if (value !== undefined) {
      next[key] = value;
    }
  }

  return next;
}

function detailFiltersForEmployee(baseFilters, employee, overrides = {}) {
  const cleanEmployee = previewText(employee);
  return detailFiltersWith(baseFilters, {
    employees: cleanEmployee && cleanEmployee !== "Unmapped" ? [cleanEmployee] : [],
    ...overrides,
  });
}

function detailFiltersForPeriod(baseFilters, period, employee, overrides = {}) {
  return detailFiltersForEmployee(baseFilters, employee, {
    rangePreset: "custom",
    startDate: formatInputDate(period?.start),
    endDate: formatInputDate(period?.end),
    ...overrides,
  });
}

function cloneFilters(filters, fallbackPreset = "all", fallbackCexOnly = false) {
  const source = filters || createBaseFilters(fallbackPreset, fallbackCexOnly);

  return {
    ...source,
    supervisorTeamIds: [...(source.supervisorTeamIds || [])],
    teams: [...(source.teams || [])],
    employees: [...(source.employees || [])],
    reviewSentiments: [...(source.reviewSentiments || [])],
    clientSentiments: [...(source.clientSentiments || [])],
    resolutionStatuses: [...(source.resolutionStatuses || [])],
    resultTypes: [...(source.resultTypes || [])],
    mappingStatuses: [...(source.mappingStatuses || [])],
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

function startOfWeek(date) {
  const next = startOfDay(date);
  const day = next.getDay();
  next.setDate(next.getDate() - day);
  return next;
}

function endOfMonth(date) {
  return endOfDay(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

function startOfYearPeriod(date) {
  return startOfDay(new Date(date.getFullYear(), 0, 1));
}

function endOfYearPeriod(date) {
  return endOfDay(new Date(date.getFullYear(), 11, 31));
}

function buildPeriodsForRange(rows, filters, timeframe = "weekly") {
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

  const safeTimeframe = ["daily", "weekly", "monthly", "yearly"].includes(timeframe)
    ? timeframe
    : "weekly";

  const maxDaysByTimeframe = {
    daily: 120,
    weekly: 120,
    monthly: 760,
    yearly: 3650,
  };

  const maxDays = maxDaysByTimeframe[safeTimeframe] || 120;
  const minStart = startOfDay(addDays(end, -maxDays + 1));
  if (start < minStart) start = minStart;

  const periods = [];
  let cursor = startOfDay(start);
  const finalEnd = endOfDay(end);

  while (cursor <= finalEnd) {
    let periodStart = startOfDay(cursor);
    let periodEnd = endOfDay(cursor);

    if (safeTimeframe === "weekly") {
      periodEnd = endOfDay(addDays(cursor, 6));
    }

    if (safeTimeframe === "monthly") {
      periodStart = startOfDay(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
      if (periodStart < start) periodStart = startOfDay(start);
      periodEnd = endOfMonth(cursor);
    }

    if (safeTimeframe === "yearly") {
      periodStart = startOfYearPeriod(cursor);
      if (periodStart < start) periodStart = startOfDay(start);
      periodEnd = endOfYearPeriod(cursor);
    }

    const safeEnd = periodEnd > finalEnd ? finalEnd : periodEnd;

    periods.push({
      key: `${safeTimeframe}_${formatInputDate(periodStart)}_${formatInputDate(safeEnd)}`,
      start: periodStart,
      end: safeEnd,
      label: formatPeriodLabel(periodStart, safeEnd, safeTimeframe),
    });

    if (safeTimeframe === "daily") {
      cursor = addDays(cursor, 1);
    } else if (safeTimeframe === "weekly") {
      cursor = addDays(cursor, 7);
    } else if (safeTimeframe === "monthly") {
      cursor = startOfDay(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
    } else {
      cursor = startOfDay(new Date(cursor.getFullYear() + 1, 0, 1));
    }
  }

  return periods;
}

function formatPeriodLabel(start, end, timeframe = "weekly") {
  if (!start || !end) return "-";

  if (timeframe === "daily") {
    return start.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }

  if (timeframe === "monthly") {
    return start.toLocaleDateString(undefined, {
      month: "short",
      year: "numeric",
    });
  }

  if (timeframe === "yearly") {
    return String(start.getFullYear());
  }

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
  if (metric === "missed") return rows.filter((row) => sameText(row.review_sentiment, "Missed Opportunity"));
  if (metric === "veryPositive") return rows.filter((row) => sameText(row.client_sentiment, "Very Positive"));
  if (metric === "likelyNegative") return rows.filter(isLikelyNegativeReview);
  if (metric === "unresolved") return rows.filter((row) => sameText(row.resolution_status, "Unresolved"));
  if (metric === "resolutionRate") return rows.filter((row) => sameText(row.resolution_status, "Resolved"));
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

function buildAgentWeeklyRows(rows, filters, metric, timeframe = "weekly") {
  const periods = buildPeriodsForRange(rows, filters, timeframe);
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
        dateLabel: period.label,
        rows: periodRows,
        value: metricValue(periodRows, metric),
        metricLabel: formatMetricValue(periodRows, metric),
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
      criticalMiss: 0,
      veryPositive: 0,
      likelyNegative: 0,
      unresolved: 0,
      rows: [],
    };

    current.handled += 1;

    if (isLikelyPositiveReview(row)) current.likelyPositive += 1;
    if (sameText(row?.review_sentiment, "Missed Opportunity")) current.missed += 1;
    if (isCriticalMiss(row)) current.criticalMiss += 1;
    if (sameText(row?.client_sentiment, "Very Positive")) current.veryPositive += 1;
    if (isLikelyNegativeReview(row)) current.likelyNegative += 1;
    if (sameText(row?.resolution_status, "Unresolved")) current.unresolved += 1;

    current.rows.push(row);

    map.set(employee, current);
  }

  return Array.from(map.values())
    .map((item) => ({
      ...item,
      likelyPositiveRate: item.handled ? (item.likelyPositive / item.handled) * 100 : 0,
      missedRate: item.handled ? (item.missed / item.handled) * 100 : 0,
      criticalMissRate: item.handled ? (item.criticalMiss / item.handled) * 100 : 0,
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
              <div className="multi-empty">No Matching Options.</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DateRangePicker({ filters, setFilters }) {
  const [open, setOpen] = useState(false);
  const [activeField, setActiveField] = useState("start");
  const [draftStartDate, setDraftStartDate] = useState(filters.startDate || "");
  const [draftEndDate, setDraftEndDate] = useState(filters.endDate || "");
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const base = parseInputDate(filters.startDate, false) || new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const boxRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(event.target)) setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;

    const nextStart = filters.startDate || "";
    const nextEnd = filters.endDate || "";
    setDraftStartDate(nextStart);
    setDraftEndDate(nextEnd);

    const base = parseInputDate(nextStart, false) || parseInputDate(nextEnd, false) || new Date();
    setVisibleMonth(new Date(base.getFullYear(), base.getMonth(), 1));
  }, [open, filters.startDate, filters.endDate]);

  function applyPreset(key) {
    if (key === "custom") {
      setFilters((prev) => ({ ...prev, rangePreset: "custom" }));
      setActiveField("start");
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
      startDate: draftStartDate,
      endDate: draftEndDate,
    }));
    setOpen(false);
  }

  function normalizeInputDate(value) {
    return parseInputDate(value, false);
  }

  function isSameCalendarDate(a, b) {
    if (!a || !b) return false;
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function isInsideDraftRange(date) {
    const start = normalizeInputDate(draftStartDate);
    const end = normalizeInputDate(draftEndDate);
    if (!date || !start || !end) return false;
    return date >= startOfDay(start) && date <= endOfDay(end);
  }

  function selectCalendarDate(date) {
    const value = formatInputDate(date);
    const start = normalizeInputDate(draftStartDate);

    if (activeField === "start") {
      setDraftStartDate(value);
      if (draftEndDate) {
        const currentEnd = normalizeInputDate(draftEndDate);
        if (currentEnd && date > currentEnd) setDraftEndDate(value);
      } else {
        setDraftEndDate(value);
      }
      setActiveField("end");
      return;
    }

    if (start && date < start) {
      setDraftStartDate(value);
      setDraftEndDate(formatInputDate(start));
    } else {
      setDraftEndDate(value);
    }
    setActiveField("start");
  }

  function renderCalendarMonth(monthDate) {
    const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const monthLabel = firstDay.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
    const daysInMonth = new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0).getDate();
    const leadingDays = firstDay.getDay();
    const cells = [];
    const selectedStart = normalizeInputDate(draftStartDate);
    const selectedEnd = normalizeInputDate(draftEndDate);

    for (let i = 0; i < leadingDays; i += 1) {
      cells.push(<span key={`blank-${monthLabel}-${i}`} className="calendar-day blank" />);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(firstDay.getFullYear(), firstDay.getMonth(), day);
      const isStart = isSameCalendarDate(date, selectedStart);
      const isEnd = isSameCalendarDate(date, selectedEnd);
      const inRange = isInsideDraftRange(date);

      cells.push(
        <button
          key={`${monthLabel}-${day}`}
          type="button"
          className={[
            "calendar-day",
            inRange ? "in-range" : "",
            isStart ? "range-start" : "",
            isEnd ? "range-end" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => selectCalendarDate(date)}
        >
          {day}
        </button>
      );
    }

    return (
      <div className="calendar-month" key={monthLabel}>
        <h4>{monthLabel}</h4>
        <div className="calendar-weekdays notranslate" translate="no">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <span key={day} className="notranslate" translate="no">{day}</span>
          ))}
        </div>
        <div className="calendar-grid-days">{cells}</div>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="date-picker-wrap">
      <label>
        <span>Date Range</span>
        <button type="button" className="date-picker-button" onClick={() => setOpen((prev) => !prev)}>
          <strong>{getRangeDisplay(filters)}</strong>
          <b>{open ? "Up" : "Down"}</b>
        </button>
      </label>

      {open ? (
        <div className="date-picker-popover upgraded-date-popover">
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

          <div className="premium-calendar-panel">
            <div className="calendar-panel-head">
              <div>
                <small>Custom Date Range</small>
                <strong>{draftStartDate && draftEndDate ? `${formatDateShort(parseInputDate(draftStartDate))} - ${formatDateShort(parseInputDate(draftEndDate))}` : "Choose A Date Range"}</strong>
              </div>
              <div className="range-field-tabs">
                <button
                  type="button"
                  className={activeField === "start" ? "active" : ""}
                  onClick={() => setActiveField("start")}
                >
                  <span>From</span>
                  <strong>{draftStartDate || "Start Date"}</strong>
                </button>
                <button
                  type="button"
                  className={activeField === "end" ? "active" : ""}
                  onClick={() => setActiveField("end")}
                >
                  <span>To</span>
                  <strong>{draftEndDate || "End Date"}</strong>
                </button>
              </div>
            </div>

            <div className="calendar-toolbar">
              <button type="button" onClick={() => setVisibleMonth((prev) => addMonths(prev, -1))}>
                ‹
              </button>
              <span>
                {visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })} - {addMonths(visibleMonth, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </span>
              <button type="button" onClick={() => setVisibleMonth((prev) => addMonths(prev, 1))}>
                ›
              </button>
            </div>

            <div className="calendar-months-grid">
              {renderCalendarMonth(visibleMonth)}
              {renderCalendarMonth(addMonths(visibleMonth, 1))}
            </div>

            <div className="custom-actions premium-calendar-actions">
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
          label="Supervisor Team"
          options={supervisorOptions}
          selected={filters.supervisorTeamIds}
          onChange={(value) => update("supervisorTeamIds", value)}
          placeholder="All Supervisors"
        />

        <MultiSelect
          label="Employee"
          options={employees}
          selected={filters.employees}
          onChange={(value) => update("employees", value)}
          placeholder="All Employees"
        />

        <label className="cex-check">
          <input
            type="checkbox"
            checked={filters.cexOnly}
            onChange={(event) => update("cexOnly", event.target.checked)}
          />
          CEx Only
        </label>
      </div>

      <div className="filter-row second">
        <MultiSelect
          label="Review"
          options={reviewOptions}
          selected={filters.reviewSentiments}
          onChange={(value) => update("reviewSentiments", value)}
          placeholder="All Review"
        />

        <MultiSelect
          label="Client"
          options={clientOptions}
          selected={filters.clientSentiments}
          onChange={(value) => update("clientSentiments", value)}
          placeholder="All Client"
        />

        <MultiSelect
          label="Resolution"
          options={resolutionOptions}
          selected={filters.resolutionStatuses}
          onChange={(value) => update("resolutionStatuses", value)}
          placeholder="All Resolution"
        />

        <MultiSelect
          label="Type"
          options={RESULT_TYPE_OPTIONS}
          selected={filters.resultTypes}
          onChange={(value) => update("resultTypes", value)}
          placeholder="All Types"
        />

        {showMapping ? (
          <MultiSelect
            label="Mapping"
            options={MAPPING_OPTIONS}
            selected={filters.mappingStatuses}
            onChange={(value) => update("mappingStatuses", value)}
            placeholder="All Mapping"
          />
        ) : null}

        <button type="button" className="primary-btn reset-btn" onClick={() => setFilters(resetTo())}>
          Reset Filters
        </button>
      </div>
    </div>
  );
}

function KPIStat({ label, value, accent, onClick, trend, help }) {
  return (
    <button type="button" className="kpi-card" onClick={onClick} style={{ "--accent": accent }}>
      <div className="kpi-head-row">
        <span>{label}</span>
        {help ? <InfoTip text={help} /> : null}
      </div>
      <strong>{value}</strong>
      <div className="kpi-footer">
        <small>Drill In</small>
        {trend ? <em className={`kpi-change ${trend.tone}`}>{trend.label}</em> : null}
      </div>
    </button>
  );
}

function InfoTip({ text }) {
  const [tooltipState, setTooltipState] = useState(null);

  function openTooltip(event) {
    if (typeof window === "undefined") return;

    const rect = event.currentTarget.getBoundingClientRect();
    const preferredWidth = 340;
    const sidePadding = 20;
    const centeredLeft = rect.left + rect.width / 2;
    const left = Math.min(
      Math.max(centeredLeft, preferredWidth / 2 + sidePadding),
      window.innerWidth - preferredWidth / 2 - sidePadding
    );
    const showBelow = rect.top < 140;

    setTooltipState({
      left,
      top: showBelow ? rect.bottom + 12 : rect.top - 12,
      placement: showBelow ? "below" : "above",
    });
  }

  function closeTooltip() {
    setTooltipState(null);
  }

  return (
    <>
      <span
        className="info-tip"
        tabIndex={0}
        aria-label={text}
        onMouseEnter={openTooltip}
        onMouseLeave={closeTooltip}
        onFocus={openTooltip}
        onBlur={closeTooltip}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <span className="info-tip-mark" aria-hidden="true">?</span>
      </span>

      {tooltipState && typeof document !== "undefined"
        ? createPortal(
            <span
              className={`info-tip-bubble info-tip-bubble-floating ${tooltipState.placement}`}
              style={{ left: tooltipState.left, top: tooltipState.top }}
            >
              {text}
            </span>,
            document.body
          )
        : null}
    </>
  );
}

function ChartCard({ title, subtitle, onDrill, children, larger = false, help }) {
  return (
    <article className={larger ? "chart-card large" : "chart-card"}>
      <div className="chart-head">
        <div>
          <div className="title-with-help">
            <h3>{title}</h3>
            {help ? <InfoTip text={help} /> : null}
          </div>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>

        {onDrill ? (
          <button type="button" className="drill-btn card-action" onClick={onDrill}>
            Drill In
          </button>
        ) : null}
      </div>

      {children}
    </article>
  );
}

function HorizontalBarChart({ entries, total, onSelect, kind = "review" }) {
  const [hovered, setHovered] = useState(null);
  const visibleEntries = entries.filter((entry) => entry.count > 0);
  const max = Math.max(...visibleEntries.map((item) => item.count), 1);

  if (!visibleEntries.length) {
    return <div className="empty-box">No Data For This Section.</div>;
  }

  return (
    <div className="bar-list">
      {visibleEntries.map((entry) => {
        const percent = total ? (entry.count / total) * 100 : 0;
        const width = Math.max((entry.count / max) * 100, 5);
        const color = chartGradient(entry.label, kind, 0);
        const isHovered = hovered === entry.label;

        return (
          <button
            key={entry.label}
            type="button"
            className="bar-item"
            onMouseEnter={() => setHovered(entry.label)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(entry.label)}
            onBlur={() => setHovered(null)}
            onClick={() => onSelect(entry)}
          >
            <div className="bar-line">
              <strong title={entry.label}>{entry.label}</strong>
              <span>
                {formatNumber(entry.count)} · {formatPercent(percent)}
              </span>
            </div>

            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${width}%`, background: color }} />
            </div>

            {isHovered ? (
              <span className="chart-hover-card bar-hover-card">
                <strong>{entry.label}</strong>
                <small>
                  {formatNumber(entry.count)} ({formatPercent(percent)})
                </small>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function DonutChart({ entries, total, onSelect, kind = "result" }) {
  const [hovered, setHovered] = useState(null);
  const visibleEntries = entries.filter((entry) => entry.count > 0);
  const coloredEntries = visibleEntries.map((entry, index) => ({
    ...entry,
    color: chartColor(entry.label, kind, index),
  }));
  const segments = buildPieSegments(coloredEntries, coloredEntries.map((entry) => entry.color));

  return (
    <div className="donut-layout">
      <div className="donut svg-donut">
        <svg viewBox="0 0 300 300" aria-label={`${kind} breakdown`}>
          <circle className="donut-base-ring" cx="150" cy="150" r="104" />
          {segments.map((segment) => (
            <circle
              key={segment.label}
              className="donut-segment"
              cx="150"
              cy="150"
              r="104"
              pathLength="100"
              stroke={segment.color}
              strokeDasharray={`${segment.percent} ${100 - segment.percent}`}
              strokeDashoffset={-segment.start}
              onMouseEnter={() => setHovered(segment)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(segment)}
              onBlur={() => setHovered(null)}
              onClick={() => onSelect(segment)}
              tabIndex={0}
              role="button"
              aria-label={`${segment.label}: ${formatNumber(segment.count)} (${formatPercent(segment.percent)})`}
            />
          ))}
        </svg>

        <div className="donut-hole">
          <strong>{formatNumber(total)}</strong>
          <span>Total</span>
        </div>

        {hovered ? (
          <div className="chart-hover-card donut-hover-card">
            <strong>{hovered.label}</strong>
            <small>
              {formatNumber(hovered.count)} ({formatPercent(hovered.percent)})
            </small>
          </div>
        ) : null}
      </div>

      <div className="donut-legend">
        {segments.length ? (
          segments.map((segment) => (
            <button
              key={segment.label}
              type="button"
              onMouseEnter={() => setHovered(segment)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(segment)}
              onBlur={() => setHovered(null)}
              onClick={() => onSelect(segment)}
            >
              <i style={{ background: segment.color, boxShadow: `0 0 16px ${segment.color}66` }} />
              <strong title={segment.label}>{segment.label}</strong>
              <span>
                {formatNumber(segment.count)} · {formatPercent(segment.percent)}
              </span>
            </button>
          ))
        ) : (
          <div className="empty-box compact">No Data.</div>
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
  profile,
  supervisorTeams,
  supervisorLookup,
  employees,
  reviewOptions,
  clientOptions,
  resolutionOptions,
  initialFilters,
}) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(() => cloneFilters(initialFilters, "all", false));
  const [previewConversationId, setPreviewConversationId] = useState("");
  const [previewContext, setPreviewContext] = useState(null);
  const [expandedVerdicts, setExpandedVerdicts] = useState({});
  const [activeDisputeRow, setActiveDisputeRow] = useState(null);

  useEffect(() => {
    if (!open) return;

    setQuery("");
    setPreviewConversationId("");
    setPreviewContext(null);
    setExpandedVerdicts({});
    setActiveDisputeRow(null);
    setFilters(cloneFilters(initialFilters, "all", false));
  }, [open, title, value, initialFilters]);

  function openConversationPreview(conversationId, context = null) {
    setPreviewConversationId(String(conversationId || "").trim());
    setPreviewContext(context || null);
  }

  function closeConversationPreview() {
    setPreviewConversationId("");
    setPreviewContext(null);
  }

  function toggleVerdict(key) {
    setExpandedVerdicts((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function openDisputePanel(row) {
    setActiveDisputeRow(row || null);
  }

  function closeDisputePanel() {
    setActiveDisputeRow(null);
  }

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
            <p>Drill In</p>
            <h2>{title}</h2>
            <span>{value} · {formatNumber(filteredRows.length)} of {formatNumber(rows.length)} Conversation(s)</span>
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
            resetTo={() => cloneFilters(initialFilters, "all", false)}
          />

          <label className="modal-search">
            <span>Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Conversation, Agent, Employee, Client, Verdict"
            />
          </label>
        </div>

        <div className={`modal-content-split ${activeDisputeRow ? "has-dispute-panel" : ""}`}>
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
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {filteredRows.slice(0, 500).map((row, index) => {
                const verdictKey = `${row.conversation_id}-${row.created_at}-${index}`;
                const isVerdictVisible = Boolean(expandedVerdicts[verdictKey]);
                return (
                  <Fragment key={verdictKey}>
                    <tr>
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
                        <ConversationActionButtons
                          conversationId={row.conversation_id}
                          previewContext={row}
                          onPreview={openConversationPreview}
                          onToggleVerdict={() => toggleVerdict(verdictKey)}
                          verdictVisible={isVerdictVisible}
                        />
                        <DisputeVerdictButton result={row} profile={profile} supervisorTeams={supervisorTeams} onOpenRequest={() => openDisputePanel(row)} />
                      </td>
                    </tr>
                    {isVerdictVisible ? (
                      <tr className="expanded-row">
                        <td colSpan={8}>
                          <div className={row.error ? "verdict-box error" : "verdict-box"}>
                            <div className="verdict-head">
                              <span>{row.error ? "Error Details" : "AI Verdict"}</span>
                              <small>{row.conversation_id || "Conversation"}</small>
                            </div>
                            <pre>{row.error || row.ai_verdict || "No AI verdict available."}</pre>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
            </table>

            {filteredRows.length > 500 ? (
              <div className="table-note">
                Showing First 500 Rows. Use Export CSV For The Full Filtered Drill-In.
              </div>
            ) : null}
          </div>

          {activeDisputeRow ? (
            <aside className="drill-dispute-panel">
              <DisputeVerdictButton
                result={activeDisputeRow}
                profile={profile}
                supervisorTeams={supervisorTeams}
                panelMode="inline"
                hideButton
                open={Boolean(activeDisputeRow)}
                onOpenChange={(nextOpen) => { if (!nextOpen) closeDisputePanel(); }}
              />
            </aside>
          ) : null}
        </div>

        {previewConversationId ? (
          <ConversationPreviewModal conversationId={previewConversationId} previewContext={previewContext} profile={profile} supervisorTeams={supervisorTeams} onClose={closeConversationPreview} />
        ) : null}
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
  timeframe = "weekly",
  setTimeframe = () => {},
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
    () => buildAgentWeeklyRows(weeklyRows, filters, metric, timeframe),
    [weeklyRows, filters, metric, timeframe]
  );

  const metricLabel = WEEKLY_METRIC_OPTIONS.find((item) => item.key === metric)?.label || "Metric";
  const timeframeLabel = TIMEFRAME_OPTIONS.find((item) => item.key === timeframe)?.label || "Weekly";

  return (
    <section className="panel weekly-panel">
      <div className="section-title-row">
        <div>
          <p>Performance Timeline Table</p>
          <div className="title-with-help">
            <h2>Agent Performance By Timeframe</h2>
            <InfoTip text="This table breaks the selected date range into Daily, Weekly, Monthly, or Yearly columns. Weekly is the default. The table is fixed to Missed Opportunity reviews with Very Positive and Positive client sentiment by default." />
          </div>
          <span>Click an employee or any timeframe cell to open the underlying conversations.</span>
        </div>

        <div className="weekly-controls">
          <label>
            <span className="label-with-help">
              Timeframe
              <InfoTip text="Choose how the selected date range is broken into columns. Daily shows one column per day, Weekly groups every 7 days, Monthly groups by month, and Yearly groups by year." />
            </span>
            <select value={timeframe} onChange={(event) => setTimeframe(event.target.value)}>
              {TIMEFRAME_OPTIONS.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <div className="weekly-fixed-scope">
            <span className="label-with-help">
              Focus
              <InfoTip text={`This timeframe table is intentionally fixed to Missed Opportunity reviews with Very Positive and Positive client sentiment. Use the table filters to adjust team, employee, date range, review, client, resolution, or type if needed.`} />
            </span>
            <strong>Missed Opportunity · Very Positive + Positive</strong>
          </div>

          <button type="button" className="secondary-btn" onClick={() => downloadWeeklyCsv(tableRows, periods, metric, metricLabel, timeframeLabel)}>
            Export Table CSV
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
        resetTo={() => createWeeklyDefaultFilters()}
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
                      onClick={() => onOpenDetail("Employee Drill In", employeeRow.employee, rows, detailFiltersForEmployee(filters, employeeRow.employee))}
                    >
                      {employeeRow.employee}
                    </button>
                  </td>
                  <td>{employeeRow.team || "-"}</td>
                  <td>{formatMetricValue(employeeRow.totalRows, metric)}</td>
                  {employeeRow.periods.map((period) => {
                    const drillRows = metric === "total" ? period.rows : metricRows(period.rows, metric);
                    return (
                      <td key={`${employeeRow.employee}-${period.key}`}>
                        <button
                          type="button"
                          className={drillRows.length ? "metric-cell has-data" : "metric-cell"}
                          title={metricLabel}
                          onClick={() =>
                            drillRows.length
                              ? onOpenDetail(`${timeframeLabel} Agent Drill In`, `${employeeRow.employee} · ${period.dateLabel || period.label}`, rows, detailFiltersForPeriod(filters, period, employeeRow.employee))
                              : null
                          }
                        >
                          {period.metricLabel || period.label}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3 + periods.length}>No Agent Performance Data For The Selected Timeframe And Filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function downloadWeeklyCsv(tableRows, periods, metric, metricLabel, timeframeLabel = "Weekly") {
  const header = ["Employee", "Team", `Total ${metricLabel}`, ...periods.map((period) => period.label)];

  const rows = tableRows.map((row) => [
    row.employee,
    row.team,
    formatMetricValue(row.totalRows, metric),
    ...row.periods.map((period) => period.metricLabel || period.label),
  ]);

  const csv = [header, ...rows]
    .map((line) => line.map((item) => escapeCsv(item)).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${timeframeLabel.toLowerCase()}-agent-performance-table.csv`;
  a.click();

  URL.revokeObjectURL(url);
}


function DashboardLoadingScreen({ welcomeIdentity = null, showWelcome = false }) {
  return (
    <main className="dashboard-page">
      <style>{dashboardStyles}</style>

      <div className="dashboard-loading-stage">
        <div className="dashboard-loader-card">
          <div className="dashboard-loader-logo" aria-hidden="true">
            <span className="dashboard-loader-glow" />
            <span className="dashboard-loader-ring ring-one" />
            <span className="dashboard-loader-ring ring-two" />
            <span className="dashboard-loader-gear gear-a">⚙</span>
            <span className="dashboard-loader-gear gear-b">⚙</span>
            <span className="dashboard-loader-gear gear-c">⚙</span>
            <span className="dashboard-loader-dot dot-one" />
            <span className="dashboard-loader-dot dot-two" />
          </div>

          <p>Dashboard Intelligence</p>
          <h1>Preparing Insights...</h1>

          {showWelcome && welcomeIdentity ? (
            <div className="dashboard-welcome-strip">
              <div className="dashboard-welcome-avatar">
                {welcomeIdentity.avatarUrl ? (
                  <img src={welcomeIdentity.avatarUrl} alt={welcomeIdentity.displayName} />
                ) : (
                  <strong>{welcomeIdentity.initials}</strong>
                )}
              </div>
              <div className="dashboard-welcome-copy">
                <span>Welcome, {welcomeIdentity.displayName}</span>
                <strong>{welcomeIdentity.role}</strong>
              </div>
            </div>
          ) : null}

          <span>Syncing stored audit results, Supervisor Teams, and filtered analytics.</span>

          <div className="dashboard-loader-bar">
            <i />
          </div>
        </div>
      </div>
    </main>
  );
}

export default function DashboardPage() {
  const [previewConversationId, setPreviewConversationId] = useState("");
  const [previewContext, setPreviewContext] = useState(null);
  const [expandedVerdicts, setExpandedVerdicts] = useState({});
  const [activeDisputeRow, setActiveDisputeRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rawRows, setRawRows] = useState([]);
  const [supervisorTeams, setSupervisorTeams] = useState([]);
  const [error, setError] = useState("");
  const [welcomeIdentity, setWelcomeIdentity] = useState(null);
  const [profile, setProfile] = useState(null);
  const [welcomeAlreadyShown, setWelcomeAlreadyShown] = useState(true);
  const [globalFilters, setGlobalFilters] = useState(createBaseFilters("past_30_days", true));
  const [leaderboardFilters, setLeaderboardFilters] = useState(createBaseFilters("past_30_days", true));
  const [weeklyFilters, setWeeklyFilters] = useState(() => createWeeklyDefaultFilters());
  const [weeklyMetric, setWeeklyMetric] = useState("missed");
  const [weeklyTimeframe, setWeeklyTimeframe] = useState("weekly");
  const [showJumpTop, setShowJumpTop] = useState(false);
  const [explorerExpanded, setExplorerExpanded] = useState(false);
  const [dashboardConversationSearch, setDashboardConversationSearch] = useState("");

  const [detailState, setDetailState] = useState({
    open: false,
    title: "",
    value: "",
    rows: [],
    initialFilters: createBaseFilters("all", false),
  });

  useEffect(() => {
    let active = true;
    let requestId = 0;
    let hasLoadedFreshRows = false;

    async function loadRowsForSession(activeSession, options = {}) {
      const showLoader = options.showLoader !== false;

      if (!active) return;

      if (!activeSession?.access_token) {
        setRawRows([]);
        setSupervisorTeams([]);
        setWelcomeIdentity(null);
        setProfile(null);
        setWelcomeAlreadyShown(true);
        setError("Please sign in with your NEXT Ventures account to load dashboard data.");
        setLoading(false);
        return;
      }

      const baseWelcomeIdentity = buildWelcomeIdentity(activeSession);

      if (baseWelcomeIdentity) {
        setWelcomeIdentity(baseWelcomeIdentity);
        setWelcomeAlreadyShown(hasSeenDashboardWelcome(baseWelcomeIdentity.email));
      }

      const currentRequestId = requestId + 1;
      requestId = currentRequestId;

      if (showLoader || !hasLoadedFreshRows) {
        setLoading(true);
      }

      setError("");

      try {
        const [response, welcomeProfile] = await Promise.all([
          fetch(`/api/results?dashboardRefresh=${Date.now()}`, {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${activeSession.access_token}`,
            },
            cache: "no-store",
          }),
          fetchWelcomeProfile(activeSession),
        ]);

        setProfile(welcomeProfile || null);

        if (welcomeProfile) {
          const enrichedWelcomeIdentity = buildWelcomeIdentity(activeSession, welcomeProfile);

          if (enrichedWelcomeIdentity) {
            setWelcomeIdentity(enrichedWelcomeIdentity);
            setWelcomeAlreadyShown(hasSeenDashboardWelcome(enrichedWelcomeIdentity.email));
          }
        }

        const data = await response.json().catch(() => null);

        if (!response.ok || !data?.ok) {
          throw new Error(data?.error || "Could not load dashboard data.");
        }

        const allRows = Array.isArray(data.results)
          ? data.results
          : Array.isArray(data.rows)
          ? data.rows
          : [];
        const loadedSupervisorTeams = Array.isArray(data.supervisorTeams) ? data.supervisorTeams : [];

        if (!active || currentRequestId !== requestId) return;

        hasLoadedFreshRows = true;
        setSupervisorTeams(loadedSupervisorTeams);
        setRawRows(allRows);
      } catch (loadError) {
        if (!active || currentRequestId !== requestId) return;

        setRawRows([]);
        setSupervisorTeams([]);
        setProfile(null);
        setError(loadError instanceof Error ? loadError.message : "Could not load dashboard data.");
      } finally {
        if (active && currentRequestId === requestId) setLoading(false);
      }
    }

    async function initializeDashboard() {
      try {
        const sessionResult = await supabase.auth.getSession();
        await loadRowsForSession(sessionResult?.data?.session || null, { showLoader: true });
      } catch (_error) {
        if (!active) return;
        setRawRows([]);
        setSupervisorTeams([]);
        setError("Could not complete Dashboard session check.");
        setLoading(false);
      }
    }

    initializeDashboard();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!active) return;

      if (!newSession?.access_token) {
        if (event === "SIGNED_OUT") {
          setRawRows([]);
          setSupervisorTeams([]);
          setWelcomeIdentity(null);
          setWelcomeAlreadyShown(true);
          setError("Please sign in with your NEXT Ventures account to load dashboard data.");
          setLoading(false);
        }
        return;
      }

      const isQuietRefresh = event === "TOKEN_REFRESHED" || event === "USER_UPDATED";
      loadRowsForSession(newSession, { showLoader: !isQuietRefresh && !hasLoadedFreshRows });
    });

    return () => {
      active = false;
      subscription?.unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!loading && welcomeIdentity?.email && !welcomeAlreadyShown) {
      markDashboardWelcomeSeen(welcomeIdentity.email);
      setWelcomeAlreadyShown(true);
    }
  }, [loading, welcomeIdentity, welcomeAlreadyShown]);

  useEffect(() => {
    function handleScroll() {
      setShowJumpTop(window.scrollY > 700);
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const dashboardRows = useMemo(() => (Array.isArray(rawRows) ? rawRows : []), [rawRows]);
  const dedupedRows = useMemo(() => dedupeLatestByConversation(dashboardRows), [dashboardRows]);

  const supervisorLookup = useMemo(
    () => buildSupervisorLookup(supervisorTeams),
    [supervisorTeams]
  );

  const employees = useMemo(() => uniqueValues(dashboardRows, "employee_name"), [dashboardRows]);

  const reviewOptions = REVIEW_SENTIMENT_ORDER;
  const clientOptions = CLIENT_SENTIMENT_ORDER;
  const resolutionOptions = RESOLUTION_ORDER;

  const filteredRows = useMemo(
    () => dedupeLatestByConversation(filterRows(dashboardRows, globalFilters, supervisorLookup)),
    [dashboardRows, globalFilters, supervisorLookup]
  );

  const dashboardConversationIds = useMemo(
    () => parseConversationIdQuery(dashboardConversationSearch),
    [dashboardConversationSearch]
  );

  const dashboardConversationMatches = useMemo(() => {
    if (!dashboardConversationIds.length) return [];
    const wanted = new Set(dashboardConversationIds.map((id) => id.toLowerCase()));
    return dedupeLatestByConversation(dashboardRows).filter((row) => {
      const id = rowConversationId(row).toLowerCase();
      return id && wanted.has(id);
    });
  }, [dashboardRows, dashboardConversationIds]);

  const missingDashboardConversationIds = useMemo(() => {
    if (!dashboardConversationIds.length) return [];
    const found = new Set(dashboardConversationMatches.map((row) => rowConversationId(row).toLowerCase()).filter(Boolean));
    return dashboardConversationIds.filter((id) => !found.has(id.toLowerCase()));
  }, [dashboardConversationIds, dashboardConversationMatches]);

  const leaderboardFilteredRows = useMemo(
    () => dedupeLatestByConversation(filterRows(dashboardRows, leaderboardFilters, supervisorLookup)),
    [dashboardRows, leaderboardFilters, supervisorLookup]
  );

  const clientEntries = useMemo(
    () => countRowsBy(filteredRows, (row) => row.client_sentiment, CLIENT_SENTIMENT_ORDER).filter((entry) => CLIENT_SENTIMENT_ORDER.includes(entry.label)),
    [filteredRows]
  );

  const resolutionEntries = useMemo(
    () => countRowsBy(filteredRows, (row) => row.resolution_status, RESOLUTION_ORDER).filter((entry) => RESOLUTION_ORDER.includes(entry.label)),
    [filteredRows]
  );

  const reviewEntries = useMemo(
    () => countRowsBy(filteredRows, (row) => row.review_sentiment, REVIEW_SENTIMENT_ORDER).filter((entry) => REVIEW_SENTIMENT_ORDER.includes(entry.label)),
    [filteredRows]
  );

  const missedRows = useMemo(
    () => filteredRows.filter((row) => sameText(row?.review_sentiment, "Missed Opportunity")),
    [filteredRows]
  );

  const missedClientEntries = useMemo(
    () => countRowsBy(missedRows, (row) => row.client_sentiment, CLIENT_SENTIMENT_ORDER).filter((entry) => CLIENT_SENTIMENT_ORDER.includes(entry.label)),
    [missedRows]
  );

  const missedResolutionEntries = useMemo(
    () => countRowsBy(missedRows, (row) => row.resolution_status, RESOLUTION_ORDER).filter((entry) => RESOLUTION_ORDER.includes(entry.label)),
    [missedRows]
  );

  const leaderboard = useMemo(() => buildLeaderboard(leaderboardFilteredRows), [leaderboardFilteredRows]);

  const previousGlobalFilters = useMemo(
    () => createPreviousPeriodFilters(globalFilters),
    [globalFilters]
  );

  const previousRows = useMemo(
    () => previousGlobalFilters
      ? dedupeLatestByConversation(filterRows(dashboardRows, previousGlobalFilters, supervisorLookup))
      : [],
    [dashboardRows, previousGlobalFilters, supervisorLookup]
  );

  const total = filteredRows.length;

  const missedCount = filteredRows.filter(
    (row) => sameText(row.review_sentiment, "Missed Opportunity")
  ).length;

  const criticalMissRate = getCriticalMissRate(filteredRows);

  const resolvedCount = filteredRows.filter(
    (row) => sameText(row.resolution_status, "Resolved")
  ).length;

  const unresolvedCount = filteredRows.filter(
    (row) => sameText(row.resolution_status, "Unresolved")
  ).length;

  const previousTotal = previousRows.length;
  const previousMissedCount = previousRows.filter((row) => sameText(row.review_sentiment, "Missed Opportunity")).length;
  const previousCriticalMissRate = getCriticalMissRate(previousRows);
  const previousResolvedCount = previousRows.filter((row) => sameText(row.resolution_status, "Resolved")).length;
  const previousUnresolvedCount = previousRows.filter((row) => sameText(row.resolution_status, "Unresolved")).length;
  const currentResolutionRate = total ? (resolvedCount / total) * 100 : 0;
  const previousResolutionRate = previousTotal ? (previousResolvedCount / previousTotal) * 100 : 0;

  const latestStoredAt = dashboardRows[0]?.created_at || dedupedRows[0]?.created_at || "";

  const showWelcomeOnLoading = Boolean(welcomeIdentity && !welcomeAlreadyShown);

  if (loading) {
    return <DashboardLoadingScreen welcomeIdentity={welcomeIdentity} showWelcome={showWelcomeOnLoading} />;
  }

  function openConversationPreview(conversationId, context = null) {
    setPreviewConversationId(String(conversationId || "").trim());
    setPreviewContext(context || null);
  }

  function closeConversationPreview() {
    setPreviewConversationId("");
    setPreviewContext(null);
  }

  function toggleVerdict(key) {
    setExpandedVerdicts((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function openDisputePanel(row) {
    setActiveDisputeRow(row || null);
  }

  function closeDisputePanel() {
    setActiveDisputeRow(null);
  }

  function openDetail(title, value, rows, initialFilters = globalFilters) {
    setDetailState({
      open: true,
      title,
      value,
      rows: rows || [],
      initialFilters: cloneFilters(initialFilters, "all", false),
    });
  }

  return (
    <main className="dashboard-page">
      <style>{dashboardStyles}</style>

      <DetailModal
        open={detailState.open}
        onClose={() =>
          setDetailState({
            open: false,
            title: "",
            value: "",
            rows: [],
            initialFilters: createBaseFilters("all", false),
          })
        }
        title={detailState.title}
        value={detailState.value}
        rows={detailState.rows}
        initialFilters={detailState.initialFilters}
        profile={profile}
        supervisorTeams={supervisorTeams}
        supervisorLookup={supervisorLookup}
        employees={employees}
        reviewOptions={reviewOptions}
        clientOptions={clientOptions}
        resolutionOptions={resolutionOptions}
      />

      <div className="dashboard-shell">
        <section className="hero-panel compact-hero slim-hero">
          <div className="hero-copy">
            <p>Insights Dashboard</p>
            <strong>Live Quality Overview</strong>
            <span>Latest Stored Result: {formatDateTime(latestStoredAt)}</span>
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

        <section className="panel conversation-id-search-panel">
          <div className="conversation-id-search-head">
            <div>
              <p>Conversation Lookup</p>
              <h2>Search Specific Conversation ID</h2>
              <span>Use this to find one or more stored conversations without changing the dashboard filters. Separate multiple IDs with commas.</span>
            </div>
            {dashboardConversationIds.length ? (
              <button type="button" className="secondary-btn" onClick={() => setDashboardConversationSearch("")}>Clear Search</button>
            ) : null}
          </div>
          <label className="conversation-id-search-box">
            <span>Conversation ID(s)</span>
            <textarea
              value={dashboardConversationSearch}
              onChange={(event) => setDashboardConversationSearch(event.target.value)}
              placeholder="Example: 215474306770307, 215474156103997"
              rows={2}
            />
          </label>
          {dashboardConversationIds.length ? (
            <div className="conversation-id-search-results">
              <div className="conversation-id-search-summary">
                <strong>{formatNumber(dashboardConversationMatches.length)} found</strong>
                <span>{missingDashboardConversationIds.length ? `${formatNumber(missingDashboardConversationIds.length)} not found in your visible stored results.` : "All requested IDs were found in your visible stored results."}</span>
              </div>
              {missingDashboardConversationIds.length ? (
                <div className="conversation-id-missing">Missing: {missingDashboardConversationIds.join(", ")}</div>
              ) : null}
              {dashboardConversationMatches.length ? (
                <div className="table-wrap conversation-id-result-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Conversation</th>
                        <th>Employee</th>
                        <th>Review</th>
                        <th>Client</th>
                        <th>Resolution</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboardConversationMatches.map((row, index) => (
                        <tr key={`${rowConversationId(row)}-${index}`}>
                          <td>
                            <strong>{rowConversationId(row)}</strong>
                            <small>{row.agent_name || "Unassigned"}<br />{row.client_email || "-"}</small>
                          </td>
                          <td>{row.employee_name || "Unmapped"}</td>
                          <td>{row.review_sentiment || "-"}</td>
                          <td>{row.client_sentiment || "-"}</td>
                          <td>{row.resolution_status || "-"}</td>
                          <td>
                            <ConversationActionButtons conversationId={row.conversation_id} previewContext={row} onPreview={openConversationPreview} />
                            <DisputeVerdictButton result={row} profile={profile} supervisorTeams={supervisorTeams} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="kpi-grid">
          <KPIStat
            label="Unique Conversations"
            help="Total unique conversations in the selected date range and filters. Clicking opens the underlying records."
            value={formatNumber(total)}
            trend={previousGlobalFilters ? buildMetricTrend(total, previousTotal) : null}
            accent="linear-gradient(135deg, rgba(37,99,235,0.26), rgba(99,102,241,0.12))"
            onClick={() => openDetail("KPI Drill In", "Unique Conversations", dedupedRows, globalFilters)}
          />
          <KPIStat
            label="Missed Opportunities"
            help="Conversations where the AI found a missed chance to create or request a positive review outcome."
            value={formatNumber(missedCount)}
            trend={previousGlobalFilters ? buildMetricTrend(missedCount, previousMissedCount, { inverse: true }) : null}
            accent="linear-gradient(135deg, rgba(239,68,68,0.25), rgba(249,115,22,0.12))"
            onClick={() =>
              openDetail(
                "KPI Drill In",
                "Missed Opportunities",
                dedupedRows,
                detailFiltersWith(globalFilters, { reviewSentiments: ["Missed Opportunity"] })
              )
            }
          />
          <KPIStat
            label="Critical Miss Rate"
            help="Missed Opportunity conversations where the client sentiment is Very Positive or Positive, divided by total handled conversations in the current filter. Rates above 5% are treated as red risk."
            value={formatPercent(criticalMissRate)}
            trend={previousGlobalFilters ? buildMetricTrend(criticalMissRate, previousCriticalMissRate, { type: "percent", inverse: true }) : null}
            accent={
              criticalMissRate > 5
                ? "linear-gradient(135deg, rgba(239,68,68,0.28), rgba(236,72,153,0.16))"
                : "linear-gradient(135deg, rgba(16,185,129,0.24), rgba(6,182,212,0.12))"
            }
            onClick={() =>
              openDetail(
                "KPI Drill In",
                "Critical Miss Rate",
                dedupedRows,
                detailFiltersWith(globalFilters, {
                  reviewSentiments: ["Missed Opportunity"],
                  clientSentiments: CRITICAL_CLIENT_SENTIMENTS,
                })
              )
            }
          />
          <KPIStat
            label="Resolution Rate"
            help="The percentage of filtered conversations marked as Resolved."
            value={formatPercent(currentResolutionRate)}
            trend={previousGlobalFilters ? buildMetricTrend(currentResolutionRate, previousResolutionRate, { type: "percent" }) : null}
            accent="linear-gradient(135deg, rgba(14,165,233,0.22), rgba(34,197,94,0.12))"
            onClick={() =>
              openDetail(
                "KPI Drill In",
                "Resolved",
                dedupedRows,
                detailFiltersWith(globalFilters, { resolutionStatuses: ["Resolved"] })
              )
            }
          />
          <KPIStat
            label="Unresolved"
            help="Filtered conversations that still appear unresolved and may need follow-up."
            value={formatNumber(unresolvedCount)}
            trend={previousGlobalFilters ? buildMetricTrend(unresolvedCount, previousUnresolvedCount, { inverse: true }) : null}
            accent="linear-gradient(135deg, rgba(244,63,94,0.24), rgba(168,85,247,0.12))"
            onClick={() =>
              openDetail(
                "KPI Drill In",
                "Unresolved",
                dedupedRows,
                detailFiltersWith(globalFilters, { resolutionStatuses: ["Unresolved"] })
              )
            }
          />

        </section>

        {loading ? (
          <section className="panel loading-panel">
            <p className="panel-eyebrow">Loading</p>
            <h2>Preparing the Intelligence View...</h2>
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
                <span>Active Date Range</span>
                <strong>{getRangeDisplay(globalFilters)}</strong>
              </div>
              <div>
                <span>Filtered Records</span>
                <strong>{formatNumber(filteredRows.length)}</strong>
              </div>
              <div>
                <span>Leaderboard Scope</span>
                <strong>{getRangeDisplay(leaderboardFilters)}</strong>
              </div>
              <div>
                <span>Supervisor Teams</span>
                <strong>{formatNumber(supervisorTeams.length)}</strong>
              </div>
            </section>

            <section className="overview-feature-grid">
              <article className="current-view-card current-view-compact-card">
                <div className="current-view-head">
                  <div>
                    <p>Current View</p>
                    <strong>{formatNumber(total)} Conversations</strong>
                    <span>{getRangeDisplay(globalFilters)} · {globalFilters.cexOnly ? "CEx Only" : "All Teams"}</span>
                  </div>
                  <InfoTip text="A quick summary of the currently selected date range and filters. The numbers update whenever filters change." />
                </div>

                <div className="current-view-stats compact-current-stats">
                  <div>
                    <span>Missed Opportunities</span>
                    <strong>{formatNumber(missedCount)}</strong>
                  </div>
                  <div>
                    <span>Resolution Rate</span>
                    <strong>{formatPercent(total ? (resolvedCount / total) * 100 : 0)}</strong>
                  </div>
                  <div>
                    <span>Critical Miss Rate</span>
                    <strong>{formatPercent(criticalMissRate)}</strong>
                  </div>
                  <div>
                    <span>Unresolved</span>
                    <strong>{formatNumber(unresolvedCount)}</strong>
                  </div>
                </div>
              </article>

              <ChartCard
                title="Missed Opportunities By Client Sentiment"
                subtitle={`${formatNumber(missedRows.length)} Missed Opportunities Grouped By Client Sentiment`}
                larger
                help="Shows which client sentiment groups contain missed opportunities, so supervisors can see where stronger review handling is needed."
                onDrill={() =>
                  openDetail(
                    "Missed Opportunities Drill In",
                    "All Client Sentiments",
                    dedupedRows,
                    detailFiltersWith(globalFilters, { reviewSentiments: ["Missed Opportunity"] })
                  )
                }
              >
                <DonutChart
                  entries={missedClientEntries}
                  total={missedRows.length}
                  kind="client"
                  onSelect={(entry) =>
                    openDetail(
                      "Missed Opportunities Drill In",
                      entry.label,
                      dedupedRows,
                      detailFiltersWith(globalFilters, {
                        reviewSentiments: ["Missed Opportunity"],
                        clientSentiments: [entry.label],
                      })
                    )
                  }
                />
              </ChartCard>
            </section>

            <section className="sentiment-resolution-grid">
              <ChartCard
                title="Client Sentiment Distribution"
                subtitle="Overall Client Emotional Outcome"
                larger
                help="Shows the emotional tone of clients in the selected conversations, from Very Positive to Very Negative."
                onDrill={() => openDetail("Client Sentiment Drill In", "All Client Sentiments", dedupedRows, globalFilters)}
              >
                <HorizontalBarChart
                  entries={clientEntries}
                  total={filteredRows.length}
                  kind="client"
                  onSelect={(entry) =>
                    openDetail(
                      "Client Sentiment Drill In",
                      entry.label,
                      dedupedRows,
                      detailFiltersWith(globalFilters, { clientSentiments: [entry.label] })
                    )
                  }
                />
              </ChartCard>

              <ChartCard
                title="Resolution Status"
                subtitle="Status Of Conversations"
                larger
                help="Shows whether the selected conversations were Resolved, Pending, Unclear, or Unresolved."
                onDrill={() => openDetail("Resolution Drill In", "All Resolution Statuses", dedupedRows, globalFilters)}
              >
                <HorizontalBarChart
                  entries={resolutionEntries}
                  total={filteredRows.length}
                  kind="resolution"
                  onSelect={(entry) =>
                    openDetail(
                      "Resolution Drill In",
                      entry.label,
                      dedupedRows,
                      detailFiltersWith(globalFilters, { resolutionStatuses: [entry.label] })
                    )
                  }
                />
              </ChartCard>
            </section>

            <section className="chart-grid breakdown-grid">
              <ChartCard
                title="Review Approach Breakdown"
                subtitle="Distribution By Review Approach"
                help="Shows how the filtered conversations are distributed across review approach outcomes, including positive review signals, missed opportunities, and negative review risks."
                onDrill={() => openDetail("Review Approach Drill In", "All Review Approaches", dedupedRows, globalFilters)}
              >
                <DonutChart
                  entries={reviewEntries}
                  total={filteredRows.length}
                  kind="review"
                  onSelect={(entry) =>
                    openDetail(
                      "Review Approach Drill In",
                      entry.label,
                      dedupedRows,
                      detailFiltersWith(globalFilters, { reviewSentiments: [entry.label] })
                    )
                  }
                />
              </ChartCard>

              <ChartCard
                title="Missed Opportunities By Resolution Status"
                subtitle={`${formatNumber(missedRows.length)} Missed Opportunities Grouped By Resolution Status`}
                help="Shows whether missed opportunities happened mostly in Resolved, Pending, Unclear, or Unresolved conversations."
                onDrill={() =>
                  openDetail(
                    "Missed Opportunities Drill In",
                    "All Resolution Statuses",
                    dedupedRows,
                    detailFiltersWith(globalFilters, { reviewSentiments: ["Missed Opportunity"] })
                  )
                }
              >
                <DonutChart
                  entries={missedResolutionEntries}
                  total={missedRows.length}
                  kind="resolution"
                  onSelect={(entry) =>
                    openDetail(
                      "Missed Opportunities Drill In",
                      entry.label,
                      dedupedRows,
                      detailFiltersWith(globalFilters, {
                        reviewSentiments: ["Missed Opportunity"],
                        resolutionStatuses: [entry.label],
                      })
                    )
                  }
                />
              </ChartCard>
            </section>
            <section className="panel leaderboard-panel">
              <div className="section-title-row">
                <div>
                  <p>Agent Performance Leaderboard</p>
                  <div className="title-with-help">
                    <h2>Who Needs Coaching Attention?</h2>
                    <InfoTip text="This table turns the current dashboard filters into an agent-level coaching view. It is useful for spotting high missed-opportunity counts, critical missed-opportunity rate, likely negative review risk, and resolution consistency." />
                  </div>
                  <span>Use this section to identify which agents need follow-up, not just who handled the most conversations. Click any agent or View to open the underlying records.</span>
                </div>

                <button type="button" className="secondary-btn" onClick={() => downloadCsv(leaderboardFilteredRows, "leaderboard-filtered-results.csv")}>
                  Export Leaderboard CSV
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
                    title: "Top Likely Positive Reviews",
                    help: "Ranks employees by Highly Likely Positive Review and Likely Positive Review outcomes in the current leaderboard filter scope.",
                    theme: "green",
                    rows: [...leaderboard].sort((a, b) => b.likelyPositive - a.likelyPositive).slice(0, 5),
                    value: (row) => formatNumber(row.likelyPositive),
                    filterOverrides: { reviewSentiments: ["Highly Likely Positive Review", "Likely Positive Review"] },
                    rowsFor: (row) => row.rows.filter(isLikelyPositiveReview),
                  },
                  {
                    title: "Top Missed Opportunities",
                    help: "Ranks employees by Missed Opportunity conversations where the client sentiment was Very Positive or Positive. This is the default critical missed-opportunity scope.",
                    theme: "red",
                    rows: [...leaderboard].sort((a, b) => b.criticalMiss - a.criticalMiss || b.handled - a.handled).slice(0, 5),
                    value: (row) => formatNumber(row.criticalMiss),
                    detail: (row) => `${row.team || "-"} · ${formatNumber(row.handled)} Handled`,
                    filterOverrides: { reviewSentiments: ["Missed Opportunity"], clientSentiments: CRITICAL_CLIENT_SENTIMENTS },
                    rowsFor: (row) => row.rows.filter(isCriticalMiss),
                  },
                  {
                    title: "Top Critical Miss Rates",
                    help: "Ranks employees by Critical Miss Rate: Missed Opportunity conversations with Very Positive or Positive client sentiment divided by total handled conversations. Above 5% is red risk.",
                    theme: "red",
                    rows: [...leaderboard].sort((a, b) => b.criticalMissRate - a.criticalMissRate || b.criticalMiss - a.criticalMiss || b.handled - a.handled).slice(0, 5),
                    value: (row) => formatPercent(row.criticalMissRate),
                    detail: (row) => `${formatNumber(row.criticalMiss)} Critical Miss${row.criticalMiss === 1 ? "" : "es"} · ${formatNumber(row.handled)} Handled`,
                    filterOverrides: { reviewSentiments: ["Missed Opportunity"], clientSentiments: CRITICAL_CLIENT_SENTIMENTS },
                    rowsFor: (row) => row.rows.filter(isCriticalMiss),
                  },
                  {
                    title: "Top Likely Negative Reviews",
                    help: "Ranks employees by Highly Likely Negative Review and Likely Negative Review outcomes in the current leaderboard filter scope.",
                    theme: "red",
                    rows: [...leaderboard].sort((a, b) => b.likelyNegative - a.likelyNegative).slice(0, 5),
                    value: (row) => formatNumber(row.likelyNegative),
                    filterOverrides: { reviewSentiments: ["Highly Likely Negative Review", "Likely Negative Review"] },
                    rowsFor: (row) => row.rows.filter(isLikelyNegativeReview),
                  },
                ].map((block) => (
                  <div key={block.title} className={`mini-rank-card ${block.theme}`}>
                    <div className="mini-rank-heading">
                      <h3>{block.title}</h3>
                      {block.help ? <InfoTip text={block.help} /> : null}
                    </div>
                    {block.rows.length ? (
                      block.rows.map((row) => (
                        <button
                          key={`${block.title}-${row.employee}`}
                          type="button"
                          onClick={() => openDetail("Leaderboard Drill In", `${block.title}: ${row.employee}`, dedupedRows, detailFiltersForEmployee(leaderboardFilters, row.employee, block.filterOverrides || {}))}
                        >
                          <strong>{row.employee}</strong>
                          <span>{block.value(row)}</span>
                          <small>{block.detail ? block.detail(row) : `${row.team || "-"} · ${formatNumber(row.handled)} Handled`}</small>
                        </button>
                      ))
                    ) : (
                      <p>No Data.</p>
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
                      <th>Likely Positive</th>
                      <th>Missed</th>
                      <th>Critical Miss Rate</th>
                      <th>Likely Negative</th>
                      <th>Resolution Rate</th>
                      <th>Drill In</th>
                    </tr>
                  </thead>

                  <tbody>
                    {leaderboard.map((row) => (
                      <tr key={row.employee}>
                        <td>
                          <button type="button" className="text-link" onClick={() => openDetail("Employee Drill In", row.employee, dedupedRows, detailFiltersForEmployee(leaderboardFilters, row.employee))}>
                            {row.employee}
                          </button>
                        </td>
                        <td>{row.team || "-"}</td>
                        <td>{formatNumber(row.handled)}</td>
                        <td className="good">{formatNumber(row.likelyPositive)}</td>
                        <td className="bad">{formatNumber(row.missed)}</td>
                        <td className={row.criticalMissRate > 5 ? "bad" : "good"}>{formatPercent(row.criticalMissRate)} · {formatNumber(row.criticalMiss)}</td>
                        <td className="bad">{formatNumber(row.likelyNegative)}</td>
                        <td>{formatPercent(row.resolutionRate)}</td>
                        <td>
                          <button type="button" className="small-btn" onClick={() => openDetail("Employee Drill In", row.employee, dedupedRows, detailFiltersForEmployee(leaderboardFilters, row.employee))}>
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
              timeframe={weeklyTimeframe}
              setTimeframe={setWeeklyTimeframe}
              supervisorTeams={supervisorTeams}
              supervisorLookup={supervisorLookup}
              employees={employees}
              reviewOptions={reviewOptions}
              clientOptions={clientOptions}
              resolutionOptions={resolutionOptions}
              onOpenDetail={openDetail}
            />

            <section className={explorerExpanded ? "panel explorer-panel expanded" : "panel explorer-panel"}>
              <div className="section-title-row">
                <div>
                  <p>Conversation Records</p>
                  <h2>Latest Conversations From Current Filters</h2>
                  <span>
                    This is the raw conversation list behind the dashboard cards and charts. Showing {formatNumber(Math.min(explorerExpanded ? 100 : 12, filteredRows.length))} of{" "}
                    {formatNumber(filteredRows.length)} matching records. Use Preview Conversation for the full context.
                  </span>
                </div>

                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setExplorerExpanded((prev) => !prev)}
                >
                  {explorerExpanded ? "Show Less" : "Show More"}
                </button>
              </div>

              <div className="table-wrap explorer-table-wrap">
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
                      <th>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredRows.slice(0, explorerExpanded ? 100 : 12).map((row, index) => {
                      const verdictKey = `${row.conversation_id}-${row.created_at || row.replied_at || index}`;
                      const isVerdictVisible = Boolean(expandedVerdicts[verdictKey]);
                      return (
                        <Fragment key={verdictKey}>
                          <tr>
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
                              <ConversationActionButtons
                                conversationId={row.conversation_id}
                                previewContext={row}
                                onPreview={openConversationPreview}
                                onToggleVerdict={() => toggleVerdict(verdictKey)}
                                verdictVisible={isVerdictVisible}
                              />
                              <DisputeVerdictButton result={row} profile={profile} supervisorTeams={supervisorTeams} />
                            </td>
                          </tr>
                          {isVerdictVisible ? (
                            <tr className="expanded-row">
                              <td colSpan={8}>
                                <div className={row.error ? "verdict-box error" : "verdict-box"}>
                                  <div className="verdict-head">
                                    <span>{row.error ? "Error Details" : "AI Verdict"}</span>
                                    <small>{row.conversation_id || "Conversation"}</small>
                                  </div>
                                  <pre>{row.error || row.ai_verdict || "No AI verdict available."}</pre>
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
            </section>
          </>
        )}
      </div>

      {previewConversationId ? (
        <ConversationPreviewModal conversationId={previewConversationId} previewContext={previewContext} profile={profile} supervisorTeams={supervisorTeams} onClose={closeConversationPreview} />
      ) : null}

      {showJumpTop ? (
        <button type="button" className="jump-top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          Jump To Top
        </button>
      ) : null}
    </main>
  );
}

const dashboardStyles = `

  /* ── Base ────────────────────────────────────────────── */

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
    width: min(1540px, 100%);
    margin: 0 auto;
  }

  /* ── Loading screen ────────────────────────────────────── */

  .dashboard-loading-stage {
    min-height: calc(100vh - 80px);
    display: grid;
    place-items: center;
    padding: 48px 18px;
  }

  .dashboard-loader-card {
    position: relative;
    overflow: hidden;
    width: min(660px, 94vw);
    display: grid;
    justify-items: center;
    gap: 14px;
    padding: 46px;
    text-align: center;
    border-radius: 36px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background:
      radial-gradient(circle at 22% 0%, rgba(34, 211, 238, 0.1), transparent 34%),
      radial-gradient(circle at 86% 8%, rgba(139, 92, 246, 0.18), transparent 36%),
      linear-gradient(180deg, rgba(15, 23, 42, 0.94), rgba(5, 8, 20, 0.98));
    box-shadow:
      0 34px 110px rgba(0, 0, 0, 0.52),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }

  .dashboard-loader-card::before {
    content: "";
    position: absolute;
    inset: -180px auto auto -140px;
    width: 420px; height: 420px;
    border-radius: 999px;
    background: rgba(34, 211, 238, 0.11);
    filter: blur(66px);
  }

  .dashboard-loader-card::after {
    content: "";
    position: absolute;
    inset: auto -150px -190px auto;
    width: 460px; height: 460px;
    border-radius: 999px;
    background: rgba(236, 72, 153, 0.12);
    filter: blur(70px);
  }

  .dashboard-loader-logo,
  .dashboard-loader-card p,
  .dashboard-loader-card h1,
  .dashboard-loader-card > span,
  .dashboard-loader-bar { position: relative; z-index: 1; }

  .dashboard-loader-logo {
    width: 190px; height: 190px;
    display: block;
    border-radius: 44px;
    border: 1px solid rgba(147, 197, 253, 0.2);
    background:
      radial-gradient(circle at 30% 24%, rgba(255,255,255,0.2), transparent 20%),
      linear-gradient(145deg, rgba(5,12,31,0.98), rgba(15,23,42,0.94));
    box-shadow: 0 28px 74px rgba(15,23,42,0.6), 0 0 46px rgba(34,211,238,0.14), inset 0 1px 0 rgba(255,255,255,0.12);
  }

  .dashboard-loader-glow,
  .dashboard-loader-ring,
  .dashboard-loader-gear,
  .dashboard-loader-dot { position: absolute; pointer-events: none; }

  .dashboard-loader-glow {
    inset: 20px; border-radius: 34px;
    background: radial-gradient(circle, rgba(34,211,238,0.14), rgba(139,92,246,0.12), transparent 70%);
    filter: blur(10px);
    animation: dashboardGlowPulse 2.4s ease-in-out infinite;
  }

  .dashboard-loader-ring { border-radius: 999px; border: 1px solid rgba(125,211,252,0.18); }
  .dashboard-loader-ring.ring-one { inset: 28px 26px 30px 20px; animation: dashboardOrbitTilt 5.8s ease-in-out infinite; }
  .dashboard-loader-ring.ring-two { inset: 45px 18px 38px 42px; border-color: rgba(244,114,182,0.18); animation: dashboardOrbitTiltReverse 4.8s ease-in-out infinite; }

  .dashboard-loader-gear {
    display: inline-flex; align-items: center; justify-content: center;
    font-family: Arial, Helvetica, sans-serif; line-height: 1;
    text-shadow: 0 14px 30px rgba(0,0,0,0.5);
  }

  .dashboard-loader-gear.gear-a { left:34px; top:60px; color:#8b5cf6; font-size:86px; filter:drop-shadow(0 0 18px rgba(139,92,246,0.34)); animation:dashboardGearSpin 5s linear infinite; }
  .dashboard-loader-gear.gear-b { left:90px; top:30px; color:#38bdf8; font-size:76px; filter:drop-shadow(0 0 18px rgba(56,189,248,0.32)); animation:dashboardGearSpinReverse 4.2s linear infinite; }
  .dashboard-loader-gear.gear-c { left:104px; top:104px; color:#ec4899; font-size:54px; filter:drop-shadow(0 0 18px rgba(236,72,153,0.3)); animation:dashboardGearSpin 3.3s linear infinite; }

  .dashboard-loader-dot { width:9px; height:9px; border-radius:999px; background:currentColor; box-shadow:0 0 18px currentColor; }
  .dashboard-loader-dot.dot-one { top:52px; right:50px; color:#7dd3fc; }
  .dashboard-loader-dot.dot-two { bottom:50px; right:32px; color:#f9a8d4; }

  .dashboard-loader-card p { margin:14px 0 0; color:#93b4ff; font-size:14px; font-weight:950; letter-spacing:0.18em; text-transform:uppercase; }
  .dashboard-loader-card h1 { margin:4px 0 0; color:#ffffff; font-size:clamp(34px,5vw,62px); line-height:0.95; letter-spacing:-0.07em; }
  .dashboard-loader-card > span { max-width:460px; color:#aebbe1; font-size:17px; line-height:1.7; }

  /* ── Skeleton loading ────────────────────────────────────────── */

  .dashboard-skeleton-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 14px;
    margin-bottom: 18px;
  }

  .dashboard-skeleton-card {
    height: 124px;
    border-radius: 24px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.07);
    overflow: hidden;
    position: relative;
  }

  .dashboard-skeleton-card::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%);
    animation: skeletonSweep 1.6s ease-in-out infinite;
  }

  .dashboard-skeleton-chart-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
    margin-bottom: 18px;
  }

  .dashboard-skeleton-chart {
    height: 320px;
    border-radius: 28px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.07);
    overflow: hidden;
    position: relative;
  }

  .dashboard-skeleton-chart::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.05) 50%, transparent 100%);
    animation: skeletonSweep 1.8s ease-in-out infinite;
  }

  @keyframes skeletonSweep {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }

  /* ── Welcome strip ────────────────────────────────────────── */

  .dashboard-welcome-strip {
    position: relative; z-index: 2;
    display: flex; align-items: center; gap: 14px;
    width: min(460px, 100%);
    padding: 14px 18px;
    border-radius: 24px;
    border: 1px solid rgba(125,211,252,0.18);
    background:
      radial-gradient(circle at top left, rgba(34,211,238,0.14), transparent 38%),
      linear-gradient(135deg, rgba(15,23,42,0.86), rgba(30,20,66,0.78));
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 18px 44px rgba(2,6,23,0.34);
    animation: welcomeFadeIn 0.5s ease-out;
  }

  @keyframes welcomeFadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .dashboard-welcome-avatar {
    width: 52px; height: 52px; min-width: 52px;
    display: grid; place-items: center; overflow: hidden;
    border-radius: 18px;
    border: 1px solid rgba(191,219,254,0.22);
    background: linear-gradient(135deg, rgba(34,211,238,0.24), rgba(139,92,246,0.25));
    box-shadow: 0 0 28px rgba(34,211,238,0.2);
  }

  .dashboard-welcome-avatar img { width:100%; height:100%; object-fit:cover; }
  .dashboard-welcome-avatar strong { color:#ffffff; font-size:17px; font-weight:950; letter-spacing:0.04em; }

  .dashboard-welcome-copy { min-width:0; display:grid; justify-items:start; text-align:left; }
  .dashboard-welcome-copy span { max-width:none; margin:0; color:#ffffff; font-size:18px; font-weight:900; line-height:1.25; letter-spacing:-0.02em; }
  .dashboard-welcome-copy strong { margin-top:5px; color:#93c5fd; font-size:13px; font-weight:900; letter-spacing:0.1em; text-transform:uppercase; }

  .dashboard-loader-bar {
    width: min(360px, 80vw);
    height: 8px;
    margin-top: 14px;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(255,255,255,0.08);
  }

  .dashboard-loader-bar i {
    display: block; width: 44%; height: 100%; border-radius: inherit;
    background: linear-gradient(90deg, #22d3ee, #8b5cf6, #ec4899);
    animation: dashboardProgress 1.42s ease-in-out infinite;
  }

  @keyframes dashboardProgress { 0%{transform:translateX(-120%)} 55%{transform:translateX(94%)} 100%{transform:translateX(220%)} }
  @keyframes dashboardOrbitA { 0%,100%{transform:rotate(-24deg) scale(1);opacity:0.72} 50%{transform:rotate(-14deg) scale(1.06);opacity:1} }
  @keyframes dashboardOrbitB { 0%,100%{transform:rotate(28deg) scale(1);opacity:0.72} 50%{transform:rotate(42deg) scale(1.06);opacity:1} }
  @keyframes dashboardGearSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  @keyframes dashboardGearSpinReverse { from{transform:rotate(0deg)} to{transform:rotate(-360deg)} }
  @keyframes dashboardGlowPulse { 0%,100%{opacity:0.72;transform:scale(0.96)} 50%{opacity:1;transform:scale(1.04)} }
  @keyframes dashboardOrbitTilt { 0%,100%{transform:rotate(-10deg) scale(0.98);opacity:0.58} 50%{transform:rotate(9deg) scale(1.02);opacity:0.92} }
  @keyframes dashboardOrbitTiltReverse { 0%,100%{transform:rotate(16deg) scale(1.02);opacity:0.58} 50%{transform:rotate(-11deg) scale(0.98);opacity:0.88} }

  /* ── Shared card base ─────────────────────────────────────── */

  .hero-panel,
  .filter-panel,
  .panel,
  .chart-card,
  .kpi-card,
  .insight-strip {
    border: 1px solid rgba(255,255,255,0.08);
    background: linear-gradient(180deg, rgba(14,20,40,0.92), rgba(7,10,24,0.96));
    box-shadow: 0 24px 80px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.04);
  }

  /* ── Hero panel ────────────────────────────────────────── */

  .hero-panel {
    position: relative;
    overflow: hidden;
    display: grid;
    grid-template-columns: minmax(0,1fr) minmax(310px,390px);
    gap: 22px;
    align-items: stretch;
    padding: 32px;
    border-radius: 30px;
    margin-bottom: 18px;
    border-color: rgba(255,255,255,0.1);
    background:
      radial-gradient(circle at 5% 0%, rgba(34,211,238,0.11), transparent 30%),
      radial-gradient(circle at 96% 5%, rgba(139,92,246,0.2), transparent 32%),
      linear-gradient(180deg, rgba(14,20,42,0.96), rgba(7,10,24,0.98));
  }

  .hero-panel::before {
    content: "";
    position: absolute;
    inset: -160px auto auto -130px;
    width: 390px; height: 390px;
    border-radius: 999px;
    background: rgba(37,99,235,0.14);
    filter: blur(62px);
    pointer-events: none;
  }

  .hero-panel::after {
    content: "";
    position: absolute;
    inset: -150px -130px auto auto;
    width: 460px; height: 460px;
    border-radius: 999px;
    background: rgba(124,58,237,0.22);
    filter: blur(58px);
    pointer-events: none;
  }

  .hero-panel > * { position: relative; z-index: 1; }

  .hero-copy { align-self: center; }

  .hero-panel p,
  .section-title-row p,
  .modal-head p,
  .panel-eyebrow {
    margin: 0 0 10px;
    color: #8ea0d6;
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .hero-panel h1 {
    max-width: 930px;
    margin: 0 0 12px;
    font-size: clamp(44px,5vw,76px);
    line-height: 0.96;
    letter-spacing: -0.075em;
  }

  .hero-panel strong {
    display: block;
    margin-bottom: 8px;
    color: #ffffff;
    font-size: 30px;
    letter-spacing: -0.04em;
  }

  .hero-panel span,
  .section-title-row span,
  .muted {
    color: #a9b4d0;
    font-size: 16px;
    line-height: 1.7;
  }

  .hero-command-card {
    display: grid;
    gap: 16px;
    align-content: center;
    padding: 22px;
    border-radius: 24px;
    border: 1px solid rgba(255,255,255,0.08);
    background:
      radial-gradient(circle at top right, rgba(139,92,246,0.16), transparent 42%),
      rgba(255,255,255,0.04);
  }

  .hero-command-card > div:first-child span,
  .hero-command-card small { display: block; }
  .hero-command-card > div:first-child span { margin: 0 0 8px; color:#8ea0d6; font-size:13px; font-weight:900; letter-spacing:0.14em; text-transform:uppercase; }
  .hero-command-card > div:first-child strong { margin: 0 0 6px; font-size: 30px; }
  .hero-command-card small { color:#a9b4d0; line-height:1.6; }

  .hero-metric-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0,1fr));
    gap: 10px;
  }

  .hero-metric-grid span {
    display: block;
    padding: 14px;
    border-radius: 16px;
    color: #a9b4d0;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.035);
    font-size: 15px;
    font-weight: 800;
    transition: border-color 0.18s ease, background 0.18s ease;
  }

  .hero-metric-grid span:hover {
    border-color: rgba(96,165,250,0.2);
    background: rgba(59,130,246,0.06);
  }

  .hero-metric-grid b { display:block; margin-bottom:4px; color:#f5f7ff; font-size:22px; letter-spacing:-0.04em; }

  .hero-actions { display:flex; gap:10px; flex-wrap:wrap; }

  /* ── Buttons ────────────────────────────────────────────── */

  .primary-link, .secondary-link, .primary-btn, .secondary-btn,
  .light-btn, .drill-btn, .small-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 42px;
    padding: 0 16px;
    border-radius: 14px;
    font-size: 15px;
    font-weight: 900;
    cursor: pointer;
    text-decoration: none;
    transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, opacity 0.18s ease, box-shadow 0.18s ease;
  }

  .primary-link:hover, .secondary-link:hover, .primary-btn:hover,
  .secondary-btn:hover, .drill-btn:hover, .small-btn:hover, .jump-top:hover {
    transform: translateY(-1px);
  }

  .primary-link, .primary-btn {
    color: #fff;
    border: 0;
    background: linear-gradient(135deg, #2563eb 0%, #7c3aed 52%, #db2777 100%);
    box-shadow: 0 16px 34px rgba(91,33,182,0.34);
  }

  .primary-link:hover, .primary-btn:hover {
    box-shadow: 0 20px 44px rgba(91,33,182,0.46);
  }

  .secondary-link, .secondary-btn, .drill-btn, .small-btn {
    color: #e5ebff;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.04);
  }

  .secondary-btn:hover, .drill-btn:hover {
    border-color: rgba(99,102,241,0.3);
    background: rgba(99,102,241,0.08);
  }

  .light-btn { color: #0f172a; border: 0; background: #ffffff; }

  /* ── Filter bar ────────────────────────────────────────── */

  .filter-panel {
    position: relative;
    padding: 20px;
    border-radius: 28px;
    margin-bottom: 18px;
    z-index: 100;
    isolation: isolate;
    border-color: rgba(255,255,255,0.09);
    background:
      radial-gradient(circle at 2% 0%, rgba(34,211,238,0.06), transparent 26%),
      linear-gradient(180deg, rgba(14,20,40,0.96), rgba(7,10,24,0.98));
  }

  .leaderboard-panel,
  .weekly-panel,
  .modal-filter-block { overflow: visible; }

  .leaderboard-panel .filter-panel,
  .weekly-panel .filter-panel,
  .modal-filter-block .filter-panel { z-index: 300; }

  .leaderboard-cards,
  .weekly-table-wrap,
  .table-wrap { position: relative; z-index: 1; }

  .filter-row { display: grid; gap: 12px; align-items: end; }
  .filter-row.first {
    grid-template-columns: minmax(300px,1.45fr) minmax(240px,1fr) minmax(240px,1fr) auto;
    margin-bottom: 12px;
  }
  .filter-row.second {
    grid-template-columns: repeat(5, minmax(0,1fr)) auto;
  }

  label span, .custom-range-panel small {
    display: block;
    margin-bottom: 7px;
    color: #8ea0d6;
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  input, select, button { font: inherit; }

  input, select {
    width: 100%;
    min-height: 46px;
    box-sizing: border-box;
    color: #e7ecff;
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 15px;
    outline: none;
    background: rgba(5,8,18,0.9);
    padding: 0 13px;
    color-scheme: dark;
  }

  input:focus, select:focus,
  .date-picker-button:focus,
  .multi-button:focus {
    border-color: rgba(96,165,250,0.38);
    box-shadow: 0 0 0 3px rgba(59,130,246,0.12);
  }

  .cex-check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: #dbe7ff;
    font-size: 16px;
    font-weight: 900;
    padding-bottom: 10px;
    white-space: nowrap;
  }

  .cex-check input { width:auto; min-height:auto; }

  .date-picker-wrap, .multi-wrap { position: relative; }

  .date-picker-button, .multi-button {
    width: 100%;
    min-height: 48px;
    display: grid;
    grid-template-columns: minmax(0,1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 0 14px;
    color: #e7ecff;
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 15px;
    background: rgba(5,8,18,0.9);
    cursor: pointer;
    text-align: left;
    transition: border-color 0.18s ease, background 0.18s ease;
  }

  .date-picker-button:hover, .multi-button:hover {
    border-color: rgba(96,165,250,0.24);
    background: rgba(15,25,55,0.95);
  }

  .date-picker-button strong, .multi-button strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .date-picker-button b, .multi-button b {
    color: #8ea0d6;
    font-size: 13px;
  }

  .date-picker-popover, .multi-menu {
    position: absolute;
    top: calc(100% + 10px);
    left: 0;
    z-index: 2000;
    overflow: hidden;
    border-radius: 22px;
    border: 1px solid rgba(147,197,253,0.26);
    background: #0b1122;
    box-shadow:
      0 28px 90px rgba(0,0,0,0.78),
      0 0 0 1px rgba(255,255,255,0.04),
      inset 0 1px 0 rgba(255,255,255,0.06);
  }

  .date-picker-popover::before, .multi-menu::before {
    content: "";
    position: absolute;
    inset: 0; z-index: -1;
    background:
      radial-gradient(circle at top right, rgba(124,58,237,0.14), transparent 35%),
      linear-gradient(180deg, #101827 0%, #0b1122 100%);
  }

  .date-picker-popover {
    width: min(760px, 92vw);
    display: grid;
    grid-template-columns: 240px minmax(0,1fr);
  }

  .multi-menu {
    width: min(360px, 88vw);
    padding: 10px;
  }

  .multi-menu input { margin-bottom: 8px; }

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
    grid-template-columns: 64px minmax(0,1fr);
    gap: 8px;
    align-items: center;
    border: 1px solid transparent;
    border-radius: 12px;
    background: rgba(255,255,255,0.015);
    color: #e5ebff;
    padding: 0 10px;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.16s, background 0.16s;
  }

  .multi-option span { color:#8ea0d6; font-size:13px; font-weight:900; }
  .multi-option strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .multi-option.active, .multi-option:hover, .multi-option.all:hover { border-color:rgba(96,165,250,0.22); background:rgba(59,130,246,0.16); }
  .multi-option.active span { color: #34d399; }

  .multi-empty {
    padding: 12px;
    color: #a9b4d0;
    border: 1px dashed rgba(255,255,255,0.12);
    border-radius: 12px;
    background: rgba(255,255,255,0.025);
    font-size: 15px;
  }

  .date-preset-list {
    position: relative; z-index: 1;
    padding: 10px;
    border-right: 1px solid rgba(255,255,255,0.08);
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
    transition: background 0.16s;
  }

  .date-preset-list button.active, .date-preset-list button:hover { background: rgba(255,255,255,0.07); }
  .date-preset-list b { color: #f97316; font-size: 13px; }

  .custom-range-panel {
    position: relative; z-index: 1;
    padding: 18px;
    background: #101827;
  }

  .custom-range-panel strong { display:block; margin-bottom:18px; color:#ffffff; font-size:20px; }

  .custom-range-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0,1fr));
    gap: 12px;
    margin-bottom: 18px;
  }

  .custom-actions { display:flex; justify-content:flex-end; gap:10px; }

  /* ── Insight strip ─────────────────────────────────────── */

  .insight-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0,1fr));
    gap: 0;
    overflow: hidden;
    margin-bottom: 18px;
    border-radius: 24px;
    border-color: rgba(255,255,255,0.09);
  }

  .insight-strip div {
    padding: 18px 22px;
    border-right: 1px solid rgba(255,255,255,0.07);
    transition: background 0.18s ease;
  }

  .insight-strip div:hover { background: rgba(255,255,255,0.025); }
  .insight-strip div:last-child { border-right: 0; }
  .insight-strip span, .insight-strip strong { display: block; }

  .insight-strip span {
    margin-bottom: 8px;
    color: #8ea0d6;
    font-size: 12px;
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

  /* ── KPI cards ─────────────────────────────────────────── */

  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0,1fr));
    gap: 14px;
    margin-bottom: 18px;
  }

  .kpi-card {
    position: relative;
    overflow: hidden;
    min-height: 138px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    border-radius: 24px;
    padding: 20px;
    color: #ffffff;
    cursor: pointer;
    text-align: left;
    background: var(--accent);
    transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
    border: 1px solid rgba(255,255,255,0.09);
  }

  /* Glowing top edge accent */
  .kpi-card::before {
    content: "";
    position: absolute;
    top: 0; left: 10%; right: 10%;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent);
    z-index: 1;
  }

  .kpi-card::after {
    content: "";
    position: absolute;
    inset: -80px -80px auto auto;
    width: 180px; height: 180px;
    border-radius: 999px;
    background: rgba(255,255,255,0.07);
    filter: blur(28px);
    z-index: 0;
    pointer-events: none;
  }

  .kpi-card:hover {
    transform: translateY(-3px);
    border-color: rgba(255,255,255,0.16);
    box-shadow: 0 24px 60px rgba(0,0,0,0.48);
  }

  .kpi-card span, .kpi-card strong, .kpi-card small { position:relative; z-index:1; }

  .kpi-card span {
    display: block;
    color: rgba(255,255,255,0.72);
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    margin-bottom: 8px;
  }

  .kpi-card strong {
    display: block;
    font-size: 42px;
    line-height: 1;
    letter-spacing: -0.05em;
    background: linear-gradient(135deg, #ffffff, rgba(255,255,255,0.85));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .kpi-footer {
    position: relative; z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 10px;
  }

  .kpi-card small {
    color: rgba(255,255,255,0.6);
    font-size: 14px;
    font-weight: 900;
  }

  .kpi-change {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 0 9px;
    border-radius: 999px;
    font-size: 13px;
    font-style: normal;
    font-weight: 950;
    white-space: nowrap;
  }

  .kpi-change.positive {
    color: #bbf7d0;
    border: 1px solid rgba(16,185,129,0.3);
    background: rgba(16,185,129,0.15);
  }

  .kpi-change.negative {
    color: #fecdd3;
    border: 1px solid rgba(244,63,94,0.3);
    background: rgba(244,63,94,0.15);
  }

  .kpi-change.neutral {
    color: #bfdbfe;
    border: 1px solid rgba(96,165,250,0.22);
    background: rgba(59,130,246,0.1);
  }

  /* ── Section dividers ──────────────────────────────────── */

  .section-divider {
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 28px 0 18px;
  }

  .section-divider-label {
    font-size: 12px;
    font-weight: 950;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #6272a4;
    white-space: nowrap;
  }

  .section-divider-line {
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, rgba(255,255,255,0.07), transparent);
  }

  /* ── Chart cards ───────────────────────────────────────── */

  .chart-grid {
    display: grid;
    grid-template-columns: minmax(0,1fr) minmax(0,1.12fr);
    gap: 18px;
    margin-bottom: 18px;
  }

  .chart-card, .panel {
    position: relative;
    overflow: visible;
    border-radius: 28px;
    padding: 22px;
    transition: box-shadow 0.2s ease;
  }

  .chart-card:hover {
    box-shadow: 0 28px 80px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.06);
  }

  .chart-card::before, .panel::before {
    content: "";
    position: absolute;
    inset: -110px auto auto -110px;
    width: 250px; height: 250px;
    border-radius: 999px;
    background: rgba(59,130,246,0.06);
    filter: blur(42px);
    pointer-events: none;
  }

  .chart-card > *, .panel > * { position:relative; z-index:1; }
  .chart-card.large { min-height: 390px; }

  .chart-head, .section-title-row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
    margin-bottom: 18px;
  }

  .title-with-help, .label-with-help {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .title-with-help h2 { margin-bottom: 0; }

  .info-tip {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 22px; height: 22px;
    flex: 0 0 auto;
    border-radius: 999px;
    color: #e0f2fe;
    border: 1px solid rgba(125,211,252,0.48);
    background: rgba(14,165,233,0.16);
    box-shadow: 0 0 18px rgba(56,189,248,0.18);
    font-size: 15px;
    font-weight: 950;
    line-height: 1;
    cursor: help;
    z-index: 50;
    transition: background 0.18s ease, box-shadow 0.18s ease;
  }

  .info-tip:hover {
    background: rgba(14,165,233,0.26);
    box-shadow: 0 0 26px rgba(56,189,248,0.32);
  }

  .info-tip-bubble {
    position: absolute;
    left: 50%; bottom: calc(100% + 12px);
    z-index: 1000000;
    width: min(360px, 80vw);
    transform: translateX(-50%) translateY(8px);
    padding: 12px 14px;
    border-radius: 14px;
    color: #e5ebff;
    border: 1px solid rgba(147,197,253,0.3);
    background:
      radial-gradient(circle at top right, rgba(124,58,237,0.18), transparent 35%),
      #070b18;
    box-shadow: 0 26px 70px rgba(0,0,0,0.68);
    font-size: 14px;
    font-weight: 800;
    line-height: 1.55;
    letter-spacing: 0;
    text-transform: none;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.18s ease, transform 0.18s ease;
  }

  .info-tip:hover .info-tip-bubble,
  .info-tip:focus .info-tip-bubble { opacity:1; transform:translateX(-50%) translateY(0); }

  .chart-head h3, .section-title-row h2, .panel h2 {
    margin: 0 0 6px;
    font-size: 26px;
    letter-spacing: -0.045em;
  }

  .chart-head p { margin:0; color:#a9b4d0; font-size:15px; }

  .chart-card .card-action { opacity:0.86; transition:opacity 160ms ease, transform 160ms ease; }
  .chart-card:hover .card-action { opacity:1; transform:translateY(-1px); }

  /* ── Hover cards (tooltips on charts) ──────────────────── */

  .chart-hover-card {
    pointer-events: none;
    position: absolute;
    z-index: 30;
    min-width: 190px;
    max-width: 300px;
    padding: 12px 14px;
    border-radius: 16px;
    color: #f8fbff;
    border: 1px solid rgba(147,197,253,0.24);
    background:
      radial-gradient(circle at top right, rgba(124,58,237,0.18), transparent 36%),
      #111827;
    box-shadow:
      0 22px 55px rgba(0,0,0,0.58),
      inset 0 1px 0 rgba(255,255,255,0.06);
    text-align: left;
    backdrop-filter: blur(8px);
  }

  .chart-hover-card strong, .chart-hover-card small { display:block; }
  .chart-hover-card strong { color:#ffffff; font-size:17px; line-height:1.35; }
  .chart-hover-card small { margin-top:4px; color:#dbeafe; font-size:15px; font-weight:900; }

  .bar-hover-card { right:18px; top:50%; transform:translateY(-50%); }

  /* ── Horizontal bar charts ──────────────────────────────── */

  .bar-list { display:grid; gap:12px; }

  .bar-item {
    position: relative;
    overflow: visible;
    width: 100%;
    text-align: left;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.07);
    background: rgba(255,255,255,0.025);
    padding: 14px;
    color: #eef3ff;
    cursor: pointer;
    transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
  }

  .bar-item:hover {
    transform: translateX(3px);
    border-color: rgba(96,165,250,0.28);
    background: rgba(59,130,246,0.07);
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
  }

  .bar-line {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
    align-items: center;
  }

  .bar-line strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:15px; }
  .bar-line span { color:#cdd7ff; font-size:14px; font-weight:900; white-space:nowrap; }

  .bar-track {
    height: 10px;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(255,255,255,0.06);
  }

  .bar-fill {
    height: 100%;
    border-radius: 999px;
    transition: width 0.6s cubic-bezier(0.34,1.56,0.64,1);
    position: relative;
  }

  .bar-fill::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(90deg, transparent 60%, rgba(255,255,255,0.18));
  }

  /* ── Donut charts ──────────────────────────────────────── */

  .donut-layout {
    display: grid;
    grid-template-columns: minmax(220px,280px) minmax(280px,1fr);
    gap: 22px;
    align-items: center;
    min-height: 300px;
  }

  .donut {
    width: 280px; height: 280px;
    max-width: 100%;
    border-radius: 50%;
    display: grid;
    place-items: center;
    box-shadow: 0 20px 50px rgba(0,0,0,0.4);
  }

  .svg-donut {
    position: relative;
    overflow: visible;
    background: transparent;
  }

  .svg-donut svg, .svg-donut .donut-hole { grid-area: 1 / 1; }

  .svg-donut svg {
    width: 100%; height: 100%;
    transform: rotate(-90deg);
    overflow: visible;
  }

  .donut-base-ring {
    fill: none;
    stroke: rgba(255,255,255,0.05);
    stroke-width: 48;
  }

  .donut-segment {
    fill: none;
    stroke-width: 48;
    stroke-linecap: butt;
    cursor: pointer;
    transition: opacity 0.2s ease, stroke-width 0.2s ease, filter 0.2s ease;
    outline: none;
  }

  .donut-segment:hover, .donut-segment:focus {
    opacity: 0.88;
    stroke-width: 56;
    filter: drop-shadow(0 0 8px currentColor);
  }

  .donut-hover-card {
    left: 50%; top: 50%;
    transform: translate(-50%, -118%);
    text-align: center;
  }

  .donut-hole {
    width: 58%; height: 58%;
    display: grid;
    place-items: center;
    text-align: center;
    border-radius: 50%;
    background: linear-gradient(180deg, rgba(12,18,34,0.98), rgba(7,10,22,1));
    border: 1px solid rgba(255,255,255,0.06);
  }

  .donut-hole strong {
    display: block;
    font-size: 36px;
    letter-spacing: -0.04em;
    background: linear-gradient(135deg, #ffffff, rgba(255,255,255,0.8));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .donut-hole span {
    display: block;
    color: #8ea0d6;
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .donut-legend { display:grid; gap:10px; }

  .donut-legend button {
    display: grid;
    grid-template-columns: 12px minmax(180px,1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 10px 14px;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.07);
    background: rgba(255,255,255,0.025);
    color: #eef3ff;
    cursor: pointer;
    text-align: left;
    transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
  }

  .donut-legend button:hover {
    transform: translateX(3px);
    border-color: rgba(96,165,250,0.24);
    background: rgba(59,130,246,0.06);
    box-shadow: 0 6px 18px rgba(0,0,0,0.16);
  }

  .donut-legend i {
    width: 12px; height: 12px;
    border-radius: 50%;
    box-shadow: 0 0 12px currentColor;
  }

  .donut-legend strong { overflow:visible; text-overflow:clip; white-space:normal; line-height:1.25; min-width:0; }
  .donut-legend span { color:#cdd7ff; font-size:14px; font-weight:900; white-space:nowrap; padding-left:10px; }

  /* ── Leaderboard ─────────────────────────────────────── */

  .leaderboard-panel { margin-bottom: 18px; }

  .leaderboard-cards {
    display: grid;
    grid-template-columns: repeat(4, minmax(0,1fr));
    gap: 14px;
    margin-bottom: 18px;
  }

  .mini-rank-card {
    display: grid;
    gap: 10px;
    border-radius: 22px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.025);
    padding: 16px;
    transition: box-shadow 0.2s ease;
  }

  .mini-rank-card:hover {
    box-shadow: 0 16px 40px rgba(0,0,0,0.3);
  }

  .mini-rank-card.green {
    background:
      radial-gradient(circle at top left, rgba(16,185,129,0.12), transparent 36%),
      linear-gradient(180deg, rgba(16,185,129,0.08), rgba(255,255,255,0.025));
    border-color: rgba(16,185,129,0.14);
  }

  .mini-rank-card.red {
    background:
      radial-gradient(circle at top left, rgba(239,68,68,0.13), transparent 36%),
      linear-gradient(180deg, rgba(239,68,68,0.09), rgba(255,255,255,0.025));
    border-color: rgba(239,68,68,0.14);
  }

  .mini-rank-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 26px;
  }

  .mini-rank-card h3 { margin: 0 0 4px; font-size: 20px; }

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
    transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
  }

  .mini-rank-card button:hover {
    transform: translateY(-2px);
    border-color: rgba(255,255,255,0.16);
    background: rgba(255,255,255,0.05);
    box-shadow: 0 10px 24px rgba(0,0,0,0.24);
  }

  .mini-rank-card button span { color:#ffffff; font-weight:900; }
  .mini-rank-card button small { color:#8ea0d6; font-weight:900; }

  /* ── Tables ─────────────────────────────────────────── */

  .leaderboard-table-wrap { max-height: 660px; }

  .table-wrap, .weekly-table-wrap, .modal-table-wrap {
    overflow: auto;
    border-radius: 22px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(4,8,20,0.72);
  }

  table { width:100%; min-width:1280px; border-collapse:collapse; }

  th {
    position: sticky; top: 0; z-index: 2;
    padding: 14px 12px;
    text-align: left;
    color: #8ea0d6;
    background: rgba(10,18,34,0.98);
    border-bottom: 1px solid rgba(255,255,255,0.08);
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  td {
    padding: 14px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    color: #e5ebff;
    vertical-align: top;
    transition: background 0.14s ease;
  }

  tr:nth-child(even) td { background: rgba(255,255,255,0.018); }
  tr:hover td { background: rgba(59,130,246,0.05); }

  td.good { color:#bbf7d0; font-weight:900; }
  td.bad { color:#fecdd3; font-weight:900; }

  td small { display:block; margin-top:6px; color:#8ea0d6; line-height:1.55; }

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
    font-weight: 900;
    font-size: 14px;
    transition: border-color 0.16s, background 0.16s;
  }

  td a:hover { border-color: rgba(96,165,250,0.28); background: rgba(59,130,246,0.08); }

  .text-link { border:0; padding:0; color:#ffffff; background:transparent; font-weight:900; cursor:pointer; text-align:left; }
  .text-link:hover { color:#93c5fd; }

  /* ── Weekly panel ─────────────────────────────────────── */

  .weekly-panel { margin-bottom: 18px; }

  .weekly-controls {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    flex-wrap: wrap;
  }

  .weekly-controls label { min-width: 260px; }

  .weekly-fixed-scope { display:grid; gap:8px; min-width:260px; }

  .weekly-fixed-scope strong {
    min-height: 46px;
    display: flex;
    align-items: center;
    padding: 0 16px;
    border-radius: 14px;
    border: 1px solid rgba(115,135,190,0.22);
    background: linear-gradient(135deg, rgba(9,18,38,0.95), rgba(18,28,55,0.86));
    color: #f7fbff;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
    white-space: nowrap;
  }

  .weekly-table-wrap { max-height: 620px; }

  .sticky-col { position:sticky; left:0; z-index:3; background:rgba(10,18,34,0.98); }
  td.sticky-col { background: rgba(7,12,25,0.98); }

  .metric-cell {
    width: 100%; min-height: 36px; min-width: 72px;
    border-radius: 12px;
    color: #7684a7;
    border: 1px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.025);
    cursor: default;
    font-weight: 900;
    transition: transform 0.14s ease, box-shadow 0.14s ease;
  }

  .metric-cell.has-data {
    color: #ffffff;
    cursor: pointer;
    border-color: rgba(96,165,250,0.18);
    background: linear-gradient(135deg, rgba(37,99,235,0.22), rgba(168,85,247,0.14));
  }

  .metric-cell.has-data:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(0,0,0,0.2);
  }

  /* ── Drill modal ────────────────────────────────────────── */

  .modal-backdrop {
    position: fixed; inset: 0; z-index: 200000;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgba(2,5,14,0.8);
    backdrop-filter: blur(16px);
  }

  .drill-modal {
    position: relative; z-index: 200001;
    width: min(1440px, 96vw);
    max-height: 92vh;
    overflow: visible;
    border-radius: 30px;
    border: 1px solid rgba(255,255,255,0.09);
    background: linear-gradient(180deg, rgba(15,22,43,0.98), rgba(7,10,24,0.99));
    box-shadow: 0 30px 90px rgba(0,0,0,0.58);
    animation: modalSlideIn 0.2s ease-out;
  }

  @keyframes modalSlideIn {
    from { opacity: 0; transform: translateY(12px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .modal-head {
    display: flex;
    justify-content: space-between;
    gap: 18px;
    padding: 22px 24px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }

  .modal-head h2 { margin:0 0 8px; font-size:30px; letter-spacing:-0.04em; }
  .modal-head span { color:#a9b4d0; }
  .modal-actions { display:flex; gap:10px; align-items:center; }

  .modal-filter-block {
    position: relative; z-index: 30;
    padding: 16px 24px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    background: #0b1122;
  }

  .modal-filter-block .filter-panel {
    position: relative; z-index: 40;
    isolation: auto; padding: 0; margin: 0 0 12px;
    border: 0; border-radius: 0;
    background: transparent; box-shadow: none;
  }

  .modal-filter-block .filter-row.first {
    grid-template-columns: minmax(260px,1.2fr) minmax(210px,1fr) minmax(210px,1fr) auto;
  }

  .modal-filter-block .filter-row.second {
    grid-template-columns: repeat(4, minmax(0,1fr)) auto;
  }

  .modal-filter-block .date-picker-popover,
  .modal-filter-block .multi-menu { z-index: 200010; }

  .modal-search { display:block; }

  .modal-table-wrap {
    position: relative; z-index: 1;
    max-height: calc(92vh - 360px);
    border-radius: 0 0 30px 30px;
    border-left: 0; border-right: 0; border-bottom: 0;
  }

  /* ── Misc ───────────────────────────────────────────── */

  .table-note, .empty-box {
    padding: 18px;
    color: #a9b4d0;
    border-radius: 16px;
    border: 1px dashed rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.02);
  }

  .empty-box.compact { padding: 12px; }

  .error-box {
    border-radius: 18px;
    border: 1px solid rgba(244,63,94,0.22);
    background: rgba(244,63,94,0.08);
    padding: 16px;
    color: #fecdd3;
  }

  .loading-panel { padding: 34px; }

  .explorer-panel { margin-top: 18px; }
  .explorer-panel .section-title-row { align-items: center; }
  .explorer-table-wrap { max-height: 520px; }
  .explorer-panel:not(.expanded) .explorer-table-wrap { max-height: 520px; }

  .jump-top {
    position: fixed;
    right: 22px; bottom: 22px;
    z-index: 1500;
    min-height: 46px;
    padding: 0 16px;
    border-radius: 999px;
    border: 1px solid rgba(59,130,246,0.28);
    background: rgba(8,13,28,0.94);
    color: #dbeafe;
    font: inherit;
    font-size: 15px;
    font-weight: 900;
    cursor: pointer;
    box-shadow: 0 16px 40px rgba(0,0,0,0.38);
    backdrop-filter: blur(8px);
    transition: transform 0.18s ease, box-shadow 0.18s ease;
  }

  .jump-top:hover {
    box-shadow: 0 20px 48px rgba(0,0,0,0.46);
  }

  /* ── Premium calendar ───────────────────────────────── */

  .upgraded-date-popover { border-radius: 24px; }
  .premium-calendar-panel { padding: 18px; }
  .calendar-panel-head { margin-bottom: 14px; }
  .calendar-panel-head strong { color: #ffffff; font-size: 18px; }
  .range-field-tabs { display: flex; gap: 8px; margin-top: 12px; }
  .range-field-tabs button {
    min-height: 38px; padding: 0 14px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.09);
    background: rgba(255,255,255,0.03);
    color: #a9b4d0;
    cursor: pointer; font: inherit; font-size: 15px; font-weight: 800;
    transition: border-color 0.16s, background 0.16s, color 0.16s;
  }
  .range-field-tabs button.active { color: #ffffff; border-color: rgba(96,165,250,0.32); background: rgba(59,130,246,0.14); }
  .calendar-toolbar {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    margin: 14px 0 10px;
  }
  .calendar-toolbar button {
    min-height: 36px; min-width: 36px; padding: 0 10px;
    border-radius: 11px;
    border: 1px solid rgba(255,255,255,0.09);
    background: rgba(255,255,255,0.04);
    color: #dbeafe; cursor: pointer; font: inherit; font-weight: 900;
  }
  .calendar-toolbar strong { color: #ffffff; font-size: 16px; }
  .calendar-months-grid { display: grid; gap: 16px; }
  .calendar-month {}
  .calendar-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-bottom: 6px; }
  .calendar-weekdays span { text-align: center; color: #8ea0d6; font-size: 13px; font-weight: 900; padding: 4px 0; }
  .calendar-grid-days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
  .calendar-day {
    min-height: 38px; border-radius: 11px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; font-size: 15px; font-weight: 800; color: #e5ebff;
    border: 1px solid transparent;
    background: transparent;
    transition: background 0.14s, border-color 0.14s, color 0.14s;
  }
  .calendar-day:hover { background: rgba(59,130,246,0.14); border-color: rgba(59,130,246,0.22); }
  .calendar-day.selected { background: rgba(59,130,246,0.28); border-color: rgba(96,165,250,0.4); color: #ffffff; }
  .calendar-day.in-range { background: rgba(59,130,246,0.1); }
  .calendar-day.today { border-color: rgba(245,158,11,0.4); color: #fde68a; }
  .calendar-day.blank { cursor: default; background: transparent; }
  .calendar-day.outside { color: rgba(255,255,255,0.3); }
  .calendar-day.disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
  .premium-calendar-actions { margin-top: 14px; justify-content: flex-end; }

  /* ── Conversation preview modal ─────────────────────────── */

  .conversation-preview-backdrop {
    position: fixed; inset: 0; z-index: 300000;
    display: grid; place-items: center; padding: 20px;
    background: rgba(2,5,14,0.82);
    backdrop-filter: blur(18px);
  }

  .conversation-preview-modal {
    position: relative;
    width: min(1440px, 96vw);
    max-height: 94vh;
    display: flex; flex-direction: column;
    border-radius: 30px;
    border: 1px solid rgba(255,255,255,0.09);
    background: linear-gradient(180deg, rgba(13,18,38,0.99), rgba(6,8,18,0.99));
    box-shadow: 0 36px 110px rgba(0,0,0,0.66);
    overflow: hidden;
    animation: modalSlideIn 0.22s ease-out;
  }

  .conversation-preview-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 18px 22px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    flex-shrink: 0;
  }

  .conversation-preview-actions { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }

  .conversation-preview-loading {
    display: grid; place-items: center;
    min-height: 200px;
    color: #a9b4d0;
    font-size: 17px;
  }

  .conversation-preview-loaded { display:flex; flex-direction:column; flex:1; overflow:hidden; }

  .conversation-preview-error.inline {
    padding: 20px;
    color: #fecaca;
    display: grid;
    gap: 6px;
  }

  .conversation-preview-result-strip {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    padding: 14px 22px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }

  .conversation-preview-result-card {
    padding: 10px 14px;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.07);
    background: rgba(255,255,255,0.03);
    font-size: 15px;
    font-weight: 800;
    color: #e5ebff;
  }

  .conversation-preview-result-card.positive { border-color:rgba(16,185,129,0.22); background:rgba(16,185,129,0.08); color:#bbf7d0; }
  .conversation-preview-result-card.negative { border-color:rgba(244,63,94,0.22); background:rgba(244,63,94,0.08); color:#fecdd3; }
  .conversation-preview-result-card.warning { border-color:rgba(245,158,11,0.22); background:rgba(245,158,11,0.08); color:#fde68a; }

  .conversation-preview-body {
    display: grid;
    grid-template-columns: 280px minmax(0,1fr);
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }

  .conversation-preview-body.has-dispute {
    grid-template-columns: 280px minmax(0,1fr) 340px;
  }

  .conversation-preview-sidebar {
    border-right: 1px solid rgba(255,255,255,0.08);
    overflow-y: auto;
    padding: 16px;
  }

  .conversation-preview-sidebar-title {
    color: #8ea0d6;
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    margin-bottom: 14px;
  }

  .conversation-preview-compact-section { margin-bottom: 16px; }

  .conversation-preview-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
    color: #6272a4;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .conversation-preview-attribute-list { display:grid; gap:6px; }

  .conversation-preview-attr-row {
    display: grid;
    grid-template-columns: minmax(80px,0.8fr) minmax(0,1fr);
    gap: 8px;
    padding: 8px 10px;
    border-radius: 11px;
    background: rgba(255,255,255,0.025);
    border: 1px solid rgba(255,255,255,0.06);
    font-size: 14px;
  }

  .conversation-preview-attr-row > span:first-child { color:#8ea0d6; font-weight:800; }
  .conversation-preview-attr-row > span:last-child { color:#e5ebff; font-weight:800; word-break:break-word; }

  .conversation-preview-tags { display:flex; flex-wrap:wrap; gap:6px; }
  .conversation-preview-tags span { padding:4px 10px; border-radius:999px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.09); color:#c7d5f6; font-size:13px; font-weight:800; }

  .conversation-preview-main {
    overflow-y: auto;
    padding: 16px;
  }

  .conversation-preview-verdict {
    margin-bottom: 16px;
    padding: 14px;
    border-radius: 18px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03);
  }

  .conversation-preview-verdict-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
  }

  .conversation-transcript-list { display:grid; gap:12px; }

  .conversation-timeline-event {
    padding: 8px 12px;
    border-radius: 12px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.07);
    color: #8ea0d6;
    font-size: 14px;
    font-weight: 700;
    text-align: center;
  }

  .conversation-message {
    display: grid;
    gap: 6px;
  }

  .conversation-message-top { display:flex; align-items:center; gap:10px; }
  .conversation-message-top strong { color:#ffffff; font-size:15px; font-weight:900; }
  .conversation-message-top span { color:#8ea0d6; font-size:13px; font-weight:800; }

  .conversation-message.user { padding-left: 0; }

  .conversation-message.human_agent .conversation-message-top strong { color: #93c5fd; }
  .conversation-message.bot .conversation-message-top strong { color: #a78bfa; }
  .conversation-message.system .conversation-message-top strong { color: #6272a4; }

  .conversation-preview-dispute-panel {
    border-left: 1px solid rgba(255,255,255,0.08);
    overflow-y: auto;
    padding: 16px;
  }

  .conversation-preview-empty {
    padding: 24px;
    color: #8ea0d6;
    text-align: center;
    border: 1px dashed rgba(255,255,255,0.1);
    border-radius: 16px;
  }

  .preview-unavailable {
    color: #6272a4;
    font-size: 14px;
    font-weight: 800;
  }

  .conversation-action-buttons { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }

  .mini-preview-btn, .mini-open-link {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    padding: 0 10px;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 900;
    cursor: pointer;
    text-decoration: none;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.04);
    color: #e5ebff;
    transition: border-color 0.16s, background 0.16s;
  }

  .mini-preview-btn:hover, .mini-open-link:hover { border-color:rgba(96,165,250,0.28); background:rgba(59,130,246,0.08); }

  .mini-verdict-btn {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    padding: 0 10px;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 900;
    cursor: pointer;
    border: 1px solid rgba(245,158,11,0.22);
    background: rgba(245,158,11,0.07);
    color: #fde68a;
    transition: border-color 0.16s, background 0.16s;
  }

  .mini-verdict-btn.active, .mini-verdict-btn:hover {
    border-color: rgba(245,158,11,0.36);
    background: rgba(245,158,11,0.14);
  }

  /* ── ID Search panel ────────────────────────────────── */

  .conversation-id-search-panel { padding: 22px; margin-bottom: 18px; border-radius: 28px; }

  .conversation-id-search-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 16px;
  }

  .conversation-id-search-head p { margin:0 0 6px; }
  .conversation-id-search-head h2 { margin:0 0 6px; font-size:24px; letter-spacing:-0.04em; }
  .conversation-id-search-head span { color:#a9b4d0; font-size:15px; line-height:1.6; }

  .conversation-id-search-box { display:block; }

  .conversation-id-search-box span {
    display: block;
    margin-bottom: 8px;
    color: #8ea0d6;
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  .conversation-id-search-box textarea {
    width: 100%;
    padding: 12px 14px;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.09);
    background: rgba(5,8,18,0.9);
    color: #e7ecff;
    font: inherit;
    font-size: 16px;
    resize: vertical;
    outline: none;
    transition: border-color 0.18s ease;
  }

  .conversation-id-search-box textarea:focus {
    border-color: rgba(96,165,250,0.38);
    box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
  }

  .conversation-id-search-results { margin-top: 14px; }

  .conversation-id-search-summary {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }

  .conversation-id-search-summary strong { color:#34d399; font-size:17px; }
  .conversation-id-search-summary span { color:#a9b4d0; font-size:15px; }

  .conversation-id-missing {
    padding: 10px 14px;
    border-radius: 12px;
    background: rgba(244,63,94,0.08);
    border: 1px solid rgba(244,63,94,0.2);
    color: #fecdd3;
    font-size: 14px;
    font-weight: 800;
    margin-bottom: 12px;
  }

  .conversation-id-result-wrap { max-height: 360px; }

  /* ── Run help tip ──────────────────────────────────── */

  .run-help-tip {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 18px; height: 18px;
    border-radius: 999px;
    border: 1px solid rgba(148,163,184,0.36);
    background: rgba(30,41,59,0.6);
    color: #94a3b8;
    font-size: 12px;
    font-weight: 900;
    cursor: help;
    vertical-align: middle;
    margin-left: 4px;
  }

  .run-help-tip b { font-style: normal; }

  .run-help-tip i {
    display: none;
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 2000;
    min-width: 220px;
    padding: 10px 12px;
    border-radius: 12px;
    background: #0b1122;
    border: 1px solid rgba(255,255,255,0.1);
    box-shadow: 0 16px 40px rgba(0,0,0,0.5);
    color: #e5ebff;
    font-size: 13px;
    font-weight: 700;
    line-height: 1.5;
    font-style: normal;
    text-transform: none;
    letter-spacing: 0;
    white-space: normal;
  }

  .run-help-tip:hover i { display: block; }

  /* ── Overview feature grid ──────────────────────────── */

  .overview-feature-grid {
    display: grid;
    grid-template-columns: minmax(300px,0.72fr) minmax(0,1fr);
    gap: 18px;
    margin-bottom: 18px;
    align-items: stretch;
  }

  .current-view-card {
    position: relative;
    overflow: hidden;
    padding: 22px;
    border-radius: 28px;
    border: 1px solid rgba(255,255,255,0.08);
    background:
      radial-gradient(circle at top right, rgba(34,211,238,0.1), transparent 40%),
      linear-gradient(180deg, rgba(14,20,40,0.94), rgba(7,10,24,0.97));
    box-shadow: 0 24px 80px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.04);
  }

  .current-view-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 16px;
  }

  .current-view-head p { margin:0 0 6px; }
  .current-view-head strong { color:#ffffff; font-size:22px; letter-spacing:-0.04em; display:block; margin-bottom:4px; }
  .current-view-head span { color:#a9b4d0; font-size:15px; }

  .current-view-stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0,1fr));
    gap: 10px;
  }

  .current-view-stats div {
    padding: 14px;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.07);
    background: rgba(255,255,255,0.03);
    transition: border-color 0.18s, background 0.18s;
  }

  .current-view-stats div:hover {
    border-color: rgba(96,165,250,0.18);
    background: rgba(59,130,246,0.05);
  }

  .current-view-stats span { display:block; margin-bottom:6px; color:#8ea0d6; font-size:13px; font-weight:900; letter-spacing:0.1em; text-transform:uppercase; }
  .current-view-stats strong { display:block; color:#f5f7ff; font-size:22px; letter-spacing:-0.04em; }

  /* ── Sentiment / resolution grid ───────────────────── */

  .sentiment-resolution-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0,1fr));
    gap: 18px;
    margin-bottom: 18px;
  }

  /* ── Slim hero ──────────────────────────────────────── */

  .slim-hero .hero-copy strong { font-size: 36px; }
  .slim-hero .hero-copy span { font-size: 15px; }

  .compact-hero {
    padding: 26px 30px;
    grid-template-columns: 1fr;
    margin-bottom: 14px;
  }

  /* ── Reset button ───────────────────────────────────── */

  .reset-btn {
    white-space: nowrap;
    min-height: 48px;
    padding: 0 18px;
    background: linear-gradient(135deg, #2563eb, #7c3aed, #db2777) !important;
    box-shadow: 0 12px 28px rgba(91,33,182,0.3) !important;
    border: 0 !important;
  }

  /* ── KPI head row ───────────────────────────────────── */

  .kpi-head-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }

  /* ── Responsive ─────────────────────────────────────── */

  @media (max-width: 1250px) {
    .hero-panel { grid-template-columns: 1fr; }
    .filter-row.first,
    .filter-row.second,
    .kpi-grid,
    .leaderboard-cards,
    .insight-strip { grid-template-columns: repeat(2, minmax(0,1fr)); }
    .chart-grid { grid-template-columns: 1fr; }
    .donut-layout { grid-template-columns: 1fr; justify-items: center; }
    .overview-feature-grid { grid-template-columns: 1fr; }
    .sentiment-resolution-grid { grid-template-columns: 1fr; }
  }

  @media (max-width: 760px) {
    .dashboard-page { padding: 16px 12px 60px; }

    .hero-panel,
    .chart-head,
    .section-title-row,
    .modal-head { flex-direction: column; align-items: stretch; }

    .hero-panel { padding: 20px; }

    .filter-row.first,
    .filter-row.second,
    .kpi-grid,
    .leaderboard-cards,
    .custom-range-grid,
    .insight-strip,
    .hero-metric-grid,
    .overview-feature-grid,
    .sentiment-resolution-grid { grid-template-columns: 1fr; }

    .insight-strip div { border-right:0; border-bottom:1px solid rgba(255,255,255,0.07); }
    .insight-strip div:last-child { border-bottom: 0; }

    .date-picker-popover { width:92vw; grid-template-columns:1fr; }

    .modal-filter-block .filter-row.first,
    .modal-filter-block .filter-row.second { grid-template-columns: 1fr; }

    .date-preset-list { border-right:0; border-bottom:1px solid rgba(255,255,255,0.08); }
    .hero-panel h1 { font-size: 42px; }
    .kpi-card strong { font-size: 32px; -webkit-text-fill-color: #ffffff; }
    .donut-layout { grid-template-columns: 1fr; justify-items: center; }
    .conversation-preview-body { grid-template-columns: 1fr; }
    .conversation-preview-body.has-dispute { grid-template-columns: 1fr; }
    .conversation-preview-sidebar { border-right:0; border-bottom:1px solid rgba(255,255,255,0.08); order:-1; max-height:46vh; }
    .modal-filter-block .filter-row.first,
    .modal-filter-block .filter-row.second { grid-template-columns: repeat(2, minmax(0,1fr)); }
  }

  @media (max-width: 1060px) {
    .breakdown-grid .donut-layout,
    .overview-feature-grid .donut-layout,
    .sentiment-resolution-grid .donut-layout { grid-template-columns: 1fr; }
    .drill-modal { width: 98vw; height: 96vh; }
    .modal-head { grid-template-columns: 1fr; }
  }

`;
