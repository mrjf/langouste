import { strict as assert } from "node:assert";
import { loadCourseCatalog } from "../../src/services/course/catalog.ts";
const base = "http://127.0.0.1:8791";
async function request(path: string, body?: unknown, cookie?: string) {
  return fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { Origin: base, "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const lessons = await loadCourseCatalog();
const l = lessons.find((x) => x.language === "hu" && x.day === 15)!;
assert.equal((await request("/api/course")).status, 200);
const publicLesson = await (await request(`/api/course/${l.id}`)).json();
assert.equal(publicLesson.lesson.exercises[0].acceptedAnswers, undefined);
assert.deepEqual(publicLesson.progress.exercises, {});
assert.equal(
  (await request(`/api/course/${l.id}/actions`, { type: "navigate", step: "practice" })).status,
  401,
);
assert.equal((await request("/api/auth/local", {})).status, 404);
assert.equal(
  (await request("/api/login", { email: "local@langouste", password: "any" })).status,
  401,
);
assert.equal((await fetch(`${base}/api/login`, { method: "POST", body: "{}" })).status, 403);
async function login(name: string) {
  const r = await request("/api/login", {
    email: `${name}@example.invalid`,
    password: "isolated-test-password",
  });
  assert.equal(r.status, 200, await r.clone().text());
  const c = r.headers.get("set-cookie")!;
  assert(c.includes("HttpOnly") && c.includes("Secure") && c.includes("SameSite=Strict"));
  return c.split(";")[0];
}
const alice = await login("alice"),
  bob = await login("bob");
assert.equal((await request("/api/session", undefined, alice)).status, 200);
const e = l.exercises.find((e) => e.type === "recall")!;
assert.equal(
  (await request(`/api/course/${l.id}/actions`, { type: "hint", exerciseId: e.id }, alice)).status,
  200,
);
const action = {
  type: "answer",
  exerciseId: e.id,
  attemptId: "cloud-isolated-retry-test",
  answer: e.acceptedAnswers[0],
};
const results = await Promise.all([
  request(`/api/course/${l.id}/actions`, action, alice),
  request(`/api/course/${l.id}/actions`, action, alice),
]);
for (const r of results) {
  assert.equal(r.status, 200, await r.clone().text());
  const b = await r.json();
  assert.equal(b.progress.exercises[e.id].attempts.length, 1);
  assert.equal(b.progress.exercises[e.id].attempts[0].scored, false);
}
const privateBob = await (await request(`/api/course/${l.id}`, undefined, bob)).json();
assert.deepEqual(privateBob.progress.exercises, {});
const forged = await fetch(`${base}/api/course/${l.id}`, {
  headers: { Cookie: bob, "X-User": "alice" },
});
assert.deepEqual((await forged.json()).progress.exercises, {});
assert.equal((await request("/api/session", undefined, `${alice}tampered`)).status, 401);
for (const lang of ["hu", "ar-EG"])
  for (const day of [1, 15, 30]) {
    const lesson = lessons.find((l) => l.language === lang && l.day === day)!;
    assert.equal((await request(`/api/course/${lesson.id}`)).status, 200);
  }
assert.equal((await request("/index.html")).status, 200);
assert.equal((await request("/audio/manifest.json")).status, 200);
await Bun.write(
  "/tmp/langouste-cloud-test-session.json",
  JSON.stringify({ cookie: alice, lesson: l.id, exercise: e.id }),
);
console.log(
  "PASS: public lessons, private writes, local-login rejection, CSRF, two isolated accounts, forged identity, concurrent idempotent retry, assisted recall, static routes, six lesson endpoints.",
);
