import { decode as decodeEntities } from "html-entities";
import { languageName } from "../../lib/languages.ts";

export interface DictionaryLookup {
  term: string;
  language: string;
  source: "wiktionary" | null;
  source_term: string | null;
  source_url: string | null;
  target_source_url: string | null;
  form_description: string | null;
  definitions: string[];
  senses: DictionarySense[];
}

export interface DictionarySense {
  part_of_speech: string;
  definition: string;
  examples: string[];
}

interface LookupCandidate {
  term: string;
  formDescription: string | null;
}

interface DefinitionList {
  partOfSpeech: string;
  html: string;
}

const cache = new Map<string, Promise<DictionaryLookup>>();
const WIKTIONARY_FETCH_ATTEMPTS = 2;

export function clearDictionaryLookupCache(): void {
  cache.clear();
}

export function lookupDictionary(term: string, language: string): Promise<DictionaryLookup> {
  const cleanTerm = normalizeTerm(term);
  const key = `${language}:${cleanTerm}`;
  const existing = cache.get(key);
  if (existing) return existing;

  const promise = buildLookup(cleanTerm, language)
    .then((lookup) => {
      if (lookup.definitions.length === 0 && !lookup.source_term) {
        cache.delete(key);
      }
      return lookup;
    })
    .catch((err) => {
      cache.delete(key);
      throw err;
    });
  cache.set(key, promise);
  return promise;
}

async function buildLookup(term: string, language: string): Promise<DictionaryLookup> {
  if (!term) return emptyLookup(term, language);
  const localLookup = localFallbackLookup(term, language);
  if (localLookup) return localLookup;

  const candidates = lookupCandidates(term, language);
  let formLookup: DictionaryLookup | null = null;

  for (const candidate of candidates) {
    const page = await fetchWiktionaryPage(candidate.term);
    if (!page) continue;
    const senses = extractSenses(page.html, language);
    const definitions = senses.map((sense) => sense.definition);
    const firstDefinitionIsInflection = definitions[0]
      ? isInflectionDefinition(definitions[0])
      : false;
    const formDescription = firstDefinitionIsInflection
      ? definitions[0]
      : candidate.formDescription;
    if (definitions.length > 0 && !firstDefinitionIsInflection) {
      return resultFromPage(term, language, page, senses, formDescription);
    }

    const lemmaLookup = await lookupLemma(term, language, page, formDescription);
    if (lemmaLookup) return lemmaLookup;

    if (definitions.length > 0 && !formLookup) {
      formLookup = resultFromPage(term, language, page, senses);
    }
  }

  if (formLookup) return formLookup;
  return emptyLookup(term, language);
}

function resultFromPage(
  term: string,
  language: string,
  page: { title: string; url: string },
  senses: DictionarySense[],
  formDescription: string | null = null,
): DictionaryLookup {
  return {
    term,
    language,
    source: "wiktionary",
    source_term: page.title,
    source_url: englishWiktionarySectionUrl(page.title, language),
    target_source_url: targetLanguageWiktionaryUrl(page.title, language),
    form_description: formDescription,
    definitions: senses.map((sense) => sense.definition),
    senses,
  };
}

async function lookupLemma(
  term: string,
  language: string,
  page: { title: string; html: string; url: string },
  formDescription: string | null,
): Promise<DictionaryLookup | null> {
  const lemma = findLikelyLemma(page.html, language, page.title);
  if (!lemma) return null;
  const lemmaPage = await fetchWiktionaryPage(lemma);
  const lemmaSenses = lemmaPage ? extractSenses(lemmaPage.html, language) : [];
  return lemmaPage && lemmaSenses.length > 0
    ? resultFromPage(term, language, lemmaPage, lemmaSenses, formDescription)
    : null;
}

function emptyLookup(term: string, language: string): DictionaryLookup {
  return {
    term,
    language,
    source: null,
    source_term: null,
    source_url: null,
    target_source_url: null,
    form_description: null,
    definitions: [],
    senses: [],
  };
}

