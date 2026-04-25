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

function normalizeAgentKey(value) {
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
        "SUPABASE_SERVICE_ROLE_KEY is missing. Add it in Vercel Environment Variables so Admin mapping actions can run safely server-side.",
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
      error: "Only nextventures.io accounts can access Admin mapping controls.",
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
      error: "Only Master Admins and Co-Admins can manage agent mappings.",
      status: 403,
    };
  }

  return {
    adminClient,
    profile,
    user,
  };
}

async function findExistingMapping(adminClient, intercomAgentName) {
  const normalizedTarget = normalizeAgentKey(intercomAgentName);

  if (!normalizedTarget) return null;

  const { data, error } = await adminClient
    .from("agent_mappings")
    .select("id, intercom_agent_name")
    .limit(2000);

  if (error) {
    throw new Error(error.message || "Could not check existing mappings.");
  }

  return (
    (Array.isArray(data) ? data : []).find(
      (row) => normalizeAgentKey(row?.intercom_agent_name) === normalizedTarget
    ) || null
  );
}

function validateMappingPayload(rawBody) {
  const mapping = rawBody?.mapping && typeof rawBody.mapping === "object" ? rawBody.mapping : rawBody;

  const id = normalizeText(mapping?.id);
  const intercomAgentName = normalizeText(mapping?.intercom_agent_name);
  const employeeName = normalizeText(mapping?.employee_name) || intercomAgentName;
  const employeeEmail = normalizeEmail(mapping?.employee_email);
  const teamName = normalizeText(mapping?.team_name);
  const notes = normalizeText(mapping?.notes);
  const isActive = mapping?.is_active !== false;

  if (!intercomAgentName) {
    return {
      error: "Intercom agent name is required.",
    };
  }

  if (!employeeName) {
    return {
      error: "Employee name is required.",
    };
  }

  if (employeeEmail && !employeeEmail.endsWith("@nextventures.io")) {
    return {
      error: "Employee email must use the nextventures.io domain.",
    };
  }

  return {
    value: {
      id,
      intercom_agent_name: intercomAgentName,
      employee_name: employeeName,
      employee_email: employeeEmail || null,
      team_name: teamName || null,
      notes: notes || null,
      is_active: isActive,
    },
  };
}

export async function GET(request) {
  const auth = await authenticateAdmin(request);

  if (auth.error) {
    return jsonResponse({ ok: false, error: auth.error }, auth.status);
  }

  const { adminClient } = auth;

  try {
    const [mappingsResponse, auditRowsResponse] = await Promise.all([
      adminClient
        .from("agent_mappings")
        .select("*")
        .order("employee_name", { ascending: true })
        .order("intercom_agent_name", { ascending: true }),

      adminClient
        .from("audit_results")
        .select(
          "id, agent_name, employee_name, employee_email, team_name, employee_match_status, created_at, replied_at"
        )
        .order("created_at", { ascending: false })
        .limit(5000),
    ]);

    if (mappingsResponse.error) {
      throw new Error(mappingsResponse.error.message || "Could not load agent mappings.");
    }

    if (auditRowsResponse.error) {
      throw new Error(auditRowsResponse.error.message || "Could not load audit result samples.");
    }

    return jsonResponse({
      ok: true,
      mappings: Array.isArray(mappingsResponse.data) ? mappingsResponse.data : [],
      auditRows: Array.isArray(auditRowsResponse.data) ? auditRowsResponse.data : [],
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not load mapping data.",
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
    const validation = validateMappingPayload(body);

    if (validation.error) {
      return jsonResponse({ ok: false, error: validation.error }, 400);
    }

    const payload = validation.value;
    const now = new Date().toISOString();

    const existing = payload.id
      ? { id: payload.id }
      : await findExistingMapping(adminClient, payload.intercom_agent_name);

    const savePayload = {
      intercom_agent_name: payload.intercom_agent_name,
      employee_name: payload.employee_name,
      employee_email: payload.employee_email,
      team_name: payload.team_name,
      notes: payload.notes,
      is_active: payload.is_active,
      updated_at: now,
    };

    let savedRow = null;

    if (existing?.id) {
      const { data, error } = await adminClient
        .from("agent_mappings")
        .update(savePayload)
        .eq("id", existing.id)
        .select("*")
        .single();

      if (error) {
        throw new Error(error.message || "Could not update mapping.");
      }

      savedRow = data;
    } else {
      const { data, error } = await adminClient
        .from("agent_mappings")
        .insert({
          ...savePayload,
          created_at: now,
        })
        .select("*")
        .single();

      if (error) {
        throw new Error(error.message || "Could not create mapping.");
      }

      savedRow = data;
    }

    return jsonResponse({
      ok: true,
      message: existing?.id ? "Mapping updated successfully." : "Mapping created successfully.",
      mapping: savedRow,
      changedBy: profile?.email || null,
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not save mapping.",
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
    const action = normalizeText(body?.action) || "set_active";

    if (!id) {
      return jsonResponse({ ok: false, error: "Mapping ID is required." }, 400);
    }

    if (action !== "set_active" && action !== "toggle_active") {
      return jsonResponse({ ok: false, error: "Unsupported mapping action." }, 400);
    }

    const { data: currentRow, error: currentError } = await adminClient
      .from("agent_mappings")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (currentError) {
      throw new Error(currentError.message || "Could not read mapping.");
    }

    if (!currentRow) {
      return jsonResponse({ ok: false, error: "Mapping not found." }, 404);
    }

    const nextActive =
      action === "toggle_active" ? currentRow.is_active === false : Boolean(body?.is_active);

    const { data, error } = await adminClient
      .from("agent_mappings")
      .update({
        is_active: nextActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message || "Could not update mapping status.");
    }

    return jsonResponse({
      ok: true,
      message: nextActive ? "Mapping activated." : "Mapping deactivated.",
      mapping: data,
      changedBy: profile?.email || null,
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not update mapping status.",
      },
      500
    );
  }
}
