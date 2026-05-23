"use client";

import { useEffect, useMemo, useState } from "react";

const REVIEW_STATUS_OPTIONS = [
  "Likely Negative Review",
  "Likely Positive Review",
  "Highly Likely Negative Review",
  "Highly Likely Positive Review",
  "Missed Opportunity",
  "Negative Outcome - No Review Request",
];

function normalizeText(value) {
  return String(value || "").trim();
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function readApiJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Server returned a non-JSON response. Status ${response.status}.`);
  }
}

function emptyDraft() {
  return {
    id: "",
    title: "",
    wrong_verdict: "",
    correct_verdict: "",
    rule_text: "",
    applies_when: "",
    does_not_apply_when: "",
    example_context: "",
    is_active: false,
    source_dispute_id: "",
    source_conversation_id: "",
  };
}

function sourceLabel(snippet) {
  if (snippet?.source_dispute_id) return "Dispute-generated";
  if (snippet?.generated_by_ai) return "AI draft";
  return "Manual rule";
}

function getSourceConversation(snippet) {
  return normalizeText(snippet?.source_conversation_id || snippet?.source_dispute?.conversation_id || snippet?.source_dispute?.result_id);
}

function getSourceDispute(snippet, approvedDisputes = []) {
  const id = normalizeText(snippet?.source_dispute_id);
  if (!id) return null;
  if (snippet?.source_dispute) return snippet.source_dispute;
  return approvedDisputes.find((item) => item?.id === id) || null;
}

function DetailRow({ label, value, strong = false }) {
  return (
    <div className="calibration-detail-row">
      <span className="calibration-detail-label">{label}</span>
      <strong className={strong ? "calibration-detail-value highlight" : "calibration-detail-value"}>{value || "-"}</strong>
    </div>
  );
}

function TextBlock({ label, value, tone = "default" }) {
  return (
    <div className={tone === "success" ? "calibration-text-block success" : "calibration-text-block"}>
      <span>{label}</span>
      <p>{value || "No details saved."}</p>
    </div>
  );
}

export default function CalibrationSnippetsPanel({ session }) {
  const [snippets, setSnippets] = useState([]);
  const [approvedDisputes, setApprovedDisputes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(emptyDraft());
  const [snippetSearch, setSnippetSearch] = useState("");

  const accessToken = session?.access_token || "";

  const latestSnippetByDispute = useMemo(() => {
    const map = new Map();
    snippets.forEach((snippet) => {
      const disputeId = snippet?.source_dispute_id;
      if (!disputeId) return;
      const existing = map.get(disputeId);
      const currentTime = new Date(snippet?.updated_at || snippet?.created_at || 0).getTime();
      const existingTime = new Date(existing?.updated_at || existing?.created_at || 0).getTime();
      if (!existing || currentTime > existingTime) map.set(disputeId, snippet);
    });
    return map;
  }, [snippets]);

  const unusedApprovedDisputes = useMemo(
    () => approvedDisputes.filter((item) => {
      if (!item?.id) return false;
      const latestSnippet = latestSnippetByDispute.get(item.id);
      if (!latestSnippet) return true;
      const disputeUpdatedAt = new Date(item.updated_at || item.reviewed_at || item.created_at || 0).getTime();
      const snippetUpdatedAt = new Date(latestSnippet.updated_at || latestSnippet.created_at || 0).getTime();
      return disputeUpdatedAt > snippetUpdatedAt;
    }),
    [approvedDisputes, latestSnippetByDispute]
  );

  const activeCount = snippets.filter((item) => item.is_active).length;
  const inactiveCount = snippets.length - activeCount;
  const disputeSourcedCount = snippets.filter((item) => item.source_dispute_id).length;
  const manualCount = snippets.filter((item) => !item.source_dispute_id).length;
  const pendingSourceCount = unusedApprovedDisputes.length;

  const selectedDraftSource = useMemo(() => {
    if (!draft.source_dispute_id) return null;
    return approvedDisputes.find((item) => item?.id === draft.source_dispute_id) || null;
  }, [approvedDisputes, draft.source_dispute_id]);

  const filteredSnippets = useMemo(() => {
    const query = snippetSearch.trim().toLowerCase();
    if (!query) return snippets;
    return snippets.filter((snippet) => {
      const source = getSourceDispute(snippet, approvedDisputes);
      const haystack = [
        snippet.title,
        snippet.rule_text,
        snippet.wrong_verdict,
        snippet.correct_verdict,
        snippet.created_by_email,
        snippet.source_conversation_id,
        source?.conversation_id,
        source?.employee_name,
        source?.employee_email,
        source?.submitted_by_name,
        source?.submitted_by_email,
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [approvedDisputes, snippetSearch, snippets]);

  async function loadData(silent = false) {
    if (!accessToken) return;
    if (!silent) setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/calibration-snippets?include_disputes=approved", {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const data = await readApiJson(response);
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not load calibration snippets.");
      setSnippets(Array.isArray(data.snippets) ? data.snippets : []);
      setApprovedDisputes(Array.isArray(data.approvedDisputes) ? data.approvedDisputes : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load calibration snippets.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  function editSnippet(snippet) {
    setDraft({
      id: snippet.id || "",
      title: snippet.title || "",
      wrong_verdict: snippet.wrong_verdict || "",
      correct_verdict: snippet.correct_verdict || "",
      rule_text: snippet.rule_text || "",
      applies_when: snippet.applies_when || "",
      does_not_apply_when: snippet.does_not_apply_when || "",
      example_context: snippet.example_context || "",
      is_active: snippet.is_active === true,
      source_dispute_id: snippet.source_dispute_id || "",
      source_conversation_id: getSourceConversation(snippet),
    });
    setMessage("Snippet loaded into the editor. Review the source trace before saving.");
    setError("");
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => document.getElementById("snippet-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  async function generateFromDispute(dispute) {
    if (!accessToken || !dispute?.id) return;
    setActionId(`generate:${dispute.id}`);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/calibration-snippets/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ dispute_id: dispute.id }),
      });
      const data = await readApiJson(response);
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not generate snippet.");
      setMessage("AI generated a draft snippet from the approved dispute. Review the source trace and activate only if the rule is safe.");
      if (data.snippet) editSnippet(data.snippet);
      await loadData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate snippet.");
    } finally {
      setActionId("");
    }
  }

  async function saveSnippet() {
    if (!accessToken) return;
    if (!normalizeText(draft.title) || !normalizeText(draft.rule_text)) {
      setError("Snippet title and rule are required.");
      return;
    }

    setActionId("save");
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/calibration-snippets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action: draft.id ? "update" : "create", snippet: draft }),
      });
      const data = await readApiJson(response);
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not save snippet.");
      setMessage(draft.is_active ? "Snippet saved and active for future audits." : "Snippet saved as inactive draft.");
      setDraft(emptyDraft());
      await loadData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save snippet.");
    } finally {
      setActionId("");
    }
  }

  async function toggleSnippet(snippet) {
    if (!accessToken || !snippet?.id) return;
    setActionId(`toggle:${snippet.id}`);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/calibration-snippets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: "toggle_active",
          id: snippet.id,
          is_active: snippet.is_active !== true,
        }),
      });
      const data = await readApiJson(response);
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not update snippet.");
      setMessage(data.snippet?.is_active ? "Snippet activated. Future audits will receive it." : "Snippet deactivated.");
      await loadData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update snippet.");
    } finally {
      setActionId("");
    }
  }

  async function deleteSnippet(snippet) {
    if (!accessToken || !snippet?.id) return;
    const confirmed = window.confirm("Delete this calibration snippet? This cannot be undone.");
    if (!confirmed) return;

    setActionId(`delete:${snippet.id}`);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/calibration-snippets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action: "delete", id: snippet.id }),
      });
      const data = await readApiJson(response);
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not delete snippet.");
      setMessage("Snippet deleted.");
      await loadData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete snippet.");
    } finally {
      setActionId("");
    }
  }

  function renderSourceTraceForDraft() {
    if (selectedDraftSource) {
      return (
        <div className="source-trace-card dispute-source">
          <div className="source-trace-head">
            <div>
              <span className="source-chip">Dispute Source</span>
              <h4>Conversation {selectedDraftSource.conversation_id || selectedDraftSource.result_id || "-"}</h4>
            </div>
            <span className="source-status">Traceable</span>
          </div>
          <div className="source-trace-grid">
            <DetailRow label="Employee" value={selectedDraftSource.employee_name || selectedDraftSource.employee_email} />
            <DetailRow label="Submitted By" value={selectedDraftSource.submitted_by_name || selectedDraftSource.submitted_by_email} />
            <DetailRow label="Reviewed By" value={selectedDraftSource.reviewed_by_name || selectedDraftSource.reviewed_by_email} />
            <DetailRow label="Last Updated" value={formatDateTime(selectedDraftSource.updated_at)} />
            <DetailRow label="Original Verdict" value={selectedDraftSource.current_review_status} />
            <DetailRow label="Corrected Verdict" value={selectedDraftSource.corrected_review_status} strong />
          </div>
          <TextBlock label="Dispute Reason" value={selectedDraftSource.reason || "No dispute reason saved."} />
          {selectedDraftSource.master_admin_decision_note ? <TextBlock label="Master Admin Decision Note" value={selectedDraftSource.master_admin_decision_note} tone="success" /> : null}
        </div>
      );
    }

    if (draft.source_dispute_id || draft.source_conversation_id) {
      return (
        <div className="source-trace-card dispute-source">
          <div className="source-trace-head">
            <div>
              <span className="source-chip">Dispute Source</span>
              <h4>Conversation {draft.source_conversation_id || "Linked dispute"}</h4>
            </div>
            <span className="source-status warning">Partial Trace</span>
          </div>
          <p className="muted tight">This snippet is linked to a dispute source, but the detailed dispute record was not included in the current response.</p>
        </div>
      );
    }

    return (
      <div className="source-trace-card manual-source">
        <div className="source-trace-head">
          <div>
            <span className="source-chip manual">Manual Source</span>
            <h4>Admin-created calibration rule</h4>
          </div>
          <span className="source-status manual">Manual</span>
        </div>
        <p className="muted tight">This rule is not linked to a dispute or chat ID. Use manual snippets for broad calibration guidance only.</p>
      </div>
    );
  }

  return (
    <section className="panel wide calibration-panel" id="calibration-snippets">
      <div className="snippet-hero">
        <div>
          <p className="eyebrow">Master Admin Only</p>
          <h2>Calibration Snippets</h2>
          <p className="muted">
            Manage approved calibration rules that are appended separately to future AI audit runs. Your original prompt remains unchanged.
          </p>
        </div>
        <div className="snippet-head-actions">
          <span className={activeCount ? "status active" : "status inactive"}>{activeCount} Active</span>
          <button type="button" className="secondary-btn" onClick={() => loadData(false)} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh Snippets"}
          </button>
        </div>
      </div>

      <div className="snippet-stat-grid">
        <div className="snippet-stat-card active-card">
          <span>Active Rules</span>
          <strong>{activeCount}</strong>
          <small>Sent to AI in future audits.</small>
        </div>
        <div className="snippet-stat-card source-card">
          <span>Dispute-Sourced</span>
          <strong>{disputeSourcedCount}</strong>
          <small>Linked to approved disputes.</small>
        </div>
        <div className="snippet-stat-card manual-card">
          <span>Manual Rules</span>
          <strong>{manualCount}</strong>
          <small>Created directly by admins.</small>
        </div>
        <div className="snippet-stat-card pending-card">
          <span>Ready To Generate</span>
          <strong>{pendingSourceCount}</strong>
          <small>Approved disputes waiting.</small>
        </div>
      </div>

      {message ? <div className="success-box">{message}</div> : null}
      {error ? <div className="error-box">{error}</div> : null}

      <div className="snippet-workspace">
        <article className="snippet-editor-card" id="snippet-editor">
          <div className="snippet-card-head">
            <div>
              <p className="eyebrow">Snippet Workspace</p>
              <h3>{draft.id ? "Edit Calibration Snippet" : "Create Calibration Snippet"}</h3>
              <p className="muted">Build narrow Review Status rules that improve accuracy without overcorrecting unrelated cases.</p>
            </div>
            {draft.id || draft.title ? <button type="button" className="secondary-btn small-btn" onClick={() => setDraft(emptyDraft())}>Clear Editor</button> : null}
          </div>

          {renderSourceTraceForDraft()}

          <div className="snippet-form-section">
            <div className="form-section-title">
              <span>Rule Setup</span>
              <small>Define the verdict pattern the AI should avoid and the corrected guidance it should apply.</small>
            </div>
            <div className="snippet-form-grid">
              <label className="full-line">
                <span>Snippet Title</span>
                <input value={draft.title} onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))} placeholder="Do not mark simple clarification chats as Missed Opportunity" />
              </label>

              <label>
                <span>Wrong Verdict To Avoid</span>
                <select value={draft.wrong_verdict} onChange={(event) => setDraft((prev) => ({ ...prev, wrong_verdict: event.target.value }))}>
                  <option value="">Select verdict</option>
                  {REVIEW_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>

              <label>
                <span>Correct Verdict Guidance</span>
                <select value={draft.correct_verdict} onChange={(event) => setDraft((prev) => ({ ...prev, correct_verdict: event.target.value }))}>
                  <option value="">Select verdict</option>
                  {REVIEW_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>

              <label className="full-line">
                <span>Core Rule</span>
                <textarea value={draft.rule_text} onChange={(event) => setDraft((prev) => ({ ...prev, rule_text: event.target.value }))} rows={4} placeholder="If the client only asks for policy clarification and the agent gives a direct, correct answer, do not classify it as Missed Opportunity unless there was a clear missed next action." />
              </label>
            </div>
          </div>

          <div className="snippet-form-section boundaries">
            <div className="form-section-title">
              <span>Application Boundaries</span>
              <small>Tell the AI when to use this snippet and when to ignore it.</small>
            </div>
            <div className="snippet-form-grid">
              <label>
                <span>Applies When</span>
                <textarea value={draft.applies_when} onChange={(event) => setDraft((prev) => ({ ...prev, applies_when: event.target.value }))} rows={4} placeholder="Client asks for status/rule clarification; answer is direct and complete; no clear sales, escalation, retention, or follow-up action was available." />
              </label>

              <label>
                <span>Does Not Apply When</span>
                <textarea value={draft.does_not_apply_when} onChange={(event) => setDraft((prev) => ({ ...prev, does_not_apply_when: event.target.value }))} rows={4} placeholder="Client shows buying intent, unresolved frustration, churn risk, incomplete resolution, or escalation need." />
              </label>

              <label className="full-line">
                <span>Example Pattern</span>
                <textarea value={draft.example_context} onChange={(event) => setDraft((prev) => ({ ...prev, example_context: event.target.value }))} rows={3} placeholder="The AI marked the chat as Missed Opportunity, but the conversation only required a direct policy answer and no extra action was reasonably available." />
              </label>
            </div>
          </div>

          <div className="snippet-footer-actions">
            <label className="snippet-toggle-line">
              <input type="checkbox" checked={draft.is_active} onChange={(event) => setDraft((prev) => ({ ...prev, is_active: event.target.checked }))} />
              <span>Activate for future audits</span>
            </label>
            <button type="button" className="primary-btn" onClick={saveSnippet} disabled={Boolean(actionId)}>
              {actionId === "save" ? "Saving..." : draft.id ? "Save Snippet" : "Create Snippet"}
            </button>
          </div>
        </article>

        <article className="snippet-source-card">
          <div className="snippet-card-head">
            <div>
              <p className="eyebrow">Source Queue</p>
              <h3>Approved Disputes Ready for Snippets</h3>
              <p className="muted">Generate rules only from disputes with clear correction logic and enough conversation context.</p>
            </div>
          </div>

          {!unusedApprovedDisputes.length ? (
            <div className="empty-box">No approved disputes are waiting for snippet generation.</div>
          ) : (
            <div className="source-card-list">
              {unusedApprovedDisputes.slice(0, 14).map((dispute) => {
                const previousSnippet = latestSnippetByDispute.get(dispute.id);
                return (
                  <div className="source-dispute-card" key={dispute.id}>
                    <div className="source-dispute-top">
                      <span className="pill success">Approved</span>
                      <strong>{dispute.conversation_id || dispute.result_id || "Conversation"}</strong>
                    </div>
                    <div className="source-mini-grid">
                      <DetailRow label="Employee" value={dispute.employee_name || dispute.employee_email} />
                      <DetailRow label="Submitted By" value={dispute.submitted_by_name || dispute.submitted_by_email} />
                      <DetailRow label="Original" value={dispute.current_review_status} />
                      <DetailRow label="Corrected" value={dispute.corrected_review_status} strong />
                    </div>
                    <TextBlock label="Reason" value={dispute.reason || "No dispute reason saved."} />
                    {dispute.master_admin_decision_note ? <TextBlock label="Decision Note" value={dispute.master_admin_decision_note} tone="success" /> : null}
                    {previousSnippet ? <em className="snippet-refresh-note">This dispute was edited after its last snippet. Regenerate to use the latest correction.</em> : null}
                    <button type="button" className="secondary-btn small-btn" onClick={() => generateFromDispute(dispute)} disabled={Boolean(actionId)}>
                      {actionId === `generate:${dispute.id}` ? "Generating..." : "Generate Snippet"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </article>
      </div>

      <article className="snippet-list-card">
        <div className="snippet-card-head list-head">
          <div>
            <p className="eyebrow">Saved Rule Library</p>
            <h3>Saved Calibration Snippets</h3>
            <p className="muted">Review source lineage, rule intent, activation state, and last update before changing any snippet.</p>
          </div>
          <input className="snippet-search" value={snippetSearch} onChange={(event) => setSnippetSearch(event.target.value)} placeholder="Search title, chat ID, employee, submitter..." />
        </div>

        {!filteredSnippets.length ? (
          <div className="empty-box">No calibration snippets match this view.</div>
        ) : (
          <div className="saved-snippet-list">
            {filteredSnippets.map((snippet) => {
              const source = getSourceDispute(snippet, approvedDisputes);
              const conversationId = getSourceConversation(snippet);
              return (
                <div className="saved-snippet-card" key={snippet.id}>
                  <div className="saved-snippet-head">
                    <div className="saved-snippet-title-block">
                      <div className="saved-snippet-title-row">
                        <span className={snippet.is_active ? "pill success" : "pill warning"}>{snippet.is_active ? "Active" : "Inactive"}</span>
                        <span className={snippet.source_dispute_id ? "source-chip" : "source-chip manual"}>{sourceLabel(snippet)}</span>
                      </div>
                      <h4>{snippet.title || "Untitled snippet"}</h4>
                    </div>
                    <div className="snippet-card-actions">
                      <button type="button" className="secondary-btn small-btn" onClick={() => editSnippet(snippet)}>Edit</button>
                      <button type="button" className="secondary-btn small-btn" onClick={() => toggleSnippet(snippet)} disabled={Boolean(actionId)}>
                        {actionId === `toggle:${snippet.id}` ? "Updating..." : snippet.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <button type="button" className="danger-btn small-btn" onClick={() => deleteSnippet(snippet)} disabled={Boolean(actionId)}>
                        {actionId === `delete:${snippet.id}` ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </div>

                  <div className="verdict-path">
                    <span>{snippet.wrong_verdict || "Any matching wrong verdict"}</span>
                    <strong>→</strong>
                    <span>{snippet.correct_verdict || "Corrected guidance"}</span>
                  </div>

                  <div className="saved-snippet-body">
                    <TextBlock label="Core Rule" value={snippet.rule_text || "No rule text saved."} />
                    <div className="saved-source-panel">
                      {source ? (
                        <>
                          <DetailRow label="Source Chat ID" value={source.conversation_id || source.result_id || conversationId} strong />
                          <DetailRow label="Employee" value={source.employee_name || source.employee_email} />
                          <DetailRow label="Submitted By" value={source.submitted_by_name || source.submitted_by_email} />
                          <DetailRow label="Reviewed By" value={source.reviewed_by_name || source.reviewed_by_email} />
                        </>
                      ) : snippet.source_dispute_id ? (
                        <>
                          <DetailRow label="Source Chat ID" value={conversationId || "Linked dispute record"} strong />
                          <DetailRow label="Source Note" value="Linked to a dispute, but detailed dispute metadata was not returned in this view." />
                        </>
                      ) : (
                        <>
                          <DetailRow label="Source" value="Manual admin-created snippet" strong />
                          <DetailRow label="Trace Note" value="No dispute or chat source is attached because this rule was added directly by an admin." />
                        </>
                      )}
                      <DetailRow label="Created By" value={snippet.created_by_name || snippet.created_by_email || "-"} />
                      <DetailRow label="Updated" value={formatDateTime(snippet.updated_at)} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </article>

      <style jsx global>{`
        .calibration-panel {
          display: grid;
          gap: 22px;
        }
        .calibration-panel .snippet-hero {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          padding: 24px;
          border: 1px solid rgba(96, 165, 250, 0.18);
          border-radius: 26px;
          background: linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(28, 25, 63, 0.62));
          box-shadow: 0 24px 80px rgba(15, 23, 42, 0.34);
        }
        .calibration-panel .snippet-head-actions {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .calibration-panel .snippet-stat-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }
        .calibration-panel .snippet-stat-card {
          border-radius: 20px;
          border: 1px solid rgba(148, 163, 255, 0.14);
          padding: 16px;
          background: rgba(15, 23, 42, 0.7);
          display: grid;
          gap: 7px;
          min-height: 112px;
        }
        .calibration-panel .snippet-stat-card span {
          color: #9fb3ff;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.13em;
          text-transform: uppercase;
        }
        .calibration-panel .snippet-stat-card strong {
          font-size: 30px;
          color: #ffffff;
          line-height: 1;
        }
        .calibration-panel .snippet-stat-card small {
          color: #b8c7f4;
          line-height: 1.4;
        }
        .calibration-panel .active-card { background: linear-gradient(135deg, rgba(16, 185, 129, 0.16), rgba(15, 23, 42, 0.72)); }
        .calibration-panel .source-card { background: linear-gradient(135deg, rgba(59, 130, 246, 0.16), rgba(15, 23, 42, 0.72)); }
        .calibration-panel .manual-card { background: linear-gradient(135deg, rgba(168, 85, 247, 0.14), rgba(15, 23, 42, 0.72)); }
        .calibration-panel .pending-card { background: linear-gradient(135deg, rgba(245, 158, 11, 0.13), rgba(15, 23, 42, 0.72)); }
        .calibration-panel .snippet-workspace {
          display: grid;
          grid-template-columns: minmax(0, 1.28fr) minmax(360px, 0.72fr);
          gap: 18px;
          align-items: start;
        }
        .calibration-panel .snippet-editor-card,
        .calibration-panel .snippet-source-card,
        .calibration-panel .snippet-list-card {
          border: 1px solid rgba(148, 163, 255, 0.14);
          border-radius: 24px;
          padding: 20px;
          background: rgba(2, 6, 23, 0.34);
        }
        .calibration-panel .snippet-source-card {
          max-height: 760px;
          overflow: auto;
        }
        .calibration-panel .snippet-card-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 18px;
        }
        .calibration-panel .snippet-card-head h3 {
          margin-top: 2px;
        }
        .calibration-panel .muted.tight {
          margin: 0;
          line-height: 1.45;
        }
        .calibration-panel .source-trace-card {
          margin-bottom: 18px;
          border-radius: 20px;
          border: 1px solid rgba(96, 165, 250, 0.2);
          padding: 16px;
          background: rgba(8, 13, 28, 0.72);
        }
        .calibration-panel .source-trace-card.manual-source {
          border-color: rgba(168, 85, 247, 0.22);
          background: rgba(30, 22, 55, 0.42);
        }
        .calibration-panel .source-trace-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 14px;
        }
        .calibration-panel .source-trace-head h4 {
          margin: 7px 0 0;
          color: #ffffff;
          font-size: 17px;
        }
        .calibration-panel .source-chip,
        .calibration-panel .source-status {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          border-radius: 999px;
          padding: 5px 9px;
          border: 1px solid rgba(96, 165, 250, 0.26);
          background: rgba(37, 99, 235, 0.16);
          color: #bfdbfe;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .calibration-panel .source-chip.manual,
        .calibration-panel .source-status.manual {
          border-color: rgba(168, 85, 247, 0.26);
          background: rgba(168, 85, 247, 0.12);
          color: #e9d5ff;
        }
        .calibration-panel .source-status.warning {
          border-color: rgba(245, 158, 11, 0.28);
          background: rgba(245, 158, 11, 0.12);
          color: #fde68a;
        }
        .calibration-panel .source-trace-grid,
        .calibration-panel .source-mini-grid,
        .calibration-panel .saved-source-panel {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .calibration-panel .calibration-detail-row {
          border: 1px solid rgba(148, 163, 255, 0.1);
          border-radius: 14px;
          padding: 10px 11px;
          background: rgba(15, 23, 42, 0.56);
          display: grid;
          gap: 6px;
          min-width: 0;
        }
        .calibration-panel .calibration-detail-label {
          display: block;
          color: #9fb3ff;
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          line-height: 1.2;
        }
        .calibration-panel .calibration-detail-value {
          display: block;
          color: #edf4ff;
          font-size: 13px;
          line-height: 1.35;
          word-break: break-word;
        }
        .calibration-panel .calibration-detail-value.highlight {
          color: #d9f99d;
        }
        .calibration-panel .calibration-text-block {
          margin-top: 12px;
          border: 1px solid rgba(148, 163, 255, 0.1);
          border-radius: 15px;
          padding: 12px;
          background: rgba(2, 6, 23, 0.45);
        }
        .calibration-panel .calibration-text-block.success {
          border-color: rgba(16, 185, 129, 0.16);
          background: rgba(6, 78, 59, 0.14);
        }
        .calibration-panel .calibration-text-block span {
          color: #9fb3ff;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .calibration-panel .calibration-text-block p {
          margin: 7px 0 0;
          color: #dbe7ff;
          line-height: 1.55;
          font-size: 13px;
        }
        .calibration-panel .snippet-form-section {
          border: 1px solid rgba(148, 163, 255, 0.11);
          border-radius: 18px;
          padding: 15px;
          background: rgba(15, 23, 42, 0.34);
          margin-bottom: 14px;
        }
        .calibration-panel .snippet-form-section.boundaries {
          background: rgba(8, 13, 28, 0.4);
        }
        .calibration-panel .form-section-title {
          display: grid;
          gap: 5px;
          margin-bottom: 12px;
        }
        .calibration-panel .form-section-title span {
          color: #ffffff;
          font-weight: 900;
          font-size: 15px;
        }
        .calibration-panel .form-section-title small {
          color: #94a3b8;
          line-height: 1.4;
        }
        .calibration-panel .snippet-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        .calibration-panel .snippet-form-grid label {
          display: grid;
          gap: 7px;
        }
        .calibration-panel .snippet-form-grid label.full-line {
          grid-column: 1 / -1;
        }
        .calibration-panel .snippet-form-grid label span,
        .calibration-panel .snippet-toggle-line span {
          color: #a9bcff;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .calibration-panel .snippet-form-grid input,
        .calibration-panel .snippet-form-grid select,
        .calibration-panel .snippet-form-grid textarea,
        .calibration-panel .snippet-search {
          width: 100%;
          border: 1px solid rgba(148, 163, 255, 0.2);
          border-radius: 14px;
          padding: 11px 12px;
          background: rgba(2, 6, 23, 0.62);
          color: #f8fbff;
          outline: none;
          font: inherit;
        }
        .calibration-panel .snippet-form-grid textarea {
          resize: vertical;
          line-height: 1.45;
        }
        .calibration-panel .snippet-footer-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 16px;
          padding-top: 16px;
          border-top: 1px solid rgba(148, 163, 255, 0.12);
        }
        .calibration-panel .snippet-toggle-line {
          display: flex !important;
          align-items: center;
          gap: 10px !important;
        }
        .calibration-panel .snippet-toggle-line input {
          width: auto;
        }
        .calibration-panel .source-card-list {
          display: grid;
          gap: 12px;
        }
        .calibration-panel .source-dispute-card {
          border-radius: 18px;
          border: 1px solid rgba(148, 163, 255, 0.14);
          padding: 14px;
          background: rgba(15, 23, 42, 0.62);
          display: grid;
          gap: 12px;
        }
        .calibration-panel .source-dispute-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .calibration-panel .source-dispute-top strong {
          color: #ffffff;
          word-break: break-word;
        }
        .calibration-panel .snippet-refresh-note {
          color: #fde68a;
          font-size: 12px;
          font-style: normal;
          line-height: 1.45;
        }
        .calibration-panel .list-head {
          display: grid;
          grid-template-columns: 1fr minmax(280px, 420px);
          gap: 16px;
          align-items: end;
        }
        .calibration-panel .saved-snippet-list {
          display: grid;
          gap: 18px;
        }
        .calibration-panel .saved-snippet-card {
          display: grid;
          gap: 15px;
          padding: 18px;
          border-radius: 22px;
          border: 1px solid rgba(148, 163, 255, 0.13);
          background: linear-gradient(135deg, rgba(15, 23, 42, 0.68), rgba(17, 24, 39, 0.52));
        }
        .calibration-panel .saved-snippet-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }
        .calibration-panel .saved-snippet-title-block {
          display: grid;
          gap: 9px;
          min-width: 0;
        }
        .calibration-panel .saved-snippet-title-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .calibration-panel .saved-snippet-card h4 {
          margin: 0;
          font-size: 19px;
          color: #ffffff;
          line-height: 1.25;
        }
        .calibration-panel .verdict-path {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .calibration-panel .verdict-path span {
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 255, 0.16);
          background: rgba(2, 6, 23, 0.52);
          padding: 6px 10px;
          color: #dbeafe;
          font-size: 12px;
          font-weight: 800;
        }
        .calibration-panel .verdict-path strong {
          color: #a78bfa;
        }
        .calibration-panel .saved-snippet-body {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(320px, 0.9fr);
          gap: 14px;
          align-items: start;
        }
        .calibration-panel .saved-source-panel {
          margin-top: 0;
        }
        .calibration-panel .snippet-card-actions {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
          min-width: 240px;
        }
        @media (max-width: 1180px) {
          .calibration-panel .snippet-workspace,
          .calibration-panel .saved-snippet-body {
            grid-template-columns: 1fr;
          }
          .calibration-panel .snippet-stat-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .calibration-panel .saved-snippet-head {
            flex-direction: column;
          }
          .calibration-panel .snippet-card-actions {
            min-width: 0;
            justify-content: flex-start;
          }
        }
        @media (max-width: 760px) {
          .calibration-panel .snippet-hero,
          .calibration-panel .source-trace-head {
            flex-direction: column;
            align-items: flex-start;
          }
          .calibration-panel .snippet-stat-grid,
          .calibration-panel .snippet-form-grid,
          .calibration-panel .source-trace-grid,
          .calibration-panel .source-mini-grid,
          .calibration-panel .saved-source-panel,
          .calibration-panel .list-head {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}
