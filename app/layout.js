import Link from "next/link";

export const metadata = {
  title: "NEXT Ventures Audit Tool",
  description: "Internal audit system",
};

const navItems = [
  { label: "Dashboard", href: "/" },
  { label: "Run Audit", href: "/run" },
  { label: "Results", href: "/results" },
  { label: "Admin", href: "/admin" },
];

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <div className="app-bg">
            <div className="bg-orb orb-one" />
            <div className="bg-orb orb-two" />
            <div className="bg-orb orb-three" />
            <div className="bg-grid" />
            <div className="bg-vignette" />
          </div>

          <div className="shell-frame">
            <aside className="sidebar">
              <div className="brand-wrap">
                <div className="brand-badge">NEXT Ventures Internal Platform</div>

                <div className="brand-block">
                  <div className="brand-mark">
                    <div className="brand-mark-core" />
                  </div>

                  <div>
                    <h1 className="brand-title">NEXT Ventures</h1>
                    <p className="brand-subtitle">
                      Review Approach & Client Sentiment Tracking
                    </p>
                  </div>
                </div>

                <div className="brand-panel">
                  <div className="brand-panel-label">Operations Command</div>
                  <div className="brand-panel-value">Audit Intelligence Suite</div>
                  <p className="brand-panel-copy">
                    Run audits, monitor outcomes, and review sentiment signals in
                    one premium internal workspace.
                  </p>
                </div>
              </div>

              <nav className="nav">
                <div className="nav-section-label">Navigation</div>

                <div className="nav-list">
                  {navItems.map((item) => (
                    <Link key={item.href} href={item.href} className="nav-link">
                      <span className="nav-link-dot" />
                      <span>{item.label}</span>
                    </Link>
                  ))}
                </div>
              </nav>

              <div className="sidebar-footer">
                <div className="footer-card">
                  <div className="footer-card-label">Workspace</div>
                  <div className="footer-card-value">NEXT Ventures</div>
                  <p className="footer-card-copy">
                    Premium internal dashboard shell for audit operations.
                  </p>
                </div>
              </div>
            </aside>

            <div className="content-shell">
              <div className="topbar">
                <div>
                  <div className="topbar-kicker">Internal Quality Platform</div>
                  <div className="topbar-title">Audit Control Center</div>
                </div>

                <div className="topbar-chip">Secure Workspace</div>
              </div>

              <main className="page-content">{children}</main>
            </div>
          </div>
        </div>

        <style jsx global>{`
          :root {
            color-scheme: dark;
          }

          * {
            box-sizing: border-box;
          }

          html,
          body {
            margin: 0;
            min-height: 100%;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system,
              BlinkMacSystemFont, "Segoe UI", sans-serif;
            background:
              radial-gradient(circle at top left, rgba(91, 33, 182, 0.22), transparent 28%),
              radial-gradient(circle at 85% 12%, rgba(37, 99, 235, 0.2), transparent 24%),
              radial-gradient(circle at 70% 28%, rgba(217, 70, 239, 0.14), transparent 18%),
              linear-gradient(180deg, #030611 0%, #050918 42%, #02040b 100%);
            color: #f8fbff;
          }

          body {
            min-height: 100vh;
          }

          a {
            color: inherit;
          }

          .app-shell {
            position: relative;
            min-height: 100vh;
            overflow: hidden;
          }

          .app-bg {
            pointer-events: none;
            position: fixed;
            inset: 0;
            overflow: hidden;
          }

          .bg-orb {
            position: absolute;
            border-radius: 999px;
            filter: blur(90px);
            opacity: 0.75;
          }

          .orb-one {
            top: -120px;
            left: -100px;
            height: 340px;
            width: 340px;
            background: rgba(139, 92, 246, 0.2);
          }

          .orb-two {
            top: 70px;
            right: -60px;
            height: 300px;
            width: 300px;
            background: rgba(59, 130, 246, 0.18);
          }

          .orb-three {
            bottom: -80px;
            left: 22%;
            height: 320px;
            width: 320px;
            background: rgba(217, 70, 239, 0.14);
          }

          .bg-grid {
            position: absolute;
            inset: 0;
            background-image:
              linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
            background-size: 72px 72px;
            mask-image: linear-gradient(
              180deg,
              rgba(255, 255, 255, 0.2),
              rgba(255, 255, 255, 0)
            );
            opacity: 0.22;
          }

          .bg-vignette {
            position: absolute;
            inset: 0;
            background:
              radial-gradient(circle at center, transparent 40%, rgba(2, 6, 23, 0.28) 78%, rgba(2, 6, 23, 0.62) 100%);
          }

          .shell-frame {
            position: relative;
            z-index: 1;
            display: grid;
            grid-template-columns: 290px minmax(0, 1fr);
            min-height: 100vh;
          }

          .sidebar {
            position: relative;
            display: flex;
            flex-direction: column;
            gap: 24px;
            padding: 26px 20px 20px;
            border-right: 1px solid rgba(255, 255, 255, 0.08);
            background:
              linear-gradient(180deg, rgba(8, 14, 32, 0.92) 0%, rgba(5, 10, 24, 0.88) 100%);
            backdrop-filter: blur(22px);
            box-shadow:
              inset -1px 0 0 rgba(255, 255, 255, 0.03),
              20px 0 80px rgba(2, 6, 23, 0.28);
          }

          .brand-wrap {
            display: flex;
            flex-direction: column;
            gap: 18px;
          }

          .brand-badge {
            width: fit-content;
            max-width: 100%;
            border: 1px solid rgba(139, 92, 246, 0.28);
            background: linear-gradient(
              135deg,
              rgba(91, 33, 182, 0.26),
              rgba(30, 41, 59, 0.32)
            );
            color: #e9ddff;
            padding: 9px 14px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            box-shadow: 0 0 30px rgba(139, 92, 246, 0.12);
          }

          .brand-block {
            display: flex;
            align-items: center;
            gap: 14px;
          }

          .brand-mark {
            position: relative;
            display: grid;
            place-items: center;
            width: 56px;
            height: 56px;
            border-radius: 18px;
            background:
              linear-gradient(135deg, rgba(96, 165, 250, 0.18), rgba(139, 92, 246, 0.24), rgba(236, 72, 153, 0.16));
            border: 1px solid rgba(255, 255, 255, 0.12);
            box-shadow:
              0 12px 35px rgba(76, 29, 149, 0.22),
              inset 0 1px 0 rgba(255, 255, 255, 0.08);
          }

          .brand-mark-core {
            width: 24px;
            height: 24px;
            border-radius: 10px;
            background:
              linear-gradient(135deg, #60a5fa 0%, #8b5cf6 55%, #ec4899 100%);
            box-shadow: 0 0 24px rgba(139, 92, 246, 0.45);
          }

          .brand-title {
            margin: 0;
            font-size: 24px;
            line-height: 1.05;
            letter-spacing: -0.04em;
            font-weight: 800;
            color: #ffffff;
          }

          .brand-subtitle {
            margin: 7px 0 0;
            font-size: 13px;
            line-height: 1.55;
            color: #9caed3;
          }

          .brand-panel,
          .footer-card {
            position: relative;
            overflow: hidden;
            border-radius: 24px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            background:
              linear-gradient(180deg, rgba(10, 17, 38, 0.9), rgba(7, 12, 28, 0.86));
            padding: 16px 16px 15px;
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.05),
              0 18px 40px rgba(2, 6, 23, 0.24);
          }

          .brand-panel::before,
          .footer-card::before {
            content: "";
            position: absolute;
            inset: 0 auto auto 0;
            width: 100%;
            height: 1px;
            background: linear-gradient(
              90deg,
              rgba(96, 165, 250, 0.28),
              rgba(168, 85, 247, 0.22),
              rgba(236, 72, 153, 0)
            );
          }

          .brand-panel-label,
          .footer-card-label {
            font-size: 11px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.16em;
            color: #7f92bc;
          }

          .brand-panel-value,
          .footer-card-value {
            margin-top: 8px;
            font-size: 16px;
            font-weight: 700;
            color: #f8fbff;
            letter-spacing: -0.02em;
          }

          .brand-panel-copy,
          .footer-card-copy {
            margin: 8px 0 0;
            font-size: 13px;
            line-height: 1.6;
            color: #92a4cb;
          }

          .nav {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }

          .nav-section-label {
            padding: 0 4px;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: #7386af;
          }

          .nav-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          .nav-link {
            position: relative;
            display: flex;
            align-items: center;
            gap: 12px;
            min-height: 54px;
            padding: 0 16px;
            border-radius: 18px;
            text-decoration: none;
            color: #dce7ff;
            border: 1px solid rgba(255, 255, 255, 0.06);
            background:
              linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02));
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.04),
              0 10px 24px rgba(2, 6, 23, 0.18);
            transition:
              transform 0.18s ease,
              border-color 0.18s ease,
              background 0.18s ease,
              box-shadow 0.18s ease;
          }

          .nav-link:hover {
            transform: translateY(-1px);
            border-color: rgba(139, 92, 246, 0.26);
            background:
              linear-gradient(180deg, rgba(91, 33, 182, 0.18), rgba(255, 255, 255, 0.03));
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.05),
              0 18px 30px rgba(76, 29, 149, 0.16);
          }

          .nav-link-dot {
            width: 10px;
            height: 10px;
            border-radius: 999px;
            background: linear-gradient(135deg, #60a5fa, #8b5cf6);
            box-shadow: 0 0 18px rgba(96, 165, 250, 0.45);
            flex: 0 0 auto;
          }

          .sidebar-footer {
            margin-top: auto;
          }

          .content-shell {
            min-width: 0;
            display: flex;
            flex-direction: column;
            padding: 18px 18px 24px;
          }

          .topbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            min-height: 86px;
            padding: 18px 24px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 28px;
            background:
              linear-gradient(180deg, rgba(11, 18, 39, 0.78), rgba(7, 12, 28, 0.72));
            backdrop-filter: blur(20px);
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.04),
              0 18px 60px rgba(2, 6, 23, 0.2);
          }

          .topbar-kicker {
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: #7e92bd;
          }

          .topbar-title {
            margin-top: 8px;
            font-size: 24px;
            line-height: 1.05;
            letter-spacing: -0.04em;
            font-weight: 800;
            color: #ffffff;
          }

          .topbar-chip {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 38px;
            padding: 0 14px;
            border-radius: 999px;
            border: 1px solid rgba(34, 211, 238, 0.18);
            background: rgba(6, 182, 212, 0.08);
            color: #b8f4ff;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            white-space: nowrap;
          }

          .page-content {
            min-width: 0;
            padding-top: 18px;
          }

          @media (max-width: 1100px) {
            .shell-frame {
              grid-template-columns: 1fr;
            }

            .sidebar {
              gap: 18px;
              border-right: none;
              border-bottom: 1px solid rgba(255, 255, 255, 0.08);
              box-shadow: none;
            }

            .content-shell {
              padding-top: 14px;
            }
          }

          @media (max-width: 700px) {
            .sidebar,
            .content-shell {
              padding-left: 14px;
              padding-right: 14px;
            }

            .topbar {
              flex-direction: column;
              align-items: flex-start;
              padding: 18px;
              border-radius: 24px;
            }

            .topbar-title {
              font-size: 22px;
            }

            .brand-title {
              font-size: 22px;
            }

            .nav-link {
              min-height: 50px;
              border-radius: 16px;
            }
          }
        `}</style>
      </body>
    </html>
  );
}
