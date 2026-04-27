import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MASTER_ADMIN_EMAIL = "faiyaz@nextventures.io";

const ALLOWED_ROLES = [
  "master_admin",
  "supervisor_admin",
  "co_admin",
  "audit_runner",
  "viewer",
];

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

function getEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function getSupabaseClients() {
  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new Error("Missing Supabase environment variables.");
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return { authClient, adminClient };
}

function safeProfile(row) {
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    can_run_tests: row.can_run_tests,
    is_active: row.is_active,
  };
}

function getFallbackName(user, email) {
  if (email === MASTER_ADMIN_EMAIL) return "Faiyaz Muhtasim Ahmed";

  return (
    normalizeText(user?.user_metadata?.full_name) ||
    normalizeText(user?.user_metadata?.name) ||
    normalizeText(email.split("@")[0])
  );
}

function normalizeGrant(grant, user, email) {
  if (email === MASTER_ADMIN_EMAIL) {
    return {
      email,
      full_name: "Faiyaz Muhtasim Ahmed",
      role: "master_admin",
      can_run_tests: true,
      is_active: true,
    };
  }

  if (!grant || grant.is_active === false) {
    return {
      email,
      full_name: getFallbackName(user, email),
      role: "viewer",
      can_run_tests: false,
      is_active: true,
    };
  }

  const role = ALLOWED_ROLES.includes(grant.role) ? grant.role : "viewer";

  return {
    email,
    full_name: normalizeText(grant.full_name) || getFallbackName(user, email),
    role,
    can_run_tests: role === "master_admin" ? true : Boolean(grant.can_run_tests),
    is_active: grant.is_active !== false,
  };
}

async function getUserFromRequest(request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!token) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          error: "Missing access token.",
        },
        { status: 401 }
      ),
    };
  }

  const { authClient, adminClient } = getSupabaseClients();

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser(token);

  if (userError || !user) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          error: "Invalid or expired session.",
        },
        { status: 401 }
      ),
    };
  }

  const email = normalizeEmail(user.email);

  if (!email.endsWith("@nextventures.io")) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          error: "Only nextventures.io accounts are allowed.",
        },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true,
    user,
    email,
    adminClient,
  };
}

async function readRoleGrant(adminClient, email) {
  const normalizedEmail = normalizeEmail(email);

  const { data, error } = await adminClient
    .from("user_role_grants")
    .select("id, email, full_name, role, can_run_tests, is_active")
    .ilike("email", normalizedEmail)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Could not read role grant.");
  }

  return data || null;
}

async function readExistingProfile(adminClient, userId, email) {
  const normalizedEmail = normalizeEmail(email);

  if (userId) {
    const { data: profileById, error: idError } = await adminClient
      .from("profiles")
      .select("id, email, full_name, role, can_run_tests, is_active")
      .eq("id", userId)
      .maybeSingle();

    if (idError) {
      throw new Error(idError.message || "Could not read profile by user ID.");
    }

    if (profileById) return profileById;
  }

  const { data: profilesByEmail, error: emailError } = await adminClient
    .from("profiles")
    .select("id, email, full_name, role, can_run_tests, is_active")
    .ilike("email", normalizedEmail)
    .limit(1);

  if (emailError) {
    throw new Error(emailError.message || "Could not read profile by email.");
  }

  return Array.isArray(profilesByEmail) && profilesByEmail.length ? profilesByEmail[0] : null;
}

async function saveProfile(adminClient, user, email, grantPayload, existingProfile) {
  const nowPayload = {
    id: user.id,
    email,
    full_name: grantPayload.full_name,
    role: grantPayload.role,
    can_run_tests: grantPayload.can_run_tests,
    is_active: grantPayload.is_active,
  };

  if (email === MASTER_ADMIN_EMAIL) {
    nowPayload.role = "master_admin";
    nowPayload.can_run_tests = true;
    nowPayload.is_active = true;
    nowPayload.full_name = "Faiyaz Muhtasim Ahmed";
  }

  if (existingProfile?.id) {
    const updatePayload = {
      email,
      role: nowPayload.role,
      can_run_tests: nowPayload.can_run_tests,
      is_active: nowPayload.is_active,
    };

    if (nowPayload.full_name) {
      updatePayload.full_name = nowPayload.full_name;
    }

    const { data, error } = await adminClient
      .from("profiles")
      .update(updatePayload)
      .eq("id", existingProfile.id)
      .select("id, email, full_name, role, can_run_tests, is_active")
      .single();

    if (error) {
      throw new Error(error.message || "Could not update profile.");
    }

    return data;
  }

  const { data, error } = await adminClient
    .from("profiles")
    .insert(nowPayload)
    .select("id, email, full_name, role, can_run_tests, is_active")
    .single();

  if (error) {
    throw new Error(error.message || "Could not create profile.");
  }

  return data;
}


