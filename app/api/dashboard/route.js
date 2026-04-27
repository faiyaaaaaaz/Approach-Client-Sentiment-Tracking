import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MASTER_ADMIN_EMAIL = "faiyaz@nextventures.io";
const PAGE_SIZE = 1000;
const MAX_DASHBOARD_ROWS = 50000;

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      ...(init.headers || {}),
    },
  });
}

function getEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
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
      full_name:
        normalizeText(user.user_metadata?.full_name) ||
        normalizeText(user.user_metadata?.name) ||
        email,
      role: "viewer",
      can_run_tests: false,
      is_active: true,
    };
  }

  return null;
}

function canReadDashboard(profile) {
  return profile?.is_active === true;
}

function isSupervisorScoped(profile, email) {
  return false;
}

function createClients() {
  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new Error("Missing required Supabase environment variables.");
  }

  return {
    authClient: createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    adminClient: createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

async function authenticate(request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!token) {
    return {
      ok: false,
      response: json({ ok: false, error: "Missing access token." }, { status: 401 }),
    };
  }

  const { authClient, adminClient } = createClients();

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser(token);

  if (userError || !user) {
    return {
      ok: false,
      response: json({ ok: false, error: "Invalid or expired session." }, { status: 401 }),
    };
  }

  const email = normalizeEmail(user.email);

  if (!email.endsWith("@nextventures.io")) {
    return {
      ok: false,
      response: json({ ok: false, error: "Only nextventures.io accounts are allowed." }, { status: 403 }),
    };
  }

  const { data: profileById, error: idError } = await adminClient
    .from("profiles")
    .select("id, email, full_name, role, can_run_tests, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (idError) {
    throw new Error(idError.message || "Could not load profile.");
  }

  let profile = profileById || null;

  if (!profile) {
    const { data: profileByEmail, error: emailError } = await adminClient
      .from("profiles")
      .select("id, email, full_name, role, can_run_tests, is_active")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    if (emailError) {
      throw new Error(emailError.message || "Could not load profile by email.");
    }

    profile = profileByEmail || null;
  }

  profile = profile || buildFallbackProfile(user);

  if (email === MASTER_ADMIN_EMAIL) {
    profile = {
      ...(profile || {}),
      id: user.id,
      email,
      full_name: profile?.full_name || "Faiyaz Muhtasim Ahmed",
      role: "master_admin",
      can_run_tests: true,
      is_active: true,
    };
  }

  if (!canReadDashboard(profile)) {
    return {
      ok: false,
      response: json(
        { ok: false, error: "This account does not have permission to view the Dashboard." },
        { status: 403 }
      ),
    };
  }

  return { ok: true, user, email, profile, adminClient };
}

async function loadSupervisorTeams(adminClient, { scopedProfile = null, scopedEmail = "" } = {}) {
  const { data: teamsData, error: teamsError } = await adminClient
    .from("supervisor_teams")
    .select("id, supervisor_name, supervisor_email, notes, is_active, created_at, updated_at")
    .eq("is_active", true)
    .order("supervisor_name", { ascending: true })
    .limit(1000);

  if (teamsError) {
    throw new Error(teamsError.message || "Could not load Supervisor Teams.");
  }

  const shouldScope = Boolean(scopedProfile && scopedEmail);
  const scopedEmailKey = normalizeEmail(scopedEmail);
  const scopedNameKey = normalizeKey(scopedProfile?.full_name);
  const allTeams = Array.isArray(teamsData) ? teamsData : [];
  const teams = shouldScope
    ? allTeams.filter((team) => {
        const teamEmailKey = normalizeEmail(team?.supervisor_email);
        const teamNameKey = normalizeKey(team?.supervisor_name);

        return Boolean(
          (scopedEmailKey && teamEmailKey === scopedEmailKey) ||
            (scopedNameKey && teamNameKey === scopedNameKey)
        );
      })
    : allTeams;

  const teamIds = teams.map((team) => team.id).filter(Boolean);

  if (!teamIds.length) return [];

  const { data: membersData, error: membersError } = await adminClient
    .from("supervisor_team_members")
    .select("id, supervisor_team_id, employee_name, employee_email, intercom_agent_name, team_name, is_active, created_at, updated_at")
    .in("supervisor_team_id", teamIds)
    .eq("is_active", true)
    .order("employee_name", { ascending: true })
    .limit(10000);

  if (membersError) {
    throw new Error(membersError.message || "Could not load Supervisor Team members.");
  }

  const membersByTeam = new Map();

  for (const member of Array.isArray(membersData) ? membersData : []) {
    const list = membersByTeam.get(member.supervisor_team_id) || [];
    list.push(member);
    membersByTeam.set(member.supervisor_team_id, list);
  }

  return teams.map((team) => ({
    ...team,
    members: membersByTeam.get(team.id) || [],
  }));
}

