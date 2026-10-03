import { afterEach, describe, expect, test } from "bun:test";
import { FiloDocument, type DictionaryLookupPayload } from "filo";
import type { Database, Filter, SelectOptions } from "../../src/lib/db/types.ts";
import {
  audioAssetId,
  findAudioAsset,
  storeAudioAsset,
} from "../../src/services/corpus/audio-assets.ts";
import {
  appendMessageAudioTier,
  buildBaseMessageFiloDocument,
  buildMessageFiloDocument,
} from "../../src/services/corpus/filo-docs.ts";
import { clearDictionaryLookupCache } from "../../src/services/references/dictionary.ts";
import type { Message } from "../../src/types/index.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearDictionaryLookupCache();
});

describe("message Filo documents", () => {
  test("stores message text as a byte-indexed document with word and translation tiers", () => {
    const doc = buildBaseMessageFiloDocument({
      messageId: "msg-1",
      conversationId: "conv-1",
      senderId: "user-1",
      text: "Számos README található.",
      language: "hu",
      translations: {
        hu: "Számos README található.",
        en: "Many READMEs can be found.",
      },
      createdAt: "2026-06-04T12:00:00.000Z",
    });

    expect(doc.id).toBe("message:msg-1");
    expect(doc.metadata).toEqual({
      corpus: "messages",
      messageId: "msg-1",
      conversationId: "conv-1",
      senderId: "user-1",
      language: "hu",
      isAgent: false,
      createdAt: "2026-06-04T12:00:00.000Z",
    });

    const document = FiloDocument.fromJSON(doc);
    const words = document.requireTier("word").annotations;
    expect(words.map((word) => word.payload.surface)).toEqual(["Számos", "README", "található"]);
    expect(words.map((word) => document.textOf(word))).toEqual(["Számos", "README", "található"]);

    const translation = document.requireTier("translation:en").annotations[0];
    expect(translation.start).toBe(0);
    expect(translation.end).toBe(doc.byteLength);
    expect(translation.payload).toEqual({
      language: "en",
      sourceLanguage: "hu",
      source: "messages.translations",
      text: "Many READMEs can be found.",
    });
    expect(document.tier("translation:hu")).toBeNull();
  });

  test("adds IPA phonetic tiers for message source text and translations", async () => {
    const doc = await buildMessageFiloDocument({
      messageId: "msg-ipa",
      conversationId: "conv-1",
      senderId: "user-1",
      text: "Számos található.",
      language: "hu",
      translations: {
        hu: "Számos található.",
        en: "Many can be found.",
      },
      createdAt: "2026-06-04T12:00:00.000Z",
    });

    const document = FiloDocument.fromJSON(doc);
    const huIpa = document.requireTier("ipa:hu").annotations[0];
    expect(huIpa).toMatchObject({
      start: 0,
      end: doc.byteLength,
      kind: "phonetic",
      payload: {
        system: "ipa",
        language: "hu",
        sourceText: "Számos található.",
        provider: "rule-ipa",
      },
    });
    expect(huIpa.payload.text).toContain("saːmoʃ");

    const enIpa = document.requireTier("ipa:en").annotations[0];
    expect(enIpa.payload).toMatchObject({
      system: "ipa",
      language: "en",
      sourceLanguage: "hu",
      sourceText: "Many can be found.",
      provider: "phonemize",
    });
    expect(enIpa.payload.text).toMatch(/^\/.*\/$/u);
  });

  test("adds dictionary tiers from normalized lemmas instead of raw surface forms", async () => {
    mockWiktionary({
      Szétszórva: null,
      szétszórva: null,
      szétszór: null,
      szór: page("szór", "Hungarian", "Verb", ["to sprinkle, scatter"]),
      ebben: null,
    });

    const doc = await buildMessageFiloDocument({
      messageId: "msg-2",
      conversationId: "conv-1",
      senderId: "user-1",
      text: "Szétszórva ebben",
      language: "hu",
    });

    const dictionaryTier = doc.tiers.find((tier) => tier.id === "dictionary");
    expect(dictionaryTier?.kind).toBe("dictionary.lookup");

    const entries = new Map(
      (dictionaryTier?.annotations ?? []).map((annotation) => [
        (annotation.payload as DictionaryLookupPayload).surface,
        annotation.payload as DictionaryLookupPayload,
      ]),
    );
    expect(entries.get("Szétszórva")).toMatchObject({
      lemma: "szétszór",
      sourceTerm: "szór",
      sourceUrl: "https://en.wiktionary.org/wiki/sz%C3%B3r#Hungarian",
      targetSourceUrl: "https://hu.wiktionary.org/wiki/sz%C3%B3r",
      formDescription: "adverbial participle of szétszór",
      definitions: ["to sprinkle, scatter"],
      senses: [
        {
          part_of_speech: "Verb",
          definition: "to sprinkle, scatter",
          examples: [],
        },
      ],
      notFound: false,
    });
    expect(entries.get("ebben")).toMatchObject({
      lemma: "ez",
      sourceTerm: "ez",
      formDescription: "inessive singular of ez",
      definitions: ["in this"],
      notFound: false,
    });
  });

  test("stores generated audio bytes in assets and references the audio id in Filo", async () => {
    const message = makeMessage({
      message_id: "msg-3",
      raw_text: "Bonjour",
      healed_text: "Bonjour",
      language: "fr",
      translations: { fr: "Bonjour", en: "Hello" },
    });
    const db = new MemoryDatabase([message]);
    const asset = await storeAudioAsset(db, {
      provider: "test-audio",
      language: "fr",
      text: "Bonjour",
      audio: new Uint8Array([1, 2, 3, 4]),
      contentType: "audio/mpeg",
    });

    expect(asset.audioId).toBe(
      audioAssetId({ provider: "test-audio", language: "fr", text: "Bonjour" }),
    );
    expect((await findAudioAsset(db, asset.audioId))?.audio).toEqual(new Uint8Array([1, 2, 3, 4]));

    const firstDoc = await appendMessageAudioTier(db, message, {
      language: "fr",
      audioId: asset.audioId,
      mimeType: "audio/mpeg",
      byteLength: asset.byteLength,
      source: "test-audio",
      textHash: asset.textHash,
      contentHash: asset.contentHash,
    });
    const secondDoc = await appendMessageAudioTier(db, message, {
      language: "fr",
      audioId: asset.audioId,
      mimeType: "audio/mpeg",
      byteLength: asset.byteLength,
      source: "test-audio",
      textHash: asset.textHash,
      contentHash: asset.contentHash,
    });

    expect(db.rows.messages[0].filo_doc).toEqual(secondDoc);
    expect(firstDoc.byteLength).toBe(Buffer.byteLength("Bonjour", "utf8"));

    const document = FiloDocument.fromJSON(secondDoc);
    const audioAnnotations = document.requireTier("audio:fr").annotations;
    expect(audioAnnotations).toHaveLength(1);
    expect(audioAnnotations[0]).toMatchObject({
      start: 0,
      end: secondDoc.byteLength,
      payload: {
        url: `audio:${asset.audioId}`,
        audioId: asset.audioId,
        mimeType: "audio/mpeg",
        source: "test-audio",
        language: "fr",
        byteLength: 4,
        textHash: asset.textHash,
        contentHash: asset.contentHash,
      },
    });
    expect(typeof audioAnnotations[0].payload.generatedAt).toBe("string");
  });
});

