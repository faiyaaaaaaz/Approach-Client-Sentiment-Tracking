import { authenticateServerRequest, normalizeServerEmail } from "../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data, init = {}) {
  return Response.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init.headers || {}) } });
}

function toDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function latest(current, candidate) {
  const a = toDate(current);
  const b = toDate(candidate);
  return b && (!a || b > a) ? b.toISOString() : current || null;
}

function companyIdentityKey(value) {
  const email = normalizeServerEmail(value);
  const [localPart, domain] = email.split("@");
  return localPart && (domain === "nextventures.io" || domain === "wearenext.io")
    ? localPart
    : email;
}

function normalizedIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function dhakaWeekStart() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
    .formatToParts(new Date()).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const base = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00+06:00`);
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const daysFromMonday = (dayIndex + 6) % 7;
  base.setUTCDate(base.getUTCDate() - daysFromMonday);
  return base;
}

export async function GET(request) {
  try {
    const auth = await authenticateServerRequest(request);
    if (!auth.ok) return json({ ok: false, error: auth.error }, { status: auth.status });

    const [mappingResult, teamResult, memberResult] = await Promise.all([
      auth.adminClient.from("agent_mappings").select("employee_name,employee_email,intercom_agent_name,team_name,is_active").eq("is_active", true).order("employee_name", { ascending: true }).limit(5000),
      auth.adminClient.from("supervisor_teams").select("id,supervisor_name,is_active,updated_at").eq("is_active", true).order("supervisor_name", { ascending: true }).limit(1000),
      auth.adminClient.from("supervisor_team_members").select("supervisor_team_id,employee_name,employee_email,intercom_agent_name,is_active").eq("is_active", true).limit(10000),
    ]);
    const mappingError = mappingResult.error || teamResult.error || memberResult.error;
    if (mappingError) throw new Error(mappingError.message || "Could not load the engagement roster.");
    const mappings = mappingResult.data;
    const activeSupervisorTeams = (teamResult.data || []).map((team) => ({
      id: team.id,
      name: team.supervisor_name || "Unnamed supervisor team",
      updated_at: team.updated_at || null,
    }));
    const teamNamesById = new Map(activeSupervisorTeams.map((team) => [String(team.id), team.name]));
    const supervisorTeamsByIdentity = new Map();
    const addTeamForIdentity = (identity, teamName) => {
      if (!identity || !teamName) return;
      const names = supervisorTeamsByIdentity.get(identity) || [];
      if (!names.includes(teamName)) names.push(teamName);
      supervisorTeamsByIdentity.set(identity, names);
    };
    for (const member of memberResult.data || []) {
      const email = normalizeServerEmail(member.employee_email);
      const employeeName = normalizedIdentity(member.employee_name);
      const intercomName = normalizedIdentity(member.intercom_agent_name);
      const teamName = teamNamesById.get(String(member.supervisor_team_id));
      if (!teamName) continue;
      if (email) addTeamForIdentity(`email:${email}`, teamName);
      if (email) addTeamForIdentity(`company:${companyIdentityKey(email)}`, teamName);
      if (employeeName) addTeamForIdentity(`name:${employeeName}`, teamName);
      if (intercomName) addTeamForIdentity(`intercom:${intercomName}`, teamName);
    }

    const findSupervisorTeamNames = (row) => {
      const email = normalizeServerEmail(row?.employee_email);
      const employeeName = normalizedIdentity(row?.employee_name);
      const intercomName = normalizedIdentity(row?.intercom_agent_name);
      const identities = [
        email ? `email:${email}` : "",
        email ? `company:${companyIdentityKey(email)}` : "",
        employeeName ? `name:${employeeName}` : "",
        intercomName ? `intercom:${intercomName}` : "",
      ].filter(Boolean);
      return Array.from(new Set(identities.flatMap((identity) => supervisorTeamsByIdentity.get(identity) || [])));
    };

    let roster = (Array.isArray(mappings) ? mappings : [])
      .map((row) => {
        const employeeEmail = normalizeServerEmail(row.employee_email);
        return { ...row, employee_email: employeeEmail, supervisor_team_names: findSupervisorTeamNames({ ...row, employee_email: employeeEmail }) };
      })
      .filter((row) => row.employee_email);
    if (!auth.canViewAllEngagement) roster = roster.filter((row) => row.employee_email === auth.email);
    if (!roster.some((row) => row.employee_email === auth.email) && !auth.canViewAllEngagement) {
      const ownAgent = { employee_name: auth.profile.full_name || auth.email, employee_email: auth.email, intercom_agent_name: "", team_name: "" };
      roster.push({ ...ownAgent, supervisor_team_names: findSupervisorTeamNames(ownAgent) });
    }

    const emails = Array.from(new Set(roster.map((row) => row.employee_email)));
    if (!emails.length) return json({ ok: true, scope: auth.canViewAllEngagement ? "all_agents" : "own", rows: [], supervisorTeams: activeSupervisorTeams, summary: {} });

    const [sessionsResult, viewsResult, resultsResult, statesResult] = await Promise.all([
      auth.adminClient.from("user_activity_sessions").select("email,started_at,last_seen_at").in("email", emails).order("last_seen_at", { ascending: false }).limit(20000),
      auth.adminClient.from("system_activity_logs").select("actor_email,target_id,created_at").in("actor_email", emails).eq("action_type", "page_viewed").in("target_id", ["/", "/results"]).order("created_at", { ascending: false }).limit(20000),
      auth.adminClient.from("audit_results").select("id,conversation_id,employee_email,review_sentiment,created_at,replied_at,error").in("employee_email", emails).order("created_at", { ascending: false }).limit(50000),
      auth.adminClient.from("result_engagement_state").select("actor_email,result_id,first_opened_at,last_opened_at,conversation_opened_at,open_count,is_missed_approach").in("actor_email", emails).order("last_opened_at", { ascending: false }).limit(50000),
    ]);
    const firstError = sessionsResult.error || viewsResult.error || resultsResult.error || statesResult.error;
    if (firstError) throw new Error(firstError.message || "Could not load engagement data.");

    const sessions = Array.isArray(sessionsResult.data) ? sessionsResult.data : [];
    const views = Array.isArray(viewsResult.data) ? viewsResult.data : [];
    const results = (Array.isArray(resultsResult.data) ? resultsResult.data : []).filter((row) => !row.error);
    const states = Array.isArray(statesResult.data) ? statesResult.data : [];
    const weekStart = dhakaWeekStart();
    const now = new Date();

    const rows = roster.map((agent) => {
      const email = agent.employee_email;
      const agentSessions = sessions.filter((row) => normalizeServerEmail(row.email) === email);
      const agentViews = views.filter((row) => normalizeServerEmail(row.actor_email) === email);
      const agentResults = results.filter((row) => normalizeServerEmail(row.employee_email) === email);
      const stateByResult = new Map(states.filter((row) => normalizeServerEmail(row.actor_email) === email).map((row) => [String(row.result_id), row]));
      const weeklyResults = agentResults.filter((row) => (toDate(row.created_at) || toDate(row.replied_at)) >= weekStart);
      const weeklyMisses = weeklyResults.filter((row) => String(row.review_sentiment || "").toLowerCase() === "missed opportunity");
      const openedWeekly = weeklyResults.filter((row) => stateByResult.get(String(row.id))?.conversation_opened_at);
      const openedMisses = weeklyMisses.filter((row) => stateByResult.get(String(row.id))?.conversation_opened_at);
      const unopenedResults = agentResults.filter((row) => !stateByResult.get(String(row.id))?.conversation_opened_at);
      const unopenedMisses = unopenedResults.filter((row) => String(row.review_sentiment || "").toLowerCase() === "missed opportunity");
      const delays = agentResults.map((row) => {
        const published = toDate(row.created_at);
        const opened = toDate(stateByResult.get(String(row.id))?.first_opened_at);
        return published && opened && opened >= published ? (opened - published) / 3600000 : null;
      }).filter((value) => value !== null);
      const dashboardViews = agentViews.filter((row) => row.target_id === "/");
      const resultsViews = agentViews.filter((row) => row.target_id === "/results");
      const lastConversationOpened = Array.from(stateByResult.values()).reduce((value, row) => latest(value, row.conversation_opened_at), null);
      const lastLogin = agentSessions.reduce((value, row) => latest(value, row.started_at), null);
      const lastActive = agentSessions.reduce((value, row) => latest(value, row.last_seen_at || row.started_at), null);

      return {
        employee_name: agent.employee_name || agent.intercom_agent_name || email,
        employee_email: email,
        team_name: agent.team_name || "Unassigned",
        supervisor_team_names: agent.supervisor_team_names || [],
        intercom_agent_name: agent.intercom_agent_name || "",
        last_login_at: lastLogin,
        last_active_at: lastActive,
        last_dashboard_visit_at: dashboardViews.reduce((value, row) => latest(value, row.created_at), null),
        last_results_visit_at: resultsViews.reduce((value, row) => latest(value, row.created_at), null),
        last_conversation_opened_at: lastConversationOpened,
        days_since_login: lastLogin ? Math.max(0, Math.floor((now - new Date(lastLogin)) / 86400000)) : null,
        new_results_this_week: weeklyResults.length,
        results_opened_this_week: openedWeekly.length,
        missed_this_week: weeklyMisses.length,
        misses_opened_this_week: openedMisses.length,
        unopened_results: unopenedResults.length,
        unopened_misses: unopenedMisses.length,
        weekly_review_rate: weeklyResults.length ? (openedWeekly.length / weeklyResults.length) * 100 : 0,
        average_first_open_hours: delays.length ? delays.reduce((sum, value) => sum + value, 0) / delays.length : null,
        status: !lastLogin ? "never_logged_in" : unopenedMisses.length ? "misses_unopened" : unopenedResults.length ? "results_unopened" : "up_to_date",
      };
    });

    rows.sort((a, b) => b.unopened_misses - a.unopened_misses || b.unopened_results - a.unopened_results || a.employee_name.localeCompare(b.employee_name));
    return json({
      ok: true,
      scope: auth.canViewAllEngagement ? "all_agents" : "own",
      generated_at: now.toISOString(),
      week_started_at: weekStart.toISOString(),
      supervisorTeams: activeSupervisorTeams,
      supervisorTeamsVersion: activeSupervisorTeams.reduce((latestValue, team) => {
        const value = String(team.updated_at || "");
        return value > latestValue ? value : latestValue;
      }, ""),
      rows,
      summary: {
        agents: rows.length,
        never_logged_in: rows.filter((row) => row.status === "never_logged_in").length,
        agents_with_unopened_misses: rows.filter((row) => row.unopened_misses > 0).length,
        unopened_misses: rows.reduce((sum, row) => sum + row.unopened_misses, 0),
        results_opened_this_week: rows.reduce((sum, row) => sum + row.results_opened_this_week, 0),
      },
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Could not load Team Engagement." }, { status: 500 });
  }
}
