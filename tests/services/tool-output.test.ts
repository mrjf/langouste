import { describe, expect, test } from "bun:test";
import { requireArray, requireString, toolInputObject } from "../../src/services/ai/tool-output.ts";

describe("tool-output guards", () => {
  test("toolInputObject accepts a plain object", () => {
    expect(toolInputObject({ a: 1 }, "t")).toEqual({ a: 1 });
  });

  test("toolInputObject rejects non-objects, null, and arrays", () => {
    expect(() => toolInputObject(null, "t")).toThrow(/expected an object/);
    expect(() => toolInputObject("x", "t")).toThrow(/expected an object/);
    expect(() => toolInputObject([], "t")).toThrow(/expected an object/);
  });

  test("requireArray returns arrays and rejects everything else", () => {
    expect(requireArray([1, 2], "field")).toEqual([1, 2]);
    expect(() => requireArray(undefined, "field")).toThrow(/"field" must be an array/);
    expect(() => requireArray({}, "field")).toThrow(/"field" must be an array/);
    expect(() => requireArray("nope", "field")).toThrow(/"field" must be an array/);
  });

  test("requireString returns strings and rejects everything else", () => {
    expect(requireString("hi", "field")).toBe("hi");
    expect(() => requireString(undefined, "field")).toThrow(/"field" must be a string/);
    expect(() => requireString(3, "field")).toThrow(/"field" must be a string/);
  });
});
