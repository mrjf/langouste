import {
  NEWS_LANGUAGE_OPTIONS,
  type CefrLevel,
  type NewsSourceId,
  type ReadingRequest,
} from "../../types/news";

export const DEFAULT_NEWS_LANGUAGES = ["hu", "ar", "fr", "pt", "es", "de"];
export const DEFAULT_NEWS_LEVEL: CefrLevel = "B1";
export const DEFAULT_NEWS_SOURCE: NewsSourceId = "hacker-news";

const SOURCES = new Set<NewsSourceId>(["hacker-news", "nytimes", "sfchronicle"]);
const LEVELS = new Set<CefrLevel>(["A1", "A2", "B1", "B2", "C1"]);
const LANGUAGES = new Set(NEWS_LANGUAGE_OPTIONS.map((language) => language.code));

export interface NewsDeskState {
  view: "desk";
  source: NewsSourceId;
  languages: string[];
  level: CefrLevel;
  input: string;
}

export interface NewsReaderViewState {
  sentenceOrdinal: number;
  language: string;
  showBase: boolean;
  wordOrdinal?: number;
}

export interface NewsReadingState {
  view: "read";
  request: ReadingRequest;
  reader: NewsReaderViewState;
}

export type NewsRouteState = NewsDeskState | NewsReadingState;

export function defaultNewsDeskState(): NewsDeskState {
  return {
    view: "desk",
    source: DEFAULT_NEWS_SOURCE,
    languages: [...DEFAULT_NEWS_LANGUAGES],
    level: DEFAULT_NEWS_LEVEL,
    input: "",
  };
}

export function defaultNewsReaderState(languages: string[]): NewsReaderViewState {
  return {
    sentenceOrdinal: 0,
    language: languages[0] ?? DEFAULT_NEWS_LANGUAGES[0]!,
    showBase: false,
  };
}

export function parseNewsRoute(value = ""): NewsRouteState {
  const [path = "", query = ""] = value.replace(/^\/+/, "").split("?", 2);
  const params = new URLSearchParams(query);
  const source = sourceFrom(params.get("source"));
  const languages = languagesFrom(params.get("languages"));
  const level = levelFrom(params.get("level"));
  const input = params.get("story")?.trim() ?? "";
  if (path !== "read" || !input) {
    return { view: "desk", source, languages, level, input };
  }
  const focusedLanguage = params.get("language") ?? "";
  const wordOrdinal = optionalOrdinal(params.get("word"));
  return {
    view: "read",
    request: { source, input, languages, level },
    reader: {
      sentenceOrdinal: optionalOrdinal(params.get("sentence")) ?? 0,
      language: languages.includes(focusedLanguage) ? focusedLanguage : languages[0]!,
      showBase: params.get("english") === "shown",
      ...(wordOrdinal === undefined ? {} : { wordOrdinal }),
    },
  };
}

export function newsRoute(state: NewsRouteState): string {
  const params = new URLSearchParams();
  const request = state.view === "read" ? state.request : state;
  params.set("source", request.source);
  params.set("story", request.input);
  params.set("languages", request.languages.join(","));
  params.set("level", request.level);
  if (state.view === "read") {
    params.set("sentence", String(state.reader.sentenceOrdinal));
    params.set("language", state.reader.language);
    params.set("english", state.reader.showBase ? "shown" : "hidden");
    if (state.reader.wordOrdinal !== undefined) {
      params.set("word", String(state.reader.wordOrdinal));
    }
  }
  return `${state.view === "read" ? "read" : "desk"}?${params.toString()}`;
}

export function newsHref(state: NewsRouteState): string {
  return `#/news/${newsRoute(state)}`;
}

export function sameReadingRequest(left: ReadingRequest, right: ReadingRequest): boolean {
  return (
    left.source === right.source &&
    left.input.trim() === right.input.trim() &&
    left.level === right.level &&
    left.languages.length === right.languages.length &&
    left.languages.every((language, index) => language === right.languages[index])
  );
}

function sourceFrom(value: string | null): NewsSourceId {
  return value && SOURCES.has(value as NewsSourceId)
    ? (value as NewsSourceId)
    : DEFAULT_NEWS_SOURCE;
}

function levelFrom(value: string | null): CefrLevel {
  return value && LEVELS.has(value as CefrLevel) ? (value as CefrLevel) : DEFAULT_NEWS_LEVEL;
}

function languagesFrom(value: string | null): string[] {
  const languages = [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((language) => language.trim())
        .filter((language) => LANGUAGES.has(language)),
    ),
  ].slice(0, 8);
  return languages.length ? languages : [...DEFAULT_NEWS_LANGUAGES];
}

function optionalOrdinal(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const ordinal = Number(value);
  return Number.isSafeInteger(ordinal) && ordinal >= 0 ? ordinal : undefined;
}
