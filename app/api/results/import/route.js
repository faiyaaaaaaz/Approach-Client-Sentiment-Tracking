import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const DEFAULT_DUPLICATE_MODE = "skip_existing";

const IGNORED_SHEET_NAMES = new Set([
  "sources",
  "source",
  "dashboard",
  "insights",
  "logout data",
  "readme",
]);

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

function canImportResults(profile) {
  return Boolean(
    profile?.is_active === true &&
      (profile?.role === "master_admin" ||
        profile?.role === "admin" ||
        profile?.can_run_tests === true)
  );
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeHeader(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s_\-./()[\]:]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeDuplicateMode(value) {
  const mode = normalizeKey(value);

  if (mode === "overwrite_existing") return "overwrite_existing";
  if (mode === "fail_if_duplicates") return "fail_if_duplicates";
  if (mode === "skip_existing") return "skip_existing";

  return DEFAULT_DUPLICATE_MODE;
}

function excelValueToText(value) {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") return value.trim();

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }

  if (typeof value === "object") {
    if (value.text) return normalizeText(value.text);
    if (value.result !== undefined) return excelValueToText(value.result);
    if (value.richText && Array.isArray(value.richText)) {
      return value.richText.map((part) => part?.text || "").join("").trim();
    }
    if (value.hyperlink && value.text) return normalizeText(value.text);
  }

  return normalizeText(value);
}

function cellToText(cell) {
  if (!cell) return "";

  const valueText = excelValueToText(cell.value);
  if (valueText) return valueText;

  const text = normalizeText(cell.text);
  return text;
}

function parseExcelDateNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  const utcDays = Math.floor(value - 25569);
  const utcValue = utcDays * 86400;
  const date = new Date(utcValue * 1000);

  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sheetDateToRepliedAt(dateText) {
  if (!dateText) return null;
  return new Date(`${dateText}T12:00:00.000+06:00`).toISOString();
}

function cleanOrdinal(value) {
  return normalizeText(value).replace(/(\d+)(st|nd|rd|th)/gi, "$1");
}

function parseSheetDate(sheetName) {
  const name = normalizeText(sheetName);
  const lower = name.toLowerCase();

  if (!name || IGNORED_SHEET_NAMES.has(lower)) return null;

  const isoMatch = name.match(/(20\d{2})[-_](\d{2})[-_](\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (!Number.isNaN(date.getTime())) return formatDateInput(date);
  }

  const compactMatch = name.match(/^(\d{2})(\d{2})(20\d{2})$/);
  if (compactMatch) {
    const [, day, month, year] = compactMatch;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (!Number.isNaN(date.getTime())) return formatDateInput(date);
  }

  const longDateText = cleanOrdinal(name.split(" to ")[0]);
  const longDate = new Date(longDateText);
  if (!Number.isNaN(longDate.getTime()) && longDate.getFullYear() >= 2020) {
    return formatDateInput(longDate);
  }

  return null;
}

function getHeaderAliases() {
  return {
    client_email: [
      "clientemail",
      "customeremail",
      "useremail",
      "emailaddress",
      "clientmail",
    ],
    conversation_id: [
      "conversationid",
      "conversation",
      "intercomconversationid",
      "conversationnumber",
      "conversationlink",
    ],
    agent_name: [
      "agentname",
      "agent",
      "intercomagent",
      "intercomagentname",
      "teammate",
      "assignee",
    ],
    ai_verdict: [
      "aidetailedverdict",
      "aiverdict",
      "detailedverdict",
      "verdict",
      "auditverdict",
      "gptverdict",
      "analysis",
    ],
    csat_score: [
      "csatscore",
      "csat",
      "rating",
      "ratingscore",
      "conversationrating",
    ],
    review_sentiment: [
      "reviewsentiment",
      "reviewstatus",
      "reviewoutcome",
      "approachstatus",
      "approach",
      "approachsentiment",
    ],
    client_sentiment: [
      "clientsentiment",
      "customersentiment",
      "sentiment",
      "clientemotion",
    ],
    resolution_status: [
      "resolutionstatus",
      "resolution",
      "resolvedstatus",
      "status",
    ],
    employee_name: [
      "employeename",
      "employee",
      "staffname",
      "internalname",
      "mappedemployee",
    ],
    employee_email: [
      "employeeemail",
      "staffemail",
      "internalemail",
      "kpiemail",
      "employeeemailaddress",
    ],
    team_name: [
      "teamname",
      "team",
      "department",
      "dept",
      "unit",
    ],
    replied_at: [
      "repliedat",
      "replydate",
      "date",
      "conversationdate",
      "ratedat",
      "createdat",
    ],
  };
}

function buildAliasLookup() {
  const aliases = getHeaderAliases();
  const lookup = new Map();

  for (const [field, values] of Object.entries(aliases)) {
    for (const alias of values) {
      lookup.set(alias, field);
    }
  }

  return lookup;
}

function findHeaderRow(worksheet) {
  const aliasLookup = buildAliasLookup();
  const maxScanRows = Math.min(25, worksheet.rowCount || 25);

  for (let rowNumber = 1; rowNumber <= maxScanRows; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const headerMap = {};
    let matchCount = 0;

    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const normalized = normalizeHeader(cellToText(cell));
      const field = aliasLookup.get(normalized);

      if (field && !headerMap[field]) {
        headerMap[field] = colNumber;
        matchCount += 1;
      }
    });

    if (
      matchCount >= 3 &&
      headerMap.conversation_id &&
      (headerMap.agent_name || headerMap.client_email || headerMap.ai_verdict)
    ) {
      return { rowNumber, headerMap };
    }
  }

  return null;
}

