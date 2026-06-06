import { FiloDocument } from "../document";
import { annotateDictionaryLookups } from "../annotators/dictionary";
import { annotatePhraseBoundaries } from "../annotators/phrases";
import { annotateWords } from "../annotators/tokenizer";
import type { DictionaryLookupResult } from "../annotators/dictionary";
import type { FiloDocumentJson } from "../types";

export interface ScrapedArticle {
  title: string;
  byline?: string;
  publishedAt?: string;
  url?: string;
  source: "nytimes" | "html";
  paragraphs: string[];
}

export interface ArticleAnnotationOptions {
  language?: string;
  dictionary?: Record<string, DictionaryLookupResult>;
}

export async function scrapeNyTimesArticle(url: string): Promise<ScrapedArticle> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "FiloArticleScraper/0.1 (+https://github.com/mrjf/langouste)",
    },
  });
  if (!response.ok) {
    throw new Error(`Could not fetch article: HTTP ${response.status}`);
  }
  return parseNyTimesArticleHtml(await response.text(), { url });
}

export function parseNyTimesArticleHtml(
  html: string,
  options: { url?: string } = {},
): ScrapedArticle {
  const newsArticle = parseNewsArticleJsonLd(html);
  const title =
    firstString(newsArticle?.headline) ??
    textFromFirstMatch(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/iu) ??
    textFromFirstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/iu) ??
    "Untitled article";
  const paragraphs =
    paragraphStrings(newsArticle?.articleBody).length > 0
      ? paragraphStrings(newsArticle?.articleBody)
      : extractArticleParagraphs(html);
  const publishedAt = firstString(newsArticle?.datePublished);
  const byline = bylineFrom(newsArticle);

  const article: ScrapedArticle = {
    title,
    paragraphs,
    source: looksLikeNyTimes(options.url, html) ? "nytimes" : "html",
  };
  if (options.url !== undefined) article.url = options.url;
  if (publishedAt !== undefined) article.publishedAt = publishedAt;
  if (byline !== undefined) article.byline = byline;
  return article;
}

export async function scrapeNyTimesArticleDocument(
  url: string,
  options: ArticleAnnotationOptions = {},
): Promise<FiloDocumentJson> {
  return articleToFiloDocumentJson(await scrapeNyTimesArticle(url), options);
}

export async function articleToFiloDocumentJson(
  article: ScrapedArticle,
  options: ArticleAnnotationOptions = {},
): Promise<FiloDocumentJson> {
  const language = options.language ?? "en";
  const text = [article.title, "", ...article.paragraphs].join("\n");
  const document = FiloDocument.fromText(text, {
    id: article.url ?? slugFor(article.title),
    metadata: {
      title: article.title,
      language,
      source: article.source,
      url: article.url,
      byline: article.byline,
      publishedAt: article.publishedAt,
    },
  });

  annotateWords(document, { language });
  annotatePhraseBoundaries(document, { language });
  await annotateDictionaryLookups(document, {
    language,
    includeMisses: true,
    lookup: async ({ normalized }) => options.dictionary?.[normalized] ?? null,
    source: "filo.nytimes",
  });

  document.ensureTier({ id: "article:section", kind: "custom", description: "Article sections" });
  document.addAnnotation("article:section", {
    start: 0,
    end: document.byteRangeForStringIndices(0, article.title.length).end,
    payload: {
      label: "headline",
      links: article.url ? [{ label: "source", url: article.url }] : [],
    },
  });

  return document.toJSON();
}

function parseNewsArticleJsonLd(html: string): Record<string, unknown> | null {
  const scriptPattern =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu;
  for (const match of html.matchAll(scriptPattern)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1] ?? ""));
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates.flatMap(expandGraph)) {
        if (isNewsArticle(candidate)) return candidate;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function expandGraph(value: unknown): unknown[] {
  if (!isRecord(value)) return [];
  const graph = value["@graph"];
  if (Array.isArray(graph)) return graph;
  return [value];
}

function isNewsArticle(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const type = value["@type"];
  if (Array.isArray(type)) return type.some((item) => String(item).includes("NewsArticle"));
  return String(type).includes("NewsArticle") || String(type).includes("Article");
}

function paragraphStrings(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function extractArticleParagraphs(html: string): string[] {
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/iu);
  const source = articleMatch?.[1] ?? html;
  const paragraphs: string[] = [];
  for (const match of source.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/giu)) {
    const text = stripTags(match[1] ?? "").trim();
    if (text.length >= 24) paragraphs.push(text);
  }
  return paragraphs;
}

function bylineFrom(value: Record<string, unknown> | null): string | undefined {
  if (!value) return undefined;
  const author = value.author;
  if (typeof author === "string") return author;
  if (Array.isArray(author)) {
    return author
      .map((item) => (isRecord(item) ? firstString(item.name) : firstString(item)))
      .filter(Boolean)
      .join(", ");
  }
  if (isRecord(author)) return firstString(author.name);
  return undefined;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return decodeHtml(value).trim();
  if (Array.isArray(value)) return firstString(value[0]);
  return undefined;
}

function textFromFirstMatch(html: string, pattern: RegExp): string | undefined {
  const match = html.match(pattern);
  return match?.[1] ? decodeHtml(stripTags(match[1])).trim() : undefined;
}

function stripTags(html: string): string {
  return decodeHtml(html.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " "));
}

function decodeHtml(text: string): string {
  return text
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, "\"")
    .replace(/&#39;/gu, "'")
    .replace(/&apos;/gu, "'")
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function looksLikeNyTimes(url: string | undefined, html: string): boolean {
  return (url?.includes("nytimes.com") ?? false) || /nytimes\.com|The New York Times/iu.test(html);
}

function slugFor(title: string): string {
  return title
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

if (import.meta.main) {
  const url = Bun.argv[2];
  if (!url) {
    console.error("Usage: bun run src/newspaper/nytimes.ts <article-url>");
    process.exit(1);
  }
  scrapeNyTimesArticleDocument(url)
    .then((documentJson) => {
      console.log(JSON.stringify(documentJson, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
