import { transliterate } from "transliteration";
import { targetIs } from "../language";
import type { LitProvider, LitResult, NormalizedLitRequest } from "../types";

export class UnicodeLatinProvider implements LitProvider {
  readonly id = "unicode-latin";

  supports(request: NormalizedLitRequest): boolean {
    return targetIs(request, ["latin", "roman", "romanization", "ascii"]);
  }

  async transliterate(
    texts: string[],
    request: NormalizedLitRequest,
  ): Promise<LitResult[]> {
    return texts.map((text) => ({
      text: transliterate(text),
      from: request.from,
      to: request.to,
      provider: this.id,
      deterministic: true,
    }));
  }
}
