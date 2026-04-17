# Message Processing Pipeline

How user input is processed before it becomes a message in a conversation.

## Language Model

Each user has:

- **Base languages** (one or more): Languages the user already knows fluently. Examples: English, Spanish. These are used for:
  - Hints and error explanations (always available in all base languages)
  - Translations of received messages (available on demand, not shown first)
  - The user **cannot** input messages in a base language — the whole point is to practice target languages
  - Messages are **not** shown first in base languages — that would defeat the purpose

- **Target languages** (one or more): Languages the user is learning. Examples: French, Hungarian. These are used for:
  - Message input — the user **must** write in one of their target languages
  - Receiving messages — new messages appear first in the user's target languages
  - Spell/grammar checking and error explanations
  - Each target language has an independent CEFR level

Example: a user with base languages [English, Spanish] and target languages [French, Hungarian] writes messages in French or Hungarian, receives messages in both French and Hungarian, and gets hints/explanations in both English and Spanish.

## Input Language Detection

As the user types, we auto-detect which language they're writing in and display the corresponding flag next to the input field. This is a dropdown — the user can override the detection if it gets it wrong.

- Detection runs on every keystroke (debounced) using a lightweight n-gram or dictionary-based detector
- Only target languages are candidates for detection (base languages are not valid input languages)
- The detected language determines which spell/grammar checker runs
- If the user switches languages mid-conversation (e.g., French one message, Hungarian the next), that's fine

## Guiding Principles

- **Don't rewrite the user's message.** We never change what they wrote. We only point out errors and ask them to fix it themselves. This is how people actually learn.
- **Casual texting is fine.** No enforcing capitalization, formal punctuation, or register. If a native speaker would type it that way in a chat, it's correct.
- **Minimize LLM calls.** Use deterministic checks first. Only call the LLM when there's something to explain.
- **The user stays in control.** They can cancel processing at any time by pressing Enter again.
- **When we do call the LLM, make it count.** Use Opus for rich, nuanced language explanations — this is a language learning app, not autocorrect.

## Flow

### 1. User presses Enter

The message stays in the input field and remains editable. Visual feedback indicates processing has begun (e.g., a subtle pulsing border or spinner). The message is NOT sent yet.

### 2. Deterministic spell/grammar check

Run a fast, local, non-LLM spelling and grammar checker against the input text in the detected target language. This happens near-instantly.

**Inline visual feedback:** errors get red squiggly underlines (spelling) and blue squiggly underlines (grammar), just like a word processor. The user can see what's wrong immediately, even before the LLM response arrives.

- **No errors found** → skip straight to step 5 (submit). No LLM call needed.
- **Errors found** → show squiggles immediately, proceed to step 3.

Tools to evaluate:
- `nspell` / hunspell dictionaries for spelling
- Language-specific grammar rules (article agreement, verb conjugation tables)
- The goal is a cheap, fast first pass — not perfection

### 3. LLM explains the errors (Opus)

Call Claude Opus with a focused prompt: "Here is a message with these specific errors [from step 2]. Explain each error in the user's base languages."

The LLM is NOT asked to rewrite or heal the message. It explains what's wrong and why — with nuance. This is the learning moment: why does French use "a" here instead of "de"? What's the etymology? What's the rule, and what are the common exceptions? Opus gives genuinely insightful language explanations that a learner will remember.

Explanations are generated in **all of the user's base languages** simultaneously. The UI shows the preferred base language by default, with a toggle to see others.

The explanations appear as hints below the input field, anchored to the squiggled words/phrases. The input remains editable so the user can fix their message.

### 4. User fixes and re-submits

The user edits their message based on the squiggles and hints, then presses Enter again. This re-triggers the pipeline from step 2.

- If the errors are fixed → step 5.
- If errors remain → step 3 again with updated squiggles and explanations.

### 5. Submit

The message is sent. On submit:

- All hints and squiggles are cleared from the input area
- The message appears in the conversation thread

Async post-send processing (does not block the UI):

- **Agent dispatch**: the message is translated to English (if needed) and forwarded to the configured agent connector (Claude, OpenClaw, HTTP). The agent's reply is stored as a message in the same conversation.
- **Translations** of both the user's message and the agent's reply into the user's target and base languages (via Google TLLM)
- **Transliterations** if a language uses non-Latin script (deterministic)
- **Phonetics** (IPA) for all language versions (deterministic where possible, Gemini fallback)
- **Vocabulary extraction** and **grammar gap tracking** (Sonnet) — feeds the spaced repetition system