class MemoryDatabase implements Database {
  rows: Record<string, Record<string, unknown>[]>;

  constructor(messages: Message[]) {
    this.rows = {
      messages: messages.map((message) => ({ ...message })),
      audio_assets: [],
    };
  }

  async select<T>(table: string, options: SelectOptions = {}): Promise<T[]> {
    let rows = [...(this.rows[table] ?? [])];
    rows = rows.filter((row) => matches(row, options.filters ?? []));
    if (options.limit != null) rows = rows.slice(0, options.limit);
    return rows as T[];
  }

  async selectOne<T>(table: string, options: SelectOptions = {}): Promise<T | null> {
    return (await this.select<T>(table, { ...options, limit: 1 }))[0] ?? null;
  }

  async insert<T>(table: string, row: Record<string, unknown>): Promise<T> {
    const stored = { ...row };
    this.rows[table] = [...(this.rows[table] ?? []), stored];
    return stored as T;
  }

  async upsert<T>(
    table: string,
    row: Record<string, unknown>,
    conflictColumns: string[],
  ): Promise<T> {
    const existing = (this.rows[table] ?? []).find((candidate) =>
      conflictColumns.every((column) => candidate[column] === row[column]),
    );
    if (existing) {
      Object.assign(existing, row);
      return existing as T;
    }
    return this.insert<T>(table, row);
  }

  async update(table: string, patch: Record<string, unknown>, filters: Filter[]): Promise<void> {
    for (const row of this.rows[table] ?? []) {
      if (matches(row, filters)) Object.assign(row, patch);
    }
  }

  async updateOne<T>(table: string, patch: Record<string, unknown>, filters: Filter[]): Promise<T> {
    const row = (this.rows[table] ?? []).find((candidate) => matches(candidate, filters));
    if (!row) throw new Error("not found");
    Object.assign(row, patch);
    return row as T;
  }

  async delete(table: string, filters: Filter[]): Promise<void> {
    this.rows[table] = (this.rows[table] ?? []).filter((row) => !matches(row, filters));
  }

  async rpc<T>(): Promise<T> {
    throw new Error("rpc not implemented");
  }

  async raw<T>(): Promise<T[]> {
    throw new Error("raw not implemented");
  }
}

function makeMessage(overrides: Partial<Message>): Message {
  return {
    message_id: "msg-1",
    conversation_id: "conv-1",
    sender_id: "user-1",
    raw_text: "",
    healed_text: "",
    language: null,
    translation: null,
    translations: {},
    transliterations: {},
    phonetics: {},
    filo_doc: null,
    corrections: [],
    next_challenge: null,
    is_agent: false,
    created_at: "2026-06-04T12:00:00.000Z",
    ...overrides,
  };
}

function mockWiktionary(pages: Record<string, string | null>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const title = url.searchParams.get("page") ?? "";
    const html = pages[title];
    if (!html) {
      return Response.json({ error: { code: "missingtitle" } });
    }
    return Response.json({ parse: { title, text: { "*": html } } });
  }) as typeof fetch;
}

function page(
  title: string,
  language: string,
  partOfSpeech: string,
  definitions: string[],
): string {
  const list = definitions.map((definition) => `<li>${definition}</li>`).join("");
  return `
    <div class="mw-heading mw-heading2"><h2 id="${language}">${language}</h2></div>
    <div class="mw-heading mw-heading3"><h3 id="${partOfSpeech}">${partOfSpeech}</h3></div>
    <ol>${list}</ol>
    <div class="mw-heading mw-heading2"><h2 id="Other">Other</h2></div>
    <p>${title}</p>
  `;
}

function matches(row: Record<string, unknown>, filters: Filter[]): boolean {
  return filters.every((filter) => {
    switch (filter.op) {
      case "eq":
        return row[filter.column] === filter.value;
      case "lt":
      case "lte":
        return false;
      case "in":
        return filter.values.includes(row[filter.column] as string | number | boolean | null);
      default:
        return false;
    }
  });
}
