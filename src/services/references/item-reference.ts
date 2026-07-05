import sanitizeHtml from "sanitize-html";
import { languageName } from "../../lib/languages.ts";

export interface ItemReferenceLink {
  label: string;
  url: string;
  source: string;
}

export interface ItemPronunciation {
  kind: "audio" | "ipa";
  label: string;
  value: string;
  source: string;
  url?: string;
}

export interface ItemReference {
  term: string;
  language: string;
  source_term: string | null;
  source: "wiktionary" | null;
  source_url: string | null;
  part_of_speech: string | null;
  pronunciations: ItemPronunciation[];
  conjugation_html: string | null;
  links: ItemReferenceLink[];
  notes: string[];
}

interface WiktionaryPage {
  title: string;
  html: string;
  url: string;
}

const referenceCache = new Map<string, Promise<ItemReference>>();
const COOLJUGATOR_LANGS = new Set(["fr", "es", "de", "hu", "it", "pt", "nl"]);

export function getItemReference(term: string, language: string): Promise<ItemReference> {
  const key = `${language}:${term.trim().toLowerCase()}`;
  const existing = referenceCache.get(key);
  if (existing) return existing;

  const promise = buildItemReference(term, language).catch((err) => {
    referenceCache.delete(key);
    throw err;
  });
  referenceCache.set(key, promise);
  return promise;
}

async function buildItemReference(term: string, language: string): Promise<ItemReference> {
  const cleanTerm = normalizeTerm(term);
  const notes: string[] = [];
  const links = referenceLinks(cleanTerm, language);
  const candidates = candidateTerms(cleanTerm);
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const found = await findConjugation(candidate, language, seen);
    if (!found) continue;
    return {
      term: cleanTerm,
      language,
      source_term: found.page.title,
      source: "wiktionary",
      source_url: found.page.url,
      part_of_speech: extractPartOfSpeech(found.page.html, language),
      pronunciations: extractPronunciations(found.page.html, language),
      conjugation_html: found.html,
      links: dedupeLinks([...links, ...referenceLinks(found.page.title, language)]),
      notes,
    };
  }

  for (const candidate of candidates) {
    const page = await fetchWiktionaryPage(candidate);
    if (!page) continue;
    const pronunciations = extractPronunciations(page.html, language);
    if (pronunciations.length === 0) continue;
    return {
      term: cleanTerm,
      language,
      source_term: page.title,
      source: "wiktionary",
      source_url: page.url,
      part_of_speech: extractPartOfSpeech(page.html, language),
      pronunciations,
      conjugation_html: null,
      links: dedupeLinks([...links, ...referenceLinks(page.title, language)]),
      notes: ["No Wiktionary conjugation table was found for this item yet."],
    };
  }

  notes.push("No Wiktionary conjugation table was found for this item yet.");
  return {
    term: cleanTerm,
    language,
    source_term: null,
    source: null,
    source_url: null,
    part_of_speech: null,
    pronunciations: [],
    conjugation_html: null,
    links,
    notes,
  };
}

async function findConjugation(
  term: string,
  language: string,
  seen: Set<string>,
): Promise<{ page: WiktionaryPage; html: string } | null> {
  const page = await fetchWiktionaryPage(term);
  if (!page) return null;
  seen.add(page.title.toLowerCase());

  const section = extractConjugationSection(page.html, language);
  if (section) return { page, html: sanitizeWiktionaryHtml(section) };

  const lemma = findLikelyLemma(page.html, language, page.title);
  if (!lemma || seen.has(lemma.toLowerCase())) return null;

  const lemmaPage = await fetchWiktionaryPage(lemma);
  if (!lemmaPage) return null;
  seen.add(lemmaPage.title.toLowerCase());

  const lemmaSection = extractConjugationSection(lemmaPage.html, language);
  return lemmaSection ? { page: lemmaPage, html: sanitizeWiktionaryHtml(lemmaSection) } : null;
}

async function fetchWiktionaryPage(term: string): Promise<WiktionaryPage | null> {
  const url = `https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(term)}&prop=text&format=json&origin=*`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Langouste/0.1 (language-learning reference lookup)" },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) return null;

  const payload = (await response.json()) as {
    error?: { code?: string };
    parse?: { title?: string; text?: { "*": string } };
  };
  const html = payload.parse?.text?.["*"];
  const title = payload.parse?.title;
  if (payload.error || !html || !title) return null;

  return {
    title,
    html,
    url: `https://en.wiktionary.org/wiki/${encodeURIComponent(title)}`,
  };
}

