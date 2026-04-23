"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

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

function getHistoryLabel(item) {
  if (item?.prompt_type === "live_prompt") return "Live Prompt Update";
  if (item?.prompt_type === "original_prompt") return "Original Prompt Record";
  return item?.prompt_type || "Prompt Change";
}

function normalizeAgentKey(value) {
  return String(value || "").trim().toLowerCase();
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

function canManageAdmin(profile) {
  return Boolean(
    profile?.is_active === true &&
      (profile?.role === "master_admin" || profile?.role === "admin")
  );
}

function createEmptyMappingForm() {
  return {
    id: "",
    intercom_agent_name: "",
    employee_name: "",
    employee_email: "",
    team_name: "",
    notes: "",
    is_active: true,
  };
}

function buildSuggestions(existingMappings, auditRows) {
  const existingKeys = new Set(
    (existingMappings || [])
      .map((item) => normalizeAgentKey(item?.intercom_agent_name))
      .filter(Boolean)
  );

  const byAgent = new Map();

  for (const row of auditRows || []) {
    const rawAgent = String(row?.agent_name || "").trim();
    const agentKey = normalizeAgentKey(rawAgent);

    if (!rawAgent || !agentKey) continue;
    if (byAgent.has(agentKey)) continue;

    byAgent.set(agentKey, {
      intercom_agent_name: rawAgent,
      employee_name: String(row?.employee_name || "").trim() || rawAgent,
      employee_email: String(row?.employee_email || "").trim(),
      team_name: String(row?.team_name || "").trim(),
      notes: String(row?.employee_match_status || "").trim()
        ? `Detected from stored audit results. Historical match status: ${row.employee_match_status}.`
        : "Detected from stored audit results.",
      source_created_at: row?.created_at || null,
      result_count: 1,
    });
  }

  const suggestions = Array.from(byAgent.values()).filter(
    (item) => !existingKeys.has(normalizeAgentKey(item.intercom_agent_name))
  );

  return suggestions.sort((a, b) =>
    a.intercom_agent_name.localeCompare(b.intercom_agent_name)
  );
}

function buildUnmappedRows(existingMappings, auditRows) {
  const existingKeys = new Set(
    (existingMappings || [])
      .map((item) => normalizeAgentKey(item?.intercom_agent_name))
      .filter(Boolean)
  );

  const grouped = new Map();

  for (const row of auditRows || []) {
    const rawAgent = String(row?.agent_name || "").trim();
    const agentKey = normalizeAgentKey(rawAgent);
    if (!rawAgent || !agentKey) continue;

    const isStoredMapped =
      String(row?.employee_match_status || "").trim().toLowerCase() === "mapped" &&
      String(row?.employee_name || "").trim();

    const hasMapping = existingKeys.has(agentKey);

    if (hasMapping || isStoredMapped) continue;

    const existing = grouped.get(agentKey) || {
      intercom_agent_name: rawAgent,
      latest_seen_at: row?.created_at || row?.replied_at || null,
      appearances: 0,
      sample_employee_name: String(row?.employee_name || "").trim(),
      sample_employee_email: String(row?.employee_email || "").trim(),
      sample_team_name: String(row?.team_name || "").trim(),
    };

    existing.appearances += 1;

    const currentSeen = new Date(existing.latest_seen_at || 0).getTime();
    const rowSeen = new Date(row?.created_at || row?.replied_at || 0).getTime();

    if (rowSeen > currentSeen) {
      existing.latest_seen_at = row?.created_at || row?.replied_at || null;
      existing.sample_employee_name = String(row?.employee_name || "").trim();
      existing.sample_employee_email = String(row?.employee_email || "").trim();
      existing.sample_team_name = String(row?.team_name || "").trim();
    }

    grouped.set(agentKey, existing);
  }

  return Array.from(grouped.values()).sort((a, b) =>
    a.intercom_agent_name.localeCompare(b.intercom_agent_name)
  );
}

export default function AdminPage() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);

  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(true);

  const [pageError, setPageError] = useState("");
  const [pageSuccess, setPageSuccess] = useState("");

  const [dbReady, setDbReady] = useState(false);
  const [promptData, setPromptData] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);

  const [livePromptInput, setLivePromptInput] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);

  const [mappingRows, setMappingRows] = useState([]);
  const [auditRows, setAuditRows] = useState([]);
  const [mappingLoading, setMappingLoading] = useState(false);
  const [mappingForm, setMappingForm] = useState(createEmptyMappingForm());
  const [mappingSearch, setMappingSearch] = useState("");
  const [mappingSaveLoading, setMappingSaveLoading] = useState(false);
  const [mappingToggleLoadingId, setMappingToggleLoadingId] = useState("");
  const [seedLoading, setSeedLoading] = useState(false);

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

  async function loadPromptData(activeSession) {
    if (!activeSession?.access_token) {
      setPromptData(null);
      setHistoryRows([]);
      setDbReady(false);
      return;
    }

    const response = await fetch("/api/admin/prompt", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${activeSession.access_token}`,
      },
    });

    const data = await response.json();

    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || "Could not load Admin prompt settings.");
    }

    setPromptData(data.prompt || null);
    setHistoryRows(Array.isArray(data.history) ? data.history : []);
    setDbReady(Boolean(data.dbReady));
    setLivePromptInput(data?.prompt?.livePrompt || "");
  }

  async function loadMappingsData() {
    setMappingLoading(true);

    try {
      const [mappingsResponse, auditResponse] = await Promise.all([
        supabase
          .from("agent_mappings")
          .select("*")
          .order("employee_name", { ascending: true })
          .order("intercom_agent_name", { ascending: true }),
        supabase
          .from("audit_results")
          .select(
            "id, agent_name, employee_name, employee_email, team_name, employee_match_status, created_at, replied_at"
          )
          .order("created_at", { ascending: false })
          .limit(5000),
      ]);

      if (mappingsResponse.error) {
        throw new Error(mappingsResponse.error.message || "Could not load agent mappings.");
      }

      if (auditResponse.error) {
        throw new Error(auditResponse.error.message || "Could not load audit rows for mapping.");
      }

      setMappingRows(Array.isArray(mappingsResponse.data) ? mappingsResponse.data : []);
      setAuditRows(Array.isArray(auditResponse.data) ? auditResponse.data : []);
    } finally {
      setMappingLoading(false);
    }
  }

  async function loadAll(activeSession) {
    setLoading(true);
    setPageError("");
    setPageSuccess("");

    try {
      await Promise.all([loadPromptData(activeSession), loadMappingsData()]);
      setPageSuccess("Admin settings loaded successfully.");
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Could not load Admin settings."
      );
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
        setPageError(profileResult.message || "");
        setAuthLoading(false);

        if (profileResult.profile && canManageAdmin(profileResult.profile)) {
          await loadAll(currentSession);
        } else {
          setLoading(false);
        }
      } catch (_error) {
        if (!active) return;
        setPageError("Could not complete session check for Admin.");
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
        setPromptData(null);
        setHistoryRows([]);
        setLivePromptInput("");
        setDbReady(false);
        setMappingRows([]);
        setAuditRows([]);
        setAuthLoading(false);
        setLoading(false);
        return;
      }

      const profileResult = await loadProfile(newSession.user);

      if (!active) return;

      setProfile(profileResult.profile);
      setPageError(profileResult.message || "");
      setAuthLoading(false);

      if (profileResult.profile && canManageAdmin(profileResult.profile)) {
        await loadAll(newSession);
      } else {
        setLoading(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleReload() {
    setPageError("");
    setPageSuccess("");
    await loadAll(session);
  }

  async function handleSavePrompt() {
    setPageError("");
    setPageSuccess("");

    if (!session?.access_token) {
      setPageError("Please sign in first so Admin can save prompt settings.");
      return;
    }

    if (!livePromptInput.trim()) {
      setPageError("Live prompt cannot be empty.");
      return;
    }

    setSaveLoading(true);

    try {
      const response = await fetch("/api/admin/prompt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          livePrompt: livePromptInput,
          changeNote,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Could not save the live prompt.");
      }

      setPromptData(data.prompt || null);
      setHistoryRows(Array.isArray(data.history) ? data.history : []);
      setDbReady(Boolean(data.dbReady));
      setLivePromptInput(data?.prompt?.livePrompt || livePromptInput);
      setChangeNote("");
      setPageSuccess(data?.message || "Live prompt saved successfully.");
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Could not save the live prompt."
      );
    } finally {
      setSaveLoading(false);
    }
  }

  function handleEditMapping(row) {
    setMappingForm({
      id: row?.id || "",
      intercom_agent_name: row?.intercom_agent_name || "",
      employee_name: row?.employee_name || "",
      employee_email: row?.employee_email || "",
      team_name: row?.team_name || "",
      notes: row?.notes || "",
      is_active: row?.is_active !== false,
    });
    setPageError("");
    setPageSuccess("");
  }

  function handleUseSuggestion(item) {
    setMappingForm({
      id: "",
      intercom_agent_name: item?.intercom_agent_name || "",
      employee_name: item?.employee_name || item?.intercom_agent_name || "",
      employee_email: item?.employee_email || "",
      team_name: item?.team_name || "",
      notes: item?.notes || "Detected from stored audit results.",
      is_active: true,
    });
    setPageError("");
    setPageSuccess("Mapping form was prefilled from a detected agent suggestion.");
  }

  function handleResetMappingForm() {
    setMappingForm(createEmptyMappingForm());
    setPageError("");
    setPageSuccess("");
  }

  async function handleSaveMapping() {
    setPageError("");
    setPageSuccess("");

    if (!session?.user) {
      setPageError("Please sign in first so Admin can save agent mappings.");
      return;
    }

    const intercomAgentName = String(mappingForm.intercom_agent_name || "").trim();
    const employeeName =
      String(mappingForm.employee_name || "").trim() || intercomAgentName;
    const employeeEmail = String(mappingForm.employee_email || "").trim();
    const teamName = String(mappingForm.team_name || "").trim();
    const notes = String(mappingForm.notes || "").trim();

    if (!intercomAgentName) {
      setPageError("Intercom agent name is required.");
      return;
    }

    if (!employeeName) {
      setPageError("Employee name is required.");
      return;
    }

    setMappingSaveLoading(true);

    try {
      const existingMatch = mappingRows.find(
        (item) =>
          normalizeAgentKey(item?.intercom_agent_name) ===
          normalizeAgentKey(intercomAgentName)
      );

      const payload = {
        intercom_agent_name: intercomAgentName,
        employee_name: employeeName,
        employee_email: employeeEmail || null,
        team_name: teamName || null,
        notes: notes || null,
        is_active: mappingForm.is_active !== false,
        updated_at: new Date().toISOString(),
      };

      if (mappingForm.id || existingMatch?.id) {
        const targetId = mappingForm.id || existingMatch.id;

        const { error } = await supabase
          .from("agent_mappings")
          .update(payload)
          .eq("id", targetId);

        if (error) {
          throw new Error(error.message || "Could not update the agent mapping.");
        }

        setPageSuccess("Agent mapping updated successfully.");
      } else {
        const { error } = await supabase.from("agent_mappings").insert({
          ...payload,
          created_at: new Date().toISOString(),
        });

        if (error) {
          throw new Error(error.message || "Could not create the agent mapping.");
        }

        setPageSuccess("Agent mapping created successfully.");
      }

      handleResetMappingForm();
      await loadMappingsData();
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Could not save the agent mapping."
      );
    } finally {
      setMappingSaveLoading(false);
    }
  }

  async function handleToggleMappingActive(row) {
    setPageError("");
    setPageSuccess("");
    setMappingToggleLoadingId(row?.id || "");

    try {
      const { error } = await supabase
        .from("agent_mappings")
        .update({
          is_active: row?.is_active ? false : true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      if (error) {
        throw new Error(error.message || "Could not update mapping status.");
      }

      setPageSuccess(
        row?.is_active
          ? "Agent mapping was deactivated. Historical results stay preserved."
          : "Agent mapping was reactivated successfully."
      );

      await loadMappingsData();
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Could not update mapping status."
      );
    } finally {
      setMappingToggleLoadingId("");
    }
  }

  async function handleSeedSuggestedMappings() {
    setPageError("");
    setPageSuccess("");

    const suggestions = mappingSuggestions;

    if (!suggestions.length) {
      setPageError("There are no suggested agent mappings to seed right now.");
      return;
    }

    setSeedLoading(true);

    try {
      const rows = suggestions.map((item) => ({
        intercom_agent_name: item.intercom_agent_name,
        employee_name: item.employee_name || item.intercom_agent_name,
        employee_email: item.employee_email || null,
        team_name: item.team_name || null,
        notes: item.notes || "Detected from stored audit results.",
        is_active: true,
      }));

      const { error } = await supabase.from("agent_mappings").insert(rows);

      if (error) {
        throw new Error(error.message || "Could not seed suggested mappings.");
      }

      setPageSuccess(
        `${rows.length} detected agent mapping(s) were added. You can now refine employee names, emails, and teams.`
      );

      await loadMappingsData();
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Could not seed suggested mappings."
      );
    } finally {
      setSeedLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setPageError("");
    setPageSuccess("");

    const redirectTo =
      typeof window !== "undefined" ? `${window.location.origin}/admin` : undefined;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) {
      setPageError(error.message || "Google sign-in failed.");
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setPromptData(null);
    setHistoryRows([]);
    setLivePromptInput("");
    setDbReady(false);
    setMappingRows([]);
    setAuditRows([]);
    setPageError("");
    setPageSuccess("");
    setLoading(false);
    setAuthLoading(false);
  }

  const mappingSuggestions = useMemo(
    () => buildSuggestions(mappingRows, auditRows),
    [mappingRows, auditRows]
  );

  const unmappedRows = useMemo(
    () => buildUnmappedRows(mappingRows, auditRows),
    [mappingRows, auditRows]
  );

  const filteredMappings = useMemo(() => {
    const term = String(mappingSearch || "").trim().toLowerCase();
    if (!term) return mappingRows;

    return mappingRows.filter((item) => {
      const haystack = [
        item?.intercom_agent_name,
        item?.employee_name,
        item?.employee_email,
        item?.team_name,
        item?.notes,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");

      return haystack.includes(term);
    });
  }, [mappingRows, mappingSearch]);

  const statusCards = useMemo(
    () => [
      {
        label: "Database Status",
        value: dbReady ? "Prompt Tables Ready" : "Waiting for Prompt Tables",
        subtext: dbReady
          ? "Supabase prompt storage is connected"
          : "Prompt storage is not ready yet",
      },
      {
        label: "Prompt Source",
        value: promptData?.promptKey ? "Admin API Connected" : "No Prompt Loaded",
        subtext: promptData?.promptKey
          ? `Prompt key: ${promptData.promptKey}`
          : "Load Admin prompt settings to continue",
      },
      {
        label: "Agent Mappings",
        value: String(mappingRows.length),
        subtext: mappingRows.length
          ? "Stored Intercom-to-employee mappings"
          : "No agent mappings have been saved yet",
      },
      {
        label: "Unmapped Agents Found",
        value: String(unmappedRows.length),
        subtext: unmappedRows.length
          ? "Stored audit agents still needing mapping"
          : "No unmapped stored agents were detected",
      },
    ],
    [dbReady, promptData, mappingRows, unmappedRows]
  );

  const activeMappingsCount = mappingRows.filter((item) => item?.is_active !== false).length;

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
    maxWidth: "1380px",
    margin: "0 auto",
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

  const textareaStyle = {
    width: "100%",
    minHeight: "110px",
    borderRadius: "16px",
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(5,8,18,0.9)",
    color: "#e7ecff",
    padding: "16px",
    fontSize: "14px",
    lineHeight: 1.7,
    outline: "none",
    resize: "vertical",
    boxSizing: "border-box",
  };

  const secondaryButtonStyle = {
    borderRadius: "16px",
    padding: "14px 18px",
    fontSize: "14px",
    fontWeight: 700,
    color: "#e5ebff",
    cursor: "pointer",
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.1)",
  };

  const primaryButtonStyle = {
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

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
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
                background: canManageAdmin(profile) ? "#34d399" : "#f59e0b",
                boxShadow: canManageAdmin(profile) ? "0 0 12px #34d399" : "0 0 12px #f59e0b",
                display: "inline-block",
              }}
            />
            {canManageAdmin(profile) ? "Admin" : "View Only"}
          </div>
        </div>

        <section style={{ ...panelStyle, marginBottom: "24px" }}>
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
              maxWidth: "960px",
            }}
          >
            Admin control center for prompt management, agent mapping, and future system controls.
          </h1>

          <p
            style={{
              margin: "0 0 20px",
              color: "#a9b4d0",
              fontSize: "18px",
              lineHeight: 1.7,
              maxWidth: "980px",
            }}
          >
            This section now does two real jobs: it manages the live audit prompt, and it gives you
            a real Supabase-backed mapping layer from raw Intercom agent names to employee names,
            teams, and emails. Historical stored results stay preserved even if mappings change later.
          </p>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            {!session?.user ? (
              <button type="button" onClick={handleGoogleLogin} style={primaryButtonStyle}>
                Sign in with Google
              </button>
            ) : (
              <button type="button" onClick={handleLogout} style={secondaryButtonStyle}>
                Sign out
              </button>
            )}

            <button
              type="button"
              onClick={handleReload}
              disabled={loading || mappingLoading || saveLoading || mappingSaveLoading}
              style={{
                ...secondaryButtonStyle,
                opacity:
                  loading || mappingLoading || saveLoading || mappingSaveLoading ? 0.6 : 1,
                cursor:
                  loading || mappingLoading || saveLoading || mappingSaveLoading
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {loading || mappingLoading ? "Loading..." : "Reload Admin Data"}
            </button>

            <button
              type="button"
              onClick={handleSeedSuggestedMappings}
              disabled={
                seedLoading ||
                mappingLoading ||
                !canManageAdmin(profile) ||
                mappingSuggestions.length === 0
              }
              style={{
                ...primaryButtonStyle,
                opacity:
                  seedLoading ||
                  mappingLoading ||
                  !canManageAdmin(profile) ||
                  mappingSuggestions.length === 0
                    ? 0.6
                    : 1,
                cursor:
                  seedLoading ||
                  mappingLoading ||
                  !canManageAdmin(profile) ||
                  mappingSuggestions.length === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {seedLoading
                ? "Prefilling..."
                : `Prefill Detected Agents (${mappingSuggestions.length})`}
            </button>
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
          {statusCards.map((card) => (
            <div key={card.label} style={cardStyle}>
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
                  fontSize: "20px",
                  fontWeight: 700,
                  marginBottom: "8px",
                }}
              >
                {card.value}
              </div>
              <div
                style={{
                  color: "#a9b4d0",
                  fontSize: "14px",
                  lineHeight: 1.6,
                }}
              >
                {card.subtext}
              </div>
            </div>
          ))}
        </section>

        {(pageError || pageSuccess) && (
          <div style={{ display: "grid", gap: "12px", marginBottom: "24px" }}>
            {pageError ? (
              <div
                style={{
                  borderRadius: "18px",
                  border: "1px solid rgba(244,63,94,0.22)",
                  background: "rgba(244,63,94,0.08)",
                  padding: "14px 16px",
                  color: "#fecdd3",
                  fontSize: "14px",
                  lineHeight: 1.6,
                }}
              >
                {pageError}
              </div>
            ) : null}

            {pageSuccess ? (
              <div
                style={{
                  borderRadius: "18px",
                  border: "1px solid rgba(16,185,129,0.22)",
                  background: "rgba(16,185,129,0.08)",
                  padding: "14px 16px",
                  color: "#bbf7d0",
                  fontSize: "14px",
                  lineHeight: 1.6,
                }}
              >
                {pageSuccess}
              </div>
            ) : null}
          </div>
        )}

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: "18px",
            marginBottom: "24px",
          }}
        >
          <div style={sectionCardStyle}>
            <div style={labelStyle}>Prompt Source</div>
            <div
              style={{
                fontSize: "26px",
                fontWeight: 700,
                lineHeight: 1.15,
                marginBottom: "10px",
              }}
            >
              Original Trusted Prompt
            </div>

            <div
              style={{
                color: "#a9b4d0",
                fontSize: "15px",
                lineHeight: 1.7,
                marginBottom: "16px",
              }}
            >
              This section preserves your trusted original audit prompt exactly as the Admin system
              loaded it.
            </div>

            <textarea
              value={promptData?.originalTrustedPrompt || ""}
              readOnly
              style={{
                ...textareaStyle,
                minHeight: "420px",
              }}
            />
          </div>

          <div style={sectionCardStyle}>
            <div style={labelStyle}>Live Configuration</div>
            <div
              style={{
                fontSize: "26px",
                fontWeight: 700,
                lineHeight: 1.15,
                marginBottom: "10px",
              }}
            >
              Live Prompt in Use
            </div>

            <div
              style={{
                color: "#a9b4d0",
                fontSize: "15px",
                lineHeight: 1.7,
                marginBottom: "16px",
              }}
            >
              Update the live prompt here. The audit tool should use this saved version instead of
              depending on hardcoded route text.
            </div>

            <textarea
              value={livePromptInput}
              onChange={(e) => setLivePromptInput(e.target.value)}
              placeholder="The live prompt will appear here once loaded."
              style={{
                ...textareaStyle,
                minHeight: "320px",
                marginBottom: "14px",
              }}
            />

            <textarea
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder="Optional change note, such as why this prompt was updated."
              style={{
                ...textareaStyle,
                minHeight: "90px",
                marginBottom: "14px",
              }}
            />

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleSavePrompt}
                disabled={
                  loading ||
                  saveLoading ||
                  !livePromptInput.trim() ||
                  !session?.access_token ||
                  !canManageAdmin(profile)
                }
                style={{
                  ...primaryButtonStyle,
                  opacity:
                    loading ||
                    saveLoading ||
                    !livePromptInput.trim() ||
                    !session?.access_token ||
                    !canManageAdmin(profile)
                      ? 0.6
                      : 1,
                  cursor:
                    loading ||
                    saveLoading ||
                    !livePromptInput.trim() ||
                    !session?.access_token ||
                    !canManageAdmin(profile)
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {saveLoading ? "Saving..." : "Save Live Prompt"}
              </button>
            </div>
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
            <div style={labelStyle}>Agent Mapping Form</div>
            <div
              style={{
                fontSize: "26px",
                fontWeight: 700,
                lineHeight: 1.15,
                marginBottom: "10px",
              }}
            >
              Intercom agent → employee identity
            </div>

            <div
              style={{
                color: "#a9b4d0",
                fontSize: "15px",
                lineHeight: 1.7,
                marginBottom: "16px",
              }}
            >
              Add or edit the employee identity behind each raw Intercom agent name. If no mapping
              exists, future audits can be marked as unmapped instead of silently failing.
            </div>

            <div style={{ display: "grid", gap: "14px" }}>
              <div>
                <label style={labelStyle}>Intercom Agent Name</label>
                <input
                  type="text"
                  value={mappingForm.intercom_agent_name}
                  onChange={(e) =>
                    setMappingForm((prev) => ({
                      ...prev,
                      intercom_agent_name: e.target.value,
                    }))
                  }
                  placeholder="Example: Ryk Hayes"
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Employee Name</label>
                <input
                  type="text"
                  value={mappingForm.employee_name}
                  onChange={(e) =>
                    setMappingForm((prev) => ({
                      ...prev,
                      employee_name: e.target.value,
                    }))
                  }
                  placeholder="Example: Ryk Hayes or internal employee name"
                  style={inputStyle}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                <div>
                  <label style={labelStyle}>Employee Email</label>
                  <input
                    type="email"
                    value={mappingForm.employee_email}
                    onChange={(e) =>
                      setMappingForm((prev) => ({
                        ...prev,
                        employee_email: e.target.value,
                      }))
                    }
                    placeholder="employee@nextventures.io"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Team Name</label>
                  <input
                    type="text"
                    value={mappingForm.team_name}
                    onChange={(e) =>
                      setMappingForm((prev) => ({
                        ...prev,
                        team_name: e.target.value,
                      }))
                    }
                    placeholder="Example: CEx"
                    style={inputStyle}
                  />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Notes</label>
                <textarea
                  value={mappingForm.notes}
                  onChange={(e) =>
                    setMappingForm((prev) => ({
                      ...prev,
                      notes: e.target.value,
                    }))
                  }
                  placeholder="Optional internal notes for this mapping."
                  style={textareaStyle}
                />
              </div>

              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "10px",
                  color: "#dbe7ff",
                  fontSize: "14px",
                  fontWeight: 600,
                }}
              >
                <input
                  type="checkbox"
                  checked={mappingForm.is_active}
                  onChange={(e) =>
                    setMappingForm((prev) => ({
                      ...prev,
                      is_active: e.target.checked,
                    }))
                  }
                />
                Mapping is active
              </label>

              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={handleSaveMapping}
                  disabled={mappingSaveLoading || !canManageAdmin(profile)}
                  style={{
                    ...primaryButtonStyle,
                    opacity: mappingSaveLoading || !canManageAdmin(profile) ? 0.6 : 1,
                    cursor:
                      mappingSaveLoading || !canManageAdmin(profile)
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  {mappingSaveLoading
                    ? "Saving..."
                    : mappingForm.id
                    ? "Update Mapping"
                    : "Save Mapping"}
                </button>

                <button
                  type="button"
                  onClick={handleResetMappingForm}
                  style={secondaryButtonStyle}
                >
                  Clear Form
                </button>
              </div>
            </div>
          </div>

          <div style={sectionCardStyle}>
            <div style={labelStyle}>Detected From Stored Results</div>
            <div
              style={{
                fontSize: "26px",
                fontWeight: 700,
                lineHeight: 1.15,
                marginBottom: "10px",
              }}
            >
              Suggested mapping drafts
            </div>

            <div
              style={{
                color: "#a9b4d0",
                fontSize: "15px",
                lineHeight: 1.7,
                marginBottom: "16px",
              }}
            >
              To make your life easier, this section auto-detects raw Intercom agent names already
              present in stored audit results and turns them into mapping suggestions. Where no
              historical employee email exists yet, the email remains blank so you can fill it once.
            </div>

            {mappingSuggestions.length === 0 ? (
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
                No new agent suggestions are waiting right now. Either every detected agent already
                has a mapping, or no stored audit results exist yet.
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gap: "12px",
                  maxHeight: "560px",
                  overflowY: "auto",
                  paddingRight: "4px",
                }}
              >
                {mappingSuggestions.map((item, index) => (
                  <div
                    key={`${item.intercom_agent_name}-${index}`}
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
                            textTransform: "uppercase",
                            letterSpacing: "0.12em",
                            marginBottom: "6px",
                          }}
                        >
                          Intercom Agent
                        </div>
                        <div style={{ fontSize: "18px", fontWeight: 700 }}>
                          {item.intercom_agent_name}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleUseSuggestion(item)}
                        style={secondaryButtonStyle}
                      >
                        Use Suggestion
                      </button>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: "10px",
                        color: "#dbe7ff",
                        fontSize: "14px",
                        lineHeight: 1.7,
                      }}
                    >
                      <div>
                        <strong>Suggested employee name:</strong> {item.employee_name || "-"}
                      </div>
                      <div>
                        <strong>Suggested email:</strong> {item.employee_email || "-"}
                      </div>
                      <div>
                        <strong>Suggested team:</strong> {item.team_name || "-"}
                      </div>
                      <div>
                        <strong>Latest seen:</strong> {formatDateTime(item.source_created_at)}
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
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: "18px",
            marginBottom: "24px",
          }}
        >
          <div style={sectionCardStyle}>
            <div style={labelStyle}>Unmapped Agent Detection</div>
            <div
              style={{
                fontSize: "26px",
                fontWeight: 700,
                lineHeight: 1.15,
                marginBottom: "10px",
              }}
            >
              Stored agent names still needing mapping
            </div>

            <div
              style={{
                color: "#a9b4d0",
                fontSize: "15px",
                lineHeight: 1.7,
                marginBottom: "16px",
              }}
            >
              These raw Intercom agent names were found in stored results without a working mapping.
              This is where the app can inform you that analytics may be incomplete until mappings
              are added.
            </div>

            {unmappedRows.length === 0 ? (
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
                No unmapped stored agents were detected.
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gap: "12px",
                  maxHeight: "520px",
                  overflowY: "auto",
                  paddingRight: "4px",
                }}
              >
                {unmappedRows.map((item, index) => (
                  <div
                    key={`${item.intercom_agent_name}-${index}`}
                    style={{
                      borderRadius: "18px",
                      border: "1px solid rgba(251,191,36,0.18)",
                      background: "rgba(245,158,11,0.08)",
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
                            color: "#fcd34d",
                            textTransform: "uppercase",
                            letterSpacing: "0.12em",
                            marginBottom: "6px",
                          }}
                        >
                          Raw Intercom Agent
                        </div>
                        <div style={{ fontSize: "18px", fontWeight: 700 }}>
                          {item.intercom_agent_name}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          handleUseSuggestion({
                            intercom_agent_name: item.intercom_agent_name,
                            employee_name:
                              item.sample_employee_name || item.intercom_agent_name,
                            employee_email: item.sample_employee_email || "",
                            team_name: item.sample_team_name || "",
                            notes:
                              "Prefilled from unmapped stored result. Review and save this mapping.",
                          })
                        }
                        style={secondaryButtonStyle}
                      >
                        Map This Agent
                      </button>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: "10px",
                        color: "#fde68a",
                        fontSize: "14px",
                        lineHeight: 1.7,
                      }}
                    >
                      <div>
                        <strong>Appearances:</strong> {item.appearances}
                      </div>
                      <div>
                        <strong>Latest seen:</strong> {formatDateTime(item.latest_seen_at)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={sectionCardStyle}>
            <div style={labelStyle}>Historical Safety Rules</div>
            <div
              style={{
                fontSize: "26px",
                fontWeight: 700,
                lineHeight: 1.15,
                marginBottom: "10px",
              }}
            >
              What happens if mappings change later?
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
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  padding: "16px",
                }}
              >
                <strong>Past results should stay meaningful.</strong> If you deactivate a mapping
                later, historical stored results should not become unusable.
              </div>

              <div
                style={{
                  borderRadius: "18px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  padding: "16px",
                }}
              >
                <strong>Future audits can become unmapped.</strong> If a raw Intercom agent name no
                longer has an active mapping, future results can be flagged as unmapped so the app
                stays informative instead of silently wrong.
              </div>

              <div
                style={{
                  borderRadius: "18px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  padding: "16px",
                }}
              >
                <strong>Safer than delete:</strong> this UI uses activate / deactivate rather than
                hard delete, so you can control mapping behavior without losing history.
              </div>

              <div
                style={{
                  borderRadius: "18px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  padding: "16px",
                }}
              >
                <strong>Current mapping coverage:</strong> {activeMappingsCount} active mapping(s),{" "}
                {mappingRows.length - activeMappingsCount} inactive mapping(s).
              </div>
            </div>
          </div>
        </section>

        <section style={{ ...sectionCardStyle, marginBottom: "24px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "14px",
              flexWrap: "wrap",
              marginBottom: "16px",
            }}
          >
            <div>
              <div style={labelStyle}>Agent Mapping Table</div>
              <div
                style={{
                  fontSize: "26px",
                  fontWeight: 700,
                  lineHeight: 1.15,
                  marginBottom: "8px",
                }}
              >
                Real mapping records
              </div>
              <div
                style={{
                  color: "#a9b4d0",
                  fontSize: "15px",
                  lineHeight: 1.7,
                  maxWidth: "820px",
                }}
              >
                Search, review, edit, and activate or deactivate the saved mapping records that the
                app will use to translate raw Intercom agent names into employee identity.
              </div>
            </div>

            <div style={{ minWidth: "300px", flex: "0 1 380px" }}>
              <label style={labelStyle}>Search mappings</label>
              <input
                type="text"
                value={mappingSearch}
                onChange={(e) => setMappingSearch(e.target.value)}
                placeholder="Search agent, employee, email, team, notes"
                style={inputStyle}
              />
            </div>
          </div>

          {mappingLoading ? (
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
              Loading mapping records...
            </div>
          ) : filteredMappings.length === 0 ? (
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
              No mapping rows match the current search.
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
              <div style={{ maxHeight: "720px", overflow: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    minWidth: "1200px",
                    borderCollapse: "collapse",
                  }}
                >
                  <thead>
                    <tr style={{ background: "rgba(10,18,34,0.96)" }}>
                      {[
                        "Intercom Agent",
                        "Employee Name",
                        "Employee Email",
                        "Team",
                        "Status",
                        "Updated",
                        "Actions",
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
                            whiteSpace: "nowrap",
                            position: "sticky",
                            top: 0,
                            zIndex: 2,
                          }}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {filteredMappings.map((row, index) => (
                      <tr
                        key={row.id || `mapping-${index}`}
                        style={{
                          background: index % 2 === 0 ? "rgba(255,255,255,0.018)" : "transparent",
                        }}
                      >
                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            color: "#f5f7ff",
                            fontWeight: 700,
                            verticalAlign: "top",
                          }}
                        >
                          {row?.intercom_agent_name || "-"}
                        </td>

                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            color: "#dbe7ff",
                            verticalAlign: "top",
                          }}
                        >
                          {row?.employee_name || "-"}
                        </td>

                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            color: "#dbe7ff",
                            verticalAlign: "top",
                          }}
                        >
                          {row?.employee_email || "-"}
                        </td>

                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            color: "#dbe7ff",
                            verticalAlign: "top",
                          }}
                        >
                          {row?.team_name || "-"}
                        </td>

                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            verticalAlign: "top",
                          }}
                        >
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "8px 12px",
                              borderRadius: "999px",
                              fontSize: "12px",
                              fontWeight: 700,
                              border:
                                row?.is_active !== false
                                  ? "1px solid rgba(16,185,129,0.18)"
                                  : "1px solid rgba(245,158,11,0.18)",
                              background:
                                row?.is_active !== false
                                  ? "rgba(16,185,129,0.12)"
                                  : "rgba(245,158,11,0.12)",
                              color:
                                row?.is_active !== false ? "#d1fae5" : "#fde68a",
                            }}
                          >
                            {row?.is_active !== false ? "Active" : "Inactive"}
                          </span>
                        </td>

                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            color: "#a9b4d0",
                            verticalAlign: "top",
                            fontSize: "13px",
                            lineHeight: 1.6,
                          }}
                        >
                          {formatDateTime(row?.updated_at || row?.created_at)}
                        </td>

                        <td
                          style={{
                            padding: "16px 14px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            verticalAlign: "top",
                          }}
                        >
                          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={() => handleEditMapping(row)}
                              style={secondaryButtonStyle}
                            >
                              Edit
                            </button>

                            <button
                              type="button"
                              onClick={() => handleToggleMappingActive(row)}
                              disabled={mappingToggleLoadingId === row.id}
                              style={{
                                ...secondaryButtonStyle,
                                opacity: mappingToggleLoadingId === row.id ? 0.6 : 1,
                                cursor:
                                  mappingToggleLoadingId === row.id
                                    ? "not-allowed"
                                    : "pointer",
                              }}
                            >
                              {mappingToggleLoadingId === row.id
                                ? "Saving..."
                                : row?.is_active !== false
                                ? "Deactivate"
                                : "Reactivate"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        <section style={sectionCardStyle}>
          <div style={labelStyle}>Prompt History</div>
          <div
            style={{
              fontSize: "26px",
              fontWeight: 700,
              lineHeight: 1.15,
              marginBottom: "10px",
            }}
          >
            Timestamped Change Log
          </div>

          <div
            style={{
              color: "#a9b4d0",
              fontSize: "15px",
              lineHeight: 1.7,
              marginBottom: "18px",
            }}
          >
            Every live prompt save should appear here with the exact timestamp and the admin email
            that made the change.
          </div>

          {historyRows.length === 0 ? (
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
              No prompt history has been recorded yet.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gap: "14px",
                maxHeight: "540px",
                overflowY: "auto",
                paddingRight: "4px",
              }}
            >
              {historyRows.map((item, index) => (
                <div
                  key={item?.id || `history-${index}`}
                  style={{
                    borderRadius: "18px",
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
                        Change Type
                      </div>
                      <div style={{ fontSize: "18px", fontWeight: 700 }}>
                        {getHistoryLabel(item)}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "8px 12px",
                        borderRadius: "999px",
                        background: "rgba(99,102,241,0.12)",
                        border: "1px solid rgba(129,140,248,0.18)",
                        color: "#ddd6fe",
                        fontSize: "12px",
                        fontWeight: 700,
                      }}
                    >
                      {formatDateTime(item?.changed_at)}
                    </div>
                  </div>

                  <div
                    style={{
                      color: "#dbe7ff",
                      fontSize: "14px",
                      lineHeight: 1.8,
                      marginBottom: "12px",
                    }}
                  >
                    <strong>Changed by:</strong> {item?.changed_by_email || "Unknown admin"}
                    <br />
                    <strong>Note:</strong> {item?.change_note || "No change note provided."}
                  </div>

                  <textarea
                    value={item?.prompt_text || ""}
                    readOnly
                    style={{
                      ...textareaStyle,
                      minHeight: "150px",
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
