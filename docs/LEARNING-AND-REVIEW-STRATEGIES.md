# Learning and Review Strategies

How Langouste should incorporate mastery learning, "superlearning" ideas, and the habits of high-performing language learners into the product.

This document is a research-to-product brief. `docs/LEARNING-MODEL.md` remains the implementation source of truth for event tracking, SRS, CEFR estimates, and correction behavior. The purpose here is to define the learning strategy Langouste should optimize toward before individual features are specified.

## Executive summary

The useful synthesis is:

1. **Mastery learning supplies the control loop.** Break language ability into small skills, diagnose the learner's current state, set a clear mastery threshold, give corrective support, retest, and only then raise difficulty. In Langouste, this means no review item, grammar gap, or conversation challenge should exist without a measurable mastery state.
2. **Spaced retrieval supplies the memory engine.** Learners should repeatedly retrieve words, phrases, grammar patterns, sounds, and discourse moves after increasing delays. Passive rereading is not enough. Review should be production-first whenever possible.
3. **Interleaving supplies transfer.** Language use is mixed by nature. Review should not isolate "French articles day" or "all Hungarian greetings"; it should mix vocabulary, grammar, listening, spelling, and production prompts so learners practice choosing the right form under realistic ambiguity.
4. **Comprehensible, meaningful input supplies volume.** The learner needs a large amount of target-language input that is mostly understandable, emotionally tolerable, and tied to goals they care about.
5. **Output and feedback turn exposure into skill.** High-performing learners do not only consume content. They speak, write, get corrected, notice gaps, and try again.
6. **"Superlearning" should be treated skeptically.** Suggestopedia / superlearning claims about dramatic acceleration are weakly replicated, but some design ingredients are useful: relaxed focus, high confidence, music or ambience as optional ritual, playful role-play, and low shame around errors.
7. **Super learners are self-regulated.** They set goals, choose resources, monitor errors, adjust strategy, seek interaction, and keep going for enough hours. Langouste should make those behaviors easy and visible.

## Evidence map

### Mastery learning

Benjamin Bloom's original mastery-learning frame argues that most learners can master a subject if instruction adapts quality, clarity, perseverance, and time allowed for learning. The important product translation is not "everyone learns at the same pace"; it is "fixed outcome, variable path."

Modern evidence is positive but context-sensitive. The Education Endowment Foundation summarizes mastery learning as moderate impact for very low cost, with limited evidence strength. It emphasizes clear objectives, diagnostic assessment, high mastery thresholds around 80-90%, regular feedback, and extra support for learners who struggle. A 1990 meta-analysis of 108 controlled evaluations found positive effects on examination performance and attitudes, but noted higher time-on-task and weaker completion rates in some self-paced college formats.

Product implication: mastery loops should be small, guided, and socially/agent-supported. Langouste should not become an endless self-paced course where learners silently grind modules.

### Spacing and retrieval

Spacing and retrieval practice are among the strongest general learning findings. A 2022 review in *Nature Reviews Psychology* highlights spacing, retrieval, and metacognition as central strategies that are effective but underused. A 2021 classroom-focused systematic review screened nearly 2,000 abstracts, coded 50 experiments, and found that most yielded medium or large benefits from retrieval practice across varied settings.

Product implication: Langouste should avoid "review by exposure only." Encounters are valuable, but recall and production events must drive memory scheduling.

### Language-learning balance

Paul Nation's Four Strands gives a practical language-specific balance:

- meaning-focused input: listening and reading for meaning;
- meaning-focused output: speaking and writing for meaning;
- language-focused learning: deliberate attention to form, including spelling, pronunciation, vocabulary, grammar, and discourse;
- fluency development: faster use of already-known language.

The exact 25/25/25/25 split should be treated as a course-design heuristic, not a rigid app rule. But the taxonomy is useful because many language apps over-index on deliberate vocabulary review and under-index on meaning-focused output and fluency.

Product implication: every learning week should contain all four strands. The app should detect missing strands and nudge the learner toward them.

