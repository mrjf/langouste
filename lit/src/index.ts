import { normalizeRequest } from "./language";
import { HttpLitProvider } from "./providers/http";
import { KanaIpaProvider } from "./providers/kana-ipa";
import { PhonemizeIpaProvider } from "./providers/phonemize-ipa";
import { PiperPlusIpaProvider } from "./providers/piper-plus-ipa";
import { RuleIpaProvider } from "./providers/rule-ipa";
import { UnicodeLatinProvider } from "./providers/unicode-latin";
import type { LitProvider, LitRequest, LitResult, NormalizedLitRequest } from "./types";

const providers: LitProvider[] = [
  new PhonemizeIpaProvider(),
  new PiperPlusIpaProvider(),
  new KanaIpaProvider(),
  new RuleIpaProvider(),
  new UnicodeLatinProvider(),
];

export function registerLitProvider(provider: LitProvider): void {
  providers.unshift(provider);
}

export function litProviders(): LitProvider[] {
  return [...providers];
}

export async function transliterateText(text: string, request: LitRequest): Promise<LitResult> {
  return (await transliterateTexts([text], request))[0]!;
}

export async function transliterateTexts(
  texts: string[],
  request: LitRequest,
): Promise<LitResult[]> {
  const normalized = normalizeRequest(request);
  const dictionaryResults = await applyDictionaries(texts, normalized);
  const missingTexts: string[] = [];
  const missingIndexes: number[] = [];

  for (let index = 0; index < texts.length; index += 1) {
    if (dictionaryResults[index]) continue;
    missingIndexes.push(index);
    missingTexts.push(texts[index] ?? "");
  }

  const output: Array<LitResult | null> = [...dictionaryResults];
  if (missingTexts.length > 0) {
    const provider = providers.find((candidate) => candidate.supports(normalized));
    if (!provider) {
      throw new Error(
        `No deterministic lit provider for ${normalized.from.system}:${normalized.from.language} -> ${normalized.to.system}:${normalized.to.language}`,
      );
    }
    const providerResults = await provider.transliterate(missingTexts, normalized);
    for (let index = 0; index < providerResults.length; index += 1) {
      output[missingIndexes[index]!] = providerResults[index]!;
    }
  }

  return output.map((item) => {
    if (!item) throw new Error("Lit provider returned an incomplete result set");
    return item;
  });
}

async function applyDictionaries(
  texts: string[],
  request: NormalizedLitRequest,
): Promise<Array<LitResult | null>> {
  if (request.dictionaries.length === 0) return texts.map(() => null);
  const results: Array<LitResult | null> = [];
  for (const text of texts) {
    let result: LitResult | null = null;
    for (const dictionary of request.dictionaries) {
      const dictionaryResult = await dictionary.lookup({
        text,
        from: request.from,
        to: request.to,
      });
      if (!dictionaryResult?.text) continue;
      result = {
        text: dictionaryResult.text,
        from: request.from,
        to: request.to,
        provider: `dictionary:${dictionary.id}`,
        deterministic: true,
        ...(dictionaryResult.confidence !== undefined
          ? { confidence: dictionaryResult.confidence }
          : {}),
        ...(dictionaryResult.source ? { warnings: [`source:${dictionaryResult.source}`] } : {}),
      };
      break;
    }
    results.push(result);
  }
  return results;
}

export { HttpLitProvider };
export { KanaIpaProvider } from "./providers/kana-ipa";
export { PhonemizeIpaProvider } from "./providers/phonemize-ipa";
export { PiperPlusIpaProvider } from "./providers/piper-plus-ipa";
export { RuleIpaProvider } from "./providers/rule-ipa";
export { UnicodeLatinProvider } from "./providers/unicode-latin";
export { baseLanguage, normalizeLanguage, normalizeRequest, normalizeSystem } from "./language";
export { normalizeIpaOutput, wrapIpa } from "./ipa";
export type {
  LitDictionary,
  LitDictionaryLookupInput,
  LitDictionaryResult,
  LitEndpoint,
  LitProvider,
  LitRequest,
  LitResult,
  LitSystem,
  NormalizedLitRequest,
} from "./types";
