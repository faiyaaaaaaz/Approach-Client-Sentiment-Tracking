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

function normalizeConversation(item) {
  const conversationId = String(item?.conversationId || item?.id || "").trim();

  return {
    conversationId,
    repliedAt: item?.repliedAt || null,
    csatScore: item?.csatScore ?? "",
    clientEmail: item?.clientEmail || "",
    agentName: item?.agentName || "Unassigned",
  };
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function extractConversationMeta(conversation, fallbackConversation = {}) {
  const parts = Array.isArray(conversation?.conversation_parts?.conversation_parts)
    ? conversation.conversation_parts.conversation_parts
    : [];

  const clientEmail = firstNonEmpty(
    conversation?.contacts?.contacts?.[0]?.email,
    conversation?.source?.author?.email,
    conversation?.author?.email,
    conversation?.user?.email,
    conversation?.customer?.email,
    fallbackConversation?.clientEmail
  );

  let agentName = firstNonEmpty(
    conversation?.assignee?.name,
    conversation?.admin_assignee?.name,
    conversation?.teammate_assignee?.name,
    conversation?.conversation_rating?.teammate?.name
  );

  if (!agentName && parts.length) {
    const adminParts = parts
      .filter((part) =>
        ["admin", "teammate", "team_member"].includes(part?.author?.type)
      )
      .sort((a, b) => (b?.created_at || 0) - (a?.created_at || 0));

    agentName = firstNonEmpty(
      adminParts?.[0]?.author?.name,
      adminParts?.[0]?.author?.email
    );
  }

  if (!agentName) {
    const fallbackAgentName = String(fallbackConversation?.agentName || "").trim();
    if (fallbackAgentName && fallbackAgentName !== "Unassigned") {
      agentName = fallbackAgentName;
    }
  }

  return {
    conversationId: firstNonEmpty(
      conversation?.id,
      fallbackConversation?.conversationId
    ),
    clientEmail,
    agentName: agentName || "Unassigned",
    csatScore:
      conversation?.conversation_rating?.score ??
      conversation?.conversation_rating?.rating ??
      conversation?.conversation_rating?.value ??
      fallbackConversation?.csatScore ??
      "",
    repliedAt:
      conversation?.conversation_rating?.replied_at ||
      conversation?.updated_at ||
      conversation?.created_at ||
      fallbackConversation?.repliedAt ||
      null,
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
    const rawConversations = Array.isArray(body?.conversations)
      ? body.conversations
      : [];
    const limiterEnabled = Boolean(body?.limiterEnabled);
    const requestedLimit = Number(body?.limitCount);

    if (!rawConversations.length) {
      return json(
        {
          ok: false,
          error: "No fetched conversations were provided for audit.",
        },
        { status: 400 }
      );
    }

    const normalizedConversations = rawConversations
      .map(normalizeConversation)
      .filter((item) => item.conversationId);

    if (!normalizedConversations.length) {
      return json(
        {
          ok: false,
          error: "No valid conversation IDs were found in the audit payload.",
        },
        { status: 400 }
      );
    }

    const limitCount = limiterEnabled
      ? Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 5, 50))
      : null;

    const conversationsToAudit = limiterEnabled
      ? normalizedConversations.slice(0, limitCount)
      : normalizedConversations;

    const results = [];

    for (const conversation of conversationsToAudit) {
      try {
        const fullConversation = await fetchFullConversation(
          intercomApiKey,
          conversation.conversationId
        );

        const transcript = buildTranscript(fullConversation);
        const meta = extractConversationMeta(fullConversation, conversation);

        const audit = await runOpenAIAudit({
          openAiApiKey,
          transcript,
          conversationId: meta.conversationId,
        });

        results.push({
          conversationId: meta.conversationId,
          repliedAt: meta.repliedAt,
          csatScore: meta.csatScore,
          clientEmail: meta.clientEmail,
          agentName: meta.agentName,
          aiVerdict: audit.aiVerdict,
          reviewSentiment: audit.reviewSentiment,
          clientSentiment: audit.clientSentiment,
          resolutionStatus: audit.resolutionStatus,
        });
      } catch (error) {
        results.push({
          conversationId: conversation.conversationId,
          repliedAt: conversation.repliedAt,
          csatScore: conversation.csatScore,
          clientEmail: conversation.clientEmail,
          agentName: conversation.agentName,
          error: error instanceof Error ? error.message : "Unknown processing error.",
        });
      }
    }

    return json({
      ok: true,
      message:
        results.length > 0
          ? "Audit completed successfully."
          : "No conversations were available for audit.",
      meta: {
        requestedBy: email,
        receivedCount: normalizedConversations.length,
        auditedCount: results.length,
        limiterEnabled,
        limitCount,
        auditMode: "live_gpt",
        nextStep: "Persist runs and results to Supabase for the Results page.",
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