function getMappedCellText(row, headerMap, field) {
  const column = headerMap?.[field];
  if (!column) return "";
  return cellToText(row.getCell(column));
}

function normalizeConversationId(value) {
  const text = normalizeText(value);
  if (!text) return "";

  const urlMatch = text.match(/conversation\/([A-Za-z0-9_-]+)/);
  if (urlMatch?.[1]) return urlMatch[1];

  return text;
}

function normalizeReviewSentiment(value) {
  const text = normalizeText(value);
  if (!text) return "";

  const lower = text.toLowerCase();

  if (lower === "missed opportunity") return "Missed Opportunity";
  if (lower.includes("highly") && lower.includes("positive")) return "Highly Likely Positive Review";
  if (lower.includes("highly") && lower.includes("negative")) return "Highly Likely Negative Review";
  if (lower.includes("likely") && lower.includes("positive")) return "Likely Positive Review";
  if (lower.includes("likely") && lower.includes("negative")) return "Likely Negative Review";
  if (lower.includes("negative") && lower.includes("no review")) return "Negative Outcome - No Review Request";

  return text;
}

function normalizeClientSentiment(value) {
  const text = normalizeText(value);
  if (!text) return "";

  const allowed = [
    "Very Negative",
    "Negative",
    "Slightly Negative",
    "Neutral",
    "Slightly Positive",
    "Positive",
    "Very Positive",
  ];

  const match = allowed.find((item) => item.toLowerCase() === text.toLowerCase());
  return match || text;
}

function normalizeResolutionStatus(value) {
  const text = normalizeText(value);
  if (!text) return "";

  const allowed = ["Resolved", "Unresolved", "Pending", "Unclear"];
  const match = allowed.find((item) => item.toLowerCase() === text.toLowerCase());

  return match || text;
}

function normalizeTimestampForDb(value, fallbackSheetDate) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === "number") {
    const excelDate = parseExcelDateNumber(value);
    if (excelDate) return excelDate.toISOString();
  }

  const text = normalizeText(value);

  if (text) {
    const compactDate = parseSheetDate(text);
    if (compactDate) return sheetDateToRepliedAt(compactDate);

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return sheetDateToRepliedAt(fallbackSheetDate);
}

function makeWorkbookMappingKey(value) {
  return normalizeKey(value).replace(/\s+/g, " ");
}

