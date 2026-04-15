import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_MODEL = "gpt-4.1-mini";

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
  if (authorType === "bot") return "BOT";
  return "SYSTEM";
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

function toUnixRange(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T23:59:59.999Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid start or end date.");
  }

  if (start > end) {
    throw new Error("Start date cannot be later than end date.");
  }

  return {
    sinceTs: Math.floor(start.getTime() / 1000),
    untilTs: Math.floor(end.getTime() / 1000),
  };
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
    .map((message) => {
      return `[${message.when}] [${message.role}] (${message.name}): ${message.text}`;
    })
    .join("\n\n");
}

async function fetchIntercomConversationIds({
  intercomApiKey,
  sinceTs,
  untilTs,
  perPage,
}) {
  const response = await fetch("https://api.intercom.io/conversations/search", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Intercom-Version": "2.12",
      Authorization: `Bearer ${intercomApiKey}`,
    },
    body: JSON.stringify({
      query: {
        operator: "AND",
        value: [
          {
            field: "created_at",
            operator: ">",
            value: sinceTs,
          },
          {
            field: "created_at",
            operator: "<",
            value: untilTs,
          },
        ],
      },
      sort: {
        field: "created_at",
        order: "descending",
      },
      pagination: {
        per_page: perPage,
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Intercom search failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const conversations = Array.isArray(data?.conversations) ? data.conversations : [];

  return conversations
    .map((conversation) => String(conversation?.id || "").trim())
    .filter(Boolean);
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
    throw new Error(`Intercom conversation fetch failed for ${conversationId}: ${response.status} ${text}`);
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

    const { sinceTs, untilTs } = toUnixRange(startDate, endDate);

    const limitCount = limiterEnabled
      ? Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 3, 10))
      : 10;

    const conversationIds = await fetchIntercomConversationIds({
      intercomApiKey,
      sinceTs,
      untilTs,
      perPage: limitCount,
    });

    if (conversationIds.length === 0) {
      return json({
        ok: true,
        message: "No conversations found for the selected date range.",
        meta: {
          startDate,
          endDate,
          limiterEnabled,
          limitCount,
          requestedBy: email,
        },
        results: [],
      });
    }

    const results = [];

    for (const conversationId of conversationIds.slice(0, limitCount)) {
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
        limitCount,
        requestedBy: email,
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
