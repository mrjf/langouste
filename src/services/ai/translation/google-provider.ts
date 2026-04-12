import { TranslationServiceClient } from "@google-cloud/translate";
import { config } from "../../../lib/config.ts";
import type { TranslationProvider } from "./provider.ts";

/**
 * Translation provider using Google Cloud Translation LLM (TLLM).
 * Passes source context via HTML comments to steer colloquial translation
 * without confusing the source language detection.
 */
export class GoogleTranslationProvider implements TranslationProvider {
  private client: TranslationServiceClient;
  private projectId: string;
  private location: string;

  constructor() {
    this.client = new TranslationServiceClient();
    this.projectId = config.googleCloudProject;
    this.location = config.googleCloudLocation;
  }

  async translateTexts(
    texts: string[],
    targetLanguage: string,
    _context?: string,
  ): Promise<string[]> {
    if (texts.length === 0) return [];

    const parent = `projects/${this.projectId}/locations/${this.location}`;
    const model = `${parent}/models/general/translation-llm`;

    // Wrap in HTML with a context comment. The translation-llm model
    // respects HTML structure and the comment provides colloquial context
    // without polluting source language detection.
    const contents = texts.map(
      (t) => `<!-- casual chat between friends, translate colloquially --><p>${t}</p>`,
    );

    const [response] = await this.client.translateText({
      parent,
      contents,
      mimeType: "text/html",
      targetLanguageCode: targetLanguage,
      model,
    });

    if (!response.translations || response.translations.length !== texts.length) {
      throw new Error(
        `Google TLLM returned ${response.translations?.length ?? 0} translations, expected ${texts.length}`,
      );
    }

    // Strip HTML tags from the result
    return response.translations.map((t) => {
      let result = t.translatedText ?? "";
      result = result.replace(/<!--.*?-->/g, "");
      result = result.replace(/<\/?p>/g, "");
      return result.trim();
    });
  }
}
