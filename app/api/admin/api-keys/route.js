import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MASTER_ADMIN_EMAIL = "faiyaz@nextventures.io";
const ALLOWED_KEY_TYPES = ["intercom", "openai"];

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

async function writeActivityLog(adminClient, request, payload) {
  try {
    const meta = getRequestMeta(request);

    await adminClient.from("system_activity_logs").insert({
      actor_user_id: payload.actor_user_id || null,
      actor_email: normalizeEmail(payload.actor_email) || "unknown",
      actor_name: normalizeText(payload.actor_name) || null,
      actor_role: normalizeText(payload.actor_role) || null,
      action_type: normalizeText(payload.action_type) || "admin_action",
      action_label: normalizeText(payload.action_label) || "Admin Action",
      area: normalizeText(payload.area) || "API Key Vault",
      target_type: normalizeText(payload.target_type) || null,
      target_id: normalizeText(payload.target_id) || null,
      target_label: normalizeText(payload.target_label) || null,
      status: normalizeText(payload.status) || "success",
      description: normalizeText(payload.description) || null,
      is_sensitive: Boolean(payload.is_sensitive),
      safe_before: payload.safe_before || {},
      safe_after: payload.safe_after || {},
      metadata: payload.metadata || {},
      request_path: meta.request_path,
      ip_address: meta.ip_address,
      user_agent: meta.user_agent,
      session_id: payload.session_id || null,
    });
  } catch (error) {
    console.warn("[activity-log] api key log failed", error);
  }
}

function buildActorPayload(auth) {
  return {
    actor_user_id: auth?.user?.id || null,
    actor_email: auth?.email || "",
    actor_name:
      normalizeText(auth?.user?.user_metadata?.full_name) ||
      normalizeText(auth?.user?.user_metadata?.name) ||
      auth?.email ||
      "",
    actor_role: "master_admin",
  };
}

function getFingerprint(secretValue) {
  return createHash("sha256").update(String(secretValue || "").trim()).digest("hex");
}

function maskSecret(secretValue) {
  const cleaned = String(secretValue || "").trim();

  if (!cleaned) return "";

  if (cleaned.length <= 10) {
    return `${cleaned.slice(0, 2)}${"*".repeat(Math.max(cleaned.length - 4, 4))}${cleaned.slice(-2)}`;
  }

  return `${cleaned.slice(0, 6)}${"*".repeat(10)}${cleaned.slice(-4)}`;
}

function getSafeKeyRow(row) {
  return {
    id: row.id,
    key_type: row.key_type,
    key_label: row.key_label,
    masked_value: row.masked_value,
    fingerprint: row.fingerprint,
    is_active: row.is_active,
    created_by_email: row.created_by_email,
    updated_by_email: row.updated_by_email,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
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
          error: "Only the Master Admin can manage API keys.",
        },
        { status: 403 }
      ),
    };
  }

  const { data: profileData } = await adminClient
    .from("profiles")
    .select("id, email, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (profileData && profileData.is_active === false) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          error: "Your Master Admin profile is inactive.",
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

async function listKeys(adminClient) {
  const { data, error } = await adminClient
    .from("api_keys")
    .select(
      "id, key_type, key_label, masked_value, fingerprint, is_active, created_by_email, updated_by_email, created_at, updated_at"
    )
    .order("key_type", { ascending: true })
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message || "Could not load API keys.");
  }

  return Array.isArray(data) ? data.map(getSafeKeyRow) : [];
}