function readSourcesMapping(workbook) {
  const mappingByAgent = new Map();

  const sourceSheet =
    workbook.worksheets.find((sheet) => normalizeKey(sheet.name) === "sources") ||
    workbook.worksheets.find((sheet) => normalizeKey(sheet.name) === "source");

  if (!sourceSheet) return mappingByAgent;

  const headerInfo = findHeaderRow(sourceSheet);
  if (!headerInfo) return mappingByAgent;

  const { rowNumber, headerMap } = headerInfo;

  for (let currentRowNumber = rowNumber + 1; currentRowNumber <= sourceSheet.rowCount; currentRowNumber += 1) {
    const row = sourceSheet.getRow(currentRowNumber);

    const agentName = normalizeText(
      getMappedCellText(row, headerMap, "agent_name") ||
        getMappedCellText(row, headerMap, "conversation_id")
    );

    if (!agentName) continue;

    const employeeName = normalizeText(getMappedCellText(row, headerMap, "employee_name"));
    const employeeEmail = normalizeText(getMappedCellText(row, headerMap, "employee_email"));
    const teamName = normalizeText(getMappedCellText(row, headerMap, "team_name"));

    mappingByAgent.set(makeWorkbookMappingKey(agentName), {
      employee_name: employeeName || null,
      employee_email: employeeEmail || null,
      team_name: teamName || null,
      source: "workbook_sources_tab",
    });
  }

  return mappingByAgent;
}

async function loadSupabaseAgentMappings(adminClient) {
  const mappingByAgent = new Map();

  const { data, error } = await adminClient
    .from("agent_mappings")
    .select("intercom_agent_name, employee_name, employee_email, team_name, is_active");

  if (error) {
    if (error.code === "42P01") return mappingByAgent;
    throw new Error(error.message || "Could not load agent mappings.");
  }

  for (const row of data || []) {
    if (row?.is_active === false) continue;

    const key = makeWorkbookMappingKey(row?.intercom_agent_name);
    if (!key) continue;

    mappingByAgent.set(key, {
      employee_name: normalizeText(row?.employee_name) || null,
      employee_email: normalizeText(row?.employee_email) || null,
      team_name: normalizeText(row?.team_name) || null,
      source: "supabase_agent_mappings",
    });
  }

  return mappingByAgent;
}

function resolveEmployeeMapping({
  rowEmployeeName,
  rowEmployeeEmail,
  rowTeamName,
  agentName,
  supabaseMappings,
  workbookMappings,
}) {
  const agentKey = makeWorkbookMappingKey(agentName);
  const supabaseMapping = supabaseMappings.get(agentKey);
  const workbookMapping = workbookMappings.get(agentKey);

  const employeeName =
    normalizeText(rowEmployeeName) ||
    normalizeText(supabaseMapping?.employee_name) ||
    normalizeText(workbookMapping?.employee_name);

  const employeeEmail =
    normalizeText(rowEmployeeEmail) ||
    normalizeText(supabaseMapping?.employee_email) ||
    normalizeText(workbookMapping?.employee_email);

  const teamName =
    normalizeText(rowTeamName) ||
    normalizeText(supabaseMapping?.team_name) ||
    normalizeText(workbookMapping?.team_name);

  const mappingSource =
    rowEmployeeName || rowEmployeeEmail || rowTeamName
      ? "workbook_row"
      : supabaseMapping?.source || workbookMapping?.source || "";

  return {
    employee_name: employeeName || null,
    employee_email: employeeEmail || null,
    team_name: teamName || null,
    employee_match_status: employeeName || employeeEmail || teamName ? "mapped" : "unmapped",
    mapping_source: mappingSource || "unmapped",
  };
}

