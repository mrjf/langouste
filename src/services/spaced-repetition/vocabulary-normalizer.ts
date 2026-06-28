import type { Database } from "../../lib/db/index.ts";
import { lookupDictionary } from "../references/dictionary.ts";

export interface NormalizedVocabularyTerm {
  original: string;
  term: string;
  language: string;
  source_term: string | null;
  form_description: string | null;
  definition: string | null;
  lookup_source: "wiktionary" | "local" | null;
  lookup_status: "found" | "not-found" | "error";
  lookup_error: string | null;
}

interface VocabularyRow {
  vocab_id: string;
  term: string;
  translation?: string | null;
  context_sentence?: string | null;
  cefr_level?: string | null;
  concept_id?: string | null;
  ease_factor?: number | null;
  interval_days?: number | null;
  repetitions?: number | null;
  encounters?: number | null;
  productions?: number | null;
  correct_productions?: number | null;
  self_corrected_productions?: number | null;
  heard?: number | null;
  spoken?: number | null;
  next_review_at?: string | null;
  last_reviewed_at?: string | null;
  last_encounter_at?: string | null;
  last_produced_at?: string | null;
  last_heard_at?: string | null;
  last_spoken_at?: string | null;
}

const LOWERCASE_LEMMA_LANGS = new Set([
  "en",
  "fr",
  "es",
  "hu",
  "it",
  "pt",
  "nl",
  "ru",
  "tr",
  "da",
  "pl",
]);

export async function normalizeVocabularyTerm(
  term: string,
  language: string,
): Promise<NormalizedVocabularyTerm> {
  const original = cleanTerm(term);
  if (!original || !language) {
    return {
      original,
      term: original,
      language,
      source_term: null,
      form_description: null,
      definition: null,
      lookup_source: null,
      lookup_status: "not-found",
      lookup_error: null,
    };
  }

  let lookup: Awaited<ReturnType<typeof lookupDictionary>> | null = null;
  let lookupError: string | null = null;
  try {
    lookup = await lookupDictionary(original, language);
  } catch (err) {
    lookupError = err instanceof Error ? err.message : String(err);
  }

  if (lookupError) {
    return {
      original,
      term: normalizeLemmaSurface(original, language),
      language,
      source_term: null,
      form_description: null,
      definition: null,
      lookup_source: null,
      lookup_status: "error",
      lookup_error: lookupError,
    };
  }

  const lemma =
    lemmaFromFormDescription(lookup?.form_description, original) ??
    (usesSourceTermAsLemma(lookup?.form_description)
      ? distinctLemma(lookup?.source_term, original, language)
      : null) ??
    original;
  const hasEntry = !!(
    lookup?.definitions?.length ||
    lookup?.source_term ||
    lookup?.form_description
  );

  return {
    original,
    term: normalizeLemmaSurface(lemma, language),
    language,
    source_term: lookup?.source_term ?? null,
    form_description: lookup?.form_description ?? null,
    definition: lookup?.definitions?.[0] ?? null,
    lookup_source: lookup?.source ?? (hasEntry ? "local" : null),
    lookup_status: hasEntry ? "found" : "not-found",
    lookup_error: null,
  };
}

export async function canonicalizeVocabularyRow(
  db: Database,
  userId: string,
  language: string,
  term: string,
): Promise<NormalizedVocabularyTerm> {
  const normalized = await normalizeVocabularyTerm(term, language);
  if (!normalized.term || normalized.term === term) return normalized;

  const source = await findVocabularyRow(db, userId, language, term);
  if (!source) return normalized;

  const target = await findVocabularyRow(db, userId, language, normalized.term);
  if (target && target.vocab_id !== source.vocab_id) {
    await mergeVocabularyRows(db, source, target);
    return normalized;
  }

  await db.update("vocabulary", { term: normalized.term }, [
    { op: "eq", column: "vocab_id", value: source.vocab_id },
  ]);
  return normalized;
}

export function profileVocabularyRoute(language: string, term: string): string {
  const routeKey = cleanTerm(term).replace(/\s+/gu, "_");
  return `#/profile/${encodeURIComponent(language)}/lexis/vocabulary/${encodeURIComponent(routeKey)}`;
}

