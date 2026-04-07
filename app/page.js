import { createClient } from "@supabase/supabase-js";
import { createTestRun } from "./actions";

export default async function HomePage() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { count } = await supabase
    .from("import_runs")
    .select("*", { count: "exact", head: true });

  const { data: recentRuns } = await supabase
    .from("import_runs")
    .select("id, run_type, start_date, end_date, status, created_at")
    .order("created_at", { ascending: false })
    .limit(5);

  return (
    <main style={{ padding: 40, fontFamily: "Arial, sans-serif", maxWidth: 900 }}>
      <h1>CSAT Dashboard</h1>

      <div style={{ marginTop: 30, marginBottom: 30, padding: 20, border: "1px solid #ddd", borderRadius: 8 }}>
        <h2>Run Test</h2>

        <form action={createTestRun} style={{ display: "grid", gap: 12, maxWidth: 400 }}>
          <div>
            <label>Start Date</label>
            <br />
            <input type="date" name="startDate" required />
          </div>

          <div>
            <label>End Date</label>
            <br />
            <input type="date" name="endDate" required />
          </div>

          <button type="submit" style={{ padding: "10px 16px", cursor: "pointer" }}>
            Run Test
          </button>
        </form>
      </div>

      <div style={{ marginBottom: 30 }}>
        <h2>Stats</h2>
        <p>Total runs in database: {count}</p>
      </div>

      <div>
        <h2>Recent Runs</h2>

        {!recentRuns || recentRuns.length === 0 ? (
          <p>No runs yet.</p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ border: "1px solid #ddd", padding: 8, textAlign: "left" }}>Run Type</th>
                <th style={{ border: "1px solid #ddd", padding: 8, textAlign: "left" }}>Start Date</th>
                <th style={{ border: "1px solid #ddd", padding: 8, textAlign: "left" }}>End Date</th>
                <th style={{ border: "1px solid #ddd", padding: 8, textAlign: "left" }}>Status</th>
                <th style={{ border: "1px solid #ddd", padding: 8, textAlign: "left" }}>Created At</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((run) => (
                <tr key={run.id}>
                  <td style={{ border: "1px solid #ddd", padding: 8 }}>{run.run_type}</td>
                  <td style={{ border: "1px solid #ddd", padding: 8 }}>{run.start_date}</td>
                  <td style={{ border: "1px solid #ddd", padding: 8 }}>{run.end_date}</td>
                  <td style={{ border: "1px solid #ddd", padding: 8 }}>{run.status}</td>
                  <td style={{ border: "1px solid #ddd", padding: 8 }}>
                    {new Date(run.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
