import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function buildFallbackProfile(user) {
  const email = String(user?.email || "").toLowerCase();

  if (email === "faiyaz@nextventures.io") {
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

function canReadResults(profile) {
  return Boolean(
    profile?.is_active === true &&
      (profile?.role === "master_admin" ||
        profile?.role === "admin" ||
        profile?.can_run_tests === true)
  );
}

export async function GET(request) {
  try {
    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const supabaseAnonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return json(
        {
          ok: false,
          error: "Missing required environment variables.",
        },
        { status: 500 }
      );
    }

    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";

    if (!token) {
      return json(
        {
          ok: false,
          error: "Missing access token.",
        },
        { status: 401 }
      );
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(token);

    if (userError || !user) {
      return json(
        {
          ok: false,
          error: "Invalid or expired session.",
        },
        { status: 401 }
      );
    }

    const email = String(user.email || "").toLowerCase();
    const domain = email.split("@")[1] || "";

    if (domain !== "nextventures.io") {
      return json(
        {
          ok: false,
          error: "Only nextventures.io accounts are allowed.",
        },
        { status: 403 }
      );
    }

    const { data: profileData } = await adminClient
      .from("profiles")
      .select("id, email, full_name, role, can_run_tests, is_active")
      .eq("id", user.id)
      .maybeSingle();

    const profile = profileData || buildFallbackProfile(user);

    if (!canReadResults(profile)) {
      return json(
        {
          ok: false,
          error: "This account does not have permission to view stored results.",
        },
        { status: 403 }
      );
    }

    const [runsResponse, resultsResponse] = await Promise.all([
      adminClient
        .from("audit_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500),
      adminClient
        .from("audit_results")
        .select("*")
        .order("replied_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5000),
    ]);

    if (runsResponse.error) {
      throw new Error(runsResponse.error.message || "Could not load audit runs.");
    }

    if (resultsResponse.error) {
      throw new Error(resultsResponse.error.message || "Could not load audit results.");
    }

    return json({
      ok: true,
      runs: Array.isArray(runsResponse.data) ? runsResponse.data : [],
      results: Array.isArray(resultsResponse.data) ? resultsResponse.data : [],
      meta: {
        requestedBy: email,
        runsCount: Array.isArray(runsResponse.data) ? runsResponse.data.length : 0,
        resultsCount: Array.isArray(resultsResponse.data) ? resultsResponse.data.length : 0,
        source: "server_api_results_route",
      },
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
