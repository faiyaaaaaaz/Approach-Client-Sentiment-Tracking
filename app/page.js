export default function HomePage() {
  const hasUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  const hasAnonKey = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const hasServiceRoleKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  return (
    <main style={{ padding: 40, fontFamily: "Arial, sans-serif" }}>
      <h1>CSAT Dashboard</h1>

      <p>Supabase environment check:</p>

      <ul>
        <li>Project URL: {hasUrl ? "Connected" : "Missing"}</li>
        <li>Publishable key: {hasAnonKey ? "Connected" : "Missing"}</li>
        <li>Secret key: {hasServiceRoleKey ? "Connected" : "Missing"}</li>
      </ul>

      <p>
        If all three say Connected, your Vercel app is ready for the next step.
      </p>
    </main>
  );
}
