import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MASTER_ADMIN_EMAIL = "faiyaz@nextventures.io";

const ROLE_KEYS = ["master_admin", "supervisor_admin", "co_admin", "audit_runner", "viewer"];

const PERMISSION_CATALOG = [
  { key: "page_dashboard", label: "View Dashboard", group: "Page Access", ownerLocked: true },
  { key: "page_results", label: "View Results", group: "Page Access" },
  { key: "page_run_audit", label: "Access Run Audit", group: "Page Access" },
  { key: "page_admin", label: "Access Admin", group: "Page Access" },

  { key: "audit_fetch_conversations", label: "Fetch Conversations", group: "Audit Operations" },
  { key: "audit_run_ai", label: "Run AI Audit", group: "Audit Operations" },
  { key: "audit_specific_rerun", label: "Specific Conversation Rerun", group: "Audit Operations" },
  { key: "audit_bulk_run", label: "Bulk Audit", group: "Audit Operations" },

  { key: "results_view_all", label: "View All Results", group: "Results & Verdicts" },
  { key: "results_view_team", label: "View Team Results", group: "Results & Verdicts" },
  { key: "results_view_own", label: "View Own Results", group: "Results & Verdicts" },
  { key: "results_edit_verdict", label: "Edit AI Verdict", group: "Results & Verdicts" },
  { key: "results_delete", label: "Delete Results", group: "Results & Verdicts" },
  { key: "results_export", label: "Export Results", group: "Results & Verdicts" },

  { key: "disputes_submit_own", label: "Submit Own Dispute", group: "Disputes" },
  { key: "disputes_submit_team", label: "Submit Team Dispute", group: "Disputes" },
  { key: "disputes_submit_any", label: "Submit Any Dispute", group: "Disputes" },
  { key: "admin_disputes", label: "View Dispute Management", group: "Disputes" },
  { key: "disputes_review", label: "Approve / Reject Disputes", group: "Disputes" },

  { key: "admin_snippets", label: "View Calibration Snippets", group: "Calibration" },
  { key: "snippets_create", label: "Create Snippets", group: "Calibration" },
  { key: "snippets_generate", label: "Generate Snippets From Disputes", group: "Calibration" },
  { key: "snippets_activate", label: "Activate / Deactivate Snippets", group: "Calibration" },
  { key: "snippets_delete", label: "Delete Snippets", group: "Calibration" },

  { key: "admin_prompt", label: "Manage Live Prompt", group: "Admin Configuration" },
  { key: "admin_api_vault", label: "Manage API Vault", group: "Admin Configuration", ownerLocked: true },
  { key: "admin_mappings", label: "Manage Agent Mappings", group: "Admin Configuration" },
  { key: "admin_supervisor_teams", label: "Manage Supervisor Teams", group: "Admin Configuration" },
  { key: "admin_roles", label: "Manage Roles & Permissions", group: "Admin Configuration", ownerLocked: true },

  { key: "admin_activity_logs", label: "View Activity Logs", group: "Monitoring" },
  { key: "activity_export", label: "Export Activity Logs", group: "Monitoring" },
  { key: "activity_sessions", label: "View Recent Sessions", group: "Monitoring" },
];

const DEFAULT_ROLE_PERMISSIONS = {
  master_admin: {
    page_dashboard: true,
    page_results: true,
    page_run_audit: true,
    page_admin: true,
    audit_fetch_conversations: true,
    audit_run_ai: true,
    audit_specific_rerun: true,
    audit_bulk_run: true,
    results_view_all: true,
    results_edit_verdict: true,
    results_delete: true,
    results_export: true,
    disputes_submit_any: true,
    admin_disputes: true,
    disputes_review: true,
    admin_snippets: true,
    snippets_create: true,
    snippets_generate: true,
    snippets_activate: true,
    snippets_delete: true,
    admin_prompt: true,
    admin_supervisor_teams: true,
    admin_mappings: true,
    admin_activity_logs: true,
    activity_export: true,
    activity_sessions: true,
    admin_roles: false,
    admin_api_vault: false,
  },
  supervisor_admin: {
    page_dashboard: true,
    page_results: true,
    page_run_audit: false,
    page_admin: false,
    results_view_team: true,
    results_view_own: true,
    disputes_submit_team: true,
    disputes_submit_own: true,
  },
  co_admin: {
    page_dashboard: true,
    page_results: true,
    page_run_audit: false,
    page_admin: true,
    audit_fetch_conversations: false,
    audit_run_ai: false,
    results_view_all: true,
    disputes_submit_any: true,
    admin_prompt: true,
    admin_supervisor_teams: true,
    admin_mappings: true,
    admin_disputes: false,
    admin_snippets: false,
    admin_activity_logs: false,
    admin_roles: false,
    admin_api_vault: false,
  },
  audit_runner: {
    page_dashboard: true,
    page_results: true,
    page_run_audit: true,
    page_admin: false,
    audit_fetch_conversations: true,
    audit_run_ai: true,
    audit_specific_rerun: true,
    audit_bulk_run: true,
    results_view_all: true,
    results_export: true,
    disputes_submit_own: true,
  },
  viewer: {
    page_dashboard: true,
    page_results: true,
    page_run_audit: false,
    page_admin: false,
    results_view_own: true,
    disputes_submit_own: true,
  },
};

const OWNER_PERMISSIONS = Object.fromEntries(PERMISSION_CATALOG.map((item) => [item.key, true]));

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

function getRequestMeta(request) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  return {
    request_path: new URL(request.url).pathname,
    ip_address: forwardedFor.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null,
    user_agent: request.headers.get("user-agent") || null,
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
      area: normalizeText(payload.area) || "Admin",
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
    });
  } catch (error) {
    console.warn("[activity-log] role permission log failed", error);
  }
}