Once translations arrive, they become available on the message. Base language translations are accessible but not shown by default — the user sees the message in their target language(s) first, with base language translations available on tap/click.

### Cancel: User presses Enter during processing

If the user presses Enter while we're still processing (steps 2-3), we:

1. Cancel any in-flight checks or LLM calls
2. Remove the "processing" visual state and squiggles
3. Clear any displayed hints
4. Return the input to its normal state
5. Wait for the user to submit again

## Visual Design

### Language picker (top of conversation)
- Persistent UI in the upper area of the conversation view
- Two sections: **Base languages** (languages you know) and **Target languages** (languages you're learning)
- Multi-select for both — add/remove languages at any time
- Changes apply to this conversation (different conversations can have different language configurations)

### Message input (speech bubble with two areas)

The input area is styled as a single speech bubble containing two fields separated by a thin 1px divider line:

**Main input (top)** — contenteditable, for the message in the target language
- This is the actual message that gets sent
- Squiggly underlines appear here
- Enter submits / triggers check pipeline
- Shift+Enter for newline
- Language flag indicator + dropdown on the right side

**Intent input (bottom)** — plain textarea, for explaining what you're trying to say
- Can be written in ANY language (base or target)
- Optional — can be left empty
- Placeholder: "What are you trying to say? (any language)"
- This is metadata for the AI, NOT sent as a visible message
- Passed to Opus during error explanation (helps it understand garbled attempts)
- Passed to Sonnet during post-send processing (helps vocabulary/challenge generation)
- Especially useful for beginners who can't yet express their intent in the target language

### Language indicator (next to main input)
- Flag icon + language code next to the main input (e.g., [FR flag] FR)
- Auto-updates as the user types based on language detection
- Clickable dropdown to override — only target languages are listed
- Determines which spell/grammar checker runs on submit

### Squiggly underlines (immediate, from deterministic check)
- **Red squiggle**: spelling error (unknown word, wrong accent)
- **Blue squiggle**: grammar error (agreement, conjugation, article)
- These appear instantly — no waiting for the LLM

### Hint panel (after LLM response)
- Appears below the input field
- Each hint is anchored to a specific squiggled span
- Rich explanation from Opus: not just "this is wrong" but "here's why, here's the rule, here's how to remember it"
- Explanations available in all base languages; preferred shown first, others one tap away
- Dismisses when the user fixes the error and the squiggle disappears

### Processing indicator
- Subtle pulsing border on the input field while checks are running
- Small spinner or dot animation near the send button
- Disappears when processing completes or is cancelled

### Message display
- Received messages appear in the user's target language(s) first
- Base language translations available on tap/click but not shown by default
- All language tracks (translations, transliterations, IPA) accessible via expand/toggle

## What changes from the current flow

| Current | New |
|---------|-----|
| Single base language, single target language | Multiple base languages, multiple target languages |
| Message is "healed" (rewritten) by the LLM | Message is never rewritten — user fixes it themselves |
| Single LLM call does everything | Deterministic check first, LLM only for explanation |
| Corrections shown after send | Squiggles + hints shown before send — user must fix |
| User sees "what they wrote" vs "what it should be" | User sees squiggles inline and learns why it's wrong |
| Every message triggers an LLM call | Clean messages skip the LLM entirely |
| Haiku for everything | Opus for error explanations — quality matters for learning |
| Single input field | Dual input: message + intent ("what I'm trying to say") |
| No way to explain intent | Intent field gives AI context for better help |
| No language detection | Auto-detect input language with flag indicator |
| Hints in one language | Hints in all base languages |

## LLM usage

**Error explanation (pre-send):**
- **Model**: Opus — nuanced, educational language explanations
- **Input**: the user's text, the detected errors with positions, the target language, the user's base languages, the user's CEFR level
- **Output**: for each error, a rich explanation in each base language, anchored to the error span
- **No**: healing, translation, vocabulary extraction, challenge generation

**Post-send processing (async, doesn't block):**
- Vocabulary extraction and grammar gap tracking (Sonnet — structured extraction)
- Challenge generation (Sonnet)
- Translation is handled by Google TLLM (not Claude)
- Transliteration is deterministic
- IPA is deterministic for supported languages, Gemini for others