function parseDateWorksheet({
  worksheet,
  sheetDate,
  supabaseMappings,
  workbookMappings,
}) {
  const headerInfo = findHeaderRow(worksheet);

  if (!headerInfo) {
    return {
      rows: [],
      summary: {
        sheetName: worksheet.name,
        sheetDate,
        status: "skipped_no_headers",
        parsedRows: 0,
        skippedRows: 0,
      },
    };
  }

  const { rowNumber, headerMap } = headerInfo;
  const parsedRows = [];
  let skippedRows = 0;

  for (let currentRowNumber = rowNumber + 1; currentRowNumber <= worksheet.rowCount; currentRowNumber += 1) {
    const row = worksheet.getRow(currentRowNumber);

    const rawConversationId = getMappedCellText(row, headerMap, "conversation_id");
    const conversationId = normalizeConversationId(rawConversationId);

    const agentName = normalizeText(getMappedCellText(row, headerMap, "agent_name"));
    const clientEmail = normalizeText(getMappedCellText(row, headerMap, "client_email"));
    const aiVerdict = normalizeText(getMappedCellText(row, headerMap, "ai_verdict"));
    const csatScore = normalizeText(getMappedCellText(row, headerMap, "csat_score"));

    if (!conversationId && !agentName && !clientEmail && !aiVerdict) {
      skippedRows += 1;
      continue;
    }

    if (!conversationId) {
      skippedRows += 1;
      continue;
    }

    const rowEmployeeName = getMappedCellText(row, headerMap, "employee_name");
    const rowEmployeeEmail = getMappedCellText(row, headerMap, "employee_email");
    const rowTeamName = getMappedCellText(row, headerMap, "team_name");

    const mapping = resolveEmployeeMapping({
      rowEmployeeName,
      rowEmployeeEmail,
      rowTeamName,
      agentName,
      supabaseMappings,
      workbookMappings,
    });

    const repliedAtCellValue = headerMap.replied_at ? row.getCell(headerMap.replied_at)?.value : null;

    parsedRows.push({
      conversation_id: conversationId,
      replied_at: normalizeTimestampForDb(repliedAtCellValue, sheetDate),
      csat_score: csatScore || null,
      client_email: clientEmail || null,
      agent_name: agentName || null,
      employee_name: mapping.employee_name,
      employee_email: mapping.employee_email,
      team_name: mapping.team_name,
      employee_match_status: mapping.employee_match_status,
      ai_verdict: aiVerdict || null,
      review_sentiment: normalizeReviewSentiment(
        getMappedCellText(row, headerMap, "review_sentiment")
      ) || null,
      client_sentiment: normalizeClientSentiment(
        getMappedCellText(row, headerMap, "client_sentiment")
      ) || null,
      resolution_status: normalizeResolutionStatus(
        getMappedCellText(row, headerMap, "resolution_status")
      ) || null,
      error: null,
      import_meta: {
        sheet_name: worksheet.name,
        sheet_date: sheetDate,
        source_row_number: currentRowNumber,
        mapping_source: mapping.mapping_source,
      },
    });
  }

  return {
    rows: parsedRows,
    summary: {
      sheetName: worksheet.name,
      sheetDate,
      status: "parsed",
      headerRow: rowNumber,
      parsedRows: parsedRows.length,
      skippedRows,
    },
  };
}

function dedupeWorkbookRows(rows) {
  const byConversation = new Map();
  let duplicateInFileCount = 0;

  for (const row of rows) {
    const key = normalizeKey(row.conversation_id);
    if (!key) continue;

    if (byConversation.has(key)) {
      duplicateInFileCount += 1;

      const existing = byConversation.get(key);
      const existingDate = new Date(existing.replied_at || 0).getTime();
      const nextDate = new Date(row.replied_at || 0).getTime();

      if (nextDate > existingDate) {
        byConversation.set(key, row);
      }

      continue;
    }

    byConversation.set(key, row);
  }

  return {
    rows: Array.from(byConversation.values()),
    duplicateInFileCount,
  };
}

function chunkArray(items, size = 500) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function fetchExistingStoredResults(adminClient, conversationIds) {
  const existing = [];

  for (const chunk of chunkArray(conversationIds, 500)) {
    const { data, error } = await adminClient
      .from("audit_results")
      .select("id, run_id, conversation_id")
      .in("conversation_id", chunk);

    if (error) {
      throw new Error(error.message || "Could not check existing stored results.");
    }

    existing.push(...(Array.isArray(data) ? data : []));
  }

  return existing;
}

async function removeStoredDuplicates(adminClient, conversationIds) {
  const existingRows = await fetchExistingStoredResults(adminClient, conversationIds);
  const resultIds = existingRows.map((item) => item.id).filter(Boolean);
  const runIds = Array.from(new Set(existingRows.map((item) => item.run_id).filter(Boolean)));

  if (!resultIds.length) {
    return {
      deletedResults: 0,
      deletedRuns: 0,
    };
  }

  for (const chunk of chunkArray(resultIds, 500)) {
    const { error } = await adminClient.from("audit_results").delete().in("id", chunk);

    if (error) {
      throw new Error(error.message || "Could not delete existing duplicate results.");
    }
  }

  let deletedRuns = 0;

  if (runIds.length) {
    const stillUsedRunIds = new Set();

    for (const chunk of chunkArray(runIds, 500)) {
      const { data, error } = await adminClient
        .from("audit_results")
        .select("run_id")
        .in("run_id", chunk);

      if (error) {
        throw new Error(error.message || "Could not inspect duplicate audit runs.");
      }

      for (const item of data || []) {
        if (item?.run_id) stillUsedRunIds.add(item.run_id);
      }
    }

    const emptyRunIds = runIds.filter((id) => !stillUsedRunIds.has(id));

    for (const chunk of chunkArray(emptyRunIds, 500)) {
      const { error } = await adminClient.from("audit_runs").delete().in("id", chunk);

      if (error) {
        throw new Error(error.message || "Could not clean up empty duplicate runs.");
      }

      deletedRuns += chunk.length;
    }
  }

  return {
    deletedResults: resultIds.length,
    deletedRuns,
  };
}

