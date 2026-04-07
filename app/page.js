import { createClient } from "@supabase/supabase-js";

export default async function HomePage() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { count, error } = await supabase
    .from("import_runs")
    .select("*", { count: "exact", head: true });

  return (
    <main style={{ padding: 40, fontFamily: "Arial, sans-serif" }}>
      <h1>CSAT Dashboard</h1>

      <p>Supabase database test:</p>

      {error ? (
        <div>
          <p style={{ color: "red" }}>Database connection failed</p>
          <pre>{error.message}</pre>
        </div>
      ) : (
        <div>
          <p style={{ color: "green" }}>Database connection works</p>
          <p>Total rows in import_runs: {count}</p>
        </div>
      )}
    </main>
  );
}
