import { baseLanguage, targetIs } from "../language";
import { wrapIpa } from "../ipa";
import type { LitProvider, LitResult, NormalizedLitRequest } from "../types";

const MORA: Record<string, string> = {
  あ: "a",
  い: "i",
  う: "ɯ",
  え: "e",
  お: "o",
  か: "ka",
  き: "ki",
  く: "kɯ",
  け: "ke",
  こ: "ko",
  が: "ɡa",
  ぎ: "ɡi",
  ぐ: "ɡɯ",
  げ: "ɡe",
  ご: "ɡo",
  さ: "sa",
  し: "ɕi",
  す: "sɯ",
  せ: "se",
  そ: "so",
  ざ: "za",
  じ: "dʑi",
  ず: "zɯ",
  ぜ: "ze",
  ぞ: "zo",
  た: "ta",
  ち: "tɕi",
  つ: "tsɯ",
  て: "te",
  と: "to",
  だ: "da",
  ぢ: "dʑi",
  づ: "zɯ",
  で: "de",
  ど: "do",
  な: "na",
  に: "ɲi",
  ぬ: "nɯ",
  ね: "ne",
  の: "no",
  は: "ha",
  ひ: "çi",
  ふ: "ɸɯ",
  へ: "he",
  ほ: "ho",
  ば: "ba",
  び: "bi",
  ぶ: "bɯ",
  べ: "be",
  ぼ: "bo",
  ぱ: "pa",
  ぴ: "pi",
  ぷ: "pɯ",
  ぺ: "pe",
  ぽ: "po",
  ま: "ma",
  み: "mi",
  む: "mɯ",
  め: "me",
  も: "mo",
  や: "ja",
  ゆ: "jɯ",
  よ: "jo",
  ら: "ɾa",
  り: "ɾi",
  る: "ɾɯ",
  れ: "ɾe",
  ろ: "ɾo",
  わ: "wa",
  を: "o",
  ん: "ɴ",
  ゔ: "vɯ",
  きゃ: "kja",
  きゅ: "kjɯ",
  きょ: "kjo",
  しゃ: "ɕa",
  しゅ: "ɕɯ",
  しょ: "ɕo",
  ちゃ: "tɕa",
  ちゅ: "tɕɯ",
  ちょ: "tɕo",
  にゃ: "ɲa",
  にゅ: "ɲɯ",
  にょ: "ɲo",
  ひゃ: "ça",
  ひゅ: "çɯ",
  ひょ: "ço",
  みゃ: "mja",
  みゅ: "mjɯ",
  みょ: "mjo",
  りゃ: "ɾja",
  りゅ: "ɾjɯ",
  りょ: "ɾjo",
  ぎゃ: "ɡja",
  ぎゅ: "ɡjɯ",
  ぎょ: "ɡjo",
  じゃ: "dʑa",
  じゅ: "dʑɯ",
  じょ: "dʑo",
  びゃ: "bja",
  びゅ: "bjɯ",
  びょ: "bjo",
  ぴゃ: "pja",
  ぴゅ: "pjɯ",
  ぴょ: "pjo",
};

export class KanaIpaProvider implements LitProvider {
  readonly id = "kana-ipa";

  supports(request: NormalizedLitRequest): boolean {
    return targetIs(request, ["ipa"]) && baseLanguage(request.to.language) === "ja";
  }

  async transliterate(
    texts: string[],
    request: NormalizedLitRequest,
  ): Promise<LitResult[]> {
    return texts.map((text) => {
      const result: LitResult = {
        text: wrapIpa(kanaToIpa(text)),
        from: request.from,
        to: request.to,
        provider: this.id,
        deterministic: true,
        confidence: 0.58,
      };
      if (/[\u4E00-\u9FFF]/u.test(text)) {
        result.warnings = ["Japanese Kanji are passed through by the kana IPA provider."];
      }
      return result;
    });
  }
}

function kanaToIpa(text: string): string {
  const hiragana = katakanaToHiragana(text);
  let output = "";
  let index = 0;
  while (index < hiragana.length) {
    const char = hiragana[index] ?? "";
    const next = hiragana[index + 1] ?? "";
    const pair = char + next;

    if (char === "っ") {
      const nextIpa = MORA[next] ?? MORA[pair] ?? "";
      output += nextIpa[0] ?? "";
      index += 1;
      continue;
    }
    if (char === "ー") {
      output += "ː";
      index += 1;
      continue;
    }
    if (MORA[pair]) {
      output += MORA[pair];
      index += 2;
      continue;
    }
    output += MORA[char] ?? char;
    index += 1;
  }
  return output;
}

function katakanaToHiragana(value: string): string {
  return [...value]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (code >= 0x30a1 && code <= 0x30f6) return String.fromCodePoint(code - 0x60);
      return char;
    })
    .join("");
}
