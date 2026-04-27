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

function safeGrant(row) {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    can_run_tests: row.can_run_tests,
    is_active: row.is_active,
    created_by_email: row.created_by_email,
    updated_by_email: row.updated_by_email,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function safeProfile(row) {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    can_run_tests: row.can_run_tests,
    is_active: row.is_active,
  };
}

async function requireMasterAdmin(request) {
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

  if (email !== MASTER_ADMIN_EMAIL) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          error: "Only the Master Admin can manage user role grants.",
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

async function listRoleData(adminClient) {
  const [grantsResult, profilesResult] = await Promise.all([
    adminClient
      .from("user_role_grants")
      .select(
        "id, email, full_name, role, can_run_tests, is_active, created_by_email, updated_by_email, created_at, updated_at"
      )
      .order("email", { ascending: true }),

    adminClient
      .from("profiles")
      .select("id, email, full_name, role, can_run_tests, is_active")
      .order("email", { ascending: true }),
  ]);

  if (grantsResult.error) {
    throw new Error(grantsResult.error.message || "Could not load role grants.");
  }

  if (profilesResult.error) {
    throw new Error(profilesResult.error.message || "Could not load profiles.");
  }

  return {
    grants: Array.isArray(grantsResult.data) ? grantsResult.data.map(safeGrant) : [],
    profiles: Array.isArray(profilesResult.data) ? profilesResult.data.map(safeProfile) : [],
  };
}

async function updateExistingProfileIfPresent(adminClient, payload) {
  const email = normalizeEmail(payload.email);

  if (!email) {
    return null;
  }

  const { data: profileRows, error: profileReadError } = await adminClient
    .from("profiles")
    .select("id, email")
    .ilike("email", email)
    .limit(25);

  if (profileReadError) {
    throw new Error(profileReadError.message || "Could not check existing user profile.");
  }

  const matchingProfiles = Array.isArray(profileRows)
    ? profileRows.filter((row) => row?.id)
    : [];

  if (!matchingProfiles.length) {
    return null;
  }

  const nextProfilePayload = {
    email,
    role: payload.role,
    can_run_tests: payload.can_run_tests,
    is_active: payload.is_active,
  };

  if (payload.full_name) {
    nextProfilePayload.full_name = payload.full_name;
  }

  if (email === MASTER_ADMIN_EMAIL) {
    nextProfilePayload.role = "master_admin";
    nextProfilePayload.can_run_tests = true;
    nextProfilePayload.is_active = true;
    nextProfilePayload.full_name = "Faiyaz Muhtasim Ahmed";
  }

  const { data: updatedProfiles, error: profileUpdateError } = await adminClient
    .from("profiles")
    .update(nextProfilePayload)
    .in(
      "id",
      matchingProfiles.map((row) => row.id)
    )
    .select("id, email, full_name, role, can_run_tests, is_active");

  if (profileUpdateError) {
    throw new Error(profileUpdateError.message || "Could not update existing user profile.");
  }

  return Array.isArray(updatedProfiles) && updatedProfiles.length
    ? safeProfile(updatedProfiles[0])
    : null;
}

function validateRolePayload(body) {
  const email = normalizeEmail(body?.email);
  const fullName = normalizeText(body?.fullName || body?.full_name);
  const role = normalizeText(body?.role || "viewer").toLowerCase();
  const canRunTests = Boolean(body?.canRunTests ?? body?.can_run_tests);
  const isActive = body?.isActive === false || body?.is_active === false ? false : true;

  if (!email || !email.endsWith("@nextventures.io")) {
    return {
      ok: false,
      error: "Use a valid nextventures.io email address.",
    };
  }

  if (!ALLOWED_ROLES.includes(role)) {
    return {
      ok: false,
      error: "Invalid role selected.",
    };
  }

  if (email === MASTER_ADMIN_EMAIL) {
    return {
      ok: true,
      value: {
        email,
        full_name: fullName || "Faiyaz Muhtasim Ahmed",
        role: "master_admin",
        can_run_tests: true,
        is_active: true,
      },
    };
  }

  return {
    ok: true,
    value: {
      email,
      full_name: fullName || null,
      role,
      can_run_tests: role === "master_admin" ? true : canRunTests,
      is_active: isActive,
    },
  };
}

export async function GET(request) {
  try {
    const auth = await requireMasterAdmin(request);

    if (!auth.ok) return auth.response;

    const data = await listRoleData(auth.adminClient);

    return json({
      ok: true,
      ...data,
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
  try {
    const auth = await requireMasterAdmin(request);

    if (!auth.ok) return auth.response;

    const body = await request.json();
    const validation = validateRolePayload(body);

    if (!validation.ok) {
      return json(
        {
          ok: false,
          error: validation.error,
        },
        { status: 400 }
      );
    }

    const payload = validation.value;
    const now = new Date().toISOString();

    const row = {
      ...payload,
      created_by_email: auth.email,
      updated_by_email: auth.email,
      updated_at: now,
    };

    const { data: savedGrant, error: upsertError } = await auth.adminClient
      .from("user_role_grants")
      .upsert(row, {
        onConflict: "email",
      })
      .select(
        "id, email, full_name, role, can_run_tests, is_active, created_by_email, updated_by_email, created_at, updated_at"
      )
      .single();

    if (upsertError) {
      throw new Error(upsertError.message || "Could not save role grant.");
    }

    const updatedProfile = await updateExistingProfileIfPresent(auth.adminClient, payload);
    const data = await listRoleData(auth.adminClient);

    return json({
      ok: true,
      message: updatedProfile
        ? "Role grant saved and existing profile updated."
        : "Role grant saved. This user will receive access when they sign in.",
      grant: safeGrant(savedGrant),
      updatedProfile,
      ...data,
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

export async function PATCH(request) {
  try {
    const auth = await requireMasterAdmin(request);

    if (!auth.ok) return auth.response;

    const body = await request.json();
    const validation = validateRolePayload(body);

    if (!validation.ok) {
      return json(
        {
          ok: false,
          error: validation.error,
        },
        { status: 400 }
      );
    }

    const payload = validation.value;
    const now = new Date().toISOString();

    const { data: existingGrant, error: readError } = await auth.adminClient
      .from("user_role_grants")
      .select("id, email")
      .eq("email", payload.email)
      .maybeSingle();

    if (readError) {
      throw new Error(readError.message || "Could not read role grant.");
    }

    if (!existingGrant) {
      return json(
        {
          ok: false,
          error: "Role grant not found. Use Save role to create it first.",
        },
        { status: 404 }
      );
    }

    const { data: updatedGrant, error: updateError } = await auth.adminClient
      .from("user_role_grants")
      .update({
        full_name: payload.full_name,
        role: payload.role,
        can_run_tests: payload.can_run_tests,
        is_active: payload.is_active,
        updated_by_email: auth.email,
        updated_at: now,
      })
      .eq("email", payload.email)
      .select(
        "id, email, full_name, role, can_run_tests, is_active, created_by_email, updated_by_email, created_at, updated_at"
      )
      .single();

    if (updateError) {
      throw new Error(updateError.message || "Could not update role grant.");
    }

    const updatedProfile = await updateExistingProfileIfPresent(auth.adminClient, payload);
    const data = await listRoleData(auth.adminClient);

    return json({
      ok: true,
      message: updatedProfile
        ? "Role grant updated and existing profile updated."
        : "Role grant updated.",
      grant: safeGrant(updatedGrant),
      updatedProfile,
      ...data,
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

export async function DELETE(request) {
  try {
    const auth = await requireMasterAdmin(request);

    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const email = normalizeEmail(searchParams.get("email"));

    if (!email || !email.endsWith("@nextventures.io")) {
      return json(
        {
          ok: false,
          error: "Use a valid nextventures.io email address.",
        },
        { status: 400 }
      );
    }

    if (email === MASTER_ADMIN_EMAIL) {
      return json(
        {
          ok: false,
          error: "Creator Master Admin access cannot be deactivated.",
        },
        { status: 403 }
      );
    }

    const now = new Date().toISOString();

    const { error: grantError } = await auth.adminClient
      .from("user_role_grants")
      .update({
        is_active: false,
        updated_by_email: auth.email,
        updated_at: now,
      })
      .eq("email", email);

    if (grantError) {
      throw new Error(grantError.message || "Could not deactivate role grant.");
    }

    await updateExistingProfileIfPresent(auth.adminClient, {
      email,
      role: "viewer",
      can_run_tests: false,
      is_active: false,
      full_name: "",
    });

    const data = await listRoleData(auth.adminClient);

    return json({
      ok: true,
      message: "Role grant deactivated.",
      ...data,
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
