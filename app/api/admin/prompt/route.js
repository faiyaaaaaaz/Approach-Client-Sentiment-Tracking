import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROMPT_KEY = "audit_review_prompt";

const ORIGINAL_TRUSTED_PROMPT = `You are auditing FundedNext support conversations.

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
EXAMPLES
--------------------------------------------------

Example A
Client: “Awesome, it’s working now. Thank you so much!”
Agent: “Great! Please leave us a review here: https://www.trustpilot.com/review/fundednext.com”
Output logic:
- reviewSentiment = Highly Likely Positive Review
- clientSentiment = Very Positive

Example B
Client: “That solved the issue, thanks a lot.”
Agent: “Glad I could help.”
Conversation ends and the agent did NOT send a review request link.
Output logic:
- reviewSentiment = Missed Opportunity
- clientSentiment = Positive

Example C
Client: “I’m still waiting for my payout verification.”
Agent: “Meanwhile, please review us on Trustpilot: https://www.trustpilot.com/review/fundednext.com”
Output logic:
- reviewSentiment = Likely Negative Review
- clientSentiment = Negative

Example D
Client: “This is the third time I’m asking. Nothing is fixed.”
Agent: “Please leave a review on Sitejabber: https://www.sitejabber.com/requested-review?biz_id=62357d8fdf98d”
Output logic:
- reviewSentiment = Highly Likely Negative Review
- clientSentiment = Very Negative

Example E
Client: “Thanks.”
Agent: “You’re welcome.”
The agent did NOT send a review request link. There is no clear favorable resolution and no strong positive emotion.
Output logic:
- reviewSentiment = Negative Outcome - No Review Request if the outcome was unresolved, pending, unclear, or not favorable
- clientSentiment = Neutral or Slightly Positive depending on context

Example F
Client: “Perfect, that fixed everything.”
Agent: “Happy to help.”
The agent did NOT send a review request link.
Output logic:
- reviewSentiment = Missed Opportunity
- clientSentiment = Very Positive

Example G
Client: “Okay.”
The agent sent a review request link immediately after an unclear outcome.
Output logic:
- reviewSentiment = Likely Negative Review or Highly Likely Negative Review depending on frustration level
- clientSentiment = based on the real tone, not just the word “Okay”

Example H
The issue was still pending or escalated.
The agent did NOT send a review request link.
Output logic:
- reviewSentiment = Negative Outcome - No Review Request
- clientSentiment = based on emotional tone

Example I
Client: “I’m still waiting and nothing is fixed yet.”
Agent: “We have escalated it.”
The agent did NOT send a review request link.
Output logic:
- reviewSentiment = Negative Outcome - No Review Request
- clientSentiment = Negative

Example J
Client was frustrated about login access.
Agent deactivated 2FA and gave instructions.
Client only replied “Ok.”
The agent did NOT send a review request link.
There was no clear client confirmation that the problem was fully solved in the client’s favor.
Output logic:
- reviewSentiment = Negative Outcome - No Review Request
- clientSentiment = Negative

Example K
Client’s issue was resolved.
Client sounded satisfied but not strongly emotional.
Agent sent a review request link.
Output logic:
- reviewSentiment = Likely Positive Review
- clientSentiment = Slightly Positive or Positive

--------------------------------------------------
OUTPUT RULES
--------------------------------------------------

Return ONLY valid JSON.
Do not add markdown.
Do not add explanation outside JSON.

aiVerdict rules:

- MUST be exactly one single line (no line breaks)
- maximum 35 words
- MUST include all 3 parts in this exact structure:

"<review verdict>; Client Sentiment: <sentiment>; Resolution Status: <resolution> because <reason>"

Rules:
- the review verdict part should be slightly more descriptive than the other parts
- the review verdict part should briefly explain the review approach or missed review opportunity
- Client Sentiment must be only the label, with no explanation
- Resolution Status must include the label and a short reason
- use exactly these phrases:
  - "Client Sentiment:"
  - "Resolution Status:"
- be factual, concise, and specific
- do not use bullet points
- do not use multiple sentences
- do not repeat raw field names like reviewSentiment or resolutionStatus
- do not add any extra sections

Examples:

- "Review link was not sent despite a favorable outcome for the client, creating a missed review opportunity; Client Sentiment: Positive; Resolution Status: Resolved because the concern was addressed"
- "Review was requested before the issue was fully settled, making a negative review more likely; Client Sentiment: Negative; Resolution Status: Pending because the client was told to wait"
- "No review request was sent after an unclear ending, so no review opportunity was used; Client Sentiment: Neutral; Resolution Status: Unclear because the client stopped replying"
- "No review request was sent and the conversation ended poorly; Client Sentiment: Very Negative; Resolution Status: Unresolved because not all concerns were addressed"

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

function canManageAdmin(profile) {
  return Boolean(
    profile?.is_active === true &&
      (profile?.role === "master_admin" || profile?.role === "admin")
  );
}

async function getAuthenticatedAdmin(request) {
  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new Error("Missing required environment variables.");
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "Missing access token.",
    };
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
    return {
      ok: false,
      status: 401,
      error: "Invalid or expired session.",
    };
  }

  const email = String(user.email || "").toLowerCase();
  const domain = email.split("@")[1] || "";

  if (domain !== "nextventures.io") {
    return {
      ok: false,
      status: 403,
      error: "Only nextventures.io accounts are allowed.",
    };
  }

  const { data: profileData } = await adminClient
    .from("profiles")
    .select("id, email, full_name, role, can_run_tests, is_active")
    .eq("id", user.id)
    .maybeSingle();

  const profile = profileData || buildFallbackProfile(user);

  if (!canManageAdmin(profile)) {
    return {
      ok: false,
      status: 403,
      error: "This account does not have admin permission.",
    };
  }

  return {
    ok: true,
    adminClient,
    user,
    profile,
    email,
  };
}

async function loadPromptBundle(adminClient) {
  const { data: config, error: configError } = await adminClient
    .from("admin_prompt_configs")
    .select(
      "prompt_key, original_prompt, live_prompt, created_at, updated_at, updated_by_user_id, updated_by_email"
    )
    .eq("prompt_key", PROMPT_KEY)
    .maybeSingle();

  if (configError) {
    if (configError.code === "42P01") {
      return {
        dbReady: false,
        config: null,
        history: [],
      };
    }
    throw new Error(configError.message || "Could not load prompt config.");
  }

  const { data: historyRows, error: historyError } = await adminClient
    .from("admin_prompt_history")
    .select(
      "id, prompt_key, prompt_text, prompt_type, change_note, changed_at, changed_by_user_id, changed_by_email"
    )
    .eq("prompt_key", PROMPT_KEY)
    .order("changed_at", { ascending: false })
    .limit(50);

  if (historyError) {
    if (historyError.code === "42P01") {
      return {
        dbReady: false,
        config,
        history: [],
      };
    }
    throw new Error(historyError.message || "Could not load prompt history.");
  }

  return {
    dbReady: true,
    config: config || null,
    history: Array.isArray(historyRows) ? historyRows : [],
  };
}

function buildResponsePayload(bundle) {
  const config = bundle?.config || null;
  const history = Array.isArray(bundle?.history) ? bundle.history : [];
  const originalPrompt =
    String(config?.original_prompt || "").trim() || ORIGINAL_TRUSTED_PROMPT;
  const livePrompt =
    String(config?.live_prompt || "").trim() || originalPrompt;

  return {
    ok: true,
    dbReady: Boolean(bundle?.dbReady),
    prompt: {
      promptKey: PROMPT_KEY,
      originalTrustedPrompt: originalPrompt,
      livePrompt,
      createdAt: config?.created_at || null,
      updatedAt: config?.updated_at || null,
      updatedByEmail: config?.updated_by_email || null,
    },
    history,
  };
}

export async function GET(request) {
  try {
    const auth = await getAuthenticatedAdmin(request);

    if (!auth.ok) {
      return json(
        {
          ok: false,
          error: auth.error,
        },
        { status: auth.status }
      );
    }

    const bundle = await loadPromptBundle(auth.adminClient);

    return json(buildResponsePayload(bundle));
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

export async function POST(request) {
  try {
    const auth = await getAuthenticatedAdmin(request);

    if (!auth.ok) {
      return json(
        {
          ok: false,
          error: auth.error,
        },
        { status: auth.status }
      );
    }

    const body = await request.json();
    const livePrompt = String(body?.livePrompt || "").trim();
    const changeNote = String(body?.changeNote || "").trim();

    if (!livePrompt) {
      return json(
        {
          ok: false,
          error: "Live prompt is required.",
        },
        { status: 400 }
      );
    }

    const bundle = await loadPromptBundle(auth.adminClient);

    if (!bundle.dbReady) {
      return json(
        {
          ok: false,
          error:
            "Prompt tables are not ready yet. Create admin_prompt_configs and admin_prompt_history in Supabase first.",
        },
        { status: 500 }
      );
    }

    const existingConfig = bundle.config || null;
    const originalPrompt =
      String(existingConfig?.original_prompt || "").trim() || ORIGINAL_TRUSTED_PROMPT;
    const currentLivePrompt =
      String(existingConfig?.live_prompt || "").trim() || originalPrompt;

    const nowIso = new Date().toISOString();

    if (livePrompt === currentLivePrompt) {
      return json({
        ok: true,
        message: "No prompt change was detected.",
        ...buildResponsePayload(bundle),
      });
    }

    const upsertPayload = {
      prompt_key: PROMPT_KEY,
      original_prompt: originalPrompt,
      live_prompt: livePrompt,
      updated_at: nowIso,
      updated_by_user_id: auth.user.id,
      updated_by_email: auth.email,
    };

    if (!existingConfig?.created_at) {
      upsertPayload.created_at = nowIso;
    }

    const { error: upsertError } = await auth.adminClient
      .from("admin_prompt_configs")
      .upsert(upsertPayload, {
        onConflict: "prompt_key",
      });

    if (upsertError) {
      throw new Error(upsertError.message || "Could not save live prompt.");
    }

    const historyInsert = {
      prompt_key: PROMPT_KEY,
      prompt_text: livePrompt,
      prompt_type: "live_prompt",
      change_note: changeNote || null,
      changed_at: nowIso,
      changed_by_user_id: auth.user.id,
      changed_by_email: auth.email,
    };

    const { error: historyError } = await auth.adminClient
      .from("admin_prompt_history")
      .insert(historyInsert);

    if (historyError) {
      throw new Error(historyError.message || "Could not save prompt history.");
    }

    const refreshedBundle = await loadPromptBundle(auth.adminClient);

    return json({
      ok: true,
      message: "Live prompt saved successfully.",
      ...buildResponsePayload(refreshedBundle),
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
