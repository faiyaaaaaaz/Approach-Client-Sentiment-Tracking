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
  const { data, error } = await adminClient
    .from("user_role_grants")
    .select("id, email, full_name, role, can_run_tests, is_active")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Could not read role grant.");
  }

  return data || null;
}

async function readExistingProfile(adminClient, userId, email) {
  const { data, error } = await adminClient
    .from("profiles")
    .select("id, email, full_name, role, can_run_tests, is_active")
    .or(`id.eq.${userId},email.eq.${email}`)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Could not read profile.");
  }

  return data || null;
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

    return json({
      ok: true,
      profile: safeProfile(savedProfile),
      grant_applied: Boolean(grant && grant.is_active !== false),
      source: grant && grant.is_active !== false ? "role_grant" : "default_profile",
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
