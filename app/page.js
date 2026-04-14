export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(59,130,246,0.18), transparent 25%), radial-gradient(circle at top right, rgba(168,85,247,0.16), transparent 22%), linear-gradient(180deg, #060816 0%, #070b1d 45%, #05070f 100%)",
        color: "#f5f7ff",
        padding: "32px 20px 60px",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "1280px",
          margin: "0 auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "16px",
            padding: "16px 20px",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(10, 14, 32, 0.7)",
            backdropFilter: "blur(14px)",
            borderRadius: "20px",
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
                marginBottom: "6px",
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
            V1 Setup Stage
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
                "linear-gradient(180deg, rgba(17,24,39,0.88), rgba(9,13,28,0.92))",
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
                maxWidth: "760px",
              }}
            >
              Run controlled AI audits on Intercom conversations with premium admin control.
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
              select a date, apply a development limiter, process Intercom
              conversations with GPT, and store every result in Supabase.
            </p>

            <div
              style={{
                display: "flex",
                gap: "14px",
                flexWrap: "wrap",
              }}
            >
              <button
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
          </div>

          <div
            style={{
              display: "grid",
              gap: "18px",
            }}
          >
            <div
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
                Access Model
              </div>
              <div
                style={{
                  fontSize: "22px",
                  fontWeight: 700,
                  marginBottom: "8px",
                }}
              >
                Google login + domain restriction
              </div>
              <p
                style={{
                  margin: 0,
                  color: "#a9b4d0",
                  lineHeight: 1.7,
                  fontSize: "15px",
                }}
              >
                Only approved users with a <strong>@nextventures.io</strong>{" "}
                email will be allowed into the system.
              </p>
            </div>

            <div
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
                Development Limiter
              </div>
              <div
                style={{
                  fontSize: "22px",
                  fontWeight: 700,
                  marginBottom: "8px",
                }}
              >
                Process only the number you choose
              </div>
              <p
                style={{
                  margin: 0,
                  color: "#a9b4d0",
                  lineHeight: 1.7,
                  fontSize: "15px",
                }}
              >
                When limiter is on, the app will only send that many
                conversations to GPT. When it is off, it will run the full
                eligible set.
              </p>
            </div>

            <div
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
                Prompt Control
              </div>
              <div
                style={{
                  fontSize: "22px",
                  fontWeight: 700,
                  marginBottom: "8px",
                }}
              >
                Edit the GPT prompt from admin
              </div>
              <p
                style={{
                  margin: 0,
                  color: "#a9b4d0",
                  lineHeight: 1.7,
                  fontSize: "15px",
                }}
              >
                The live prompt will be stored in Supabase so you can update it
                later without changing code.
              </p>
            </div>
          </div>
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: "18px",
          }}
        >
          {[
            {
              label: "Authentication",
              value: "Google + Domain Gate",
              subtext: "Only nextventures.io access",
            },
            {
              label: "Storage",
              value: "Supabase",
              subtext: "Results, users, roles, settings",
            },
            {
              label: "Source",
              value: "Intercom",
              subtext: "Conversation search and transcript fetch",
            },
            {
              label: "AI Processing",
              value: "GPT API",
              subtext: "Audit verdict and sentiment output",
            },
          ].map((item) => (
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
