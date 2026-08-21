import { createClient } from "@supabase/supabase-js";
import { buildPermissionsForRole, isPlatformOwnerEmail, readRolePermissionRows } from "./permissionRules";

function env(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

export function normalizeServerEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function createServerClients() {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  return {
    authClient: createClient(url, env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false } }),
    adminClient: createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } }),
  };
}

export async function authenticateServerRequest(request) {
  const token = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "Missing access token." };

  const { authClient, adminClient } = createServerClients();
  const { data: { user }, error: userError } = await authClient.auth.getUser(token);
  if (userError || !user) return { ok: false, status: 401, error: "Invalid or expired session." };

  const email = normalizeServerEmail(user.email);
  if (!email.endsWith("@nextventures.io")) return { ok: false, status: 403, error: "Only nextventures.io accounts are allowed." };

  const [{ data: profile }, { data: grant }, permissionRows] = await Promise.all([
    adminClient.from("profiles").select("id,email,full_name,role,is_active").or(`id.eq.${user.id},email.eq.${email}`).maybeSingle(),
    adminClient.from("user_role_grants").select("email,full_name,role,is_active").ilike("email", email).eq("is_active", true).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    readRolePermissionRows(adminClient),
  ]);

  const owner = isPlatformOwnerEmail(email);
  const role = owner ? "master_admin" : grant?.role || profile?.role || "viewer";
  const isActive = owner ? true : grant ? grant.is_active !== false : profile?.is_active !== false;
  if (!isActive) return { ok: false, status: 403, error: "This account is not active." };

  return {
    ok: true,
    adminClient,
    user,
    email,
    role,
    profile: { ...(profile || {}), email, role, is_active: true, full_name: grant?.full_name || profile?.full_name || user.user_metadata?.full_name || email },
    permissions: buildPermissionsForRole(email, role, permissionRows),
    canViewAllEngagement: owner || ["master_admin", "supervisor_admin", "co_admin", "admin"].includes(role),
  };
}
