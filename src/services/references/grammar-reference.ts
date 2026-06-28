import { languageName } from "../../lib/languages.ts";

export type GrammarReferenceKind = "grammar" | "reference" | "resource" | "exercise" | "video";

export interface GrammarReferenceLink {
  label: string;
  url: string;
  source: string;
  kind: GrammarReferenceKind;
}

const CONCEPT_LINKS: Record<string, GrammarReferenceLink[]> = {
  "sentence:mood.interrogative": [
    {
      label: "Interrogative clause",
      url: "https://en.wikipedia.org/wiki/Interrogative_clause",
      source: "Wikipedia",
      kind: "reference",
    },
  ],
  "u:syntax:word-order.question": [
    {
      label: "Interrogative clause",
      url: "https://en.wikipedia.org/wiki/Interrogative_clause",
      source: "Wikipedia",
      kind: "reference",
    },
  ],
  "u:syntax:negation.placement": [
    {
      label: "Negation",
      url: "https://en.wikipedia.org/wiki/Negation_(linguistics)",
      source: "Wikipedia",
      kind: "reference",
    },
  ],
  "person:first": [
    {
      label: "Grammatical person",
      url: "https://en.wikipedia.org/wiki/Grammatical_person",
      source: "Wikipedia",
      kind: "reference",
    },
  ],
  "person:second": [
    {
      label: "Grammatical person",
      url: "https://en.wikipedia.org/wiki/Grammatical_person",
      source: "Wikipedia",
      kind: "reference",
    },
  ],
  "person:third": [
    {
      label: "Grammatical person",
      url: "https://en.wikipedia.org/wiki/Grammatical_person",
      source: "Wikipedia",
      kind: "reference",
    },
  ],
  "formality:register": [
    {
      label: "Register",
      url: "https://en.wikipedia.org/wiki/Register_(sociolinguistics)",
      source: "Wikipedia",
      kind: "reference",
    },
    {
      label: "T-V distinction",
      url: "https://en.wikipedia.org/wiki/T%E2%80%93V_distinction",
      source: "Wikipedia",
      kind: "reference",
    },
  ],
  "address:formal_informal": [
    {
      label: "T-V distinction",
      url: "https://en.wikipedia.org/wiki/T%E2%80%93V_distinction",
      source: "Wikipedia",
      kind: "reference",
    },
  ],
  "pragmatics:greeting": [
    {
      label: "Greeting",
      url: "https://en.wikipedia.org/wiki/Greeting",
      source: "Wikipedia",
      kind: "reference",
    },
  ],
  "pragmatics:farewell": [
    {
      label: "Parting phrase",
      url: "https://en.wikipedia.org/wiki/Parting_phrase",
      source: "Wikipedia",
      kind: "reference",
    },
  ],
};

const LANGUAGE_RESOURCE_LINKS: Record<string, GrammarReferenceLink[]> = {
  hu: [
    {
      label: "FSI Hungarian Basic Course",
      url: "https://www.fsi-language-courses.org/fsi-hungarian-basic-course/",
      source: "FSI",
      kind: "resource",
    },
    {
      label: "FSI Hungarian Graded Reader",
      url: "https://www.fsi-language-courses.org/fsi-hungarian-graded-reader/",
      source: "FSI",
      kind: "resource",
    },
  ],
};

export function grammarReferenceLinks(category: string, language: string): GrammarReferenceLink[] {
  return dedupeLinks([
    ...(CONCEPT_LINKS[category] ?? []),
    ...languageGrammarLinks(language),
    {
      label: "Langouste resource catalog",
      url: "#/resources",
      source: "Langouste",
      kind: "resource",
    },
  ]).slice(0, 6);
}

function languageGrammarLinks(language: string): GrammarReferenceLink[] {
  const links = LANGUAGE_RESOURCE_LINKS[language];
  if (links) return links;
  const name = languageName(language);
  return [
    {
      label: `${name} references`,
      url: `https://en.wiktionary.org/wiki/Special:Search?search=${encodeURIComponent(name)}`,
      source: "Wiktionary",
      kind: "reference",
    },
  ];
}

function dedupeLinks(links: GrammarReferenceLink[]): GrammarReferenceLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    if (!link.url || seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}
