"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

const MASTER_ADMIN_EMAIL = "faiyaz@nextventures.io";

const ROLE_OPTIONS = [
  {
    value: "master_admin",
    label: "Master Admin",
    description: "Full control over audits, admin, prompts, mappings, users, and history.",
    defaultCanRunTests: true,
  },
  {
    value: "supervisor_admin",
    label: "Supervisor Admin",
    description: "Can view dashboard and results. Run Audit and Admin remain locked unless extra access is granted.",
    defaultCanRunTests: false,
  },
  {
    value: "co_admin",
    label: "Co-Admin",
    description: "Can access Admin operational controls such as mappings and prompt management.",
    defaultCanRunTests: false,
  },
  {
    value: "audit_runner",
    label: "Audit Runner",
    description: "Can access Run Audit and Results, but cannot manage Admin controls.",
    defaultCanRunTests: true,
  },
  {
    value: "viewer",
    label: "Viewer",
    description: "Can view dashboard only unless additional access is granted later.",
    defaultCanRunTests: false,
  },
];

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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function roleLabel(role) {
  const found = ROLE_OPTIONS.find((item) => item.value === role);
  if (found) return found.label;

  return String(role || "viewer")
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function roleDescription(role) {
  const found = ROLE_OPTIONS.find((item) => item.value === role);
  return found?.description || "Legacy or custom role.";
}

function getHistoryLabel(item) {
  if (item?.prompt_type === "live_prompt") return "Live prompt update";
  if (item?.prompt_type === "original_prompt") return "Original prompt record";
  return item?.prompt_type || "Prompt change";
}

function buildFallbackProfile(user) {
  const email = normalizeEmail(user?.email);

  if (email === MASTER_ADMIN_EMAIL) {
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
  const role = String(profile?.role || "").toLowerCase();

  return Boolean(
    profile?.is_active === true &&
      (role === "master_admin" || role === "admin" || role === "co_admin")
  );
}

function canManageUsers(profile) {
  const email = normalizeEmail(profile?.email);
  const role = String(profile?.role || "").toLowerCase();

  return Boolean(
    profile?.is_active === true &&
      (email === MASTER_ADMIN_EMAIL || role === "master_admin" || role === "admin")
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

function createEmptyRoleForm() {
  return {
    id: "",
    email: "",
    full_name: "",
    role: "viewer",
    can_run_tests: false,
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
      issue_label: issueType === "inactive_mapping" ? "Inactive mapping" : "No active mapping",
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
    if (a.issue_type !== b.issue_type) {
      return a.issue_type === "missing_mapping" ? -1 : 1;
    }

    if (a.appearances !== b.appearances) return b.appearances - a.appearances;
    return a.intercom_agent_name.localeCompare(b.intercom_agent_name);
  });
}

function getMappingQuality(row, stats) {
  if (row?.is_active === false) {
    return {
      key: "inactive",
      label: "Inactive",
      detail: "Not used for future audits.",
      tone: "warning",
    };
  }

  const missingEmail = !String(row?.employee_email || "").trim();
  const missingTeam = !String(row?.team_name || "").trim();

  if (missingEmail && missingTeam) {
    return {
      key: "missing_email_team",
      label: "Needs email and team",
      detail: "Complete the employee profile.",
      tone: "warning",
    };
  }

  if (missingEmail) {
    return {
      key: "missing_email",
      label: "Needs email",
      detail: "Employee email is blank.",
      tone: "notice",
    };
  }

  if (missingTeam) {
    return {
      key: "missing_team",
      label: "Needs team",
      detail: "Team is blank.",
      tone: "notice",
    };
  }

  if (!stats?.appearances) {
    return {
      key: "no_stored_usage",
      label: "Ready",
      detail: "No recent stored usage.",
      tone: "neutral",
    };
  }

  return {
    key: "healthy",
    label: "Healthy",
    detail: "Active and complete.",
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

function getLockedNameForEmail(email, mappings) {
  const normalized = normalizeEmail(email);

  if (!normalized) return "";

  const match = (mappings || []).find(
    (item) => normalizeEmail(item?.employee_email) === normalized
  );

  return String(match?.employee_name || "").trim();
}

async function readApiJson(response) {
  const text = await response.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new Error(`Server returned a non-JSON response. Status ${response.status}.`);
  }
}

export default function AdminPage() {
  const mappingFormRef = useRef(null);
  const roleFormRef = useRef(null);

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

  const [profileRows, setProfileRows] = useState([]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [roleForm, setRoleForm] = useState(createEmptyRoleForm());
  const [roleSearch, setRoleSearch] = useState("");
  const [roleSaveLoading, setRoleSaveLoading] = useState(false);

  const isAdmin = canManageAdmin(profile);
  const canManageUsersNow = canManageUsers(profile);

  async function getFreshSession() {
    const { data, error } = await supabase.auth.getSession();

    if (error || !data?.session?.access_token) {
      throw new Error("Your login session is missing or expired. Please sign in again.");
    }

    setSession(data.session);
    return data.session;
  }

  async function loadProfile(user) {
    const email = normalizeEmail(user?.email);
    const domain = email.split("@")[1] || "";

    if (!user) return { profile: null, message: "" };

    if (domain !== "nextventures.io") {
      await supabase.auth.signOut();

      return {
        profile: null,
        message: "Access blocked. Use a nextventures.io Google account.",
      };
    }

    const fallbackProfile = buildFallbackProfile(user);

    try {
      const { data } = await supabase
        .from("profiles")
        .select("id, email, full_name, role, can_run_tests, is_active")
        .or(`id.eq.${user.id},email.eq.${email}`)
        .maybeSingle();

      if (data) {
        if (email === MASTER_ADMIN_EMAIL && data.role !== "master_admin") {
          await supabase
            .from("profiles")
            .update({
              role: "master_admin",
              can_run_tests: true,
              is_active: true,
            })
            .eq("id", data.id);

          return {
            profile: {
              ...data,
              role: "master_admin",
              can_run_tests: true,
              is_active: true,
            },
            message: "",
          };
        }

        return { profile: data, message: "" };
      }

      if (fallbackProfile) return { profile: fallbackProfile, message: "" };

      return {
        profile: null,
        message: "Signed in, but no profile record is available.",
      };
    } catch (_error) {
      if (fallbackProfile) return { profile: fallbackProfile, message: "" };

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

    const data = await readApiJson(response);

    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || "Could not load Admin prompt settings.");
    }

    setPromptData(data.prompt || null);
    setHistoryRows(Array.isArray(data.history) ? data.history : []);
    setDbReady(Boolean(data.dbReady));
    setLivePromptInput(data?.prompt?.livePrompt || "");
  }

  async function loadMappingsData(activeSession = session) {
    setMappingLoading(true);

    try {
      const usableSession = activeSession?.access_token ? activeSession : await getFreshSession();

      const response = await fetch("/api/admin/mappings", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${usableSession.access_token}`,
        },
      });

      const data = await readApiJson(response);

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Could not load mapping data.");
      }

      setMappingRows(Array.isArray(data.mappings) ? data.mappings : []);
      setAuditRows(Array.isArray(data.auditRows) ? data.auditRows : []);
    } finally {
      setMappingLoading(false);
    }
  }

  async function loadProfilesData() {
    setProfileLoading(true);

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, full_name, role, can_run_tests, is_active")
        .order("email", { ascending: true });

      if (error) throw new Error(error.message || "Could not load user profiles.");

      setProfileRows(Array.isArray(data) ? data : []);
    } finally {
      setProfileLoading(false);
    }
  }

  async function loadAll(activeSession) {
    setLoading(true);
    setPageError("");
    setPageSuccess("");

    try {
      await Promise.all([
        loadPromptData(activeSession),
        loadMappingsData(activeSession),
        loadProfilesData(),
      ]);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not load Admin data.");
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

        setPageError("Could not complete Admin session check.");
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
        setProfileRows([]);
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

    let usableSession;

    try {
      usableSession = await getFreshSession();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Please sign in first.");
      return;
    }

    if (!isAdmin) {
      setPageError("Only Master Admins and Co-Admins can save prompt settings.");
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
          Authorization: `Bearer ${usableSession.access_token}`,
        },
        body: JSON.stringify({
          livePrompt: livePromptInput,
          changeNote,
        }),
      });

      const data = await readApiJson(response);

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Could not save the live prompt.");
      }

      setPromptData(data.prompt || null);
      setHistoryRows(Array.isArray(data.history) ? data.history : []);
      setDbReady(Boolean(data.dbReady));
      setLivePromptInput(data?.prompt?.livePrompt || livePromptInput);
      setChangeNote("");
      setPageSuccess("Live prompt saved. New audits will use the updated live prompt.");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not save the live prompt.");
    } finally {
      setSaveLoading(false);
    }
  }

  function scrollToMappingForm() {
    setTimeout(() => {
      mappingFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
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
    setPageSuccess(`Editing mapping for ${row?.intercom_agent_name || "selected agent"}.`);
    scrollToMappingForm();
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
    setPageSuccess("Mapping form updated from detected agent.");
    scrollToMappingForm();
  }

  function handleResetMappingForm() {
    setMappingForm(createEmptyMappingForm());
    setPageError("");
    setPageSuccess("");
  }

  async function handleSaveMapping() {
    setPageError("");
    setPageSuccess("");

    if (!isAdmin) {
      setPageError("Only Master Admins and Co-Admins can save mappings.");
      return;
    }

    const intercomAgentName = String(mappingForm.intercom_agent_name || "").trim();
    const employeeName = String(mappingForm.employee_name || "").trim() || intercomAgentName;
    const employeeEmail = normalizeEmail(mappingForm.employee_email);
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

    if (employeeEmail && !employeeEmail.endsWith("@nextventures.io")) {
      setPageError("Employee email must use the nextventures.io domain.");
      return;
    }

    setMappingSaveLoading(true);

    try {
      const usableSession = await getFreshSession();

      const response = await fetch("/api/admin/mappings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${usableSession.access_token}`,
        },
        body: JSON.stringify({
          mapping: {
            id: mappingForm.id,
            intercom_agent_name: intercomAgentName,
            employee_name: employeeName,
            employee_email: employeeEmail || null,
            team_name: teamName || null,
            notes: notes || null,
            is_active: mappingForm.is_active !== false,
          },
        }),
      });

      const data = await readApiJson(response);

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Could not save mapping.");
      }

      setPageSuccess(data.message || "Mapping saved successfully.");
      setMappingForm(createEmptyMappingForm());
      await Promise.all([loadMappingsData(usableSession), loadProfilesData()]);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not save mapping.");
    } finally {
      setMappingSaveLoading(false);
    }
  }

  async function handleToggleMappingActive(row) {
    setPageError("");
    setPageSuccess("");

    if (!isAdmin) {
      setPageError("Only Master Admins and Co-Admins can update mappings.");
      return;
    }

    setMappingToggleLoadingId(row?.id || "");

    const previousRows = mappingRows;
    const nextActive = row?.is_active === false;

    setMappingRows((currentRows) =>
      currentRows.map((item) =>
        item.id === row.id
          ? {
              ...item,
              is_active: nextActive,
              updated_at: new Date().toISOString(),
            }
          : item
      )
    );

    try {
      const usableSession = await getFreshSession();

      const response = await fetch("/api/admin/mappings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${usableSession.access_token}`,
        },
        body: JSON.stringify({
          id: row.id,
          action: "set_active",
          is_active: nextActive,
        }),
      });

      const data = await readApiJson(response);

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Could not update mapping status.");
      }

      setPageSuccess(data.message || (nextActive ? "Mapping activated." : "Mapping deactivated."));
      await loadMappingsData(usableSession);
    } catch (error) {
      setMappingRows(previousRows);
      setPageError(error instanceof Error ? error.message : "Could not update mapping status.");
    } finally {
      setMappingToggleLoadingId("");
    }
  }

  async function handleSeedSuggestedMappings() {
    setPageError("");
    setPageSuccess("");

    if (!isAdmin) {
      setPageError("Only Master Admins and Co-Admins can prefill mappings.");
      return;
    }

    if (!mappingSuggestions.length) {
      setPageError("No detected agents to prefill.");
      return;
    }

    setSeedLoading(true);

    try {
      const usableSession = await getFreshSession();
      let savedCount = 0;

      for (const item of mappingSuggestions) {
        const response = await fetch("/api/admin/mappings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${usableSession.access_token}`,
          },
          body: JSON.stringify({
            mapping: {
              intercom_agent_name: item.intercom_agent_name,
              employee_name: item.employee_name || item.intercom_agent_name,
              employee_email: item.employee_email || null,
              team_name: item.team_name || null,
              notes: item.notes || "Detected from stored audit results.",
              is_active: true,
            },
          }),
        });

        const data = await readApiJson(response);

        if (!response.ok || !data?.ok) {
          throw new Error(data?.error || "Could not prefill mappings.");
        }

        savedCount += 1;
      }

      setPageSuccess(`${savedCount} mapping(s) added.`);
      await loadMappingsData(usableSession);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not prefill mappings.");
    } finally {
      setSeedLoading(false);
    }
  }

  function handleEditRole(row) {
    const email = normalizeEmail(row?.email);
    const lockedName = getLockedNameForEmail(email, mappingRows);

    setRoleForm({
      id: row?.id || "",
      email,
      full_name: lockedName || row?.full_name || "",
      role: row?.role || "viewer",
      can_run_tests: Boolean(row?.can_run_tests),
      is_active: row?.is_active !== false,
    });

    setPageError("");
    setPageSuccess(`Editing access for ${email}.`);

    setTimeout(() => {
      roleFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function handleRoleChange(nextRole) {
    const roleConfig = ROLE_OPTIONS.find((item) => item.value === nextRole);

    setRoleForm((prev) => ({
      ...prev,
      role: nextRole,
      can_run_tests:
        nextRole === "master_admin"
          ? true
          : roleConfig?.defaultCanRunTests ?? prev.can_run_tests,
    }));
  }

  async function handleSaveRole() {
    setPageError("");
    setPageSuccess("");

    if (!canManageUsersNow) {
      setPageError("Only Master Admins can manage user roles.");
      return;
    }

    const email = normalizeEmail(roleForm.email);
    const domain = email.split("@")[1] || "";

    if (!email || domain !== "nextventures.io") {
      setPageError("Use a valid nextventures.io email address.");
      return;
    }

    const existing = profileRows.find((row) => normalizeEmail(row?.email) === email);
    const lockedName = getLockedNameForEmail(email, mappingRows);

    if (!existing && !roleForm.id) {
      setPageError(
        "This user does not have a profile row yet. In the next backend pass, we will add true pre-login role grants by email. For now, ask the user to sign in once, then assign their role here."
      );
      return;
    }

    const nextRole = email === MASTER_ADMIN_EMAIL ? "master_admin" : roleForm.role;
    const nextCanRunTests =
      email === MASTER_ADMIN_EMAIL ? true : Boolean(roleForm.can_run_tests);
    const nextIsActive = email === MASTER_ADMIN_EMAIL ? true : Boolean(roleForm.is_active);
    const nextName = lockedName || String(roleForm.full_name || "").trim() || null;

    if (email === MASTER_ADMIN_EMAIL && nextRole !== "master_admin") {
      setPageError("The creator account must remain Master Admin.");
      return;
    }

    if (nextRole === "master_admin" && email !== MASTER_ADMIN_EMAIL) {
      const confirmed = window.confirm(
        `You are about to grant Master Admin access to ${email}. This gives full control over the platform. Continue?`
      );

      if (!confirmed) return;
    }

    setRoleSaveLoading(true);

    try {
      const payload = {
        email,
        full_name: nextName,
        role: nextRole,
        can_run_tests: nextCanRunTests,
        is_active: nextIsActive,
      };

      const targetId = roleForm.id || existing?.id;

      const { error } = await supabase.from("profiles").update(payload).eq("id", targetId);

      if (error) throw new Error(error.message || "Could not update user role.");

      setPageSuccess("User role updated.");
      setRoleForm(createEmptyRoleForm());
      await loadProfilesData();

      if (session?.user) {
        const profileResult = await loadProfile(session.user);
        setProfile(profileResult.profile);
      }
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not update user role.");
    } finally {
      setRoleSaveLoading(false);
    }
  }

  function handleClearRoleForm() {
    setRoleForm(createEmptyRoleForm());
    setPageError("");
    setPageSuccess("");
  }

  const storedAgentStats = useMemo(() => buildStoredAgentStats(auditRows), [auditRows]);

  const mappingSuggestions = useMemo(
    () => buildSuggestions(mappingRows, auditRows),
    [mappingRows, auditRows]
  );

  const unmappedRows = useMemo(
    () => buildUnmappedRows(mappingRows, auditRows),
    [mappingRows, auditRows]
  );

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

        return {
          ...row,
          stats,
          quality: getMappingQuality(row, stats),
        };
      }),
    [mappingRows, storedAgentStats]
  );

  const activeMappingsCount = mappingRows.filter((item) => item?.is_active !== false).length;
  const inactiveMappingsCount = mappingRows.length - activeMappingsCount;

  const incompleteMappingsCount = mappingTableRows.filter((row) =>
    ["missing_email_team", "missing_email", "missing_team"].includes(row.quality.key)
  ).length;

  const healthyMappingsCount = mappingTableRows.filter(
    (row) => row.quality.key === "healthy"
  ).length;

  const totalStoredAgentNames = storedAgentStats.size;

  const mappedCoveragePercent = totalStoredAgentNames
    ? Math.max(
        0,
        Math.round(((totalStoredAgentNames - unmappedRows.length) / totalStoredAgentNames) * 100)
      )
    : 100;

  const filteredMappings = useMemo(() => {
    const term = String(mappingSearch || "").trim().toLowerCase();

    return mappingTableRows.filter((row) => {
      if (mappingStatusFilter === "active" && row?.is_active === false) return false;
      if (mappingStatusFilter === "inactive" && row?.is_active !== false) return false;

      if (mappingQualityFilter === "needs_attention") {
        if (
          !["missing_email_team", "missing_email", "missing_team", "inactive"].includes(
            row.quality.key
          )
        ) {
          return false;
        }
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
  }, [mappingTableRows, mappingSearch, mappingStatusFilter, mappingQualityFilter]);

  const filteredProfileRows = useMemo(() => {
    const term = roleSearch.trim().toLowerCase();

    return profileRows.filter((row) => {
      if (!term) return true;

      return [
        row?.email,
        row?.full_name,
        row?.role,
        row?.can_run_tests ? "run audit" : "no run audit",
        row?.is_active ? "active" : "inactive",
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ")
        .includes(term);
    });
  }, [profileRows, roleSearch]);

  const lockedRoleName = getLockedNameForEmail(roleForm.email, mappingRows);

  const statusCards = [
    {
      label: "Prompt",
      value: dbReady ? "Ready" : "Not ready",
      note: dbReady ? "Live prompt connected." : "Prompt storage unavailable.",
      tone: dbReady ? "success" : "warning",
    },
    {
      label: "Coverage",
      value: `${mappedCoveragePercent}%`,
      note: totalStoredAgentNames
        ? `${formatNumber(totalStoredAgentNames - unmappedRows.length)} of ${formatNumber(
            totalStoredAgentNames
          )} agents covered.`
        : "No stored agent sample.",
      tone: unmappedRows.length ? "warning" : "success",
    },
    {
      label: "Mappings",
      value: `${formatNumber(activeMappingsCount)} / ${formatNumber(inactiveMappingsCount)}`,
      note: "Active / inactive.",
      tone: inactiveMappingsCount ? "notice" : "success",
    },
    {
      label: "Users",
      value: formatNumber(profileRows.length),
      note: `${formatNumber(
        profileRows.filter((item) => item?.is_active !== false).length
      )} active profile(s).`,
      tone: "notice",
    },
    {
      label: "Needs work",
      value: String(incompleteMappingsCount + unmappedRows.length),
      note: `${formatNumber(incompleteMappingsCount)} incomplete, ${formatNumber(
        unmappedRows.length
      )} unmapped.`,
      tone: incompleteMappingsCount || unmappedRows.length ? "warning" : "success",
    },
  ];

  if (authLoading) {
    return (
      <main className="admin-page">
        <style>{adminStyles}</style>
        <section className="hero compact">
          <p className="eyebrow">Next Ventures</p>
          <h1>Loading Admin...</h1>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <style>{adminStyles}</style>

      <section className="hero">
        <div>
          <div className="hero-badge">Admin</div>
          <h1>Control center</h1>
          <p>Manage prompts, agent mappings, user roles, and future system settings from one polished workspace.</p>
        </div>

        <div className="hero-side-card">
          <span>Current access</span>
          <strong>{roleLabel(profile?.role)}</strong>
          <small>{profile?.email || session?.user?.email || "Not signed in"}</small>
        </div>

        <div className="action-row">
          <button
            type="button"
            className="secondary-btn"
            onClick={handleReload}
            disabled={!session || loading || mappingLoading || profileLoading}
          >
            {loading || mappingLoading || profileLoading ? "Loading..." : "Reload"}
          </button>

          <button
            type="button"
            className="primary-btn"
            onClick={handleSeedSuggestedMappings}
            disabled={!isAdmin || seedLoading || !mappingSuggestions.length}
          >
            {seedLoading ? "Prefilling..." : `Prefill agents (${mappingSuggestions.length})`}
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
        <section className="panel">
          <h2>Sign in required</h2>
          <p className="muted">Use the upper-right profile menu to sign in with a nextventures.io Google account.</p>
        </section>
      ) : !isAdmin ? (
        <section className="panel">
          <h2>Admin access required</h2>
          <p className="muted">This profile does not have Admin access. Please contact the Master Admin.</p>
        </section>
      ) : (
        <>
          <section className="control-grid">
            <article className="panel prompt-panel">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Live configuration</p>
                  <h2>Live prompt</h2>
                  <p className="muted">This is the prompt used by new audits. Update it here without changing code.</p>
                </div>

                <span className={dbReady ? "status active" : "status inactive"}>
                  {dbReady ? "Connected" : "Not ready"}
                </span>
              </div>

              <textarea
                className="textarea live"
                value={livePromptInput}
                onChange={(event) => setLivePromptInput(event.target.value)}
                placeholder="Live prompt"
              />

              <textarea
                className="textarea note"
                value={changeNote}
                onChange={(event) => setChangeNote(event.target.value)}
                placeholder="Optional change note"
              />

              <div className="action-row">
                <button
                  type="button"
                  className="primary-btn"
                  onClick={handleSavePrompt}
                  disabled={saveLoading || !livePromptInput.trim()}
                >
                  {saveLoading ? "Saving..." : "Save prompt"}
                </button>
              </div>

              <details className="trusted-prompt-drawer">
                <summary>Original trusted prompt reference</summary>
                <p>
                  This is kept as a read-only baseline. It is not meant to take over the live prompt unless you copy it manually.
                </p>
                <textarea
                  className="textarea trusted"
                  value={promptData?.originalTrustedPrompt || ""}
                  readOnly
                />
              </details>
            </article>

            <article className="panel api-panel">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Secure keys</p>
                  <h2>API key vault</h2>
                  <p className="muted">
                    This section is prepared for the next backend pass. Raw keys must be saved through server routes, never directly from this browser page.
                  </p>
                </div>
              </div>

              <div className="api-card-grid">
                <div className="api-card">
                  <span>Intercom</span>
                  <strong>Server-secured setup needed</strong>
                  <p>Next step: add a backend route that stores masked key records and lets audit routes read the active key server-side.</p>
                </div>

                <div className="api-card">
                  <span>OpenAI / GPT</span>
                  <strong>Server-secured setup needed</strong>
                  <p>Next step: move active GPT key lookup into a protected backend route instead of relying only on environment variables.</p>
                </div>
              </div>
            </article>
          </section>

          <section className="control-grid mapping-area">
            <article className="panel" ref={mappingFormRef}>
              <div className="section-head">
                <div>
                  <p className="eyebrow">Agent mapping</p>
                  <h2>{mappingForm.id ? "Edit mapping" : "Map agent"}</h2>
                  <p className="muted">
                    Map raw Intercom names to employee identity, team, and email for accurate reporting.
                  </p>
                </div>

                {mappingForm.id ? <span className="status active">Editing</span> : <span className="status neutral">New</span>}
              </div>

              <div className="form-grid single">
                <label>
                  <span>Intercom agent name</span>
                  <input
                    value={mappingForm.intercom_agent_name}
                    onChange={(event) =>
                      setMappingForm((prev) => ({
                        ...prev,
                        intercom_agent_name: event.target.value,
                      }))
                    }
                    placeholder="Intercom name"
                  />
                </label>

                <label>
                  <span>Employee name</span>
                  <input
                    value={mappingForm.employee_name}
                    onChange={(event) =>
                      setMappingForm((prev) => ({
                        ...prev,
                        employee_name: event.target.value,
                      }))
                    }
                    placeholder="Employee name"
                  />
                </label>

                <div className="form-grid two">
                  <label>
                    <span>Employee email</span>
                    <input
                      type="email"
                      value={mappingForm.employee_email}
                      onChange={(event) =>
                        setMappingForm((prev) => ({
                          ...prev,
                          employee_email: event.target.value,
                        }))
                      }
                      placeholder="employee@nextventures.io"
                    />
                  </label>

                  <label>
                    <span>Team name</span>
                    <input
                      value={mappingForm.team_name}
                      onChange={(event) =>
                        setMappingForm((prev) => ({
                          ...prev,
                          team_name: event.target.value,
                        }))
                      }
                      placeholder="Example: CEx"
                    />
                  </label>
                </div>

                <label>
                  <span>Notes</span>
                  <textarea
                    className="textarea note"
                    value={mappingForm.notes}
                    onChange={(event) =>
                      setMappingForm((prev) => ({
                        ...prev,
                        notes: event.target.value,
                      }))
                    }
                    placeholder="Optional notes"
                  />
                </label>

                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={mappingForm.is_active}
                    onChange={(event) =>
                      setMappingForm((prev) => ({
                        ...prev,
                        is_active: event.target.checked,
                      }))
                    }
                  />
                  <span>Active mapping for future audits</span>
                </label>

                <div className="action-row">
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={handleSaveMapping}
                    disabled={mappingSaveLoading}
                  >
                    {mappingSaveLoading ? "Saving..." : mappingForm.id ? "Update mapping" : "Save mapping"}
                  </button>

                  <button type="button" className="secondary-btn" onClick={handleResetMappingForm}>
                    Clear
                  </button>
                </div>
              </div>
            </article>

            <article className="panel">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Detected agents</p>
                  <h2>Suggested mappings</h2>
                  <p className="muted">Agents found in stored results without saved mappings.</p>
                </div>
              </div>

              {mappingSuggestions.length === 0 ? (
                <div className="empty-box">No new agent suggestions.</div>
              ) : (
                <div className="scroll-stack">
                  {mappingSuggestions.map((item) => (
                    <article className="mini-card" key={item.intercom_agent_name}>
                      <div className="mini-head">
                        <div>
                          <p className="eyebrow">Intercom agent</p>
                          <h3>{item.intercom_agent_name}</h3>
                        </div>

                        <button
                          type="button"
                          className="secondary-btn small"
                          onClick={() => handleUseSuggestion(item)}
                        >
                          Use
                        </button>
                      </div>

                      <div className="mini-grid">
                        <span>
                          <b>Employee</b>
                          {item.employee_name || "-"}
                        </span>
                        <span>
                          <b>Email</b>
                          {item.employee_email || "-"}
                        </span>
                        <span>
                          <b>Team</b>
                          {item.team_name || "-"}
                        </span>
                        <span>
                          <b>Seen</b>
                          {formatDateTime(item.latest_seen_at)}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </article>
          </section>

          <section className="control-grid">
            <article className="panel">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Mapping risk</p>
                  <h2>Unmapped agents</h2>
                  <p className="muted">Stored agents without active mapping coverage.</p>
                </div>
              </div>

              {unmappedRows.length === 0 ? (
                <div className="empty-box success-box">No unmapped stored agents.</div>
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
                              notes: "Prefilled from unmapped stored result.",
                            })
                          }
                        >
                          Map
                        </button>
                      </div>

                      <div className="mini-grid two-items">
                        <span>
                          <b>Count</b>
                          {item.appearances}
                        </span>
                        <span>
                          <b>Latest</b>
                          {formatDateTime(item.latest_seen_at)}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </article>

            <article className="panel">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Mapping summary</p>
                  <h2>Current status</h2>
                </div>
              </div>

              <div className="rule-list">
                <div>
                  <b>Active</b>
                  <span>{formatNumber(activeMappingsCount)} mapping(s)</span>
                </div>

                <div>
                  <b>Inactive</b>
                  <span>{formatNumber(inactiveMappingsCount)} mapping(s)</span>
                </div>

                <div>
                  <b>Healthy</b>
                  <span>{formatNumber(healthyMappingsCount)} mapping(s)</span>
                </div>

                <div>
                  <b>Needs work</b>
                  <span>{formatNumber(incompleteMappingsCount + unmappedRows.length)} item(s)</span>
                </div>
              </div>
            </article>
          </section>

          <section className="panel wide" ref={roleFormRef}>
            <div className="section-head">
              <div>
                <p className="eyebrow">Access control</p>
                <h2>User roles</h2>
                <p className="muted">
                  Manage existing user profiles. New users currently need to sign in once before role assignment; the next backend pass will add true email pre-grants.
                </p>
              </div>

              <span className={canManageUsersNow ? "status active" : "status inactive"}>
                {canManageUsersNow ? "Role manager" : "Read only"}
              </span>
            </div>

            <div className="role-grid">
              <div className="role-form-card">
                <h3>{roleForm.id ? "Edit user access" : "Select a user to edit"}</h3>

                <div className="form-grid single">
                  <label>
                    <span>Email</span>
                    <input
                      value={roleForm.email}
                      onChange={(event) =>
                        setRoleForm((prev) => ({
                          ...prev,
                          email: normalizeEmail(event.target.value),
                        }))
                      }
                      placeholder="employee@nextventures.io"
                    />
                  </label>

                  <label>
                    <span>Name</span>
                    <input
                      value={lockedRoleName || roleForm.full_name}
                      disabled={Boolean(lockedRoleName)}
                      onChange={(event) =>
                        setRoleForm((prev) => ({
                          ...prev,
                          full_name: event.target.value,
                        }))
                      }
                      placeholder="Optional name"
                    />
                    {lockedRoleName ? (
                      <small className="lock-note">
                        Name locked from Agent Mapping for audit trackability.
                      </small>
                    ) : null}
                  </label>

                  <label>
                    <span>Role</span>
                    <select
                      value={roleForm.role}
                      onChange={(event) => handleRoleChange(event.target.value)}
                      disabled={normalizeEmail(roleForm.email) === MASTER_ADMIN_EMAIL}
                    >
                      {ROLE_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                    <small className="lock-note">{roleDescription(roleForm.role)}</small>
                  </label>

                  <div className="permission-grid">
                    <label className="check-row permission-check">
                      <input
                        type="checkbox"
                        checked={roleForm.can_run_tests}
                        disabled={normalizeEmail(roleForm.email) === MASTER_ADMIN_EMAIL}
                        onChange={(event) =>
                          setRoleForm((prev) => ({
                            ...prev,
                            can_run_tests: event.target.checked,
                          }))
                        }
                      />
                      <span>Can run audits</span>
                    </label>

                    <label className="check-row permission-check">
                      <input
                        type="checkbox"
                        checked={roleForm.is_active}
                        disabled={normalizeEmail(roleForm.email) === MASTER_ADMIN_EMAIL}
                        onChange={(event) =>
                          setRoleForm((prev) => ({
                            ...prev,
                            is_active: event.target.checked,
                          }))
                        }
                      />
                      <span>Active user</span>
                    </label>
                  </div>

                  <div className="action-row">
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={handleSaveRole}
                      disabled={!canManageUsersNow || roleSaveLoading || !roleForm.id}
                    >
                      {roleSaveLoading ? "Saving..." : "Save role"}
                    </button>

                    <button type="button" className="secondary-btn" onClick={handleClearRoleForm}>
                      Clear
                    </button>
                  </div>
                </div>
              </div>

              <div className="role-table-card">
                <div className="filter-grid compact">
                  <label>
                    <span>Search users</span>
                    <input
                      value={roleSearch}
                      onChange={(event) => setRoleSearch(event.target.value)}
                      placeholder="Search by email, name, role, or status"
                    />
                  </label>
                </div>

                <div className="profile-list">
                  {profileLoading ? (
                    <div className="empty-box">Loading profiles...</div>
                  ) : filteredProfileRows.length === 0 ? (
                    <div className="empty-box">No matching profiles.</div>
                  ) : (
                    filteredProfileRows.map((row) => {
                      const email = normalizeEmail(row?.email);
                      const isCreator = email === MASTER_ADMIN_EMAIL;

                      return (
                        <article className="profile-card" key={row.id || row.email}>
                          <div>
                            <strong>{row.full_name || row.email}</strong>
                            <small>{row.email}</small>
                          </div>

                          <div className="profile-card-meta">
                            <span className={row.is_active === false ? "status inactive" : "status active"}>
                              {row.is_active === false ? "Inactive" : "Active"}
                            </span>
                            <span className="tone notice">{roleLabel(isCreator ? "master_admin" : row.role)}</span>
                            <span className={row.can_run_tests || isCreator ? "tone success" : "tone neutral"}>
                              {row.can_run_tests || isCreator ? "Run audit" : "No audit"}
                            </span>
                          </div>

                          <button
                            type="button"
                            className="secondary-btn small"
                            onClick={() =>
                              handleEditRole({
                                ...row,
                                role: isCreator ? "master_admin" : row.role,
                                can_run_tests: isCreator ? true : row.can_run_tests,
                                is_active: isCreator ? true : row.is_active,
                              })
                            }
                          >
                            Edit
                          </button>
                        </article>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="panel wide">
            <div className="section-head">
              <div>
                <p className="eyebrow">Mapping table</p>
                <h2>Agent mappings</h2>
                <p className="muted">Edit, activate, deactivate, and review mapping quality.</p>
              </div>

              <div className="tiny-metrics">
                <span>
                  <b>{formatNumber(mappingRows.length)}</b>
                  total
                </span>
                <span>
                  <b>{formatNumber(activeMappingsCount)}</b>
                  active
                </span>
                <span>
                  <b>{formatNumber(incompleteMappingsCount)}</b>
                  incomplete
                </span>
                <span>
                  <b>{formatNumber(unmappedRows.length)}</b>
                  risk
                </span>
              </div>
            </div>

            <div className="filter-grid">
              <label>
                <span>Search</span>
                <input
                  value={mappingSearch}
                  onChange={(event) => setMappingSearch(event.target.value)}
                  placeholder="Search mappings"
                />
              </label>

              <label>
                <span>Status</span>
                <select
                  value={mappingStatusFilter}
                  onChange={(event) => setMappingStatusFilter(event.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active only</option>
                  <option value="inactive">Inactive only</option>
                </select>
              </label>

              <label>
                <span>Quality</span>
                <select
                  value={mappingQualityFilter}
                  onChange={(event) => setMappingQualityFilter(event.target.value)}
                >
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

              <button
                type="button"
                className="secondary-btn clear-btn"
                onClick={() => {
                  setMappingSearch("");
                  setMappingStatusFilter("all");
                  setMappingQualityFilter("all");
                }}
              >
                Clear
              </button>
            </div>

            <div className="chip-row">
              <span>
                Showing {formatNumber(filteredMappings.length)} of {formatNumber(mappingRows.length)}
              </span>
              <span className={unmappedRows.length ? "chip warning" : "chip success"}>
                {formatNumber(unmappedRows.length)} risk
              </span>
              <span className={mappingSuggestions.length ? "chip notice" : "chip success"}>
                {formatNumber(mappingSuggestions.length)} detected
              </span>
            </div>

            {mappingLoading ? (
              <div className="empty-box">Loading mappings...</div>
            ) : filteredMappings.length === 0 ? (
              <div className="empty-box">No matching mapping rows.</div>
            ) : (
              <div className="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>Intercom agent</th>
                      <th>Employee</th>
                      <th>Team</th>
                      <th>Quality</th>
                      <th>Usage</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredMappings.map((row) => (
                      <tr key={row.id || row.intercom_agent_name}>
                        <td>
                          <strong>{row.intercom_agent_name || "-"}</strong>
                          <small>Raw Intercom name</small>
                        </td>

                        <td>
                          <strong>{row.employee_name || "-"}</strong>
                          <small>{row.employee_email || "No email"}</small>
                          {row.notes ? <em>{row.notes}</em> : null}
                        </td>

                        <td>
                          {row.team_name ? (
                            <span className="team-pill">{row.team_name}</span>
                          ) : (
                            <span className="missing-text">No team</span>
                          )}
                        </td>

                        <td>
                          <span className={toneClass(row.quality.tone)}>{row.quality.label}</span>
                          <small>{row.quality.detail}</small>
                        </td>

                        <td>
                          <strong>{formatNumber(row.stats.appearances)}</strong>
                          <small>
                            {row.stats.appearances
                              ? `Latest: ${formatDateTime(row.stats.latest_seen_at)}`
                              : "No stored usage"}
                          </small>
                        </td>

                        <td>
                          <span className={row.is_active === false ? "status inactive" : "status active"}>
                            {row.is_active === false ? "Inactive" : "Active"}
                          </span>
                        </td>

                        <td>
                          <div className="table-actions">
                            <button
                              type="button"
                              className="secondary-btn small"
                              onClick={() => handleEditMapping(row)}
                            >
                              Edit
                            </button>

                            <button
                              type="button"
                              className="secondary-btn small"
                              disabled={mappingToggleLoadingId === row.id}
                              onClick={() => handleToggleMappingActive(row)}
                            >
                              {mappingToggleLoadingId === row.id
                                ? "Saving..."
                                : row.is_active === false
                                ? "Activate"
                                : "Deactivate"}
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
                <p className="eyebrow">Prompt history</p>
                <h2>Recent changes</h2>
                <p className="muted">Recent saved prompt changes.</p>
              </div>
            </div>

            {historyRows.length === 0 ? (
              <div className="empty-box">No prompt history yet.</div>
            ) : (
              <div className="history-list">
                {historyRows.slice(0, 12).map((item, index) => (
                  <article className="history-card" key={item?.id || index}>
                    <div>
                      <strong>{getHistoryLabel(item)}</strong>
                      <span>{formatDateTime(item?.created_at || item?.updated_at)}</span>
                    </div>

                    <p>{item?.change_note || item?.notes || "No change note."}</p>
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
    padding: 28px 20px 64px;
    color: #f5f7ff;
    background:
      radial-gradient(circle at top left, rgba(59,130,246,0.17), transparent 24%),
      radial-gradient(circle at top right, rgba(168,85,247,0.17), transparent 22%),
      radial-gradient(circle at 50% 12%, rgba(99,102,241,0.12), transparent 22%),
      radial-gradient(circle at bottom center, rgba(6,182,212,0.08), transparent 24%),
      linear-gradient(180deg, #040714 0%, #060b1d 46%, #04060d 100%);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .hero,
  .panel,
  .stat-card,
  .status-grid,
  .control-grid,
  .message-stack {
    max-width: 1480px;
    margin-left: auto;
    margin-right: auto;
  }

  .eyebrow {
    margin: 0 0 8px;
    color: #9fb2ee;
    font-size: 12px;
    font-weight: 850;
    letter-spacing: 0.12em;
  }

  .eyebrow.amber {
    color: #fcd34d;
  }

  .hero {
    position: relative;
    overflow: hidden;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 24px;
    align-items: center;
    padding: 34px;
    margin-bottom: 20px;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 32px;
    background: linear-gradient(180deg, rgba(15,22,43,0.92), rgba(7,10,24,0.97));
    box-shadow: 0 24px 70px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04);
  }

  .hero::after {
    content: "";
    position: absolute;
    inset: -120px -110px auto auto;
    width: 420px;
    height: 420px;
    border-radius: 50%;
    background: rgba(124,58,237,0.22);
    filter: blur(55px);
    pointer-events: none;
  }

  .hero > * {
    position: relative;
    z-index: 1;
  }

  .hero.compact {
    max-width: 900px;
    margin-top: 80px;
  }

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
    font-weight: 850;
  }

  .hero-badge {
    padding: 8px 12px;
    margin-bottom: 16px;
    color: #dbe7ff;
    border: 1px solid rgba(129,140,248,0.22);
    background: rgba(99,102,241,0.14);
  }

  h1,
  h2,
  h3,
  p {
    position: relative;
  }

  h1 {
    max-width: 1000px;
    margin: 0 0 16px;
    font-size: clamp(42px, 5vw, 72px);
    line-height: 0.98;
    letter-spacing: -0.07em;
  }

  h2 {
    margin: 0 0 10px;
    font-size: 30px;
    line-height: 1.1;
    letter-spacing: -0.04em;
  }

  h3 {
    margin: 0;
    font-size: 18px;
  }

  .hero p,
  .muted {
    color: #a9b4d0;
    font-size: 15px;
    line-height: 1.7;
  }

  .hero p {
    max-width: 840px;
    margin: 0 0 20px;
    font-size: 18px;
  }

  .hero-side-card {
    padding: 18px;
    border-radius: 22px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.04);
  }

  .hero-side-card span,
  .hero-side-card strong,
  .hero-side-card small {
    display: block;
  }

  .hero-side-card span {
    margin-bottom: 8px;
    color: #9fb2ee;
    font-size: 12px;
    font-weight: 850;
    letter-spacing: 0.12em;
  }

  .hero-side-card strong {
    margin-bottom: 6px;
    font-size: 26px;
    letter-spacing: -0.04em;
  }

  .hero-side-card small {
    color: #a9b4d0;
    word-break: break-word;
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

  button:disabled,
  input:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .primary-btn,
  .secondary-btn {
    min-height: 46px;
    border-radius: 15px;
    padding: 12px 18px;
    font-size: 14px;
    font-weight: 850;
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
  .control-grid,
  .filter-grid {
    display: grid;
    gap: 18px;
  }

  .status-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    margin-bottom: 20px;
  }

  .control-grid {
    grid-template-columns: minmax(0, 1.25fr) minmax(380px, 0.75fr);
    margin-bottom: 20px;
  }

  .stat-card,
  .panel,
  .mini-card,
  .history-card,
  .api-card,
  .role-form-card,
  .role-table-card,
  .profile-card {
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

  .stat-card.success::before {
    background: rgba(16,185,129,0.12);
  }

  .stat-card.warning::before {
    background: rgba(245,158,11,0.14);
  }

  .stat-card.notice::before {
    background: rgba(59,130,246,0.13);
  }

  .stat-card p {
    margin: 0 0 10px;
    color: #9fb2ee;
    font-size: 12px;
    font-weight: 850;
    letter-spacing: 0.1em;
  }

  .stat-card strong {
    display: block;
    margin-bottom: 8px;
    font-size: 28px;
    letter-spacing: -0.04em;
  }

  .stat-card span {
    display: block;
    color: #a9b4d0;
    font-size: 14px;
    line-height: 1.6;
  }

  .message-stack {
    margin-bottom: 20px;
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
    border-radius: 26px;
  }

  .panel.wide {
    margin-bottom: 20px;
  }

  .section-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 18px;
  }

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

  .textarea.live {
    min-height: 420px;
    margin-bottom: 14px;
  }

  .textarea.note {
    min-height: 88px;
    margin-bottom: 14px;
  }

  .textarea.trusted {
    min-height: 260px;
    margin-top: 12px;
  }

  .trusted-prompt-drawer {
    margin-top: 18px;
    padding: 16px;
    border-radius: 18px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03);
  }

  .trusted-prompt-drawer summary {
    cursor: pointer;
    color: #e5ebff;
    font-weight: 850;
  }

  .trusted-prompt-drawer p {
    color: #a9b4d0;
    line-height: 1.7;
  }

  .api-card-grid {
    display: grid;
    gap: 14px;
  }

  .api-card {
    padding: 18px;
    border-radius: 20px;
    background: rgba(255,255,255,0.035);
  }

  .api-card span,
  .api-card strong,
  .api-card p {
    display: block;
  }

  .api-card span {
    margin-bottom: 8px;
    color: #9fb2ee;
    font-size: 12px;
    font-weight: 850;
    letter-spacing: 0.1em;
  }

  .api-card strong {
    margin-bottom: 8px;
    color: #ffffff;
    font-size: 18px;
  }

  .api-card p {
    margin: 0;
    color: #a9b4d0;
    line-height: 1.7;
  }

  .form-grid {
    display: grid;
    gap: 14px;
  }

  .form-grid.two {
    grid-template-columns: 1fr 1fr;
  }

  label span,
  .filter-grid label span {
    display: block;
    margin-bottom: 8px;
    color: #9fb2ee;
    font-size: 12px;
    font-weight: 850;
    letter-spacing: 0.1em;
  }

  .check-row {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }

  .check-row input {
    width: auto;
    min-height: auto;
  }

  .check-row span {
    margin: 0;
    color: #dbe7ff;
    letter-spacing: 0;
    font-size: 14px;
  }

  .permission-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .permission-check {
    padding: 14px;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.035);
  }

  .lock-note {
    display: block;
    margin-top: 8px;
    color: #a9b4d0;
    line-height: 1.5;
  }

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

  .scroll-stack.compact-list {
    max-height: 520px;
  }

  .mini-card {
    padding: 16px;
    border-radius: 18px;
    background: rgba(255,255,255,0.035);
  }

  .warning-card {
    border-color: rgba(251,191,36,0.18);
    background: rgba(245,158,11,0.08);
  }

  .mini-head {
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
    color: #9fb2ee;
    font-size: 11px;
    letter-spacing: 0.1em;
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

  .role-grid {
    display: grid;
    grid-template-columns: minmax(320px, 0.8fr) minmax(0, 1.2fr);
    gap: 18px;
  }

  .role-form-card,
  .role-table-card {
    padding: 18px;
    border-radius: 22px;
  }

  .profile-list {
    display: grid;
    gap: 12px;
    max-height: 640px;
    overflow: auto;
    padding-right: 4px;
  }

  .profile-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 14px;
    align-items: center;
    padding: 16px;
    border-radius: 18px;
    background: rgba(255,255,255,0.035);
  }

  .profile-card strong,
  .profile-card small {
    display: block;
  }

  .profile-card small {
    margin-top: 5px;
    color: #a9b4d0;
    word-break: break-word;
  }

  .profile-card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: flex-end;
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

  .filter-grid.compact {
    grid-template-columns: 1fr;
  }

  .clear-btn {
    min-height: 50px;
  }

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
    font-weight: 850;
  }

  .chip.success {
    color: #bbf7d0;
    border-color: rgba(16,185,129,0.22);
    background: rgba(16,185,129,0.08);
  }

  .chip.warning {
    color: #fde68a;
    border-color: rgba(245,158,11,0.22);
    background: rgba(245,158,11,0.09);
  }

  .chip.notice {
    color: #bfdbfe;
    border-color: rgba(96,165,250,0.22);
    background: rgba(59,130,246,0.1);
  }

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
    color: #9fb2ee;
    background: rgba(10,18,34,0.98);
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.1em;
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
    margin-bottom: 4px;
  }

  td small {
    color: #a9b4d0;
    line-height: 1.5;
  }

  td em {
    margin-top: 8px;
    color: #8ea0d6;
    font-size: 12px;
    line-height: 1.5;
    font-style: normal;
  }

  .team-pill {
    padding: 7px 11px;
    color: #dbe7ff;
    border: 1px solid rgba(96,165,250,0.2);
    background: rgba(59,130,246,0.1);
  }

  .missing-text {
    color: #fcd34d;
    font-weight: 850;
  }

  .tone,
  .status {
    padding: 7px 10px;
    margin-bottom: 8px;
  }

  .tone.success,
  .status.active {
    color: #bbf7d0;
    border: 1px solid rgba(16,185,129,0.22);
    background: rgba(16,185,129,0.1);
  }

  .tone.warning,
  .status.inactive {
    color: #fde68a;
    border: 1px solid rgba(245,158,11,0.24);
    background: rgba(245,158,11,0.1);
  }

  .tone.notice,
  .status.neutral {
    color: #bfdbfe;
    border: 1px solid rgba(96,165,250,0.24);
    background: rgba(59,130,246,0.1);
  }

  .tone.neutral {
    color: #dbe7ff;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.05);
  }

  .tone.danger {
    color: #fecdd3;
    border: 1px solid rgba(244,63,94,0.24);
    background: rgba(244,63,94,0.1);
  }

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

  @media (max-width: 1180px) {
    .hero,
    .control-grid,
    .role-grid {
      grid-template-columns: 1fr;
    }

    .hero-side-card {
      max-width: 100%;
    }
  }

  @media (max-width: 980px) {
    .filter-grid,
    .form-grid.two,
    .permission-grid {
      grid-template-columns: 1fr;
    }

    .section-head,
    .mini-head,
    .profile-card {
      grid-template-columns: 1fr;
      flex-direction: column;
      align-items: stretch;
    }

    .tiny-metrics {
      min-width: 0;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 640px) {
    .admin-page {
      padding: 20px 12px 56px;
    }

    .hero {
      padding: 24px;
    }

    h1 {
      font-size: 42px;
    }

    .tiny-metrics,
    .mini-grid {
      grid-template-columns: 1fr;
    }
  }
`;
