# Course reading glosses and dictionary entries

The public course uses the existing `DictionaryText` token interaction and
`DictionaryPopover` card. The local lexicon supplies exact surface forms, lemmas,
word glosses, and form notes through byte-aligned Filo word/dictionary/literal
translation tiers. It is course-authored data, not a fetched Wiktionary response.
There are no runtime dictionary requests, translation calls, or new audio calls.

The upper half of a word shows its containing sentence with one gloss per word
and the authored natural English translation. The lower half shows that word's
dictionary card; clicking it opens the right sidebar without reflowing the text.
Keyboard focus shows sentence help, Up/Down select sentence/dictionary, and Enter
opens the sidebar. Touch opens a stable sentence card with an explicit dictionary
button. Escape and close controls dismiss help; sidebar closure returns focus.

Hungarian case/verb forms and Egyptian Arabic attached articles, conjunctions,
pronouns, and verb forms are enumerated explicitly. Contextual homographs are
resolved in `course-reading-support.ts`. Multi-sentence authored rows are split
with aligned English sentences; stored lesson IDs and reading text are unchanged.
The build and service tests reject missing word entries or unaligned sentences.

Hover records only a conservative session support flag. It creates no encounter,
recall, or mastery event and does not rewrite saved learner records. Existing
practice reads that flag so assisted attempts cannot receive unaided recall credit.