function actorNameFor(user, email) {
  return (
    normalizeText(user?.user_metadata?.full_name) ||
    normalizeText(user?.user_metadata?.name) ||
    email
  );
}

async function getAuthContext(request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";

  if (!token) {
    return { ok: false, response: json({ ok: false, error: "Missing access token." }, { status: 401 }) };
  }

  const { authClient, adminClient } = getSupabaseClients();
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser(token);

  if (userError || !user) {
    return { ok: false, response: json({ ok: false, error: "Invalid or expired session." }, { status: 401 }) };
  }

  const email = normalizeEmail(user.email);

  if (!email.endsWith("@nextventures.io")) {
    return { ok: false, response: json({ ok: false, error: "Only nextventures.io accounts are allowed." }, { status: 403 }) };
  }

  const { data: profileRows } = await adminClient
    .from("profiles")
    .select("role, is_active, full_name")
    .ilike("email", email)
    .limit(1);

  const profile = Array.isArray(profileRows) && profileRows.length ? profileRows[0] : null;
  const role = email === MASTER_ADMIN_EMAIL ? "platform_owner" : normalizeText(profile?.role || "viewer").toLowerCase();

  return {
    ok: true,
    user,
    email,
    role,
    isOwner: email === MASTER_ADMIN_EMAIL,
    isMaster: email === MASTER_ADMIN_EMAIL || role === "master_admin",
    adminClient,
  };
}

function cleanPermissionSet(roleKey, permissions) {
  const defaults = DEFAULT_ROLE_PERMISSIONS[roleKey] || DEFAULT_ROLE_PERMISSIONS.viewer;
  const next = { ...defaults };
  const allowedKeys = new Set(PERMISSION_CATALOG.map((item) => item.key));

  for (const [key, value] of Object.entries(permissions || {})) {
    if (allowedKeys.has(key)) next[key] = Boolean(value);
  }

  if (roleKey === "master_admin") {
    next.admin_roles = false;
    next.admin_api_vault = false;
  }

  return next;
}

async function readPermissionMatrix(adminClient) {
  const { data, error } = await adminClient
    .from("role_permission_matrix")
    .select("role_key, permissions, updated_at, updated_by_email")
    .order("role_key", { ascending: true });

  if (error) {
    throw new Error(error.message || "Could not load role permissions.");
  }

  const rowsByRole = Object.fromEntries((Array.isArray(data) ? data : []).map((row) => [row.role_key, row]));

  return ROLE_KEYS.map((roleKey) => {
    const row = rowsByRole[roleKey];
    return {
      role_key: roleKey,
      permissions: cleanPermissionSet(roleKey, row?.permissions || DEFAULT_ROLE_PERMISSIONS[roleKey] || {}),
      updated_at: row?.updated_at || null,
      updated_by_email: row?.updated_by_email || null,
      locked: roleKey === "master_admin" ? ["admin_roles", "admin_api_vault"] : [],
    };
  });
}

export async function GET(request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth.ok) return auth.response;

    if (!auth.isMaster) {
      return json({ ok: false, error: "Only Master Admins can view the permission matrix." }, { status: 403 });
    }

    const matrix = await readPermissionMatrix(auth.adminClient);

    return json({
      ok: true,
      owner_email: MASTER_ADMIN_EMAIL,
      editable: auth.isOwner,
      catalog: PERMISSION_CATALOG,
      roles: matrix,
      owner_permissions: OWNER_PERMISSIONS,
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Unknown server error." }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth.ok) return auth.response;

    if (!auth.isOwner) {
      return json({ ok: false, error: "Only the Platform Owner can change role permissions." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const roles = Array.isArray(body?.roles) ? body.roles : [];

    if (!roles.length) {
      return json({ ok: false, error: "No role permission rows were provided." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const payload = [];

    for (const row of roles) {
      const roleKey = normalizeText(row?.role_key).toLowerCase();
      if (!ROLE_KEYS.includes(roleKey)) continue;

      payload.push({
        role_key: roleKey,
        permissions: cleanPermissionSet(roleKey, row?.permissions || {}),
        updated_by_email: auth.email,
        updated_at: now,
      });
    }

    if (!payload.length) {
      return json({ ok: false, error: "No valid role permission rows were provided." }, { status: 400 });
    }

    const { error } = await auth.adminClient
      .from("role_permission_matrix")
      .upsert(payload, { onConflict: "role_key" });

    if (error) {
      throw new Error(error.message || "Could not save role permissions.");
    }

    await writeActivityLog(auth.adminClient, request, {
      actor_user_id: auth.user.id,
      actor_email: auth.email,
      actor_name: actorNameFor(auth.user, auth.email),
      actor_role: "platform_owner",
      action_type: "role_permissions_saved",
      action_label: "Role Permissions Saved",
      area: "Admin",
      target_type: "Role Permission Matrix",
      target_label: "Role Permissions",
      status: "success",
      is_sensitive: true,
      description: `${auth.email} updated the role permission matrix.`,
      safe_after: { role_count: payload.length },
    });

    const matrix = await readPermissionMatrix(auth.adminClient);

    return json({
      ok: true,
      message: "Role permissions saved. Users may need to refresh to receive updated sidebar access.",
      owner_email: MASTER_ADMIN_EMAIL,
      editable: true,
      catalog: PERMISSION_CATALOG,
      roles: matrix,
      owner_permissions: OWNER_PERMISSIONS,
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Unknown server error." }, { status: 500 });
  }
}
