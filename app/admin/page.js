export default function AdminPage() {
  const adminCards = [
    {
      eyebrow: "Prompt Source",
      title: "Original Trusted Prompt",
      description:
        "This section will preserve your original trusted audit prompt exactly as approved, without overwriting it.",
    },
    {
      eyebrow: "Live Configuration",
      title: "Live Prompt in Use",
      description:
        "This section will show the current live audit prompt that the Run Audit flow should use.",
    },
    {
      eyebrow: "Prompt History",
      title: "Timestamped Change Log",
      description:
        "This section will keep a record of every prompt update, including when the change was made and what version was active.",
    },
    {
      eyebrow: "Admin Controls",
      title: "Future System Controls",
      description:
        "This page will later also manage approved test users, API key controls, results settings, and other admin-level controls.",
    },
  ];

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
            This page is the next major build area. It will hold the original trusted
            audit prompt, the live prompt used by the tool, and a timestamped history
            of every prompt change.
          </p>
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: "18px",
          }}
        >
          {adminCards.map((card) => (
            <div
              key={card.title}
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
                {card.eyebrow}
              </div>

              <div
                style={{
                  fontSize: "26px",
                  fontWeight: 700,
                  lineHeight: 1.15,
                  marginBottom: "10px",
                }}
              >
                {card.title}
              </div>

              <div
                style={{
                  color: "#a9b4d0",
                  fontSize: "15px",
                  lineHeight: 1.7,
                }}
              >
                {card.description}
              </div>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
