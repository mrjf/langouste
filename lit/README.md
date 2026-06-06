# Lit

Lit is Langouste's deterministic transliteration layer.

It converts text between named writing/phonetic systems. The first production
target is IPA, but the API is deliberately general enough for romanization,
script conversion, and future dictionary-backed or service-backed providers.

```ts
import { transliterateText } from "@langouste/lit";

const ipa = await transliterateText("Számos README található.", {
  from: { system: "orthography", language: "hu" },
  to: { system: "ipa", language: "hu" },
});

console.log(ipa.text);
```

## Provider Policy

- Prefer dictionary entries when the caller supplies them.
- Prefer deterministic G2P/transliteration libraries over local rules.
- Use local rules for regular orthographies and as a lightweight fallback.
- Do not call LLMs from this package.
- Use `HttpLitProvider` only when a language needs a heavier runtime
  such as a Python/Java NLP service.
