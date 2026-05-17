/**
 * Thin wrapper around the test-mode /api/test routes. Use from inside tests
 * to register stub responses and wipe state between tests.
 *
 * Base URL comes from LANGOUSTE_E2E_BASE_URL, written by playwright.config.ts
 * when the test app spins up.
 */

import type { APIRequestContext } from "@playwright/test";

export const BASE_URL = process.env.LANGOUSTE_E2E_BASE_URL ?? "";

export interface StubExplainResponse {
  corrected_message: string;
  explanations?: Array<{
    error_index: number;
    corrected: string;
    explanations: Record<string, string>;
  }>;
  additional_errors?: Array<{
    start: number;
    end: number;
    text: string;
    corrected: string;
    kind: "grammar";
    explanations: Record<string, string>;
  }>;
}

export interface StubVocabResponse {
  new_vocabulary?: Array<{
    term: string;
    translation: string;
    context_sentence?: string | null;
    cefr_level?: string | null;
  }>;
  grammar_gaps_detected?: Array<{ category: string; description: string }>;
  next_challenge?: string;
}

export class TestApi {
  constructor(private request: APIRequestContext) {}

  // --- Stub registration ---

  async setAgentReply(prompt: string, reply: string): Promise<void> {
    await this.post("/api/test/agent/reply", { prompt, reply });
  }

  async setDefaultAgentReply(reply: string): Promise<void> {
    await this.post("/api/test/agent/reply", { default: true, reply });
  }

  async setExplainResponse(text: string, response: StubExplainResponse): Promise<void> {
    await this.post("/api/test/ai/explain", { text, response });
  }

  async setDefaultExplainResponse(response: StubExplainResponse | null): Promise<void> {
    await this.post("/api/test/ai/explain", { default: true, response });
  }

  async setVocabResponse(text: string, response: StubVocabResponse): Promise<void> {
    await this.post("/api/test/ai/vocab", { text, response });
  }

  async setDefaultVocabResponse(response: StubVocabResponse | null): Promise<void> {
    await this.post("/api/test/ai/vocab", { default: true, response });
  }

  async setTranslation(text: string, target_language: string, translation: string): Promise<void> {
    await this.post("/api/test/ai/translate", { text, target_language, translation });
  }

  // --- State management ---

  async resetStubs(): Promise<void> {
    await this.post("/api/test/reset-stubs", {});
  }

  async resetDb(): Promise<void> {
    await this.post("/api/test/reset-db", {});
  }

  async resetAgents(connectorIds: string[]): Promise<void> {
    await this.post("/api/test/reset-agents", { connector_ids: connectorIds });
  }

  /** Full reset between tests: stubs + DB + cached agents. */
  async fullReset(): Promise<void> {
    await this.resetStubs();
    await this.resetDb();
  }

  // --- Introspection ---

  async dbTable(table: string): Promise<unknown[]> {
    const res = await this.request.get(`${BASE_URL}/api/test/db/${table}`);
    if (!res.ok()) throw new Error(`db table ${table} fetch failed: ${res.status()}`);
    return res.json();
  }

  private async post(path: string, body: unknown): Promise<void> {
    // Retry once on ECONNRESET: Playwright's request fixture pools keep-alive
    // sockets, and Bun's HTTP server may idle-close a pooled socket between
    // tests. The retry opens a fresh connection.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this.request.post(`${BASE_URL}${path}`, { data: body });
        if (!res.ok()) {
          const text = await res.text();
          throw new Error(`POST ${path} → ${res.status()}: ${text}`);
        }
        return;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("ECONNRESET")) throw err;
      }
    }
    throw lastErr;
  }
}

/**
 * Get an authenticated token for the local user. In single-user mode this
 * is handled automatically by the UI, but some tests want to hit the API
 * directly with the same token.
 */
export async function getLocalToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/auth/local`);
  if (!res.ok()) throw new Error(`auth/local failed: ${res.status()}`);
  const body = await res.json();
  return body.session.access_token;
}

/** Spawn a Claude stub connector with the given name, returns its ID. */
export async function createStubConnector(
  request: APIRequestContext,
  token: string,
  name = "test-stub",
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/agent-connectors`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, type: "stub", config: {} },
  });
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`create stub connector failed: ${res.status()} ${text}`);
  }
  const body = await res.json();
  return body.connector_id;
}
