export const metadata = {
  title: "NEXT Ventures Audit Tool",
  description: "Internal audit system",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "Inter, sans-serif", background: "#0b0f1a", color: "white" }}>
        <div style={{ display: "flex", height: "100vh" }}>
          
          {/* Sidebar */}
          <div style={{
            width: "240px",
            background: "#0f172a",
            padding: "20px",
            borderRight: "1px solid rgba(255,255,255,0.05)"
          }}>
            <h2 style={{ marginBottom: "30px" }}>NEXT Ventures</h2>

            <nav style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
              <a href="/" style={linkStyle}>Dashboard</a>
              <a href="/run" style={linkStyle}>Run Audit</a>
              <a href="/results" style={linkStyle}>Results</a>
              <a href="/admin" style={linkStyle}>Admin</a>
            </nav>
          </div>

          {/* Main Content */}
          <div style={{ flex: 1, overflow: "auto", padding: "20px" }}>
            {children}
          </div>

        </div>
      </body>
    </html>
  );
}

const linkStyle = {
  color: "white",
  textDecoration: "none",
  padding: "10px 12px",
  borderRadius: "8px",
  background: "rgba(255,255,255,0.05)"
};
