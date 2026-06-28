# Filo

Filo is a standalone TypeScript annotation library for immutable text.

The core model is deliberately small:

- A document owns one base text.
- The base text is indexed by UTF-8 byte offset.
- A document has named tiers.
- Each tier contains any number of annotations.
- Every annotation is a byte range plus arbitrary typed payload data.

This gives applications one common substrate for word boundaries, dictionary
lookups, phrase translations, parse spans, audio links, and transcript
alignment.

```ts
import {
  FiloDocument,
  annotateDictionaryLookups,
  annotateWords,
} from "filo";

const doc = FiloDocument.fromText("Számos README található szétszórva ebben.");
annotateWords(doc, { language: "hu" });

await annotateDictionaryLookups(doc, {
  language: "hu",
  lookup: async ({ surface }) => ({
    lemma: surface.toLocaleLowerCase("hu"),
    definitions: [],
  }),
});

const hovered = doc.annotationsAt(doc.byteOffsetForStringIndex(0));
```

## Commands

```sh
bun run check
bun run test
bun run build
bun run dev:web
bun run build:web
bun run scrape:nytimes -- <article-url>
```
