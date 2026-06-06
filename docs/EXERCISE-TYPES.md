# Exercise Types

Langouste exercise generation should behave like a typology-aware adaptive workbook, not like a
flashcard cloze factory. The important constraint is that runtime scoring must be deterministic:
AI may help author or review content packs offline, but an exercise shown to a learner must reduce
to an answer contract the app can score without calling an LLM.

This doc defines the exercise typology and the implementation contract for
`src/services/exercises/generator.ts`.

## Core Contract

Every generated exercise is an instantiated template:

```ts
abstract template
+ language profile
+ lexeme/concept data
+ learner constraints
= prompt + accepted answers + deterministic scoring policy + ontology tags
```

The template is defined with English identifiers and authoring text, but it is not English-shaped
grammar. It targets abstract features such as `noun.gender`, `verb.tense`,
`u:syntax:word-order.verb`, `orthography.diacritics`, or `pragmatics.formality`. A language adapter
either realizes the feature, maps it to a local equivalent, or disables the template for that
language.

An exercise payload records:

- `templateId`: stable template identifier, for example `lexis.translation-recall`.
- `family`: recognition, controlled recall, morphology, syntax, cloze, matching, sorting,
  transformation, dialogue, or production.
- `taskType`: choice, typed recall, completion, classification, ordering, or short production.
- `dimensions`: links into the seven-language-skill ontology: phonology, orthography, morphology,
  syntax, lexis, pragmatics, discourse.
- `grammarTags`: ontology categories such as `u:syntax:word-order.verb`.
- `lexicalItemIds`: vocabulary rows used to fill slots.
- `typologyFeatures`: cross-language feature labels used by the template.
- `scoringPolicy`: `option_id`, `normalized_exact`, `accent_lenient`, `per_blank`,
  `token_order`, or `record_only`.
- `difficulty`: CEFR band/range plus concrete factors such as "typed recall" or "distractors".

## Deterministic Exercise Families

These families can be generated dynamically and scored without AI when their templates have a
closed answer contract.

| Family | Examples | Deterministic scoring |
|---|---|---|
| Recognition | choose meaning, choose form, identify tense, choose correct sentence | selected option equals expected option |
| Controlled recall | translate one item, type missing word, type inflected form | normalized answer in accepted answer set |
| Morphology | conjugate, decline, pluralize, change gender/register | generated paradigm form equals answer |
| Sentence transformation | negate, make a question, change tense, replace noun with pronoun | canonical transformed sentence variants |
| Word order / assembly | reorder tokens, place adverb, arrange clause chunks | token sequence or accepted permutations |
| Cloze | lexical cloze, article/particle/case-marker cloze, collocation cloze | per-blank accepted answer sets |
| Matching | word to meaning, sentence to translation, audio to transcript | pair graph equality |
| Sorting / classification | sort nouns by gender, forms by tense, particles by function | item bucket equality |
| Dictation-like input | hear word/phrase/sentence, type transcript | normalized transcript comparison |
| Closed comprehension | true/false, sequence events, identify referent, choose main idea | option id or known span |
| Dialogue/pragmatics | choose appropriate reply, register, speech act | option id tagged to speech act |
| Vocabulary depth | collocation, classifier, false friend, derivational family | lexical relation table |

Open production is still useful, but it is not part of the "score without AI" bank unless a parser or
rule engine can reduce the answer to a closed feature check. Runtime open production is therefore
`record_only`.

## Cross-Language Typology

Templates target language-independent features:

- `article.definiteness`
- `noun.gender`
- `noun.number`
- `case.marking`
- `verb.personAgreement`
- `verb.tense`
- `verb.aspect`
- `verb.mood`
- `wordOrder.basic`
- `wordOrder.question`
- `adjective.position`
- `classifier.required`
- `politeness.register`
- `script.spelling`
- `tone`
- `evidentiality`
- `animacy`

