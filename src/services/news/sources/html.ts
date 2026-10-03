import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export interface ParsedArticleHtml {
  title: string;
  paragraphs: string[];
  byline?: string;
  publishedAt?: string;
  section?: string;
  description?: string;
}

const BOILERPLATE =
  /^(advertisement|article continues below(?: this ad)?|most popular|read more|sign up|subscribe)$/iu;

export function parseArticleHtml(html: string, url: string): ParsedArticleHtml {
  const jsonLd = findArticleJsonLd(html);
  const readable = parseWithReadability(html, url);
  const title =
    firstText(jsonLd?.headline) ||
    readable.title ||
    metaContent(html, "og:title") ||
    titleTag(html) ||
    "Untitled article";
  const description =
    firstText(jsonLd?.description) ||
    readable.excerpt ||
    metaContent(html, "description") ||
    undefined;
  const jsonBody = paragraphsFrom(firstText(jsonLd?.articleBody));
  const readableBody = paragraphsFrom(readable.textContent);
  const fallbackBody = extractParagraphTags(html);
  const paragraphs = cleanParagraphs(
    jsonBody.length >= 2 ? jsonBody : readableBody.length >= 2 ? readableBody : fallbackBody,
  );
  return compact({
    title: decodeHtml(title).trim(),
    paragraphs,
    byline: bylineFrom(jsonLd) || readable.byline || undefined,
    publishedAt: firstText(jsonLd?.datePublished) || undefined,
    section: firstText(jsonLd?.articleSection) || undefined,
    description,
  });
}

function parseWithReadability(html: string, url: string) {
  try {
    const { document } = parseHTML(html);
    Object.defineProperty(document, "documentURI", { value: url, configurable: true });
    const result = new Readability(document as unknown as Document).parse();
    return {
      title: result?.title?.trim() ?? "",
      byline: result?.byline?.trim() ?? null,
      excerpt: result?.excerpt?.trim() ?? null,
      textContent: result?.textContent?.trim() ?? "",
    };
  } catch {
    return { title: "", byline: null, excerpt: null, textContent: "" };
  }
}

function findArticleJsonLd(html: string): Record<string, unknown> | null {
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu;
  for (const match of html.matchAll(pattern)) {
    try {
      const value = JSON.parse(decodeHtml(match[1] ?? ""));
      for (const candidate of expandJsonLd(value)) {
        if (isArticle(candidate)) return candidate;
      }
    } catch {}
  }
  return null;
}

function expandJsonLd(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(expandJsonLd);
  if (!isRecord(value)) return [];
  return Array.isArray(value["@graph"]) ? value["@graph"].flatMap(expandJsonLd) : [value];
}

function isArticle(value: Record<string, unknown>): boolean {
  const type = value["@type"];
  const values = Array.isArray(type) ? type.map(String) : [String(type ?? "")];
  return values.some((candidate) => /(?:News)?Article|ReportageNewsArticle/iu.test(candidate));
}

function bylineFrom(article: Record<string, unknown> | null): string | undefined {
  if (!article) return undefined;
  const author = article.author;
  if (typeof author === "string") return author.trim() || undefined;
  const authors = Array.isArray(author) ? author : author ? [author] : [];
  const names = authors
    .map((candidate) => (isRecord(candidate) ? firstText(candidate.name) : firstText(candidate)))
    .filter(Boolean);
  return names.length ? names.join(", ") : undefined;
}

function paragraphsFrom(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(/\n{2,}|\r?\n/gu)
    .map((part) => part.replace(/\s+/gu, " ").trim())
    .filter((part) => part.length >= 24);
}

function extractParagraphTags(html: string): string[] {
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/iu)?.[1] ?? html;
  return [...article.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu)]
    .map((match) =>
      decodeHtml(stripTags(match[1] ?? ""))
        .replace(/\s+/gu, " ")
        .trim(),
    )
    .filter((text) => text.length >= 24);
}

function cleanParagraphs(paragraphs: string[]): string[] {
  const seen = new Set<string>();
  return paragraphs.flatMap((raw) => {
    const paragraph = decodeHtml(raw).replace(/\s+/gu, " ").trim();
    const key = paragraph.toLocaleLowerCase("en");
    if (paragraph.length < 24 || BOILERPLATE.test(paragraph) || seen.has(key)) return [];
    seen.add(key);
    return [paragraph];
  });
}

function metaContent(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "iu"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "iu"),
  ];
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    if (value) return decodeHtml(value).trim();
  }
  return "";
}

function titleTag(html: string): string {
  return decodeHtml(stripTags(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1] ?? "")).trim();
}

export function plainTextFromHtml(html: string): string {
  return decodeHtml(
    html
      .replace(/<\s*br\s*\/?>/giu, "\n")
      .replace(/<\s*\/p\s*>/giu, "\n\n")
      .replace(/<[^>]+>/gu, " "),
  )
    .replace(/[ \t]+/gu, " ")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/gu, " ");
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&apos;|&#39;|&#x27;/giu, "'")
    .replace(/&#x2F;/giu, "/")
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function firstText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return firstText(value[0]);
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== ""),
  ) as T;
}
