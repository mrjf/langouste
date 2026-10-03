export { HackerNewsAdapter, parseItem, parseStoryIds } from "./hacker-news";
export { decodeHtml, parseArticleHtml, plainTextFromHtml } from "./html";
export {
  PublisherAdapter,
  articleFromRss,
  parseHomepageListing,
  parseRssListing,
} from "./publisher";
export { assertPublicHttpUrl, isPrivateAddress, safeFetchText } from "./safe-fetch";
export type {
  NewsListingItem,
  NewsSourceId,
  ScrapedArticle,
  SourceAdapter,
} from "../../../types/news.ts";

import { HackerNewsAdapter } from "./hacker-news";
import { PublisherAdapter } from "./publisher";
import type { NewsSourceId, SourceAdapter } from "../../../types/news.ts";

export function createSourceAdapters(): Record<NewsSourceId, SourceAdapter> {
  return {
    "hacker-news": new HackerNewsAdapter(),
    nytimes: new PublisherAdapter({
      id: "nytimes",
      homepageUrl: "https://www.nytimes.com",
      allowedHosts: ["nytimes.com"],
      rssUrl: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
    }),
    sfchronicle: new PublisherAdapter({
      id: "sfchronicle",
      homepageUrl: "https://www.sfchronicle.com",
      allowedHosts: ["sfchronicle.com"],
    }),
  };
}
