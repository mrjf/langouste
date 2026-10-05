import { DurableObject } from "cloudflare:workers";
import { compare } from "bcryptjs";
import { sign, verify } from "hono/jwt";
import { database } from "./database.ts";
import { findCourseAccount, courseAccountById } from "../src/services/database/course-auth.ts";
import { getCourseProgress, listCourseProgress } from "../src/services/database/course.ts";
import {
  actOnCourse,
  emptyCourseProgress,
  courseExerciseFeedback,
} from "../src/services/course/progress.ts";
import { publicCourseLesson } from "../src/services/course/public.ts";
import type { CourseLesson, CourseAction } from "../src/types/course.ts";
import { summaries, lessons } from "./generated/catalog.ts";
export interface Env {
  ACCOUNTS: DurableObjectNamespace;
  TURBOPUFFER_API_KEY: string;
  TURBOPUFFER_REGION: string;
  TURBOPUFFER_NAMESPACE_PREFIX: string;
  LANGOUSTE_JWT_SECRET: string;
}
const cookie = "__Host-langouste_course";
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
  });
const lesson = (id: string): CourseLesson | null =>
  Object.hasOwn(lessons, id) ? JSON.parse(lessons[id]) : null;
async function identity(req: Request, env: Env) {
  const token = req.headers
    .get("Cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${cookie}=`))
    ?.slice(cookie.length + 1);
  if (!token) return null;
  try {
    const p = await verify(token, env.LANGOUSTE_JWT_SECRET, "HS256");
    return p.aud === "langouste-course" &&
      typeof p.sub === "string" &&
      typeof p.exp === "number" &&
      p.exp > Date.now() / 1000
      ? p.sub
      : null;
  } catch {
    return null;
  }
}
function forward(env: Env, key: string, req: Request) {
  return env.ACCOUNTS.get(env.ACCOUNTS.idFromName(key)).fetch(req);
}
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(req.url);
      const path = url.pathname;
      if (req.method !== "GET" && req.method !== "POST")
        return json({ error: "Method not allowed" }, 405);
      if (req.method === "POST" && req.headers.get("Origin") !== url.origin)
        return json({ error: "Origin required" }, 403);
      if (req.method === "POST" && Number(req.headers.get("Content-Length") || 0) > 8192)
        return json({ error: "Request too large" }, 413);
      if (path === "/api/logout" && req.method === "POST")
        return json({ ok: true }, 200, {
          "Set-Cookie": `${cookie}=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
        });
      if (path === "/api/login" && req.method === "POST") {
        const raw = await req.text();
        if (raw.length > 8192) return json({ error: "Request too large" }, 413);
        let body: { email?: unknown; password?: unknown } | null;
        try {
          body = JSON.parse(raw);
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }
        if (
          !body ||
          typeof body.email !== "string" ||
          body.email.length > 254 ||
          typeof body.password !== "string" ||
          !body.password ||
          body.password.length > 256
        )
          return json({ error: "Invalid login" }, 400);
        const email = body.email.trim().toLowerCase();
        if (email === "local@langouste") return json({ error: "Invalid login" }, 401);
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
        const key = Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join(
          "",
        );
        return await forward(
          env,
          `login:${key}`,
          new Request("https://internal/login", {
            method: "POST",
            body: JSON.stringify({ email, password: body.password }),
          }),
        );
      }
      const user = await identity(req, env);
      if (path === "/api/session")
        return user
          ? await forward(
              env,
              `user:${user}`,
              new Request("https://internal/session", { headers: { "X-User": user } }),
            )
          : json({ error: "Sign in required" }, 401);
      const m = path.match(/^\/api\/course(?:\/([\w-]+))?(\/actions)?$/);
      if (!m) return json({ error: "Not found" }, 404);
      if ((m[2] && req.method !== "POST") || (!m[2] && req.method !== "GET"))
        return json({ error: "Method not allowed" }, 405);
      if (m[1] && !Object.hasOwn(lessons, m[1])) return json({ error: "Not found" }, 404);
      if (!user) {
        if (m[2]) return json({ error: "Sign in to save practice" }, 401);
        const l = m[1] ? lesson(m[1]) : null;
        return json(
          l
            ? { lesson: publicCourseLesson(l), progress: emptyCourseProgress(l), feedback: {} }
            : { lessons: summaries, progress: [] },
        );
      }
      const raw = req.method === "POST" ? await req.text() : undefined;
      if (raw && raw.length > 8192) return json({ error: "Request too large" }, 413);
      return await forward(
        env,
        `user:${user}`,
        new Request(`https://internal${path}`, {
          method: req.method,
          headers: { "X-User": user },
          body: raw,
        }),
      );
    } catch {
      return json(
        { error: "Account service unavailable. Your progress has not been discarded." },
        503,
      );
    }
  },
};
// One coordinator per user serializes every lesson/FSRS mutation across isolates.
// Login coordinators use hashed email names and retain only bounded rate counters.
export class AccountCoordinator extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const db = database(this.env);
      const path = new URL(req.url).pathname;
      if (path === "/login") {
        const body = (await req.json()) as { email: string; password: string };
        const now = Date.now();
        const old = await this.ctx.storage.get<{ start: number; count: number }>("login-rate");
        const rate = old && now - old.start < 900000 ? old : { start: now, count: 0 };
        if (rate.count >= 5) return json({ error: "Try again later" }, 429);
        rate.count++;
        await this.ctx.storage.put("login-rate", rate);
        const account = await findCourseAccount(db, body.email);
        if (
          !account ||
          account.email === "local@langouste" ||
          !/^\$2[aby]\$\d{2}\$/.test(account.password_hash) ||
          !(await compare(body.password, account.password_hash))
        )
          return json({ error: "Invalid login" }, 401);
        const token = await sign(
          {
            sub: account.user_id,
            aud: "langouste-course",
            iat: Math.floor(now / 1000),
            exp: Math.floor(now / 1000) + 86400,
          },
          this.env.LANGOUSTE_JWT_SECRET,
          "HS256",
        );
        return json({ ok: true }, 200, {
          "Set-Cookie": `${cookie}=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
        });
      }
      const user = req.headers.get("X-User")!;
      const account = await courseAccountById(db, user);
      if (!account || account.email === "local@langouste")
        return json({ error: "Sign in required" }, 401);
      if (path === "/session") return json({ signedIn: true });
      const parts = path.split("/");
      const l = parts[3] ? lesson(parts[3]) : null;
      if (!l) return json({ lessons: summaries, progress: await listCourseProgress(db, user) });
      if (req.method === "POST") {
        let action: CourseAction;
        try {
          action = (await req.json()) as CourseAction;
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }
        if (!action || typeof action.type !== "string")
          return json({ error: "Invalid action" }, 400);
        return json(await actOnCourse(db, user, l, action));
      }
      const progress = (await getCourseProgress(db, user, l.id)) ?? emptyCourseProgress(l);
      const feedback = Object.fromEntries(
        l.exercises.flatMap((e) => {
          const s = progress.exercises[e.id];
          if (!s) return [];
          const a = s.attempts.at(-1);
          return [
            [
              e.id,
              a || s.revealed
                ? { ...courseExerciseFeedback(e), correct: a?.correct, scored: a?.scored }
                : s.hinted
                  ? { text: e.hint }
                  : { text: "" },
            ],
          ];
        }),
      );
      return json({ lesson: publicCourseLesson(l), progress, feedback });
    });
  }
}
