import type { Dimension } from "./dimensions.ts";

export interface GrammarCategory {
  category: string;
  dimension: Dimension;
  description: string;
  scope: "universal" | "language";
  languages?: string[];
}

const GRAMMAR_CATEGORIES: GrammarCategory[] = [
  // Morphology
  generic("verb:agreement", "morphology"),
  generic("verb:auxiliary", "morphology"),
  generic("verb:conjugation", "morphology"),
  generic("verb:mood", "morphology"),
  generic("verb:passé_composé", "morphology", "Passé composé verb formation."),
  generic("verb:tense", "morphology"),
  generic("person:first", "morphology", "First-person forms and reference."),
  generic("person:second", "morphology", "Second-person forms and reference."),
  generic("person:third", "morphology", "Third-person forms and reference."),
  generic("noun:case", "morphology"),
  generic("noun:gender", "morphology"),
  generic("noun:number", "morphology"),
  generic("article:agreement", "morphology"),
  generic("article:definiteness", "morphology", "Article definiteness."),
  generic("article:gender", "morphology"),
  generic("adjective:agreement", "morphology"),
  generic("gender:articles", "morphology", "Article gender agreement."),
  generic("number:agreement", "morphology"),

  // Syntax
  universal("u:syntax:agreement.subject-verb", "Subject-verb agreement."),
  universal("u:syntax:determiner.definiteness", "Definite vs. indefinite article usage."),
  universal("u:syntax:word-order.adjective", "Adjective position."),
  universal("u:syntax:word-order.object", "Object position."),
  universal("u:syntax:word-order.question", "Question word order."),
  universal("u:syntax:word-order.verb", "Verb position."),
  universal("u:syntax:adposition.selection", "Adposition selection."),
  universal("u:syntax:clause.relative", "Relative clause formation."),
  universal("u:syntax:clause.subordination", "Subordinate clause formation."),
  universal("u:syntax:relative-pronoun", "Relative pronoun selection."),
  universal("u:syntax:negation.placement", "Negation placement."),
  universal("sentence:mood.interrogative", "Interrogative sentence mood."),
  languageSpecific("fr:syntax:preposition.a-vs-de", ["fr"], "Choosing between à and de."),

  // Orthography
  generic("accent:acute_grave", "orthography", "Acute vs. grave accent usage."),
  generic("accent:diacritics", "orthography"),
  generic("capitalization:nouns", "orthography"),
  generic("capitalisation:nouns", "orthography"),
  generic("punctuation:sentence", "orthography"),
  generic("spelling:diacritics", "orthography"),
  generic("spelling:word_form", "orthography"),

  // Pragmatics
  generic("address:formal_informal", "pragmatics", "Formal vs. informal address."),
  generic("formality:register", "pragmatics"),
  generic("pragmatics:greeting", "pragmatics", "Greeting formulae."),
  generic("pragmatics:farewell", "pragmatics", "Farewell formulae."),
  generic("politeness:formula", "pragmatics"),

  // Discourse
  generic("connector:cohesion", "discourse"),
  generic("cohesion:reference", "discourse"),
  generic("discourse:connectors", "discourse"),
];

const BY_CATEGORY = new Map(GRAMMAR_CATEGORIES.map((entry) => [entry.category, entry]));
const CATEGORY_ALIASES = new Map<string, string>([
  ["agreement:subject_verb", "u:syntax:agreement.subject-verb"],
  ["articles:definite_vs_indefinite", "u:syntax:determiner.definiteness"],
  ["word_order:adjective_position", "u:syntax:word-order.adjective"],
  ["word_order:object_position", "u:syntax:word-order.object"],
  ["word_order:question_formation", "u:syntax:word-order.question"],
  ["word_order:verb_position", "u:syntax:word-order.verb"],
  ["preposition:selection", "u:syntax:adposition.selection"],
  ["prepositions:à_vs_de", "fr:syntax:preposition.a-vs-de"],
  ["clause:relative", "u:syntax:clause.relative"],
  ["clause:subordination", "u:syntax:clause.subordination"],
  ["relative:pronoun", "u:syntax:relative-pronoun"],
  ["negation:placement", "u:syntax:negation.placement"],
  ["negation", "u:syntax:negation.placement"],
  ["question", "sentence:mood.interrogative"],
  ["question:sentence", "sentence:mood.interrogative"],
  ["interrogative", "sentence:mood.interrogative"],
  ["sentence:interrogative", "sentence:mood.interrogative"],
  ["first_person", "person:first"],
  ["person:1", "person:first"],
  ["greeting", "pragmatics:greeting"],
  ["formal_language", "formality:register"],
]);

export const ALLOWED_GRAMMAR_CATEGORIES = GRAMMAR_CATEGORIES.map((entry) => entry.category);

export function normalizeGrammarCategory(
  value: string | null | undefined,
  language?: string | null,
): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  const canonical = CATEGORY_ALIASES.get(normalized) ?? normalized;
  const entry = BY_CATEGORY.get(canonical);
  if (!entry || !appliesToLanguage(entry, language)) return null;
  return canonical;
}

export function grammarDimensionForCategory(
  value: string | null | undefined,
  language?: string | null,
): Dimension | null {
  const normalized = normalizeGrammarCategory(value, language);
  return normalized ? (BY_CATEGORY.get(normalized)?.dimension ?? null) : null;
}

export function grammarDescriptionForCategory(
  value: string | null | undefined,
  language?: string | null,
): string {
  const normalized = normalizeGrammarCategory(value, language);
  if (!normalized) return "";
  return BY_CATEGORY.get(normalized)?.description ?? humanizeCategory(normalized);
}

function generic(category: string, dimension: Dimension, description?: string): GrammarCategory {
  return {
    category,
    dimension,
    description: description ?? `${humanizeCategory(category)}.`,
    scope: "universal",
  };
}

function universal(category: string, description: string): GrammarCategory {
  return { category, dimension: "syntax", description, scope: "universal" };
}

function languageSpecific(
  category: string,
  languages: string[],
  description: string,
): GrammarCategory {
  return { category, dimension: "syntax", description, scope: "language", languages };
}

function appliesToLanguage(entry: GrammarCategory, language?: string | null): boolean {
  if (entry.scope === "universal" || !entry.languages?.length) return true;
  return !!language && entry.languages.includes(language);
}

function humanizeCategory(category: string): string {
  const [head, ...tail] = category.split(":");
  const topic = humanizeKey(head);
  const detail = humanizeKey(tail.join(":"));
  return topic && detail ? `${topic}: ${detail}` : topic || detail || category;
}

function humanizeKey(value: string): string {
  return value
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
