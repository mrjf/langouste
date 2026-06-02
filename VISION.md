# Langouste: Vision & Design

## What it is

A language-learning product where real communication and real content become lessons. The v1 surface is chat: you chat with Claude — or any connected agent — in the language you're learning, and the app quietly turns every exchange into a learning opportunity. The broader product direction is the same loop applied to real media: podcasts, YouTube videos, tutorial platforms, partner lessons, and other native-language content where every word and phrase can be explained in context.

Think of it as WhatsApp with an AI on the other side that happens to be fluent in every language, and a learning coach watching over your shoulder.

## Core experience

### You chat with agents

You open Langouste like a messaging app. You configure one or more agents — a Claude model, a local OpenClaw gateway, or any HTTP endpoint — and start a conversation. The social layer is a real back-and-forth chat; the learning is a byproduct of communication, not the other way around.

### You write in the language you're learning

When you compose a message, you write in your target language — or try to. You can mix in your native language when you're stuck. Claude processes what you wrote and points out what's wrong. You see your own text with the errors highlighted; you fix it yourself before sending. The corrections are specific — not just "here's the right version" but "you used the wrong preposition because French uses 'à' with this verb, not 'de'."

### You receive in the language you're learning

The agent's replies are translated into the language you're learning. You see them in your target language first, with your base-language translation available on tap but not shown by default. You're asked to engage with the target-language version before the crutch of a translation appears.

### Every message exists in multiple languages

Each message — yours and the agent's — is stored as parallel text in your target and base languages. Audio, IPA, and transliteration layers are generated alongside. You pick what you see; everything else is there when you want it.

### You learn from real content

Chat is the first surface, not the whole product. Langouste should also become an annotated media reader/player for content learners already want to understand: podcast episodes, YouTube videos, specialized tutorial platforms, course clips, and later other media providers. The strategic version is partnership-led by language: find the best native or instructional content providers for French, Spanish, Hungarian, Japanese, and so on, then make their material deeply learnable rather than replacing it with generated filler.

### Every word and phrase is explainable

The reading/listening surface should support inline help without forcing the learner out of context. A learner can hover or tap a word for a word-level gloss, a phrase for a phrase-level translation, or see both together: word translation above the text and phrase translation below it. Another possible interaction is positional hover: hovering near the top of a text span shows the word-level translation; hovering near the bottom shows the phrase-level translation.

## The learning loop

### 1. You send a message

You type something in your target language (or a mix). Before anything is sent, the app processes it:

- **Deterministic spell/grammar check** (nspell + language-specific rules) runs instantly and surfaces red/blue squiggles inline
- If errors were found, **Claude Opus explains each one** in your base language — rich, nuanced explanations anchored to the squiggled spans
- You **fix your own message** and press Enter again
- Once clean, the message is sent as-is — we never rewrite what you wrote

### 2. The agent replies

Your message is forwarded to the configured agent (translated to English if the agent expects it). The agent's response comes back and is translated into your target and base languages. You see the target-language version first.

### 3. Concepts are extracted and tracked

Every message — yours and the agent's — is parsed for the concepts it illustrates:

- **Vocabulary**: individual words and phrases, with context
- **Grammar patterns**: tense usage, agreement, word order, subordinate clauses
- **Idioms and collocations**: fixed expressions, common pairings
- **Register**: formal vs. informal, written vs. spoken
- **Pronunciation patterns**: liaison, elision, stress (tracked via audio)

Each concept is linked to a CEFR level and tracked per-user, per-language.

### 4. Your learner profile evolves

For every language you're learning, Langouste maintains a profile:

- **Overall CEFR level** (assessed and updated over time)
- **Concept mastery map**: for each grammar rule, vocabulary item, and pronunciation pattern — how well you know it, when you last practiced it, when it's due for review
- **Encounter history**: words, phrases, grammar patterns, and pronunciation features you've seen in chat, media transcripts, lessons, and references
- **Content progress**: episodes, videos, tutorials, passages, or assigned materials started, completed, and revisited
- **Error patterns**: recurring mistakes (e.g., "consistently confuses ser/estar")
- **Strengths**: what you reliably get right
- **Pace and trajectory**: how quickly you're progressing

This profile informs every AI interaction.

### 5. Learning activities fill the gaps

Based on your profile and SM-2 spaced-repetition scheduling, Langouste surfaces targeted activities:

- **Review**: concepts about to be forgotten
- **Remediation**: concepts you keep getting wrong, re-presented in new contexts
- **Reinforcement**: recent wins, re-appearing in more complex combinations
- **Challenge**: concepts just above your current level, introduced through real message context

Activity forms include translation challenges, listening comprehension, fill-in-the-blank, error correction, and free composition prompts.

## Parallel text and annotation model

Every message in a conversation, transcript segment, tutorial passage, or classroom assignment has the following representations:

1. **Raw text**: what the sender actually typed (or the agent generated)
2. **Translations**: one per language relevant to the user (target + base)
3. **Corrections**: structured diff between raw and corrected, with explanations and concept tags
4. **Concept annotations**: which grammar rules, vocabulary items, and patterns the message demonstrates
5. **Transliterations**: for non-Latin scripts
6. **Phonetics (IPA)**: for pronunciation reference
7. **Audio**: TTS in the target language
8. **Source anchors**: message IDs, transcript timestamps, lesson offsets, or external content references

The core technical primitive is not a single parse tree. It is annotated text: a source string plus many labeled spans anchored by character offsets. Spans can overlap, nest, or cross because natural language layers do not form one clean hierarchy.

Possible layers:

- word boundaries
- phrase boundaries
- sentence boundaries
- translation spans
- grammar annotations
- vocabulary metadata
- pronunciation notes
- transcript timestamps
- classroom assignment markers
- other linguistic features

That span model is what powers hover translation, correction squiggles, phrase explanations, vocabulary tracking, grammar tracking, transcript alignment, and later content-player/classroom views.

## Agent connectors

Langouste is agent-agnostic. Out of the box it supports:

- **Claude** via the Anthropic API — pick any model, optional system prompt
- **OpenClaw** — a local WebSocket gateway for running agents on your machine
- **HTTP** — any endpoint that accepts a message and returns a response

Adding a new connector is a small amount of code — implement the `AgentConnection` interface in `src/services/agents/`.

## What makes this different

Most language apps create artificial contexts. Duolingo gives you "the cat is on the table." Langouste gives you real conversations with agents that can talk about anything — your commute, your hobbies, a thing you read yesterday — and grows toward real media from excellent content providers. The content is whatever you want it to be, the motivation is genuine curiosity, and the learning is anchored in communication and comprehension.

The comprehension gate on received messages turns passive reading into active learning. You can't just glance at a translation — you have to engage with the target language first. Uncomfortable at first, transformative over time.

The learner profile means the AI adapts. Early on, explanations are generous and challenges are small. As you progress, the training wheels come off. The corrections get more nuanced. The quizzes get harder. The review activities target your actual weak points, not a generic curriculum.

Long-term, the product sits between a language-learning app, annotated media player, linguistic analysis tool, classroom adjunct, and content-partnership platform. The useful framing is: learn languages from real media, with every word and phrase explainable in context.
