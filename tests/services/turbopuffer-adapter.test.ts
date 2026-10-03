import { afterEach, describe, expect, test } from "bun:test";
import { Turbopuffer } from "@turbopuffer/turbopuffer";
import { TurbopufferDatabase } from "../../src/lib/db/turbopuffer.ts";

let server: ReturnType<typeof Bun.serve> | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

describe("turbopuffer adapter", () => {
  test("batch-writes chunked JSON and reconstructs it on query", async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    let storedRows: Array<Record<string, unknown>> = [];
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = (await request.json()) as Record<string, unknown>;
        requests.push({ path: new URL(request.url).pathname, body });
        if (new URL(request.url).pathname.endsWith("/query")) {
          return Response.json({ rows: storedRows });
        }
        storedRows = body.upsert_rows as Array<Record<string, unknown>>;
        return Response.json({ rows_affected: storedRows.length });
      },
    });

    const client = new Turbopuffer({
      apiKey: "tpuf_test",
      baseURL: `http://127.0.0.1:${server.port}`,
      maxRetries: 0,
      compression: false,
    });
    const database = new TurbopufferDatabase(client);
    const filoDoc = {
      id: "message:m1",
      text: "bonjour",
      byteLength: 7,
      metadata: { language: "fr" },
      tiers: [{ id: "word", type: "span", annotations: [] }],
    };

    await database.writeRows("messages", [
      {
        message_id: "m1",
        conversation_id: "c1",
        sender_id: "u1",
        raw_text: "bonjour",
        healed_text: "bonjour",
        filo_doc: filoDoc,
      },
    ]);
    const rows = await database.select<Record<string, unknown>>("messages");
    const matches = await database.fullTextSearch<Record<string, unknown>>("messages", "bonjour", {
      fields: [{ column: "raw_text", weight: 2 }, { column: "healed_text" }],
      filters: [{ op: "eq", column: "conversation_id", value: "c1" }],
      columns: "message_id, conversation_id, raw_text",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].filo_doc).toEqual(filoDoc);
    expect(matches[0]).toMatchObject({
      message_id: "m1",
      conversation_id: "c1",
      raw_text: "bonjour",
    });
    expect(matches[0].filo_doc).toBeUndefined();
    expect(requests[0].path).toContain("/namespaces/langouste-messages");
    expect(requests[0].body.schema).toMatchObject({
      raw_text: { type: "string", full_text_search: true },
      _payload_00: { type: "string", filterable: false },
    });
    expect(requests[2].body).toMatchObject({
      filters: ["conversation_id", "Eq", "c1"],
      rank_by: [
        "Sum",
        [
          ["Product", 2, ["raw_text", "BM25", "bonjour"]],
          ["healed_text", "BM25", "bonjour"],
        ],
      ],
      include_attributes: ["message_id", "conversation_id", "raw_text"],
    });
  });
});
