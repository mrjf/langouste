export interface PodcastEpisode {
  guid?: string;
  title: string;
  enclosureUrl: string;
  enclosureType?: string;
  durationSec?: number;
  pubDate?: string;
}

export function parsePodcastFeed(xml: string): PodcastEpisode[] {
  const episodes: PodcastEpisode[] = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/giu)) {
    const body = match[1] ?? "";
    const enclosureUrl = xmlAttr(body, "enclosure", "url");
    const title = xmlValue(body, "title");
    if (!title || !/^https?:\/\//iu.test(enclosureUrl)) continue;
    episodes.push(
      compact({
        guid: xmlValue(body, "guid") || undefined,
        title,
        enclosureUrl,
        enclosureType: xmlAttr(body, "enclosure", "type") || undefined,
        durationSec: parseDurationSec(xmlValue(body, "itunes:duration")),
        pubDate: xmlValue(body, "pubDate") || undefined,
      }),
    );
  }
  return episodes;
}

/** Feed items are conventionally listed newest-first, so "latest" is simply the first entry. */
export function selectEpisode(episodes: PodcastEpisode[], selector: string): PodcastEpisode {
  if (episodes.length === 0) {
    throw new Error("Podcast feed has no usable episodes with an audio enclosure");
  }
  if (selector === "latest") {
    const episode = episodes[0];
    if (!episode) throw new Error("Podcast feed has no usable episodes");
    return episode;
  }
  if (/^\d+$/u.test(selector)) {
    const episode = episodes[Number.parseInt(selector, 10)];
    if (!episode) throw new Error(`Podcast feed has no episode at index ${selector}`);
    return episode;
  }
  const episode = episodes.find((candidate) => candidate.guid === selector);
  if (!episode) throw new Error(`Podcast feed has no episode with guid ${selector}`);
  return episode;
}

function xmlValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "iu"));
  return decodeXmlEntities((match?.[1] ?? "").replace(/^<!\[CDATA\[|\]\]>$/gu, "")).trim();
}

function xmlAttr(xml: string, tag: string, attr: string): string {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"[^>]*/?>`, "iu"));
  return decodeXmlEntities(match?.[1] ?? "");
}

function parseDurationSec(value: string): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/u.test(value)) return Number.parseInt(value, 10);
  const parts = value.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) return undefined;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'");
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
