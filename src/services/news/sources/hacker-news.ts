import { parseArticleHtml, plainTextFromHtml } from "./html";
import { safeFetchText } from "./safe-fetch";
import type { NewsListingItem, ScrapedArticle, SourceAdapter } from "../../../types/news.ts";

const API = "https://hacker-news.firebaseio.com/v0";

export interface HackerNewsItem {
  id: number;
  type?: string;
  by?: string;
  time?: number;
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  descendants?: number;
  deleted?: boolean;
  dead?: boolean;
}

type Fetcher = typeof fetch;

export class HackerNewsAdapter implements SourceAdapter {
  readonly id = "hacker-news" as const;

  constructor(private readonly fetcher: Fetcher = fetch) {}

  async list(limit = 20): Promise<NewsListingItem[]> {
    const response = await this.fetcher(`${API}/topstories.json`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok)
      throw new Error(`Hacker News top stories failed with HTTP ${response.status}`);
    const ids = parseStoryIds(await response.json()).slice(0, clampLimit(limit));
    const stories = await mapLimit(ids, 8, (id) => this.fetchItem(id));
    return stories.filter(isVisibleStory).map(listingFromItem);
  }

  async scrape(input: string): Promise<ScrapedArticle> {
    const id = parseItemId(input);
    const item = await this.fetchItem(id);
    if (!isVisibleStory(item)) throw new Error(`Hacker News item ${id} is unavailable`);
    const discussionUrl = `https://news.ycombinator.com/item?id=${id}`;
    const storyText = plainTextFromHtml(item.text ?? "");
    let paragraphs = storyText ? storyText.split(/\n{2,}/gu).filter(Boolean) : [];
    let byline = item.by;
    let publishedAt = item.time ? new Date(item.time * 1000).toISOString() : undefined;
    let description: string | undefined;
    let articleUrl = item.url;

    if (articleUrl) {
      try {
        const fetched = await safeFetchText(articleUrl);
        const parsed = parseArticleHtml(fetched.text, fetched.finalUrl);
        if (parsed.paragraphs.length) paragraphs = parsed.paragraphs;
        byline = parsed.byline ?? byline;
        publishedAt = parsed.publishedAt ?? publishedAt;
        description = parsed.description;
        articleUrl = fetched.finalUrl;
      } catch {
        // HN links span the whole web. Submitted text/title remain a useful
        // fallback when a linked site blocks extraction or is not an article.
      }
    }
    if (!paragraphs.length)
      paragraphs = description ? [description] : [item.title ?? "Untitled story"];
    return compact({
      id: `hacker-news:${id}`,
      source: this.id,
      title: item.title ?? "Untitled Hacker News story",
      url: articleUrl ?? discussionUrl,
      paragraphs,
      sourceLanguage: "en" as const,
      byline,
      publishedAt,
      description,
      discussionUrl,
    });
  }

  private async fetchItem(id: number): Promise<HackerNewsItem | null> {
    const response = await this.fetcher(`${API}/item/${id}.json`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok ? parseItem(await response.json()) : null;
  }
}

export function parseStoryIds(value: unknown): number[] {
  if (!Array.isArray(value)) throw new Error("Hacker News returned an invalid story list");
  return value.filter((id): id is number => Number.isInteger(id) && id > 0);
}

export function parseItem(value: unknown): HackerNewsItem | null {
  if (!isRecord(value) || !Number.isInteger(value.id)) return null;
  return {
    id: Number(value.id),
    ...(typeof value.type === "string" ? { type: value.type } : {}),
    ...(typeof value.by === "string" ? { by: value.by } : {}),
    ...(typeof value.time === "number" ? { time: value.time } : {}),
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.url === "string" ? { url: value.url } : {}),
    ...(typeof value.text === "string" ? { text: value.text } : {}),
    ...(typeof value.score === "number" ? { score: value.score } : {}),
    ...(typeof value.descendants === "number" ? { descendants: value.descendants } : {}),
    ...(value.deleted === true ? { deleted: true } : {}),
    ...(value.dead === true ? { dead: true } : {}),
  };
}

function listingFromItem(item: HackerNewsItem): NewsListingItem {
  const discussionUrl = `https://news.ycombinator.com/item?id=${item.id}`;
  return compact({
    id: String(item.id),
    source: "hacker-news" as const,
    title: item.title ?? "Untitled Hacker News story",
    url: discussionUrl,
    articleUrl: item.url,
    discussionUrl,
    author: item.by,
    publishedAt: item.time ? new Date(item.time * 1000).toISOString() : undefined,
    score: item.score,
    commentCount: item.descendants,
  });
}

function isVisibleStory(item: HackerNewsItem | null): item is HackerNewsItem {
  return !!item && item.type === "story" && !item.deleted && !item.dead && !!item.title;
}

function parseItemId(input: string): number {
  if (/^\d+$/u.test(input.trim())) return Number(input);
  try {
    const id = Number(new URL(input).searchParams.get("id"));
    if (Number.isInteger(id) && id > 0) return id;
  } catch {
    // Fall through.
  }
  throw new Error("A Hacker News item id or discussion URL is required");
}

function clampLimit(limit: number): number {
  return Math.min(40, Math.max(1, Math.floor(limit)));
}

async function mapLimit<T, R>(values: T[], concurrency: number, mapper: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        results[index] = await mapper(values[index] as T);
      }
    }),
  );
  return results;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== ""),
  ) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
