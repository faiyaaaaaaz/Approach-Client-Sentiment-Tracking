import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MASTER_ADMIN_EMAIL = "faiyaz@nextventures.io";
const OPENAI_MODEL = "gpt-4.1-mini";
const PAGE_SIZE = 1000;
const MAX_REPORT_ROWS = 50000;
const POSITIVE_MISSED_SENTIMENTS = ["Very Positive", "Positive", "Slightly Positive"];

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

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function sameText(a, b) {
  return normalizeKey(a) === normalizeKey(b);
}

function getSupabaseClients() {
  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new Error("Missing Supabase environment variables.");
  }

  return {
    authClient: createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    adminClient: createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

async function authenticateOwner(request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";

  if (!token) {
    return { ok: false, response: json({ ok: false, error: "Missing access token." }, { status: 401 }) };
  }

  const { authClient, adminClient } = getSupabaseClients();

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser(token);

  if (userError || !user) {
    return { ok: false, response: json({ ok: false, error: "Invalid or expired session." }, { status: 401 }) };
  }

  const email = normalizeEmail(user.email);

  if (email !== MASTER_ADMIN_EMAIL) {
    return {
      ok: false,
      response: json({ ok: false, error: "Overview Report is limited to the Platform Owner." }, { status: 403 }),
    };
  }

  const { data: profileById, error: idProfileError } = await adminClient
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (idProfileError) {
    throw new Error(idProfileError.message || "Could not verify Platform Owner profile.");
  }

  let profileData = profileById || null;

  if (!profileData) {
    const { data: profileByEmail, error: emailProfileError } = await adminClient
      .from("profiles")
      .select("id, email, full_name, role, is_active")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    if (emailProfileError) {
      throw new Error(emailProfileError.message || "Could not verify Platform Owner profile by email.");
    }

    profileData = profileByEmail || null;
  }

  if (profileData && profileData.is_active === false) {
    return {
      ok: false,
      response: json({ ok: false, error: "Your Platform Owner profile is inactive." }, { status: 403 }),
    };
  }

  const profile = {
    ...(profileData || {}),
    id: user.id,
    email,
    full_name:
      normalizeText(profileData?.full_name) ||
      normalizeText(user?.user_metadata?.full_name) ||
      normalizeText(user?.user_metadata?.name) ||
      "Faiyaz Muhtasim Ahmed",
    role: "platform_owner",
    is_active: true,
  };

  return { ok: true, user, email, profile, adminClient };
}

async function loadActiveOpenAiKey(adminClient) {
  const { data, error } = await adminClient
    .from("api_keys")
    .select("secret_value, updated_at")
    .eq("key_type", "openai")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error && error.code !== "42P01") {
    throw new Error(error.message || "Could not load active OpenAI API key.");
  }

  const savedKey = normalizeText(data?.[0]?.secret_value);
  if (savedKey) return savedKey;

  const fallbackKey = getEnv("OPENAI_API_KEY");
  if (fallbackKey) return fallbackKey;

  return "";
}

function parseDateInput(value) {
  const text = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  return text;
}

