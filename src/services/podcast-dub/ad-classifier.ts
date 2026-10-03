import { languageName } from "../../lib/languages.ts";
import { getAnthropicClient } from "../ai/client.ts";
import { requireArray, toolInputObject } from "../ai/tool-output.ts";
import type { DubParagraph } from "./types.ts";

interface AdClassification {
  paragraphIndex: number;
  isAdvertisement: boolean;
  reason: string;
}

const AD_CLASSIFICATION_TOOL = {
  name: "classify_ad_paragraphs" as const,
  description:
    "Classify each podcast transcript paragraph as advertisement/sponsor content or genuine episode content.",
  input_schema: {
    type: "object" as const,
    properties: {
      paragraphs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            paragraphIndex: {
              type: "number",
              description: "The paragraph's exact paragraphIndex from the candidate list.",
            },
            isAdvertisement: {
              type: "boolean",
              description:
                "True if this paragraph is an advertisement, sponsor read, or promotional plug (product, newsletter, other show, membership/Patreon pitch) rather than the host's actual episode content.",
            },
            reason: {
              type: "string",
              description: "Short reason for the decision.",
            },
          },
          required: ["paragraphIndex", "isAdvertisement", "reason"],
        },
      },
    },
    required: ["paragraphs"],
  },
};

const CLASSIFICATION_BATCH_SIZE = 20;

/** Returns the `ordinal`s of paragraphs judged to be ads or sponsor reads. */
export async function classifyAdParagraphs(
  paragraphs: DubParagraph[],
  sourceLanguage: string,
): Promise<Set<number>> {
  if (paragraphs.length === 0) return new Set();
  const adOrdinals = new Set<number>();
  for (const batch of chunk(paragraphs, CLASSIFICATION_BATCH_SIZE)) {
    const classifications = await classifyBatch(batch, sourceLanguage);
    for (const classification of classifications) {
      if (classification.isAdvertisement) adOrdinals.add(classification.paragraphIndex);
    }
  }
  return adOrdinals;
}

async function classifyBatch(
  batch: DubParagraph[],
  sourceLanguage: string,
): Promise<AdClassification[]> {
  const prompt = `You are preparing a podcast transcript for language-learning dubbing. Identify which paragraphs are advertisements, sponsor reads, or promotional plugs (products, newsletters, other shows, membership/Patreon pitches, etc.) rather than the host's actual episode content.

Source language: ${languageName(sourceLanguage)} (${sourceLanguage})

Return exactly one result for every candidate paragraph, using its exact paragraphIndex.

Paragraphs:
${JSON.stringify(
  batch.map((paragraph) => ({ paragraphIndex: paragraph.ordinal, text: paragraph.text })),
  null,
  2,
)}`;

  const response = await getAnthropicClient().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    tools: [AD_CLASSIFICATION_TOOL],
    tool_choice: { type: "tool", name: "classify_ad_paragraphs" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return structured output for ad classification");
  }
  const raw = toolInputObject(toolUse.input, "classify_ad_paragraphs");
  return requireArray(raw.paragraphs, "paragraphs") as AdClassification[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    chunks.push(items.slice(index, index + size));
  return chunks;
}
