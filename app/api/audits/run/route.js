import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_MODEL = "gpt-4.1-mini";
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

function stripHtml(input) {
  return String(input || "")
    .replace(/<\/(p|div|br|li|h\d)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+\n/g, "\n\n")
    .trim();
}

function isoFromUnix(unixSeconds) {
  if (!unixSeconds) return "";
  return new Date(unixSeconds * 1000).toISOString();
}

function roleLabel(authorType) {
  if (authorType === "user") return "USER";
  if (["admin", "teammate", "team_member"].includes(authorType)) return "HUMAN_AGENT";
  return authorType === "bot" ? "BOT" : "SYSTEM";
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

function dhakaDayBounds(dateStr) {
  const { year, month, day } = parseDateInput(dateStr);

  const start = new Date(`${year.toString().padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+06:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return {
    sinceTs: Math.floor(start.getTime() / 1000),
    untilTs: Math.floor(end.getTime() / 1000),
  };
}

function enumerateDateRange(startDate, endDate) {
  const start = parseDateInput(startDate);
  const end = parseDateInput(endDate);

  const startUtc = Date.UTC(start.year, start.month - 1, start.day);
  const endUtc = Date.UTC(end.year, end.month - 1, end.day);

  if (startUtc > endUtc) {
    throw new Error("Start date cannot be later than end date.");
  }

  const result = [];
  let current = new Date(startUtc);

  while (current.getTime() <= endUtc) {
    const y = current.getUTCFullYear();
    const m = String(current.getUTCMonth() + 1).padStart(2, "0");
    const d = String(current.getUTCDate()).padStart(2, "0");
    result.push(`${y}-${m}-${d}`);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return result;
}

function extractConversationMeta(conversation) {
  const parts = conversation?.conversation_parts?.conversation_parts || [];

  const clientEmail =
    conversation?.contacts?.contacts?.[0]?.email ||
    conversation?.source?.author?.email ||
    conversation?.author?.email ||
    "";

  let agentName =
    conversation?.assignee?.name ||
    conversation?.admin_assignee?.name ||
    conversation?.teammate_assignee?.name ||
    conversation?.conversation_rating?.teammate?.name ||
    "";

  if (!agentName && Array.isArray(parts)) {
    const adminParts = parts
      .filter((part) => ["admin", "teammate", "team_member"].includes(part?.author?.type))
      .sort((a, b) => (b?.created_at || 0) - (a?.created_at || 0));

    agentName =
      adminParts?.[0]?.author?.name ||
      adminParts?.[0]?.author?.email ||
      "";
  }

  return {
    conversationId: String(conversation?.id || "").trim(),
    clientEmail: String(clientEmail || "").trim(),
    agentName: String(agentName || "Unassigned").trim(),
    csatScore:
      conversation?.conversation_rating?.score ??
      conversation?.conversation_rating?.rating ??
      conversation?.conversation_rating?.value ??
      "",
  };
}

function buildTranscript(conversation) {
  const sourceMessage = conversation?.source?.body
    ? [
        {
          when: isoFromUnix(conversation?.created_at),
          role: roleLabel(conversation?.source?.author?.type),
          name: String(
            conversation?.source?.author?.name ||
              conversation?.source?.author?.email ||
              "unknown"
          ).trim(),
          text: stripHtml(conversation?.source?.body),
        },
      ]
    : [];

  const parts = Array.isArray(conversation?.conversation_parts?.conversation_parts)
    ? conversation.conversation_parts.conversation_parts
    : [];

  const partMessages = parts
    .filter((part) => String(part?.body || "").trim())
    .sort((a, b) => (a?.created_at || 0) - (b?.created_at || 0))
    .map((part) => ({
      when: isoFromUnix(part?.created_at),
      role: roleLabel(part?.author?.type),
      name: String(part?.author?.name || part?.author?.email || "unknown").trim(),
      text: stripHtml(part?.body),
    }));

  const messages = [...sourceMessage, ...partMessages];

  return messages
    .map((message) => `[${message.when}] [${message.role}] (${message.name}): ${message.text}`)
    .join("\n\n");
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
          field: "conversation_rating.replied_at",
          operator: ">",
          value: Number(sinceTs),
        },
        {
          field: "conversation_rating.replied_at",
          operator: "<",
          value: Number(untilTs),
        },
        {
          field: "conversation_rating.score",
          operator: "IN",
          value: [3, 4, 5],
        },
      ],
    },
    sort: {
      field: "conversation_rating.replied_at",
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

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Intercom search failed: ${response.status} ${text}`);
  }

  return response.json();
}

async function fetchIntercomConversationIdsForDay({
  intercomApiKey,
  sinceTs,
  untilTs,
}) {
  const ids = [];
  let startingAfter = null;
  let pageCount = 0;

  while (pageCount < MAX_FETCH_PAGES_PER_DAY) {
    const data = await fetchIntercomSearchPage({
      intercomApiKey,
      sinceTs,
      untilTs,
      startingAfter,
    });

    const conversations = Array.isArray(data?.conversations) ? data.conversations : [];
    ids.push(
      ...conversations
        .map((conversation) => String(conversation?.id || "").trim())
        .filter(Boolean)
    );

    const nextCursor = data?.pages?.next?.starting_after ?? null;
    if (!nextCursor) {
      break;
    }

    startingAfter = nextCursor;
    pageCount += 1;
  }

  return ids;
}

