"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabase";

const OWNER_EMAIL = String(process.env.NEXT_PUBLIC_PLATFORM_OWNER_EMAIL || "").trim().toLowerCase();

export default function OwnerPasswordPanel({ session }) {
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const isOwner = OWNER_EMAIL && session?.user?.email?.trim().toLowerCase() === OWNER_EMAIL;

  async function sendCode() {
    if (!isOwner || busy) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const { data, error: authError } = await supabase.auth.getUser();
      if (authError || data?.user?.id !== session.user.id || data.user.email?.toLowerCase() !== OWNER_EMAIL) {
        throw new Error("Your owner session could not be confirmed. Sign in with Google again.");
      }
      const { error: sendError } = await supabase.auth.reauthenticate();
      if (sendError) throw sendError;
      setCodeSent(true);
      setSuccess(`A verification code was sent to ${OWNER_EMAIL}. Enter it below to set the password.`);
    } catch (cause) { setError(cause?.message || "Could not send the verification code."); }
    finally { setBusy(false); }
  }

  async function setOwnerPassword(event) {
    event.preventDefault();
    if (!isOwner || busy) return;
    setError(""); setSuccess("");
    if (!/^\d{6}$/.test(code.trim())) { setError("Enter the six-digit code sent to your email."); return; }
    const groups = [/[a-z]/,/[A-Z]/,/\d/,/[^A-Za-z0-9]/].filter((rule) => rule.test(password)).length;
    if (password.length < 16 || groups < 3) { setError("Use at least 16 characters with at least three of: lowercase, uppercase, numbers, and symbols."); return; }
    if (password !== confirmation) { setError("The passwords do not match."); return; }
    setBusy(true);
    try {
      const { data, error: authError } = await supabase.auth.getUser();
      if (authError || data?.user?.id !== session.user.id || data.user.email?.toLowerCase() !== OWNER_EMAIL) {
        throw new Error("Your owner session expired. Sign in with Google again.");
      }
      const { error: updateError } = await supabase.auth.updateUser({ password, nonce: code.trim() });
      if (updateError) throw updateError;
      setPassword(""); setConfirmation(""); setCode(""); setCodeSent(false);
      setSuccess("Owner password saved to this same account. Sign out to test password sign-in, or keep using Google.");
    } catch (cause) { setError(cause?.message || "Could not save the password."); }
    finally { setBusy(false); }
  }

  if (!isOwner) return null;
  return <section className="owner-password-panel" aria-labelledby="owner-password-heading">
    <div className="owner-password-heading"><span>Owner account</span><h2 id="owner-password-heading">Password sign-in</h2><p>Set a password for <strong>{OWNER_EMAIL}</strong>. Google sign-in remains available, and both methods open the same owner account.</p></div>
    <div className="owner-password-grid">
      <div className="owner-password-step"><b>1</b><div><strong>Verify your email</strong><p>Request a one-time code before changing this owner account’s password.</p><button type="button" onClick={sendCode} disabled={busy}>{busy ? "Please wait…" : codeSent ? "Send a new code" : "Email me a code"}</button></div></div>
      <div className="owner-password-step"><b>2</b><div><strong>Set your password</strong><p>Use a unique password saved in a password manager. The password is sent only to Supabase Auth and is never stored in this app’s tables.</p>
        <form onSubmit={setOwnerPassword}>
          <label>Six-digit email code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event)=>setCode(event.target.value)} disabled={!codeSent || busy} required /></label>
          <label>New password<input type="password" autoComplete="new-password" minLength={16} value={password} onChange={(event)=>setPassword(event.target.value)} disabled={!codeSent || busy} required /></label>
          <label>Confirm password<input type="password" autoComplete="new-password" minLength={16} value={confirmation} onChange={(event)=>setConfirmation(event.target.value)} disabled={!codeSent || busy} required /></label>
          <button type="submit" disabled={!codeSent || busy}>{busy ? "Saving…" : "Save owner password"}</button>
        </form>
      </div></div>
    </div>
    {error ? <p role="alert" className="owner-password-error">{error}</p> : null}
    {success ? <p role="status" className="owner-password-success">{success}</p> : null}
    <style jsx>{`
      .owner-password-panel{padding:clamp(22px,3vw,38px);border:1px solid var(--border);border-radius:24px;background:var(--card);color:var(--text);max-width:1050px;margin:0 auto 28px;box-shadow:0 16px 42px rgba(0,0,0,.09)}
      .owner-password-heading span{text-transform:uppercase;letter-spacing:.16em;color:var(--brand-hover,#8982ff);font-size:12px;font-weight:800}.owner-password-heading h2{font-size:clamp(25px,3vw,35px);margin:10px 0}.owner-password-heading p{font-size:15px;line-height:1.6;color:var(--muted);max-width:650px}.owner-password-heading strong{color:var(--text)}
      .owner-password-grid{display:grid;grid-template-columns:1fr 1.35fr;gap:16px;margin-top:25px}.owner-password-step{display:flex;gap:15px;padding:22px;border:1px solid var(--border);background:var(--raised);border-radius:18px;min-width:0}.owner-password-step>b{display:grid;place-items:center;flex:0 0 34px;height:34px;border-radius:11px;background:#6258f6;color:#fff;font-size:16px}.owner-password-step>div{min-width:0;width:100%}.owner-password-step strong{font-size:18px}.owner-password-step p{font-size:14px;line-height:1.55;color:var(--muted)}.owner-password-step form{display:grid;gap:14px;margin-top:18px}.owner-password-step label{display:grid;gap:7px;font-size:13px;font-weight:700}.owner-password-step input{min-height:44px;width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:11px;background:var(--card);color:var(--text);font-size:16px;padding:10px 12px}.owner-password-step input:focus-visible,.owner-password-step button:focus-visible{outline:2px solid #756bff;outline-offset:2px}.owner-password-step button{min-height:44px;border:0;border-radius:11px;background:#6258f6;color:white;font-size:14px;font-weight:800;padding:10px 16px;cursor:pointer}.owner-password-step button:disabled{opacity:.55;cursor:not-allowed}.owner-password-error,.owner-password-success{padding:13px 15px;border-radius:12px;font-size:14px;line-height:1.45}.owner-password-error{background:rgba(239,68,68,.13);color:var(--danger,#f87171)}.owner-password-success{background:rgba(16,185,129,.13);color:var(--text)}
      @media(max-width:760px){.owner-password-grid{grid-template-columns:1fr}.owner-password-step{padding:18px}}
    `}</style>
  </section>;
}
