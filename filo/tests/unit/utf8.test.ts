import { describe, expect, test } from "bun:test";
import { FiloDocument } from "../../src";

describe("UTF-8 byte indexing", () => {
  test("indexes ASCII, accented text, and emoji by byte offset", () => {
    const document = FiloDocument.fromText("aé😊b");

    expect(document.byteLength).toBe(8);
    expect(document.byteOffsetForStringIndex(0)).toBe(0);
    expect(document.byteOffsetForStringIndex(1)).toBe(1);
    expect(document.byteOffsetForStringIndex(2)).toBe(3);
    expect(document.byteOffsetForStringIndex(4)).toBe(7);
    expect(document.byteOffsetForStringIndex(5)).toBe(8);

    expect(document.textOf({ start: 1, end: 3 })).toBe("é");
    expect(document.textOf({ start: 3, end: 7 })).toBe("😊");
  });

  test("rejects ranges that split a UTF-8 scalar", () => {
    const document = FiloDocument.fromText("aé😊b");

    expect(() => document.textOf({ start: 2, end: 3 })).toThrow(
      "align to UTF-8 boundaries",
    );
    expect(() => document.byteOffsetForStringIndex(3)).toThrow(
      "not a UTF-8 scalar boundary",
    );
  });

  test("allows zero-width annotations at valid byte boundaries", () => {
    const document = FiloDocument.fromText("hello");
    document.defineTier({ id: "cursor", kind: "custom" });

    const cursor = document.addAnnotation("cursor", {
      start: 3,
      end: 3,
      payload: { label: "caret" },
    });

    expect(document.textOf(cursor)).toBe("");
    expect(document.annotationsAt(3)).toEqual([cursor]);
  });
});
