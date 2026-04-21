"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

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

function getHistoryLabel(item) {
  if (item?.prompt_type === "live_prompt") return "Live Prompt Update";
  if (item?.prompt_type === "original_prompt") return "Original Prompt Record";
  return item?.prompt_type || "Prompt Change";
}

export default function AdminPage() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadSuccess, setLoadSuccess] = useState("");

  const [dbReady, setDbReady] = useState(false);
  const [promptData, setPromptData] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);

  const [livePromptInput, setLivePromptInput] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");

  async function loadPromptData(activeSession) {
    setLoading(true);
    setLoadError("");
    setLoadSuccess("");

    try {
      if (!activeSession?.access_token) {
        setLoadError("Please sign in first so Admin can load the prompt settings.");
        setPromptData(null);
        setHistoryRows([]);
        setDbReady(false);
        return;
      }

      const response = await fetch("/api/admin/prompt", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${activeSession.access_token}`,
        },
      });

      const data = await response.json();

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Could not load Admin prompt settings.");
      }

      setPromptData(data.prompt || null);
      setHistoryRows(Array.isArray(data.history) ? data.history : []);
      setDbReady(Boolean(data.dbReady));
      setLivePromptInput(data?.prompt?.livePrompt || "");
      setLoadSuccess("Admin prompt settings loaded successfully.");
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Could not load Admin prompt settings."
      );
      setPromptData(null);
      setHistoryRows([]);
      setDbReady(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function init() {
      try {
        const {
          data: { session: currentSession },
        } = await supabase.auth.getSession();

        if (!active) return;

        setSession(currentSession ?? null);

        if (currentSession?.access_token) {
          await loadPromptData(currentSession);
        } else {
          setLoading(false);
        }
      } catch (_error) {
        if (!active) return;
        setLoading(false);
        setLoadError("Could not complete session check for Admin.");
      }
    }

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!active) return;

      setSession(newSession ?? null);
      setSaveError("");
      setSaveSuccess("");

      if (newSession?.access_token) {
        await loadPromptData(newSession);
      } else {
        setPromptData(null);
        setHistoryRows([]);
        setLivePromptInput("");
        setDbReady(false);
        setLoading(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleReload() {
    setSaveError("");
    setSaveSuccess("");
    await loadPromptData(session);
  }

  async function handleSavePrompt() {
    setSaveError("");
    setSaveSuccess("");

    if (!session?.access_token) {
      setSaveError("Please sign in first so Admin can save prompt settings.");
      return;
    }

    if (!livePromptInput.trim()) {
      setSaveError("Live prompt cannot be empty.");
      return;
    }

    setSaveLoading(true);

    try {
      const response = await fetch("/api/admin/prompt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          livePrompt: livePromptInput,
          changeNote,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Could not save the live prompt.");
      }

      setPromptData(data.prompt || null);
      setHistoryRows(Array.isArray(data.history) ? data.history : []);
      setDbReady(Boolean(data.dbReady));
      setLivePromptInput(data?.prompt?.livePrompt || livePromptInput);
      setChangeNote("");
      setSaveSuccess(data?.message || "Live prompt saved successfully.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save the live prompt.");
    } finally {
      setSaveLoading(false);
    }
  }

  const statusCards = useMemo(
    () => [
      {
        label: "Database Status",
        value: dbReady ? "Prompt Tables Ready" : "Waiting for Prompt Tables",
        subtext: dbReady
          ? "Supabase prompt storage is connected"
          : "Prompt storage is not ready yet",
      },
      {
        label: "Prompt Source",
        value: promptData?.promptKey ? "Admin API Connected" : "No Prompt Loaded",
        subtext: promptData?.promptKey
          ? `Prompt key: ${promptData.promptKey}`
          : "Load Admin prompt settings to continue",
      },
      {
        label: "Last Updated",
        value: promptData?.updatedAt ? formatDateTime(promptData.updatedAt) : "Not Updated Yet",
        subtext: promptData?.updatedByEmail
          ? `By ${promptData.updatedByEmail}`
          : "No admin update recorded yet",
      },
      {
        label: "History Entries",
        value: String(historyRows.length),
        subtext: historyRows.length
          ? "Recent prompt changes are available below"
          : "No prompt history has been saved yet",
      },
    ],
    [dbReady, promptData, historyRows]
  );

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(59,130,246,0.16), transparent 22%), radial-gradient(circle at top right, rgba(168,85,247,0.14), transparent 20%), radial-gradient(circle at bottom center, rgba(6,182,212,0.08), transparent 22%), linear-gradient(180deg, #040714 0%, #060b1d 45%, #04060d 100%)",
        color: "#f5f7ff",
        padding: "32px 20px 60px",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "16px",
            padding: "18px 20px",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(9, 13, 29, 0.72)",
            backdropFilter: "blur(14px)",
            borderRadius: "22px",
            boxShadow: "0 10px 40px rgba(0,0,0,0.35)",
            marginBottom: "28px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "12px",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "#8ea0d6",
                marginBottom: "8px",
              }}
            >
              NEXT Ventures
            </div>
            <div
              style={{
                fontSize: "24px",
                fontWeight: 700,
                letterSpacing: "-0.03em",
              }}
            >
              Review Approach &amp; Client Sentiment Tracking
            </div>
          </div>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 14px",
              borderRadius: "999px",
              border: "1px solid rgba(96,165,250,0.25)",
              background:
                "linear-gradient(135deg, rgba(37,99,235,0.18), rgba(168,85,247,0.14))",
              color: "#dbe7ff",
              fontSize: "14px",
              fontWeight: 600,
              boxShadow: "0 0 24px rgba(59,130,246,0.15)",
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "999px",
                background: "#34d399",
                boxShadow: "0 0 12px #34d399",
                display: "inline-block",
              }}
            />
            Admin
          </div>
        </div>

        <section
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background:
              "linear-gradient(180deg, rgba(15,22,43,0.9), rgba(7,10,24,0.96))",
            borderRadius: "28px",
            padding: "32px",
            boxShadow:
              "0 20px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 12px",
              borderRadius: "999px",
              background: "rgba(99,102,241,0.14)",
              border: "1px solid rgba(129,140,248,0.2)",
              color: "#cdd7ff",
              fontSize: "12px",
              fontWeight: 600,
              marginBottom: "18px",
            }}
          >
            Premium Internal Tool
          </div>

          <h1
            style={{
              fontSize: "54px",
              lineHeight: 1.02,
              letterSpacing: "-0.05em",
              margin: "0 0 18px",
              maxWidth: "860px",
            }}
          >
            Admin control center for prompt management, audit settings, and system controls.
          </h1>

          <p
            style={{
              margin: 0,
              color: "#a9b4d0",
              fontSize: "18px",
              lineHeight: 1.7,
              maxWidth: "860px",
            }}
          >
            This page now connects to the Admin prompt API and is the control center
            for your original trusted prompt, the live prompt in use, and the
            timestamped prompt history.
          </p>
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: "18px",
            marginBottom: "24px",
          }}
        >
          {statusCards.map((card) => (
            <div
              key={card.label}
              style={{
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(9, 13, 28, 0.84)",
                borderRadius: "22px",
                padding: "22px",
                boxShadow:
                  "0 14px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.03)",
              }}
            >
              <div
                style={{
                  color: "#8ea0d6",
                  fontSize: "12px",
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  marginBottom: "10px",
                }}
              >
                {card.label}
              </div>
              <div
                style={{
                  fontSize: "20px",
                  fontWeight: 700,
                  marginBottom: "8px",
                }}
              >
                {card.value}
              </div>
              <div
                style={{
                  color: "#a9b4d0",
                  fontSize: "14px",
                  lineHeight: 1.6,
                }}
              >
                {card.subtext}
              </div>
            </div>
          ))}
        </section>

        {(loadError || loadSuccess || saveError || saveSuccess) && (
          <div style={{ display: "grid", gap: "12px", marginBottom: "24px" }}>
            {(loadError || saveError) && (
              <div
                style={{
                  borderRadius: "18px",
                  border: "1px solid rgba(244,63,94,0.22)",
                  background: "rgba(244,63,94,0.08)",
                  padding: "14px 16px",
                  color: "#fecdd3",
                  fontSize: "14px",
                  lineHeight: 1.6,
                }}
              >
                {saveError || loadError}
              </div>
            )}

            {(loadSuccess || saveSuccess) && (
              <div
                style={{
                  borderRadius: "18px",
                  border: "1px solid rgba(16,185,129,0.22)",
                  background: "rgba(16,185,129,0.08)",
                  padding: "14px 16px",
                  color: "#bbf7d0",
                  fontSize: "14px",
                  lineHeight: 1.6,
                }}
              >
                {saveSuccess || loadSuccess}
              </div>
            )}
          </div>
        )}

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: "18px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              border: "1px solid rgba(255,255,255,0.08)",
              background:
                "linear-gradient(180deg, rgba(10,15,32,0.9), rgba(7,10,22,0.96))",
              borderRadius: "24px",
              padding: "24px",
              boxShadow:
                "0 18px 40px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.03)",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                color: "#8ea0d6",
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                marginBottom: "10px",
              }}
            >
              Prompt Source
            </div>

            <div
              style={{
                fontSize: "26px",
                fontWeight: 700,
                lineHeight: 1.15,
                marginBottom: "10px",
              }}
            >
              Original Trusted Prompt
            </div>

            <div
              style={{
                color: "#a9b4d0",
                fontSize: "15px",
                lineHeight: 1.7,
                marginBottom: "16px",
              }}
            >
              This section preserves your trusted original audit prompt exactly as the
              Admin system loaded it.
            </div>

            <textarea
              value={promptData?.originalTrustedPrompt || ""}
              readOnly
              style={{
                width: "100%",
                minHeight: "420px",
                borderRadius: "18px",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(5,8,18,0.9)",
                color: "#dbe7ff",
                padding: "18px",
                fontSize: "14px",
                lineHeight: 1.7,
                outline: "none",
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div
            style={{
              border: "1px solid rgba(255,255,255,0.08)",
              background:
                "linear-gradient(180deg, rgba(10,15,32,0.9), rgba(7,10,22,0.96))",
              borderRadius: "24px",
              padding: "24px",
              boxShadow:
                "0 18px 40px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.03)",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                color: "#8ea0d6",
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                marginBottom: "10px",
              }}
            >
              Live Configuration
            </div>

            <div
              style={{
                fontSize: "26px",
                fontWeight: 700,
                lineHeight: 1.15,
                marginBottom: "10px",
              }}
            >
              Live Prompt in Use
            </div>

            <div
              style={{
                color: "#a9b4d0",
                fontSize: "15px",
                lineHeight: 1.7,
                marginBottom: "16px",
              }}
            >
              Update the live prompt here. The audit tool should later use this saved
              version instead of depending on hardcoded prompt text.
            </div>

            <textarea
              value={livePromptInput}
              onChange={(e) => setLivePromptInput(e.target.value)}
              placeholder="The live prompt will appear here once loaded."
              style={{
                width: "100%",
                minHeight: "340px",
                borderRadius: "18px",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(5,8,18,0.9)",
                color: "#e7ecff",
                padding: "18px",
                fontSize: "14px",
                lineHeight: 1.7,
                outline: "none",
                resize: "vertical",
                boxSizing: "border-box",
                marginBottom: "14px",
              }}
            />

            <textarea
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder="Optional change note, such as why this prompt was updated."
              style={{
                width: "100%",
                minHeight: "88px",
                borderRadius: "18px",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(5,8,18,0.9)",
                color: "#e7ecff",
                padding: "16px",
                fontSize: "14px",
                lineHeight: 1.7,
                outline: "none",
                resize: "vertical",
                boxSizing: "border-box",
                marginBottom: "14px",
              }}
            />

            <div
              style={{
                display: "flex",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={handleReload}
                disabled={loading || saveLoading}
                style={{
                  borderRadius: "16px",
                  padding: "14px 18px",
                  fontSize: "14px",
                  fontWeight: 700,
                  color: loading || saveLoading ? "rgba(229,235,255,0.45)" : "#e5ebff",
                  cursor: loading || saveLoading ? "not-allowed" : "pointer",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  opacity: loading || saveLoading ? 0.6 : 1,
                }}
              >
                {loading ? "Loading..." : "Reload Prompt"}
              </button>

              <button
                type="button"
                onClick={handleSavePrompt}
                disabled={loading || saveLoading || !livePromptInput.trim()}
                style={{
                  border: "none",
                  borderRadius: "16px",
                  padding: "14px 20px",
                  fontSize: "14px",
                  fontWeight: 700,
                  color:
                    loading || saveLoading || !livePromptInput.trim()
                      ? "rgba(255,255,255,0.5)"
                      : "#ffffff",
                  cursor:
                    loading || saveLoading || !livePromptInput.trim()
                      ? "not-allowed"
                      : "pointer",
                  background:
                    loading || saveLoading || !livePromptInput.trim()
                      ? "rgba(255,255,255,0.03)"
                      : "linear-gradient(135deg, #2563eb 0%, #7c3aed 50%, #db2777 100%)",
                  boxShadow:
                    loading || saveLoading || !livePromptInput.trim()
                      ? "none"
                      : "0 14px 30px rgba(91,33,182,0.35)",
                  opacity: loading || saveLoading || !livePromptInput.trim() ? 0.6 : 1,
                }}
              >
                {saveLoading ? "Saving..." : "Save Live Prompt"}
              </button>
            </div>
          </div>
        </section>

        <section
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background:
              "linear-gradient(180deg, rgba(10,15,32,0.9), rgba(7,10,22,0.96))",
            borderRadius: "24px",
            padding: "24px",
            boxShadow:
              "0 18px 40px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.03)",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              color: "#8ea0d6",
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              marginBottom: "10px",
            }}
          >
            Prompt History
          </div>

          <div
            style={{
              fontSize: "26px",
              fontWeight: 700,
              lineHeight: 1.15,
              marginBottom: "10px",
            }}
          >
            Timestamped Change Log
          </div>

          <div
            style={{
              color: "#a9b4d0",
              fontSize: "15px",
              lineHeight: 1.7,
              marginBottom: "18px",
            }}
          >
            Every live prompt save should appear here with the exact timestamp and the
            admin email that made the change.
          </div>

          {historyRows.length === 0 ? (
            <div
              style={{
                borderRadius: "18px",
                border: "1px dashed rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.02)",
                padding: "20px",
                color: "#a9b4d0",
                fontSize: "14px",
                lineHeight: 1.7,
              }}
            >
              No prompt history has been recorded yet.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gap: "14px",
                maxHeight: "540px",
                overflowY: "auto",
                paddingRight: "4px",
              }}
            >
              {historyRows.map((item, index) => (
                <div
                  key={item?.id || `history-${index}`}
                  style={{
                    borderRadius: "18px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    padding: "18px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "12px",
                      flexWrap: "wrap",
                      marginBottom: "12px",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: "#8ea0d6",
                          textTransform: "uppercase",
                          letterSpacing: "0.12em",
                          marginBottom: "6px",
                        }}
                      >
                        Change Type
                      </div>
                      <div style={{ fontSize: "18px", fontWeight: 700 }}>
                        {getHistoryLabel(item)}
                      </div>
                    </div>

                    <div
                      style={{
                        borderRadius: "999px",
                        border: "1px solid rgba(96,165,250,0.22)",
                        background: "rgba(96,165,250,0.1)",
                        padding: "8px 12px",
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#bfdbfe",
                        alignSelf: "flex-start",
                      }}
                    >
                      {formatDateTime(item?.changed_at)}
                    </div>
                  </div>

                  <div
                    style={{
                      color: "#d8e2ff",
                      fontSize: "14px",
                      lineHeight: 1.7,
                      marginBottom: "12px",
                    }}
                  >
                    <strong>Changed by:</strong> {item?.changed_by_email || "-"}
                    <br />
                    <strong>Note:</strong> {item?.change_note || "No change note provided."}
                  </div>

                  <textarea
                    value={item?.prompt_text || ""}
                    readOnly
                    style={{
                      width: "100%",
                      minHeight: "180px",
                      borderRadius: "16px",
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(5,8,18,0.9)",
                      color: "#dbe7ff",
                      padding: "16px",
                      fontSize: "13px",
                      lineHeight: 1.7,
                      outline: "none",
                      resize: "vertical",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