async function fetchAllDashboardRows(adminClient) {
  const allRows = [];
  let from = 0;

  while (from < MAX_DASHBOARD_ROWS) {
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await adminClient
      .from("audit_results")
      .select(`
        id,
        run_id,
        conversation_id,
        replied_at,
        csat_score,
        client_email,
        agent_name,
        employee_name,
        employee_email,
        team_name,
        employee_match_status,
        ai_verdict,
        review_sentiment,
        client_sentiment,
        resolution_status,
        error,
        created_at
      `)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(error.message || "Could not load dashboard data.");
    }

    const rows = Array.isArray(data) ? data : [];
    allRows.push(...rows);

    if (rows.length < PAGE_SIZE) break;

    from += PAGE_SIZE;
  }

  return allRows;
}

function buildSupervisorScope(teams) {
  const employeeEmails = new Set();
  const employeeNames = new Set();
  const intercomNames = new Set();

  for (const team of teams || []) {
    for (const member of team?.members || []) {
      const email = normalizeEmail(member?.employee_email);
      const name = normalizeKey(member?.employee_name);
      const intercom = normalizeKey(member?.intercom_agent_name);

      if (email) employeeEmails.add(email);
      if (name) employeeNames.add(name);
      if (intercom) intercomNames.add(intercom);
    }
  }

  return { employeeEmails, employeeNames, intercomNames };
}

function rowMatchesSupervisorScope(row, scope) {
  const employeeEmail = normalizeEmail(row?.employee_email);
  const employeeName = normalizeKey(row?.employee_name);
  const agentName = normalizeKey(row?.agent_name);

  return Boolean(
    (employeeEmail && scope.employeeEmails.has(employeeEmail)) ||
      (employeeName && scope.employeeNames.has(employeeName)) ||
      (agentName && scope.intercomNames.has(agentName))
  );
}

function applySupervisorScope(rows, teams) {
  const scope = buildSupervisorScope(teams);
  const hasScope = scope.employeeEmails.size || scope.employeeNames.size || scope.intercomNames.size;

  if (!hasScope) return [];

  return (rows || []).filter((row) => rowMatchesSupervisorScope(row, scope));
}

export async function GET(request) {
  try {
    const auth = await authenticate(request);
    if (!auth.ok) return auth.response;

    const { adminClient, email, profile } = auth;

    const [supervisorTeams, rows] = await Promise.all([
      loadSupervisorTeams(adminClient),
      fetchAllDashboardRows(adminClient),
    ]);

    return json({
      ok: true,
      rows,
      supervisorTeams,
      meta: {
        requestedBy: email,
        role: profile?.role || "viewer",
        scopedToSupervisorTeams: false,
        supervisorTeamCount: supervisorTeams.length,
        rowsReturned: rows.length,
        rowCap: MAX_DASHBOARD_ROWS,
        visibility: "all_results",
      },
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown dashboard server error.",
      },
      { status: 500 }
    );
  }
}