function extractConjugationSection(html: string, language: string): string | null {
  const languageSection = extractLanguageSection(html, language) ?? html;
  const match = /<div class="mw-heading mw-heading[3-6]"><h[3-6] id="Conjugation"/.exec(
    languageSection,
  );
  if (!match) return null;

  const rest = languageSection.slice(match.index);
  const nextHeading = rest
    .slice(match[0].length)
    .search(/<div class="mw-heading mw-heading[2-4]"><h[2-4] id="(?!Conjugation")/);
  const section = nextHeading >= 0 ? rest.slice(0, match[0].length + nextHeading) : rest;
  return section.includes("inflection-table") || section.includes("<table") ? section : null;
}

function extractLanguageSection(html: string, language: string): string | null {
  const id = escapeRegExp(languageName(language).replace(/\s+/g, "_"));
  const match = new RegExp(`<div class="mw-heading mw-heading2"><h2 id="${id}"`).exec(html);
  if (!match) return null;
  const rest = html.slice(match.index);
  const next = rest.slice(match[0].length).search(/<div class="mw-heading mw-heading2"><h2 id="/);
  return next >= 0 ? rest.slice(0, match[0].length + next) : rest;
}

function extractPronunciations(html: string, language: string): ItemPronunciation[] {
  const section = extractLanguageSection(html, language) ?? html;
  const pronunciationSection = extractNamedSection(section, "Pronunciation") ?? section;
  const pronunciations: ItemPronunciation[] = [];
  const seen = new Set<string>();

  for (const match of pronunciationSection.matchAll(
    /(?:href|src)="([^"]+\.(?:ogg|mp3|wav)[^"]*)"/gi,
  )) {
    const url = normalizeMediaUrl(match[1]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    pronunciations.push({
      kind: "audio",
      label: audioLabel(url),
      value: url,
      url,
      source: "Wiktionary",
    });
  }

  for (const match of pronunciationSection.matchAll(
    /<span class="[^"]*\bIPA\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
  )) {
    const ipa = decodeHtml(stripTags(match[1])).trim();
    if (!ipa || seen.has(`ipa:${ipa}`)) continue;
    seen.add(`ipa:${ipa}`);
    pronunciations.push({
      kind: "ipa",
      label: "IPA",
      value: ipa,
      source: "Wiktionary",
    });
  }

  return pronunciations.slice(0, 8);
}

function extractPartOfSpeech(html: string, language: string): string | null {
  const section = extractLanguageSection(html, language) ?? html;
  for (const match of section.matchAll(/<h[3-6]\b[^>]*\bid="([^"]+)"/gi)) {
    const heading = normalizeHeadingId(match[1]);
    if (!heading || !isPartOfSpeechHeading(heading)) continue;
    return heading;
  }
  return null;
}

function extractNamedSection(html: string, id: string): string | null {
  const escaped = escapeRegExp(id);
  const match = new RegExp(`<div class="mw-heading mw-heading[3-6]"><h[3-6] id="${escaped}"`).exec(
    html,
  );
  if (!match) return null;
  const rest = html.slice(match.index);
  const next = rest
    .slice(match[0].length)
    .search(/<div class="mw-heading mw-heading[2-6]"><h[2-6] id="(?!Pronunciation")/);
  return next >= 0 ? rest.slice(0, match[0].length + next) : rest;
}

function findLikelyLemma(html: string, language: string, currentTitle: string): string | null {
  const section = extractLanguageSection(html, language) ?? html;
  const langName = escapeRegExp(languageName(language).replace(/\s+/g, "_"));
  const linkRe = new RegExp(`<a href="/wiki/([^"#?]+)#${langName}"[^>]*>([^<]+)</a>`, "g");
  for (const match of section.matchAll(linkRe)) {
    const decoded = decodeURIComponent(match[1]).replace(/_/g, " ");
    if (decoded && decoded.toLowerCase() !== currentTitle.toLowerCase()) return decoded;
  }
  return null;
}

function normalizeMediaUrl(raw: string): string | null {
  const decoded = decodeHtml(raw);
  if (decoded.startsWith("/wiki/File:")) return null;
  const clean = decoded.replace(/\?.*$/, "");
  if (clean.startsWith("//")) return `https:${clean}`;
  if (clean.startsWith("https://")) return clean;
  return null;
}

