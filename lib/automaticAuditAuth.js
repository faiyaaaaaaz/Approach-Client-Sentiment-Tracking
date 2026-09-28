import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";

export function isAutomaticWorker(request) {
  const secret = String(process.env.AUTOMATIC_AUDIT_SECRET || "");
  const supplied = String(request.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (secret.length < 32 || supplied.length !== secret.length || request.headers.get("x-automatic-audit") !== "1") return false;
  const expected = Buffer.from(secret);
  const received = Buffer.from(supplied);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function automaticAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Database connection is not configured. Check the Supabase environment variables in Vercel.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function automaticWorkerIdentity(request) {
  if (!isAutomaticWorker(request)) return null;
  const adminClient = automaticAdminClient();
  const email = String(process.env.PLATFORM_OWNER_EMAIL || "").trim().toLowerCase();
  if (!email) throw new Error("PLATFORM_OWNER_EMAIL is missing. Set it to the platform owner's account email in Vercel.");
  const { data: profile, error } = await adminClient.from("profiles").select("id,email,full_name,is_active").ilike("email", email).limit(1).maybeSingle();
  if (error) throw new Error("Could not load the automatic audit owner: " + error.message);
  if (!profile?.id || profile.is_active === false) throw new Error("The platform owner needs an active saved profile. Sign in once as the owner before enabling automatic audits.");
  return { user: { id: profile.id, email, user_metadata: { full_name: "Automatic Audit" } }, adminClient };
}

export async function requireAutomaticAuditOwner(request) {
  const client = automaticAdminClient();
  const token = String(request.headers.get("authorization") || "").replace(/^Bearer /, "");
  const { data, error } = await client.auth.getUser(token);
  const owner = String(process.env.PLATFORM_OWNER_EMAIL || "").trim().toLowerCase();
  if (error || !data?.user || !owner || data.user.email?.toLowerCase() !== owner) {
    const denied = new Error("Only the platform owner can view or manage automatic audit runs.");
    denied.status = 403;
    throw denied;
  }
  return client;
}
