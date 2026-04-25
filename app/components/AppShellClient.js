"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

const MASTER_ADMIN_EMAIL = "faiyaz@nextventures.io";

const navItems = [
  { label: "Dashboard", href: "/", permission: "dashboard" },
  { label: "Run Audit", href: "/run", permission: "run_audit" },
  { label: "Results", href: "/results", permission: "results" },
  { label: "Admin", href: "/admin", permission: "admin" },
];

function buildFallbackProfile(user) {
  const email = String(user?.email || "").toLowerCase();

  if (email === MASTER_ADMIN_EMAIL) {
    return {
      id: user.id,
      email,
      full_name: user.user_metadata?.full_name || "Faiyaz Muhtasim Ahmed",
      role: "master_admin",
      can_run_tests: true,
      is_active: true,
    };
  }

  return null;
}

function roleLabel(role) {
  const value = String(role || "viewer").replaceAll("_", " ");

  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getInitials(nameOrEmail) {
  const value = String(nameOrEmail || "NV").trim();

  if (value.includes("@")) {
    return value.slice(0, 2).toUpperCase();
  }

  const parts = value.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  return value.slice(0, 2).toUpperCase();
}

function canRunAudits(profile) {
  const role = String(profile?.role || "").toLowerCase();

  return Boolean(
    profile?.is_active === true &&
      (role === "master_admin" ||
        role === "admin" ||
        profile?.can_run_tests === true)
  );
}

function canAccessAdmin(profile) {
  const role = String(profile?.role || "").toLowerCase();

  return Boolean(
    profile?.is_active === true &&
      (role === "master_admin" || role === "admin" || role === "co_admin")
  );
}

function canViewResults(profile) {
  return Boolean(profile?.is_active === true);
}

function canViewNavItem(item, profile) {
  if (item.permission === "dashboard") return true;
  if (item.permission === "results") return canViewResults(profile);
  if (item.permission === "run_audit") return canRunAudits(profile);
  if (item.permission === "admin") return canAccessAdmin(profile);

  return true;
}

function getLockReason(pathname, session, profile) {
  if (pathname === "/run" && !session?.user) {
    return {
      title: "Sign in required",
      message: "Please sign in with your NEXT Ventures account to visit Run Audit.",
    };
  }

  if (pathname === "/run" && !canRunAudits(profile)) {
    return {
      title: "Permission required",
      message:
        "Sorry, you do not have permission to visit this section. Please contact the Master Admin.",
    };
  }

  if (pathname === "/admin" && !session?.user) {
    return {
      title: "Sign in required",
      message: "Please sign in with your NEXT Ventures account to visit Admin.",
    };
  }

  if (pathname === "/admin" && !canAccessAdmin(profile)) {
    return {
      title: "Admin access required",
      message:
        "Sorry, you do not have permission to visit this section. Please contact the Master Admin.",
    };
  }

  if (pathname === "/results" && !session?.user) {
    return {
      title: "Sign in required",
      message: "Please sign in with your NEXT Ventures account to visit Results.",
    };
  }

  if (pathname === "/results" && !canViewResults(profile)) {
    return {
      title: "Access required",
      message:
        "Sorry, you do not have permission to visit this section. Please contact the Master Admin.",
    };
  }

  return null;
}

export default function AppShellClient({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const profileMenuRef = useRef(null);

  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [authMessage, setAuthMessage] = useState("");

  const displayName = useMemo(() => {
    return (
      profile?.full_name ||
      session?.user?.user_metadata?.full_name ||
      session?.user?.email ||
      "Guest user"
    );
  }, [profile, session]);

  const displayEmail = session?.user?.email || profile?.email || "";
  const lockReason = getLockReason(pathname, session, profile);
  const pageLocked = Boolean(!authLoading && lockReason);

  async function loadProfile(user) {
    if (!user) {
      return { profile: null, message: "" };
    }

    const email = String(user.email || "").toLowerCase();
    const domain = email.split("@")[1] || "";

    if (domain !== "nextventures.io") {
      return {
        profile: null,
        message: "Only nextventures.io accounts are allowed.",
      };
    }

    const fallbackProfile = buildFallbackProfile(user);

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, full_name, role, can_run_tests, is_active")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        if (fallbackProfile) return { profile: fallbackProfile, message: "" };

        return {
          profile: null,
          message: "Signed in, but profile loading failed.",
        };
      }

      if (data) return { profile: data, message: "" };
      if (fallbackProfile) return { profile: fallbackProfile, message: "" };

      return {
        profile: {
          id: user.id,
          email,
          full_name: user.user_metadata?.full_name || "",
          role: "viewer",
          can_run_tests: false,
          is_active: true,
        },
        message: "",
      };
    } catch (_error) {
      if (fallbackProfile) return { profile: fallbackProfile, message: "" };

      return {
        profile: null,
        message: "Signed in, but profile loading failed.",
      };
    }
  }

  useEffect(() => {
    let active = true;

    async function init() {
      try {
        const {
          data: { session: currentSession },
        } = await supabase.auth.getSession();

        if (!active) return;

        setSession(currentSession || null);

        if (!currentSession?.user) {
          setProfile(null);
          setAuthLoading(false);
          return;
        }

        const result = await loadProfile(currentSession.user);

        if (!active) return;

        setProfile(result.profile);
        setAuthMessage(result.message);
        setAuthLoading(false);
      } catch (_error) {
        if (!active) return;

        setSession(null);
        setProfile(null);
        setAuthMessage("Could not complete session check.");
        setAuthLoading(false);
      }
    }

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!active) return;

      setSession(newSession || null);

      if (!newSession?.user) {
        setProfile(null);
        setAuthMessage("");
        setAuthLoading(false);
        return;
      }

      loadProfile(newSession.user).then((result) => {
        if (!active) return;

        setProfile(result.profile);
        setAuthMessage(result.message);
        setAuthLoading(false);
      });
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!profileMenuRef.current) return;
      if (!profileMenuRef.current.contains(event.target)) setProfileOpen(false);
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  async function handleGoogleLogin() {
    setAuthMessage("");

    const redirectTo =
      typeof window !== "undefined" ? `${window.location.origin}${pathname}` : undefined;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) setAuthMessage(error.message || "Google sign-in failed.");
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setProfileOpen(false);
    router.push("/");
  }

  return (
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
            <div className="brand-badge">Next Ventures</div>

            <div className="brand-block">
              <div className="brand-mark">
                <div className="brand-mark-core" />
              </div>

              <div>
                <h1 className="brand-title">Audit Intelligence</h1>
                <p className="brand-subtitle">
                  Review approach and client sentiment tracking.
                </p>
              </div>
            </div>
          </div>

          <nav className="nav">
            <div className="nav-section-label">Navigation</div>

            <div className="nav-list">
              {navItems.map((item) => {
                const allowed = canViewNavItem(item, profile);
                const active =
                  item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`${active ? "nav-link active" : "nav-link"} ${
                      !allowed && session?.user ? "locked-nav" : ""
                    }`}
                  >
                    <span className="nav-link-dot" />
                    <span>{item.label}</span>
                    {!allowed && session?.user ? <em>Locked</em> : null}
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="sidebar-mini">
            <span>Workspace</span>
            <strong>Next Ventures</strong>
          </div>
        </aside>

        <div className="content-shell">
          <header className="topbar">
            <div>
              <div className="topbar-kicker">Internal quality platform</div>
              <div className="topbar-title">Review approach & client sentiment tracking</div>
            </div>

            <div ref={profileMenuRef} className="profile-wrap">
              {authLoading ? (
                <div className="profile-loading">Checking session</div>
              ) : session?.user ? (
                <>
                  <button
                    type="button"
                    className="profile-button"
                    onClick={() => setProfileOpen((prev) => !prev)}
                  >
                    <span className="profile-avatar">{getInitials(displayName)}</span>

                    <span className="profile-copy">
                      <strong>{displayName}</strong>
                      <small>{roleLabel(profile?.role)}</small>
                    </span>

                    <b>{profileOpen ? "Up" : "Down"}</b>
                  </button>

                  {profileOpen ? (
                    <div className="profile-menu">
                      <div className="profile-menu-head">
                        <span className="profile-avatar large">{getInitials(displayName)}</span>
                        <div>
                          <strong>{displayName}</strong>
                          <small>{displayEmail}</small>
                        </div>
                      </div>

                      <div className="profile-detail-grid">
                        <div>
                          <span>Role</span>
                          <strong>{roleLabel(profile?.role)}</strong>
                        </div>

                        <div>
                          <span>Run audit</span>
                          <strong>{canRunAudits(profile) ? "Allowed" : "Locked"}</strong>
                        </div>

                        <div>
                          <span>Admin</span>
                          <strong>{canAccessAdmin(profile) ? "Allowed" : "Locked"}</strong>
                        </div>

                        <div>
                          <span>Status</span>
                          <strong>{profile?.is_active ? "Active" : "Inactive"}</strong>
                        </div>
                      </div>

                      <p className="profile-note">
                        Roles are controlled from Admin. Users cannot change their own role here.
                      </p>

                      {authMessage ? <p className="profile-warning">{authMessage}</p> : null}

                      <button type="button" className="signout-btn" onClick={handleLogout}>
                        Sign out
                      </button>
                    </div>
                  ) : null}
                </>
              ) : (
                <button type="button" className="signin-btn" onClick={handleGoogleLogin}>
                  Sign in
                </button>
              )}
            </div>
          </header>

          <main className={pageLocked ? "page-content locked-content" : "page-content"}>
            <div className={pageLocked ? "blurred-page" : ""}>{children}</div>

            {pageLocked ? (
              <div className="locked-overlay">
                <div className="locked-card">
                  <div className="locked-orb" />
                  <span>Restricted section</span>
                  <h2>{lockReason.title}</h2>
                  <p>{lockReason.message}</p>

                  {!session?.user ? (
                    <button type="button" className="signin-btn large" onClick={handleGoogleLogin}>
                      Sign in with Google
                    </button>
                  ) : (
                    <Link href="/" className="locked-link">
                      Return to dashboard
                    </Link>
                  )}
                </div>
              </div>
            ) : null}
          </main>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: appShellStyles }} />
    </div>
  );
}

