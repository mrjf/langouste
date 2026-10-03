import { describe, expect, test } from "bun:test";
import {
  buildParallelSentences,
  parallelReaderLanguages,
  segmentSentences,
} from "../../src/client/lib/parallel-reader";
import type { ConversationMember, Message } from "../../src/client/lib/stores.svelte";

const member: ConversationMember = {
  user_id: "user-1",
  target_languages: [{ lang: "hu", cefr_level: "A2" }],
  base_languages: ["en"],
  joined_at: "2026-08-08T00:00:00.000Z",
};

function message(overrides: Partial<Message> = {}): Message {
  return {
    message_id: "message-1",
    conversation_id: "conversation-1",
    sender_id: "user-1",
    raw_text: "The train arrived. Everyone cheered!",
    healed_text: "The train arrived. Everyone cheered!",
    language: "en",
    translation: null,
    translations: {
      en: "The train arrived. Everyone cheered!",
      hu: "Megérkezett a vonat. Mindenki ujjongott!",
      fr: "Le train est arrivé. Tout le monde a applaudi !",
    },
    corrections: [],
    next_challenge: null,
    created_at: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("parallel reader alignment", () => {
  test("keeps configured languages first and includes existing translations", () => {
    expect(parallelReaderLanguages(member, [message()])).toEqual(["hu", "en", "fr"]);
  });

  test("aligns sentence ordinals across every language", () => {
    const rows = buildParallelSentences([message()], ["hu", "en", "fr"]);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.texts).toEqual({
      hu: "Megérkezett a vonat.",
      en: "The train arrived.",
      fr: "Le train est arrivé.",
    });
    expect(rows[1]?.texts.hu).toBe("Mindenki ujjongott!");
  });

  test("segments sentence punctuation used outside Latin text", () => {
    expect(segmentSentences("列車が到着した。みんなが喜んだ！", "ja")).toEqual([
      "列車が到着した。",
      "みんなが喜んだ！",
    ]);
  });
});
