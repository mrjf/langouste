import { afterEach, describe, expect, test } from "bun:test";
import type { FiloDocumentJson } from "../../src/client/lib/stores.svelte.ts";
import {
  clearSavedWorkbenchState,
  loadSavedWorkbenchState,
  saveWorkbenchState,
  SAVED_WORKBENCH_STORAGE_KEY,
} from "../../src/client/lib/workbench.ts";

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

afterEach(() => {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  } else {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

describe("workbench local cache", () => {
  test("round-trips an analyzed document with sentence tiers", () => {
    const storage = installLocalStorage();
    const document = filoDocument("Hi. Bye.");

    saveWorkbenchState({
      title: "Cached workbench",
      text: document.text,
      sourceLanguage: "en",
      targetLanguage: "es",
      result: {
        document,
        summary: {
          words: 2,
          sentences: 2,
          phrases: 1,
          targetLanguage: "es",
        },
      },
    });

    expect(storage.getItem(SAVED_WORKBENCH_STORAGE_KEY)).toContain('"sentence"');

    const loaded = loadSavedWorkbenchState();
    expect(loaded?.title).toBe("Cached workbench");
    expect(loaded?.result?.summary.sentences).toBe(2);
    expect(
      loaded?.result?.document.tiers.find((tier) => tier.id === "sentence")?.annotations,
    ).toHaveLength(2);
  });

  test("clears the saved workbench document", () => {
    installLocalStorage();
    const document = filoDocument("Hi.");

    saveWorkbenchState({
      text: document.text,
      sourceLanguage: "en",
      targetLanguage: "es",
      result: {
        document,
        summary: {
          words: 1,
          sentences: 1,
          phrases: 1,
          targetLanguage: "es",
        },
      },
    });

    clearSavedWorkbenchState();

    expect(loadSavedWorkbenchState()).toBeNull();
  });
});

function installLocalStorage(): Storage {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  return storage;
}

function filoDocument(text: string): FiloDocumentJson {
  const byteLength = new TextEncoder().encode(text).length;
  return {
    id: "workbench:test",
    text,
    byteLength,
    metadata: {
      corpus: "workbench",
      title: "Cached workbench",
    },
    tiers: [
      {
        id: "sentence",
        kind: "sentence",
        source: "test",
        annotations:
          text === "Hi. Bye."
            ? [
                annotation("sentence:1", "sentence", 0, 3),
                annotation("sentence:2", "sentence", 4, 8),
              ]
            : [annotation("sentence:1", "sentence", 0, byteLength)],
      },
      {
        id: "word",
        kind: "word",
        source: "test",
        annotations:
          text === "Hi. Bye."
            ? [annotation("word:1", "word", 0, 2), annotation("word:2", "word", 4, 7)]
            : [annotation("word:1", "word", 0, 2)],
      },
      {
        id: "phrase",
        kind: "phrase",
        source: "test",
        annotations: [annotation("phrase:1", "phrase", 0, byteLength)],
      },
    ],
  };
}

function annotation(id: string, tierId: string, start: number, end: number) {
  return {
    id,
    tierId,
    kind: tierId,
    start,
    end,
    source: "test",
    payload: {},
  };
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
