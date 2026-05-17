import { expect } from "@playwright/test";
import {
  test,
  TestApi,
  createConnector,
  requireAnthropicKey,
  sendAndAwaitReply,
  startChatWith,
  waitFor,
} from "./helpers";

test.describe("Claude connector (direct Anthropic API)", () => {
  test.beforeEach(async ({ request }) => {
    await requireAnthropicKey(test);
    await new TestApi(request).fullReset();
  });

  test("real chat turn with Haiku produces a reply and persists state", async ({
    page,
    request,
  }) => {
    // Haiku to keep per-test cost low.
    await createConnector(request, {
      name: "claude-real",
      type: "claude",
      config: { model: "claude-haiku-4-5-20251001" },
    });

    await startChatWith(page, "claude-real");
    await sendAndAwaitReply(page, "Reply with a single short English sentence.");

    // The user + agent messages are in the DB.
    const api = new TestApi(request);
    const messages = (await api.dbTable("messages")) as Array<{
      raw_text: string;
      is_agent: number;
    }>;
    expect(messages.length).toBeGreaterThanOrEqual(2);
    const userMsg = messages.find((m) => !m.is_agent);
    const agentMsg = messages.find((m) => !!m.is_agent);
    expect(userMsg?.raw_text).toBe("Reply with a single short English sentence.");
    expect((agentMsg?.raw_text ?? "").length).toBeGreaterThan(0);
  });

  test("vocabulary extractor runs against real Sonnet and populates vocab table", async ({
    page,
    request,
  }) => {
    await createConnector(request, {
      name: "claude-vocab",
      type: "claude",
      config: { model: "claude-haiku-4-5-20251001" },
    });

    await startChatWith(page, "claude-vocab");
    // A French utterance that Sonnet should produce vocabulary from.
    await sendAndAwaitReply(page, "Bonjour, je suis très content de te rencontrer aujourd'hui.");

    // Vocab extractor is fire-and-forget; real Sonnet takes a few seconds.
    const api = new TestApi(request);
    await waitFor(async () => ((await api.dbTable("vocabulary")) as unknown[]).length > 0, 30_000);

    const vocab = (await api.dbTable("vocabulary")) as Array<{ term: string }>;
    expect(vocab.length).toBeGreaterThan(0);

    const logs = (await api.dbTable("review_log")) as Array<{
      event_type: string;
      outcome: string | null;
    }>;
    expect(logs.some((l) => l.event_type === "production" && l.outcome === "correct")).toBe(true);
  });
});
