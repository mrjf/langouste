import { user, session, profile } from "./stores.svelte";
import { api } from "./api";
import { getSupabase, setRealtimeAuth } from "./supabase";

const SESSION_KEY = "langouste_session";

/**
 * Try to restore session from localStorage.
 * First tries a quick sync restore, then refreshes tokens in background.
 */
export function loadSession(): boolean {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    if (!saved) return false;

    const parsed = JSON.parse(saved);
    if (!parsed.session?.access_token) {
      localStorage.removeItem(SESSION_KEY);
      return false;
    }

    // Restore immediately from localStorage (sync — no waiting)
    session.value = parsed.session;
    user.value = parsed.user;

    // Set realtime auth
    if (parsed.session.access_token) {
      setRealtimeAuth(parsed.session.access_token, parsed.session.refresh_token);
    }

    // Refresh tokens in background (non-blocking)
    const supabase = getSupabase();
    if (supabase) {
      supabase.auth
        .setSession({
          access_token: parsed.session.access_token,
          refresh_token: parsed.session.refresh_token,
        })
        .then(({ data }) => {
          if (data?.session) {
            session.value = data.session as any;
            user.value = data.user as any;
            localStorage.setItem(
              SESSION_KEY,
              JSON.stringify({
                session: data.session,
                user: data.user,
              }),
            );
          }
        })
        .catch(() => {
          // Token refresh failed — stale session will 401 on next API call
          // and the auto-refresh in api.ts will handle it
        });
    }

    return true;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return false;
  }
}

/**
 * Single-user mode: fetch a session from /api/auth/local and store it. The
 * backend auto-creates the local user on first call. No credentials involved.
 */
export async function loadLocalSession(): Promise<boolean> {
  try {
    const result = await api.localSession();
    if (!result?.session?.access_token) return false;
    saveSession(result.session, result.user);
    return true;
  } catch (err) {
    console.error("[auth] local session fetch failed:", err);
    return false;
  }
}

export function saveSession(sess: unknown, u: unknown) {
  session.value = sess as any;
  user.value = u as any;
  localStorage.setItem(SESSION_KEY, JSON.stringify({ session: sess, user: u }));
  const s = sess as any;
  if (s?.access_token) {
    setRealtimeAuth(s.access_token, s.refresh_token);
  }
}

export function clearSession() {
  session.value = null;
  user.value = null;
  profile.value = null;
  localStorage.removeItem(SESSION_KEY);
}

export async function loadProfile() {
  try {
    profile.value = await api.getProfile();
  } catch (err) {
    console.error("Failed to load profile:", err);
  }
}
