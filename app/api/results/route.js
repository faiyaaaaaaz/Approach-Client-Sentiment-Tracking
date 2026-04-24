import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE_SIZE = 1000;
const MAX_RESULT_ROWS = 50000;
const MAX_RUN_ROWS = 10000;

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
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

function uniqueValues(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function chunkArray(items, size = 500) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function toTime(value) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function sortResultsForArchive(rows) {
  return [...(rows || [])].sort((a, b) => {
    const bSavedAt = toTime(b?.created_at);
    const aSavedAt = toTime(a?.created_at);

    if (bSavedAt !== aSavedAt) return bSavedAt - aSavedAt;

    const bReplyAt = toTime(b?.replied_at);
    const aReplyAt = toTime(a?.replied_at);

    return bReplyAt - aReplyAt;
  });
}

async function fetchAllAuditResults(adminClient) {
  const allRows = [];
  let from = 0;

  while (from < MAX_RESULT_ROWS) {
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await adminClient
      .from("audit_results")
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(error.message || "Could not load audit results.");
    }

    const rows = Array.isArray(data) ? data : [];
    allRows.push(...rows);

    if (rows.length < PAGE_SIZE) break;

    from += PAGE_SIZE;
  }

  return allRows;
}

async function fetchRunsForResults(adminClient, results) {
  const runIds = uniqueValues((results || []).map((row) => row?.run_id));

  if (!runIds.length) return [];

  const allRuns = [];

  for (const chunk of chunkArray(runIds, 500)) {
    const { data, error } = await adminClient
      .from("audit_runs")
      .select("*")
      .in("id", chunk)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message || "Could not load audit runs.");
    }

    allRuns.push(...(Array.isArray(data) ? data : []));
  }

  return allRuns
    .sort((a, b) => toTime(b?.created_at) - toTime(a?.created_at))
    .slice(0, MAX_RUN_ROWS);
}

async function countTableRows(adminClient, tableName) {
  const { count, error } = await adminClient
    .from(tableName)
    .select("id", { count: "exact", head: true });

  if (error) return null;

  return Number.isFinite(count) ? count : null;
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
          error: "Missing required Supabase environment variables.",
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

    const [totalResultsCount, rawResults] = await Promise.all([
      countTableRows(adminClient, "audit_results"),
      fetchAllAuditResults(adminClient),
    ]);

    const results = sortResultsForArchive(rawResults);
    const runs = await fetchRunsForResults(adminClient, results);

    const uniqueConversationCount = uniqueValues(
      results.map((row) => row?.conversation_id)
    ).length;

    return json({
      ok: true,
      runs,
      results,
      meta: {
        requestedBy: email,
        runsCount: runs.length,
        resultsCount: results.length,
        uniqueConversationCount,
        totalResultsCount,
        resultRowsReturnedCap: MAX_RESULT_ROWS,
        truncated:
          typeof totalResultsCount === "number"
            ? results.length < totalResultsCount
            : results.length >= MAX_RESULT_ROWS,
        source: "server_api_results_route_paginated",
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
