"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

const MASTER_ADMIN_EMAIL = "faiyaz@nextventures.io";
const TIMEOUT_MS = 10000;

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
    description: "Can access Admin operational controls such as mappings, prompt management, and Supervisor Teams.",
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

const API_KEY_TYPES = [
  {
    value: "intercom",
    label: "Intercom",
    description: "Used when fetching conversations before audits.",
    placeholder: "Paste new Intercom API key",
  },
  {
    value: "openai",
    label: "OpenAI / GPT",
    description: "Used when running AI audit analysis.",
    placeholder: "Paste new OpenAI API key",
  },
];


function withTimeout(promise, label, timeoutMs = TIMEOUT_MS) {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} took too long. The page was not locked. Try again or refresh once.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
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

  if (email.endsWith("@nextventures.io")) {
    return {
      id: user.id,
      email,
      full_name: user.user_metadata?.full_name || "",
      role: "viewer",
      can_run_tests: false,
      is_active: true,
    };
  }

  return null;
}

function canManageAdmin(profile) {
  const role = normalizeKey(profile?.role);

  return Boolean(
    profile?.is_active === true &&
      (role === "master_admin" || role === "admin" || role === "co_admin")
  );
}

function canManageUsers(profile) {
  const email = normalizeEmail(profile?.email);
  const role = normalizeKey(profile?.role);

  return Boolean(
    profile?.is_active === true &&
      (email === MASTER_ADMIN_EMAIL || role === "master_admin" || role === "admin")
  );
}

function canManageApiKeys(profile) {
  const email = normalizeEmail(profile?.email);
  const role = normalizeKey(profile?.role);

  return Boolean(
    profile?.is_active === true && email === MASTER_ADMIN_EMAIL && role === "master_admin"
  );
}

function createEmptyApiKeyForm() {
  return {
    key_label: "Primary key",
    secret_value: "",
    make_active: true,
  };
}

