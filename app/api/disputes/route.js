import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MASTER_ADMIN_EMAIL = "faiyaz@nextventures.io";

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

function createClients() {
  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new Error("Missing required Supabase environment variables.");
  }

  return {
    authClient: createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    adminClient: createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}

function fallbackProfile(user) {
  const email = normalizeEmail(user?.email);
  if (email === MASTER_ADMIN_EMAIL) {
    return { id: user.id, email, full_name: user.user_metadata?.full_name || "Faiyaz Muhtasim Ahmed", role: "master_admin", can_run_tests: true, is_active: true };
  }
  if (email.endsWith("@nextventures.io")) {
    return { id: user.id, email, full_name: user.user_metadata?.full_name || user.user_metadata?.name || email, role: "viewer", can_run_tests: false, is_active: true };
  }
  return null;
}

async function authenticate(request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";

  if (!token) return { ok: false, response: json({ ok: false, error: "Missing access token." }, { status: 401 }) };

  const { authClient, adminClient } = createClients();
  const { data: { user }, error: userError } = await authClient.auth.getUser(token);

  if (userError || !user) return { ok: false, response: json({ ok: false, error: "Invalid or expired session." }, { status: 401 }) };

  const email = normalizeEmail(user.email);
  if (!email.endsWith("@nextventures.io")) return { ok: false, response: json({ ok: false, error: "Only nextventures.io accounts are allowed." }, { status: 403 }) };

  const { data: profileById, error: idError } = await adminClient
    .from("profiles")
    .select("id, email, full_name, role, can_run_tests, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (idError) throw new Error(idError.message || "Could not load profile.");

  let profile = profileById || null;
  if (!profile) {
    const { data: profileByEmail, error: emailError } = await adminClient
      .from("profiles")
      .select("id, email, full_name, role, can_run_tests, is_active")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (emailError) throw new Error(emailError.message || "Could not load profile by email.");
    profile = profileByEmail || null;
  }

  profile = profile || fallbackProfile(user);
  if (email === MASTER_ADMIN_EMAIL) profile = { ...(profile || {}), id: user.id, email, full_name: profile?.full_name || "Faiyaz Muhtasim Ahmed", role: "master_admin", can_run_tests: true, is_active: true };

  if (!profile?.is_active) return { ok: false, response: json({ ok: false, error: "This account is not active." }, { status: 403 }) };

  return { ok: true, user, email, profile, adminClient };
}

function isMasterAdmin(profile, email) {
  const role = normalizeKey(profile?.role);
  return email === MASTER_ADMIN_EMAIL || role === "master_admin";
}

async function canDisputeResult(adminClient, auth, result) {
  const role = normalizeKey(auth.profile?.role);
  const actorEmail = normalizeEmail(auth.email);
  const actorName = normalizeKey(auth.profile?.full_name);
  const resultEmployeeEmail = normalizeEmail(result?.employee_email);

  if (isMasterAdmin(auth.profile, actorEmail)) return { allowed: true, reason: "master_admin" };

  if (role === "supervisor_admin") {
    const { data: teams, error: teamsError } = await adminClient
      .from("supervisor_teams")
      .select("id, supervisor_name, supervisor_email, is_active")
      .eq("is_active", true)
      .limit(1000);

    if (teamsError) throw new Error(teamsError.message || "Could not check Supervisor Team access.");

    const matchingTeamIds = (Array.isArray(teams) ? teams : [])
      .filter((team) => normalizeEmail(team?.supervisor_email) === actorEmail || normalizeKey(team?.supervisor_name) === actorName)
      .map((team) => team.id)
      .filter(Boolean);

    if (matchingTeamIds.length && resultEmployeeEmail) {
      const { data: member, error: memberError } = await adminClient
        .from("supervisor_team_members")
        .select("id")
        .in("supervisor_team_id", matchingTeamIds)
        .ilike("employee_email", resultEmployeeEmail)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (memberError) throw new Error(memberError.message || "Could not check team member access.");
      if (member?.id) return { allowed: true, reason: "supervisor_team_member" };
    }
  }

  if (resultEmployeeEmail && actorEmail === resultEmployeeEmail) return { allowed: true, reason: "own_result" };

  return { allowed: false, reason: "not_owner_or_team" };
}

async function writeActivityLog(adminClient, request, auth, payload) {
  try {
    const forwardedFor = request.headers.get("x-forwarded-for") || "";
    await adminClient.from("system_activity_logs").insert({
      actor_user_id: auth.user?.id || auth.profile?.id || null,
      actor_email: auth.email || "unknown",
      actor_name: normalizeText(auth.profile?.full_name) || normalizeText(auth.user?.user_metadata?.full_name) || auth.email || "Unknown",
      actor_role: normalizeText(auth.profile?.role) || "viewer",
      action_type: payload.action_type,
      action_label: payload.action_label || payload.action_type,
      area: "Dispute Management",
      status: payload.status || "success",
      target_type: payload.target_type || "verdict_dispute",
      target_id: payload.target_id || null,
      target_label: payload.target_label || null,
      description: payload.description || null,
      metadata: payload.metadata || {},
      ip_address: forwardedFor.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null,
      user_agent: request.headers.get("user-agent") || null,
      request_path: new URL(request.url).pathname,
    });
  } catch (error) {
    console.warn("[disputes] activity log failed", error);
  }
}

export async function GET(request) {
  try {
    const auth = await authenticate(request);
    if (!auth.ok) return auth.response;

    if (!isMasterAdmin(auth.profile, auth.email)) {
      return json({ ok: false, error: "Only Master Admins can view Dispute Management." }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = normalizeKey(searchParams.get("status") || "all");

    let query = auth.adminClient
      .from("verdict_disputes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (status && status !== "all") query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw new Error(error.message || "Could not load disputes.");

    return json({ ok: true, disputes: data || [] });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Could not load disputes." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const auth = await authenticate(request);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const resultId = normalizeText(body.result_id);
    const conversationId = normalizeText(body.conversation_id);
    const reason = normalizeText(body.reason);

    if (!resultId && !conversationId) return json({ ok: false, error: "This result does not have a saved result ID or conversation ID." }, { status: 400 });
    if (!reason) return json({ ok: false, error: "Reason for dispute is required." }, { status: 400 });

    let result = null;

    if (resultId) {
      const { data, error } = await auth.adminClient
        .from("audit_results")
        .select("id, conversation_id, agent_name, employee_name, employee_email, team_name, review_sentiment, client_sentiment, resolution_status, replied_at, created_at")
        .eq("id", resultId)
        .maybeSingle();
      if (error) throw new Error(error.message || "Could not load result.");
      result = data || null;
    }

    if (!result && conversationId) {
      const { data, error } = await auth.adminClient
        .from("audit_results")
        .select("id, conversation_id, agent_name, employee_name, employee_email, team_name, review_sentiment, client_sentiment, resolution_status, replied_at, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message || "Could not load result by conversation ID.");
      result = data || null;
    }

    const resultForPermission = result || {
      id: resultId || null,
      conversation_id: conversationId,
      agent_name: normalizeText(body.agent_name),
      employee_name: normalizeText(body.employee_name),
      employee_email: normalizeEmail(body.employee_email),
      team_name: normalizeText(body.team_name),
      review_sentiment: normalizeText(body.current_review_status),
      client_sentiment: normalizeText(body.client_sentiment),
      resolution_status: normalizeText(body.resolution_status),
      replied_at: body.replied_at || null,
      created_at: body.created_at || null,
    };

    const permission = await canDisputeResult(auth.adminClient, auth, resultForPermission);
    if (!permission.allowed) {
      return json({ ok: false, error: "You can only dispute your own results. If this belongs to your team, please ask your Supervisor Admin or Master Admin to review it." }, { status: 403 });
    }

    const { data: existing, error: existingError } = await auth.adminClient
      .from("verdict_disputes")
      .select("id, status")
      .eq("result_id", resultForPermission.id)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message || "Could not check existing disputes.");
    if (existing?.id) return json({ ok: false, error: "A pending dispute already exists for this result." }, { status: 409 });

    const insertPayload = {
      result_id: resultForPermission.id || null,
      conversation_id: resultForPermission.conversation_id || conversationId || null,
      agent_name: resultForPermission.agent_name || null,
      employee_name: resultForPermission.employee_name || null,
      employee_email: resultForPermission.employee_email || null,
      team_name: resultForPermission.team_name || null,
      current_review_status: resultForPermission.review_sentiment || normalizeText(body.current_review_status) || null,
      client_sentiment: resultForPermission.client_sentiment || null,
      resolution_status: resultForPermission.resolution_status || null,
      reason,
      status: "pending",
      submitted_by_user_id: auth.user?.id || auth.profile?.id || null,
      submitted_by_name: normalizeText(auth.profile?.full_name) || normalizeText(auth.user?.user_metadata?.full_name) || auth.email,
      submitted_by_email: auth.email,
      permission_source: permission.reason,
    };

    const { data: dispute, error: insertError } = await auth.adminClient
      .from("verdict_disputes")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertError) throw new Error(insertError.message || "Could not submit dispute.");

    await writeActivityLog(auth.adminClient, request, auth, {
      action_type: "verdict_dispute_submitted",
      action_label: "Verdict dispute submitted",
      target_id: dispute.id,
      target_label: dispute.conversation_id || dispute.result_id,
      description: `${auth.email} submitted a Review Status dispute for ${dispute.conversation_id || dispute.result_id}.`,
      metadata: { result_id: dispute.result_id, conversation_id: dispute.conversation_id, current_review_status: dispute.current_review_status },
    });

    return json({ ok: true, dispute });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Could not submit dispute." }, { status: 500 });
  }
}