Each language profile declares support. French can run article and gender templates. Japanese
disables article/gender templates but enables particles, counters, politeness, and SOV word order.
Hungarian disables articles-by-gender but can enable definite/indefinite conjugation, case suffixes,
vowel harmony, and flexible word-order focus templates.

This matters because "define in English" must mean "define in an abstract ontology with English
labels", not "project English grammar onto every language."

## CEFR And Instance Difficulty

Every template has an intrinsic CEFR range. Every generated instance also gets an instance score.

Instance difficulty considers:

- target CEFR band;
- recognition vs typed recall vs production;
- word frequency or row CEFR level;
- sentence length;
- number and similarity of distractors;
- irregularity;
- number of transformations;
- ambiguity;
- whether the item is due, weak, new, or recently missed;
- whether the item comes from the learner's chat history.

The generator defaults to the latest assessment, then the profile's declared
`learning_languages[].cefr_level`, then A1.

## Customization

The generator supports constrained sessions. Current route query params:

- `lexeme=kenyer,szetszorva` or `term=...`
- `concept=hu:vocab:kenyer,u:syntax:word-order.verb`
- `grammar=u:syntax:word-order.verb`
- `kind=translation_recall,spelling_recall`
- `deterministic=1` for scoreable-only sessions, or `deterministic=0` to include recorded-only
  production templates.

This allows:

- practice for one lexical item;
- practice around one concept;
- grammar drills using familiar vocabulary;
- familiar grammar with new vocabulary;
- deterministic-only review sessions;
- later, targeted packs from a word hover, correction, profile weak spot, or reference concept page.

## Current Implementation

`src/services/exercises/generator.ts` now has a small deterministic template bank:

| Template | Kind | Source data | Scoring |
|---|---|---|---|
| `lexis.meaning-choice` | `meaning_choice` | vocabulary term + translation distractors | `option_id` |
| `lexis.reverse-translation-choice` | `reverse_translation_choice` | translation + target-language term distractors | `option_id` |
| `lexis.translation-recall` | `translation_recall` | vocabulary translation -> term | `accent_lenient` |
| `orthography.spelling-recall` | `spelling_recall` | vocabulary translation + word-shape hint -> term | `accent_lenient` |
| `catalog.guided-translation` | `guided_translation` | curated CEFR sentence translation | `normalized_exact` |

Legacy and future templates remain defined for history compatibility and later parser-backed work,
but they are not part of default active sessions:

| Template | Kind | Signal |
|---|---|---|
| `grammar.category-choice` | `grammar_concept_choice` | legacy grammar classifier; not reused as pending practice |
| `production.use-target-word` | `use_target_word` | open production; not generated without a scorer |
| `grammar.error-repair` | `error_repair` | open production; not generated without a scorer |
| `grammar.form-focus` | `form_focus` | open production; not generated without a scorer |

Default sessions are deterministic-only. Open production rows are not reused as pending practice in
the deterministic session surface. Legacy `vocabulary_cloze`, self-rated, blanked-context, and
grammar-classifier rows remain stored but are filtered out of pending practice and recent exercise
history because their prompts are not valid learner-facing tasks.

## Expansion Plan

The next implementation step is not ad hoc prompts. Add more template families with explicit slot
schemas and language applicability:

1. Morphology templates backed by curated paradigms or UniMorph data.
2. Article, classifier, particle, and case-marker choice templates backed by language profiles.
3. Word-order assembly templates backed by accepted token permutations.
4. Dynamic cloze templates from authored/corpus examples with known answer spans, not arbitrary
   deletion from seen chat context.
5. Matching and sorting payload renderers in the client.
6. Audio-backed dictation and minimal-pair templates once audio assets are available.
7. Closed reading-comprehension templates for native-authored or corpus-backed passages.

The invariant stays the same: every scoreable runtime exercise must carry its canonical answer set,
normalization/scoring policy, CEFR difficulty, lexical links, and grammar/typology tags before the
learner sees it.