function apiTypeLabel(keyType) {
  return API_KEY_TYPES.find((item) => item.value === keyType)?.label || keyType;
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

function getMemberKey(member) {
  return normalizeEmail(member?.employee_email) || normalizeKey(member?.employee_name);
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

function createEmptySupervisorForm() {
  return {
    id: "",
    supervisor_name: "",
    supervisor_email: "",
    notes: "",
    is_active: true,
    members: [],
  };
}

function buildEmployeeOptionsFromMappings(rows) {
  const byEmployee = new Map();

  for (const row of rows || []) {
    if (row?.is_active === false) continue;

    const employeeName = normalizeText(row?.employee_name);
    if (!employeeName) continue;

    const key = normalizeEmail(row?.employee_email) || normalizeKey(employeeName);

    if (!byEmployee.has(key)) {
      byEmployee.set(key, {
        employee_name: employeeName,
        employee_email: row?.employee_email || null,
        intercom_agent_name: row?.intercom_agent_name || null,
        team_name: row?.team_name || null,
      });
    }
  }

  return Array.from(byEmployee.values()).sort((a, b) =>
    a.employee_name.localeCompare(b.employee_name)
  );
}

function sortSupervisorTeams(teams) {
  return [...(teams || [])].sort((a, b) =>
    normalizeText(a?.supervisor_name).localeCompare(normalizeText(b?.supervisor_name))
  );
}

function getRowDate(row) {
  return row?.replied_at || row?.created_at || null;
}

function buildStoredAgentStats(auditRows) {
  const stats = new Map();

  for (const row of auditRows || []) {
    const agentName = normalizeText(row?.agent_name);
    const key = normalizeKey(agentName);
    if (!key) continue;

    const current = stats.get(key) || {
      agent_name: agentName,
      appearances: 0,
      mapped_result_count: 0,
      unmapped_result_count: 0,
      latest_seen_at: getRowDate(row),
    };

    current.appearances += 1;

    const matchStatus = normalizeKey(row?.employee_match_status);
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
      .map((item) => normalizeKey(item?.intercom_agent_name))
      .filter(Boolean)
  );

  const byAgent = new Map();

  for (const row of auditRows || []) {
    const rawAgent = normalizeText(row?.agent_name);
    const key = normalizeKey(rawAgent);

    if (!key || existingKeys.has(key)) continue;

    const current = byAgent.get(key) || {
      intercom_agent_name: rawAgent,
      employee_name: "",
      employee_email: "",
      team_name: "",
      notes: "Detected from stored audit results.",
      result_count: 0,
      latest_seen_at: getRowDate(row),
    };

    current.result_count += 1;

    if (!current.employee_name && row?.employee_name) {
      current.employee_name = normalizeText(row.employee_name);
    }

    if (!current.employee_email && row?.employee_email) {
      current.employee_email = normalizeText(row.employee_email);
    }

    if (!current.team_name && row?.team_name) {
      current.team_name = normalizeText(row.team_name);
    }

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
    .sort((a, b) => b.result_count - a.result_count);
}

function buildUnmappedRows(existingMappings, auditRows) {
  const activeKeys = new Set(
    (existingMappings || [])
      .filter((item) => item?.is_active !== false)
      .map((item) => normalizeKey(item?.intercom_agent_name))
      .filter(Boolean)
  );

  const inactiveKeys = new Set(
    (existingMappings || [])
      .filter((item) => item?.is_active === false)
      .map((item) => normalizeKey(item?.intercom_agent_name))
      .filter(Boolean)
  );

  const grouped = new Map();

  for (const row of auditRows || []) {
    const rawAgent = normalizeText(row?.agent_name);
    const key = normalizeKey(rawAgent);
    if (!key || activeKeys.has(key)) continue;

    const issueType = inactiveKeys.has(key) ? "inactive_mapping" : "missing_mapping";

    const current = grouped.get(key) || {
      intercom_agent_name: rawAgent,
      issue_type: issueType,
      issue_label: issueType === "inactive_mapping" ? "Inactive mapping" : "No active mapping",
      appearances: 0,
      latest_seen_at: getRowDate(row),
      sample_employee_name: normalizeText(row?.employee_name),
      sample_employee_email: normalizeText(row?.employee_email),
      sample_team_name: normalizeText(row?.team_name),
    };

    current.appearances += 1;

    const previousSeen = new Date(current.latest_seen_at || 0).getTime();
    const rowSeen = new Date(getRowDate(row) || 0).getTime();

    if (rowSeen > previousSeen) {
      current.latest_seen_at = getRowDate(row);
      current.sample_employee_name = normalizeText(row?.employee_name);
      current.sample_employee_email = normalizeText(row?.employee_email);
      current.sample_team_name = normalizeText(row?.team_name);
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

  const missingEmail = !normalizeText(row?.employee_email);
  const missingTeam = !normalizeText(row?.team_name);

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

  return normalizeText(match?.employee_name);
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
  const supervisorFormRef = useRef(null);

  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authMessage, setAuthMessage] = useState("");

  const [loading, setLoading] = useState(false);
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
  const [roleCandidateSearch, setRoleCandidateSearch] = useState("");
  const [roleSaveLoading, setRoleSaveLoading] = useState(false);

  const [apiKeys, setApiKeys] = useState([]);
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [apiKeySaveLoading, setApiKeySaveLoading] = useState("");
  const [apiKeyActionLoadingId, setApiKeyActionLoadingId] = useState("");
  const [apiKeyForms, setApiKeyForms] = useState({
    intercom: createEmptyApiKeyForm(),
    openai: createEmptyApiKeyForm(),
  });

  const [supervisorTeams, setSupervisorTeams] = useState([]);
  const [supervisorEmployeeOptions, setSupervisorEmployeeOptions] = useState([]);
  const [supervisorLoading, setSupervisorLoading] = useState(false);
  const [supervisorSaveLoading, setSupervisorSaveLoading] = useState(false);
  const [supervisorToggleLoadingId, setSupervisorToggleLoadingId] = useState("");
  const [supervisorForm, setSupervisorForm] = useState(createEmptySupervisorForm());
  const [supervisorSearch, setSupervisorSearch] = useState("");
  const [supervisorMemberSearch, setSupervisorMemberSearch] = useState("");

  const isAdmin = canManageAdmin(profile);
  const canManageUsersNow = canManageUsers(profile);
  const canManageApiKeysNow = canManageApiKeys(profile);

  async function getFreshSession() {
    const result = await withTimeout(supabase.auth.getSession(), "Session check");

    const nextSession = result?.data?.session || null;
    setSession(nextSession);

    if (!nextSession?.access_token) {
      throw new Error("Your login session is missing or expired. Please sign in again.");
    }

    return nextSession;
  }

  async function loadProfile(user) {
    const email = normalizeEmail(user?.email);
    const domain = email.split("@")[1] || "";

    if (!user) return { profile: null, message: "" };

    if (domain !== "nextventures.io") {
      return {
        profile: null,
        message: "Access blocked. Use a nextventures.io Google account.",
      };
    }

    const fallbackProfile = buildFallbackProfile(user);

    try {
      const { data, error } = await withTimeout(
        supabase
          .from("profiles")
          .select("id, email, full_name, role, can_run_tests, is_active")
          .or(`id.eq.${user.id},email.eq.${email}`)
          .maybeSingle(),
        "Profile check"
      );

      if (error) {
        if (fallbackProfile) return { profile: fallbackProfile, message: "" };

        return {
          profile: null,
          message: error.message || "Signed in, but profile loading failed.",
        };
      }

      if (data) {
        if (email === MASTER_ADMIN_EMAIL) {
          return {
            profile: {
              ...data,
              email,
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
        profile: {
          id: user.id,
          email,
          full_name: user.user_metadata?.full_name || "",
          role: "viewer",
          can_run_tests: false,
          is_active: true,
        },
        message: "Signed in, but this account has not been granted Admin access.",
      };
    } catch (error) {
      if (fallbackProfile) return { profile: fallbackProfile, message: "" };

      return {
        profile: null,
        message: error instanceof Error ? error.message : "Signed in, but profile loading failed.",
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

    const response = await withTimeout(
      fetch("/api/admin/prompt", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${activeSession.access_token}`,
        },
      }),
      "Loading prompt settings"
    );

    const data = await readApiJson(response);

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
        withTimeout(
          supabase
            .from("agent_mappings")
            .select("*")
            .order("employee_name", { ascending: true })
            .order("intercom_agent_name", { ascending: true }),
          "Loading agent mappings"
        ),
        withTimeout(
          supabase
            .from("audit_results")
            .select(
              "id, agent_name, employee_name, employee_email, team_name, employee_match_status, created_at, replied_at"
            )
            .order("created_at", { ascending: false })
            .limit(5000),
          "Loading stored audit samples"
        ),
      ]);

      if (mappingsResponse.error) {
        throw new Error(mappingsResponse.error.message || "Could not load agent mappings.");
      }

      if (auditResponse.error) {
        throw new Error(auditResponse.error.message || "Could not load audit rows.");
      }

      const mappings = Array.isArray(mappingsResponse.data) ? mappingsResponse.data : [];

      setMappingRows(mappings);
      setAuditRows(Array.isArray(auditResponse.data) ? auditResponse.data : []);
      setSupervisorEmployeeOptions(buildEmployeeOptionsFromMappings(mappings));
    } finally {
      setMappingLoading(false);
    }
  }

  async function loadSupervisorTeamsData() {
    setSupervisorLoading(true);

    try {
      const teamsResult = await withTimeout(
        supabase
          .from("supervisor_teams")
          .select("id, supervisor_name, supervisor_email, notes, is_active, created_at, updated_at")
          .order("supervisor_name", { ascending: true })
          .limit(1000),
        "Loading Supervisor Teams"
      );

      if (teamsResult.error) {
        throw new Error(teamsResult.error.message || "Could not load Supervisor Teams.");
      }

      const teams = Array.isArray(teamsResult.data) ? teamsResult.data : [];
      const teamIds = teams.map((team) => team.id).filter(Boolean);
      let members = [];

      if (teamIds.length) {
        const membersResult = await withTimeout(
          supabase
            .from("supervisor_team_members")
            .select(
              "id, supervisor_team_id, employee_name, employee_email, intercom_agent_name, team_name, is_active, created_at, updated_at"
            )
            .in("supervisor_team_id", teamIds)
            .order("employee_name", { ascending: true })
            .limit(10000),
          "Loading Supervisor Team members"
        );

        if (membersResult.error) {
          throw new Error(membersResult.error.message || "Could not load Supervisor Team members.");
        }

        members = Array.isArray(membersResult.data) ? membersResult.data : [];
      }

      const membersByTeam = new Map();

      for (const member of members) {
        if (member?.is_active === false) continue;

        const current = membersByTeam.get(member.supervisor_team_id) || [];
        current.push(member);
        membersByTeam.set(member.supervisor_team_id, current);
      }

      setSupervisorTeams(
        sortSupervisorTeams(
          teams.map((team) => ({
            ...team,
            members: membersByTeam.get(team.id) || [],
          }))
        )
      );
    } finally {
      setSupervisorLoading(false);
    }
  }

  async function loadProfilesData() {
    setProfileLoading(true);

    try {
      const { data, error } = await withTimeout(
        supabase
          .from("profiles")
          .select("id, email, full_name, role, can_run_tests, is_active")
          .order("email", { ascending: true }),
        "Loading user profiles"
      );

      if (error) throw new Error(error.message || "Could not load user profiles.");

      setProfileRows(Array.isArray(data) ? data : []);
    } finally {
      setProfileLoading(false);
    }
  }


  async function loadApiKeysData(activeSession, allowed = canManageApiKeysNow) {
    if (!allowed || !activeSession?.access_token) {
      setApiKeys([]);
      return;
    }

    setApiKeyLoading(true);

    try {
      const response = await withTimeout(
        fetch("/api/admin/api-keys", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${activeSession.access_token}`,
          },
        }),
        "Loading API keys"
      );

      const data = await readApiJson(response);

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Could not load API keys.");
      }

      setApiKeys(Array.isArray(data.keys) ? data.keys : []);
    } finally {
      setApiKeyLoading(false);
    }
  }

  async function loadAll(activeSession, options = {}) {
    const silent = options.silent === true;
    const effectiveProfile = options.profile || profile;
    const allowApiKeys = canManageApiKeys(effectiveProfile);

    if (!silent) {
      setLoading(true);
      setPageError("");
      setPageSuccess("");
    }

    const jobs = [
      loadPromptData(activeSession),
      loadMappingsData(),
      loadSupervisorTeamsData(),
      loadProfilesData(),
    ];

    if (allowApiKeys) {
      jobs.push(loadApiKeysData(activeSession, true));
    } else {
      setApiKeys([]);
    }

    const results = await Promise.allSettled(jobs);
    const rejected = results.find((item) => item.status === "rejected");

    if (rejected) {
      setPageError(
        rejected.reason instanceof Error
          ? rejected.reason.message
          : "Some Admin data could not load."
      );
    } else if (!silent) {
      setPageSuccess("Admin loaded successfully.");
    }

    if (!silent) setLoading(false);
  }

  async function bootAdmin() {
    setAuthChecked(false);
    setAuthMessage("");
    setPageError("");

    try {
      const result = await withTimeout(supabase.auth.getSession(), "Session check");
      const currentSession = result?.data?.session || null;

      setSession(currentSession);

      if (!currentSession?.user) {
        setProfile(null);
        setAuthChecked(true);
        setLoading(false);
        return;
      }

      const profileResult = await loadProfile(currentSession.user);
      setProfile(profileResult.profile);
      setAuthMessage(profileResult.message || "");
      setAuthChecked(true);

      if (profileResult.profile && canManageAdmin(profileResult.profile)) {
        await loadAll(currentSession, { silent: true, profile: profileResult.profile });
      }

      setLoading(false);
    } catch (error) {
      setSession(null);
      setProfile(null);
      setAuthChecked(true);
      setLoading(false);
      setPageError(
        error instanceof Error
          ? error.message
          : "Could not complete Admin session check."
      );
    }
  }

  useEffect(() => {
    let active = true;

    bootAdmin();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;

      setSession(nextSession || null);

      if (!nextSession?.user) {
        setProfile(null);
        setAuthChecked(true);
        setAuthMessage("");
        return;
      }

      loadProfile(nextSession.user).then((result) => {
        if (!active) return;

        setProfile(result.profile);
        setAuthMessage(result.message || "");

        if (result.profile && canManageAdmin(result.profile)) {
          loadAll(nextSession, { silent: true, profile: result.profile });
        }
      });
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleReload() {
    setPageError("");
    setPageSuccess("");

    try {
      const freshSession = await getFreshSession();
      await loadAll(freshSession, { profile });
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not reload Admin.");
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

    if (error) setPageError(error.message || "Google sign-in failed.");
  }

  async function handleSavePrompt() {
    setPageError("");
    setPageSuccess("");

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
      const freshSession = await getFreshSession();

      const response = await withTimeout(
        fetch("/api/admin/prompt", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${freshSession.access_token}`,
          },
          body: JSON.stringify({
            livePrompt: livePromptInput,
            changeNote,
          }),
        }),
        "Saving live prompt"
      );

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

  function updateApiKeyForm(keyType, updates) {
    setApiKeyForms((prev) => ({
      ...prev,
      [keyType]: {
        ...(prev[keyType] || createEmptyApiKeyForm()),
        ...updates,
      },
    }));
  }

  async function handleSaveApiKey(keyType) {
    setPageError("");
    setPageSuccess("");

    if (!canManageApiKeysNow) {
      setPageError("Only the Creator Master Admin can manage API keys.");
      return;
    }

    const form = apiKeyForms[keyType] || createEmptyApiKeyForm();
    const secretValue = normalizeText(form.secret_value);
    const keyLabel = normalizeText(form.key_label) || "Primary key";

    if (!secretValue) {
      setPageError(`${apiTypeLabel(keyType)} API key is required.`);
      return;
    }

    setApiKeySaveLoading(keyType);

    try {
      const freshSession = await getFreshSession();

      const response = await withTimeout(
        fetch("/api/admin/api-keys", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${freshSession.access_token}`,
          },
          body: JSON.stringify({
            keyType,
            keyLabel,
            secretValue,
            makeActive: form.make_active !== false,
          }),
        }),
        `Saving ${apiTypeLabel(keyType)} API key`
      );

      const data = await readApiJson(response);

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `Could not save ${apiTypeLabel(keyType)} API key.`);
      }

      setApiKeys(Array.isArray(data.keys) ? data.keys : []);
      updateApiKeyForm(keyType, createEmptyApiKeyForm());
      setPageSuccess(data.message || `${apiTypeLabel(keyType)} API key saved.`);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : `Could not save ${apiTypeLabel(keyType)} API key.`);
    } finally {
      setApiKeySaveLoading("");
    }
  }

  async function handleActivateApiKey(row) {
    setPageError("");
    setPageSuccess("");

    if (!canManageApiKeysNow) {
      setPageError("Only the Creator Master Admin can manage API keys.");
      return;
    }

    setApiKeyActionLoadingId(row?.id || "");

    try {
      const freshSession = await getFreshSession();

      const response = await withTimeout(
        fetch("/api/admin/api-keys", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${freshSession.access_token}`,
          },
          body: JSON.stringify({
            id: row.id,
            isActive: true,
          }),
        }),
        `Activating ${apiTypeLabel(row?.key_type)} API key`
      );

      const data = await readApiJson(response);

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Could not activate API key.");
      }

      setApiKeys(Array.isArray(data.keys) ? data.keys : []);
      setPageSuccess(data.message || "API key activated.");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not activate API key.");
    } finally {
      setApiKeyActionLoadingId("");
    }
  }

  async function handleDeactivateApiKey(row) {
    setPageError("");
    setPageSuccess("");

    if (!canManageApiKeysNow) {
      setPageError("Only the Creator Master Admin can manage API keys.");
      return;
    }

    const confirmed = window.confirm(
      `Deactivate this ${apiTypeLabel(row?.key_type)} API key? The app may fail if there is no other active key of this type.`
    );

    if (!confirmed) return;

    setApiKeyActionLoadingId(row?.id || "");

    try {
      const freshSession = await getFreshSession();

      const response = await withTimeout(
        fetch(`/api/admin/api-keys?id=${encodeURIComponent(row.id)}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${freshSession.access_token}`,
          },
        }),
        `Deactivating ${apiTypeLabel(row?.key_type)} API key`
      );

      const data = await readApiJson(response);

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Could not deactivate API key.");
      }

      setApiKeys(Array.isArray(data.keys) ? data.keys : []);
      setPageSuccess(data.message || "API key deactivated.");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not deactivate API key.");
    } finally {
      setApiKeyActionLoadingId("");
    }
  }

  function scrollToMappingForm() {
    setTimeout(() => {
      mappingFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function scrollToSupervisorForm() {
    setTimeout(() => {
      supervisorFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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

    const intercomAgentName = normalizeText(mappingForm.intercom_agent_name);
    const employeeName = normalizeText(mappingForm.employee_name) || intercomAgentName;
    const employeeEmail = normalizeEmail(mappingForm.employee_email);
    const teamName = normalizeText(mappingForm.team_name);
    const notes = normalizeText(mappingForm.notes);

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
      const existingMatch = mappingRows.find(
        (item) => normalizeKey(item?.intercom_agent_name) === normalizeKey(intercomAgentName)
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

        const { error } = await withTimeout(
          supabase.from("agent_mappings").update(payload).eq("id", targetId),
          "Updating agent mapping"
        );

        if (error) throw new Error(error.message || "Could not update the mapping.");

        setPageSuccess("Agent mapping updated successfully.");
      } else {
        const { error } = await withTimeout(
          supabase.from("agent_mappings").insert({
            ...payload,
            created_at: new Date().toISOString(),
          }),
          "Creating agent mapping"
        );

        if (error) throw new Error(error.message || "Could not create the mapping.");

        setPageSuccess("Agent mapping created successfully.");
      }

      setMappingForm(createEmptyMappingForm());
      await loadMappingsData();
      await loadSupervisorTeamsData();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not save mapping.");
    } finally {
      setMappingSaveLoading(false);
    }
  }

  async function handleToggleMappingActive(row) {
    setPageError("");
    setPageSuccess("");
    setMappingToggleLoadingId(row?.id || "");

    try {
      const nextActive = row?.is_active === false;

      const { error } = await withTimeout(
        supabase
          .from("agent_mappings")
          .update({
            is_active: nextActive,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id),
        "Updating mapping status"
      );

      if (error) throw new Error(error.message || "Could not update mapping status.");

      setPageSuccess(nextActive ? "Mapping activated." : "Mapping deactivated.");
      await loadMappingsData();
      await loadSupervisorTeamsData();
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
      setPageError("Only Master Admins and Co-Admins can prefill mappings.");
      return;
    }

    if (!mappingSuggestions.length) {
      setPageError("No detected agents to prefill.");
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

      const { error } = await withTimeout(
        supabase.from("agent_mappings").insert(rows),
        "Prefilling detected agents"
      );

      if (error) throw new Error(error.message || "Could not prefill mappings.");

      setPageSuccess(`${rows.length} mapping(s) added.`);
      await loadMappingsData();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not prefill mappings.");
    } finally {
      setSeedLoading(false);
    }
  }

  function isSupervisorMemberSelected(option) {
    const optionKey = getMemberKey(option);
    return supervisorForm.members.some((member) => getMemberKey(member) === optionKey);
  }

  function handleToggleSupervisorMember(option) {
    const optionKey = getMemberKey(option);

    setSupervisorForm((prev) => {
      const exists = prev.members.some((member) => getMemberKey(member) === optionKey);

      if (exists) {
        return {
          ...prev,
          members: prev.members.filter((member) => getMemberKey(member) !== optionKey),
        };
      }

      return {
        ...prev,
        members: [
          ...prev.members,
          {
            employee_name: option.employee_name,
            employee_email: option.employee_email || null,
            intercom_agent_name: option.intercom_agent_name || null,
            team_name: option.team_name || null,
            is_active: true,
          },
        ],
      };
    });
  }

  function handleUseSupervisorCandidate(option) {
    setSupervisorForm((prev) => ({
      ...prev,
      supervisor_name: option.employee_name || prev.supervisor_name,
      supervisor_email: option.employee_email || prev.supervisor_email,
    }));
  }

  function handleEditSupervisorTeam(team) {
    setSupervisorForm({
      id: team?.id || "",
      supervisor_name: team?.supervisor_name || "",
      supervisor_email: team?.supervisor_email || "",
      notes: team?.notes || "",
      is_active: team?.is_active !== false,
      members: Array.isArray(team?.members) ? team.members : [],
    });

    setSupervisorMemberSearch("");
    setPageError("");
    setPageSuccess(`Editing Supervisor Team for ${team?.supervisor_name || "selected supervisor"}.`);
    scrollToSupervisorForm();
  }

  function handleClearSupervisorForm() {
    setSupervisorForm(createEmptySupervisorForm());
    setSupervisorMemberSearch("");
    setPageError("");
    setPageSuccess("");
  }

  async function handleSaveSupervisorTeam() {
    setPageError("");
    setPageSuccess("");

    if (!isAdmin) {
      setPageError("Only Master Admins and Co-Admins can save Supervisor Teams.");
      return;
    }

    const supervisorName = normalizeText(supervisorForm.supervisor_name);
    const supervisorEmail = normalizeEmail(supervisorForm.supervisor_email);

    if (!supervisorName) {
      setPageError("Supervisor name is required.");
      return;
    }

    if (supervisorEmail && !supervisorEmail.endsWith("@nextventures.io")) {
      setPageError("Supervisor email must use the nextventures.io domain.");
      return;
    }

    setSupervisorSaveLoading(true);

    try {
      const now = new Date().toISOString();

      const existingByForm = supervisorForm.id
        ? supervisorTeams.find((team) => team.id === supervisorForm.id)
        : null;

      const existingByEmail = supervisorEmail
        ? supervisorTeams.find((team) => normalizeEmail(team?.supervisor_email) === supervisorEmail)
        : null;

      const existingByName = supervisorTeams.find(
        (team) => normalizeKey(team?.supervisor_name) === normalizeKey(supervisorName)
      );

      const existingTeam = existingByForm || existingByEmail || existingByName;
      let savedTeam;

      if (existingTeam?.id) {
        const { data, error } = await withTimeout(
          supabase
            .from("supervisor_teams")
            .update({
              supervisor_name: supervisorName,
              supervisor_email: supervisorEmail || null,
              notes: normalizeText(supervisorForm.notes) || null,
              is_active: supervisorForm.is_active !== false,
              updated_at: now,
            })
            .eq("id", existingTeam.id)
            .select("id, supervisor_name, supervisor_email, notes, is_active, created_at, updated_at")
            .single(),
          "Updating Supervisor Team"
        );

        if (error) throw new Error(error.message || "Could not update Supervisor Team.");
        savedTeam = data;
      } else {
        const { data, error } = await withTimeout(
          supabase
            .from("supervisor_teams")
            .insert({
              supervisor_name: supervisorName,
              supervisor_email: supervisorEmail || null,
              notes: normalizeText(supervisorForm.notes) || null,
              is_active: supervisorForm.is_active !== false,
              created_at: now,
              updated_at: now,
            })
            .select("id, supervisor_name, supervisor_email, notes, is_active, created_at, updated_at")
            .single(),
          "Creating Supervisor Team"
        );

        if (error) throw new Error(error.message || "Could not create Supervisor Team.");
        savedTeam = data;
      }

      if (!savedTeam?.id) {
        throw new Error("Supervisor Team saved without an ID. Check the supervisor_teams table.");
      }

      const uniqueMembers = new Map();

      for (const member of supervisorForm.members || []) {
        const employeeName = normalizeText(member?.employee_name);
        if (!employeeName) continue;

        const memberKey = normalizeKey(employeeName);

        if (!uniqueMembers.has(memberKey)) {
          uniqueMembers.set(memberKey, {
            supervisor_team_id: savedTeam.id,
            employee_name: employeeName,
            employee_email: normalizeEmail(member?.employee_email) || null,
            intercom_agent_name: normalizeText(member?.intercom_agent_name) || null,
            team_name: normalizeText(member?.team_name) || null,
            is_active: true,
            created_at: now,
            updated_at: now,
          });
        }
      }

      const desiredMembers = Array.from(uniqueMembers.values());

      if (desiredMembers.length > 0) {
        const { error: upsertError } = await withTimeout(
          supabase
            .from("supervisor_team_members")
            .upsert(desiredMembers, {
              onConflict: "supervisor_team_id,employee_name",
            }),
          "Saving Supervisor Team members"
        );

        if (upsertError) {
          throw new Error(upsertError.message || "Could not save Supervisor Team members.");
        }
      }

      const { data: currentMembers, error: currentMembersError } = await withTimeout(
        supabase
          .from("supervisor_team_members")
          .select("id, employee_name")
          .eq("supervisor_team_id", savedTeam.id),
        "Checking current Supervisor Team members"
      );

      if (currentMembersError) {
        throw new Error(currentMembersError.message || "Could not verify saved members.");
      }

      const desiredNames = new Set(desiredMembers.map((member) => normalizeKey(member.employee_name)));
      const obsoleteIds = (currentMembers || [])
        .filter((member) => !desiredNames.has(normalizeKey(member.employee_name)))
        .map((member) => member.id)
        .filter(Boolean);

      if (obsoleteIds.length > 0) {
        const { error: deleteError } = await withTimeout(
          supabase.from("supervisor_team_members").delete().in("id", obsoleteIds),
          "Removing unselected Supervisor Team members"
        );

        if (deleteError) {
          throw new Error(deleteError.message || "Could not remove unselected members.");
        }
      }

      setSupervisorForm(createEmptySupervisorForm());
      setSupervisorMemberSearch("");
      setPageSuccess(
        `${savedTeam.supervisor_name} saved successfully with ${formatNumber(desiredMembers.length)} member(s).`
      );

      await loadSupervisorTeamsData();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not save Supervisor Team.");
    } finally {
      setSupervisorSaveLoading(false);
    }
  }

  async function handleToggleSupervisorTeamActive(team) {
    setPageError("");
    setPageSuccess("");

    if (!isAdmin) {
      setPageError("Only Master Admins and Co-Admins can update Supervisor Teams.");
      return;
    }

    setSupervisorToggleLoadingId(team?.id || "");

    try {
      const nextActive = team?.is_active === false;

      const { error } = await withTimeout(
        supabase
          .from("supervisor_teams")
          .update({
            is_active: nextActive,
            updated_at: new Date().toISOString(),
          })
          .eq("id", team.id),
        "Updating Supervisor Team status"
      );

      if (error) throw new Error(error.message || "Could not update Supervisor Team.");

      setPageSuccess(nextActive ? "Supervisor Team activated." : "Supervisor Team deactivated.");
      await loadSupervisorTeamsData();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not update Supervisor Team.");
    } finally {
      setSupervisorToggleLoadingId("");
    }
  }

  function handleUseRoleCandidate(option) {
    const email = normalizeEmail(option?.employee_email);
    const existing = email
      ? profileRows.find((row) => normalizeEmail(row?.email) === email)
      : null;

    setRoleCandidateSearch(option?.employee_name || "");
    setRoleForm({
      id: existing?.id || "",
      email,
      full_name: option?.employee_name || existing?.full_name || "",
      role: existing?.role || "viewer",
      can_run_tests: Boolean(existing?.can_run_tests),
      is_active: existing ? existing.is_active !== false : true,
    });

    setPageError("");
    setPageSuccess(
      existing
        ? `Selected ${option?.employee_name || email} from Agent Mapping.`
        : "Employee selected. This user must sign in once before role assignment can be saved."
    );
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

    setRoleCandidateSearch(row?.full_name || row?.email || "");
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

  function handleClearRoleForm() {
    setRoleForm(createEmptyRoleForm());
    setRoleCandidateSearch("");
    setPageError("");
    setPageSuccess("");
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
      setPageError("This user needs to sign in once before you can assign their role.");
      return;
    }

    const nextRole = email === MASTER_ADMIN_EMAIL ? "master_admin" : roleForm.role;
    const nextCanRunTests = email === MASTER_ADMIN_EMAIL ? true : Boolean(roleForm.can_run_tests);
    const nextIsActive = email === MASTER_ADMIN_EMAIL ? true : Boolean(roleForm.is_active);
    const nextName = lockedName || normalizeText(roleForm.full_name) || null;

    if (nextRole === "master_admin" && email !== MASTER_ADMIN_EMAIL) {
      const confirmed = window.confirm(
        `You are about to grant Master Admin access to ${email}. This gives full control over the platform. Continue?`
      );

      if (!confirmed) return;
    }

    setRoleSaveLoading(true);

    try {
      const targetId = roleForm.id || existing?.id;

      const { error } = await withTimeout(
        supabase
          .from("profiles")
          .update({
            email,
            full_name: nextName,
            role: nextRole,
            can_run_tests: nextCanRunTests,
            is_active: nextIsActive,
          })
          .eq("id", targetId),
        "Saving user role"
      );

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
        const key = normalizeKey(row?.intercom_agent_name);

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

  const activeSupervisorTeamsCount = supervisorTeams.filter((item) => item?.is_active !== false).length;
  const totalSupervisorMembersCount = supervisorTeams.reduce(
    (sum, team) => sum + (Array.isArray(team.members) ? team.members.length : 0),
    0
  );

  const filteredMappings = useMemo(() => {
    const term = normalizeKey(mappingSearch);

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
        .map((value) => normalizeKey(value))
        .join(" ")
        .includes(term);
    });
  }, [mappingTableRows, mappingSearch, mappingStatusFilter, mappingQualityFilter]);

  const filteredProfileRows = useMemo(() => {
    const term = normalizeKey(roleSearch);

    return profileRows.filter((row) => {
      if (!term) return true;

      return [
        row?.email,
        row?.full_name,
        row?.role,
        row?.can_run_tests ? "run audit" : "no run audit",
        row?.is_active ? "active" : "inactive",
      ]
        .map((value) => normalizeKey(value))
        .join(" ")
        .includes(term);
    });
  }, [profileRows, roleSearch]);

  const filteredSupervisorTeams = useMemo(() => {
    const term = normalizeKey(supervisorSearch);

    return supervisorTeams.filter((team) => {
      if (!term) return true;

      const memberText = (team.members || [])
        .map((member) =>
          [
            member.employee_name,
            member.employee_email,
            member.intercom_agent_name,
            member.team_name,
          ]
            .filter(Boolean)
            .join(" ")
        )
        .join(" ");

      return [
        team.supervisor_name,
        team.supervisor_email,
        team.notes,
        team.is_active === false ? "inactive" : "active",
        memberText,
      ]
        .map((value) => normalizeKey(value))
        .join(" ")
        .includes(term);
    });
  }, [supervisorTeams, supervisorSearch]);

  const filteredSupervisorEmployeeOptions = useMemo(() => {
    const term = normalizeKey(supervisorMemberSearch);

    return supervisorEmployeeOptions.filter((item) => {
      if (!term) return true;

      return [
        item.employee_name,
        item.employee_email,
        item.intercom_agent_name,
        item.team_name,
      ]
        .map((value) => normalizeKey(value))
        .join(" ")
        .includes(term);
    });
  }, [supervisorEmployeeOptions, supervisorMemberSearch]);

  const filteredSupervisorCandidateOptions = useMemo(() => {
    const term = normalizeKey(supervisorForm.supervisor_name);

    if (term.length < 2) return [];

    return supervisorEmployeeOptions
      .filter((item) =>
        [item.employee_name, item.employee_email, item.intercom_agent_name, item.team_name]
          .map((value) => normalizeKey(value))
          .join(" ")
          .includes(term)
      )
      .slice(0, 8);
  }, [supervisorEmployeeOptions, supervisorForm.supervisor_name]);

  const lockedRoleName = getLockedNameForEmail(roleForm.email, mappingRows);

  const filteredRoleCandidateOptions = useMemo(() => {
    const term = normalizeKey(roleCandidateSearch || roleForm.email || roleForm.full_name);

    if (term.length < 2) return [];

    return supervisorEmployeeOptions
      .filter((item) =>
        [item.employee_name, item.employee_email, item.intercom_agent_name, item.team_name]
          .map((value) => normalizeKey(value))
          .join(" ")
          .includes(term)
      )
      .slice(0, 10);
  }, [supervisorEmployeeOptions, roleCandidateSearch, roleForm.email, roleForm.full_name]);

  const apiKeysByType = useMemo(() => {
    const grouped = new Map();

    for (const type of API_KEY_TYPES) {
      grouped.set(type.value, []);
    }

    for (const row of apiKeys || []) {
      const current = grouped.get(row.key_type) || [];
      current.push(row);
      grouped.set(row.key_type, current);
    }

    return grouped;
  }, [apiKeys]);

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
      label: "Supervisor teams",
      value: formatNumber(activeSupervisorTeamsCount),
      note: `${formatNumber(totalSupervisorMembersCount)} assigned member(s).`,
      tone: activeSupervisorTeamsCount ? "success" : "notice",
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

  return (
    <main className="admin-page">
      <style>{adminStyles}</style>

      <section className="hero">
        <div>
          <div className="hero-badge">Admin</div>
          <h1>Control center</h1>
          <p>
            Manage prompts, agent mappings, Supervisor Teams, user roles, and future system settings from one polished workspace.
          </p>
        </div>

        <div className="hero-side-card">
          <span>Current access</span>
          <strong>{authChecked ? roleLabel(profile?.role) : "Checking..."}</strong>
          <small>{profile?.email || session?.user?.email || "Not signed in"}</small>
        </div>

        <div className="action-row">
          <button
            type="button"
            className="secondary-btn"
            onClick={handleReload}
            disabled={!session || loading || mappingLoading || supervisorLoading || profileLoading}
          >
            {loading || mappingLoading || supervisorLoading || profileLoading ? "Loading..." : "Reload"}
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

      {(pageError || pageSuccess || authMessage) && (
        <section className="message-stack">
          {pageError ? <div className="message error">{pageError}</div> : null}
          {authMessage ? <div className="message warning">{authMessage}</div> : null}
          {pageSuccess ? <div className="message success">{pageSuccess}</div> : null}
        </section>
      )}

      {!session?.user ? (
        <section className="panel gate-panel">
          <p className="eyebrow">Sign in required</p>
          <h2>Admin is ready, but you are not signed in.</h2>
          <p className="muted">Use your nextventures.io Google account to continue.</p>
          <button type="button" className="primary-btn" onClick={handleGoogleLogin}>
            Sign in with Google
          </button>
        </section>
      ) : !isAdmin ? (
        <section className="panel gate-panel">
          <p className="eyebrow">Admin access required</p>
          <h2>This section is restricted.</h2>
          <p className="muted">Please contact the Master Admin if you need Admin access.</p>
        </section>
      ) : (
        <>
          <section className={canManageApiKeysNow ? "control-grid" : "control-grid single-column"}>
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

            {canManageApiKeysNow ? (
              <article className="panel api-panel">
                <div className="section-head">
                  <div>
                    <p className="eyebrow">Creator Master Admin only</p>
                    <h2>API key vault</h2>
                    <p className="muted">
                      Save replacement keys securely. Full key values are never displayed after saving; only masked values are returned to this page.
                    </p>
                  </div>

                  <span className="status active">Protected</span>
                </div>

                <div className="api-card-grid">
                  {API_KEY_TYPES.map((type) => {
                    const keys = apiKeysByType.get(type.value) || [];
                    const activeKey = keys.find((item) => item.is_active);
                    const form = apiKeyForms[type.value] || createEmptyApiKeyForm();

                    return (
                      <div className="api-card secure" key={type.value}>
                        <div className="api-card-top">
                          <div>
                            <span>{type.label}</span>
                            <strong>{activeKey ? activeKey.masked_value : "No active key saved"}</strong>
                            <p>{type.description}</p>
                          </div>

                          <span className={activeKey ? "status active" : "status inactive"}>
                            {activeKey ? "Active" : "Missing"}
                          </span>
                        </div>

                        {activeKey ? (
                          <div className="api-meta-grid">
                            <div>
                              <b>Label</b>
                              <span>{activeKey.key_label || "Primary key"}</span>
                            </div>
                            <div>
                              <b>Updated</b>
                              <span>{formatDateTime(activeKey.updated_at)}</span>
                            </div>
                            <div>
                              <b>Fingerprint</b>
                              <span>{String(activeKey.fingerprint || "").slice(0, 12)}...</span>
                            </div>
                          </div>
                        ) : null}

                        <div className="api-key-form">
                          <label>
                            <span>Key label</span>
                            <input
                              value={form.key_label}
                              onChange={(event) =>
                                updateApiKeyForm(type.value, { key_label: event.target.value })
                              }
                              placeholder="Primary key"
                            />
                          </label>

                          <label>
                            <span>New API key</span>
                            <input
                              type="password"
                              value={form.secret_value}
                              onChange={(event) =>
                                updateApiKeyForm(type.value, { secret_value: event.target.value })
                              }
                              placeholder={type.placeholder}
                              autoComplete="off"
                            />
                          </label>

                          <label className="check-row api-active-check">
                            <input
                              type="checkbox"
                              checked={form.make_active !== false}
                              onChange={(event) =>
                                updateApiKeyForm(type.value, { make_active: event.target.checked })
                              }
                            />
                            <span>Make active immediately</span>
                          </label>

                          <button
                            type="button"
                            className="primary-btn"
                            onClick={() => handleSaveApiKey(type.value)}
                            disabled={apiKeySaveLoading === type.value || !normalizeText(form.secret_value)}
                          >
                            {apiKeySaveLoading === type.value ? "Saving..." : `Save ${type.label} key`}
                          </button>
                        </div>

                        <div className="api-key-list">
                          {apiKeyLoading ? (
                            <div className="empty-box">Loading saved keys...</div>
                          ) : keys.length === 0 ? (
                            <div className="empty-box">No saved {type.label} keys yet.</div>
                          ) : (
                            keys.map((keyRow) => (
                              <div className="key-record" key={keyRow.id}>
                                <div>
                                  <strong>{keyRow.key_label || "Primary key"}</strong>
                                  <span>{keyRow.masked_value}</span>
                                  <small>Updated {formatDateTime(keyRow.updated_at)}</small>
                                </div>

                                <div className="table-actions">
                                  <span className={keyRow.is_active ? "status active" : "status inactive"}>
                                    {keyRow.is_active ? "Active" : "Inactive"}
                                  </span>

                                  {!keyRow.is_active ? (
                                    <button
                                      type="button"
                                      className="secondary-btn small"
                                      disabled={apiKeyActionLoadingId === keyRow.id}
                                      onClick={() => handleActivateApiKey(keyRow)}
                                    >
                                      {apiKeyActionLoadingId === keyRow.id ? "Saving..." : "Activate"}
                                    </button>
                                  ) : null}

                                  <button
                                    type="button"
                                    className="secondary-btn small danger-soft"
                                    disabled={apiKeyActionLoadingId === keyRow.id}
                                    onClick={() => handleDeactivateApiKey(keyRow)}
                                  >
                                    {apiKeyActionLoadingId === keyRow.id ? "Saving..." : "Deactivate"}
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            ) : null}
          </section>

          <section className="control-grid supervisor-area" ref={supervisorFormRef}>
            <article className="panel supervisor-builder">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Supervisor teams</p>
                  <h2>{supervisorForm.id ? "Edit supervisor team" : "Create supervisor team"}</h2>
                  <p className="muted">
                    Add a supervisor, select mapped employees, and use this later as a Dashboard filter.
                  </p>
                </div>

                {supervisorForm.id ? (
                  <span className="status active">Editing</span>
                ) : (
                  <span className="status neutral">New</span>
                )}
              </div>

              <div className="form-grid single">
                <div className="form-grid two">
                  <label className="supervisor-name-field">
                    <span>Supervisor name</span>
                    <input
                      value={supervisorForm.supervisor_name}
                      onChange={(event) =>
                        setSupervisorForm((prev) => ({
                          ...prev,
                          supervisor_name: event.target.value,
                        }))
                      }
                      placeholder="Search existing employee or type a new supervisor"
                    />

                    {supervisorForm.supervisor_name.trim().length >= 2 ? (
                      <div className="supervisor-suggestion-list">
                        {filteredSupervisorCandidateOptions.length ? (
                          filteredSupervisorCandidateOptions.map((option) => (
                            <button
                              type="button"
                              key={getMemberKey(option)}
                              className="supervisor-suggestion"
                              onClick={() => handleUseSupervisorCandidate(option)}
                            >
                              <strong>{option.employee_name}</strong>
                              <span>
                                {option.employee_email || "No email"} • {option.team_name || "No team"}
                              </span>
                              <em>{option.intercom_agent_name || "No Intercom agent"}</em>
                            </button>
                          ))
                        ) : (
                          <div className="manual-supervisor-hint">
                            No existing employee matched. You can still save this as a new supervisor.
                          </div>
                        )}
                      </div>
                    ) : null}
                  </label>

                  <label>
                    <span>Supervisor email</span>
                    <input
                      type="email"
                      value={supervisorForm.supervisor_email}
                      onChange={(event) =>
                        setSupervisorForm((prev) => ({
                          ...prev,
                          supervisor_email: event.target.value,
                        }))
                      }
                      placeholder="supervisor@nextventures.io"
                    />
                  </label>
                </div>

                <label>
                  <span>Notes</span>
                  <textarea
                    className="textarea note"
                    value={supervisorForm.notes}
                    onChange={(event) =>
                      setSupervisorForm((prev) => ({
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
                    checked={supervisorForm.is_active}
                    onChange={(event) =>
                      setSupervisorForm((prev) => ({
                        ...prev,
                        is_active: event.target.checked,
                      }))
                    }
                  />
                  <span>Active supervisor team</span>
                </label>

                <div className="member-picker">
                  <div className="member-picker-head">
                    <div>
                      <p className="eyebrow">Team members</p>
                      <h3>{formatNumber(supervisorForm.members.length)} selected</h3>
                    </div>

                    <button
                      type="button"
                      className="secondary-btn small"
                      onClick={() => setSupervisorForm((prev) => ({ ...prev, members: [] }))}
                      disabled={!supervisorForm.members.length}
                    >
                      Clear members
                    </button>
                  </div>

                  <input
                    value={supervisorMemberSearch}
                    onChange={(event) => setSupervisorMemberSearch(event.target.value)}
                    placeholder="Search employee, email, Intercom name, or team"
                  />

                  {supervisorForm.members.length ? (
                    <div className="selected-member-chips">
                      {supervisorForm.members.map((member) => (
                        <button
                          type="button"
                          key={getMemberKey(member)}
                          className="selected-member-chip"
                          onClick={() => handleToggleSupervisorMember(member)}
                        >
                          {member.employee_name}
                          <span>Remove</span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <div className="member-option-list">
                    {supervisorLoading || mappingLoading ? (
                      <div className="empty-box">Loading employees...</div>
                    ) : filteredSupervisorEmployeeOptions.length === 0 ? (
                      <div className="empty-box">No employee options found. Add active agent mappings first.</div>
                    ) : (
                      filteredSupervisorEmployeeOptions.slice(0, 180).map((option) => {
                        const selected = isSupervisorMemberSelected(option);

                        return (
                          <button
                            type="button"
                            key={getMemberKey(option)}
                            className={selected ? "member-option selected" : "member-option"}
                            onClick={() => handleToggleSupervisorMember(option)}
                          >
                            <span className="member-check">{selected ? "✓" : "+"}</span>

                            <span className="member-copy">
                              <strong>{option.employee_name}</strong>
                              <small>{option.employee_email || "No email"} • {option.team_name || "No team"}</small>
                              <em>{option.intercom_agent_name || "No Intercom agent"}</em>
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="action-row">
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={handleSaveSupervisorTeam}
                    disabled={supervisorSaveLoading}
                  >
                    {supervisorSaveLoading
                      ? "Saving..."
                      : supervisorForm.id
                      ? "Update supervisor team"
                      : "Save supervisor team"}
                  </button>

                  <button type="button" className="secondary-btn" onClick={handleClearSupervisorForm}>
                    Clear
                  </button>
                </div>
              </div>
            </article>

            <article className="panel supervisor-list-panel">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Saved supervisor teams</p>
                  <h2>Team directory</h2>
                  <p className="muted">Edit supervisor groups and keep Dashboard filtering clean.</p>
                </div>
              </div>

              <div className="filter-grid compact">
                <label>
                  <span>Search supervisor teams</span>
                  <input
                    value={supervisorSearch}
                    onChange={(event) => setSupervisorSearch(event.target.value)}
                    placeholder="Search supervisor, email, member, or status"
                  />
                </label>
              </div>

              {supervisorLoading ? (
                <div className="empty-box">Loading Supervisor Teams...</div>
              ) : filteredSupervisorTeams.length === 0 ? (
                <div className="empty-box">No Supervisor Teams saved yet.</div>
              ) : (
                <div className="supervisor-card-list">
                  {filteredSupervisorTeams.map((team) => (
                    <article key={team.id} className={team.is_active === false ? "supervisor-card inactive" : "supervisor-card"}>
                      <div className="supervisor-card-head">
                        <div>
                          <h3>{team.supervisor_name}</h3>
                          <p>{team.supervisor_email || "No email saved"}</p>
                        </div>

                        <span className={team.is_active === false ? "status inactive" : "status active"}>
                          {team.is_active === false ? "Inactive" : "Active"}
                        </span>
                      </div>

                      {team.notes ? <p className="supervisor-note">{team.notes}</p> : null}

                      <div className="supervisor-member-preview">
                        {(team.members || []).slice(0, 10).map((member) => (
                          <span key={getMemberKey(member)}>{member.employee_name}</span>
                        ))}

                        {(team.members || []).length > 10 ? (
                          <span>+{formatNumber((team.members || []).length - 10)} more</span>
                        ) : null}

                        {(team.members || []).length === 0 ? <span>No members assigned</span> : null}
                      </div>

                      <div className="supervisor-card-foot">
                        <small>
                          {formatNumber((team.members || []).length)} member(s) • Updated {formatDateTime(team.updated_at)}
                        </small>

                        <div className="table-actions">
                          <button
                            type="button"
                            className="secondary-btn small"
                            onClick={() => handleEditSupervisorTeam(team)}
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            className="secondary-btn small"
                            disabled={supervisorToggleLoadingId === team.id}
                            onClick={() => handleToggleSupervisorTeamActive(team)}
                          >
                            {supervisorToggleLoadingId === team.id
                              ? "Saving..."
                              : team.is_active === false
                              ? "Activate"
                              : "Deactivate"}
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </article>
          </section>

          <section className="control-grid mapping-area">
            <article className="panel" ref={mappingFormRef}>
              <div className="section-head">
                <div>
                  <p className="eyebrow">Agent mapping</p>
                  <h2>{mappingForm.id ? "Edit mapping" : "Map agent"}</h2>
                  <p className="muted">Map raw Intercom names to employee identity, team, and email.</p>
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
                  Manage existing user profiles. New users need to sign in once before role assignment.
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
                  <label className="role-candidate-field">
                    <span>Search existing employee</span>
                    <input
                      value={roleCandidateSearch}
                      onChange={(event) => setRoleCandidateSearch(event.target.value)}
                      placeholder="Search mapped employee, email, Intercom name, or team"
                    />

                    {roleCandidateSearch.trim().length >= 2 ? (
                      <div className="role-candidate-list">
                        {filteredRoleCandidateOptions.length ? (
                          filteredRoleCandidateOptions.map((option) => (
                            <button
                              type="button"
                              key={getMemberKey(option)}
                              className="role-candidate-option"
                              onClick={() => handleUseRoleCandidate(option)}
                            >
                              <strong>{option.employee_name}</strong>
                              <span>{option.employee_email || "No email saved"} • {option.team_name || "No team"}</span>
                              <em>{option.intercom_agent_name || "No Intercom agent"}</em>
                            </button>
                          ))
                        ) : (
                          <div className="manual-supervisor-hint">
                            No mapped employee matched. You can still type a nextventures.io email manually below.
                          </div>
                        )}
                      </div>
                    ) : null}
                  </label>

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
                      <strong>{item?.prompt_type || "Prompt change"}</strong>
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
    grid-template-columns: minmax(0, 1.18fr) minmax(420px, 0.82fr);
    margin-bottom: 20px;
  }

  .control-grid.single-column {
    grid-template-columns: 1fr;
  }

  .stat-card,
  .panel,
  .mini-card,
  .history-card,
  .api-card,
  .role-form-card,
  .role-table-card,
  .profile-card,
  .member-picker,
  .supervisor-card {
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

  .message.warning {
    color: #fde68a;
    border: 1px solid rgba(245,158,11,0.23);
    background: rgba(245,158,11,0.08);
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

  .gate-panel {
    display: grid;
    gap: 12px;
  }

  .gate-panel .primary-btn {
    width: fit-content;
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

  .api-card.secure {
    display: grid;
    gap: 16px;
  }

  .api-card-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .api-meta-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .api-meta-grid div {
    padding: 12px;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(5,8,18,0.72);
  }

  .api-meta-grid b,
  .api-meta-grid span {
    display: block;
  }

  .api-meta-grid b {
    margin-bottom: 5px;
    color: #9fb2ee;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .api-meta-grid span {
    color: #dbe7ff;
    word-break: break-word;
  }

  .api-key-form {
    display: grid;
    gap: 12px;
    padding: 14px;
    border-radius: 18px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.025);
  }

  .api-active-check {
    width: fit-content;
  }

  .api-key-list {
    display: grid;
    gap: 10px;
  }

  .key-record {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 14px;
    align-items: center;
    padding: 13px;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(5,8,18,0.58);
  }

  .key-record strong,
  .key-record span,
  .key-record small {
    display: block;
  }

  .key-record strong {
    margin-bottom: 5px;
    color: #ffffff;
  }

  .key-record span {
    color: #dbe7ff;
    word-break: break-word;
  }

  .key-record small {
    margin-top: 5px;
    color: #8ea0d6;
  }

  .danger-soft {
    border-color: rgba(244,63,94,0.18);
    color: #fecdd3;
    background: rgba(244,63,94,0.08);
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

  .supervisor-name-field,
  .role-candidate-field {
    position: relative;
  }

  .supervisor-suggestion-list,
  .role-candidate-list {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + 8px);
    z-index: 20;
    display: grid;
    gap: 8px;
    max-height: 360px;
    overflow: auto;
    padding: 10px;
    border-radius: 18px;
    border: 1px solid rgba(96,165,250,0.22);
    background: rgba(5,8,18,0.98);
    box-shadow: 0 22px 50px rgba(0,0,0,0.55);
  }

  .supervisor-suggestion,
  .role-candidate-option {
    display: grid;
    gap: 3px;
    width: 100%;
    text-align: left;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 14px;
    padding: 12px;
    color: #e5ebff;
    background: rgba(255,255,255,0.035);
    cursor: pointer;
  }

  .supervisor-suggestion:hover,
  .role-candidate-option:hover {
    border-color: rgba(16,185,129,0.35);
    background: rgba(16,185,129,0.09);
  }

  .supervisor-suggestion strong,
  .supervisor-suggestion span,
  .supervisor-suggestion em,
  .role-candidate-option strong,
  .role-candidate-option span,
  .role-candidate-option em {
    display: block;
  }

  .supervisor-suggestion strong,
  .role-candidate-option strong {
    color: #ffffff;
  }

  .supervisor-suggestion span,
  .role-candidate-option span {
    color: #a9b4d0;
    font-size: 12px;
  }

  .supervisor-suggestion em,
  .role-candidate-option em {
    color: #8ea0d6;
    font-size: 12px;
    font-style: normal;
  }

  .manual-supervisor-hint {
    padding: 12px;
    color: #a9b4d0;
    border-radius: 14px;
    border: 1px dashed rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.03);
    line-height: 1.5;
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

  .member-picker {
    padding: 18px;
    border-radius: 22px;
    background:
      radial-gradient(circle at top left, rgba(59,130,246,0.12), transparent 32%),
      rgba(255,255,255,0.03);
  }

  .member-picker-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 14px;
  }

  .selected-member-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0;
  }

  .selected-member-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid rgba(16,185,129,0.24);
    background: rgba(16,185,129,0.08);
    color: #bbf7d0;
    border-radius: 999px;
    padding: 8px 10px;
    font-size: 12px;
    font-weight: 850;
    cursor: pointer;
  }

  .selected-member-chip span {
    color: #fca5a5;
    font-size: 11px;
  }

  .member-option-list {
    display: grid;
    gap: 9px;
    max-height: 420px;
    overflow: auto;
    margin-top: 12px;
    padding-right: 4px;
  }

  .member-option {
    width: 100%;
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 12px;
    align-items: center;
    text-align: left;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(5,8,18,0.72);
    color: #e5ebff;
    border-radius: 16px;
    padding: 12px;
    cursor: pointer;
  }

  .member-option.selected {
    border-color: rgba(16,185,129,0.34);
    background: rgba(16,185,129,0.09);
  }

  .member-check {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: 12px;
    background: rgba(255,255,255,0.06);
    color: #bfdbfe;
    font-weight: 900;
  }

  .member-option.selected .member-check {
    background: rgba(16,185,129,0.18);
    color: #bbf7d0;
  }

  .member-copy strong,
  .member-copy small,
  .member-copy em {
    display: block;
  }

  .member-copy strong {
    color: #fff;
    margin-bottom: 4px;
  }

  .member-copy small {
    color: #a9b4d0;
    line-height: 1.4;
  }

  .member-copy em {
    margin-top: 4px;
    color: #8ea0d6;
    font-size: 12px;
    font-style: normal;
  }

  .supervisor-card-list {
    display: grid;
    gap: 14px;
    max-height: 820px;
    overflow: auto;
    padding-right: 4px;
  }

  .supervisor-card {
    padding: 18px;
    border-radius: 22px;
    background:
      radial-gradient(circle at top right, rgba(139,92,246,0.11), transparent 34%),
      rgba(255,255,255,0.035);
  }

  .supervisor-card.inactive {
    opacity: 0.72;
  }

  .supervisor-card-head,
  .supervisor-card-foot {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 14px;
  }

  .supervisor-card-head p,
  .supervisor-note,
  .supervisor-card-foot small {
    color: #a9b4d0;
    line-height: 1.6;
  }

  .supervisor-card-head p {
    margin: 6px 0 0;
  }

  .supervisor-note {
    margin: 12px 0 0;
  }

  .supervisor-member-preview {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 14px 0;
  }

  .supervisor-member-preview span {
    padding: 7px 10px;
    border-radius: 999px;
    color: #dbe7ff;
    background: rgba(96,165,250,0.1);
    border: 1px solid rgba(96,165,250,0.18);
    font-size: 12px;
    font-weight: 800;
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
    .permission-grid,
    .api-meta-grid,
    .key-record {
      grid-template-columns: 1fr;
    }

    .section-head,
    .mini-head,
    .profile-card,
    .supervisor-card-head,
    .supervisor-card-foot,
    .member-picker-head {
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
