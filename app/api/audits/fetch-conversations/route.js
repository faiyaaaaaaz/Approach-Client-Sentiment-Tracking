import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTERCOM_PER_PAGE = 150;
const MAX_FETCH_PAGES_PER_DAY = 50;

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

function canRunAudits(profile) {
  return Boolean(
    profile?.is_active === true &&
      (profile?.role === "master_admin" ||
        profile?.role === "admin" ||
        profile?.can_run_tests === true)
  );
}

function parseDateInput(dateStr) {
  const value = String(dateStr || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Dates must be in YYYY-MM-DD format.");
  }

  const [year, month, day] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    throw new Error("Invalid date provided.");
  }

  return { year, month, day };
}

function enumerateDateRange(startDate, endDate) {
  const start = parseDateInput(startDate);
  const end = parseDateInput(endDate);

  const startUtc = Date.UTC(start.year, start.month - 1, start.day);
  const endUtc = Date.UTC(end.year, end.month - 1, end.day);

  if (startUtc > endUtc) {
    throw new Error("Start date cannot be later than end date.");
  }

  const dates = [];
  let current = new Date(startUtc);

  while (current.getTime() <= endUtc) {
    const y = current.getUTCFullYear();
    const m = String(current.getUTCMonth() + 1).padStart(2, "0");
    const d = String(current.getUTCDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

function dhakaDayBounds(dateStr) {
  const { year, month, day } = parseDateInput(dateStr);

  const start = new Date(
    `${year.toString().padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+06:00`
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return {
    sinceTs: Math.floor(start.getTime() / 1000),
    untilTs: Math.floor(end.getTime() / 1000),
  };
}

function extractConversationPreview(conversation) {
  return {
    conversationId: String(conversation?.id || "").trim(),
    repliedAt:
      conversation?.conversation_rating?.replied_at ||
      conversation?.updated_at ||
      conversation?.created_at ||
      null,
    csatScore:
      conversation?.conversation_rating?.score ??
      conversation?.conversation_rating?.rating ??
      conversation?.conversation_rating?.value ??
      "",
    clientEmail:
      conversation?.contacts?.contacts?.[0]?.email ||
      conversation?.source?.author?.email ||
      conversation?.author?.email ||
      "",
    agentName:
      conversation?.assignee?.name ||
      conversation?.admin_assignee?.name ||
      conversation?.teammate_assignee?.name ||
      conversation?.conversation_rating?.teammate?.name ||
      "Unassigned",
  };
}

async function fetchIntercomSearchPage({
  intercomApiKey,
  sinceTs,
  untilTs,
  startingAfter,
}) {
  const body = {
  query: {
    operator: "AND",
    value: [
      {
        field: "created_at",
        operator: ">",
        value: Number(sinceTs),
      },
      {
        field: "created_at",
        operator: "<",
        value: Number(untilTs),
      },
      {
        field: "conversation_rating.score",
        operator: "IN",
        value: [1, 2],
      },
    ],
  },
  sort: {
    field: "created_at",
    order: "ascending",
  },
  pagination: startingAfter
    ? { per_page: INTERCOM_PER_PAGE, starting_after: startingAfter }
    : { per_page: INTERCOM_PER_PAGE },
};

  const response = await fetch("https://api.intercom.io/conversations/search", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Intercom-Version": "2.12",
      Authorization: `Bearer ${intercomApiKey}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const responseText = await response.text();
  const contentType = response.headers.get("content-type") || "";

  let data = null;
  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch {
    data = null;
  }

  return {
    body,
    status: response.status,
    ok: response.ok,
    contentType,
    responseExcerpt: responseText.slice(0, 1200),
    data,
  };
}

async function fetchConversationsForDay({
  intercomApiKey,
  date,
  limiterEnabled,
  desiredCount,
  seenIds,
}) {
  const { sinceTs, untilTs } = dhakaDayBounds(date);

  const conversations = [];
  const debugPages = [];

  let startingAfter = null;
  let pageCount = 0;

  while (pageCount < MAX_FETCH_PAGES_PER_DAY) {
    const pageResult = await fetchIntercomSearchPage({
  intercomApiKey,
  sinceTs,
  untilTs,
  startingAfter,
});

const pageItems = Array.isArray(pageResult?.data?.conversations)
  ? pageResult.data.conversations
  : [];
const nextCursor = pageResult?.data?.pages?.next?.starting_after ?? null;

debugPages.push({
  request: pageResult.body,
  pageIndex: pageCount + 1,
  httpStatus: pageResult.status,
  ok: pageResult.ok,
  contentType: pageResult.contentType,
  returnedCount: pageItems.length,
  nextCursor,
  sampleIds: pageItems
    .map((item) => String(item?.id || "").trim())
    .filter(Boolean)
    .slice(0, 10),
  responseExcerpt: pageResult.responseExcerpt,
});

    for (const conversation of pageItems) {
      const id = String(conversation?.id || "").trim();
      if (!id || seenIds.has(id)) continue;

      seenIds.add(id);
      conversations.push(extractConversationPreview(conversation));

      if (limiterEnabled && seenIds.size >= desiredCount) {
        return {
          sinceTs,
          untilTs,
          conversations,
          debugPages,
        };
      }
    }

    if (!nextCursor) {
      break;
    }

    startingAfter = nextCursor;
    pageCount += 1;
  }

  return {
    sinceTs,
    untilTs,
    conversations,
    debugPages,
  };
}

export async function POST(request) {
  try {
    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const supabaseAnonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const intercomApiKey = getEnv("INTERCOM_API_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey || !intercomApiKey) {
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

    if (!canRunAudits(profile)) {
      return json(
        {
          ok: false,
          error: "This account does not have permission to run tests.",
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const startDate = String(body?.startDate || "").trim();
    const endDate = String(body?.endDate || "").trim();
    const limiterEnabled = Boolean(body?.limiterEnabled);
    const requestedLimit = Number(body?.limitCount);
    const debug = Boolean(body?.debug);

    if (!startDate || !endDate) {
      return json(
        {
          ok: false,
          error: "Start date and end date are required.",
        },
        { status: 400 }
      );
    }

    const searchedDates = enumerateDateRange(startDate, endDate);
    const desiredCount = limiterEnabled
      ? Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 5, 200))
      : 10000;

    const seenIds = new Set();
    const fetchedConversations = [];
    const dailySummary = [];

    for (const date of searchedDates) {
      const dayResult = await fetchConversationsForDay({
        intercomApiKey,
        date,
        limiterEnabled,
        desiredCount,
        seenIds,
      });

      fetchedConversations.push(...dayResult.conversations);

      dailySummary.push({
        date,
        sinceTs: dayResult.sinceTs,
        untilTs: dayResult.untilTs,
        fetchedCount: dayResult.conversations.length,
        pages: debug ? dayResult.debugPages : undefined,
      });

      if (limiterEnabled && fetchedConversations.length >= desiredCount) {
        break;
      }
    }

    const limitedConversations = limiterEnabled
      ? fetchedConversations.slice(0, desiredCount)
      : fetchedConversations;

    return json({
      ok: true,
      message:
        limitedConversations.length > 0
          ? "Conversations fetched successfully."
          : "No conversations found for the selected date range.",
      meta: {
        startDate,
        endDate,
        limiterEnabled,
        limitCount: limiterEnabled ? desiredCount : null,
        requestedBy: email,
        searchedDates,
        fetchedCount: limitedConversations.length,
      },
      conversations: limitedConversations,
      debug: debug
        ? {
            intercomPerPage: INTERCOM_PER_PAGE,
            maxFetchPagesPerDay: MAX_FETCH_PAGES_PER_DAY,
            dailySummary,
          }
        : undefined,
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
