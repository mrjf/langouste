import type { ConversationMember, Message } from "./stores.svelte";

export interface ParallelSentence {
  id: string;
  messageId: string;
  messageOrdinal: number;
  sentenceOrdinal: number;
  isAgent: boolean;
  texts: Record<string, string>;
}

/**
 * Keep the learner's configured languages first, then include any other
 * language versions already attached to the conversation.
 */
export function parallelReaderLanguages(
  member: ConversationMember | undefined,
  messages: Message[],
): string[] {
  const configured = [
    ...(member?.target_languages.map((language) => language.lang) ?? []),
    ...(member?.base_languages ?? []),
  ];
  const available = messages.flatMap((message) => [
    message.language ?? "",
    ...Object.keys(message.translations ?? {}),
  ]);

  return [...new Set([...configured, ...available].filter(Boolean))];
}

/**
 * A conversation message is the stable alignment boundary. Within it, the
 * browser's locale-aware segmenter supplies matching sentence ordinals for
 * every language version.
 */
export function buildParallelSentences(
  messages: Message[],
  languages: string[],
): ParallelSentence[] {
  const rows: ParallelSentence[] = [];

  for (const [messageOrdinal, message] of messages.entries()) {
    if (message._pending || !message.healed_text?.trim()) continue;

    const segmented = Object.fromEntries(
      languages.map((language) => [
        language,
        segmentSentences(textForLanguage(message, language), language),
      ]),
    );
    const sentenceCount = Math.max(
      0,
      ...Object.values(segmented).map((sentences) => sentences.length),
    );

    for (let sentenceOrdinal = 0; sentenceOrdinal < sentenceCount; sentenceOrdinal += 1) {
      rows.push({
        id: `${message.message_id}:${sentenceOrdinal}`,
        messageId: message.message_id,
        messageOrdinal,
        sentenceOrdinal,
        isAgent: !!message.is_agent,
        texts: Object.fromEntries(
          languages.map((language) => [language, segmented[language]?.[sentenceOrdinal] ?? ""]),
        ),
      });
    }
  }

  return rows;
}

export function segmentSentences(text: string, language: string): string[] {
  const clean = text.trim();
  if (!clean) return [];

  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(language || undefined, { granularity: "sentence" });
    return [...segmenter.segment(clean)].map((segment) => segment.segment.trim()).filter(Boolean);
  }

  return clean
    .split(/(?<=[.!?\u3002\uff01\uff1f])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function textForLanguage(message: Message, language: string): string {
  if (message.language === language) {
    return message.healed_text || message.raw_text || "";
  }
  return message.translations?.[language] ?? "";
}
