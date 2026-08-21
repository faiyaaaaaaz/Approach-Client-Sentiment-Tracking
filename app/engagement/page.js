"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import TeamEngagementPanel from "../components/TeamEngagementPanel";

export default function TeamEngagementPage() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data?.session || null);
      setChecking(false);
    }).catch(() => { if (active) setChecking(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession || null);
      setChecking(false);
    });
    return () => { active = false; subscription?.unsubscribe?.(); };
  }, []);

  return (
    <main className="engagement-page">
      <section className="engagement-hero">
        <div><p>Review adoption</p><h1>Team Engagement</h1><span>See whether agents are signing in and opening the results published to them. All timestamps use GMT+6.</span></div>
      </section>
      {checking ? <section className="engagement-checking">Preparing Team Engagement…</section> : <TeamEngagementPanel session={session} />}
      <style>{`
        .engagement-page{display:grid;gap:18px;width:min(1500px,100%);margin:0 auto;padding:22px}.engagement-hero{padding:22px 24px;border:1px solid var(--border);border-radius:20px;background:linear-gradient(135deg,var(--card),var(--raised));box-shadow:0 12px 30px rgba(0,0,0,.08)}.engagement-hero p{margin:0 0 6px;color:var(--brand-hover);font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.09em}.engagement-hero h1{margin:0;color:var(--text);font-size:32px}.engagement-hero span{display:block;margin-top:7px;color:var(--muted)}.engagement-checking{min-height:180px;display:grid;place-items:center;border:1px solid var(--border);border-radius:18px;background:var(--card);color:var(--muted)}@media(max-width:700px){.engagement-page{padding:14px}.engagement-hero h1{font-size:26px}}
      `}</style>
    </main>
  );
}
