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

function normalizeAgentKey(value) {
  return String(value || "").trim().toLowerCase();
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function getHistoryLabel(item) {
  if (item?.prompt_type === "live_prompt") return "Live Prompt Update";
  if (item?.prompt_type === "original_prompt") return "Original Prompt Record";
  return item?.prompt_type || "Prompt Change";
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

function getRowDate(row) {
  return row?.replied_at || row?.created_at || null;
}

function buildStoredAgentStats(auditRows) {
  const stats = new Map();

  for (const row of auditRows || []) {
    const agentName = String(row?.agent_name || "").trim();
    const key = normalizeAgentKey(agentName);
    if (!key) continue;

    const current = stats.get(key) || {
      agent_name: agentName,
      appearances: 0,
      mapped_result_count: 0,
      unmapped_result_count: 0,
      latest_seen_at: getRowDate(row),
    };

    current.appearances += 1;

    const matchStatus = String(row?.employee_match_status || "").toLowerCase();
    if (matchStatus === "mapped") current.mapped_result_count += 1;
    if (matchStatus === "unmapped") current.unmapped_result_count += 1;

    const previousSeen = new Date(current.latest_seen_at || 0).getTime();
    const rowSeen = new Date(getRowDate(row) || 0).getTime();

    if (rowSeen > previousSeen) {
      current.latest_seen_at = getRowDate(row);
    }

    stats.set(key, current);
  }

  return stats;
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
    const key = normalizeAgentKey(rawAgent);
    if (!key || existingKeys.has(key)) continue;

    const current = byAgent.get(key) || {
      intercom_agent_name: rawAgent,
      employee_name: "",
      employee_email: "",
      team_name: "",
      notes: "Detected from stored audit results.",
      result_count: 0,
      latest_seen_at: getRowDate(row),
      mapped_result_count: 0,
      unmapped_result_count: 0,
    };

    current.result_count += 1;

    const matchStatus = String(row?.employee_match_status || "").toLowerCase();
    if (matchStatus === "mapped") current.mapped_result_count += 1;
    if (matchStatus === "unmapped") current.unmapped_result_count += 1;

    const employeeName = String(row?.employee_name || "").trim();
    const employeeEmail = String(row?.employee_email || "").trim();
    const teamName = String(row?.team_name || "").trim();

    if (!current.employee_name && employeeName) current.employee_name = employeeName;
    if (!current.employee_email && employeeEmail) current.employee_email = employeeEmail;
    if (!current.team_name && teamName) current.team_name = teamName;

    const previousSeen = new Date(current.latest_seen_at || 0).getTime();
    const rowSeen = new Date(getRowDate(row) || 0).getTime();

    if (rowSeen > previousSeen) {
      current.latest_seen_at = getRowDate(row);
    }

    byAgent.set(key, current);
  }

  return Array.from(byAgent.values())
    .map((item) => ({
      ...item,
      employee_name: item.employee_name || item.intercom_agent_name,
      notes: item.mapped_result_count
        ? `Detected from stored audit results. ${item.mapped_result_count} historical mapped result(s) found; review before saving.`
        : item.notes,
    }))
    .sort((a, b) => {
      const latestA = new Date(a.latest_seen_at || 0).getTime();
      const latestB = new Date(b.latest_seen_at || 0).getTime();
      if (latestA !== latestB) return latestB - latestA;
      return a.intercom_agent_name.localeCompare(b.intercom_agent_name);
    });
}

function buildUnmappedRows(existingMappings, auditRows) {
  const activeKeys = new Set(
    (existingMappings || [])
      .filter((item) => item?.is_active !== false)
      .map((item) => normalizeAgentKey(item?.intercom_agent_name))
      .filter(Boolean)
  );

  const inactiveKeys = new Set(
    (existingMappings || [])
      .filter((item) => item?.is_active === false)
      .map((item) => normalizeAgentKey(item?.intercom_agent_name))
      .filter(Boolean)
  );

  const grouped = new Map();

  for (const row of auditRows || []) {
    const rawAgent = String(row?.agent_name || "").trim();
    const key = normalizeAgentKey(rawAgent);
    if (!key || activeKeys.has(key)) continue;

    const issueType = inactiveKeys.has(key) ? "inactive_mapping" : "missing_mapping";
    const current = grouped.get(key) || {
      intercom_agent_name: rawAgent,
      issue_type: issueType,
      issue_label: issueType === "inactive_mapping" ? "Inactive mapping exists" : "No active mapping",
      appearances: 0,
      latest_seen_at: getRowDate(row),
      sample_employee_name: String(row?.employee_name || "").trim(),
      sample_employee_email: String(row?.employee_email || "").trim(),
      sample_team_name: String(row?.team_name || "").trim(),
    };

    current.appearances += 1;

    const previousSeen = new Date(current.latest_seen_at || 0).getTime();
    const rowSeen = new Date(getRowDate(row) || 0).getTime();

    if (rowSeen > previousSeen) {
      current.latest_seen_at = getRowDate(row);
      current.sample_employee_name = String(row?.employee_name || "").trim();
      current.sample_employee_email = String(row?.employee_email || "").trim();
      current.sample_team_name = String(row?.team_name || "").trim();
    }

    grouped.set(key, current);
  }

  return Array.from(grouped.values()).sort((a, b) => {
    if (a.issue_type !== b.issue_type) return a.issue_type === "missing_mapping" ? -1 : 1;
    if (a.appearances !== b.appearances) return b.appearances - a.appearances;
    return a.intercom_agent_name.localeCompare(b.intercom_agent_name);
  });
}

function getMappingQuality(row, stats) {
  if (row?.is_active === false) {
    return {
      key: "inactive",
      label: "Inactive",
      detail: "Future audits will not use this mapping until it is reactivated.",
      tone: "warning",
    };
  }

  const missingEmail = !String(row?.employee_email || "").trim();
  const missingTeam = !String(row?.team_name || "").trim();

  if (missingEmail && missingTeam) {
    return {
      key: "missing_email_team",
      label: "Needs email and team",
      detail: "Add employee email and team so filters, leaderboards, and ownership views stay clean.",
      tone: "warning",
    };
  }

  if (missingEmail) {
    return {
      key: "missing_email",
      label: "Needs email",
      detail: "Employee name is mapped, but the email is blank.",
      tone: "notice",
    };
  }

  if (missingTeam) {
    return {
      key: "missing_team",
      label: "Needs team",
      detail: "Employee identity is mapped, but team filtering will be incomplete.",
      tone: "notice",
    };
  }

  if (!stats?.appearances) {
    return {
      key: "no_stored_usage",
      label: "Ready, no stored usage",
      detail: "Mapping is complete but has not appeared in the latest stored audit sample.",
      tone: "neutral",
    };
  }

  return {
    key: "healthy",
    label: "Healthy",
    detail: "Mapping is active and complete.",
    tone: "success",
  };
}

function toneClass(tone) {
  if (tone === "success") return "tone success";
  if (tone === "warning") return "tone warning";
  if (tone === "danger") return "tone danger";
  if (tone === "notice") return "tone notice";
  return "tone neutral";
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
  const [mappingStatusFilter, setMappingStatusFilter] = useState("all");
  const [mappingQualityFilter, setMappingQualityFilter] = useState("all");
  const [mappingSaveLoading, setMappingSaveLoading] = useState(false);
  const [mappingToggleLoadingId, setMappingToggleLoadingId] = useState("");
  const [seedLoading, setSeedLoading] = useState(false);

  const isAdmin = canManageAdmin(profile);

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

  async function loadPromptData(activeSession) {
    if (!activeSession?.access_token) {
      setPromptData(null);
      setHistoryRows([]);
      setDbReady(false);
      return;
    }

    const response = await fetch("/api/admin/prompt", {
      method: "GET",
      headers: { Authorization: `Bearer ${activeSession.access_token}` },
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
          .select("id, agent_name, employee_name, employee_email, team_name, employee_match_status, created_at, replied_at")
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
      setPageError(error instanceof Error ? error.message : "Could not load Admin settings.");
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
    if (!session) return;
    await loadAll(session);
  }

  async function handleSavePrompt() {
    setPageError("");
    setPageSuccess("");

    if (!session?.access_token) {
      setPageError("Please sign in first so Admin can save prompt settings.");
      return;
    }

    if (!isAdmin) {
      setPageError("Only Admin users can save prompt settings.");
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
        body: JSON.stringify({ livePrompt: livePromptInput, changeNote }),
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
      setPageError(error instanceof Error ? error.message : "Could not save the live prompt.");
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
    setPageSuccess("Mapping loaded into the form.");
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
    setPageSuccess("Mapping form was prefilled from a detected agent.");
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

    if (!isAdmin) {
      setPageError("Only Admin users can save agent mappings.");
      return;
    }

    const intercomAgentName = String(mappingForm.intercom_agent_name || "").trim();
    const employeeName = String(mappingForm.employee_name || "").trim() || intercomAgentName;
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
      const duplicate = mappingRows.find(
        (item) =>
          normalizeAgentKey(item?.intercom_agent_name) === normalizeAgentKey(intercomAgentName)
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

      if (mappingForm.id || duplicate?.id) {
        const targetId = mappingForm.id || duplicate.id;
        const { error } = await supabase.from("agent_mappings").update(payload).eq("id", targetId);
        if (error) throw new Error(error.message || "Could not update the agent mapping.");
        setPageSuccess("Agent mapping updated successfully.");
      } else {
        const { error } = await supabase
          .from("agent_mappings")
          .insert({ ...payload, created_at: new Date().toISOString() });
        if (error) throw new Error(error.message || "Could not create the agent mapping.");
        setPageSuccess("Agent mapping created successfully.");
      }

      setMappingForm(createEmptyMappingForm());
      await loadMappingsData();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not save the agent mapping.");
    } finally {
      setMappingSaveLoading(false);
    }
  }

  async function handleToggleMappingActive(row) {
    setPageError("");
    setPageSuccess("");

    if (!isAdmin) {
      setPageError("Only Admin users can activate or deactivate mappings.");
      return;
    }

    setMappingToggleLoadingId(row?.id || "");

    try {
      const { error } = await supabase
        .from("agent_mappings")
        .update({ is_active: row?.is_active ? false : true, updated_at: new Date().toISOString() })
        .eq("id", row.id);

      if (error) throw new Error(error.message || "Could not update mapping status.");

      setPageSuccess(
        row?.is_active
          ? "Agent mapping was deactivated. Historical results stay preserved."
          : "Agent mapping was reactivated successfully."
      );

      await loadMappingsData();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not update mapping status.");
    } finally {
      setMappingToggleLoadingId("");
    }
  }

  async function handleSeedSuggestedMappings() {
    setPageError("");
    setPageSuccess("");

    if (!isAdmin) {
      setPageError("Only Admin users can prefill detected agent mappings.");
      return;
    }

    if (!mappingSuggestions.length) {
      setPageError("There are no suggested agent mappings to prefill right now.");
      return;
    }

    setSeedLoading(true);

    try {
      const rows = mappingSuggestions.map((item) => ({
        intercom_agent_name: item.intercom_agent_name,
        employee_name: item.employee_name || item.intercom_agent_name,
        employee_email: item.employee_email || null,
        team_name: item.team_name || null,
        notes: item.notes || "Detected from stored audit results.",
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase.from("agent_mappings").insert(rows);
      if (error) throw new Error(error.message || "Could not prefill suggested mappings.");

      setPageSuccess(`${rows.length} detected agent mapping(s) were added. Review names, emails, and teams before relying on them for reporting.`);
      await loadMappingsData();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not prefill suggested mappings.");
    } finally {
      setSeedLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setPageError("");
    setPageSuccess("");

    const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/admin` : undefined;
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) setPageError(error.message || "Google sign-in failed.");
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

  const storedAgentStats = useMemo(() => buildStoredAgentStats(auditRows), [auditRows]);
  const mappingSuggestions = useMemo(() => buildSuggestions(mappingRows, auditRows), [mappingRows, auditRows]);
  const unmappedRows = useMemo(() => buildUnmappedRows(mappingRows, auditRows), [mappingRows, auditRows]);

  const mappingTableRows = useMemo(
    () =>
      mappingRows.map((row) => {
        const key = normalizeAgentKey(row?.intercom_agent_name);
        const stats = storedAgentStats.get(key) || {
          appearances: 0,
          mapped_result_count: 0,
          unmapped_result_count: 0,
          latest_seen_at: null,
        };
        return { ...row, stats, quality: getMappingQuality(row, stats) };
      }),
    [mappingRows, storedAgentStats]
  );

  const activeMappingsCount = mappingRows.filter((item) => item?.is_active !== false).length;
  const inactiveMappingsCount = mappingRows.length - activeMappingsCount;
  const incompleteMappingsCount = mappingTableRows.filter((row) =>
    ["missing_email_team", "missing_email", "missing_team"].includes(row.quality.key)
  ).length;
  const healthyMappingsCount = mappingTableRows.filter((row) => row.quality.key === "healthy").length;
  const totalStoredAgentNames = storedAgentStats.size;
  const mappedCoveragePercent = totalStoredAgentNames
    ? Math.max(0, Math.round(((totalStoredAgentNames - unmappedRows.length) / totalStoredAgentNames) * 100))
    : 100;

  const filteredMappings = useMemo(() => {
    const term = String(mappingSearch || "").trim().toLowerCase();

    return mappingTableRows.filter((row) => {
      if (mappingStatusFilter === "active" && row?.is_active === false) return false;
      if (mappingStatusFilter === "inactive" && row?.is_active !== false) return false;

      if (mappingQualityFilter === "needs_attention") {
        if (!["missing_email_team", "missing_email", "missing_team", "inactive"].includes(row.quality.key)) return false;
      } else if (mappingQualityFilter !== "all" && row.quality.key !== mappingQualityFilter) {
        return false;
      }

      if (!term) return true;

      return [
        row?.intercom_agent_name,
        row?.employee_name,
        row?.employee_email,
        row?.team_name,
        row?.notes,
        row?.quality?.label,
        row?.quality?.detail,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ")
        .includes(term);
    });
  }, [mappingRows, mappingTableRows, mappingSearch, mappingStatusFilter, mappingQualityFilter]);

  const statusCards = [
    {
      label: "Database Status",
      value: dbReady ? "Prompt Tables Ready" : "Waiting for Prompt Tables",
      note: dbReady ? "Supabase prompt storage is connected." : "Prompt storage is not ready yet.",
      tone: dbReady ? "success" : "warning",
    },
    {
      label: "Mapping Coverage",
      value: `${mappedCoveragePercent}%`,
      note: totalStoredAgentNames
        ? `${formatNumber(totalStoredAgentNames - unmappedRows.length)} of ${formatNumber(totalStoredAgentNames)} stored agent name(s) have active coverage.`
        : "No stored audit agent sample is available yet.",
      tone: unmappedRows.length ? "warning" : "success",
    },
    {
      label: "Active / Inactive",
      value: `${formatNumber(activeMappingsCount)} / ${formatNumber(inactiveMappingsCount)}`,
      note: "Active mappings are used for future audit storage. Inactive mappings preserve history safely.",
      tone: inactiveMappingsCount ? "notice" : "success",
    },
    {
      label: "Needs Attention",
      value: String(incompleteMappingsCount + unmappedRows.length),
      note: `${formatNumber(incompleteMappingsCount)} incomplete saved mapping(s), ${formatNumber(unmappedRows.length)} unmapped stored agent risk(s).`,
      tone: incompleteMappingsCount || unmappedRows.length ? "warning" : "success",
    },
    {
      label: "Detected Drafts",
      value: String(mappingSuggestions.length),
      note: mappingSuggestions.length ? "New raw Intercom names found in stored audit results." : "No new mapping drafts are waiting.",
      tone: mappingSuggestions.length ? "notice" : "success",
    },
  ];

  if (authLoading) {
    return (
      <main className="admin-page">
        <style>{adminStyles}</style>
        <section className="hero compact"><p className="eyebrow">NEXT Ventures</p><h1>Loading Admin...</h1></section>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <style>{adminStyles}</style>

      <nav className="topbar">
        <div>
          <p className="eyebrow">NEXT Ventures</p>
          <strong>Review Approach & Client Sentiment Tracking</strong>
        </div>
        <span className={isAdmin ? "access-pill active" : "access-pill"}>{isAdmin ? "Admin" : "View Only"}</span>
      </nav>

      <section className="hero">
        <div className="hero-badge">Premium Internal Tool</div>
        <h1>Admin control center for prompts, agent mapping, and future system controls.</h1>
        <p>
          Manage the live audit prompt and the Supabase-backed mapping layer that translates raw Intercom agent names into employee names, teams, and emails. Historical stored results stay meaningful even if mappings change later.
        </p>
        <div className="action-row">
          {!session?.user ? (
            <button type="button" className="primary-btn" onClick={handleGoogleLogin}>Sign in with Google</button>
          ) : (
            <button type="button" className="secondary-btn" onClick={handleLogout}>Sign out</button>
          )}
          <button type="button" className="secondary-btn" onClick={handleReload} disabled={!session || loading || mappingLoading}>
            {loading || mappingLoading ? "Loading..." : "Reload Admin Data"}
          </button>
          <button type="button" className="primary-btn" onClick={handleSeedSuggestedMappings} disabled={!isAdmin || seedLoading || !mappingSuggestions.length}>
            {seedLoading ? "Prefilling..." : `Prefill Detected Agents (${mappingSuggestions.length})`}
          </button>
        </div>
      </section>

      <section className="status-grid">
        {statusCards.map((card) => (
          <article key={card.label} className={`stat-card ${card.tone}`}>
            <p>{card.label}</p>
            <strong>{card.value}</strong>
            <span>{card.note}</span>
          </article>
        ))}
      </section>

      {(pageError || pageSuccess) && (
        <section className="message-stack">
          {pageError ? <div className="message error">{pageError}</div> : null}
          {pageSuccess ? <div className="message success">{pageSuccess}</div> : null}
        </section>
      )}

      {!session?.user ? (
        <section className="panel"><h2>Sign in required</h2><p className="muted">Use a nextventures.io Google account to access the Admin control center.</p></section>
      ) : !isAdmin ? (
        <section className="panel"><h2>Admin access required</h2><p className="muted">You are signed in, but this profile does not currently have Admin or Master Admin access.</p></section>
      ) : (
        <>
          <section className="two-col">
            <article className="panel">
              <p className="eyebrow">Prompt Source</p>
              <h2>Original Trusted Prompt</h2>
              <p className="muted">This preserves the trusted original audit prompt exactly as the Admin API loaded it.</p>
              <textarea className="textarea tall" value={promptData?.originalTrustedPrompt || ""} readOnly />
            </article>

            <article className="panel">
              <p className="eyebrow">Live Configuration</p>
              <h2>Live Prompt in Use</h2>
              <p className="muted">Update the saved live prompt here. The audit run route should use this version instead of hardcoded route text.</p>
              <textarea className="textarea live" value={livePromptInput} onChange={(event) => setLivePromptInput(event.target.value)} placeholder="The live prompt will appear here once loaded." />
              <textarea className="textarea note" value={changeNote} onChange={(event) => setChangeNote(event.target.value)} placeholder="Optional change note, such as why this prompt was updated." />
              <div className="action-row">
                <button type="button" className="primary-btn" onClick={handleSavePrompt} disabled={saveLoading || !livePromptInput.trim()}>
                  {saveLoading ? "Saving..." : "Save Live Prompt"}
                </button>
              </div>
            </article>
          </section>

          <section className="two-col mapping-area">
            <article className="panel">
              <p className="eyebrow">Agent Mapping Form</p>
              <h2>Intercom agent to employee identity</h2>
              <p className="muted">Add or edit the employee identity behind each raw Intercom agent name. If no active mapping exists, future audits can be marked as unmapped instead of silently wrong.</p>

              <div className="form-grid single">
                <label>
                  <span>Intercom Agent Name</span>
                  <input value={mappingForm.intercom_agent_name} onChange={(event) => setMappingForm((prev) => ({ ...prev, intercom_agent_name: event.target.value }))} placeholder="Example: Ryk Hayes" />
                </label>
                <label>
                  <span>Employee Name</span>
                  <input value={mappingForm.employee_name} onChange={(event) => setMappingForm((prev) => ({ ...prev, employee_name: event.target.value }))} placeholder="Internal employee name" />
                </label>
                <div className="form-grid two">
                  <label>
                    <span>Employee Email</span>
                    <input type="email" value={mappingForm.employee_email} onChange={(event) => setMappingForm((prev) => ({ ...prev, employee_email: event.target.value }))} placeholder="employee@nextventures.io" />
                  </label>
                  <label>
                    <span>Team Name</span>
                    <input value={mappingForm.team_name} onChange={(event) => setMappingForm((prev) => ({ ...prev, team_name: event.target.value }))} placeholder="Example: CEx" />
                  </label>
                </div>
                <label>
                  <span>Notes</span>
                  <textarea className="textarea note" value={mappingForm.notes} onChange={(event) => setMappingForm((prev) => ({ ...prev, notes: event.target.value }))} placeholder="Optional internal notes for this mapping." />
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={mappingForm.is_active} onChange={(event) => setMappingForm((prev) => ({ ...prev, is_active: event.target.checked }))} />
                  <span>Mapping is active</span>
                </label>
                <div className="action-row">
                  <button type="button" className="primary-btn" onClick={handleSaveMapping} disabled={mappingSaveLoading}>
                    {mappingSaveLoading ? "Saving..." : mappingForm.id ? "Update Mapping" : "Save Mapping"}
                  </button>
                  <button type="button" className="secondary-btn" onClick={handleResetMappingForm}>Clear Form</button>
                </div>
              </div>
            </article>

            <article className="panel">
              <p className="eyebrow">Detected From Stored Results</p>
              <h2>Suggested mapping drafts</h2>
              <p className="muted">Raw Intercom agent names from stored audit results appear here when they do not already have a saved mapping.</p>

              {mappingSuggestions.length === 0 ? (
                <div className="empty-box">No new agent suggestions are waiting right now.</div>
              ) : (
                <div className="scroll-stack">
                  {mappingSuggestions.map((item) => (
                    <article className="mini-card" key={item.intercom_agent_name}>
                      <div className="mini-head">
                        <div>
                          <p className="eyebrow">Intercom Agent</p>
                          <h3>{item.intercom_agent_name}</h3>
                        </div>
                        <button type="button" className="secondary-btn small" onClick={() => handleUseSuggestion(item)}>Use Suggestion</button>
                      </div>
                      <div className="mini-grid">
                        <span><b>Employee</b>{item.employee_name || "-"}</span>
                        <span><b>Email</b>{item.employee_email || "-"}</span>
                        <span><b>Team</b>{item.team_name || "-"}</span>
                        <span><b>Seen</b>{formatDateTime(item.latest_seen_at)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </article>
          </section>

          <section className="two-col">
            <article className="panel">
              <p className="eyebrow">Unmapped Agent Detection</p>
              <h2>Stored agent names still needing mapping</h2>
              <p className="muted">These raw Intercom agent names were found in stored results without active mapping coverage.</p>

              {unmappedRows.length === 0 ? (
                <div className="empty-box success-box">No unmapped stored agents were detected.</div>
              ) : (
                <div className="scroll-stack compact-list">
                  {unmappedRows.map((item) => (
                    <article className="mini-card warning-card" key={item.intercom_agent_name}>
                      <div className="mini-head">
                        <div>
                          <p className="eyebrow amber">{item.issue_label}</p>
                          <h3>{item.intercom_agent_name}</h3>
                        </div>
                        <button
                          type="button"
                          className="secondary-btn small"
                          onClick={() =>
                            handleUseSuggestion({
                              intercom_agent_name: item.intercom_agent_name,
                              employee_name: item.sample_employee_name || item.intercom_agent_name,
                              employee_email: item.sample_employee_email || "",
                              team_name: item.sample_team_name || "",
                              notes: "Prefilled from unmapped stored result. Review and save this mapping.",
                            })
                          }
                        >
                          Map This Agent
                        </button>
                      </div>
                      <div className="mini-grid two-items">
                        <span><b>Appearances</b>{item.appearances}</span>
                        <span><b>Latest seen</b>{formatDateTime(item.latest_seen_at)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </article>

            <article className="panel">
              <p className="eyebrow">Historical Safety Rules</p>
              <h2>What happens if mappings change later?</h2>
              <div className="rule-list">
                <div><b>Past results stay meaningful.</b><span>Historical stored rows keep their saved employee fields even when a mapping is changed later.</span></div>
                <div><b>Future audits can become unmapped.</b><span>If a raw Intercom name has no active mapping, future stored results can show an unmapped status.</span></div>
                <div><b>Safer than delete.</b><span>Activate and deactivate controls preserve mapping history instead of removing records blindly.</span></div>
                <div><b>Current coverage.</b><span>{activeMappingsCount} active, {inactiveMappingsCount} inactive, {healthyMappingsCount} healthy, {incompleteMappingsCount} needing details.</span></div>
              </div>
            </article>
          </section>

          <section className="panel wide">
            <div className="section-head">
              <div>
                <p className="eyebrow">Agent Mapping Table</p>
                <h2>Real mapping records with data quality controls</h2>
                <p className="muted">Search, review, edit, and activate or deactivate the mapping records that power employee ownership, team filters, leaderboards, and future audit storage.</p>
              </div>
              <div className="tiny-metrics">
                <span><b>{formatNumber(mappingRows.length)}</b>total</span>
                <span><b>{formatNumber(activeMappingsCount)}</b>active</span>
                <span><b>{formatNumber(incompleteMappingsCount)}</b>needs detail</span>
                <span><b>{formatNumber(unmappedRows.length)}</b>risk</span>
              </div>
            </div>

            <div className="filter-grid">
              <label>
                <span>Search</span>
                <input value={mappingSearch} onChange={(event) => setMappingSearch(event.target.value)} placeholder="Search agent, employee, email, team, notes, quality" />
              </label>
              <label>
                <span>Status</span>
                <select value={mappingStatusFilter} onChange={(event) => setMappingStatusFilter(event.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="active">Active only</option>
                  <option value="inactive">Inactive only</option>
                </select>
              </label>
              <label>
                <span>Quality</span>
                <select value={mappingQualityFilter} onChange={(event) => setMappingQualityFilter(event.target.value)}>
                  <option value="all">All quality states</option>
                  <option value="needs_attention">Needs attention</option>
                  <option value="missing_email_team">Needs email and team</option>
                  <option value="missing_email">Needs email</option>
                  <option value="missing_team">Needs team</option>
                  <option value="inactive">Inactive</option>
                  <option value="healthy">Healthy</option>
                  <option value="no_stored_usage">Ready, no stored usage</option>
                </select>
              </label>
              <button type="button" className="secondary-btn clear-btn" onClick={() => { setMappingSearch(""); setMappingStatusFilter("all"); setMappingQualityFilter("all"); }}>Clear Filters</button>
            </div>

            <div className="chip-row">
              <span>Showing {formatNumber(filteredMappings.length)} of {formatNumber(mappingRows.length)} mapping(s)</span>
              <span className={unmappedRows.length ? "chip warning" : "chip success"}>{formatNumber(unmappedRows.length)} stored agent risk(s)</span>
              <span className={mappingSuggestions.length ? "chip notice" : "chip success"}>{formatNumber(mappingSuggestions.length)} detected draft(s)</span>
            </div>

            {mappingLoading ? (
              <div className="empty-box">Loading mapping records...</div>
            ) : filteredMappings.length === 0 ? (
              <div className="empty-box">No mapping rows match the current search or filters.</div>
            ) : (
              <div className="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>Intercom Agent</th>
                      <th>Employee Identity</th>
                      <th>Team</th>
                      <th>Quality</th>
                      <th>Stored Usage</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMappings.map((row) => (
                      <tr key={row.id || row.intercom_agent_name}>
                        <td><strong>{row.intercom_agent_name || "-"}</strong><small>Raw Intercom display name</small></td>
                        <td><strong>{row.employee_name || "-"}</strong><small>{row.employee_email || "No employee email saved"}</small>{row.notes ? <em>{row.notes}</em> : null}</td>
                        <td>{row.team_name ? <span className="team-pill">{row.team_name}</span> : <span className="missing-text">No team</span>}</td>
                        <td><span className={toneClass(row.quality.tone)}>{row.quality.label}</span><small>{row.quality.detail}</small></td>
                        <td><strong>{formatNumber(row.stats.appearances)}</strong><small>{row.stats.appearances ? `Latest: ${formatDateTime(row.stats.latest_seen_at)}` : "No stored usage found"}</small></td>
                        <td><span className={row.is_active === false ? "status inactive" : "status active"}>{row.is_active === false ? "Inactive" : "Active"}</span></td>
                        <td>
                          <div className="table-actions">
                            <button type="button" className="secondary-btn small" onClick={() => handleEditMapping(row)}>Edit</button>
                            <button type="button" className="secondary-btn small" disabled={mappingToggleLoadingId === row.id} onClick={() => handleToggleMappingActive(row)}>
                              {mappingToggleLoadingId === row.id ? "Saving..." : row.is_active === false ? "Activate" : "Deactivate"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel wide">
            <div className="section-head">
              <div>
                <p className="eyebrow">Prompt History</p>
                <h2>Recent Admin prompt changes</h2>
                <p className="muted">The prompt history is loaded through the protected Admin prompt API.</p>
              </div>
            </div>

            {historyRows.length === 0 ? (
              <div className="empty-box">No prompt history is available yet.</div>
            ) : (
              <div className="history-list">
                {historyRows.slice(0, 12).map((item, index) => (
                  <article className="history-card" key={item?.id || index}>
                    <div><strong>{getHistoryLabel(item)}</strong><span>{formatDateTime(item?.created_at || item?.updated_at)}</span></div>
                    <p>{item?.change_note || item?.notes || "No change note saved."}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

const adminStyles = `
  .admin-page {
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
  .panel,
  .stat-card {
    max-width: 1380px;
    margin-left: auto;
    margin-right: auto;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    padding: 18px 20px;
    margin-bottom: 28px;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 22px;
    background: rgba(9,13,29,0.72);
    backdrop-filter: blur(14px);
    box-shadow: 0 10px 40px rgba(0,0,0,0.35);
  }

  .topbar strong {
    display: block;
    font-size: 22px;
    letter-spacing: -0.03em;
  }

  .eyebrow {
    margin: 0 0 8px;
    color: #8ea0d6;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .eyebrow.amber { color: #fcd34d; }

  .access-pill,
  .hero-badge,
  .team-pill,
  .chip,
  .tone,
  .status {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 800;
  }

  .access-pill {
    padding: 10px 14px;
    color: #fde68a;
    border: 1px solid rgba(245,158,11,0.24);
    background: rgba(245,158,11,0.11);
  }

  .access-pill.active {
    color: #bbf7d0;
    border-color: rgba(16,185,129,0.25);
    background: rgba(16,185,129,0.12);
  }

  .hero {
    position: relative;
    overflow: hidden;
    padding: 30px;
    margin-bottom: 24px;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 28px;
    background: linear-gradient(180deg, rgba(15,22,43,0.92), rgba(7,10,24,0.97));
    box-shadow: 0 20px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04);
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

  .hero.compact { max-width: 900px; margin-top: 80px; }

  .hero-badge {
    padding: 8px 12px;
    margin-bottom: 18px;
    color: #dbe7ff;
    border: 1px solid rgba(129,140,248,0.22);
    background: rgba(99,102,241,0.14);
  }

  h1,
  h2,
  h3,
  p { position: relative; }

  h1 {
    max-width: 1000px;
    margin: 0 0 18px;
    font-size: clamp(38px, 5vw, 64px);
    line-height: 1.02;
    letter-spacing: -0.06em;
  }

  h2 {
    margin: 0 0 10px;
    font-size: 28px;
    line-height: 1.12;
    letter-spacing: -0.04em;
  }

  h3 { margin: 0; font-size: 18px; }

  .hero p,
  .muted {
    color: #a9b4d0;
    font-size: 15px;
    line-height: 1.7;
  }

  .hero p {
    max-width: 1000px;
    margin: 0 0 20px;
    font-size: 18px;
  }

  .action-row,
  .chip-row,
  .table-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  button,
  input,
  textarea,
  select {
    font: inherit;
  }

  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .primary-btn,
  .secondary-btn {
    min-height: 46px;
    border-radius: 15px;
    padding: 12px 18px;
    font-size: 14px;
    font-weight: 800;
    cursor: pointer;
  }

  .primary-btn {
    color: white;
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
    min-height: 38px;
    padding: 9px 12px;
    font-size: 12px;
  }

  .status-grid,
  .two-col,
  .filter-grid {
    max-width: 1380px;
    margin-left: auto;
    margin-right: auto;
    display: grid;
    gap: 18px;
  }

  .status-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    margin-bottom: 24px;
  }

  .two-col {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    margin-bottom: 24px;
  }

  .stat-card,
  .panel,
  .mini-card,
  .history-card {
    border: 1px solid rgba(255,255,255,0.08);
    background: linear-gradient(180deg, rgba(10,15,32,0.9), rgba(7,10,22,0.96));
    box-shadow: 0 18px 40px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.03);
  }

  .stat-card {
    position: relative;
    overflow: hidden;
    padding: 20px;
    border-radius: 22px;
  }

  .stat-card::before {
    content: "";
    position: absolute;
    left: -55px;
    top: -55px;
    width: 150px;
    height: 150px;
    border-radius: 50%;
    filter: blur(34px);
    background: rgba(59,130,246,0.12);
  }

  .stat-card.success::before { background: rgba(16,185,129,0.12); }
  .stat-card.warning::before { background: rgba(245,158,11,0.14); }

  .stat-card p {
    margin: 0 0 10px;
    color: #8ea0d6;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .stat-card strong {
    display: block;
    margin-bottom: 8px;
    font-size: 27px;
    letter-spacing: -0.04em;
  }

  .stat-card span {
    display: block;
    color: #a9b4d0;
    font-size: 14px;
    line-height: 1.6;
  }

  .message-stack {
    max-width: 1380px;
    margin: 0 auto 24px;
    display: grid;
    gap: 12px;
  }

  .message {
    padding: 14px 16px;
    border-radius: 18px;
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

  .panel {
    padding: 24px;
    border-radius: 24px;
  }

  .panel.wide { margin-bottom: 24px; }

  .textarea,
  input,
  select {
    width: 100%;
    box-sizing: border-box;
    color: #e7ecff;
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 16px;
    outline: none;
    background: rgba(5,8,18,0.9);
  }

  input,
  select {
    min-height: 50px;
    padding: 0 14px;
  }

  .textarea {
    min-height: 110px;
    padding: 15px;
    line-height: 1.7;
    resize: vertical;
  }

  .textarea.tall { min-height: 420px; }
  .textarea.live { min-height: 320px; margin-bottom: 14px; }
  .textarea.note { min-height: 88px; margin-bottom: 14px; }

  .form-grid {
    display: grid;
    gap: 14px;
  }

  .form-grid.two { grid-template-columns: 1fr 1fr; }

  label span,
  .filter-grid label span {
    display: block;
    margin-bottom: 8px;
    color: #8ea0d6;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .check-row {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }

  .check-row input { width: auto; min-height: auto; }
  .check-row span { margin: 0; color: #dbe7ff; letter-spacing: 0; text-transform: none; font-size: 14px; }

  .empty-box {
    padding: 20px;
    color: #a9b4d0;
    border: 1px dashed rgba(255,255,255,0.12);
    border-radius: 18px;
    background: rgba(255,255,255,0.025);
    line-height: 1.7;
  }

  .success-box {
    color: #bbf7d0;
    border-color: rgba(16,185,129,0.22);
    background: rgba(16,185,129,0.07);
  }

  .scroll-stack {
    display: grid;
    gap: 12px;
    max-height: 560px;
    overflow: auto;
    padding-right: 4px;
  }

  .scroll-stack.compact-list { max-height: 520px; }

  .mini-card {
    padding: 16px;
    border-radius: 18px;
    background: rgba(255,255,255,0.035);
  }

  .warning-card {
    border-color: rgba(251,191,36,0.18);
    background: rgba(245,158,11,0.08);
  }

  .mini-head,
  .section-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
  }

  .mini-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .mini-grid span {
    color: #dbe7ff;
    font-size: 14px;
    line-height: 1.5;
  }

  .mini-grid b {
    display: block;
    color: #8ea0d6;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  .rule-list {
    display: grid;
    gap: 12px;
  }

  .rule-list div {
    padding: 16px;
    border-radius: 18px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03);
  }

  .rule-list b,
  .rule-list span {
    display: block;
  }

  .rule-list span {
    margin-top: 6px;
    color: #a9b4d0;
    line-height: 1.6;
  }

  .tiny-metrics {
    display: grid;
    grid-template-columns: repeat(2, minmax(120px, 1fr));
    gap: 10px;
    min-width: 300px;
  }

  .tiny-metrics span {
    padding: 12px;
    color: #a9b4d0;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.035);
  }

  .tiny-metrics b {
    display: block;
    color: #f5f7ff;
    font-size: 20px;
  }

  .filter-grid {
    grid-template-columns: minmax(260px, 1fr) 180px 230px auto;
    align-items: end;
    margin-bottom: 16px;
  }

  .clear-btn { min-height: 50px; }

  .chip-row {
    margin-bottom: 16px;
    align-items: center;
  }

  .chip-row > span,
  .chip {
    padding: 8px 12px;
    color: #dbe7ff;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 999px;
    background: rgba(255,255,255,0.04);
    font-size: 13px;
    font-weight: 800;
  }

  .chip.success { color: #bbf7d0; border-color: rgba(16,185,129,0.22); background: rgba(16,185,129,0.08); }
  .chip.warning { color: #fde68a; border-color: rgba(245,158,11,0.22); background: rgba(245,158,11,0.09); }
  .chip.notice { color: #bfdbfe; border-color: rgba(96,165,250,0.22); background: rgba(59,130,246,0.1); }

  .table-shell {
    max-height: 760px;
    overflow: auto;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 22px;
    background: rgba(4,8,20,0.72);
  }

  table {
    width: 100%;
    min-width: 1260px;
    border-collapse: collapse;
  }

  th,
  td {
    padding: 15px 14px;
    text-align: left;
    border-bottom: 1px solid rgba(255,255,255,0.065);
    vertical-align: top;
  }

  th {
    position: sticky;
    top: 0;
    z-index: 2;
    color: #8ea0d6;
    background: rgba(10,18,34,0.98);
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  tr:nth-child(even) td { background: rgba(255,255,255,0.018); }

  td strong,
  td small,
  td em {
    display: block;
  }

  td strong { color: #f5f7ff; margin-bottom: 4px; }
  td small { color: #a9b4d0; line-height: 1.5; }
  td em { margin-top: 8px; color: #8ea0d6; font-size: 12px; line-height: 1.5; font-style: normal; }

  .team-pill {
    padding: 7px 11px;
    color: #dbe7ff;
    border: 1px solid rgba(96,165,250,0.2);
    background: rgba(59,130,246,0.1);
  }

  .missing-text { color: #fcd34d; font-weight: 800; }

  .tone,
  .status {
    padding: 7px 10px;
    margin-bottom: 8px;
  }

  .tone.success,
  .status.active { color: #bbf7d0; border: 1px solid rgba(16,185,129,0.22); background: rgba(16,185,129,0.1); }
  .tone.warning,
  .status.inactive { color: #fde68a; border: 1px solid rgba(245,158,11,0.24); background: rgba(245,158,11,0.1); }
  .tone.notice { color: #bfdbfe; border: 1px solid rgba(96,165,250,0.24); background: rgba(59,130,246,0.1); }
  .tone.neutral { color: #dbe7ff; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); }
  .tone.danger { color: #fecdd3; border: 1px solid rgba(244,63,94,0.24); background: rgba(244,63,94,0.1); }

  .history-list {
    display: grid;
    gap: 12px;
  }

  .history-card {
    padding: 16px;
    border-radius: 18px;
    background: rgba(255,255,255,0.03);
  }

  .history-card div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }

  .history-card span,
  .history-card p {
    margin: 0;
    color: #a9b4d0;
    line-height: 1.6;
  }

  @media (max-width: 980px) {
    .two-col,
    .filter-grid,
    .form-grid.two {
      grid-template-columns: 1fr;
    }

    .section-head,
    .mini-head,
    .topbar {
      flex-direction: column;
      align-items: stretch;
    }

    .tiny-metrics {
      min-width: 0;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
`;