function getRequestMeta(request) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const ipAddress = forwardedFor.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
  const userAgent = request.headers.get("user-agent") || "";

  return {
    ip_address: ipAddress || null,
    user_agent: userAgent || null,
    request_path: new URL(request.url).pathname,
  };
}

function getDurationSeconds(startedAt, endedAt = new Date()) {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

  return Math.max(0, Math.round((end - start) / 1000));
}

async function writeSystemLog(adminClient, payload) {
  const { error } = await adminClient.from("system_activity_logs").insert(payload);

  if (error) {
    throw new Error(error.message || "Could not write system activity log.");
  }
}

async function findRecentActiveSession(adminClient, email) {
  const activeSince = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { data, error } = await adminClient
    .from("user_activity_sessions")
    .select("id, started_at, last_seen_at")
    .eq("email", email)
    .eq("status", "active")
    .gte("last_seen_at", activeSince)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Could not read activity session.");
  }

  return data || null;
}

async function touchActivitySession(adminClient, request, user, email, profile) {
  try {
    const nowIso = new Date().toISOString();
    const meta = getRequestMeta(request);
    const actorName =
      normalizeText(profile?.full_name) ||
      normalizeText(user?.user_metadata?.full_name) ||
      normalizeText(user?.user_metadata?.name) ||
      email;
    const actorRole = email === MASTER_ADMIN_EMAIL ? "master_admin" : profile?.role || "viewer";
    const recentSession = await findRecentActiveSession(adminClient, email);

    if (recentSession?.id) {
      const { error } = await adminClient
        .from("user_activity_sessions")
        .update({
          user_id: user.id,
          full_name: actorName,
          role: actorRole,
          last_seen_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", recentSession.id);

      if (error) {
        throw new Error(error.message || "Could not update activity session.");
      }

      return recentSession.id;
    }

    const { data: newSession, error: sessionError } = await adminClient
      .from("user_activity_sessions")
      .insert({
        user_id: user.id,
        email,
        full_name: actorName,
        role: actorRole,
        last_seen_at: nowIso,
        status: "active",
        ip_address: meta.ip_address,
        user_agent: meta.user_agent,
      })
      .select("id")
      .single();

    if (sessionError) {
      throw new Error(sessionError.message || "Could not create activity session.");
    }

    await writeSystemLog(adminClient, {
      actor_user_id: user.id,
      actor_email: email,
      actor_name: actorName,
      actor_role: actorRole,
      action_type: "session_started",
      action_label: "User Signed In",
      area: "Authentication",
      status: "info",
      description: `${actorName} signed in.`,
      metadata: {
        source: "profile_sync",
      },
      request_path: meta.request_path,
      ip_address: meta.ip_address,
      user_agent: meta.user_agent,
      session_id: newSession.id,
    });

    return newSession.id;
  } catch (error) {
    console.warn("[activity-log] profile session tracking failed", error);
    return null;
  }
}


export async function GET(request) {
  try {
    const auth = await getUserFromRequest(request);

    if (!auth.ok) return auth.response;

    const [grant, existingProfile] = await Promise.all([
      readRoleGrant(auth.adminClient, auth.email),
      readExistingProfile(auth.adminClient, auth.user.id, auth.email),
    ]);

    const grantPayload = normalizeGrant(grant, auth.user, auth.email);
    const savedProfile = await saveProfile(
      auth.adminClient,
      auth.user,
      auth.email,
      grantPayload,
      existingProfile
    );

    const sessionId = await touchActivitySession(
      auth.adminClient,
      request,
      auth.user,
      auth.email,
      savedProfile
    );

    return json({
      ok: true,
      profile: safeProfile(savedProfile),
      grant_applied: Boolean(grant && grant.is_active !== false),
      source: grant && grant.is_active !== false ? "role_grant" : "default_profile",
      activity_session_id: sessionId,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown server error.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  return GET(request);
}
