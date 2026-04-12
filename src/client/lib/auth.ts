import { user, session, profile } from "./stores.svelte";
import { api } from "./api";
import { setRealtimeAuth } from "./supabase";

const SESSION_KEY = "langouste_session";

export function loadSession(): boolean {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      session.value = parsed.session;
      user.value = parsed.user;
      // Authenticate Supabase realtime client
      if (parsed.session?.access_token) {
        setRealtimeAuth(parsed.session.access_token, parsed.session.refresh_token);
      }
      return true;
    }
  } catch {
    localStorage.removeItem(SESSION_KEY);
  }
  return false;
}

export function saveSession(sess: unknown, u: unknown) {
  session.value = sess as any;
  user.value = u as any;
  localStorage.setItem(SESSION_KEY, JSON.stringify({ session: sess, user: u }));
  // Authenticate Supabase realtime client
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