export async function GET(request) {
  try {
    const auth = await requireMasterAdmin(request);

    if (!auth.ok) return auth.response;

    const keys = await listKeys(auth.adminClient);

    return json({
      ok: true,
      keys,
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
  let auth = null;
  let keyType = "";
  let keyLabel = "";

  try {
    auth = await requireMasterAdmin(request);

    if (!auth.ok) return auth.response;

    const body = await request.json();

    keyType = normalizeText(body?.keyType || body?.key_type).toLowerCase();
    keyLabel = normalizeText(body?.keyLabel || body?.key_label) || "Primary key";
    const secretValue = normalizeText(body?.secretValue || body?.secret_value);
    const makeActive = body?.makeActive !== false;

    if (!ALLOWED_KEY_TYPES.includes(keyType)) {
      await writeActivityLog(auth.adminClient, request, {
        ...buildActorPayload(auth),
        action_type: "api_key_save_failed",
        action_label: "API Key Save Failed",
        area: "API Key Vault",
        target_type: "api_key",
        target_label: keyType || "Unknown API Key",
        status: "failed",
        description: "API key save failed because the key type was invalid.",
        is_sensitive: true,
        safe_after: {
          key_type: keyType,
          key_label: keyLabel,
          make_active: makeActive,
        },
      });

      return json(
        {
          ok: false,
          error: "Invalid key type. Use intercom or openai.",
        },
        { status: 400 }
      );
    }

    if (!secretValue) {
      await writeActivityLog(auth.adminClient, request, {
        ...buildActorPayload(auth),
        action_type: "api_key_save_failed",
        action_label: "API Key Save Failed",
        area: "API Key Vault",
        target_type: "api_key",
        target_label: `${keyType} API Key`,
        status: "failed",
        description: "API key save failed because no key value was provided.",
        is_sensitive: true,
        safe_after: {
          key_type: keyType,
          key_label: keyLabel,
          make_active: makeActive,
        },
      });

      return json(
        {
          ok: false,
          error: "API key value is required.",
        },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const fingerprint = getFingerprint(secretValue);
    const maskedValue = maskSecret(secretValue);

    if (makeActive) {
      const { error: deactivateError } = await auth.adminClient
        .from("api_keys")
        .update({
          is_active: false,
          updated_by_email: auth.email,
          updated_at: now,
        })
        .eq("key_type", keyType);

      if (deactivateError) {
        throw new Error(deactivateError.message || "Could not deactivate old keys.");
      }
    }

    const { error: upsertError } = await auth.adminClient
      .from("api_keys")
      .upsert(
        {
          key_type: keyType,
          key_label: keyLabel,
          secret_value: secretValue,
          masked_value: maskedValue,
          fingerprint,
          is_active: makeActive,
          created_by_email: auth.email,
          updated_by_email: auth.email,
          updated_at: now,
        },
        {
          onConflict: "key_type,fingerprint",
        }
      );

    if (upsertError) {
      throw new Error(upsertError.message || "Could not save API key.");
    }

    await writeActivityLog(auth.adminClient, request, {
      ...buildActorPayload(auth),
      action_type: "api_key_saved",
      action_label: "API Key Saved",
      area: "API Key Vault",
      target_type: "api_key",
      target_id: fingerprint,
      target_label: `${keyType === "intercom" ? "Intercom" : "OpenAI"} API Key`,
      status: "success",
      description: `${keyType === "intercom" ? "Intercom" : "OpenAI"} API key was saved from Admin.`,
      is_sensitive: true,
      safe_after: {
        key_type: keyType,
        key_label: keyLabel,
        masked_value: maskedValue,
        fingerprint,
        is_active: makeActive,
        updated_by_email: auth.email,
        updated_at: now,
      },
      metadata: {
        made_active: makeActive,
      },
    });

    const keys = await listKeys(auth.adminClient);

    return json({
      ok: true,
      message: `${keyType === "intercom" ? "Intercom" : "OpenAI"} API key saved successfully.`,
      keys,
    });
  } catch (error) {
    if (auth?.ok && auth?.adminClient) {
      await writeActivityLog(auth.adminClient, request, {
        ...buildActorPayload(auth),
        action_type: "api_key_save_failed",
        action_label: "API Key Save Failed",
        area: "API Key Vault",
        target_type: "api_key",
        target_label: `${keyType || "Unknown"} API Key`,
        status: "failed",
        description: error instanceof Error ? error.message : "Unknown server error.",
        is_sensitive: true,
        safe_after: {
          key_type: keyType,
          key_label: keyLabel,
        },
      });
    }

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
  let auth = null;
  let id = "";
  let existingKey = null;

  try {
    auth = await requireMasterAdmin(request);

    if (!auth.ok) return auth.response;

    const body = await request.json();

    id = normalizeText(body?.id);
    const keyLabel = normalizeText(body?.keyLabel || body?.key_label);
    const isActive =
      typeof body?.isActive === "boolean"
        ? body.isActive
        : typeof body?.is_active === "boolean"
        ? body.is_active
        : null;

    if (!id) {
      return json(
        {
          ok: false,
          error: "API key ID is required.",
        },
        { status: 400 }
      );
    }

    const { data: existingData, error: existingError } = await auth.adminClient
      .from("api_keys")
      .select("id, key_type, key_label, masked_value, fingerprint, is_active")
      .eq("id", id)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message || "Could not read API key.");
    }

    existingKey = existingData;

    if (!existingKey) {
      return json(
        {
          ok: false,
          error: "API key not found.",
        },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();

    if (isActive === true) {
      const { error: deactivateError } = await auth.adminClient
        .from("api_keys")
        .update({
          is_active: false,
          updated_by_email: auth.email,
          updated_at: now,
        })
        .eq("key_type", existingKey.key_type)
        .neq("id", id);

      if (deactivateError) {
        throw new Error(deactivateError.message || "Could not deactivate other keys.");
      }
    }

    const updatePayload = {
      updated_by_email: auth.email,
      updated_at: now,
    };

    if (keyLabel) updatePayload.key_label = keyLabel;
    if (isActive !== null) updatePayload.is_active = isActive;

    const { error: updateError } = await auth.adminClient
      .from("api_keys")
      .update(updatePayload)
      .eq("id", id);

    if (updateError) {
      throw new Error(updateError.message || "Could not update API key.");
    }

    await writeActivityLog(auth.adminClient, request, {
      ...buildActorPayload(auth),
      action_type: "api_key_updated",
      action_label: "API Key Updated",
      area: "API Key Vault",
      target_type: "api_key",
      target_id: id,
      target_label: `${existingKey.key_type === "intercom" ? "Intercom" : "OpenAI"} API Key`,
      status: "success",
      description: "API key metadata/status was updated from Admin.",
      is_sensitive: true,
      safe_before: {
        key_type: existingKey.key_type,
        key_label: existingKey.key_label,
        masked_value: existingKey.masked_value,
        fingerprint: existingKey.fingerprint,
        is_active: existingKey.is_active,
      },
      safe_after: {
        key_label: keyLabel || existingKey.key_label,
        is_active: isActive === null ? existingKey.is_active : isActive,
        updated_by_email: auth.email,
        updated_at: now,
      },
    });

    const keys = await listKeys(auth.adminClient);

    return json({
      ok: true,
      message: "API key updated successfully.",
      keys,
    });
  } catch (error) {
    if (auth?.ok && auth?.adminClient) {
      await writeActivityLog(auth.adminClient, request, {
        ...buildActorPayload(auth),
        action_type: "api_key_update_failed",
        action_label: "API Key Update Failed",
        area: "API Key Vault",
        target_type: "api_key",
        target_id: id || null,
        target_label: existingKey?.key_type ? `${existingKey.key_type} API Key` : "API Key",
        status: "failed",
        description: error instanceof Error ? error.message : "Unknown server error.",
        is_sensitive: true,
      });
    }

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
  let auth = null;
  let id = "";
  let existingKey = null;

  try {
    auth = await requireMasterAdmin(request);

    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    id = normalizeText(searchParams.get("id"));

    if (!id) {
      return json(
        {
          ok: false,
          error: "API key ID is required.",
        },
        { status: 400 }
      );
    }

    const { data: existingData, error: existingError } = await auth.adminClient
      .from("api_keys")
      .select("id, key_type, key_label, masked_value, fingerprint, is_active")
      .eq("id", id)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message || "Could not read API key.");
    }

    existingKey = existingData;

    const now = new Date().toISOString();

    const { error } = await auth.adminClient
      .from("api_keys")
      .update({
        is_active: false,
        updated_by_email: auth.email,
        updated_at: now,
      })
      .eq("id", id);

    if (error) {
      throw new Error(error.message || "Could not deactivate API key.");
    }

    await writeActivityLog(auth.adminClient, request, {
      ...buildActorPayload(auth),
      action_type: "api_key_deactivated",
      action_label: "API Key Deactivated",
      area: "API Key Vault",
      target_type: "api_key",
      target_id: id,
      target_label: existingKey?.key_type
        ? `${existingKey.key_type === "intercom" ? "Intercom" : "OpenAI"} API Key`
        : "API Key",
      status: "success",
      description: "API key was deactivated from Admin.",
      is_sensitive: true,
      safe_before: existingKey
        ? {
            key_type: existingKey.key_type,
            key_label: existingKey.key_label,
            masked_value: existingKey.masked_value,
            fingerprint: existingKey.fingerprint,
            is_active: existingKey.is_active,
          }
        : {},
      safe_after: {
        is_active: false,
        updated_by_email: auth.email,
        updated_at: now,
      },
    });

    const keys = await listKeys(auth.adminClient);

    return json({
      ok: true,
      message: "API key deactivated.",
      keys,
    });
  } catch (error) {
    if (auth?.ok && auth?.adminClient) {
      await writeActivityLog(auth.adminClient, request, {
        ...buildActorPayload(auth),
        action_type: "api_key_deactivate_failed",
        action_label: "API Key Deactivate Failed",
        area: "API Key Vault",
        target_type: "api_key",
        target_id: id || null,
        target_label: existingKey?.key_type ? `${existingKey.key_type} API Key` : "API Key",
        status: "failed",
        description: error instanceof Error ? error.message : "Unknown server error.",
        is_sensitive: true,
      });
    }

    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown server error.",
      },
      { status: 500 }
    );
  }
}
