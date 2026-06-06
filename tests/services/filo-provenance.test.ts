import { describe, expect, test } from "bun:test";
import { FiloDocument } from "../../filo/src/document";
import {
  filoTextDocument,
  sourceSummariesForDocument,
  UI_COPY_SOURCE,
} from "../../src/client/lib/filo-provenance";

describe("Filo provenance", () => {
  test("serializes a source on tiers and annotations even when callers omit one", () => {
    const document = FiloDocument.fromText("Hello.");
    document.defineTier({
      id: "sentence",
      kind: "sentence",
      description: "Sentence spans",
    });
    document.addAnnotation("sentence", {
      start: 0,
      end: document.byteLength,
      payload: { text: "Hello.", ordinal: 0 },
    });

    const json = document.toJSON();
    expect(json.tiers[0].source).toBe("unknown");
    expect(json.tiers[0].annotations[0].source).toBe("unknown");
  });

  test("builds visible UI copy as a Filo document with human-authored source metadata", () => {
    const document = filoTextDocument("Workbench", { role: "sidebar-label" });

    expect(document.text).toBe("Workbench");
    expect(document.tiers[0].source).toBe(UI_COPY_SOURCE.id);
    expect(document.tiers[0].sourceInfo?.kind).toBe("human");
    expect(document.tiers[0].annotations[0].payload.text).toBe("Workbench");
    expect(document.metadata.sources).toEqual([UI_COPY_SOURCE]);
  });

  test("summarizes tier, annotation, and payload providers as inspectable sources", () => {
    const document = filoTextDocument("IPA", {
      role: "toggle-label",
      source: {
        id: "langouste.lit",
        kind: "transliterator",
        label: "Langouste lit",
        provider: "rule-ipa",
      },
    });
    document.tiers[0].annotations[0].payload.provider = "rule-ipa";

    const summaries = sourceSummariesForDocument(document);
    expect(summaries.map((source) => source.id)).toContain("langouste.lit");
    expect(summaries.map((source) => source.id)).toContain("rule-ipa");
  });
});