function audioLabel(url: string): string {
  const file = decodeURIComponent(url.split("/").pop() ?? "audio").replace(/\.(ogg|mp3|wav)$/i, "");
  return file.replace(/_/g, " ");
}

const WIKTIONARY_ORIGIN = "https://en.wiktionary.org";

/**
 * Sanitize Wiktionary conjugation-table HTML before it is rendered via {@html}
 * in the client. Wiktionary is community-editable and fetched over the network,
 * so its HTML is untrusted. We use an allowlist sanitizer (only the tags and
 * attributes a conjugation table needs; no event handlers, styles, scripts,
 * iframes, images, or non-http(s) URLs) rather than trying to strip dangerous
 * constructs by regex — then apply the display transforms the UI relies on
 * (absolute Wiktionary links that open in a new tab, expanded tables).
 *
 * Exported for testing.
 */
export function sanitizeWiktionaryHtml(html: string): string {
  const clean = sanitizeHtml(html, {
    allowedTags: [
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "th",
      "td",
      "caption",
      "colgroup",
      "col",
      "span",
      "div",
      "a",
      "b",
      "i",
      "em",
      "strong",
      "sup",
      "sub",
      "abbr",
      "br",
      "p",
      "small",
      "ul",
      "ol",
      "li",
    ],
    allowedAttributes: {
      "*": ["class", "title", "colspan", "rowspan", "lang", "dir"],
      a: ["href", "target", "rel"],
    },
    allowedSchemes: ["http", "https"],
    // Drop Wiktionary's inline "edit" links entirely.
    exclusiveFilter: (frame) =>
      (frame.attribs?.class ?? "").split(/\s+/).includes("mw-editsection"),
    transformTags: {
      a: (_tagName, attribs) => {
        let href = attribs.href ?? "";
        if (href.startsWith("/wiki/") || href.startsWith("/w/")) {
          href = `${WIKTIONARY_ORIGIN}${href}`;
        }
        return {
          tagName: "a",
          attribs: { ...attribs, href, target: "_blank", rel: "noreferrer" },
        };
      },
    },
  });

  return clean
    .replace(/\binflection-table-collapsed\b/g, "inflection-table-expanded")
    .slice(0, 140_000);
}

function referenceLinks(term: string, language: string): ItemReferenceLink[] {
  const encoded = encodeURIComponent(term);
  const links: ItemReferenceLink[] = [
    {
      label: `Wiktionary: ${term}`,
      source: "Wiktionary",
      url: `https://en.wiktionary.org/wiki/${encoded}`,
    },
    {
      label: `${languageName(language)} Wiktionary: ${term}`,
      source: "Wiktionary",
      url: `https://${language}.wiktionary.org/wiki/${encoded}`,
    },
  ];

  if (COOLJUGATOR_LANGS.has(language) && !/\s/u.test(term)) {
    links.push({
      label: `Cooljugator: ${term}`,
      source: "Cooljugator",
      url: `https://cooljugator.com/${language}/${encoded}`,
    });
  }
  return links;
}

function dedupeLinks(links: ItemReferenceLink[]): ItemReferenceLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

function candidateTerms(term: string): string[] {
  const tokens = term
    .split(/[\s,;.!?()[\]{}"“”]+/u)
    .map(normalizeTerm)
    .filter(Boolean);
  return [...new Set([term, ...tokens.reverse()])].slice(0, 6);
}

function normalizeTerm(term: string): string {
  return term
    .trim()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ");
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#32;/g, " ")
    .replace(/&#8206;/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeHeadingId(value: string): string {
  return decodeHtml(value)
    .replace(/_/g, " ")
    .replace(/\s+\d+$/u, "")
    .trim()
    .split(/\s+/u)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function isPartOfSpeechHeading(value: string): boolean {
  return PART_OF_SPEECH_HEADINGS.has(value.toLowerCase());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PART_OF_SPEECH_HEADINGS = new Set([
  "abbreviation",
  "acronym",
  "adjective",
  "adverb",
  "affix",
  "article",
  "character",
  "circumfix",
  "classifier",
  "combining form",
  "conjunction",
  "contraction",
  "determiner",
  "expression",
  "ideophone",
  "idiom",
  "infix",
  "initialism",
  "interfix",
  "interjection",
  "letter",
  "noun",
  "number",
  "numeral",
  "particle",
  "participle",
  "phrase",
  "postposition",
  "prefix",
  "preposition",
  "prepositional phrase",
  "pronoun",
  "proper noun",
  "proverb",
  "root",
  "suffix",
  "symbol",
  "verb",
]);
