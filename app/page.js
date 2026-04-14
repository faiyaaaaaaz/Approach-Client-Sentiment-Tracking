"use client";

import { useMemo, useState } from "react";

export default function HomePage() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [limiterEnabled, setLimiterEnabled] = useState(true);
  const [limitCount, setLimitCount] = useState("10");

  const statCards = [
    {
      label: "Authentication",
      value: "Google + Domain Gate",
      subtext: "Only nextventures.io users can enter",
    },
    {
      label: "Access Control",
      value: "Master Admin Locked",
      subtext: "faiyaz@nextventures.io stays permanent admin",
    },
    {
      label: "Storage",
      value: "Supabase",
      subtext: "Results, users, roles, settings, prompts",
    },
    {
      label: "AI Processing",
      value: "GPT API",
      subtext: "Editable prompt with structured audit output",
    },
  ];

  const controlCards = [
    {
      eyebrow: "Access Model",
      title: "Google login + nextventures.io restriction",
      description:
        "Only approved users with a @nextventures.io email will be allowed into the system.",
    },
    {
      eyebrow: "Admin Control",
      title: "Master admin + test runner permissions",
      description:
        "You will stay the permanent master admin, and the admin panel will control who can run tests during development.",
    },
    {
      eyebrow: "Development Limiter",
      title: "Run only the number you choose",
      description:
        "When limiter is on, a number box will appear and GPT will process only that many conversations. When limiter is off, it will process all eligible conversations.",
    },
    {
      eyebrow: "Prompt Control",
      title: "Edit the live GPT prompt from admin",
      description:
        "The active prompt will be stored in Supabase so you can update it later without changing code.",
    },
  ];

  const summaryText = useMemo(() => {
    if (!startDate && !endDate) {
      return "Choose a start date and end date to prepare a controlled audit run.";
    }

    if (startDate && !endDate) {
      return `Start date selected: ${startDate}. Now choose the end date.`;
    }

    if (!startDate && endDate) {
      return `End date selected: ${endDate}. Now choose the start date.`;
    }

    if (limiterEnabled) {
      return `Ready to run conversations from ${startDate} to ${endDate} with limiter enabled for ${limitCount || "0"} conversation(s).`;
    }

    return `Ready to run all eligible conversations from ${startDate} to ${endDate} with limiter turned off.`;
  }, [startDate, endDate, limiterEnabled, limitCount]);

  const inputBaseStyle = {
    width: "100%",
    height: "52px",
    borderRadius: "14px",
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(5,8,18,0.92)",
    color: "#e7ecff",
    padding: "0 16px",
    fontSize: "15px",
    outline: "none",
    boxSizing: "border-box",
  };

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
            V1 Build in Progress
          </div>
        </div>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.35fr) minmax(320px, 0.85fr)",
            gap: "24px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              border: "1px solid rgba(255,255,255,0.08)",
              background:
                "linear-gradient(180deg, rgba(15,22,43,0.9), rgba(7,10,24,0.96))",
              borderRadius: "28px",
              padding: "32px",
              boxShadow:
                "0 20px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)",
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
                maxWidth: "780px",
              }}
            >
              Audit Intercom conversations by date range with controlled GPT execution.
            </h1>

            <p
              style={{
                margin: "0 0 28px",
                color: "#a9b4d0",
                fontSize: "18px",
                lineHeight: 1.7,
                maxWidth: "760px",
              }}
            >
              This dashboard will let approved NEXT Ventures users sign in,
              select a date range, control the development limiter, process
              Intercom conversations with GPT, and store every result inside
              Supabase.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: "14px",
                marginBottom: "14px",
              }}
            >
              <div
                style={{
                  borderRadius: "18px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  padding: "16px",
                }}
              >
                <label
                  htmlFor="start-date"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    color: "#8ea0d6",
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    marginBottom: "8px",
                  }}
                >
                  Start Date
                </label>
                <input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  style={inputBaseStyle}
                />
              </div>

              <div
                style={{
                  borderRadius: "18px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  padding: "16px",
                }}
              >
                <label
                  htmlFor="end-date"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    color: "#8ea0d6",
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    marginBottom: "8px",
                  }}
                >
                  End Date
                </label>
                <input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={inputBaseStyle}
                />
              </div>
            </div>

            <div
              style={{
                borderRadius: "18px",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.03)",
                padding: "16px",
                marginBottom: "14px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "16px",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#8ea0d6",
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                      marginBottom: "8px",
                    }}
                  >
                    Development Limiter
                  </div>
                  <div
                    style={{
                      color: "#e7ecff",
                      fontSize: "16px",
                      fontWeight: 600,
                    }}
                  >
                    {limiterEnabled ? "Limiter is ON" : "Limiter is OFF"}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setLimiterEnabled((prev) => !prev)}
                  style={{
                    position: "relative",
                    width: "72px",
                    height: "40px",
                    borderRadius: "999px",
                    border: limiterEnabled
                      ? "1px solid rgba(96,165,250,0.45)"
                      : "1px solid rgba(255,255,255,0.12)",
                    background: limiterEnabled
                      ? "linear-gradient(135deg, rgba(37,99,235,0.9), rgba(168,85,247,0.85))"
                      : "rgba(255,255,255,0.08)",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: "4px",
                      left: limiterEnabled ? "36px" : "4px",
                      width: "30px",
                      height: "30px",
                      borderRadius: "999px",
                      background: "#ffffff",
                      boxShadow: "0 6px 14px rgba(0,0,0,0.35)",
                      transition: "left 0.2s ease",
                    }}
                  />
                </button>
              </div>
            </div>

            {limiterEnabled && (
              <div
                style={{
                  borderRadius: "18px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  padding: "16px",
                  marginBottom: "20px",
                }}
              >
                <label
                  htmlFor="limit-count"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    color: "#8ea0d6",
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    marginBottom: "8px",
                  }}
                >
                  Number of Conversations to Run
                </label>
                <input
                  id="limit-count"
                  type="number"
                  min="1"
                  step="1"
                  value={limitCount}
                  onChange={(e) => setLimitCount(e.target.value)}
                  placeholder="Enter a number"
                  style={inputBaseStyle}
                />
              </div>
            )}

            <div
              style={{
                display: "flex",
                gap: "14px",
                flexWrap: "wrap",
                marginBottom: "22px",
              }}
            >
              <button
                type="button"
                style={{
                  border: "none",
                  borderRadius: "16px",
                  padding: "14px 20px",
                  fontSize: "15px",
                  fontWeight: 700,
                  color: "#ffffff",
                  cursor: "pointer",
                  background:
                    "linear-gradient(135deg, #2563eb 0%, #7c3aed 50%, #db2777 100%)",
                  boxShadow: "0 14px 30px rgba(91,33,182,0.35)",
                }}
              >
                Run Audit
              </button>

              <button
                type="button"
                style={{
                  borderRadius: "16px",
                  padding: "14px 20px",
                  fontSize: "15px",
                  fontWeight: 700,
                  color: "#e5ebff",
                  cursor: "pointer",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                Open Admin Panel
              </button>
            </div>

            <div
              style={{
                borderRadius: "22px",
                border: "1px solid rgba(255,255,255,0.08)",
                background:
                  "linear-gradient(180deg, rgba(8,12,27,0.9), rgba(10,14,30,0.95))",
                padding: "22px",
              }}
            >
              <div
                style={{
                  fontSize: "13px",
                  color: "#8ea0d6",
                  marginBottom: "12px",
                }}
              >
                Current run summary
              </div>

              <div
                style={{
                  color: "#d8e2ff",
                  fontSize: "15px",
                  lineHeight: 1.7,
                }}
              >
                {summaryText}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: "18px" }}>
            {controlCards.map((card) => (
              <div
                key={card.title}
                style={{
                  border: "1px solid rgba(255,255,255,0.08)",
                  background:
                    "linear-gradient(180deg, rgba(14,20,40,0.9), rgba(8,12,26,0.95))",
                  borderRadius: "24px",
                  padding: "22px",
                  boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
                }}
              >
                <div
                  style={{
                    color: "#8ea0d6",
                    fontSize: "13px",
                    marginBottom: "8px",
                  }}
                >
                  {card.eyebrow}
                </div>
                <div
                  style={{
                    fontSize: "22px",
                    fontWeight: 700,
                    marginBottom: "8px",
                  }}
                >
                  {card.title}
                </div>
                <p
                  style={{
                    margin: 0,
                    color: "#a9b4d0",
                    lineHeight: 1.7,
                    fontSize: "15px",
                  }}
                >
                  {card.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: "18px",
          }}
        >
          {statCards.map((item) => (
            <div
              key={item.label}
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
                {item.label}
              </div>
              <div
                style={{
                  fontSize: "20px",
                  fontWeight: 700,
                  marginBottom: "8px",
                }}
              >
                {item.value}
              </div>
              <div
                style={{
                  color: "#a9b4d0",
                  fontSize: "14px",
                  lineHeight: 1.6,
                }}
              >
                {item.subtext}
              </div>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
