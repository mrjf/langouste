import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import { decodeHtml, parseArticleHtml, plainTextFromHtml } from "./html";
import { safeFetchText } from "./safe-fetch";
import type {
  NewsListingItem,
  NewsSourceId,
  ScrapedArticle,
  SourceAdapter,
} from "../../../types/news.ts";

interface PublisherOptions {
  id: "nytimes" | "sfchronicle";
  homepageUrl: string;
  allowedHosts: string[];
  rssUrl?: string;
}

export class PublisherAdapter implements SourceAdapter {
  readonly id: "nytimes" | "sfchronicle";

  constructor(private readonly options: PublisherOptions) {
    this.id = options.id;
  }

  async list(limit = 20): Promise<NewsListingItem[]> {
    if (this.options.rssUrl) {
      const response = await safeFetchText(this.options.rssUrl, {
        allowedHosts: [new URL(this.options.rssUrl).hostname],
      });
      return parseRssListing(response.text, this.id, limit);
    }
    const response = await safeFetchText(this.options.homepageUrl, {
      allowedHosts: this.options.allowedHosts,
    });
    return parseHomepageListing(response.text, response.finalUrl, this.id, limit);
  }

  async scrape(input: string): Promise<ScrapedArticle> {
    let response: Awaited<ReturnType<typeof safeFetchText>>;
    try {
      response = await safeFetchText(input, { allowedHosts: this.options.allowedHosts });
    } catch (error) {
      if (this.options.rssUrl) {
        const feed = await safeFetchText(this.options.rssUrl, {
          allowedHosts: [new URL(this.options.rssUrl).hostname],
        });
        const fallback = articleFromRss(feed.text, input, this.id);
        if (fallback) return fallback;
      }
      throw error;
    }
    const article = parseArticleHtml(response.text, response.finalUrl);
    const paragraphs = article.paragraphs.length
      ? article.paragraphs
      : article.description
        ? [article.description]
        : [];
    if (!paragraphs.length)
      throw new Error(`No readable article text was found at ${new URL(input).hostname}`);
    return compact({
      id: `${this.id}:${shortHash(response.finalUrl)}`,
      source: this.id,
      title: article.title,
      url: response.finalUrl,
      paragraphs,
      sourceLanguage: "en" as const,
      byline: article.byline,
      publishedAt: article.publishedAt,
      section: article.section,
      description: article.description,
      extraction: "article" as const,
    });
  }
}

export function articleFromRss(
  xml: string,
  input: string,
  source: NewsSourceId,
): ScrapedArticle | null {
  const targetUrl = normalizedUrl(input);
  const item = parseRssListing(xml, source, 40).find(
    (candidate) => normalizedUrl(candidate.articleUrl ?? candidate.url) === targetUrl,
  );
  if (!item?.summary) return null;
  return compact({
    id: `${source}:${shortHash(targetUrl)}`,
    source,
    title: item.title,
    url: item.articleUrl ?? item.url,
    paragraphs: [item.summary],
    sourceLanguage: "en" as const,
    publishedAt: item.publishedAt,
    description: item.summary,
    extraction: "feed-summary" as const,
  });
}

export function parseHomepageListing(
  html: string,
  baseUrl: string,
  source: NewsSourceId,
  limit = 20,
): NewsListingItem[] {
  const { document } = parseHTML(html);
  const results: NewsListingItem[] = [];
  const seen = new Set<string>();
  for (const anchor of document.querySelectorAll("a[href]")) {
    let url: URL;
    try {
      url = new URL(anchor.getAttribute("href") ?? "", baseUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    url.search = "";
    url.hash = "";
    const heading = anchor.querySelector("h1, h2, h3, h4");
    const attributedTitle = anchor.getAttribute("data-element-text");
    const directText = (anchor.textContent ?? "").replace(/\s+/gu, " ").trim();
    const title = (
      heading?.textContent ??
      attributedTitle ??
      (isLikelyArticleUrl(url) ? directText : "")
    )
      .replace(/\s+/gu, " ")
      .trim();
    if (title.length < 20) continue;
    if (seen.has(url.toString())) continue;
    seen.add(url.toString());
    const summary = directText.startsWith(title)
      ? directText.slice(title.length).trim()
      : directText;
    results.push(
      compact({
        id: shortHash(url.toString()),
        source,
        title,
        url: url.toString(),
        articleUrl: url.toString(),
        summary: summary.length >= 30 && summary !== title ? summary.slice(0, 280) : undefined,
      }),
    );
    if (results.length >= Math.min(40, Math.max(1, limit))) break;
  }
  return results;
}

function isLikelyArticleUrl(url: URL): boolean {
  return url.pathname.includes("/article/") || /-\d+\.php$/u.test(url.pathname);
}

export function parseRssListing(xml: string, source: NewsSourceId, limit = 20): NewsListingItem[] {
  const items: NewsListingItem[] = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/giu)) {
    const body = match[1] ?? "";
    const title = xmlValue(body, "title");
    const url = xmlValue(body, "link");
    if (!title || !/^https?:\/\//iu.test(url)) continue;
    items.push(
      compact({
        id: shortHash(url),
        source,
        title,
        url,
        articleUrl: url,
        summary: plainTextFromHtml(xmlValue(body, "description")),
        publishedAt: xmlValue(body, "pubDate") || undefined,
      }),
    );
    if (items.length >= Math.min(40, Math.max(1, limit))) break;
  }
  return items;
}

function xmlValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "iu"));
  return decodeHtml((match?.[1] ?? "").replace(/^<!\[CDATA\[|\]\]>$/gu, "")).trim();
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function normalizedUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== ""),
  ) as T;
}
