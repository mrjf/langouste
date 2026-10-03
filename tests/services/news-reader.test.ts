import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FiloDocument } from "filo";
import { ensureLocalSession } from "../../src/lib/auth/local.ts";
import { createNewsRoutes } from "../../src/routes/api/news.ts";
import {
  articleFromRss,
  isPrivateAddress,
  parseArticleHtml,
  parseHomepageListing,
  parseItem,
  parseRssListing,
  parseStoryIds,
} from "../../src/services/news/sources/index.ts";
import {
  parseGeneratedLayer,
  renderTokens,
  StubLayerGenerator,
} from "../../src/services/ai/news-layers.ts";
import { createReadingDocument } from "../../src/services/news/reading.ts";
import { JsonFileCache } from "../../src/services/news/cache.ts";
import { rowsFromDocument } from "../../src/client/lib/news-reading.ts";
import type { NewsSourceId, ScrapedArticle, SourceAdapter } from "../../src/types/news.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

const layerInput = {
  title: "Test",
  sourceUrl: "https://example.com/story",
  sourceLanguage: "en" as const,
  language: "hu",
  languageName: "Hungarian",
  level: "B1" as const,
  sentences: [
    {
      ordinal: 0,
      text: "The board approved it.",
      sourceWords: [
        { ordinal: 0, text: "The" },
        { ordinal: 1, text: "board" },
        { ordinal: 2, text: "approved" },
        { ordinal: 3, text: "it" },
      ],
    },
  ],
};