function localFallbackLookup(term: string, language: string): DictionaryLookup | null {
  if (language !== "hu") return null;
  const entry = HUNGARIAN_LOCAL_FORMS[term.toLocaleLowerCase("hu")];
  if (!entry) return null;
  return {
    term,
    language,
    source: null,
    source_term: entry.sourceTerm,
    source_url: null,
    target_source_url: null,
    form_description: entry.formDescription,
    definitions: [entry.definition],
    senses: [
      {
        part_of_speech: entry.partOfSpeech,
        definition: entry.definition,
        examples: [],
      },
    ],
  };
}

async function fetchWiktionaryPage(
  term: string,
): Promise<{ title: string; html: string; url: string } | null> {
  const url = `https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(term)}&prop=text&format=json&origin=*`;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= WIKTIONARY_FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Langouste/0.1 (language-learning dictionary lookup)" },
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) {
        lastError = new Error(`Wiktionary returned HTTP ${response.status}`);
        continue;
      }

      const payload = (await response.json()) as {
        error?: { code?: string; info?: string };
        parse?: { title?: string; text?: { "*": string } };
      };
      if (payload.error?.code === "missingtitle") return null;
      if (payload.error) {
        lastError = new Error(payload.error.info ?? `Wiktionary error: ${payload.error.code}`);
        continue;
      }

      const html = payload.parse?.text?.["*"];
      const title = payload.parse?.title;
      if (!html || !title) {
        lastError = new Error("Wiktionary returned an incomplete parse response");
        continue;
      }
      return { title, html, url: `https://en.wiktionary.org/wiki/${encodeURIComponent(title)}` };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Wiktionary lookup failed");
}

function extractSenses(html: string, language: string): DictionarySense[] {
  const section = extractLanguageSection(html, language);
  if (!section) return [];
  const senses: DictionarySense[] = [];
  for (const definitionHtml of extractDefinitionLists(section)) {
    addSenseItems(definitionHtml, senses);
    if (senses.length >= 3) return senses;
  }
  return senses;
}

function extractDefinitionLists(section: string): DefinitionList[] {
  const lists: DefinitionList[] = [];
  const headingRe =
    /(?:<div class="mw-heading mw-heading([2-6])"><h[2-6]\s+id="([^"]+)"|<h([2-6])>\s*<span class="mw-headline"\s+id="([^"]+)")/gi;
  const headings = [...section.matchAll(headingRe)];

  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index];
    const level = Number(heading[1] ?? heading[3]);
    const title = normalizeHeadingId(heading[2] ?? heading[4]);
    if (!DICTIONARY_POS_HEADINGS.has(title.toLowerCase())) continue;

    const start = (heading.index ?? 0) + heading[0].length;
    const next = headings.find((candidate, candidateIndex) => {
      if (candidateIndex <= index) return false;
      return (
        Number(candidate[1] ?? candidate[3]) <= level ||
        DICTIONARY_POS_HEADINGS.has(normalizeHeadingId(candidate[2] ?? candidate[4]).toLowerCase())
      );
    });
    const block = section.slice(start, next?.index ?? section.length);
    const list = /<ol\b[^>]*>([\s\S]*?)<\/ol>/i.exec(block)?.[1];
    if (list) lists.push({ partOfSpeech: title, html: list });
  }

  return lists;
}

function addSenseItems(definitionList: DefinitionList, senses: DictionarySense[]) {
  for (const item of definitionList.html.matchAll(/<li\b[^>]*>([\s\S]*?)(?=<\/li>)/gi)) {
    const itemHtml = item[1];
    const definition = cleanDefinitionText(itemHtml);
    if (!definition || definition.includes("quotations ▼")) continue;
    if (
      !senses.some(
        (sense) =>
          sense.definition === definition && sense.part_of_speech === definitionList.partOfSpeech,
      )
    ) {
      senses.push({
        part_of_speech: definitionList.partOfSpeech,
        definition,
        examples: extractExamples(itemHtml),
      });
    }
    if (senses.length >= 3) return;
  }
}

function cleanDefinitionText(value: string): string {
  return cleanText(removeDefinitionNoise(removeNestedBlocks(value, ["ul", "ol", "dl"])));
}

