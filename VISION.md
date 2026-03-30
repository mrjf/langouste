# Langouste: Vision & Design

## What it is

A chat app where real conversations become language lessons. You talk to people you know — friends, family, language partners — and the app quietly turns every message into a learning opportunity. Think WhatsApp, but every message you send gets polished into proper target-language text, and every message you receive arrives in the language you're learning, regardless of what language the sender typed it in.

## Core experience

### Conversations are real

You open Langouste like any messaging app. You have conversations with different people. You send messages, you receive messages, you see typing indicators and read receipts. The social layer is genuine — you're actually communicating with someone. The learning is a byproduct of communication, not the other way around.

### You write in the language you're learning

When you compose a message, you write in your target language — or try to. You can mix in your native language when you're stuck. Claude processes what you wrote and produces the correct version in your target language. You see both: what you typed, and what it should have been. The corrections are specific — not just "here's the right version" but "you used the wrong preposition because French uses 'à' with this verb, not 'de'."

### You receive in the language you're learning

Here's the key insight: it doesn't matter what language the other person typed their message in. You receive it in the language you are learning. If you're learning French and your friend is learning Japanese, they type in (rough) Japanese, and you see their message in French. They see your message in Japanese. The underlying meaning is preserved; the surface language is adapted to each learner.

### Every message exists in N languages

A single chat can have participants learning different languages. Each message exists as parallel text in every target language represented in the conversation. By default you only see the version in the language you're learning, plus hints and translations in your native language. But the full parallel text is there and can be revealed.

## The learning loop

### 1. You send a message

You type something in your target language (or a mix). Claude processes it in a single call:

- **Heals** your text into correct target-language prose
- **Identifies corrections** — what you got wrong, categorized (grammar, vocabulary, gender, prepositions, conjugation, spelling, etc.)
- **Extracts concepts** the message illustrates (grammar patterns, vocabulary, idioms, register)
- **Translates** into every other target language in the conversation
- **Generates audio** in the target language via AI TTS so you hear the correct pronunciation

You see your original text, the healed version, and the specific corrections with explanations. You hear the corrected version read aloud.

### 2. You receive a message

When a message arrives, you see it in the language you're learning. But you don't immediately get the translation. Instead:

- The message appears in your target language
- You're asked to demonstrate understanding — maybe a comprehension question, a translation challenge, a fill-in-the-blank, or identifying a key word
- Audio plays the message in the target language
- As you engage with the quiz, hints appear progressively
- Eventually the native-language translation is revealed, but only after you've made an effort

This is the "productive struggle" principle: you learn more from working to understand than from being handed the answer.

### 3. Concepts are extracted and tracked

Every message — sent and received — is parsed for the concepts it illustrates:

- **Vocabulary**: individual words and phrases, with context
- **Grammar patterns**: tense usage, agreement, word order, subordinate clauses
- **Idioms and collocations**: fixed expressions, common pairings
- **Register**: formal vs. informal, written vs. spoken
- **Pronunciation patterns**: liaison, elision, stress (tracked via audio exercises)

Each concept is linked to a CEFR level and tracked per-user, per-language.

### 4. Your learner profile evolves

For every language you're learning, Langouste maintains a profile that captures:

- **Overall CEFR level** (assessed and updated over time)
- **Concept mastery map**: for each grammar rule, vocabulary item, pronunciation pattern — how well you know it, when you last practiced it, when it's due for review
- **Error patterns**: recurring mistakes (e.g., "consistently confuses ser/estar", "drops articles before abstract nouns")
- **Strengths**: what you reliably get right
- **Pace and trajectory**: how quickly you're progressing in different areas

This profile is not a simple score. It's a detailed, structured map of your knowledge that informs every AI interaction.

### 5. Learning activities fill the gaps

Based on your profile and the spaced repetition schedule, Langouste generates targeted activities:

- **Review**: concepts you learned but are about to forget (SM-2 scheduling)
- **Remediation**: concepts you keep getting wrong, presented in new contexts
- **Reinforcement**: concepts you got right recently, appearing naturally in more complex combinations
- **Challenge**: concepts just above your current level, introduced through real message context

Activities take multiple forms:

- Translation challenges (both directions)
- Listening comprehension (audio of messages you've seen before, or new constructions with familiar vocabulary)
- Fill-in-the-blank with specific grammar targets
- Error correction (spot the mistake in a sentence)
- Free composition prompts that encourage using recently-learned patterns

Audio is integral — not an add-on. Listening and speaking are first-class learning modalities alongside reading and writing.

## Parallel text model

Every message in a conversation has the following representations:

1. **Raw text**: what the sender actually typed
2. **Healed text**: the corrected version in the sender's target language
3. **Translations**: one per additional target language in the conversation
4. **Corrections**: structured diff between raw and healed, with explanations and concept tags
5. **Concept annotations**: which grammar rules, vocabulary items, and patterns the message demonstrates
6. **Audio**: TTS rendering in each target language

A conversation with three participants learning French, Japanese, and Spanish respectively would store each message in all three languages. Each participant sees the version in their target language by default.

## Audio

Audio serves multiple purposes:

- **Message playback**: hear the correct pronunciation of every message in your target language
- **Listening exercises**: audio-first quizzes where you hear a message and must demonstrate comprehension before seeing text
- **Pronunciation reference**: for vocabulary review, hear the word or phrase in context
- **Dictation**: hear a sentence, write what you hear — tests both listening and writing

Audio is generated via AI TTS, matched to the target language and ideally to a consistent voice per conversation participant (so you associate voices with people, as in real life).

## What makes this different

Most language learning apps create artificial contexts. Duolingo gives you "the cat is on the table." Langouste gives you "hey, are we still meeting at 7? I might be late because the metro is delayed" — because that's what your friend actually said. The content is real, the motivation is real, and the learning is anchored in genuine communication.

The parallel text model means you're not limited to conversations where everyone speaks the same target language. A group chat where one person is learning French, another Mandarin, and another Arabic all works — everyone types in their target language, everyone receives in their target language, and the AI handles the translation layer invisibly.

The comprehension gate on received messages turns passive reading into active learning. You can't just glance at a translation — you have to engage with the target language first. This is uncomfortable at first and transformative over time.

The learner profile means the AI adapts. Early on, messages might be simplified or heavily hinted. As you progress, the training wheels come off. The corrections get more nuanced. The quizzes get harder. The review activities target your actual weak points, not a generic curriculum.
