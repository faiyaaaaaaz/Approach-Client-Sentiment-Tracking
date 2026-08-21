import { authenticateServerRequest, normalizeServerEmail } from "../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data, init = {}) {
  return Response.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init.headers || {}) } });
}

export async function GET(request) {
  try {
    const auth = await authenticateServerRequest(request);
    if (!auth.ok) return json({ ok: false, error: auth.error }, { status: auth.status });
    const resultId = String(new URL(request.url).searchParams.get("resultId") || "").trim();
    if (!resultId) return json({ ok: false, error: "A result ID is required." }, { status: 400 });

    const { data: result, error } = await auth.adminClient
      .from("audit_results")
      .select("id,conversation_id,agent_name,employee_name,employee_email,team_name,review_sentiment,client_sentiment,resolution_status,ai_verdict,replied_at,created_at")
      .eq("id", resultId)
      .maybeSingle();
    if (error) throw new Error(error.message || "Could not load the stored audit result.");
    if (!result) return json({ ok: false, error: "Stored audit result not found." }, { status: 404 });
    if (!auth.canViewAllEngagement && normalizeServerEmail(result.employee_email) !== auth.email) {
      return json({ ok: false, error: "You cannot view this stored audit result." }, { status: 403 });
    }
    return json({ ok: true, result });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Could not load the stored audit result." }, { status: 500 });
  }
}
