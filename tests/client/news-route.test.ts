import { describe, expect, test } from "bun:test";
import {
  defaultNewsDeskState,
  newsHref,
  newsRoute,
  parseNewsRoute,
} from "../../src/client/lib/news-route.ts";

describe("News tab route state", () => {
  test("writes every desk setting under the Langouste News hash", () => {
    const state = defaultNewsDeskState();
    expect(newsHref(state)).toBe(`#/news/${newsRoute(state)}`);
    expect(newsHref(state)).toContain("#/news/desk?");
    expect(newsHref(state)).not.toContain("rgt");
  });

  test("round-trips article identity and reader state", () => {
    const state = {
      view: "read" as const,
      request: {
        source: "nytimes" as const,
        input: "https://www.nytimes.com/2026/08/07/world/a-story.html",
        languages: ["pt", "ar"],
        level: "B2" as const,
      },
      reader: {
        sentenceOrdinal: 4,
        language: "ar",
        showBase: true,
        wordOrdinal: 2,
      },
    };
    const route = newsRoute(state);
    expect(route).not.toContain("model");
    expect(route).not.toContain("cache");
    expect(parseNewsRoute(route)).toEqual(state);
  });
});
