"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

function CalendarButton({ onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        width: "42px",
        height: "42px",
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,0.08)",
        background:
          "linear-gradient(180deg, rgba(15,22,43,0.95), rgba(8,12,26,0.98))",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        boxShadow: "0 8px 20px rgba(0,0,0,0.28)",
        flexShrink: 0,
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
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
          stroke="url(#calendarGradient)"
          strokeWidth="1.5"
        />
        <circle cx="8.5" cy="13" r="1" fill="#8B5CF6" />
        <circle cx="12" cy="13" r="1" fill="#2563EB" />
        <circle cx="15.5" cy="13" r="1" fill="#DB2777" />
        <circle cx="8.5" cy="16.5" r="1" fill="#2563EB" />
        <circle cx="12" cy="16.5" r="1" fill="#06B6D4" />
        <circle cx="15.5" cy="16.5" r="1" fill="#8B5CF6" />
        <defs>
          <linearGradient
            id="calendarGradient"
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
    </button>
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

function statusPillStyles(value) {
  if (value === "Resolved") {
    return {
      border: "1px solid rgba(16,185,129,0.22)",
      background: "rgba(16,185,129,0.12)",
      color: "#bbf7d0",
    };
  }

  if (value === "Pending") {
    return {
      border: "1px solid rgba(59,130,246,0.22)",
      background: "rgba(59,130,246,0.12)",
      color: "#bfdbfe",
    };
  }

  if (value === "Unresolved") {
    return {
      border: "1px solid rgba(244,63,94,0.22)",
      background: "rgba(244,63,94,0.12)",
      color: "#fecdd3",
    };
  }

  return {
    border: "1px solid rgba(168,85,247,0.22)",
    background: "rgba(168,85,247,0.12)",
    color: "#e9d5ff",
  };
}

const FETCH_PROGRESS_MESSAGES = [
  "Preparing low-CSAT conversation search...",
  "Checking your access and server session...",
  "Connecting to Intercom securely...",
  "Searching selected date window...",
  "Collecting eligible low-CSAT conversations...",
  "Finalizing fetched conversation list...",
];

export default function RunPage() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [limiterEnabled, setLimiterEnabled] = useState(true);
  const [limitCount, setLimitCount] = useState("10");

  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMessage, setAuthMessage] = useState("");

  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchMessageIndex, setFetchMessageIndex] = useState(0);
  const [fetchError, setFetchError] = useState("");
  const [fetchSuccess, setFetchSuccess] = useState("");
  const [fetchData, setFetchData] = useState(null);

  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState("");
  const [runSuccess, setRunSuccess] = useState("");
  const [runData, setRunData] = useState(null);

  const startDateRef = useRef(null);
  const endDateRef = useRef(null);

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
      setFetchMessageIndex((prev) => {
        if (prev >= FETCH_PROGRESS_MESSAGES.length - 1) return prev;
        return prev + 1;
      });
    }, 1400);

    return () => clearInterval(interval);
  }, [fetchLoading]);

  async function handleGoogleLogin() {
    setAuthMessage("");

    const redirectTo =
      typeof window !== "undefined" ? `${window.location.origin}/run` : undefined;

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
    setFetchData(null);
    setFetchError("");
    setFetchSuccess("");
    setRunData(null);
    setRunError("");
    setRunSuccess("");
  }

  async function handleFetchConversations() {
    setFetchError("");
    setFetchSuccess("");
    setFetchData(null);
    setRunData(null);
    setRunError("");
    setRunSuccess("");

    if (!session?.access_token) {
      setFetchError("Your login session is missing. Please sign in again.");
      return;
    }

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

    setFetchLoading(true);
    setFetchMessageIndex(0);

    try {
      const response = await fetch("/api/audits/fetch-conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          startDate,
          endDate,
          limiterEnabled,
          limitCount,
          debug: true,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Conversation fetch failed.");
      }

      setFetchData(data);

      if ((data?.meta?.fetchedCount || 0) > 0) {
        setFetchSuccess(
          `Intercom connection successful. ${data.meta.fetchedCount} low-CSAT conversation(s) fetched.`
        );
      } else {
        setFetchSuccess(data?.message || "Fetch completed with no conversations found.");
      }
    } catch (error) {
      setFetchError(
        error instanceof Error ? error.message : "Conversation fetch failed."
      );
    } finally {
      setFetchLoading(false);
    }
  }

  async function handleRunAudit() {
    setRunError("");
    setRunSuccess("");
    setRunData(null);

    if (!fetchData?.meta?.fetchedCount) {
      setRunError("Please fetch conversations first.");
      return;
    }

    if (!session?.access_token) {
      setRunError("Your login session is missing. Please sign in again.");
      return;
    }

    if (!startDate || !endDate) {
      setRunError("Please choose both a start date and an end date.");
      return;
    }

    setRunLoading(true);

    try {
      const response = await fetch("/api/audits/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          startDate,
          endDate,
          limiterEnabled,
          limitCount,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Audit run failed.");
      }

      setRunData(data);
      setRunSuccess(data?.message || "Audit run completed.");
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Audit run failed.");
    } finally {
      setRunLoading(false);
    }
  }

  const canRunTests =
    profile?.is_active === true &&
    (profile?.role === "master_admin" ||
      profile?.role === "admin" ||
      profile?.can_run_tests === true);

  const isMasterAdmin = profile?.role === "master_admin";

  const statCards = [
    {
      label: "Authentication",
      value: session?.user ? "Google Connected" : "Google Login Required",
      subtext: "Only nextventures.io users can enter",
    },
    {
      label: "Access Control",
      value: isMasterAdmin ? "Master Admin Active" : "Permission Controlled",
      subtext: "faiyaz@nextventures.io stays permanent admin",
    },
    {
      label: "Intercom Fetch",
      value: fetchData?.meta?.fetchedCount > 0 ? "Connection Confirmed" : "Awaiting Fetch",
      subtext: fetchData?.meta?.fetchedCount
        ? `${fetchData.meta.fetchedCount} low-CSAT conversation(s) fetched`
        : "Use Fetch Conversations to verify retrieval",
    },
    {
      label: "AI Processing",
      value: runData?.meta?.processedCount ? "Audit Completed" : "Awaiting Run",
      subtext: runData?.meta?.processedCount
        ? `${runData.meta.processedCount} conversation(s) processed`
        : "Run Audit appears after a successful fetch",
    },
  ];

  const controlCards = [
    {
      eyebrow: "Access Model",
      title: "Google login + nextventures.io restriction",
      description:
        "Only approved users with a @nextventures.io email will be allowed into the system.",
    },
    {
      eyebrow: "Admin Control",
      title: "Master admin + test runner permissions",
      description:
        "You will stay the permanent master admin, and the admin panel will control who can run tests during development.",
    },
    {
      eyebrow: "Development Limiter",
      title: "Run only the number you choose",
      description:
        "When limiter is on, the fetch step and audit step will only use that many conversations. When limiter is off, the system will fetch all eligible conversations in the selected date range.",
    },
    {
      eyebrow: "Prompt Control",
      title: "Edit the live GPT prompt from admin",
      description:
        "Prompt logic should live in Admin/Supabase so future prompt updates do not require code changes.",
    },
  ];

  const summaryText = useMemo(() => {
    if (authLoading) {
      return "Checking login and access status.";
    }

    if (!session?.user) {
      return "Sign in with your Google account to continue.";
    }

    if (profile && !canRunTests) {
      return "You are signed in, but test-run access is not enabled for this account yet.";
    }

    if (!startDate && !endDate) {
      return "Choose a start date and end date to prepare a controlled audit run.";
    }

    if (fetchLoading) {
      return FETCH_PROGRESS_MESSAGES[fetchMessageIndex];
    }

    if (fetchData?.meta?.fetchedCount > 0 && !runData) {
      return `Fetch completed. ${fetchData.meta.fetchedCount} low-CSAT conversation(s) are ready for audit from ${fetchData.meta.startDate} to ${fetchData.meta.endDate}.`;
    }

    if (runLoading) {
      return "Running GPT audit on the fetched conversations. Please wait.";
    }

    if (runData?.meta?.processedCount >= 0) {
      return `Latest run processed ${runData.meta.processedCount} conversation(s) for ${runData.meta.startDate} to ${runData.meta.endDate}.`;
    }

    if (startDate && endDate && limiterEnabled) {
      return `Ready to fetch low-CSAT conversations from ${startDate} to ${endDate} with limiter enabled for ${limitCount || "0"} conversation(s).`;
    }

    if (startDate && endDate) {
      return `Ready to fetch all eligible low-CSAT conversations from ${startDate} to ${endDate}.`;
    }

    return "Choose a start date and end date to prepare a controlled audit run.";
  }, [
    authLoading,
    session,
    profile,
    canRunTests,
    startDate,
    endDate,
    limiterEnabled,
    limitCount,
    fetchLoading,
    fetchMessageIndex,
    fetchData,
    runLoading,
    runData,
  ]);

  const inputBaseStyle = {
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

  const fetchedConversations = Array.isArray(fetchData?.conversations)
    ? fetchData.conversations
    : [];
  const dailySummary = Array.isArray(fetchData?.debug?.dailySummary)
    ? fetchData.debug.dailySummary
    : [];
  const results = Array.isArray(runData?.results) ? runData.results : [];
  const successCount = results.filter((item) => !item.error).length;
  const errorCount = results.filter((item) => item.error).length;

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(59,130,246,0.16), transparent 22%), radial-gradient(circle at top right, rgba(168,85,247,0.14), transparent 20%), radial-gradient(circle at bottom center, rgba(6,182,212,0.08), transparent 22%), linear-gradient(180deg, #040714 0%, #060b1d 45%, #04060d 100%)",
        color: "#f5f7ff",
        padding: "32px 20px 60px",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {fetchLoading && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2,6,23,0.72)",
            backdropFilter: "blur(8px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "560px",
              borderRadius: "28px",
              border: "1px solid rgba(255,255,255,0.08)",
              background:
                "linear-gradient(180deg, rgba(10,16,34,0.96), rgba(7,11,24,0.98))",
              boxShadow:
                "0 30px 100px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)",
              padding: "28px",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "#8ea0d6",
                marginBottom: "12px",
              }}
            >
              Fetching Conversations
            </div>

            <div
              style={{
                fontSize: "32px",
                lineHeight: 1.08,
                letterSpacing: "-0.04em",
                fontWeight: 700,
                marginBottom: "14px",
              }}
            >
              Please wait while the system checks Intercom.
            </div>

            <div
              style={{
                color: "#dbe7ff",
                fontSize: "15px",
                lineHeight: 1.7,
                marginBottom: "20px",
              }}
            >
              {FETCH_PROGRESS_MESSAGES[fetchMessageIndex]}
            </div>

            <div
              style={{
                height: "12px",
                borderRadius: "999px",
                background: "rgba(255,255,255,0.06)",
                overflow: "hidden",
                marginBottom: "16px",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${((fetchMessageIndex + 1) / FETCH_PROGRESS_MESSAGES.length) * 100}%`,
                  borderRadius: "999px",
                  background:
                    "linear-gradient(135deg, #2563eb 0%, #7c3aed 50%, #db2777 100%)",
                  transition: "width 0.4s ease",
                }}
              />
            </div>

            <div
              style={{
                color: "#8ea0d6",
                fontSize: "13px",
                lineHeight: 1.6,
              }}
            >
              Step {fetchMessageIndex + 1} of {FETCH_PROGRESS_MESSAGES.length}
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
        <div
          style={{
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
          }}
        >
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
                background: fetchLoading || runLoading ? "#f59e0b" : "#34d399",
                boxShadow:
                  fetchLoading || runLoading ? "0 0 12px #f59e0b" : "0 0 12px #34d399",
                display: "inline-block",
              }}
            />
            {fetchLoading ? "Fetching Conversations" : runLoading ? "Running Audit" : "Run Analysis"}
          </div>
        </div>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.35fr) minmax(320px, 0.85fr)",
            gap: "24px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              border: "1px solid rgba(255,255,255,0.08)",
              background:
                "linear-gradient(180deg, rgba(15,22,43,0.9), rgba(7,10,24,0.96))",
              borderRadius: "28px",
              padding: "32px",
              boxShadow:
                "0 20px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
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
              Premium Internal Tool
            </div>

            <h1
              style={{
                fontSize: "54px",
                lineHeight: 1.02,
                letterSpacing: "-0.05em",
                margin: "0 0 18px",
                maxWidth: "780px",
              }}
            >
              Audit Intercom conversations by date range with controlled GPT execution.
            </h1>

            <p
              style={{
                margin: "0 0 20px",
                color: "#a9b4d0",
                fontSize: "18px",
                lineHeight: 1.7,
                maxWidth: "760px",
              }}
            >
              First fetch eligible low-CSAT conversations, confirm the Intercom connection,
              then run the GPT audit only after the fetch step completes successfully.
            </p>

            <div
              style={{
                borderRadius: "18px",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.03)",
                padding: "16px",
                marginBottom: "18px",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  color: "#8ea0d6",
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  marginBottom: "8px",
                }}
              >
                Login Status
              </div>

              {authLoading ? (
                <div style={{ color: "#dbe7ff", fontSize: "15px" }}>
                  Checking your session...
                </div>
              ) : session?.user ? (
                <div style={{ display: "grid", gap: "8px" }}>
                  <div style={{ color: "#dbe7ff", fontSize: "15px", fontWeight: 600 }}>
                    Signed in as {session.user.email}
                  </div>
                  <div style={{ color: "#a9b4d0", fontSize: "14px" }}>
                    Role: {profile?.role || "viewer"} | Can run tests: {canRunTests ? "Yes" : "No"}
                  </div>
                </div>
              ) : (
                <div style={{ color: "#dbe7ff", fontSize: "15px" }}>
                  You are not signed in yet.
                </div>
              )}

              {authMessage ? (
                <div
                  style={{
                    marginTop: "12px",
                    color: "#fda4af",
                    fontSize: "14px",
                    lineHeight: 1.6,
                  }}
                >
                  {authMessage}
                </div>
              ) : null}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: "14px",
                marginBottom: "14px",
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
                <label
                  htmlFor="start-date"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    color: "#8ea0d6",
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    marginBottom: "8px",
                  }}
                >
                  Start Date
                </label>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                  }}
                >
                  <input
                    ref={startDateRef}
                    id="start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      setFetchData(null);
                      setFetchError("");
                      setFetchSuccess("");
                      setRunData(null);
                      setRunError("");
                      setRunSuccess("");
                    }}
                    onFocus={() => openPicker(startDateRef)}
                    style={inputBaseStyle}
                  />
                  <CalendarButton
                    onClick={() => openPicker(startDateRef)}
                    label="Open start date picker"
                  />
                </div>
              </div>

              <div
                style={{
                  borderRadius: "18px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  padding: "16px",
                }}
              >
                <label
                  htmlFor="end-date"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    color: "#8ea0d6",
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    marginBottom: "8px",
                  }}
                >
                  End Date
                </label>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                  }}
                >
                  <input
                    ref={endDateRef}
                    id="end-date"
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      setFetchData(null);
                      setFetchError("");
                      setFetchSuccess("");
                      setRunData(null);
                      setRunError("");
                      setRunSuccess("");
                    }}
                    onFocus={() => openPicker(endDateRef)}
                    style={inputBaseStyle}
                  />
                  <CalendarButton
                    onClick={() => openPicker(endDateRef)}
                    label="Open end date picker"
                  />
                </div>
              </div>
            </div>

            <div
              style={{
                borderRadius: "18px",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.03)",
                padding: "16px",
                marginBottom: "14px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "16px",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#8ea0d6",
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                      marginBottom: "8px",
                    }}
                  >
                    Development Limiter
                  </div>
                  <div
                    style={{
                      color: "#e7ecff",
                      fontSize: "16px",
                      fontWeight: 600,
                    }}
                  >
                    {limiterEnabled ? "Limiter is ON" : "Limiter is OFF"}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setLimiterEnabled((prev) => !prev);
                    setFetchData(null);
                    setFetchError("");
                    setFetchSuccess("");
                    setRunData(null);
                    setRunError("");
                    setRunSuccess("");
                  }}
                  style={{
                    position: "relative",
                    width: "72px",
                    height: "40px",
                    borderRadius: "999px",
                    border: limiterEnabled
                      ? "1px solid rgba(96,165,250,0.45)"
                      : "1px solid rgba(255,255,255,0.12)",
                    background: limiterEnabled
                      ? "linear-gradient(135deg, rgba(37,99,235,0.9), rgba(168,85,247,0.85))"
                      : "rgba(255,255,255,0.08)",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: "4px",
                      left: limiterEnabled ? "36px" : "4px",
                      width: "30px",
                      height: "30px",
                      borderRadius: "999px",
                      background: "#ffffff",
                      boxShadow: "0 6px 14px rgba(0,0,0,0.35)",
                    }}
                  />
                </button>
              </div>
            </div>

            {limiterEnabled && (
              <div
                style={{
                  borderRadius: "18px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  padding: "16px",
                  marginBottom: "20px",
                }}
              >
                <label
                  htmlFor="limit-count"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    color: "#8ea0d6",
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    marginBottom: "8px",
                  }}
                >
                  Number of Conversations to Use
                </label>
                <input
                  id="limit-count"
                  type="number"
                  min="1"
                  step="1"
                  value={limitCount}
                  onChange={(e) => {
                    setLimitCount(e.target.value);
                    setFetchData(null);
                    setFetchError("");
                    setFetchSuccess("");
                    setRunData(null);
                    setRunError("");
                    setRunSuccess("");
                  }}
                  placeholder="Enter a number"
                  style={inputBaseStyle}
                />
              </div>
            )}

            <div
              style={{
                display: "flex",
                gap: "14px",
                flexWrap: "wrap",
                marginBottom: "22px",
              }}
            >
              {!session?.user ? (
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  style={{
                    border: "none",
                    borderRadius: "16px",
                    padding: "14px 20px",
                    fontSize: "15px",
                    fontWeight: 700,
                    color: "#ffffff",
                    cursor: "pointer",
                    background:
                      "linear-gradient(135deg, #2563eb 0%, #7c3aed 50%, #db2777 100%)",
                    boxShadow: "0 14px 30px rgba(91,33,182,0.35)",
                  }}
                >
                  Sign in with Google
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleLogout}
                  style={{
                    border: "none",
                    borderRadius: "16px",
                    padding: "14px 20px",
                    fontSize: "15px",
                    fontWeight: 700,
                    color: "#ffffff",
                    cursor: "pointer",
                    background:
                      "linear-gradient(135deg, #2563eb 0%, #7c3aed 50%, #db2777 100%)",
                    boxShadow: "0 14px 30px rgba(91,33,182,0.35)",
                  }}
                >
                  Sign out
                </button>
              )}

              <button
                type="button"
                onClick={handleFetchConversations}
                disabled={
                  !canRunTests ||
                  !session?.user ||
                  !startDate ||
                  !endDate ||
                  fetchLoading ||
                  runLoading
                }
                style={{
                  borderRadius: "16px",
                  padding: "14px 20px",
                  fontSize: "15px",
                  fontWeight: 700,
                  color:
                    !canRunTests || !session?.user || !startDate || !endDate || fetchLoading || runLoading
                      ? "rgba(229,235,255,0.45)"
                      : "#ffffff",
                  cursor:
                    !canRunTests || !session?.user || !startDate || !endDate || fetchLoading || runLoading
                      ? "not-allowed"
                      : "pointer",
                  background:
                    !canRunTests || !session?.user || !startDate || !endDate || fetchLoading || runLoading
                      ? "rgba(255,255,255,0.03)"
                      : "linear-gradient(135deg, #2563eb 0%, #7c3aed 50%, #db2777 100%)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  opacity:
                    !canRunTests || !session?.user || !startDate || !endDate || fetchLoading || runLoading
                      ? 0.6
                      : 1,
                  boxShadow:
                    !canRunTests || !session?.user || !startDate || !endDate || fetchLoading || runLoading
                      ? "none"
                      : "0 14px 30px rgba(91,33,182,0.35)",
                }}
              >
                {fetchLoading ? "Fetching..." : "Fetch Conversations"}
              </button>

              {fetchData?.meta?.fetchedCount > 0 && (
                <button
                  type="button"
                  onClick={handleRunAudit}
                  disabled={runLoading || fetchLoading}
                  style={{
                    borderRadius: "16px",
                    padding: "14px 20px",
                    fontSize: "15px",
                    fontWeight: 700,
                    color: runLoading ? "rgba(229,235,255,0.45)" : "#e5ebff",
                    cursor: runLoading ? "not-allowed" : "pointer",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    opacity: runLoading ? 0.6 : 1,
                  }}
                >
                  {runLoading ? "Running Audit..." : "Run Audit"}
                </button>
              )}
            </div>

            {(fetchError || fetchSuccess) && (
              <div
                style={{
                  borderRadius: "18px",
                  border: fetchError
                    ? "1px solid rgba(244,63,94,0.22)"
                    : "1px solid rgba(16,185,129,0.22)",
                  background: fetchError
                    ? "rgba(244,63,94,0.08)"
                    : "rgba(16,185,129,0.08)",
                  padding: "14px 16px",
                  marginBottom: "14px",
                  color: fetchError ? "#fecdd3" : "#bbf7d0",
                  fontSize: "14px",
                  lineHeight: 1.6,
                }}
              >
                {fetchError || fetchSuccess}
              </div>
            )}

            {(runError || runSuccess) && (
              <div
                style={{
                  borderRadius: "18px",
                  border: runError
                    ? "1px solid rgba(244,63,94,0.22)"
                    : "1px solid rgba(16,185,129,0.22)",
                  background: runError
                    ? "rgba(244,63,94,0.08)"
                    : "rgba(16,185,129,0.08)",
                  padding: "14px 16px",
                  marginBottom: "18px",
                  color: runError ? "#fecdd3" : "#bbf7d0",
                  fontSize: "14px",
                  lineHeight: 1.6,
                }}
              >
                {runError || runSuccess}
              </div>
            )}

            <div
              style={{
                borderRadius: "22px",
                border: "1px solid rgba(255,255,255,0.08)",
                background:
                  "linear-gradient(180deg, rgba(8,12,27,0.9), rgba(10,14,30,0.95))",
                padding: "22px",
              }}
            >
              <div
                style={{
                  fontSize: "13px",
                  color: "#8ea0d6",
                  marginBottom: "12px",
                }}
              >
                Current run summary
              </div>

              <div
                style={{
                  color: "#d8e2ff",
                  fontSize: "15px",
                  lineHeight: 1.7,
                }}
              >
                {summaryText}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: "18px" }}>
            {controlCards.map((card) => (
              <div
                key={card.title}
                style={{
                  border: "1px solid rgba(255,255,255,0.08)",
                  background:
                    "linear-gradient(180deg, rgba(14,20,40,0.9), rgba(8,12,26,0.95))",
                  borderRadius: "24px",
                  padding: "22px",
                  boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
                }}
              >
                <div
                  style={{
                    color: "#8ea0d6",
                    fontSize: "13px",
                    marginBottom: "8px",
                  }}
                >
                  {card.eyebrow}
                </div>
                <div
                  style={{
                    fontSize: "22px",
                    fontWeight: 700,
                    marginBottom: "8px",
                  }}
                >
                  {card.title}
                </div>
                <p
                  style={{
                    margin: 0,
                    color: "#a9b4d0",
                    lineHeight: 1.7,
                    fontSize: "15px",
                  }}
                >
                  {card.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: "18px",
            marginBottom: "24px",
          }}
        >
          {statCards.map((item) => (
            <div
              key={item.label}
              style={{
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(9, 13, 28, 0.84)",
                borderRadius: "22px",
                padding: "22px",
                boxShadow:
                  "0 14px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.03)",
              }}
            >
              <div
                style={{
                  color: "#8ea0d6",
                  fontSize: "12px",
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  marginBottom: "10px",
                }}
              >
                {item.label}
              </div>
              <div
                style={{
                  fontSize: "20px",
                  fontWeight: 700,
                  marginBottom: "8px",
                }}
              >
                {item.value}
              </div>
              <div
                style={{
                  color: "#a9b4d0",
                  fontSize: "14px",
                  lineHeight: 1.6,
                }}
              >
                {item.subtext}
              </div>
            </div>
          ))}
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.1fr)",
            gap: "24px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              border: "1px solid rgba(255,255,255,0.08)",
              background:
                "linear-gradient(180deg, rgba(10,15,32,0.9), rgba(7,10,22,0.96))",
              borderRadius: "28px",
              padding: "28px",
              boxShadow:
                "0 20px 60px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.03)",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "#8ea0d6",
                marginBottom: "10px",
              }}
            >
              Fetched Conversations
            </div>

            <h2
              style={{
                margin: "0 0 18px",
                fontSize: "34px",
                lineHeight: 1.05,
                letterSpacing: "-0.04em",
              }}
            >
              Fetch stage output
            </h2>

            {!fetchData ? (
              <div
                style={{
                  borderRadius: "22px",
                  border: "1px dashed rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.02)",
                  padding: "24px",
                  color: "#a9b4d0",
                  lineHeight: 1.7,
                  fontSize: "15px",
                }}
              >
                No fetch has been completed yet. Select your date range, choose the limiter if needed,
                and click Fetch Conversations first.
              </div>
            ) : (
              <div style={{ display: "grid", gap: "16px" }}>
                <div
                  style={{
                    borderRadius: "20px",
                    border: "1px solid rgba(16,185,129,0.18)",
                    background: "rgba(16,185,129,0.08)",
                    padding: "18px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      textTransform: "uppercase",
                      letterSpacing: "0.14em",
                      color: "#86efac",
                      marginBottom: "8px",
                    }}
                  >
                    Connection Status
                  </div>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: "#dcfce7" }}>
                    {fetchData?.meta?.fetchedCount > 0
                      ? "Intercom connection successful"
                      : "Fetch completed but no conversations returned"}
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: "12px",
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
                    <div style={{ fontSize: "12px", color: "#8ea0d6", marginBottom: "8px" }}>
                      Fetched Count
                    </div>
                    <div style={{ fontSize: "30px", fontWeight: 700 }}>
                      {fetchData?.meta?.fetchedCount || 0}
                    </div>
                  </div>

                  <div
                    style={{
                      borderRadius: "18px",
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.03)",
                      padding: "16px",
                    }}
                  >
                    <div style={{ fontSize: "12px", color: "#8ea0d6", marginBottom: "8px" }}>
                      Date Window
                    </div>
                    <div style={{ fontSize: "16px", fontWeight: 700 }}>
                      {fetchData?.meta?.startDate || "-"} to {fetchData?.meta?.endDate || "-"}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    borderRadius: "18px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    padding: "16px",
                    color: "#d8e2ff",
                    fontSize: "14px",
                    lineHeight: 1.7,
                  }}
                >
                  <strong>Limiter:</strong>{" "}
                  {fetchData?.meta?.limiterEnabled
                    ? `ON (${fetchData?.meta?.limitCount})`
                    : "OFF"}
                  <br />
                  <strong>Searched dates:</strong>{" "}
                  {Array.isArray(fetchData?.meta?.searchedDates)
                    ? fetchData.meta.searchedDates.join(", ")
                    : "-"}
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              border: "1px solid rgba(255,255,255,0.08)",
              background:
                "linear-gradient(180deg, rgba(10,15,32,0.9), rgba(7,10,22,0.96))",
              borderRadius: "28px",
              padding: "28px",
              boxShadow:
                "0 20px 60px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.03)",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "#8ea0d6",
                marginBottom: "10px",
              }}
            >
              Fetched Preview
            </div>

            <h2
              style={{
                margin: "0 0 18px",
                fontSize: "34px",
                lineHeight: 1.05,
                letterSpacing: "-0.04em",
              }}
            >
              Conversation preview list
            </h2>

            {fetchedConversations.length === 0 ? (
              <div
                style={{
                  borderRadius: "22px",
                  border: "1px dashed rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.02)",
                  padding: "24px",
                  color: "#a9b4d0",
                  lineHeight: 1.7,
                  fontSize: "15px",
                }}
              >
                Once conversations are fetched, a preview list will appear here before audit begins.
              </div>
            ) : (
              <div style={{ display: "grid", gap: "14px", maxHeight: "640px", overflow: "auto", paddingRight: "4px" }}>
                {fetchedConversations.map((item, index) => (
                  <div
                    key={item?.conversationId || `fetched-${index}`}
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
                        <div
                          style={{
                            fontSize: "12px",
                            color: "#8ea0d6",
                            marginBottom: "6px",
                            textTransform: "uppercase",
                            letterSpacing: "0.12em",
                          }}
                        >
                          Conversation
                        </div>
                        <div style={{ fontSize: "18px", fontWeight: 700 }}>
                          {item?.conversationId || "-"}
                        </div>
                      </div>

                      <div
                        style={{
                          ...statusPillStyles("Pending"),
                          borderRadius: "999px",
                          padding: "9px 12px",
                          fontSize: "12px",
                          fontWeight: 700,
                          alignSelf: "flex-start",
                        }}
                      >
                        Low CSAT Candidate
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                        gap: "10px",
                      }}
                    >
                      <div
                        style={{
                          borderRadius: "14px",
                          background: "rgba(0,0,0,0.14)",
                          padding: "12px",
                        }}
                      >
                        <div style={{ fontSize: "11px", color: "#8ea0d6", marginBottom: "6px" }}>
                          Agent
                        </div>
                        <div style={{ fontSize: "14px", fontWeight: 600 }}>
                          {item?.agentName || "Unassigned"}
                        </div>
                      </div>

                      <div
                        style={{
                          borderRadius: "14px",
                          background: "rgba(0,0,0,0.14)",
                          padding: "12px",
                        }}
                      >
                        <div style={{ fontSize: "11px", color: "#8ea0d6", marginBottom: "6px" }}>
                          Client Email
                        </div>
                        <div style={{ fontSize: "14px", fontWeight: 600 }}>
                          {item?.clientEmail || "-"}
                        </div>
                      </div>

                      <div
                        style={{
                          borderRadius: "14px",
                          background: "rgba(0,0,0,0.14)",
                          padding: "12px",
                        }}
                      >
                        <div style={{ fontSize: "11px", color: "#8ea0d6", marginBottom: "6px" }}>
                          CSAT Score
                        </div>
                        <div style={{ fontSize: "14px", fontWeight: 600 }}>
                          {item?.csatScore || "-"}
                        </div>
                      </div>

                      <div
                        style={{
                          borderRadius: "14px",
                          background: "rgba(0,0,0,0.14)",
                          padding: "12px",
                        }}
                      >
                        <div style={{ fontSize: "11px", color: "#8ea0d6", marginBottom: "6px" }}>
                          Replied At
                        </div>
                        <div style={{ fontSize: "14px", fontWeight: 600 }}>
                          {item?.repliedAt || "-"}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background:
              "linear-gradient(180deg, rgba(10,15,32,0.9), rgba(7,10,22,0.96))",
            borderRadius: "28px",
            padding: "28px",
            boxShadow:
              "0 20px 60px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.03)",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#8ea0d6",
              marginBottom: "10px",
            }}
          >
            Debug Output
          </div>

          <h2
            style={{
              margin: "0 0 18px",
              fontSize: "34px",
              lineHeight: 1.05,
              letterSpacing: "-0.04em",
            }}
          >
            Raw Intercom fetch diagnostics
          </h2>

          {!fetchData ? (
            <div
              style={{
                borderRadius: "22px",
                border: "1px dashed rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.02)",
                padding: "24px",
                color: "#a9b4d0",
                lineHeight: 1.7,
                fontSize: "15px",
              }}
            >
              Run Fetch Conversations first. This panel will then show the exact low-CSAT search diagnostics returned by the backend.
            </div>
          ) : (
            <div style={{ display: "grid", gap: "16px" }}>
              <div
                style={{
                  borderRadius: "18px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  padding: "16px",
                  color: "#d8e2ff",
                  fontSize: "14px",
                  lineHeight: 1.7,
                }}
              >
                <strong>intercomPerPage:</strong> {fetchData?.debug?.intercomPerPage ?? "-"}
                <br />
                <strong>maxFetchPagesPerDay:</strong> {fetchData?.debug?.maxFetchPagesPerDay ?? "-"}
                <br />
                <strong>Fetched count:</strong> {fetchData?.meta?.fetchedCount ?? 0}
              </div>

              {dailySummary.length === 0 ? (
                <div
                  style={{
                    borderRadius: "18px",
                    border: "1px dashed rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.02)",
                    padding: "20px",
                    color: "#a9b4d0",
                    fontSize: "14px",
                    lineHeight: 1.7,
                  }}
                >
                  No daily debug summary was returned.
                </div>
              ) : (
                dailySummary.map((day, dayIndex) => (
                  <div
                    key={`${day?.date || "day"}-${dayIndex}`}
                    style={{
                      borderRadius: "20px",
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.03)",
                      padding: "18px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                        flexWrap: "wrap",
                        marginBottom: "12px",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: "12px",
                            color: "#8ea0d6",
                            textTransform: "uppercase",
                            letterSpacing: "0.12em",
                            marginBottom: "6px",
                          }}
                        >
                          Date
                        </div>
                        <div style={{ fontSize: "20px", fontWeight: 700 }}>
                          {day?.date || "-"}
                        </div>
                      </div>

                      <div
                        style={{
                          borderRadius: "999px",
                          border: "1px solid rgba(96,165,250,0.22)",
                          background: "rgba(96,165,250,0.1)",
                          padding: "8px 12px",
                          fontSize: "12px",
                          fontWeight: 700,
                          color: "#bfdbfe",
                          alignSelf: "flex-start",
                        }}
                      >
                        fetchedCount: {day?.fetchedCount ?? 0}
                      </div>
                    </div>

                    <div
                      style={{
                        borderRadius: "16px",
                        background: "rgba(0,0,0,0.16)",
                        padding: "14px",
                        color: "#d8e2ff",
                        fontSize: "13px",
                        lineHeight: 1.7,
                        marginBottom: "12px",
                      }}
                    >
                      <strong>sinceTs:</strong> {day?.sinceTs ?? "-"}
                      <br />
                      <strong>untilTs:</strong> {day?.untilTs ?? "-"}
                    </div>

                    {Array.isArray(day?.pages) && day.pages.length > 0 ? (
                      <div style={{ display: "grid", gap: "12px" }}>
                        {day.pages.map((page, pageIndex) => (
                          <div
                            key={`${day?.date || "page"}-${pageIndex}`}
                            style={{
                              borderRadius: "16px",
                              border: "1px solid rgba(255,255,255,0.08)",
                              background: "rgba(0,0,0,0.14)",
                              padding: "14px",
                            }}
                          >
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                                gap: "10px",
                                marginBottom: "10px",
                              }}
                            >
                              <div>
                                <div style={{ fontSize: "11px", color: "#8ea0d6", marginBottom: "5px" }}>
                                  Page
                                </div>
                                <div style={{ fontSize: "14px", fontWeight: 600 }}>
                                  {page?.pageIndex ?? "-"}
                                </div>
                              </div>

                              <div>
                                <div style={{ fontSize: "11px", color: "#8ea0d6", marginBottom: "5px" }}>
                                  HTTP Status
                                </div>
                                <div style={{ fontSize: "14px", fontWeight: 600 }}>
                                  {page?.httpStatus ?? "-"}
                                </div>
                              </div>

                              <div>
                                <div style={{ fontSize: "11px", color: "#8ea0d6", marginBottom: "5px" }}>
                                  OK
                                </div>
                                <div style={{ fontSize: "14px", fontWeight: 600 }}>
                                  {String(page?.ok)}
                                </div>
                              </div>

                              <div>
                                <div style={{ fontSize: "11px", color: "#8ea0d6", marginBottom: "5px" }}>
                                  Returned Count
                                </div>
                                <div style={{ fontSize: "14px", fontWeight: 600 }}>
                                  {page?.returnedCount ?? 0}
                                </div>
                              </div>

                              <div>
                                <div style={{ fontSize: "11px", color: "#8ea0d6", marginBottom: "5px" }}>
                                  Next Cursor
                                </div>
                                <div style={{ fontSize: "14px", fontWeight: 600, wordBreak: "break-all" }}>
                                  {page?.nextCursor || "None"}
                                </div>
                              </div>
                            </div>

                            <div
                              style={{
                                borderRadius: "12px",
                                background: "rgba(255,255,255,0.03)",
                                padding: "12px",
                                color: "#d8e2ff",
                                fontSize: "12px",
                                lineHeight: 1.7,
                                marginBottom: "10px",
                              }}
                            >
                              <strong>Sample IDs:</strong>{" "}
                              {Array.isArray(page?.sampleIds) && page.sampleIds.length > 0
                                ? page.sampleIds.join(", ")
                                : "None"}
                            </div>

                            <div
                              style={{
                                borderRadius: "12px",
                                background: "rgba(255,255,255,0.03)",
                                padding: "12px",
                                color: "#d8e2ff",
                                fontSize: "12px",
                                lineHeight: 1.7,
                                marginBottom: "10px",
                                wordBreak: "break-word",
                              }}
                            >
                              <strong>Content-Type:</strong> {page?.contentType || "None"}
                              <br />
                              <strong>Response Excerpt:</strong>{" "}
                              {page?.responseExcerpt ? page.responseExcerpt : "None"}
                            </div>

                            <details>
                              <summary
                                style={{
                                  cursor: "pointer",
                                  color: "#c7d2fe",
                                  fontSize: "13px",
                                  fontWeight: 600,
                                }}
                              >
                                View request payload
                              </summary>
                              <pre
                                style={{
                                  marginTop: "10px",
                                  whiteSpace: "pre-wrap",
                                  wordBreak: "break-word",
                                  fontSize: "12px",
                                  lineHeight: 1.7,
                                  color: "#dbe7ff",
                                  background: "rgba(255,255,255,0.03)",
                                  borderRadius: "12px",
                                  padding: "12px",
                                  overflowX: "auto",
                                }}
                              >
                                {JSON.stringify(page?.request || {}, null, 2)}
                              </pre>
                            </details>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div
                        style={{
                          borderRadius: "14px",
                          border: "1px dashed rgba(255,255,255,0.12)",
                          background: "rgba(255,255,255,0.02)",
                          padding: "14px",
                          color: "#a9b4d0",
                          fontSize: "13px",
                          lineHeight: 1.7,
                        }}
                      >
                        No page-level debug entries were returned for this day.
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </section>

        <section
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background:
              "linear-gradient(180deg, rgba(10,15,32,0.9), rgba(7,10,22,0.96))",
            borderRadius: "28px",
            padding: "28px",
            boxShadow:
              "0 20px 60px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.03)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "16px",
              flexWrap: "wrap",
              marginBottom: "20px",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "12px",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "#8ea0d6",
                  marginBottom: "10px",
                }}
              >
                Audit Output Preview
              </div>
              <h2
                style={{
                  margin: 0,
                  fontSize: "34px",
                  lineHeight: 1.05,
                  letterSpacing: "-0.04em",
                }}
              >
                GPT result cards
              </h2>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(140px, 1fr))",
                gap: "12px",
                minWidth: "min(100%, 460px)",
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
                <div style={{ fontSize: "12px", color: "#8ea0d6", marginBottom: "8px" }}>
                  Processed
                </div>
                <div style={{ fontSize: "26px", fontWeight: 700 }}>
                  {runData?.meta?.processedCount ?? 0}
                </div>
              </div>

              <div
                style={{
                  borderRadius: "18px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  padding: "16px",
                }}
              >
                <div style={{ fontSize: "12px", color: "#8ea0d6", marginBottom: "8px" }}>
                  Success
                </div>
                <div style={{ fontSize: "26px", fontWeight: 700, color: "#bbf7d0" }}>
                  {successCount}
                </div>
              </div>

              <div
                style={{
                  borderRadius: "18px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  padding: "16px",
                }}
              >
                <div style={{ fontSize: "12px", color: "#8ea0d6", marginBottom: "8px" }}>
                  Errors
                </div>
                <div style={{ fontSize: "26px", fontWeight: 700, color: "#fecdd3" }}>
                  {errorCount}
                </div>
              </div>
            </div>
          </div>

          {!runData ? (
            <div
              style={{
                borderRadius: "22px",
                border: "1px dashed rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.02)",
                padding: "24px",
                color: "#a9b4d0",
                lineHeight: 1.7,
                fontSize: "15px",
              }}
            >
              Fetch conversations first. After a successful fetch, the Run Audit button will appear and GPT result cards will show here.
            </div>
          ) : (
            <div style={{ display: "grid", gap: "18px" }}>
              <div
                style={{
                  borderRadius: "20px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  padding: "18px",
                  color: "#d8e2ff",
                  fontSize: "14px",
                  lineHeight: 1.7,
                }}
              >
                <strong>Run window:</strong> {runData?.meta?.startDate || "-"} to{" "}
                {runData?.meta?.endDate || "-"}
                <br />
                <strong>Requested by:</strong> {runData?.meta?.requestedBy || "-"}
                <br />
                <strong>Limiter:</strong>{" "}
                {runData?.meta?.limiterEnabled ? `ON (${runData?.meta?.limitCount})` : "OFF"}
              </div>

              {results.map((item, index) => {
                const hasError = Boolean(item?.error);

                return (
                  <div
                    key={item?.conversationId || `result-${index}`}
                    style={{
                      borderRadius: "22px",
                      border: hasError
                        ? "1px solid rgba(244,63,94,0.18)"
                        : "1px solid rgba(255,255,255,0.08)",
                      background: hasError
                        ? "linear-gradient(180deg, rgba(40,10,18,0.92), rgba(18,8,12,0.96))"
                        : "linear-gradient(180deg, rgba(12,18,38,0.92), rgba(8,12,24,0.96))",
                      padding: "20px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "16px",
                        flexWrap: "wrap",
                        marginBottom: "14px",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: "12px",
                            color: "#8ea0d6",
                            textTransform: "uppercase",
                            letterSpacing: "0.14em",
                            marginBottom: "8px",
                          }}
                        >
                          Conversation
                        </div>
                        <div
                          style={{
                            fontSize: "22px",
                            fontWeight: 700,
                            letterSpacing: "-0.03em",
                          }}
                        >
                          {item?.conversationId || "Unknown Conversation"}
                        </div>
                      </div>

                      {!hasError && (
                        <div
                          style={{
                            ...statusPillStyles(item?.resolutionStatus),
                            borderRadius: "999px",
                            padding: "9px 12px",
                            fontSize: "12px",
                            fontWeight: 700,
                            alignSelf: "flex-start",
                          }}
                        >
                          {item?.resolutionStatus || "Unclear"}
                        </div>
                      )}
                    </div>

                    {hasError ? (
                      <div
                        style={{
                          color: "#fecdd3",
                          fontSize: "14px",
                          lineHeight: 1.7,
                        }}
                      >
                        {item.error}
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: "16px" }}>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                            gap: "12px",
                          }}
                        >
                          <div
                            style={{
                              borderRadius: "16px",
                              border: "1px solid rgba(255,255,255,0.08)",
                              background: "rgba(255,255,255,0.03)",
                              padding: "14px",
                            }}
                          >
                            <div style={{ fontSize: "12px", color: "#8ea0d6", marginBottom: "8px" }}>
                              Agent
                            </div>
                            <div style={{ fontSize: "15px", fontWeight: 600 }}>
                              {item?.agentName || "Unassigned"}
                            </div>
                          </div>

                          <div
                            style={{
                              borderRadius: "16px",
                              border: "1px solid rgba(255,255,255,0.08)",
                              background: "rgba(255,255,255,0.03)",
                              padding: "14px",
                            }}
                          >
                            <div style={{ fontSize: "12px", color: "#8ea0d6", marginBottom: "8px" }}>
                              Client Email
                            </div>
                            <div style={{ fontSize: "15px", fontWeight: 600 }}>
                              {item?.clientEmail || "-"}
                            </div>
                          </div>

                          <div
                            style={{
                              borderRadius: "16px",
                              border: "1px solid rgba(255,255,255,0.08)",
                              background: "rgba(255,255,255,0.03)",
                              padding: "14px",
                            }}
                          >
                            <div style={{ fontSize: "12px", color: "#8ea0d6", marginBottom: "8px" }}>
                              CSAT
                            </div>
                            <div style={{ fontSize: "15px", fontWeight: 600 }}>
                              {item?.csatScore || "-"}
                            </div>
                          </div>

                          <div
                            style={{
                              borderRadius: "16px",
                              border: "1px solid rgba(255,255,255,0.08)",
                              background: "rgba(255,255,255,0.03)",
                              padding: "14px",
                            }}
                          >
                            <div style={{ fontSize: "12px", color: "#8ea0d6", marginBottom: "8px" }}>
                              Client Sentiment
                            </div>
                            <div style={{ fontSize: "15px", fontWeight: 600 }}>
                              {item?.clientSentiment || "-"}
                            </div>
                          </div>
                        </div>

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
                              fontSize: "12px",
                              color: "#8ea0d6",
                              textTransform: "uppercase",
                              letterSpacing: "0.12em",
                              marginBottom: "10px",
                            }}
                          >
                            AI Verdict
                          </div>
                          <div
                            style={{
                              color: "#e7ecff",
                              fontSize: "15px",
                              lineHeight: 1.7,
                            }}
                          >
                            {item?.aiVerdict || "-"}
                          </div>
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                            gap: "12px",
                          }}
                        >
                          <div
                            style={{
                              borderRadius: "16px",
                              border: "1px solid rgba(255,255,255,0.08)",
                              background: "rgba(255,255,255,0.03)",
                              padding: "14px",
                            }}
                          >
                            <div style={{ fontSize: "12px", color: "#8ea0d6", marginBottom: "8px" }}>
                              Review Sentiment
                            </div>
                            <div style={{ fontSize: "15px", fontWeight: 600 }}>
                              {item?.reviewSentiment || "-"}
                            </div>
                          </div>

                          <div
                            style={{
                              borderRadius: "16px",
                              border: "1px solid rgba(255,255,255,0.08)",
                              background: "rgba(255,255,255,0.03)",
                              padding: "14px",
                            }}
                          >
                            <div style={{ fontSize: "12px", color: "#8ea0d6", marginBottom: "8px" }}>
                              Resolution Status
                            </div>
                            <div style={{ fontSize: "15px", fontWeight: 600 }}>
                              {item?.resolutionStatus || "-"}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