### Interaction, feedback, and noticing

Second-language acquisition research on interaction and corrective feedback supports the idea that feedback helps because it makes learners notice forms they otherwise miss. Mackey's work connects interactional feedback, learner noticing, and L2 development; broader interaction research emphasizes that feedback is one of the manipulable conditions under which interaction benefits instructed SLA.

Product implication: Langouste's existing "do not rewrite the message; prompt self-correction" principle is correct. The product should make errors noticeable, explainable, and retryable without humiliating or interrupting the learner more than necessary.

### Superlearning / Suggestopedia

Suggestopedia and later "superlearning" systems emphasize relaxed alertness, positive suggestion, music, role-play, and a confident classroom atmosphere. The strong acceleration claims are not a reliable foundation: EBSCO's overview notes that many Lozanov claims were not replicated and that researchers question the method's validity. It also notes that some components may still be useful: role playing, games, relaxation, and attention to emotion.

Product implication: do not promise miraculous learning speed. Use the low-anxiety, playful, ritualized parts as optional experience design around evidence-backed practice.

### Language super learners

The "good language learner" and self-regulated learning literature consistently points to active, strategic behavior rather than a secret method. A 2022 scoping review of self-directed mobile language learning found cognitive, metacognitive, social, and affective strategies. It also found that learners often underuse full self-reflection loops.

Product implication: Langouste should externalize the metacognitive loop: plan, practice, monitor, reflect, adjust. The learner should not need to be a productivity expert to behave like a strong autonomous learner.

## Strategy for Langouste

### 1. Use mastery loops around atomic concepts

Every tracked item should belong to one or more atomic concepts:

- lexical item: `aller`, `jo napot`, `fauché`;
- lexical chunk: `je viens de`, `jó napot kívánok`;
- morphology: plural agreement, verb tense formation;
- syntax: adjective placement, auxiliary choice;
- orthography: accents, spelling alternations;
- phonology: sound discrimination and pronunciation;
- discourse/pragmatics: register, turn-taking, politeness, fillers.

Each concept needs a state:

- `unseen`: no reliable encounter;
- `seen`: encountered in meaningful input;
- `noticed`: clicked, corrected, asked about, or explained;
- `practiced`: produced with support or in a controlled task;
- `retrievable`: recalled or produced correctly under review;
- `fluent`: used correctly in conversation without visible effort across multiple contexts;
- `fragile`: recently failed after prior success;
- `stale`: not reviewed or produced for a long interval.

Mastery should require more than one clean answer. A practical threshold:

- vocabulary recognition mastery: 2 correct recognitions across 2 days;
- vocabulary production mastery: 2 correct productions or recalls across 3+ days;
- grammar concept mastery: 3 correct productions across at least 2 contexts;
- pronunciation mastery: 2 acceptable productions plus 1 perception check;
- fluency mastery: timed task completed with known material and low hesitation/error rate.

### 2. Gate progression by confidence, not by content completion

Do not unlock harder content simply because the learner has seen enough material. Unlock it when evidence says the relevant prerequisites are stable.

For generated chat and reading:

- If mastery confidence is high, increase lexical rarity, sentence length, discourse complexity, or idiomaticity.
- If confidence is low, keep topic interest high but simplify the linguistic surface.
- If a prerequisite repeatedly fails, insert a short repair loop before continuing.

This avoids the common app failure where learners "complete" lessons but cannot produce the language in conversation.

### 3. Turn every chat into a micro-cycle

Langouste's core chat loop should implement mastery learning in miniature:

1. **Attempt:** learner writes in the target language.
2. **Diagnose:** deterministic checker and AI explanation identify errors.
3. **Support:** explanation, examples, reference links, and optional hints.
4. **Retry:** learner fixes the message themselves.
5. **Record:** production, self-correction, and concept events are logged.
6. **Stretch:** agent reply includes mostly known language plus one or more targeted stretch concepts.
7. **Comprehension check:** lightweight prompt confirms understanding.
8. **Schedule:** fragile concepts move into review; stable concepts wait.

