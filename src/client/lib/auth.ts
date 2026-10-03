import { user, session, profile } from "./stores.svelte";
import { api } from "./api";

const SESSION_KEY = "langouste_session";

/**
 * Try to restore session from localStorage.
 * Restore the application-owned JWT from localStorage.
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
