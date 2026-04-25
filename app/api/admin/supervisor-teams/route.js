import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const MASTER_ADMIN_EMAIL = "faiyaz@nextventures.io";

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
        "SUPABASE_SERVICE_ROLE_KEY is missing. Add it in Vercel Environment Variables so Supervisor Teams can run safely server-side.",
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

async function authenticateAdmin(request) {
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

  const { data: userData, error: userError } = await userClient.auth.getUser(token);

  if (userError || !userData?.user) {
    return {
      error: "Invalid or expired session. Please sign in again.",
      status: 401,
    };
  }

  const user = userData.user;
  const email = normalizeEmail(user.email);
  const domain = email.split("@")[1] || "";

  if (domain !== "nextventures.io") {
    return {
      error: "Only nextventures.io accounts can access Supervisor Teams.",
      status: 403,
    };
  }

  const fallbackProfile = buildFallbackProfile(user);

  const { data: profileData, error: profileError } = await adminClient
    .from("profiles")
    .select("id, email, full_name, role, can_run_tests, is_active")
    .or(`id.eq.${user.id},email.eq.${email}`)
    .maybeSingle();

  if (profileError && !fallbackProfile) {
    return {
      error: profileError.message || "Could not verify Admin profile.",
      status: 500,
    };
  }

  let profile = profileData || fallbackProfile;

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

    if (profileData?.id) {
      await adminClient
        .from("profiles")
        .update({
          role: "master_admin",
          can_run_tests: true,
          is_active: true,
        })
        .eq("id", profileData.id);
    }
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

    const key = normalizeKey(employeeEmail || employeeName);

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

async function getEmployeeOptions(adminClient) {
  const { data, error } = await adminClient
    .from("agent_mappings")
    .select("id, intercom_agent_name, employee_name, employee_email, team_name, is_active")
    .eq("is_active", true)
    .order("employee_name", { ascending: true })
    .limit(3000);

  if (error) {
    throw new Error(error.message || "Could not load employee options.");
  }

  const byEmployee = new Map();

  for (const row of Array.isArray(data) ? data : []) {
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

async function loadSupervisorTeams(adminClient) {
  const { data, error } = await adminClient
    .from("supervisor_teams")
    .select(
      `
      id,
      supervisor_name,
      supervisor_email,
      notes,
      is_active,
      created_at,
      updated_at,
      supervisor_team_members (
        id,
        supervisor_team_id,
        employee_name,
        employee_email,
        intercom_agent_name,
        team_name,
        is_active,
        created_at,
        updated_at
      )
    `
    )
    .order("supervisor_name", { ascending: true });

  if (error) {
    throw new Error(error.message || "Could not load Supervisor Teams.");
  }

  return (Array.isArray(data) ? data : []).map((team) => ({
    ...team,
    members: Array.isArray(team.supervisor_team_members)
      ? team.supervisor_team_members
          .filter((member) => member?.is_active !== false)
          .sort((a, b) =>
            String(a.employee_name || "").localeCompare(String(b.employee_name || ""))
          )
      : [],
    supervisor_team_members: undefined,
  }));
}

async function findExistingSupervisorTeam(adminClient, supervisorName, supervisorEmail) {
  const { data, error } = await adminClient
    .from("supervisor_teams")
    .select("id, supervisor_name, supervisor_email")
    .limit(2000);

  if (error) {
    throw new Error(error.message || "Could not check existing Supervisor Teams.");
  }

  const normalizedName = normalizeKey(supervisorName);
  const normalizedEmail = normalizeEmail(supervisorEmail);

  return (
    (Array.isArray(data) ? data : []).find((row) => {
      const rowName = normalizeKey(row?.supervisor_name);
      const rowEmail = normalizeEmail(row?.supervisor_email);

      if (normalizedEmail && rowEmail && normalizedEmail === rowEmail) return true;
      return normalizedName && rowName === normalizedName;
    }) || null
  );
}

export async function GET(request) {
  const auth = await authenticateAdmin(request);

  if (auth.error) {
    return jsonResponse({ ok: false, error: auth.error }, auth.status);
  }

  const { adminClient } = auth;

  try {
    const [teams, employeeOptions] = await Promise.all([
      loadSupervisorTeams(adminClient),
      getEmployeeOptions(adminClient),
    ]);

    return jsonResponse({
      ok: true,
      teams,
      employeeOptions,
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not load Supervisor Teams.",
      },
      500
    );
  }
}

export async function POST(request) {
  const auth = await authenticateAdmin(request);

  if (auth.error) {
    return jsonResponse({ ok: false, error: auth.error }, auth.status);
  }

  const { adminClient, profile } = auth;

  try {
    const body = await request.json();

    const teamValidation = validateTeamPayload(body);
    if (teamValidation.error) {
      return jsonResponse({ ok: false, error: teamValidation.error }, 400);
    }

    const memberValidation = validateMembersPayload(body);
    if (memberValidation.error) {
      return jsonResponse({ ok: false, error: memberValidation.error }, 400);
    }

    const teamPayload = teamValidation.value;
    const membersPayload = memberValidation.value;
    const now = new Date().toISOString();

    const existing = teamPayload.id
      ? { id: teamPayload.id }
      : await findExistingSupervisorTeam(
          adminClient,
          teamPayload.supervisor_name,
          teamPayload.supervisor_email
        );

    let savedTeam = null;

    if (existing?.id) {
      const { data, error } = await adminClient
        .from("supervisor_teams")
        .update({
          supervisor_name: teamPayload.supervisor_name,
          supervisor_email: teamPayload.supervisor_email,
          notes: teamPayload.notes,
          is_active: teamPayload.is_active,
          updated_at: now,
        })
        .eq("id", existing.id)
        .select("*")
        .single();

      if (error) {
        throw new Error(error.message || "Could not update Supervisor Team.");
      }

      savedTeam = data;
    } else {
      const { data, error } = await adminClient
        .from("supervisor_teams")
        .insert({
          supervisor_name: teamPayload.supervisor_name,
          supervisor_email: teamPayload.supervisor_email,
          notes: teamPayload.notes,
          is_active: teamPayload.is_active,
          created_at: now,
          updated_at: now,
        })
        .select("*")
        .single();

      if (error) {
        throw new Error(error.message || "Could not create Supervisor Team.");
      }

      savedTeam = data;
    }

    const teamId = savedTeam.id;

    const { error: deleteError } = await adminClient
      .from("supervisor_team_members")
      .delete()
      .eq("supervisor_team_id", teamId);

    if (deleteError) {
      throw new Error(deleteError.message || "Could not refresh Supervisor Team members.");
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

      const { error: insertMembersError } = await adminClient
        .from("supervisor_team_members")
        .insert(rowsToInsert);

      if (insertMembersError) {
        throw new Error(insertMembersError.message || "Could not save Supervisor Team members.");
      }
    }

    const teams = await loadSupervisorTeams(adminClient);
    const employeeOptions = await getEmployeeOptions(adminClient);

    return jsonResponse({
      ok: true,
      message: existing?.id
        ? "Supervisor Team updated successfully."
        : "Supervisor Team created successfully.",
      team: savedTeam,
      teams,
      employeeOptions,
      changedBy: profile?.email || null,
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not save Supervisor Team.",
      },
      500
    );
  }
}

export async function PATCH(request) {
  const auth = await authenticateAdmin(request);

  if (auth.error) {
    return jsonResponse({ ok: false, error: auth.error }, auth.status);
  }

  const { adminClient, profile } = auth;

  try {
    const body = await request.json();
    const id = normalizeText(body?.id);

    if (!id) {
      return jsonResponse({ ok: false, error: "Supervisor Team ID is required." }, 400);
    }

    const { data: currentTeam, error: currentError } = await adminClient
      .from("supervisor_teams")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (currentError) {
      throw new Error(currentError.message || "Could not read Supervisor Team.");
    }

    if (!currentTeam) {
      return jsonResponse({ ok: false, error: "Supervisor Team not found." }, 404);
    }

    const nextActive =
      typeof body?.is_active === "boolean" ? body.is_active : currentTeam.is_active === false;

    const { data, error } = await adminClient
      .from("supervisor_teams")
      .update({
        is_active: nextActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message || "Could not update Supervisor Team status.");
    }

    const teams = await loadSupervisorTeams(adminClient);
    const employeeOptions = await getEmployeeOptions(adminClient);

    return jsonResponse({
      ok: true,
      message: nextActive
        ? "Supervisor Team activated."
        : "Supervisor Team deactivated.",
      team: data,
      teams,
      employeeOptions,
      changedBy: profile?.email || null,
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not update Supervisor Team status.",
      },
      500
    );
  }
}