This is mastery learning without making chat feel like a course.

### 4. Build review as mixed retrieval, not flashcard replay

Review sessions should mix prompt types:

- L2 -> L1 recognition;
- L1 -> L2 production;
- cloze in a sentence;
- correct-the-error;
- choose between confusable forms;
- dictation / accent spelling;
- listen and identify;
- speak and compare;
- fast fluency drill with already-known items;
- short contextual writing prompt using 2-4 target concepts.

Use FSRS or the current scheduler to select due concepts, but use a prompt generator to choose the form of practice. The same concept should rotate through recognition, production, context, and fluency surfaces.

Default proportions for a 10-item review:

- 4 production prompts;
- 2 recognition/comprehension prompts;
- 2 grammar or error-correction prompts;
- 1 listening/pronunciation prompt where supported;
- 1 fluency prompt using already-known material.

For beginners, recognition can be higher. For intermediate learners, production and fluency should dominate.

### 5. Separate acquisition review from fluency practice

SRS optimizes retention of fragile items. Fluency requires fast, low-friction reuse of material that is already mostly known.

Langouste should offer two different review modes:

- **Recall review:** due items, desirable difficulty, slower, error-aware, scheduler-driven.
- **Fluency sprint:** familiar items, timed, high success rate, minimal interruption, speed and smoothness tracked.

Fluency sprint examples:

- 4-3-2 style retell: describe the same idea in 4 minutes, then 3, then 2.
- rapid substitution: "I went / she went / we went / they went."
- chat replay: rewrite yesterday's message faster and cleaner.
- shadowing: listen, repeat, compare rhythm and pronunciation.

The product should not punish mistakes in fluency mode as harshly as recall review. Fluency mode is for automaticity.

### 6. Use "superlearning" as affective scaffolding

Useful parts to incorporate:

- let users choose a focus ritual: quiet, music, cafe noise, Pomodoro, or no ritual;
- use role-play agents to lower social pressure and make repetition meaningful;
- keep correction tone calm and specific;
- celebrate successful self-correction as a learning behavior, while still recording it as a failed cold production;
- make short sessions feel complete: 5-minute repair loop, 10-minute review, 15-minute conversation;
- reduce fear of speaking through private rehearsal before conversation.

Parts to reject:

- claims of 10x or 1000% learning without evidence;
- passive audio absorption as a primary method;
- "no effort required" framing;
- music as a memory mechanism required by the system;
- fixed scripts that ignore diagnosis and retrieval.

Product copy should say "faster because you practice the right thing at the right time," not "effortless superlearning."

### 7. Make the learner self-regulated by default

Strong language learners plan, monitor, and adapt. Langouste should provide that loop automatically.

Weekly learning plan:

- one conversation goal;
- one input goal;
- one review goal;
- one fluency goal;
- one weak-point repair goal.

Daily session close:

- "What improved today?"
- "What failed cold?"
- "What should appear tomorrow?"

Dashboard signals:

- concepts mastered this week;
- concepts fragile;
- review debt;
- input/output balance;
- correction patterns;
- most common L1-interference pattern;
- next recommended action.

The recommendation engine should not only say "review due." It should say:

- "You are over-reviewing vocabulary and under-producing."
- "You have seen these 12 words often but never used them."
- "Your article errors are clustered around gender, not pluralization."
- "Do a fluency sprint; your recall is good but production is slow."

### 8. Use polyglot-style sentence mining carefully

High-performing independent learners often mine useful phrases from media and conversation, but raw sentence mining creates bloated decks. Langouste should mine selectively.

Promote a sentence or phrase when:

- it appeared in a meaningful chat or user-selected media;
- it contains exactly one main stretch item;
- it is reusable for the user's goals;
- it is short enough to review;
- the user clicked, asked, failed, or marked it as interesting.

Do not promote every unknown word. Most unknowns should remain encounters until they repeat or become personally useful.

