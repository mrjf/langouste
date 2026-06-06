import { G2P, type Language as PiperLanguage } from "@piper-plus/g2p";
import { baseLanguage, targetIs } from "../language";
import { isProbablyUsefulIpa, normalizeIpaOutput, wrapIpa } from "../ipa";
import type { LitProvider, LitResult, NormalizedLitRequest } from "../types";

const SUPPORTED = new Set<PiperLanguage>(["es", "fr", "pt", "sv", "ko"]);

export class PiperPlusIpaProvider implements LitProvider {
  readonly id = "piper-plus-g2p";
  private g2p: Promise<G2P> | null = null;

  supports(request: NormalizedLitRequest): boolean {
    const language = baseLanguage(request.to.language) as PiperLanguage;
    return targetIs(request, ["ipa"]) && SUPPORTED.has(language);
  }

  async transliterate(
    texts: string[],
    request: NormalizedLitRequest,
  ): Promise<LitResult[]> {
    const language = baseLanguage(request.to.language) as PiperLanguage;
    if (!SUPPORTED.has(language)) {
      throw new Error(`@piper-plus/g2p does not support language: ${language}`);
    }
    const g2p = await this.getG2p();
    return texts.map((text) => {
      const tokens = g2p.phonemize(text, { language }).tokens;
      const ipa = normalizeIpaOutput(tokens.join(""));
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

  private getG2p(): Promise<G2P> {
    let g2p = this.g2p;
    if (!g2p) {
      g2p = G2P.create({ languages: [...SUPPORTED] });
      this.g2p = g2p;
    }
    return g2p;
  }
}