async function fetchFullConversation(intercomApiKey, conversationId) {
  const response = await fetch(`https://api.intercom.io/conversations/${conversationId}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Intercom-Version": "2.12",
      Authorization: `Bearer ${intercomApiKey}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Intercom conversation fetch failed for ${conversationId}: ${response.status} ${text}`
    );
  }

  return response.json();
}

function buildAuditPrompt() {
  return `
You are auditing FundedNext support conversations.

You will receive one conversation transcript.

Return ONLY valid JSON with exactly these keys:
{
  "aiVerdict": "string",
  "reviewSentiment": "Likely Negative Review|Likely Positive Review|Highly Likely Negative Review|Highly Likely Positive Review|Missed Opportunity|Negative Outcome - No Review Request",
  "clientSentiment": "Very Negative|Negative|Slightly Negative|Neutral|Slightly Positive|Positive|Very Positive",
  "resolutionStatus": "Resolved|Unresolved|Pending|Unclear"
}

Rules:
- Keep aiVerdict to one line.
- aiVerdict must be concise and specific.
- Base everything only on the transcript.
- If there is no clear positive resolution and no review request, prefer "Negative Outcome - No Review Request".
- If the client is clearly happy and no review request was sent, use "Missed Opportunity".
- Return JSON only.
`.trim();
}

async function runOpenAIAudit({ openAiApiKey, transcript, conversationId }) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiApiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: buildAuditPrompt(),
        },
        {
          role: "user",
          content: `Conversation ID: ${conversationId}\n\nTranscript:\n${transcript || "(no transcript found)"}`,
        },
      ],
      temperature: 0.1,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI audit failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenAI returned an empty response.");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenAI returned invalid JSON.");
  }

  return {
    aiVerdict: String(parsed?.aiVerdict || "").trim(),
    reviewSentiment: String(parsed?.reviewSentiment || "").trim(),
    clientSentiment: String(parsed?.clientSentiment || "").trim(),
    resolutionStatus: String(parsed?.resolutionStatus || "").trim(),
  };
}

export async function POST(request) {
  try {
    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const supabaseAnonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const intercomApiKey = getEnv("INTERCOM_API_KEY");
    const openAiApiKey = getEnv("OPENAI_API_KEY");

    if (
      !supabaseUrl ||
      !supabaseAnonKey ||
      !supabaseServiceRoleKey ||
      !intercomApiKey ||
      !openAiApiKey
    ) {
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
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
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

    if (!startDate || !endDate) {
      return json(
        {
          ok: false,
          error: "Start date and end date are required.",
        },
        { status: 400 }
      );
    }

    const dates = enumerateDateRange(startDate, endDate);

    const desiredCount = limiterEnabled
      ? Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 5, 50))
      : 200;

    const uniqueIds = [];
    const seenIds = new Set();

    for (const day of dates) {
      const { sinceTs, untilTs } = dhakaDayBounds(day);
      const idsForDay = await fetchIntercomConversationIdsForDay({
        intercomApiKey,
        sinceTs,
        untilTs,
      });

      for (const id of idsForDay) {
        if (!seenIds.has(id)) {
          seenIds.add(id);
          uniqueIds.push(id);
        }
      }

      if (limiterEnabled && uniqueIds.length >= desiredCount) {
        break;
      }
    }

    const idsToProcess = limiterEnabled ? uniqueIds.slice(0, desiredCount) : uniqueIds;

    if (idsToProcess.length === 0) {
      return json({
        ok: true,
        message: "No conversations found for the selected date range.",
        meta: {
          startDate,
          endDate,
          limiterEnabled,
          limitCount: desiredCount,
          requestedBy: email,
          searchedDates: dates,
          processedCount: 0,
        },
        results: [],
      });
    }

    const results = [];

    for (const conversationId of idsToProcess) {
      try {
        const conversation = await fetchFullConversation(intercomApiKey, conversationId);
        const transcript = buildTranscript(conversation);
        const meta = extractConversationMeta(conversation);

        const audit = await runOpenAIAudit({
          openAiApiKey,
          transcript,
          conversationId: meta.conversationId,
        });

        results.push({
          conversationId: meta.conversationId,
          clientEmail: meta.clientEmail,
          agentName: meta.agentName,
          csatScore: meta.csatScore,
          aiVerdict: audit.aiVerdict,
          reviewSentiment: audit.reviewSentiment,
          clientSentiment: audit.clientSentiment,
          resolutionStatus: audit.resolutionStatus,
        });
      } catch (error) {
        results.push({
          conversationId,
          error: error instanceof Error ? error.message : "Unknown processing error.",
        });
      }
    }

    return json({
      ok: true,
      message: "Limited audit run completed.",
      meta: {
        startDate,
        endDate,
        limiterEnabled,
        limitCount: desiredCount,
        requestedBy: email,
        searchedDates: dates,
        fetchedConversationCount: uniqueIds.length,
        processedCount: results.length,
      },
      results,
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