Card shape:

- front: communicative task, not isolated word;
- back: target phrase, translation, explanation, and source sentence;
- follow-up: production prompt in a new context.

Example:

- Prompt: "Tell a friend you have just arrived."
- Target: `Je viens d'arriver.`
- Follow-up: "Now say: she has just left."

### 9. Treat errors as curriculum

The user's own mistakes are the highest-value learning material because they reveal attempted production under pressure.

Error patterns should generate:

- immediate self-correction hints;
- scheduled repair prompts;
- contrastive examples;
- reference links;
- agent stretch examples in later replies;
- dashboard-level pattern summaries.

Use a priority score:

```
priority =
  recent_failed_productions * 3
  + self_corrections * 2
  + comprehension_failures
  + user_marked_importance * 3
  - stable_successes * 2
```

Concepts above a threshold enter review or repair. Concepts below it stay in passive tracking.

### 10. Add desirable difficulty without breaking conversation

Desirable difficulty means the task is hard enough to require retrieval, but not so hard that the learner disengages.

Controls:

- delay translation reveal until effort;
- ask for a quick paraphrase before showing full L1;
- mix confusable forms in review;
- use cloze prompts before multiple choice;
- ask learners to produce from intent rather than copy a model;
- increase spacing after success;
- interleave old and new material.

Safety rails:

- keep chat replies mostly comprehensible;
- cap new concepts per explanation;
- avoid piling several grammar gaps into one correction;
- provide hints after repeated failure;
- let the learner skip a review item without shame, but log it.

## Suggested product features

### Mastery map

A per-language map showing concept states by dimension:

- vocabulary;
- chunks;
- grammar;
- spelling/orthography;
- pronunciation;
- discourse/pragmatics;
- fluency.

The map should show "ready to stretch," "fragile," and "stale" rather than just percent complete.

### Repair queue

A short queue of the learner's highest-value weak points, generated from actual chat errors and review misses.

Each repair card should include:

- the original learner attempt;
- the corrected target form;
- one short explanation;
- one contrastive example;
- one production retry;
- one later scheduled review.

### Review mixer

A scheduler-backed review screen that selects due concepts, then interleaves prompt types. The UI should label the action, not the pedagogy:

- "Say it"
- "Fix it"
- "Hear it"
- "Use it"
- "Choose it"

### Fluency sprint

A separate timed mode for already-known material. Track:

- words per minute or characters per minute;
- hesitation count where available;
- error rate;
- repeated-task improvement;
- comfort rating.

### Strategy coach

A lightweight weekly planner that detects imbalance across Nation's Four Strands:

- too little input;
- too little output;
- too much isolated review;
- low fluency practice;
- repeated errors without repair.

The coach should give one next action, not a long report.

### Confidence rituals

Optional experience features inspired by the useful side of superlearning:

- start-session ambience;
- low-stakes role-play scenarios;
- private rehearsal before sending;
- agent personas that match user interests;
- post-session reflection framed around progress and next action.

These should never replace retrieval, production, or feedback.

## Review policy

### What gets scheduled

Schedule when there is evidence of learning need:

- failed production;
- self-correction;
- failed recall;
- repeated encounter plus user interaction;
- user save/bookmark;
- concept needed for an active goal;
- prerequisite for upcoming content.

Do not schedule:

- every word in an agent reply;
- items seen once with no interaction;
- rare words unrelated to user goals;
- concepts far above the learner's current level unless user-marked.

### When to review

Use FSRS/SM-2-style scheduling for explicit recall, but add short-term repair:

- immediate retry after explanation;
- same-session contrastive prompt after a miss;
- next-day repair for repeated cold-production failures;
- long-term spacing after successful recall.

### How to score

Use outcome-specific scoring:

- cold correct production: strong positive;
- correct after hint: weak positive for exposure, not mastery;
- self-corrected before send: failed cold production, strong learning signal;
- recognition correct: moderate positive;
- production wrong but meaning clear: partial;
- repeated failure: repair priority increases, review interval shortens;
- skip: no mastery credit, may lower confidence if repeated.

