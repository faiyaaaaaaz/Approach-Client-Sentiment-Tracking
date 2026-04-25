import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const MASTER_ADMIN_EMAIL = "faiyaz@nextventures.io";
const STEP_TIMEOUT_MS = 9000;
const LOAD_TIMEOUT_MS = 12000;

function jsonResponse(payload, status = 200) {
  return NextResponse.json(payload, { status });
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

function getErrorMessage(error, fallback = "Unexpected server error.") {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

function getStatusForError(error) {
  if (error?.name === "TimeoutError") return 504;
  return 500;
}

function withTimeout(promise, timeoutMs, label) {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
      error.name = "TimeoutError";
      error.stage = label;
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

async function runStep(stages, label, callback, timeoutMs = STEP_TIMEOUT_MS) {
  const startedAt = Date.now();
  const index = stages.length;

  stages.push({
    stage: label,
    status: "started",
    startedAt,
  });

  try {
    const result = await withTimeout(Promise.resolve().then(callback), timeoutMs, label);

    stages[index] = {
      stage: label,
      status: "done",
      elapsedMs: Date.now() - startedAt,
    };

    return result;
  } catch (error) {
    stages[index] = {
      stage: label,
      status: "failed",
      elapsedMs: Date.now() - startedAt,
      error: getErrorMessage(error),
    };

    error.stage = error.stage || label;
    throw error;
  }
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey) {
    return {
      error:
        "Supabase environment variables are missing. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    };
  }

  if (!serviceRoleKey) {
    return {
      error:
        "SUPABASE_SERVICE_ROLE_KEY is missing in Vercel Environment Variables. Add it and redeploy.",
    };
  }

  return {
    supabaseUrl,
    anonKey,
    serviceRoleKey,
  };
}

function createUserClient(token, config) {
  return createClient(config.supabaseUrl, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}

function createServiceClient(config) {
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getBearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const [type, token] = header.split(" ");

  if (type?.toLowerCase() !== "bearer" || !token) {
    return "";
  }

  return token;
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
  const role = normalizeText(profile?.role).toLowerCase();

  return Boolean(
    profile?.is_active === true &&
      (role === "master_admin" || role === "admin" || role === "co_admin")
  );
}

async function authenticateAdmin(request, stages) {
  const config = getSupabaseConfig();

  if (config.error) {
    return {
      error: config.error,
      status: 500,
    };
  }

  const token = getBearerToken(request);

  if (!token) {
    return {
      error: "Missing login session. Please sign in again.",
      status: 401,
    };
  }

  const userClient = createUserClient(token, config);
  const adminClient = createServiceClient(config);

  const userResult = await runStep(
    stages,
    "Verify login session",
    () => userClient.auth.getUser(token),
    STEP_TIMEOUT_MS
  );

  const user = userResult?.data?.user;

  if (userResult?.error || !user) {
    return {
      error: "Invalid or expired session. Please sign in again.",
      status: 401,
    };
  }

  const email = normalizeEmail(user.email);
  const domain = email.split("@")[1] || "";

  if (domain !== "nextventures.io") {
    return {
      error: "Only nextventures.io accounts can access Supervisor Teams.",
      status: 403,
    };
  }

  const fallbackProfile = buildFallbackProfile(user);

  const profileResult = await runStep(
    stages,
    "Load Admin profile",
    () =>
      adminClient
        .from("profiles")
        .select("id, email, full_name, role, can_run_tests, is_active")
        .or(`id.eq.${user.id},email.eq.${email}`)
        .maybeSingle(),
    STEP_TIMEOUT_MS
  );

  if (profileResult?.error && !fallbackProfile) {
    return {
      error: profileResult.error.message || "Could not verify Admin profile.",
      status: 500,
    };
  }

  let profile = profileResult?.data || fallbackProfile;

  if (!profile) {
    return {
      error: "No profile found for this account. Please contact the Master Admin.",
      status: 403,
    };
  }

  if (email === MASTER_ADMIN_EMAIL) {
    profile = {
      ...profile,
      email,
      role: "master_admin",
      can_run_tests: true,
      is_active: true,
    };
  }

  if (!canManageAdmin(profile)) {
    return {
      error: "Only Master Admins and Co-Admins can manage Supervisor Teams.",
      status: 403,
    };
  }

  return {
    adminClient,
    profile,
    user,
  };
}

function validateTeamPayload(rawBody) {
  const team = rawBody?.team && typeof rawBody.team === "object" ? rawBody.team : rawBody;

  const id = normalizeText(team?.id);
  const supervisorName = normalizeText(team?.supervisor_name);
  const supervisorEmail = normalizeEmail(team?.supervisor_email);
  const notes = normalizeText(team?.notes);
  const isActive = team?.is_active !== false;

  if (!supervisorName) {
    return {
      error: "Supervisor name is required.",
    };
  }

  if (supervisorEmail && !supervisorEmail.endsWith("@nextventures.io")) {
    return {
      error: "Supervisor email must use the nextventures.io domain.",
    };
  }

  return {
    value: {
      id,
      supervisor_name: supervisorName,
      supervisor_email: supervisorEmail || null,
      notes: notes || null,
      is_active: isActive,
    },
  };
}

function validateMembersPayload(rawBody) {
  const rawMembers = Array.isArray(rawBody?.members) ? rawBody.members : [];
  const uniqueMembers = new Map();

  for (const member of rawMembers) {
    const employeeName = normalizeText(member?.employee_name);
    const employeeEmail = normalizeEmail(member?.employee_email);
    const intercomAgentName = normalizeText(member?.intercom_agent_name);
    const teamName = normalizeText(member?.team_name);

    if (!employeeName) continue;

    if (employeeEmail && !employeeEmail.endsWith("@nextventures.io")) {
      return {
        error: `Employee email for ${employeeName} must use the nextventures.io domain.`,
      };
    }

    const key = normalizeKey(employeeName);

    if (!uniqueMembers.has(key)) {
      uniqueMembers.set(key, {
        employee_name: employeeName,
        employee_email: employeeEmail || null,
        intercom_agent_name: intercomAgentName || null,
        team_name: teamName || null,
        is_active: member?.is_active !== false,
      });
    }
  }

  return {
    value: Array.from(uniqueMembers.values()),
  };
}

async function getEmployeeOptions(adminClient, stages) {
  const result = await runStep(
    stages,
    "Load employee options from agent mappings",
    () =>
      adminClient
        .from("agent_mappings")
        .select("id, intercom_agent_name, employee_name, employee_email, team_name, is_active")
        .eq("is_active", true)
        .order("employee_name", { ascending: true })
        .limit(5000),
    LOAD_TIMEOUT_MS
  );

  if (result?.error) {
    throw new Error(result.error.message || "Could not load employee options.");
  }

  const byEmployee = new Map();

  for (const row of Array.isArray(result?.data) ? result.data : []) {
    const employeeName = normalizeText(row.employee_name);
    if (!employeeName) continue;

    const key = normalizeKey(row.employee_email || employeeName);

    if (!byEmployee.has(key)) {
      byEmployee.set(key, {
        employee_name: employeeName,
        employee_email: row.employee_email || null,
        intercom_agent_name: row.intercom_agent_name || null,
        team_name: row.team_name || null,
      });
    }
  }

  return Array.from(byEmployee.values()).sort((a, b) =>
    a.employee_name.localeCompare(b.employee_name)
  );
}

async function loadSupervisorTeams(adminClient, stages) {
  const teamsResult = await runStep(
    stages,
    "Load supervisor teams",
    () =>
      adminClient
        .from("supervisor_teams")
        .select("id, supervisor_name, supervisor_email, notes, is_active, created_at, updated_at")
        .order("supervisor_name", { ascending: true })
        .limit(1000),
    LOAD_TIMEOUT_MS
  );

  if (teamsResult?.error) {
    throw new Error(teamsResult.error.message || "Could not load Supervisor Teams.");
  }

  const teams = Array.isArray(teamsResult?.data) ? teamsResult.data : [];
  const teamIds = teams.map((team) => team.id).filter(Boolean);

  let members = [];

  if (teamIds.length > 0) {
    const membersResult = await runStep(
      stages,
      "Load supervisor team members",
      () =>
        adminClient
          .from("supervisor_team_members")
          .select(
            "id, supervisor_team_id, employee_name, employee_email, intercom_agent_name, team_name, is_active, created_at, updated_at"
          )
          .in("supervisor_team_id", teamIds)
          .order("employee_name", { ascending: true })
          .limit(10000),
      LOAD_TIMEOUT_MS
    );

    if (membersResult?.error) {
      throw new Error(membersResult.error.message || "Could not load Supervisor Team members.");
    }

    members = Array.isArray(membersResult?.data) ? membersResult.data : [];
  }

  const membersByTeam = new Map();

  for (const member of members) {
    if (member?.is_active === false) continue;

    const teamId = member.supervisor_team_id;
    const existing = membersByTeam.get(teamId) || [];

    existing.push(member);
    membersByTeam.set(teamId, existing);
  }

  return teams.map((team) => ({
    ...team,
    members: membersByTeam.get(team.id) || [],
  }));
}

async function findExistingSupervisorTeam(adminClient, stages, supervisorName, supervisorEmail) {
  if (supervisorEmail) {
    const emailResult = await runStep(
      stages,
      "Check existing Supervisor Team by email",
      () =>
        adminClient
          .from("supervisor_teams")
          .select("id, supervisor_name, supervisor_email")
          .eq("supervisor_email", supervisorEmail)
          .maybeSingle(),
      STEP_TIMEOUT_MS
    );

    if (emailResult?.error) {
      throw new Error(emailResult.error.message || "Could not check Supervisor Team email.");
    }

    if (emailResult?.data) return emailResult.data;
  }

  const teamsResult = await runStep(
    stages,
    "Check existing Supervisor Team by name",
    () =>
      adminClient
        .from("supervisor_teams")
        .select("id, supervisor_name, supervisor_email")
        .limit(2000),
    STEP_TIMEOUT_MS
  );

  if (teamsResult?.error) {
    throw new Error(teamsResult.error.message || "Could not check existing Supervisor Teams.");
  }

  const normalizedName = normalizeKey(supervisorName);

  return (
    (Array.isArray(teamsResult?.data) ? teamsResult.data : []).find(
      (row) => normalizeKey(row?.supervisor_name) === normalizedName
    ) || null
  );
}

async function loadFullPayload(adminClient, stages) {
  const teams = await loadSupervisorTeams(adminClient, stages);
  const employeeOptions = await getEmployeeOptions(adminClient, stages);

  return {
    teams,
    employeeOptions,
    supervisorOptions: employeeOptions,
  };
}

export async function GET(request) {
  const stages = [];

  try {
    const auth = await authenticateAdmin(request, stages);

    if (auth.error) {
      return jsonResponse({ ok: false, error: auth.error, stages }, auth.status);
    }

    const payload = await loadFullPayload(auth.adminClient, stages);

    return jsonResponse({
      ok: true,
      ...payload,
      stages,
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: getErrorMessage(error, "Could not load Supervisor Teams."),
        failedStage: error?.stage || null,
        stages,
      },
      getStatusForError(error)
    );
  }
}

export async function POST(request) {
  const stages = [];

  try {
    const auth = await authenticateAdmin(request, stages);

    if (auth.error) {
      return jsonResponse({ ok: false, error: auth.error, stages }, auth.status);
    }

    const { adminClient, profile } = auth;

    const body = await runStep(
      stages,
      "Read request body",
      () => request.json(),
      STEP_TIMEOUT_MS
    );

    const teamValidation = validateTeamPayload(body);

    if (teamValidation.error) {
      return jsonResponse({ ok: false, error: teamValidation.error, stages }, 400);
    }

    const memberValidation = validateMembersPayload(body);

    if (memberValidation.error) {
      return jsonResponse({ ok: false, error: memberValidation.error, stages }, 400);
    }

    const teamPayload = teamValidation.value;
    const membersPayload = memberValidation.value;
    const now = new Date().toISOString();

    const existing = teamPayload.id
      ? { id: teamPayload.id }
      : await findExistingSupervisorTeam(
          adminClient,
          stages,
          teamPayload.supervisor_name,
          teamPayload.supervisor_email
        );

    let savedTeam = null;

    if (existing?.id) {
      const updateResult = await runStep(
        stages,
        "Update Supervisor Team",
        () =>
          adminClient
            .from("supervisor_teams")
            .update({
              supervisor_name: teamPayload.supervisor_name,
              supervisor_email: teamPayload.supervisor_email,
              notes: teamPayload.notes,
              is_active: teamPayload.is_active,
              updated_at: now,
            })
            .eq("id", existing.id)
            .select("id, supervisor_name, supervisor_email, notes, is_active, created_at, updated_at")
            .single(),
        STEP_TIMEOUT_MS
      );

      if (updateResult?.error) {
        throw new Error(updateResult.error.message || "Could not update Supervisor Team.");
      }

      savedTeam = updateResult.data;
    } else {
      const insertResult = await runStep(
        stages,
        "Insert Supervisor Team",
        () =>
          adminClient
            .from("supervisor_teams")
            .insert({
              supervisor_name: teamPayload.supervisor_name,
              supervisor_email: teamPayload.supervisor_email,
              notes: teamPayload.notes,
              is_active: teamPayload.is_active,
              created_at: now,
              updated_at: now,
            })
            .select("id, supervisor_name, supervisor_email, notes, is_active, created_at, updated_at")
            .single(),
        STEP_TIMEOUT_MS
      );

      if (insertResult?.error) {
        throw new Error(insertResult.error.message || "Could not create Supervisor Team.");
      }

      savedTeam = insertResult.data;
    }

    const teamId = savedTeam.id;

    const deleteMembersResult = await runStep(
      stages,
      "Clear old Supervisor Team members",
      () =>
        adminClient
          .from("supervisor_team_members")
          .delete()
          .eq("supervisor_team_id", teamId),
      STEP_TIMEOUT_MS
    );

    if (deleteMembersResult?.error) {
      throw new Error(
        deleteMembersResult.error.message || "Could not refresh Supervisor Team members."
      );
    }

    if (membersPayload.length > 0) {
      const rowsToInsert = membersPayload.map((member) => ({
        supervisor_team_id: teamId,
        employee_name: member.employee_name,
        employee_email: member.employee_email,
        intercom_agent_name: member.intercom_agent_name,
        team_name: member.team_name,
        is_active: member.is_active,
        created_at: now,
        updated_at: now,
      }));

      const insertMembersResult = await runStep(
        stages,
        "Insert Supervisor Team members",
        () => adminClient.from("supervisor_team_members").insert(rowsToInsert),
        STEP_TIMEOUT_MS
      );

      if (insertMembersResult?.error) {
        throw new Error(
          insertMembersResult.error.message || "Could not save Supervisor Team members."
        );
      }
    }

    const payload = await loadFullPayload(adminClient, stages);

    return jsonResponse({
      ok: true,
      message: existing?.id
        ? "Supervisor Team updated successfully."
        : "Supervisor Team created successfully.",
      team: savedTeam,
      ...payload,
      changedBy: profile?.email || null,
      stages,
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: getErrorMessage(error, "Could not save Supervisor Team."),
        failedStage: error?.stage || null,
        stages,
      },
      getStatusForError(error)
    );
  }
}

export async function PATCH(request) {
  const stages = [];

  try {
    const auth = await authenticateAdmin(request, stages);

    if (auth.error) {
      return jsonResponse({ ok: false, error: auth.error, stages }, auth.status);
    }

    const { adminClient, profile } = auth;

    const body = await runStep(
      stages,
      "Read request body",
      () => request.json(),
      STEP_TIMEOUT_MS
    );

    const id = normalizeText(body?.id);

    if (!id) {
      return jsonResponse({ ok: false, error: "Supervisor Team ID is required.", stages }, 400);
    }

    const currentResult = await runStep(
      stages,
      "Read Supervisor Team status",
      () =>
        adminClient
          .from("supervisor_teams")
          .select("id, is_active")
          .eq("id", id)
          .maybeSingle(),
      STEP_TIMEOUT_MS
    );

    if (currentResult?.error) {
      throw new Error(currentResult.error.message || "Could not read Supervisor Team.");
    }

    if (!currentResult?.data) {
      return jsonResponse({ ok: false, error: "Supervisor Team not found.", stages }, 404);
    }

    const nextActive =
      typeof body?.is_active === "boolean" ? body.is_active : currentResult.data.is_active === false;

    const updateResult = await runStep(
      stages,
      "Update Supervisor Team status",
      () =>
        adminClient
          .from("supervisor_teams")
          .update({
            is_active: nextActive,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .select("id, supervisor_name, supervisor_email, notes, is_active, created_at, updated_at")
          .single(),
      STEP_TIMEOUT_MS
    );

    if (updateResult?.error) {
      throw new Error(updateResult.error.message || "Could not update Supervisor Team status.");
    }

    const payload = await loadFullPayload(adminClient, stages);

    return jsonResponse({
      ok: true,
      message: nextActive ? "Supervisor Team activated." : "Supervisor Team deactivated.",
      team: updateResult.data,
      ...payload,
      changedBy: profile?.email || null,
      stages,
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: getErrorMessage(error, "Could not update Supervisor Team status."),
        failedStage: error?.stage || null,
        stages,
      },
      getStatusForError(error)
    );
  }
}
