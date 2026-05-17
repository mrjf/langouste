/**
 * Interim mapping from grammar-gap category strings to ontology dimensions.
 *
 * This exists because the concept catalog in docs/ONTOLOGY.md isn't shipped
 * yet. Once concepts land with stable IDs and dimension tags, the mapper
 * becomes a simple lookup on `concept_id`. Until then we eyeball the category
 * prefix (produced by Sonnet) and bucket it.
 *
 * The dimension names match docs/ONTOLOGY.md.
 */

export type Dimension =
  | "phonology"
  | "orthography"
  | "morphology"
  | "syntax"
  | "lexis"
  | "pragmatics"
  | "discourse";

export const ALL_DIMENSIONS: Dimension[] = [
  "phonology",
  "orthography",
  "morphology",
  "syntax",
  "lexis",
  "pragmatics",
  "discourse",
];

const PREFIX_TO_DIMENSION: Record<string, Dimension> = {
  verb: "morphology",
  noun: "morphology",
  article: "morphology",
  adjective: "morphology",
  gender: "morphology",
  number: "morphology",
  case: "morphology",
  conjugation: "morphology",
  declension: "morphology",

  preposition: "syntax",
  word_order: "syntax",
  agreement: "syntax",
  clause: "syntax",
  subordinate: "syntax",
  relative: "syntax",
  negation: "syntax",

  spelling: "orthography",
  accent: "orthography",
  capitalisation: "orthography",
  capitalization: "orthography",
  punctuation: "orthography",

  vocabulary: "lexis",
  collocation: "lexis",
  idiom: "lexis",
  false_friend: "lexis",

  pronunciation: "phonology",
  phoneme: "phonology",
  stress: "phonology",

  register: "pragmatics",
  politeness: "pragmatics",
  formality: "pragmatics",
  address: "pragmatics",

  connector: "discourse",
  cohesion: "discourse",
  anaphora: "discourse",
};

/** Pick the dimension for a gap category like "verb:passé_composé". */
export function dimensionForCategory(category: string): Dimension {
  const lower = category.toLowerCase();
  const head = lower.split(":")[0].split("_")[0];
  return PREFIX_TO_DIMENSION[head] ?? "syntax";
}