function dateAtDhakaBoundary(dateString, end = false) {
  const suffix = end ? "T23:59:59.999+06:00" : "T00:00:00.000+06:00";
  const date = new Date(`${dateString}${suffix}`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getAnalyticsDate(row) {
  return row?.replied_at || row?.created_at || null;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "0.0%";
  return `${value.toFixed(1)}%`;
}

function ordinal(day) {
  const number = Number(day);
  const mod100 = number % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${number}th`;
  const mod10 = number % 10;
  if (mod10 === 1) return `${number}st`;
  if (mod10 === 2) return `${number}nd`;
  if (mod10 === 3) return `${number}rd`;
  return `${number}th`;
}

function formatDhakaDateParts(dateString) {
  const date = dateAtDhakaBoundary(dateString, false);
  if (!date) return null;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const parts = formatter.formatToParts(date);
  return {
    day: parts.find((part) => part.type === "day")?.value || "",
    month: parts.find((part) => part.type === "month")?.value || "",
    year: parts.find((part) => part.type === "year")?.value || "",
  };
}

function buildRangeLabel(startDate, endDate) {
  const start = formatDhakaDateParts(startDate);
  const end = formatDhakaDateParts(endDate);

  if (!start || !end) return `${startDate} to ${endDate}`;

  if (startDate === endDate) {
    return `${ordinal(start.day)} ${start.month}, ${start.year}`;
  }

  if (start.month === end.month && start.year === end.year) {
    return `${ordinal(start.day)} to ${ordinal(end.day)} ${end.month}, ${end.year}`;
  }

  if (start.year === end.year) {
    return `${ordinal(start.day)} ${start.month} to ${ordinal(end.day)} ${end.month}, ${end.year}`;
  }

  return `${ordinal(start.day)} ${start.month}, ${start.year} to ${ordinal(end.day)} ${end.month}, ${end.year}`;
}

function formatSimpleDate(date) {
  if (!date) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka",
    month: "short",
    day: "numeric",
  }).format(date);
}

async function fetchAuditRows(adminClient) {
  const allRows = [];
  let from = 0;

  while (from < MAX_REPORT_ROWS) {
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await adminClient
      .from("audit_results")
      .select("id, run_id, conversation_id, replied_at, created_at, agent_name, employee_name, employee_email, team_name, review_sentiment, client_sentiment, resolution_status, error")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(error.message || "Could not load audit results for the report.");
    }

    const rows = Array.isArray(data) ? data : [];
    allRows.push(...rows);

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return allRows;
}

async function loadSupervisorLookup(adminClient) {
  const lookup = new Map();

  const { data: teams, error: teamsError } = await adminClient
    .from("supervisor_teams")
    .select("id, supervisor_name, supervisor_email, is_active")
    .eq("is_active", true)
    .limit(1000);

  if (teamsError) return lookup;

  const teamRows = Array.isArray(teams) ? teams : [];
  const teamById = new Map(teamRows.map((team) => [team.id, team]));
  const teamIds = teamRows.map((team) => team.id).filter(Boolean);

  if (!teamIds.length) return lookup;

  const { data: members, error: membersError } = await adminClient
    .from("supervisor_team_members")
    .select("supervisor_team_id, employee_name, employee_email, intercom_agent_name, is_active")
    .in("supervisor_team_id", teamIds)
    .eq("is_active", true)
    .limit(10000);

  if (membersError) return lookup;

  for (const member of Array.isArray(members) ? members : []) {
    const team = teamById.get(member.supervisor_team_id);
    if (!team) continue;

    const payload = {
      supervisorName: normalizeText(team.supervisor_name),
      supervisorEmail: normalizeEmail(team.supervisor_email),
    };

    const keys = [
      `email:${normalizeEmail(member.employee_email)}`,
      `employee:${normalizeKey(member.employee_name)}`,
      `agent:${normalizeKey(member.intercom_agent_name)}`,
    ].filter((key) => !key.endsWith(":"));

    for (const key of keys) {
      if (!lookup.has(key)) lookup.set(key, payload);
    }
  }

  return lookup;
}

function employeeNameFor(row) {
  return normalizeText(row?.employee_name) || normalizeText(row?.agent_name) || "Unmapped Agent";
}

function getSupervisorForRow(row, supervisorLookup) {
  const keys = [
    `email:${normalizeEmail(row?.employee_email)}`,
    `employee:${normalizeKey(row?.employee_name)}`,
    `agent:${normalizeKey(row?.agent_name)}`,
  ].filter((key) => !key.endsWith(":"));

  for (const key of keys) {
    const found = supervisorLookup.get(key);
    if (found?.supervisorName) return found;
  }

  return null;
}

function buildWeekPeriods(startDate, endDate) {
  const start = dateAtDhakaBoundary(startDate, false);
  const end = dateAtDhakaBoundary(endDate, true);
  if (!start || !end || start > end) return [];

  const periods = [];
  let cursor = startOfUtcDay(start);
  let index = 1;

  while (cursor <= end) {
    const periodStart = cursor;
    const periodEnd = endOfUtcDay(addDays(cursor, 6));
    const safeEnd = periodEnd > end ? end : periodEnd;

    periods.push({
      key: `week_${index}`,
      index,
      label: `Week ${index}`,
      rangeLabel: `${formatSimpleDate(periodStart)} - ${formatSimpleDate(safeEnd)}`,
      start: periodStart,
      end: safeEnd,
    });

    cursor = addDays(cursor, 7);
    index += 1;
  }

  return periods;
}

function buildReportSummary(rows, { startDate, endDate, platformUrl, supervisorLookup }) {
  const start = dateAtDhakaBoundary(startDate, false);
  const end = dateAtDhakaBoundary(endDate, true);
  const rangeLabel = buildRangeLabel(startDate, endDate);

  const scopedRows = (rows || []).filter((row) => {
    const date = toDate(getAnalyticsDate(row));
    if (!date || date < start || date > end) return false;
    return !normalizeText(row?.error);
  });

  const missedPositiveRows = scopedRows.filter(
    (row) =>
      sameText(row?.review_sentiment, "Missed Opportunity") &&
      POSITIVE_MISSED_SENTIMENTS.some((sentiment) => sameText(row?.client_sentiment, sentiment))
  );

  const sentimentBreakdown = POSITIVE_MISSED_SENTIMENTS.map((sentiment) => ({
    sentiment,
    count: missedPositiveRows.filter((row) => sameText(row?.client_sentiment, sentiment)).length,
  }));

  const agentMap = new Map();
  const supervisorMap = new Map();

  for (const row of missedPositiveRows) {
    const employee = employeeNameFor(row);
    const key = normalizeKey(employee);
    const current = agentMap.get(key) || {
      employee,
      team: normalizeText(row?.team_name) || "-",
      total: 0,
      veryPositive: 0,
      positive: 0,
      slightlyPositive: 0,
    };

    current.total += 1;
    if (sameText(row?.client_sentiment, "Very Positive")) current.veryPositive += 1;
    if (sameText(row?.client_sentiment, "Positive")) current.positive += 1;
    if (sameText(row?.client_sentiment, "Slightly Positive")) current.slightlyPositive += 1;
    if ((!current.team || current.team === "-") && row?.team_name) current.team = row.team_name;
    agentMap.set(key, current);

    const supervisor = getSupervisorForRow(row, supervisorLookup);
    if (supervisor?.supervisorName) {
      const supervisorKey = normalizeKey(supervisor.supervisorName);
      const supervisorCurrent = supervisorMap.get(supervisorKey) || {
        supervisorName: supervisor.supervisorName,
        supervisorEmail: supervisor.supervisorEmail,
        total: 0,
        employees: new Set(),
      };
      supervisorCurrent.total += 1;
      supervisorCurrent.employees.add(employee);
      supervisorMap.set(supervisorKey, supervisorCurrent);
    }
  }

  const topAgents = Array.from(agentMap.values())
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.employee.localeCompare(b.employee);
    })
    .slice(0, 10);

  const supervisorAttention = Array.from(supervisorMap.values())
    .map((item) => ({
      ...item,
      employees: Array.from(item.employees).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.supervisorName.localeCompare(b.supervisorName);
    })
    .slice(0, 8);

  const periods = buildWeekPeriods(startDate, endDate);
  const weeklyAgentMap = new Map();

  for (const row of missedPositiveRows) {
    const date = toDate(getAnalyticsDate(row));
    const period = periods.find((item) => date >= item.start && date <= item.end);
    if (!period) continue;

    const employee = employeeNameFor(row);
    const key = `${period.key}:${normalizeKey(employee)}`;
    const current = weeklyAgentMap.get(key) || {
      week: period.label,
      weekRange: period.rangeLabel,
      employee,
      count: 0,
    };
    current.count += 1;
    weeklyAgentMap.set(key, current);
  }

  const weeklyHighlights = Array.from(weeklyAgentMap.values())
    .filter((item) => item.count > 0)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.employee.localeCompare(b.employee);
    })
    .slice(0, 8);

  const weeklyTotals = periods.map((period) => ({
    week: period.label,
    range: period.rangeLabel,
    count: missedPositiveRows.filter((row) => {
      const date = toDate(getAnalyticsDate(row));
      return date && date >= period.start && date <= period.end;
    }).length,
  }));

  const missedPositiveRate = scopedRows.length ? (missedPositiveRows.length / scopedRows.length) * 100 : 0;
  const topAgentShare = missedPositiveRows.length && topAgents[0] ? (topAgents[0].total / missedPositiveRows.length) * 100 : 0;

  const riskSignals = [];
  if (missedPositiveRows.length >= 50) riskSignals.push("High missed approach volume in the selected period.");
  if (missedPositiveRate >= 10) riskSignals.push("Missed positive-side opportunity rate is above 10% of audited conversations.");
  else if (missedPositiveRate >= 5) riskSignals.push("Missed positive-side opportunity rate is above the 5% warning level.");
  if (topAgentShare >= 20 && topAgents[0]) riskSignals.push(`${topAgents[0].employee} accounts for ${formatPercent(topAgentShare)} of positive-side missed approaches.`);
  const veryPositiveCount = sentimentBreakdown.find((item) => item.sentiment === "Very Positive")?.count || 0;
  if (veryPositiveCount > 0) riskSignals.push(`${formatNumber(veryPositiveCount)} Very Positive client conversation(s) were missed, which should be treated as high-priority recovery opportunities.`);

  return {
    generatedAt: new Date().toISOString(),
    range: {
      startDate,
      endDate,
      label: rangeLabel,
    },
    platformUrl: normalizeText(platformUrl),
    totalAudited: scopedRows.length,
    totalMissedPositive: missedPositiveRows.length,
    missedPositiveRate,
    missedPositiveRateLabel: formatPercent(missedPositiveRate),
    sentimentBreakdown,
    topAgents,
    supervisorAttention,
    weeklyTotals,
    weeklyHighlights,
    riskSignals,
    meta: {
      source: "audit_results",
      reranAudits: false,
      excludedClientSentiments: ["Neutral", "Slightly Negative", "Negative", "Very Negative"],
      includedClientSentiments: POSITIVE_MISSED_SENTIMENTS,
    },
  };
}

function buildFallbackReport(summary) {
  const lines = [];
  const breakdown = Object.fromEntries(summary.sentimentBreakdown.map((item) => [item.sentiment, item.count]));

  lines.push("Analysis of Missed Review Approaches");
  lines.push("");
  lines.push("Hello @everyone,");
  lines.push("");

  if (!summary.totalAudited) {
    lines.push(`No audited conversations were found for ${summary.range.label}.`);
    lines.push("");
    lines.push("Please confirm the date range or run audits first before generating this report.");
    return lines.join("\n");
  }

  lines.push(
    `It is quite alarming to see that we missed a total of ${formatNumber(summary.totalMissedPositive)} positive-side review approach(es) from ${summary.range.label}.`
  );
  lines.push("");
  lines.push(`• ${formatNumber(breakdown["Very Positive"] || 0)} were to Very Positive clients.`);
  lines.push(`• ${formatNumber(breakdown.Positive || 0)} were to Positive clients.`);
  lines.push(`• ${formatNumber(breakdown["Slightly Positive"] || 0)} were to Slightly Positive clients.`);
  lines.push("");
  lines.push(`This equals ${summary.missedPositiveRateLabel} of ${formatNumber(summary.totalAudited)} audited conversation(s) in the selected range.`);

  if (summary.platformUrl) {
    lines.push("");
    lines.push(`You can check the data yourself by applying the same filters in this dashboard: ${summary.platformUrl}`);
  }

  if (summary.weeklyHighlights.length) {
    lines.push("");
    lines.push("Here is the week-by-week miss count of the agents needing attention:");
    summary.weeklyHighlights.slice(0, 6).forEach((item) => {
      lines.push(`• ${item.employee} (${formatNumber(item.count)} miss(es) on ${item.week})`);
    });
  } else if (summary.topAgents.length) {
    lines.push("");
    lines.push("Agents needing attention in this date range:");
    summary.topAgents.slice(0, 6).forEach((item) => {
      lines.push(`• ${item.employee} (${formatNumber(item.total)} missed approach(es))`);
    });
  }

  if (summary.riskSignals.length) {
    lines.push("");
    lines.push("Alarming trend(s) to note:");
    summary.riskSignals.slice(0, 4).forEach((item) => lines.push(`• ${item}`));
  }

  if (summary.supervisorAttention.length) {
    lines.push("");
    lines.push("Requesting the relevant leads/supervisors to review their team performance and share necessary feedbacks.");
  } else {
    lines.push("");
    lines.push("Requesting all leads to review their team performance and share necessary feedbacks.");
  }

  lines.push("");
  lines.push("Note: If you disagree with the AI's verdict, you can submit a dispute from the platform. AI will then use your inputs to improve its future accuracy. Supervisors can dispute their team member's results.");

  return lines.join("\n");
}

function buildOpenAiPrompt(summary) {
  return `You are writing a ClickUp channel update for an internal FundedNext support QA platform.

Write in the same practical style as the user's example:
- Title: Analysis of Missed Review Approaches
- Start with: Hello @everyone,
- Keep it direct and management-friendly.
- Mention alarming trends only when supported by the facts.
- Do not invent numbers, dates, agent names, supervisor names, or links.
- Use only the provided calculated facts.
- Do not mention Neutral, Negative, Slightly Negative, or Very Negative sentiment categories.
- The report is only about Missed Opportunity results where Client Sentiment is Very Positive, Positive, or Slightly Positive.
- Do not say audits were rerun. This report is based only on stored audit results.
- Use bullet points with the bullet character •.
- End with this note exactly, preserving meaning but fixing grammar only if needed: "Note: If you disagree with the AI's verdict, you can submit a dispute from the platform. AI will then use your inputs to improve its future accuracy. Supervisors can dispute their team member's results."

Calculated facts JSON:
${JSON.stringify(summary, null, 2)}

Return only the final ClickUp-ready report text. Do not wrap in markdown code fences.`;
}

async function generateAiReport(openAiApiKey, summary) {
  if (!openAiApiKey) return { report: buildFallbackReport(summary), source: "server_fallback_no_openai_key" };

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          {
            role: "system",
            content: "You generate concise internal operations reports from verified metrics. Never alter calculated numbers.",
          },
          {
            role: "user",
            content: buildOpenAiPrompt(summary),
          },
        ],
        temperature: 0.2,
      }),
      cache: "no-store",
    });

    const data = await response.json().catch(() => null);
    const content = normalizeText(data?.choices?.[0]?.message?.content);

    if (!response.ok || !content) {
      return { report: buildFallbackReport(summary), source: "server_fallback_openai_error" };
    }

    return { report: content, source: "openai" };
  } catch (_error) {
    return { report: buildFallbackReport(summary), source: "server_fallback_openai_exception" };
  }
}

async function writeActivityLog(adminClient, request, auth, summary, source) {
  try {
    const forwardedFor = request.headers.get("x-forwarded-for") || "";
    await adminClient.from("system_activity_logs").insert({
      actor_user_id: auth.user?.id || null,
      actor_email: auth.email,
      actor_name: auth.profile?.full_name || auth.email,
      actor_role: "platform_owner",
      action_type: "overview_report_generated",
      action_label: "Generated Overview Report",
      area: "Overview Report",
      target_type: "date_range",
      target_id: `${summary.range.startDate}:${summary.range.endDate}`,
      target_label: summary.range.label,
      status: "success",
      description: `Generated overview report for ${summary.range.label}.`,
      is_sensitive: false,
      safe_after: {
        totalAudited: summary.totalAudited,
        totalMissedPositive: summary.totalMissedPositive,
        reportSource: source,
      },
      metadata: {
        reranAudits: false,
        includedClientSentiments: summary.meta.includedClientSentiments,
      },
      request_path: new URL(request.url).pathname,
      ip_address: forwardedFor.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null,
      user_agent: request.headers.get("user-agent") || null,
    });
  } catch (_error) {
    // Activity logging should never block report generation.
  }
}

export async function POST(request) {
  try {
    const auth = await authenticateOwner(request);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const startDate = parseDateInput(body?.startDate);
    const endDate = parseDateInput(body?.endDate);
    const platformUrl = normalizeText(body?.platformUrl);

    if (!startDate || !endDate) {
      return json({ ok: false, error: "Select a valid start date and end date." }, { status: 400 });
    }

    if (dateAtDhakaBoundary(startDate, false) > dateAtDhakaBoundary(endDate, true)) {
      return json({ ok: false, error: "Start date cannot be after end date." }, { status: 400 });
    }

    const [rows, supervisorLookup, openAiApiKey] = await Promise.all([
      fetchAuditRows(auth.adminClient),
      loadSupervisorLookup(auth.adminClient),
      loadActiveOpenAiKey(auth.adminClient),
    ]);

    const summary = buildReportSummary(rows, {
      startDate,
      endDate,
      platformUrl,
      supervisorLookup,
    });

    const generated = await generateAiReport(openAiApiKey, summary);

    await writeActivityLog(auth.adminClient, request, auth, summary, generated.source);

    return json({
      ok: true,
      report: generated.report,
      reportSource: generated.source,
      summary,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown overview report error.",
      },
      { status: 500 }
    );
  }
}