function extractExamples(value: string): string[] {
  const examples: string[] = [];
  for (const match of value.matchAll(/<dd\b[^>]*>([\s\S]*?)(?=<\/dd>)/gi)) {
    const example = cleanText(removeNestedBlocks(match[1], ["ul", "ol", "dl"]));
    if (!example || example.includes("quotations ▼")) continue;
    if (!examples.includes(example)) examples.push(example);
    if (examples.length >= 3) break;
  }
  return examples;
}

function cleanText(value: string): string {
  return decodeHtml(stripTags(removeHtmlNoise(value)))
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function extractLanguageSection(html: string, language: string): string | null {
  const id = escapeRegExp(languageName(language).replace(/\s+/g, "_"));
  const match = new RegExp(
    `(?:<div class="mw-heading mw-heading2"><h2\\s+id="${id}"|<h2>\\s*<span class="mw-headline"\\s+id="${id}")`,
  ).exec(html);
  if (!match) return null;
  const rest = html.slice(match.index);
  const next = rest
    .slice(match[0].length)
    .search(
      /(?:<div class="mw-heading mw-heading2"><h2\s+id=|<h2>\s*<span class="mw-headline"\s+id=)/,
    );
  return next >= 0 ? rest.slice(0, match[0].length + next) : rest;
}

function findLikelyLemma(html: string, language: string, currentTitle: string): string | null {
  const section = extractLanguageSection(html, language);
  if (!section) return null;
  const langName = escapeRegExp(languageName(language).replace(/\s+/g, "_"));
  const definitionHtml = firstPosDefinitionHtml(section);
  if (!definitionHtml) return null;
  const definitionText = decodeHtml(stripTags(definitionHtml));
  const textLemma = lemmaFromDefinitionText(definitionText, currentTitle);
  if (textLemma) return textLemma;

  const languageAnchorRe = new RegExp(
    `<a\\s+[^>]*href="/wiki/([^"#?]+)#${langName}"[^>]*>([\\s\\S]*?)<\\/a>`,
    "gi",
  );
  const anchored = firstUsefulLink(definitionHtml, languageAnchorRe, currentTitle);
  if (anchored) return anchored;

  if (!isInflectionDefinition(definitionText)) return null;
  const anyWikiLinkRe = /<a\s+[^>]*href="\/wiki\/([^"#?]+)(?:#[^"]*)?"[^>]*>([\s\S]*?)<\/a>/gi;
  return firstUsefulLink(definitionHtml, anyWikiLinkRe, currentTitle);
}

function firstPosDefinitionHtml(section: string): string | null {
  const list = extractDefinitionLists(section)[0];
  if (!list) return null;
  return /<li\b[^>]*>([\s\S]*?)(?=<\/li>)/i.exec(list.html)?.[1] ?? null;
}

function firstUsefulLink(html: string, linkRe: RegExp, currentTitle: string): string | null {
  for (const match of html.matchAll(linkRe)) {
    const hrefTerm = decodeURIComponent(match[1]).replace(/_/g, " ").trim();
    const label = decodeHtml(stripTags(match[2])).trim();
    const candidate = hrefTerm || label;
    if (!candidate || candidate.toLowerCase() === currentTitle.toLowerCase()) continue;
    if (candidate.includes(":")) continue;
    return candidate;
  }
  return null;
}

function normalizeHeadingId(value: string): string {
  return decodeHtml(value)
    .replace(/_/g, " ")
    .replace(/\s+\d+$/u, "")
    .trim();
}

function isInflectionDefinition(definition: string): boolean {
  return /\b(form|inflection|conjugation|declension|participle|plural|singular|comparative|superlative)\b[\s\S]*\bof\b/iu.test(
    definition,
  );
}

function lemmaFromDefinitionText(definition: string, currentTitle: string): string | null {
  const match =
    /\b(?:inflection|conjugation|declension|participle|plural|singular|comparative|superlative)\s+of\s+([\p{Letter}\p{Mark}'’.-]+)/iu.exec(
      definition,
    ) ??
    /\bform\s+of\s+([\p{Letter}\p{Mark}'’.-]+)/iu.exec(definition) ??
    (isInflectionDefinition(definition)
      ? /\bof\s+([\p{Letter}\p{Mark}'’.-]+)(?:\b|[:.;,])/iu.exec(definition)
      : null);
  const lemma = match?.[1]?.trim();
  if (!lemma || lemma.toLowerCase() === currentTitle.toLowerCase()) return null;
  return lemma;
}

function lookupCandidates(term: string, language: string): LookupCandidate[] {
  const candidates: LookupCandidate[] = [];
  for (const surface of surfaceFormCandidates(term, language)) {
    candidates.push({ term: surface, formDescription: null });
    candidates.push(...heuristicLemmaCandidates(surface, language));
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.term;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function surfaceFormCandidates(term: string, language: string): string[] {
  const locale = localeForLanguage(language);
  const lower = term.toLocaleLowerCase(locale);
  const candidates = [term];
  if (lower !== term) candidates.push(lower);
  return candidates;
}

function heuristicLemmaCandidates(term: string, language: string): LookupCandidate[] {
  if (language !== "hu") return [];
  return hungarianLemmaCandidates(term);
}

function hungarianLemmaCandidates(term: string): LookupCandidate[] {
  const lower = term.toLocaleLowerCase("hu");
  const candidates: LookupCandidate[] = [];
  for (const rule of HUNGARIAN_VERB_SUFFIXES) {
    if (lower.length <= rule.suffix.length + 2 || !lower.endsWith(rule.suffix)) continue;
    const lemma = lower.slice(0, -rule.suffix.length);
    candidates.push({
      term: lemma,
      formDescription: `${rule.description} of ${lemma}`,
    });
  }
  for (const rule of HUNGARIAN_PARTICIPLE_SUFFIXES) {
    if (lower.length <= rule.suffix.length + 2 || !lower.endsWith(rule.suffix)) continue;
    const lemma = lower.slice(0, -rule.suffix.length);
    candidates.push({
      term: lemma,
      formDescription: `${rule.description} of ${lemma}`,
    });
    candidates.push(...hungarianPrefixBaseCandidates(lemma, rule.description));
  }
  for (const rule of HUNGARIAN_NOUN_SUFFIXES) {
    if (lower.length <= rule.suffix.length + 2 || !lower.endsWith(rule.suffix)) continue;
    const lemma = lower.slice(0, -rule.suffix.length);
    candidates.push({
      term: lemma,
      formDescription: `${rule.description} of ${lemma}`,
    });
  }
  candidates.push(...hungarianPrefixBaseCandidates(lower));
  return candidates;
}

function hungarianPrefixBaseCandidates(term: string, description?: string): LookupCandidate[] {
  const candidates: LookupCandidate[] = [];
  for (const prefix of HUNGARIAN_VERBAL_PREFIXES) {
    if (!term.startsWith(prefix) || term.length <= prefix.length + 2) continue;
    const base = term.slice(prefix.length);
    candidates.push({
      term: base,
      formDescription: description
        ? `${description} of ${term}`
        : `prefixed verb ${term}; base ${base}`,
    });
  }
  return candidates;
}

function removeNestedBlocks(value: string, tags: string[]): string {
  const tagPattern = tags.map(escapeRegExp).join("|");
  return value.replace(new RegExp(`<(${tagPattern})\\b[\\s\\S]*?<\\/\\1>`, "gi"), "");
}

function removeDefinitionNoise(value: string): string {
  return removeElementsByClass(removeHtmlNoise(value), ["defdate"]);
}

function removeHtmlNoise(value: string): string {
  return value.replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, "");
}

function removeElementsByClass(value: string, classNames: string[]): string {
  return classNames.reduce(
    (html, className) =>
      html.replace(
        new RegExp(
          `<([a-z][\\w:-]*)\\b(?=[^>]*\\bclass=["'][^"']*\\b${escapeRegExp(
            className,
          )}\\b)[^>]*>[\\s\\S]*?<\\/\\1>`,
          "gi",
        ),
        "",
      ),
    value,
  );
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function decodeHtml(value: string): string {
  return decodeEntities(value);
}

function normalizeTerm(term: string): string {
  return term
    .trim()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ");
}

function localeForLanguage(language: string): string {
  return language || "und";
}

function targetLanguageWiktionaryUrl(term: string, language: string): string {
  return `https://${language}.wiktionary.org/wiki/${encodeURIComponent(term)}`;
}

function englishWiktionarySectionUrl(term: string, language: string): string {
  const section = languageName(language).replace(/\s+/g, "_");
  return `https://en.wiktionary.org/wiki/${encodeURIComponent(term)}#${encodeURIComponent(section)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const HUNGARIAN_VERB_SUFFIXES = [
  { suffix: "lak", description: "first-person singular present object agreement" },
  { suffix: "lek", description: "first-person singular present object agreement" },
  { suffix: "juk", description: "first-person plural present definite" },
  { suffix: "jük", description: "first-person plural present definite" },
  { suffix: "tok", description: "second-person plural present indefinite" },
  { suffix: "tek", description: "second-person plural present indefinite" },
  { suffix: "tök", description: "second-person plural present indefinite" },
  { suffix: "nak", description: "third-person plural present indefinite" },
  { suffix: "nek", description: "third-person plural present indefinite" },
  { suffix: "om", description: "first-person singular present definite" },
  { suffix: "em", description: "first-person singular present definite" },
  { suffix: "öm", description: "first-person singular present definite" },
  { suffix: "od", description: "second-person singular present definite" },
  { suffix: "ed", description: "second-person singular present definite" },
  { suffix: "öd", description: "second-person singular present definite" },
  { suffix: "ja", description: "third-person singular present definite" },
  { suffix: "je", description: "third-person singular present definite" },
  { suffix: "ok", description: "first-person singular present indefinite" },
  { suffix: "ek", description: "first-person singular present indefinite" },
  { suffix: "ök", description: "first-person singular present indefinite" },
  { suffix: "sz", description: "second-person singular present indefinite" },
];

const HUNGARIAN_PARTICIPLE_SUFFIXES = [
  { suffix: "va", description: "adverbial participle" },
  { suffix: "ve", description: "adverbial participle" },
];

const HUNGARIAN_NOUN_SUFFIXES = [
  { suffix: "jának", description: "third-person singular possessive dative" },
  { suffix: "jének", description: "third-person singular possessive dative" },
  { suffix: "ának", description: "third-person singular possessive dative" },
  { suffix: "ének", description: "third-person singular possessive dative" },
  { suffix: "nak", description: "dative singular" },
  { suffix: "nek", description: "dative singular" },
  { suffix: "ot", description: "accusative singular" },
  { suffix: "et", description: "accusative singular" },
  { suffix: "öt", description: "accusative singular" },
  { suffix: "t", description: "accusative singular" },
];

const HUNGARIAN_VERBAL_PREFIXES = [
  "agyon",
  "alá",
  "át",
  "be",
  "bele",
  "el",
  "ellen",
  "fel",
  "felül",
  "félre",
  "hátra",
  "hozzá",
  "ide",
  "ki",
  "körbe",
  "közbe",
  "le",
  "meg",
  "mellé",
  "neki",
  "oda",
  "össze",
  "rá",
  "szét",
  "tovább",
  "túl",
  "újra",
  "vissza",
];

const HUNGARIAN_LOCAL_FORMS: Record<
  string,
  {
    sourceTerm: string;
    formDescription: string;
    partOfSpeech: string;
    definition: string;
  }
> = {
  az: {
    sourceTerm: "az",
    formDescription: "definite article",
    partOfSpeech: "Article",
    definition: "the (for words beginning with a vowel)",
  },
  ebben: {
    sourceTerm: "ez",
    formDescription: "inessive singular of ez",
    partOfSpeech: "Pronoun",
    definition: "in this",
  },
  egyenleged: {
    sourceTerm: "egyenleg",
    formDescription: "second-person singular possessive of egyenleg",
    partOfSpeech: "Noun",
    definition: "your balance",
  },
  visszaáll: {
    sourceTerm: "visszaáll",
    formDescription: "prefixed verb",
    partOfSpeech: "Verb",
    definition: "to reset, restore, or return to a previous state",
  },
};

const DICTIONARY_POS_HEADINGS = new Set([
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
