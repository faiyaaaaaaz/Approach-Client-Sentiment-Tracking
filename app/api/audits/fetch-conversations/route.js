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

function canRunAudits(profile) {
  return Boolean(
    profile?.is_active === true &&
      (profile?.role === "master_admin" ||
        profile?.role === "admin" ||
        profile?.can_run_tests === true)
  );
}

function normalizeConversation(item) {
  const conversationId = String(
    item?.conversationId || item?.id || ""
  ).trim();

  return {
    conversationId,
    repliedAt: item?.repliedAt || null,
    csatScore: item?.csatScore ?? "",
    clientEmail: item?.clientEmail || "",
    agentName: item?.agentName || "Unassigned",
  };
}

function buildAuditPreview(conversation) {
  return {
    conversationId: conversation.conversationId,
    auditStatus: "pending_ai_review",
    repliedAt: conversation.repliedAt,
    csatScore: conversation.csatScore,
    clientEmail: conversation.clientEmail,
    agentName: conversation.agentName,
    findings: [],
    summary: "Queued for GPT audit.",
  };
}

export async function POST(request) {
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
      ? Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 5, 200))
      : null;

    const conversationsToAudit = limiterEnabled
      ? normalizedConversations.slice(0, limitCount)
      : normalizedConversations;

    const results = conversationsToAudit.map(buildAuditPreview);

    return json({
      ok: true,
      message:
        results.length > 0
          ? "Audit step prepared successfully."
          : "No conversations were available for audit.",
      meta: {
        requestedBy: email,
        receivedCount: normalizedConversations.length,
        auditedCount: results.length,
        limiterEnabled,
        limitCount,
        auditMode: "preview_only",
        nextStep: "Replace preview audit generation with GPT + Supabase persistence.",
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