async function insertAuditRows(adminClient, rows) {
  let insertedCount = 0;

  for (const chunk of chunkArray(rows, 400)) {
    const { error } = await adminClient.from("audit_results").insert(chunk);

    if (error) {
      throw new Error(error.message || "Could not insert imported audit results.");
    }

    insertedCount += chunk.length;
  }

  return insertedCount;
}

function buildRunDateRange(rows) {
  const dates = rows
    .map((row) => row?.replied_at)
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  if (!dates.length) {
    return {
      startDate: null,
      endDate: null,
    };
  }

  return {
    startDate: formatDateInput(dates[0]),
    endDate: formatDateInput(dates[dates.length - 1]),
  };
}

async function createImportRun({
  adminClient,
  user,
  email,
  fileName,
  rowsToInsert,
  skippedExistingCount,
  duplicateInFileCount,
  overwrittenCount,
}) {
  const runId = crypto.randomUUID();
  const range = buildRunDateRange(rowsToInsert);

  const runPayload = {
    id: runId,
    requested_by_user_id: user.id,
    requested_by_email: email,
    start_date: range.startDate,
    end_date: range.endDate,
    limiter_enabled: false,
    limit_count: null,
    received_count: rowsToInsert.length + skippedExistingCount + duplicateInFileCount,
    audited_count: rowsToInsert.length,
    success_count: rowsToInsert.length,
    error_count: 0,
    audit_mode: "historical_excel_import",
    prompt_source: `manual_excel_import:${fileName || "uploaded_workbook"}`,
  };

  const { error } = await adminClient.from("audit_runs").insert(runPayload);

  if (error) {
    throw new Error(error.message || "Could not create historical import run.");
  }

  return {
    runId,
    range,
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
      return json(
        { ok: false, error: "Only nextventures.io accounts are allowed." },
        { status: 403 }
      );
    }

    const { data: profileData } = await adminClient
      .from("profiles")
      .select("id, email, full_name, role, can_run_tests, is_active")
      .eq("id", user.id)
      .maybeSingle();

    const profile = profileData || buildFallbackProfile(user);

    if (!canImportResults(profile)) {
      return json(
        { ok: false, error: "This account does not have permission to import results." },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const uploadedFile = formData.get("file");
    const duplicateMode = normalizeDuplicateMode(formData.get("duplicateMode"));

    if (!uploadedFile || typeof uploadedFile.arrayBuffer !== "function") {
      return json({ ok: false, error: "Upload an Excel .xlsx file first." }, { status: 400 });
    }

    const fileName = normalizeText(uploadedFile.name || "uploaded-workbook.xlsx");

    if (!fileName.toLowerCase().endsWith(".xlsx")) {
      return json({ ok: false, error: "Only .xlsx files are supported." }, { status: 400 });
    }

    if (uploadedFile.size && uploadedFile.size > MAX_UPLOAD_BYTES) {
      return json(
        {
          ok: false,
          error: "The uploaded workbook is too large. Keep it under 15 MB.",
        },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await uploadedFile.arrayBuffer());

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const supabaseMappings = await loadSupabaseAgentMappings(adminClient);
    const workbookMappings = readSourcesMapping(workbook);

    const sheetSummaries = [];
    const allParsedRows = [];

    for (const worksheet of workbook.worksheets) {
      const sheetDate = parseSheetDate(worksheet.name);

      if (!sheetDate) {
        sheetSummaries.push({
          sheetName: worksheet.name,
          status: "ignored_non_date_tab",
          parsedRows: 0,
          skippedRows: 0,
        });
        continue;
      }

      const parsed = parseDateWorksheet({
        worksheet,
        sheetDate,
        supabaseMappings,
        workbookMappings,
      });

      sheetSummaries.push(parsed.summary);
      allParsedRows.push(...parsed.rows);
    }

    const parsedDateSheetCount = sheetSummaries.filter((item) => item.status === "parsed").length;

    if (!allParsedRows.length) {
      return json(
        {
          ok: false,
          error: "No importable rows were found in date-named tabs.",
          summary: {
            fileName,
            sheets: sheetSummaries,
          },
        },
        { status: 400 }
      );
    }

    const deduped = dedupeWorkbookRows(allParsedRows);
    const conversationIds = deduped.rows.map((row) => row.conversation_id).filter(Boolean);
    const existingRows = await fetchExistingStoredResults(adminClient, conversationIds);
    const existingConversationIds = new Set(
      existingRows.map((row) => normalizeKey(row.conversation_id)).filter(Boolean)
    );

    if (existingConversationIds.size && duplicateMode === "fail_if_duplicates") {
      return json(
        {
          ok: false,
          requiresDuplicateDecision: true,
          error: "Some conversations already exist in Results.",
          duplicateSummary: {
            duplicateCount: existingConversationIds.size,
            sampleConversationIds: Array.from(existingConversationIds).slice(0, 20),
          },
        },
        { status: 409 }
      );
    }

    let duplicateCleanup = {
      deletedResults: 0,
      deletedRuns: 0,
    };

    let rowsToInsert = deduped.rows;

    if (existingConversationIds.size && duplicateMode === "skip_existing") {
      rowsToInsert = deduped.rows.filter(
        (row) => !existingConversationIds.has(normalizeKey(row.conversation_id))
      );
    }

    if (existingConversationIds.size && duplicateMode === "overwrite_existing") {
      duplicateCleanup = await removeStoredDuplicates(
        adminClient,
        Array.from(existingConversationIds)
      );
    }

    if (!rowsToInsert.length) {
      return json({
        ok: true,
        runId: null,
        message: "Import finished. No new rows were inserted because all parsed conversations already exist.",
        summary: {
          fileName,
          duplicateMode,
          parsedDateSheetCount,
          parsedRows: allParsedRows.length,
          uniqueWorkbookRows: deduped.rows.length,
          insertedRows: 0,
          skippedExistingRows: existingConversationIds.size,
          duplicateInFileRows: deduped.duplicateInFileCount,
          deletedExistingRows: duplicateCleanup.deletedResults,
          deletedEmptyRuns: duplicateCleanup.deletedRuns,
          sheets: sheetSummaries,
        },
      });
    }

    const importRun = await createImportRun({
      adminClient,
      user,
      email,
      fileName,
      rowsToInsert,
      skippedExistingCount:
        duplicateMode === "skip_existing" ? existingConversationIds.size : 0,
      duplicateInFileCount: deduped.duplicateInFileCount,
      overwrittenCount: duplicateCleanup.deletedResults,
    });

    const resultRows = rowsToInsert.map((row) => ({
      run_id: importRun.runId,
      conversation_id: row.conversation_id || null,
      replied_at: row.replied_at || null,
      csat_score: row.csat_score || null,
      client_email: row.client_email || null,
      agent_name: row.agent_name || null,
      employee_name: row.employee_name || null,
      employee_email: row.employee_email || null,
      team_name: row.team_name || null,
      employee_match_status: row.employee_match_status || "unmapped",
      ai_verdict: row.ai_verdict || null,
      review_sentiment: row.review_sentiment || null,
      client_sentiment: row.client_sentiment || null,
      resolution_status: row.resolution_status || null,
      error: row.error || null,
    }));

    const insertedCount = await insertAuditRows(adminClient, resultRows);

    return json({
      ok: true,
      runId: importRun.runId,
      message: `${insertedCount} historical result row(s) imported successfully.`,
      summary: {
        fileName,
        duplicateMode,
        dateRange: importRun.range,
        parsedDateSheetCount,
        parsedRows: allParsedRows.length,
        uniqueWorkbookRows: deduped.rows.length,
        insertedRows: insertedCount,
        skippedExistingRows:
          duplicateMode === "skip_existing" ? existingConversationIds.size : 0,
        duplicateInFileRows: deduped.duplicateInFileCount,
        deletedExistingRows: duplicateCleanup.deletedResults,
        deletedEmptyRuns: duplicateCleanup.deletedRuns,
        workbookSourceMappings: workbookMappings.size,
        supabaseMappings: supabaseMappings.size,
        sheets: sheetSummaries,
      },
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown import server error.",
      },
      { status: 500 }
    );
  }
}
