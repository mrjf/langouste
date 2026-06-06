import { toIPA } from "phonemize/all";
import { baseLanguage, targetIs } from "../language";
import { isProbablyUsefulIpa, normalizeIpaOutput, wrapIpa } from "../ipa";
import type { LitProvider, LitResult, NormalizedLitRequest } from "../types";

const SUPPORTED = new Set(["en", "zh", "ru"]);

export class PhonemizeIpaProvider implements LitProvider {
  readonly id = "phonemize";

  supports(request: NormalizedLitRequest): boolean {
    return targetIs(request, ["ipa"]) && SUPPORTED.has(baseLanguage(request.to.language));
  }

  async transliterate(
    texts: string[],
    request: NormalizedLitRequest,
  ): Promise<LitResult[]> {
    const language = baseLanguage(request.to.language);
    return texts.map((text) => {
      const ipa = normalizeIpaOutput(
        toIPA(text, {
          language,
          anyAscii: language === "ru",
        }),
      );
      return {
        text: wrapIpa(ipa),
        from: request.from,
        to: request.to,
        provider: this.id,
        deterministic: true,
        confidence: isProbablyUsefulIpa(text, ipa, language) ? 0.82 : 0.45,
      };
    });
  }
}
