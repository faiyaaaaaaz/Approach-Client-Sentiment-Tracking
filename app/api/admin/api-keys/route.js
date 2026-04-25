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
  try {
    const auth = await requireMasterAdmin(request);

    if (!auth.ok) return auth.response;

    const body = await request.json();

    const keyType = normalizeText(body?.keyType || body?.key_type).toLowerCase();
    const keyLabel = normalizeText(body?.keyLabel || body?.key_label) || "Primary key";
    const secretValue = normalizeText(body?.secretValue || body?.secret_value);
    const makeActive = body?.makeActive !== false;

    if (!ALLOWED_KEY_TYPES.includes(keyType)) {
      return json(
        {
          ok: false,
          error: "Invalid key type. Use intercom or openai.",
        },
        { status: 400 }
      );
    }

    if (!secretValue) {
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

    const keys = await listKeys(auth.adminClient);

    return json({
      ok: true,
      message: `${keyType === "intercom" ? "Intercom" : "OpenAI"} API key saved successfully.`,
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

export async function PATCH(request) {
  try {
    const auth = await requireMasterAdmin(request);

    if (!auth.ok) return auth.response;

    const body = await request.json();

    const id = normalizeText(body?.id);
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

    const { data: existingKey, error: existingError } = await auth.adminClient
      .from("api_keys")
      .select("id, key_type")
      .eq("id", id)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message || "Could not read API key.");
    }

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

    const keys = await listKeys(auth.adminClient);

    return json({
      ok: true,
      message: "API key updated successfully.",
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

export async function DELETE(request) {
  try {
    const auth = await requireMasterAdmin(request);

    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const id = normalizeText(searchParams.get("id"));

    if (!id) {
      return json(
        {
          ok: false,
          error: "API key ID is required.",
        },
        { status: 400 }
      );
    }

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

    const keys = await listKeys(auth.adminClient);

    return json({
      ok: true,
      message: "API key deactivated.",
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
