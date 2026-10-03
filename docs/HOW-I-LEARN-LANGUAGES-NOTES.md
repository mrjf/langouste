# Notes on *How I Learn Languages*

Product possibilities for Langouste inspired by Kató Lomb's *How I Learn Languages*. These are exploratory reading notes, not committed roadmap items.

## Prototype status

The first implementation now lives in `/Users/russ/projects/rgt/rgt` as two isolated packages:

- `newsroom/`: a six-column reader backed by Filo tiers, cross-language word/sentence hover, grammar and vocabulary inspection, and Workbench deep links.
- `scraper/`: a standalone Hacker News, NYT, and SF Chronicle ingestion package.

The prototype keeps English as an immutable source layer and generates Hungarian, Arabic, French, Portuguese, Spanish, and German by default, with up to eight visible languages.

## Massively parallel texts

Present the same text in an arbitrary number of languages at once, rather than limiting the reader to a target-language/L1 pair.

### Learning idea

Meaning can be triangulated across several imperfectly understood versions. This could encourage pattern recognition among languages while supporting Lomb's broader preference for learning through substantial, interesting texts and tolerating partial understanding instead of decoding every word before continuing.

### Possible experience

- Align each sentence or phrase across all selected languages.
- Let the learner choose, reorder, hide, and reveal languages.
- Highlight corresponding phrases across languages when one is selected.
- Offer natural and literal translations where the distinction is useful.
- Play sentence-level audio in one language or sequentially across the set.
- Save reusable language sets, such as Romance languages, Germanic languages, or the learner's current languages.
- Gradually hide the learner's anchor language as comprehension improves.
- Turn a conversation, story, article, or Filo corpus item into a multilingual parallel reader.
- Attach corrections, vocabulary, grammar concepts, audio, and review items to aligned phrases.

### Why it may fit Langouste

Conversation history could become personalized reading material instead of disappearing into a chat log. A learner could revisit material they already care about, compare how the same meaning is expressed in several languages, and promote interesting differences directly into review.

### Questions and risks

- At what number of visible languages does useful comparison become visual noise?
- Should the interface use columns, stacked translations, an interlinear view, or switch among them by screen size?
- How reliable does sentence- and phrase-level alignment need to be?
- How should the product show one-to-many mappings and translations with no clean equivalent?
- When should it prefer natural translation, literal gloss, or both?
- Does comparison help beginners, or is this primarily useful to experienced multilingual learners?
- How can the app preserve reading flow and tolerance for ambiguity rather than inviting constant analysis?

### Smallest useful experiment

Take one short conversation or Filo passage, generate versions in three user-selected languages, align them by sentence, and let the learner reveal or hide each translation. Track whether learners read through the passage, inspect cross-language equivalents, save vocabulary, and return to it later.

## Interest-driven simplified feeds

### Example: Hacker News in Simple Hungarian

Turn a feed the learner already wants to read into level-appropriate comprehensible input: "Hacker News in Simple Hungarian," with the same option for Arabic, French, Portuguese, Spanish, and other languages.

This is more compelling than a generic graded reader because the motivation already exists. The learner is reading to discover what happened in technology, not merely to complete a language exercise.

### Possible experience

- Present current Hacker News stories with headlines and short summaries rewritten at a chosen language and difficulty level.
- Preserve the facts and technical vocabulary while simplifying sentence structure and less important vocabulary.
- Let the learner switch among concise, A2, B1, B2, and original versions.
- Reveal the original headline, an L1 translation, or a literal gloss on demand.
- Attach sentence-level audio, vocabulary, grammar explanations, and one-tap review actions.
- Highlight technical terms that are normally borrowed from English rather than forcing unnatural translations.
- Offer a daily digest, a personalized front page, or a small number of carefully rewritten stories rather than an infinite feed.
- Link every item prominently to the original discussion and source article.

### Connection to massively parallel texts

The simplified feed could generate the same story summary in every language the learner follows. A story then becomes a compact parallel-text bundle:

- Simple Hungarian
- Simple Arabic
- Simple French
- Simple Portuguese
- Simple Spanish
- Original English headline and source

The learner could read in one language by default and open additional versions for triangulation. Their language set and difficulty could vary independently: for example, A2 Hungarian beside B1 French and unsimplified Spanish.

### Personalization opportunities

- Rank stories using both the source feed score and the learner's interests.
- Prefer stories whose vocabulary overlaps with words the learner already knows, while introducing a controlled number of new items.
- Reuse recently learned vocabulary naturally when producing summaries.
- Track recurring domain language such as startups, databases, security, economics, and programming.
- Build other editions from the same mechanism: local news, football, fashion, science, music, recipes, or a user's RSS subscriptions.

The broader product idea is not specifically "Hacker News translated." It is **personally interesting feeds converted into level-controlled comprehensible input**.

### Editorial and technical risks

- A simplified version must remain faithful to the source; simplification should not invent certainty or omit a crucial qualification.
- Rewriting only a headline may provide too little context, while summarizing the linked page requires reliable access to many different sites and formats.
- The UI must clearly distinguish the original author's words from Langouste's generated summary.
- Some technical concepts cannot be made genuinely A1 or A2 without extra explanation.
- Arabic needs choices around register, dialect, transliteration, and diacritics rather than a single generic output setting.
- Language difficulty cannot be controlled only by asking a model for a CEFR level; vocabulary coverage and grammatical features should be checked after generation.
- The product should summarize and link rather than reproduce source articles.
- An addictive feed could undermine deliberate learning, so a bounded daily edition may be better than endless scrolling.

### Smallest useful experiment

Once a day, select the top five Hacker News stories and produce faithful three-sentence summaries in one target language at one chosen level. Show the original headline, target-language summary, optional English reveal, and source links. Let the learner tap unknown phrases and save them. Measure completion, vocabulary saves, source click-through, and next-day return.
