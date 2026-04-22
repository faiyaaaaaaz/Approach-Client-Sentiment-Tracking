import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_MODEL = "gpt-4.1-mini";
const PROMPT_KEY = "audit_review_prompt";

const FALLBACK_AUDIT_PROMPT = `You are auditing FundedNext support conversations.

You will receive ONE conversation at a time.
The input includes:
- ConversationId
- HasHumanAgent
- Transcript with timestamps, roles, and message text

Role legend:
- [USER] = client/customer
- [BOT] = automation
- [HUMAN_AGENT] = human support agent
- [SYSTEM] = system event

Your job is to analyze the conversation and return exactly one JSON object.

--------------------------------------------------
TASK 1: REVIEW SENTIMENT
--------------------------------------------------

Before choosing reviewSentiment, first determine whether the agent actually sent a review request link.
If no review request link was sent, you must not use:
- Likely Negative Review
- Likely Positive Review
- Highly Likely Negative Review
- Highly Likely Positive Review
Use only:
- Missed Opportunity
- Negative Outcome - No Review Request

Classify the likely review outcome using exactly one of these 6 values:

1. Likely Negative Review
Use this when:
- the client’s issue was not resolved, not resolved properly, or still pending, and the agent sent a review request link
- the client may be dissatisfied, disappointed, unconvinced, or still waiting, and the agent sent a review request link
- the client was negative, but not strongly negative, and the agent sent a review request link

2. Likely Positive Review
Use this when:
- the client’s issue or query was resolved, and the agent sent a review request link
- the conversation ended in the client’s favor, and the agent sent a review request link
- the client was positive, but not strongly positive, and the agent sent a review request link

3. Highly Likely Negative Review
Use this when:
- the client showed strong frustration, anger, repeated dissatisfaction, or clearly negative emotion, and the agent sent a review request link
- the issue was unresolved, poorly handled, or still causing negative feeling, and the agent sent a review request link
- the client’s emotional tone was strongly negative and the agent still sent a review request link

4. Highly Likely Positive Review
Use this when:
- the client showed clear genuine satisfaction, strong appreciation, happiness, praise, or explicitly positive intent, and the agent sent a review request link
- examples include:
  - “Awesome, thank you so much”
  - “Perfect, that solved it”
  - “Great support”
  - “Sure, I will leave a review”
  - “You were very helpful”

5. Missed Opportunity
Use this when:
- the client showed genuine satisfaction or clearly positive sentiment, and the agent did NOT send a review request link
- the conversation ended very favorably with positive emotions from the client, and the agent did NOT send a review request link
- this was a clear chance to ask for a review, and the agent did NOT send a review request link

6. Negative Outcome - No Review Request
Use this when:
- the client’s issue was unresolved, still pending, escalated, or poorly handled, and the agent did NOT send a review request link
- the client ended frustrated, disappointed, confused, or negative, and the agent did NOT send a review request link
- the conversation did not end favorably, and the agent did NOT send a review request link

--------------------------------------------------
REVIEW REQUEST DETECTION RULES
--------------------------------------------------

A review request is present if the agent:
- shares one of these links:
  1) https://www.trustpilot.com/review/fundednext.com
  2) https://www.sitejabber.com/requested-review?biz_id=62357d8fdf98d
  3) https://propfirmmatch.com/reviews
- or clearly asks for a public review using phrases such as:
  - "Please leave us a review"
  - "Rate us on Trustpilot"
  - "Share your feedback publicly"
  - "Kindly leave a review"
  - "Please review us on Trustpilot / Sitejabber / Propfirmmatch"

Important distinction:
- If the agent sent a review request link, do NOT use Missed Opportunity or Negative Outcome - No Review Request.
- If the agent did NOT send a review request link, do NOT use Likely Positive Review, Likely Negative Review, Highly Likely Positive Review, or Highly Likely Negative Review.
- If the agent did NOT send a review request link and the outcome was favorable with genuine positive client sentiment, use Missed Opportunity.
- If the agent did NOT send a review request link and the outcome was unresolved, pending, escalated, unclear, or negative, use Negative Outcome - No Review Request.
- If the agent sent a review request link too early, while the client was still waiting, frustrated, unresolved, confused, upset, disappointed, or not clearly satisfied, use Likely Negative Review or Highly Likely Negative Review depending on intensity.
- If the issue may have been handled but the client did not clearly confirm successful resolution in their own words, and no review request link was sent, use Negative Outcome - No Review Request.

--------------------------------------------------
TASK 2: CLIENT SENTIMENT
--------------------------------------------------

Classify the client’s overall sentiment using exactly one of these 7 values:

- Very Negative
- Negative
- Slightly Negative
- Neutral
- Slightly Positive
- Positive
- Very Positive

How to choose:
- focus on the client’s overall emotional tone, especially near the end
- if the client starts negative but ends genuinely satisfied, lean positive
- if the client stays unhappy, disappointed, angry, or frustrated, lean negative
- if the client shows little emotion and is mostly factual, use Neutral
- use Very Positive only for strong, clear satisfaction, praise, warmth, or gratitude
- use Very Negative only for strong frustration, anger, repeated complaints, or sharp dissatisfaction

--------------------------------------------------
IMPORTANT INTERPRETATION RULES
--------------------------------------------------

1. Genuine satisfaction matters
Treat these as strong positive signals when the context supports full resolution:
- “Awesome”
- “Perfect”
- “Great”
- “That worked”
- “It’s solved now”
- “Thank you so much”
- “Really appreciate it”
- “You helped a lot”
- “Sure, I’ll leave a review”

2. Weak closing words are NOT enough on their own
Do NOT treat these alone as proof of satisfaction:
- “ok”
- “okay”
- “thanks”
- “fine”
- “alright”
- “noted”

These can be neutral, polite, or even reluctant.

3. Resolved in client’s favor
This usually means:
- the issue was fixed
- the requested information was successfully provided
- the problem was addressed clearly and completely
- the client acknowledged the successful outcome

4. Unresolved / pending situations
These include:
- client still waiting
- escalation pending
- callback promised
- another team will handle it later
- verification/payment/problem still not completed
- vague promise without actual resolution

5. No human handling cases
If the conversation was assigned but the human agent did not actually contribute meaningful support:
- reviewSentiment should reflect whether a review request was sent and whether the outcome was favorable or not
- clientSentiment should still reflect the client’s emotion.

--------------------------------------------------
TASK 3: RESOLUTION STATUS
--------------------------------------------------

Classify the conversation using exactly one of these 4 values:

- Resolved
- Unresolved
- Pending
- Unclear

Definitions:

Resolved:
The client's question or concern was addressed, even if they did not like the answer.

Unresolved:
The client's question or concern was not addressed.
If the client asked multiple questions and even one was left unaddressed, use Unresolved.

Pending:
The client's concern or issue was pending.
The client was told to wait, or the matter was still in progress.

Unclear:
The client went silent and did not confirm whether the issue was solved.
Use this when the final outcome cannot be confirmed from the conversation.

--------------------------------------------------
OUTPUT RULES
--------------------------------------------------

Return ONLY valid JSON.
Do not add markdown.
Do not add explanation outside JSON.

aiVerdict rules:
- MUST be exactly one single line
- maximum 35 words
- MUST include all 3 parts in this exact structure:

"<review verdict>; Client Sentiment: <sentiment>; Resolution Status: <resolution> because <reason>"

Return exactly this structure:

{
  "conversationId": "...",
  "aiVerdict": "...",
  "reviewSentiment": "Likely Negative Review|Likely Positive Review|Highly Likely Negative Review|Highly Likely Positive Review|Missed Opportunity|Negative Outcome - No Review Request",
  "clientSentiment": "Very Negative|Negative|Slightly Negative|Neutral|Slightly Positive|Positive|Very Positive",
  "resolutionStatus": "Resolved|Unresolved|Pending|Unclear"
}`;

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
    .map(
      (message) =>
        `[${message.when}] [${message.role}] (${message.name}): ${message.text}`
    )
    .join("\n\n");
}

