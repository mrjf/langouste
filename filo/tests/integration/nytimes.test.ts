import { describe, expect, test } from "bun:test";
import { articleToFiloDocumentJson, parseNyTimesArticleHtml } from "../../src";

const fixtureHtml = String.raw`
<!doctype html>
<html>
  <head>
    <title>Layered Reading Tools - The New York Times</title>
    <script type="application/ld+json">
      {
        "@type": "NewsArticle",
        "headline": "Layered Reading Tools Bring Annotations to Text",
        "datePublished": "2026-06-04T12:00:00Z",
        "author": [{"name": "Filo Test Desk"}],
        "articleBody": "A small language system maps words, phrases and translations onto one base document.\n\nThe visual editor shows overlapping phrase tiers near dictionary links."
      }
    </script>
  </head>
  <body></body>
</html>`;

describe("NYTimes article ingestion", () => {
  test("parses JSON-LD news article data", () => {
    const article = parseNyTimesArticleHtml(fixtureHtml, {
      url: "https://www.nytimes.com/2026/06/04/technology/layered-reading-tools.html",
    });

    expect(article).toEqual({
      title: "Layered Reading Tools Bring Annotations to Text",
      byline: "Filo Test Desk",
      publishedAt: "2026-06-04T12:00:00Z",
      url: "https://www.nytimes.com/2026/06/04/technology/layered-reading-tools.html",
      source: "nytimes",
      paragraphs: [
        "A small language system maps words, phrases and translations onto one base document.",
        "The visual editor shows overlapping phrase tiers near dictionary links.",
      ],
    });
  });

  test("turns an article into a fully annotated Filo document", async () => {
    const article = parseNyTimesArticleHtml(fixtureHtml);
    const json = await articleToFiloDocumentJson(article, {
      dictionary: {
        annotations: {
          lemma: "annotation",
          definitions: ["metadata attached to a text span"],
          partOfSpeech: "noun",
          source: "fixture",
        },
      },
    });

    expect(json.text).toContain("Layered Reading Tools");
    expect(json.tiers.map((tier) => tier.id)).toEqual([
      "word",
      "phrase",
      "dictionary",
      "article:section",
    ]);
    expect(
      json.tiers
        .find((tier) => tier.id === "dictionary")
        ?.annotations.some((annotation) => annotation.payload.notFound === false),
    ).toBe(true);
  });
});
