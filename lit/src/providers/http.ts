import { targetIs } from "../language";
import type { LitProvider, LitResult, NormalizedLitRequest } from "../types";

export interface HttpLitProviderOptions {
  id?: string;
  endpoint: string;
  systems?: string[];
  languages?: string[];
  headers?: Record<string, string>;
}

export class HttpLitProvider implements LitProvider {
  readonly id: string;
  private readonly endpoint: string;
  private readonly systems: Set<string> | null;
  private readonly languages: Set<string> | null;
  private readonly headers: Record<string, string>;

  constructor(options: HttpLitProviderOptions) {
    this.id = options.id ?? "http-lit";
    this.endpoint = options.endpoint;
    this.systems = options.systems ? new Set(options.systems.map((item) => item.toLowerCase())) : null;
    this.languages = options.languages
      ? new Set(options.languages.map((item) => item.toLowerCase()))
      : null;
    this.headers = options.headers ?? {};
  }

  supports(request: NormalizedLitRequest): boolean {
    if (this.systems && !targetIs(request, [...this.systems])) return false;
    if (this.languages && !this.languages.has((request.to.language ?? "und").toLowerCase())) {
      return false;
    }
    return true;
  }

  async transliterate(
    texts: string[],
    request: NormalizedLitRequest,
  ): Promise<LitResult[]> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.headers,
      },
      body: JSON.stringify({
        texts,
        from: request.from,
        to: request.to,
      }),
    });
    if (!response.ok) {
      throw new Error(`Lit HTTP provider failed with ${response.status}`);
    }
    const payload = (await response.json()) as { results?: Array<string | { text: string }> };
    const results = payload.results ?? [];
    if (results.length !== texts.length) {
      throw new Error(`Lit HTTP provider returned ${results.length} results for ${texts.length} texts`);
    }
    return results.map((result) => ({
      text: typeof result === "string" ? result : result.text,
      from: request.from,
      to: request.to,
      provider: this.id,
      deterministic: true,
    }));
  }
}