function normalizeTimestampForDb(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1000000000000) return new Date(value).toISOString();
    if (value > 1000000000) return new Date(value * 1000).toISOString();
  }

  const numeric = Number(String(value).trim());
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric > 1000000000000) return new Date(numeric).toISOString();
    if (numeric > 1000000000) return new Date(numeric * 1000).toISOString();
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return null;
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

async function loadLiveAuditPrompt(adminClient) {
  const { data, error } = await adminClient
    .from("admin_prompt_configs")
    .select("live_prompt")
    .eq("prompt_key", PROMPT_KEY)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01") {
      return FALLBACK_AUDIT_PROMPT;
    }
    throw new Error(error.message || "Could not load live audit prompt.");
  }

  const livePrompt = String(data?.live_prompt || "").trim();
  return livePrompt || FALLBACK_AUDIT_PROMPT;
}

async function runOpenAIAudit({
  openAiApiKey,
  transcript,
  conversationId,
  auditPrompt,
}) {
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
        { role: "system", content: auditPrompt },
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

async function persistAuditRunAndResults({
  adminClient,
  user,
  email,
  startDate,
  endDate,
  limiterEnabled,
  limitCount,
  receivedCount,
  auditedCount,
  successCount,
  errorCount,
  promptSource,
  results,
}) {
  const runId = crypto.randomUUID();

  const runPayload = {
    id: runId,
    requested_by_user_id: user.id,
    requested_by_email: email,
    start_date: startDate || null,
    end_date: endDate || null,
    limiter_enabled: limiterEnabled,
    limit_count: limitCount,
    received_count: receivedCount,
    audited_count: auditedCount,
    success_count: successCount,
    error_count: errorCount,
    audit_mode: "live_gpt",
    prompt_source: promptSource,
  };

  const { error: runInsertError } = await adminClient
    .from("audit_runs")
    .insert(runPayload);

  if (runInsertError) {
    throw new Error(runInsertError.message || "Could not save audit run.");
  }

  const { data: runCheck, error: runCheckError } = await adminClient
    .from("audit_runs")
    .select("id")
    .eq("id", runId)
    .maybeSingle();

  if (runCheckError || !runCheck?.id) {
    throw new Error(runCheckError?.message || "Audit run row was not confirmed after insert.");
  }

  const resultRows = results.map((item) => ({
    run_id: runId,
    conversation_id: item.conversationId || null,
    replied_at: normalizeTimestampForDb(item.repliedAt),
    csat_score:
      item.csatScore === null || item.csatScore === undefined
        ? null
        : String(item.csatScore),
    client_email: item.clientEmail || null,
    agent_name: item.agentName || null,
    ai_verdict: item.aiVerdict || null,
    review_sentiment: item.reviewSentiment || null,
    client_sentiment: item.clientSentiment || null,
    resolution_status: item.resolutionStatus || null,
    error: item.error || null,
  }));

  if (resultRows.length) {
    const { error: resultsInsertError } = await adminClient
      .from("audit_results")
      .insert(resultRows);

    if (resultsInsertError) {
      await adminClient.from("audit_runs").delete().eq("id", runId);
      throw new Error(resultsInsertError.message || "Could not save audit results.");
    }
  }

  return runId;
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
      return json({ ok: false, error: "Missing required environment variables." }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";

    if (!token) {
      return json({ ok: false, error: "Missing access token." }, { status: 401 });
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
      return json({ ok: false, error: "Invalid or expired session." }, { status: 401 });
    }

    const email = String(user.email || "").toLowerCase();
    const domain = email.split("@")[1] || "";

    if (domain !== "nextventures.io") {
      return json({ ok: false, error: "Only nextventures.io accounts are allowed." }, { status: 403 });
    }

    const { data: profileData } = await adminClient
      .from("profiles")
      .select("id, email, full_name, role, can_run_tests, is_active")
      .eq("id", user.id)
      .maybeSingle();

    const profile = profileData || buildFallbackProfile(user);

    if (!canRunAudits(profile)) {
      return json(
        { ok: false, error: "This account does not have permission to run tests." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const rawConversations = Array.isArray(body?.conversations) ? body.conversations : [];
    const limiterEnabled = Boolean(body?.limiterEnabled);
    const requestedLimit = Number(body?.limitCount);
    const startDate = String(body?.startDate || "").trim() || null;
    const endDate = String(body?.endDate || "").trim() || null;

    if (!rawConversations.length) {
      return json(
        { ok: false, error: "No fetched conversations were provided for audit." },
        { status: 400 }
      );
    }

    const normalizedConversations = rawConversations
      .map(normalizeConversation)
      .filter((item) => item.conversationId);

    if (!normalizedConversations.length) {
      return json(
        { ok: false, error: "No valid conversation IDs were found in the audit payload." },
        { status: 400 }
      );
    }

    const auditPrompt = await loadLiveAuditPrompt(adminClient);

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
          auditPrompt,
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

    const promptSource =
      auditPrompt === FALLBACK_AUDIT_PROMPT
        ? "fallback_code_prompt"
        : "admin_live_prompt";

    const successCount = results.filter((item) => !item.error).length;
    const errorCount = results.filter((item) => Boolean(item.error)).length;

    const storedRunId = await persistAuditRunAndResults({
      adminClient,
      user,
      email,
      startDate,
      endDate,
      limiterEnabled,
      limitCount,
      receivedCount: normalizedConversations.length,
      auditedCount: results.length,
      successCount,
      errorCount,
      promptSource,
      results,
    });

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
        promptSource,
        storedRunId,
        storageStatus: "saved_to_supabase",
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
