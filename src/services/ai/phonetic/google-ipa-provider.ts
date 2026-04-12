import { GoogleGenAI } from "@google/genai";
import { config } from "../../../lib/config.ts";
import { languageName } from "../../../lib/languages.ts";
import type { PhoneticProvider } from "./provider.ts";

/**
 * IPA transcription provider using Google Gemini.
 */
export class GoogleIpaProvider implements PhoneticProvider {
  readonly system = "ipa";
  private client: GoogleGenAI;

  constructor() {
    this.client = new GoogleGenAI({ apiKey: config.googleAiApiKey });
  }

  supports(_language: string): boolean {
    return true; // IPA covers all languages
  }

  async transcribe(texts: string[], language: string): Promise<string[]> {
    if (texts.length === 0) return [];

    const numbered = texts.map((t, i) => `[${i}] ${t}`).join("\n");

    const response = await this.client.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Generate IPA (International Phonetic Alphabet) transcriptions for each ${languageName(language)} text below. Use broad transcription with slashes (e.g., /bɔ̃ʒuʁ/). Be accurate to the standard pronunciation of ${languageName(language)}. Return exactly ${texts.length} transcriptions in the same order.

Respond with ONLY a JSON array of strings, no other text. Example: ["/bɔ̃ʒuʁ/", "/mɛʁsi/"]

${numbered}`,
    });

    const raw = response.text?.trim();
    if (!raw) {
      throw new Error("Google AI returned empty IPA response");
    }

    const jsonStr = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed) || parsed.length !== texts.length) {
      throw new Error(
        `Google AI returned ${Array.isArray(parsed) ? parsed.length : "non-array"} IPA transcriptions, expected ${texts.length}`,
      );
    }

    return parsed;
  }
}