function cleanTerm(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function normalizeLemmaSurface(value: string, language: string): string {
  const clean = cleanTerm(value);
  return LOWERCASE_LEMMA_LANGS.has(language) ? clean.toLocaleLowerCase(language) : clean;
}

function lemmaFromFormDescription(
  formDescription: string | null | undefined,
  term: string,
): string | null {
  if (!formDescription) return null;
  if (!usesSourceTermAsLemma(formDescription)) return null;
  const match = /\bof\s+([\p{Letter}\p{Mark}'’.-]+)(?:\b|[:.;,])/iu.exec(formDescription);
  return distinctLemma(match?.[1], term, "");
}

function usesSourceTermAsLemma(formDescription: string | null | undefined): boolean {
  return !formDescription || !/\bprefixed verb\b|\bbase\b/iu.test(formDescription);
}

function distinctLemma(
  lemma: string | null | undefined,
  term: string,
  language: string,
): string | null {
  const cleanLemma = typeof lemma === "string" ? cleanTerm(lemma) : "";
  if (!cleanLemma) return null;
  const locale = language || undefined;
  if (cleanLemma.toLocaleLowerCase(locale) === term.toLocaleLowerCase(locale)) {
    return cleanLemma === term ? null : cleanLemma;
  }
  return cleanLemma;
}

async function findVocabularyRow(
  db: Database,
  userId: string,
  language: string,
  term: string,
): Promise<VocabularyRow | null> {
  return db.selectOne<VocabularyRow>("vocabulary", {
    filters: [
      { op: "eq", column: "user_id", value: userId },
      { op: "eq", column: "language", value: language },
      { op: "eq", column: "term", value: term },
    ],
  });
}

async function mergeVocabularyRows(
  db: Database,
  source: VocabularyRow,
  target: VocabularyRow,
): Promise<void> {
  await db.update("review_log", { item_id: target.vocab_id }, [
    { op: "eq", column: "item_type", value: "vocabulary" },
    { op: "eq", column: "item_id", value: source.vocab_id },
  ]);

  await db.update("vocabulary", mergedVocabularyPatch(source, target), [
    { op: "eq", column: "vocab_id", value: target.vocab_id },
  ]);
  await db.delete("vocabulary", [{ op: "eq", column: "vocab_id", value: source.vocab_id }]);
}

function mergedVocabularyPatch(
  source: VocabularyRow,
  target: VocabularyRow,
): Record<string, unknown> {
  return {
    translation: target.translation || source.translation || "",
    context_sentence: target.context_sentence || source.context_sentence || null,
    cefr_level: target.cefr_level || source.cefr_level || null,
    concept_id: target.concept_id || source.concept_id || null,
    ease_factor: Math.max(
      numberValue(target.ease_factor, 2.5),
      numberValue(source.ease_factor, 2.5),
    ),
    interval_days: Math.max(numberValue(target.interval_days), numberValue(source.interval_days)),
    repetitions: Math.max(numberValue(target.repetitions), numberValue(source.repetitions)),
    encounters: numberValue(target.encounters) + numberValue(source.encounters),
    productions: numberValue(target.productions) + numberValue(source.productions),
    correct_productions:
      numberValue(target.correct_productions) + numberValue(source.correct_productions),
    self_corrected_productions:
      numberValue(target.self_corrected_productions) +
      numberValue(source.self_corrected_productions),
    heard: numberValue(target.heard) + numberValue(source.heard),
    spoken: numberValue(target.spoken) + numberValue(source.spoken),
    next_review_at: earliestDue(target.next_review_at, source.next_review_at),
    last_reviewed_at: mostRecent(target.last_reviewed_at, source.last_reviewed_at),
    last_encounter_at: mostRecent(target.last_encounter_at, source.last_encounter_at),
    last_produced_at: mostRecent(target.last_produced_at, source.last_produced_at),
    last_heard_at: mostRecent(target.last_heard_at, source.last_heard_at),
    last_spoken_at: mostRecent(target.last_spoken_at, source.last_spoken_at),
  };
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mostRecent(...values: Array<string | null | undefined>): string | null {
  return (
    values
      .filter((value): value is string => !!value)
      .sort()
      .at(-1) ?? null
  );
}

function earliestDue(...values: Array<string | null | undefined>): string | null {
  return values.filter((value): value is string => !!value).sort()[0] ?? null;
}