const appShellStyles = `
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
      radial-gradient(circle at top left, rgba(91, 33, 182, 0.2), transparent 26%),
      radial-gradient(circle at 85% 12%, rgba(37, 99, 235, 0.18), transparent 24%),
      radial-gradient(circle at 70% 28%, rgba(217, 70, 239, 0.12), transparent 18%),
      linear-gradient(180deg, #030611 0%, #050918 42%, #02040b 100%);
    color: #f8fbff;
  }

  a {
    color: inherit;
  }

  .app-shell {
    position: relative;
    min-height: 100vh;
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
    background: rgba(139, 92, 246, 0.18);
  }

  .orb-two {
    top: 70px;
    right: -60px;
    height: 300px;
    width: 300px;
    background: rgba(59, 130, 246, 0.16);
  }

  .orb-three {
    bottom: -80px;
    left: 22%;
    height: 320px;
    width: 320px;
    background: rgba(217, 70, 239, 0.12);
  }

  .bg-grid {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
    background-size: 72px 72px;
    mask-image: linear-gradient(180deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0));
    opacity: 0.2;
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
    grid-template-columns: 260px minmax(0, 1fr);
    min-height: 100vh;
    align-items: start;
  }

  .sidebar {
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 26px;
    padding: 22px 16px 18px;
    border-right: 1px solid rgba(255, 255, 255, 0.08);
    background:
      linear-gradient(180deg, rgba(8, 14, 32, 0.92) 0%, rgba(5, 10, 24, 0.88) 100%);
    backdrop-filter: blur(22px);
    box-shadow:
      inset -1px 0 0 rgba(255, 255, 255, 0.03),
      20px 0 80px rgba(2, 6, 23, 0.25);
  }

  .brand-wrap {
    display: grid;
    gap: 18px;
  }

  .brand-badge {
    width: fit-content;
    max-width: 100%;
    border: 1px solid rgba(139, 92, 246, 0.28);
    background: linear-gradient(135deg, rgba(91, 33, 182, 0.26), rgba(30, 41, 59, 0.32));
    color: #e9ddff;
    padding: 9px 14px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 850;
    letter-spacing: 0.12em;
  }

  .brand-block {
    display: flex;
    align-items: center;
    gap: 13px;
  }

  .brand-mark {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: 18px;
    background: linear-gradient(135deg, rgba(96, 165, 250, 0.18), rgba(139, 92, 246, 0.24), rgba(236, 72, 153, 0.16));
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 12px 35px rgba(76, 29, 149, 0.22);
  }

  .brand-mark-core {
    width: 24px;
    height: 24px;
    border-radius: 10px;
    background: linear-gradient(135deg, #60a5fa 0%, #8b5cf6 55%, #ec4899 100%);
    box-shadow: 0 0 24px rgba(139, 92, 246, 0.45);
  }

  .brand-title {
    margin: 0;
    font-size: 22px;
    line-height: 1.05;
    letter-spacing: -0.04em;
    font-weight: 850;
    color: #ffffff;
  }

  .brand-subtitle {
    margin: 7px 0 0;
    font-size: 13px;
    line-height: 1.5;
    color: #9caed3;
  }

  .nav {
    display: grid;
    gap: 12px;
  }

  .nav-section-label {
    padding: 0 4px;
    font-size: 11px;
    font-weight: 850;
    letter-spacing: 0.14em;
    color: #7386af;
  }

  .nav-list {
    display: grid;
    gap: 10px;
  }

  .nav-link {
    position: relative;
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    padding: 0 14px;
    border-radius: 18px;
    text-decoration: none;
    color: #dce7ff;
    border: 1px solid rgba(255, 255, 255, 0.06);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 10px 24px rgba(2, 6, 23, 0.18);
    transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
  }

  .nav-link:hover,
  .nav-link.active {
    transform: translateY(-1px);
    border-color: rgba(139, 92, 246, 0.28);
    background: linear-gradient(180deg, rgba(91, 33, 182, 0.18), rgba(255, 255, 255, 0.03));
  }

  .nav-link-dot {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: linear-gradient(135deg, #60a5fa, #8b5cf6);
    box-shadow: 0 0 18px rgba(96, 165, 250, 0.45);
  }

  .nav-link em {
    color: #fbbf24;
    font-size: 10px;
    font-style: normal;
    font-weight: 850;
  }

  .locked-nav {
    opacity: 0.72;
  }

  .sidebar-mini {
    margin-top: auto;
    border-radius: 20px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.035);
    padding: 14px;
  }

  .sidebar-mini span {
    display: block;
    color: #7f92bc;
    font-size: 11px;
    font-weight: 850;
    letter-spacing: 0.12em;
    margin-bottom: 8px;
  }

  .sidebar-mini strong {
    color: #ffffff;
    font-size: 15px;
  }

  .content-shell {
    min-width: 0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    padding: 14px 18px 24px;
  }

  .topbar {
    position: sticky;
    top: 14px;
    z-index: 500;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 72px;
    padding: 14px 18px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 24px;
    background:
      linear-gradient(180deg, rgba(11, 18, 39, 0.88), rgba(7, 12, 28, 0.78));
    backdrop-filter: blur(20px);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 18px 60px rgba(2, 6, 23, 0.22);
  }

  .topbar-kicker {
    font-size: 11px;
    font-weight: 850;
    letter-spacing: 0.12em;
    color: #7e92bd;
  }

  .topbar-title {
    margin-top: 7px;
    font-size: 21px;
    line-height: 1.1;
    letter-spacing: -0.04em;
    font-weight: 850;
    color: #ffffff;
  }

  .profile-wrap {
    position: relative;
    flex: 0 0 auto;
  }

  .profile-button,
  .signin-btn,
  .signout-btn,
  .locked-link {
    border: 0;
    cursor: pointer;
    text-decoration: none;
    font: inherit;
  }

  .profile-button {
    min-width: 260px;
    min-height: 52px;
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr) auto;
    align-items: center;
    gap: 11px;
    padding: 7px 12px 7px 7px;
    border-radius: 18px;
    color: #ffffff;
    border: 1px solid rgba(255,255,255,0.08);
    background:
      linear-gradient(135deg, rgba(59,130,246,0.14), rgba(139,92,246,0.16), rgba(236,72,153,0.08));
  }

  .profile-avatar {
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    border-radius: 15px;
    color: #ffffff;
    font-size: 13px;
    font-weight: 900;
    background: linear-gradient(135deg, #2563eb, #7c3aed, #db2777);
    box-shadow: 0 0 24px rgba(139,92,246,0.42);
  }

  .profile-avatar.large {
    width: 48px;
    height: 48px;
    border-radius: 17px;
  }

  .profile-copy {
    min-width: 0;
    text-align: left;
  }

  .profile-copy strong,
  .profile-copy small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-copy strong {
    font-size: 14px;
  }

  .profile-copy small {
    margin-top: 3px;
    color: #a9b4d0;
    font-size: 12px;
  }

  .profile-button b {
    color: #8ea0d6;
    font-size: 11px;
  }

  .profile-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 10px);
    z-index: 1000;
    width: min(380px, 92vw);
    padding: 16px;
    border-radius: 24px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(9, 14, 30, 0.98);
    box-shadow: 0 24px 80px rgba(0,0,0,0.5);
  }

  .profile-menu-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }

  .profile-menu-head strong,
  .profile-menu-head small {
    display: block;
  }

  .profile-menu-head small {
    margin-top: 4px;
    color: #9caed3;
  }

  .profile-detail-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 12px;
  }

  .profile-detail-grid div {
    padding: 12px;
    border-radius: 16px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.07);
  }

  .profile-detail-grid span {
    display: block;
    color: #8ea0d6;
    font-size: 11px;
    font-weight: 850;
    margin-bottom: 6px;
  }

  .profile-detail-grid strong {
    color: #ffffff;
    font-size: 13px;
  }

  .profile-note,
  .profile-warning {
    margin: 0 0 12px;
    color: #a9b4d0;
    font-size: 13px;
    line-height: 1.6;
  }

  .profile-warning {
    color: #fca5a5;
  }

  .signin-btn,
  .signout-btn,
  .locked-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 42px;
    padding: 0 16px;
    border-radius: 14px;
    color: #ffffff;
    font-size: 13px;
    font-weight: 850;
    background: linear-gradient(135deg, #2563eb, #7c3aed, #db2777);
    box-shadow: 0 14px 30px rgba(91,33,182,0.32);
  }

  .signin-btn.large,
  .locked-link {
    min-height: 48px;
    padding: 0 18px;
  }

  .signout-btn {
    width: 100%;
    background: rgba(244,63,94,0.12);
    border: 1px solid rgba(244,63,94,0.24);
    box-shadow: none;
  }

  .profile-loading {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    padding: 0 14px;
    border-radius: 999px;
    color: #cbd5e1;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.035);
    font-size: 13px;
    font-weight: 800;
  }

  .page-content {
    position: relative;
    min-width: 0;
    padding-top: 16px;
  }

  .locked-content {
    min-height: calc(100vh - 100px);
  }

  .blurred-page {
    filter: blur(8px);
    opacity: 0.32;
    pointer-events: none;
    user-select: none;
  }

  .locked-overlay {
    position: absolute;
    inset: 16px 0 0;
    z-index: 50;
    display: grid;
    place-items: start center;
    padding-top: 80px;
  }

  .locked-card {
    position: relative;
    overflow: hidden;
    width: min(620px, 92%);
    padding: 34px;
    border-radius: 30px;
    text-align: center;
    border: 1px solid rgba(255,255,255,0.1);
    background:
      linear-gradient(180deg, rgba(15,22,43,0.96), rgba(7,10,24,0.98));
    box-shadow: 0 30px 90px rgba(0,0,0,0.55);
  }

  .locked-orb {
    position: absolute;
    inset: -120px -100px auto auto;
    width: 300px;
    height: 300px;
    border-radius: 999px;
    background: rgba(168,85,247,0.2);
    filter: blur(40px);
  }

  .locked-card span,
  .locked-card h2,
  .locked-card p,
  .locked-card a,
  .locked-card button {
    position: relative;
    z-index: 1;
  }

  .locked-card span {
    color: #9fb2ee;
    font-size: 12px;
    font-weight: 850;
    letter-spacing: 0.14em;
  }

  .locked-card h2 {
    margin: 12px 0 10px;
    color: #ffffff;
    font-size: 38px;
    letter-spacing: -0.05em;
  }

  .locked-card p {
    margin: 0 auto 22px;
    max-width: 480px;
    color: #a9b4d0;
    line-height: 1.7;
  }

  @media (max-width: 1100px) {
    .shell-frame {
      grid-template-columns: 1fr;
    }

    .sidebar {
      position: relative;
      height: auto;
      overflow: visible;
      border-right: none;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }

    .nav-list {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .sidebar-mini {
      display: none;
    }

    .content-shell {
      padding-top: 14px;
    }
  }

  @media (max-width: 760px) {
    .content-shell,
    .sidebar {
      padding-left: 12px;
      padding-right: 12px;
    }

    .topbar {
      position: relative;
      top: auto;
      flex-direction: column;
      align-items: stretch;
    }

    .profile-button {
      width: 100%;
      min-width: 0;
    }

    .nav-list {
      grid-template-columns: 1fr;
    }

    .locked-card {
      padding: 26px;
    }

    .locked-card h2 {
      font-size: 30px;
    }
  }
`;
