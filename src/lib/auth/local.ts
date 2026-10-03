/**
 * Application-owned auth. Stores users in turbopuffer's `users` namespace,
 * hashes passwords with Bun's built-in bcrypt, and issues JWTs signed
 * with LANGOUSTE_JWT_SECRET.
 *
 * JWT payload:
 *   { sub: user_id, iat: <epoch-seconds>, exp: <epoch-seconds> }
 *
 * turbopuffer is not an identity provider and has no row-level auth, so all
 * authenticated routes validate these tokens before querying storage.
 */

import { sign, verify } from "hono/jwt";
import { randomUUIDv7 } from "bun";
import { adminDb } from "../db/index.ts";
import { config } from "../config.ts";

export interface LocalUser {
  user_id: string;
  email: string;
  password_hash: string;
  created_at: string;
}

export interface LocalSession {
  access_token: string;
  expires_at: number;
  user: { id: string; email: string };
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — local app, long-lived

const LOCAL_USER_EMAIL = "local@langouste";
const LOCAL_DISPLAY_NAME = "You";
const LOCAL_BASE_LANGUAGE = "en";

/**
 * Single-user mode: ensure a local user + profile exists and return a fresh
 * session for it. Idempotent — safe to call on every boot / page load.
 */
export async function ensureLocalSession(): Promise<LocalSession> {
  const db = adminDb();
  let user = await db.selectOne<LocalUser>("users", {
    filters: [{ op: "eq", column: "email", value: LOCAL_USER_EMAIL }],
  });

  if (!user) {
    // Password is a random value the user never sees. Auth is bypassed.
    const passwordHash = await Bun.password.hash(crypto.randomUUID(), {
      algorithm: "bcrypt",
      cost: 10,
    });
    user = await db.insert<LocalUser>("users", {
      user_id: Bun.randomUUIDv7(),
      email: LOCAL_USER_EMAIL,
      password_hash: passwordHash,
    });

    await db.insert("profiles", {
      user_id: user.user_id,
      display_name: LOCAL_DISPLAY_NAME,
      base_language: LOCAL_BASE_LANGUAGE,
      learning_languages: [],
    });
  }

  return issueSession(user);
}

export async function signup(email: string, password: string): Promise<LocalSession> {
  const normalizedEmail = email.trim().toLowerCase();
  const db = adminDb();

  const existing = await db.selectOne<LocalUser>("users", {
    filters: [{ op: "eq", column: "email", value: normalizedEmail }],
  });
  if (existing) {
    throw new Error("An account with this email already exists");
  }

  const passwordHash = await Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
  const user = await db.insert<LocalUser>("users", {
    user_id: randomUUIDv7(),
    email: normalizedEmail,
    password_hash: passwordHash,
  });

  return issueSession(user);
}

export async function login(email: string, password: string): Promise<LocalSession> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await adminDb().selectOne<LocalUser>("users", {
    filters: [{ op: "eq", column: "email", value: normalizedEmail }],
  });
  if (!user) {
    throw new Error("Invalid email or password");
  }

  const ok = await Bun.password.verify(password, user.password_hash);
  if (!ok) {
    throw new Error("Invalid email or password");
  }

  return issueSession(user);
}

export async function validateToken(token: string): Promise<{ userId: string } | null> {
  try {
    const payload = (await verify(token, config.jwtSecret, "HS256")) as {
      sub?: string;
      exp?: number;
    };
    if (!payload.sub) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

async function issueSession(user: LocalUser): Promise<LocalSession> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + TOKEN_TTL_SECONDS;
  const access_token = await sign({ sub: user.user_id, iat: now, exp }, config.jwtSecret);
  return {
    access_token,
    expires_at: exp,
    user: { id: user.user_id, email: user.email },
  };
}
