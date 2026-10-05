import { existsSync } from "node:fs";
import { database } from "./database.ts";
const file = Bun.argv[2] ?? "/tmp/langouste-cloud-mock.json";
type Row = Record<string, unknown>;
const data: Record<string, Row[]> = existsSync(file) ? await Bun.file(file).json() : {};
function matches(row: Row, f: any): boolean {
  if (!f) return true;
  const [a, op, v] = f;
  if (a === "And") return op.every((x: any) => matches(row, x));
  if (a === "Or") return op.some((x: any) => matches(row, x));
  if (op === "Eq") return row[a] === v;
  if (op === "In") return v.includes(row[a]);
  if (op === "NotEq") return row[a] !== v;
  throw Error(`Unsupported mock filter ${op}`);
}
Bun.serve({
  port: 8790,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    const ns = decodeURIComponent(path.split("/namespaces/")[1]?.split("/")[0] ?? "");
    if (!ns.startsWith("cloud-qa-")) return new Response("Isolation violation", { status: 403 });
    const body = (await req.json()) as any;
    data[ns] ??= [];
    if (path.endsWith("/query"))
      return Response.json({
        rows: data[ns]
          .filter((r) => matches(r, body.filters))
          .slice(0, body.top_k ?? body.limit ?? 10000),
      });
    for (const r of body.upsert_rows ?? []) {
      const index = data[ns].findIndex((x) => x.id === r.id);
      if (index < 0) data[ns].push(r);
      else data[ns][index] = r;
    }
    if (body.deletes) data[ns] = data[ns].filter((r) => !body.deletes.includes(r.id));
    await Bun.write(file, JSON.stringify(data));
    return Response.json({ rows_affected: (body.upsert_rows ?? []).length });
  },
});
const db = database();
for (const n of ["alice", "bob"]) {
  if (!(await db.selectOne("users", { filters: [{ op: "eq", column: "user_id", value: n }] })))
    await db.insert("users", {
      user_id: n,
      email: `${n}@example.invalid`,
      password_hash: await Bun.password.hash("isolated-test-password", {
        algorithm: "bcrypt",
        cost: 4,
      }),
      display_name: n,
    });
}
console.log("Disposable turbopuffer protocol fixture ready; no real accounts or credentials.");
