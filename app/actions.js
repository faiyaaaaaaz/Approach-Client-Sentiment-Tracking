"use server";

import { createClient } from "@supabase/supabase-js";

export async function createTestRun(formData) {
  const startDate = formData.get("startDate");
  const endDate = formData.get("endDate");

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { error } = await supabase.from("import_runs").insert([
    {
      run_type: "test",
      start_date: startDate,
      end_date: endDate,
      status: "queued"
    }
  ]);

  if (error) {
    throw new Error(error.message);
  }
}