describe("integrated news extraction", () => {
  test("prefers NewsArticle JSON-LD and preserves article paragraphs", () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@type": "NewsArticle",
        headline: "A Bay Area transit plan changes",
        author: [{ name: "Ada Reporter" }],
        datePublished: "2026-08-05T12:00:00Z",
        articleSection: "Bay Area",
        description: "A concise summary of the transit plan.",
        articleBody:
          "The board approved a new transit plan after a long meeting.\n\nRiders will see the first changes next spring.",
      })}</script>
    </head><body><article><p>Navigation should not win.</p></article></body></html>`;
    const article = parseArticleHtml(
      html,
      "https://www.sfchronicle.com/bayarea/article/test-1.php",
    );
    expect(article.title).toBe("A Bay Area transit plan changes");
    expect(article.byline).toBe("Ada Reporter");
    expect(article.section).toBe("Bay Area");
    expect(article.paragraphs).toEqual([
      "The board approved a new transit plan after a long meeting.",
      "Riders will see the first changes next spring.",
    ]);
  });

  test("extracts publisher listings and RSS fallbacks", () => {
    const homepage = `<main>
      <a href="/sf/article/transit-123.php"><h2>Transit plan would reshape a major San Francisco street</h2><p>The proposal returns for a vote.</p></a>
      <a href="/weather/article/heat-456.php"><h3>Dangerous heat is headed toward inland California</h3></a>
    </main>`;
    expect(
      parseHomepageListing(homepage, "https://www.sfchronicle.com", "sfchronicle", 10),
    ).toHaveLength(2);

    const rss = `<rss><channel><item>
      <title><![CDATA[A New Policy Takes Shape]]></title>
      <link>https://www.nytimes.com/2026/08/05/us/policy.html</link>
      <description><![CDATA[<p>Officials described the next steps.</p>]]></description>
      <pubDate>Wed, 05 Aug 2026 12:00:00 GMT</pubDate>
    </item></channel></rss>`;
    expect(parseRssListing(rss, "nytimes")[0]?.title).toBe("A New Policy Takes Shape");
    expect(
      articleFromRss(rss, "https://www.nytimes.com/2026/08/05/us/policy.html?smid=rss", "nytimes"),
    ).toMatchObject({
      extraction: "feed-summary",
      paragraphs: ["Officials described the next steps."],
    });
  });

  test("validates Hacker News responses and blocks private addresses", () => {
    expect(parseStoryIds([1, "2", -1, 3])).toEqual([1, 3]);
    expect(parseItem({ id: 42, type: "story", title: "A story", score: 12 })).toEqual({
      id: 42,
      type: "story",
      title: "A story",
      score: 12,
    });
    for (const address of ["127.0.0.1", "10.2.3.4", "169.254.1.2", "100.64.1.2", "::1"]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });
});

describe("integrated news Filo layers", () => {
  test("normalizes generated tokens and keeps source-word mappings", () => {
    const layer = parseGeneratedLayer(
      JSON.stringify({
        language: "hu",
        sentences: [
          {
            ordinal: 0,
            tokens: [
              { text: "A testület", leading: "", sourceWordOrdinals: [0, 1] },
              { text: "jóváhagyta", leading: " ", sourceWordOrdinals: [2] },
              { text: ".", leading: "", sourceWordOrdinals: [] },
            ],
            explanation: "Hungarian marks the object on the verb.",
            grammar: [
              {
                label: "Definite conjugation",
                explanation: "The verb agrees with a definite object.",
              },
            ],
            vocabulary: [{ term: "jóváhagy", meaning: "approve", partOfSpeech: "verb" }],
          },
        ],
      }),
      layerInput,
    );
    expect(layer.sentences[0]?.tokens.map((token) => token.text)).toEqual([
      "A",
      "testület",
      "jóváhagyta",
      ".",
    ]);
    expect(renderTokens(layer.sentences[0]?.tokens ?? [])).toBe("A testület jóváhagyta.");
    expect(layer.sentences[0]?.tokens[2]?.sourceWordOrdinals).toEqual([2]);
  });

  test("builds a valid, rebranded multi-language reading document", async () => {
    const article: ScrapedArticle = {
      id: "sfchronicle:test",
      source: "sfchronicle",
      title: "Transit board approves a new plan",
      url: "https://www.sfchronicle.com/test/article-1.php",
      sourceLanguage: "en",
      paragraphs: [
        "The transit board approved a new plan on Tuesday. Riders will see changes next spring.",
      ],
    };
    const json = await createReadingDocument(
      article,
      { source: "sfchronicle", input: article.url, languages: ["hu", "ar"], level: "B1" },
      { generator: new StubLayerGenerator(), maxSentences: 5 },
    );
    expect(() => FiloDocument.fromJSON(json)).not.toThrow();
    expect(json.metadata.corpus).toBe("langouste-news");
    expect(json.metadata.readingInput).toBe(article.url);
    expect(JSON.stringify(json)).not.toContain("RGT");
    for (const language of json.metadata.languages) {
      expect(
        json.tiers.find((tier) => tier.id === `sentence.translation:${language}`)?.annotations
          .length,
      ).toBeGreaterThan(0);
    }
    expect(rowsFromDocument(json)[0]?.sourceWords).toEqual([
      "Transit",
      "board",
      "approves",
      "a",
      "new",
      "plan",
    ]);
  });
});

describe("authenticated News API", () => {
  test("builds a background edition and exposes it through the learner library", async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), "langouste-news-test-"));
    temporaryDirectories.push(cacheDirectory);
    const adapter = (source: NewsSourceId): SourceAdapter => ({
      id: source,
      async list() {
        return [];
      },
      async scrape() {
        return {
          id: `${source}:integrated-story`,
          source,
          title: "An integrated edition",
          url: "https://example.com/integrated-story",
          sourceLanguage: "en",
          paragraphs: ["The reader stores this sentence in the shared learner corpus."],
        };
      },
    });
    const adapters = Object.fromEntries(
      (["hacker-news", "nytimes", "sfchronicle"] satisfies NewsSourceId[]).map((source) => [
        source,
        adapter(source),
      ]),
    ) as Record<NewsSourceId, SourceAdapter>;
    const routes = createNewsRoutes({
      adapters,
      cache: new JsonFileCache(cacheDirectory),
      generator: new StubLayerGenerator(),
      maxSentences: 5,
    });

    expect((await routes.request("/ready-readings")).status).toBe(401);
    const session = await ensureLocalSession();
    const headers = {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    };
    const startedResponse = await routes.request("/reading-jobs", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "hacker-news",
        input: "12345",
        languages: ["hu", "ar"],
        level: "B1",
      }),
    });
    expect(startedResponse.status).toBe(202);
    const started = (await startedResponse.json()) as { id: string };

    let completed: { status: string; response?: { persistence: { documentId: string } } } | null =
      null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = await routes.request(`/reading-jobs/${started.id}`, { headers });
      completed = await status.json();
      if (completed?.status === "ready") break;
      await Bun.sleep(5);
    }
    expect(completed?.status).toBe("ready");
    expect(completed?.response?.persistence.documentId).toMatch(/^reading_[a-f0-9]{64}$/u);

    const libraryResponse = await routes.request("/ready-readings", { headers });
    expect(libraryResponse.status).toBe(200);
    const library = (await libraryResponse.json()) as {
      items: Array<{ key: string; articleId: string; title: string }>;
    };
    expect(library.items).toHaveLength(1);
    expect(library.items[0]).toMatchObject({
      articleId: "hacker-news:integrated-story",
      title: "An integrated edition",
    });

    const ready = await routes.request(`/ready-readings/${library.items[0]?.key}`, { headers });
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      document: { metadata: { corpus: "langouste-news" } },
      cacheHit: true,
    });
  });
});