### When to retire or demote

Retire a concept from frequent review when:

- it is produced correctly in chat multiple times;
- it is recalled correctly across spaced intervals;
- it appears in fluency mode with low hesitation;
- it has no recent errors.

Demote from active review to passive monitoring when:

- it is low-value for the user's goals;
- it causes review overload;
- the learner repeatedly skips it;
- it is too advanced for current prerequisites.

## Metrics

Track these to test whether the strategy works:

- 7-day and 30-day retention by concept type;
- cold-production success rate;
- self-correction success rate;
- repeated-error decay after repair;
- review burden per retained item;
- percentage of reviews that are production prompts;
- input/output/fluency/language-focus balance;
- learner return rate after correction-heavy sessions;
- comprehension-check pass rate;
- number of user-authored messages per active week;
- CEFR band movement with confidence intervals.

The key product metric should not be "cards reviewed." It should be "concepts correctly used in meaningful communication after spacing."

## Implementation notes

1. Add concept-state rollups on top of the existing `review_log` and `concept_srs` model.
2. Add prompt-type metadata to review events so recognition, production, cloze, listening, and fluency can be analyzed separately.
3. Add a repair queue service that ranks concepts from failed productions, self-corrections, review misses, and goal relevance.
4. Add a weekly strand-balance computation from learning events:
   - input = encounters and comprehension checks;
   - output = user-authored messages and production tasks;
   - language focus = corrections, explanations, explicit grammar/vocab work;
   - fluency = timed known-material practice.
5. Keep mastery thresholds configurable by language, level, and concept type.
6. A/B test thresholds and prompt mixes. Do not assume the first ratios are correct.

## Research references

- Agarwal, P. K., Nunes, L. D., & Blunt, J. R. (2021). "Retrieval Practice Consistently Benefits Student Learning: a Systematic Review of Applied Research in Schools and Classrooms." *Educational Psychology Review*. https://link.springer.com/article/10.1007/s10648-021-09595-9
- Bloom, B. S. (1968). "Learning for Mastery." https://www.uky.edu/~gmswan3/EDC608/Bloom_1968.pdf
- Carpenter, S. K., Pan, S. C., & Butler, A. C. (2022). "The science of effective learning with spacing and retrieval practice." *Nature Reviews Psychology*. https://www.nature.com/articles/s44159-022-00089-1
- Education Endowment Foundation. "Mastery learning." https://educationendowmentfoundation.org.uk/education-evidence/teaching-learning-toolkit/mastery-learning
- EBSCO Research Starters. "Suggestopedia." https://www.ebsco.com/research-starters/social-sciences-and-humanities/suggestopedia
- Guskey, T. R. (2010). "Lessons of Mastery Learning." https://uknowledge.uky.edu/edp_facpub/14/
- Kulik, C.-L. C., Kulik, J. A., & Bangert-Drowns, R. L. (1990). "Effectiveness of Mastery Learning Programs: A Meta-Analysis." *Review of Educational Research*. https://journals.sagepub.com/doi/abs/10.3102/00346543060002265
- Lai, Y., Saab, N., & Admiraal, W. (2022). "Learning Strategies in Self-directed Language Learning Using Mobile Technology in Higher Education: A Systematic Scoping Review." *Education and Information Technologies*. https://link.springer.com/article/10.1007/s10639-022-10945-5
- Mackey, A. (2006). "Feedback, Noticing and Instructed Second Language Learning." *Applied Linguistics*. https://doi.org/10.1093/applin/ami051
- Nation, P., & Yamamoto, A. (2012). "Applying the Four Strands to Language Learning." https://docslib.org/doc/7222/four-strands-to-language-learning
- Saez, N., & Segovia, R. (2013). "Input, interaction, and corrective feedback in L2 learning." *Studies in Applied Linguistics and TESOL*. https://journals.library.columbia.edu/index.php/SALT/article/view/1353
