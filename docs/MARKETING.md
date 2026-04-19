# Marketing & Positioning

How we talk about Langouste to the world. Honest, specific, narrow. We're not the AI language app for everyone; we're the right one for a specific audience. Own that.

## The one-sentence positioning

> Langouste is an open-source language-learning chat app where you practise with Claude Code, fix your own mistakes, and build a measurable map of what you know — running on your laptop, not in someone else's cloud.

Three things in that sentence matter:

- **Open-source**: not a gated SaaS. Users own their data, run it locally, extend it.
- **Practise with Claude Code**: specific agent, specific power — real tools, real reasoning, not a chat veneer.
- **Fix your own mistakes**: the self-correction design is our defining pedagogical choice. Lean into it in every piece of messaging.
- **Measurable map**: the dimension band vector from `docs/ONTOLOGY.md`. Proof that progress is real, not streaks on a dashboard.

## Who it's for

Three sharply-defined audiences. If the audience isn't one of these, the product probably isn't the right fit yet.

### 1. The serious adult self-learner

Thirty-something professional, already learned one foreign language to some level, picking up a second or third. Probably a tech worker. Already has an Anthropic API key. Tired of Duolingo's infantilism and the hand-holdy tutor apps.

- What they want: honest progress feedback, non-trivial content, no gamification noise.
- What they'll pay for: a working thing they run once and own.
- Where they hang out: Hacker News, /r/languagelearning (the actual hard-content subreddit, not /r/duolingo), r/anki, language-specific subs like r/learnfrench.

### 2. The polyglot hobbyist

Speaks 3+ languages to varying degrees. Runs Anki decks. Follows Luca Lampariello, Steve Kaufmann, Matt vs Japan. Views language learning as a serious long-term practice.

- What they want: tooling that respects their method — comprehensible input, SRS, interleaved practice. Not opinionated curricula.
- What they'll pay for: they'll self-host for free; tip us if they love it.
- Where they hang out: Twitter/Bluesky language learners, r/languagelearning serious threads, the Refold Discord, LanguageTransfer forums.

### 3. The tooling-curious developer

Already using Claude Code daily. Curious about chat-with-Claude-Code as a pattern. Might not be learning a language right now but will recommend the project to a friend who is, and may contribute code.

- What they want: clean architecture, plausible roadmap, MCP server surface they can build on.
- What they'll pay for: nothing. But their word-of-mouth and PRs are worth more than revenue at our scale.
- Where they hang out: Hacker News, Anthropic's developer Discord, r/ClaudeAI, GitHub trending.

Not our audience at v1: kids, classroom teachers, travellers needing a phrasebook, people who want the Duolingo feel, anyone who balks at running a CLI.

## Differentiators

What's genuinely novel vs the field (from competitive research in `docs/LEARNING-MODEL.md`'s predecessor research):

1. **Self-correction discipline.** Most apps either rewrite your message (Langua) or tell you what's wrong (Talkpal, Speak). We show you where and why, and you fix it. Pedagogically better (Lyster & Saito 2010), and it feels different.
2. **Deterministic spell-check before LLM.** nspell runs locally in ms. Most competitors fire an LLM call per keystroke to "check" — slow and expensive. Our path is snappy and cheap.
3. **Real spaced repetition.** Not streak-gamified fake SRS. SM-2 today, FSRS when review-log history supports it. Anki-grade seriousness.
4. **Dimension band vector, not a single letter.** "Your lexis is B1 but your pragmatics is still A2." Honest, specific. Competitive apps handwave a single level they can't defend.
5. **Agent-pluggable.** Claude Code, Claude API, OpenClaw, HTTP endpoint, your own MCP server. The agent is not the product — the pedagogy is. Swap the agent; the learning loop survives.
6. **MCP server surface.** Any MCP-compatible host can drive Langouste's pedagogy. This is a unique claim no competitor makes; it also doesn't matter much to audience 1 or 2 but is catnip for audience 3.
7. **Open source.** We're the only production-ish chat-with-AI app in the space that's MIT/Apache open source. That's a category-defining position.
8. **Runs locally.** Not a claim most competitors can make. Plays well with audiences 1 and 2's privacy instincts.

What we are *not* better at:

- **Voice UX** (Speak wins).
- **Scale** (Duolingo has 80M monthly users; we have 5).
- **Curriculum** (Pimsleur and structured courses beat us for learners who want a path).
- **Content richness** (no stories, no podcasts, no human tutor fallback).

Don't overclaim. Every time we've been caught overselling, we lose a serious user for good.

## Messaging pillars

When writing copy, lean on one of these four. Don't mix.

1. **Honest progress.** "See what you actually know, across seven dimensions, backed by your own messages." Target: audiences 1 and 2.
2. **Real conversation.** "Chat with Claude Code in your target language about whatever you want. Reviews come from what you actually said." Target: audience 1.
3. **Open and local.** "Your data on your machine. Your Anthropic key, your cost. Fork it if you need to." Target: audiences 2 and 3.
4. **Pedagogy that holds up.** "Self-correction, spaced repetition, comprehensible-input-aware replies. The learning model is documented and evidence-based." Target: audience 2, and anyone who's skeptical.

## What NOT to claim

- Never "CEFR-certified" or "assessed by certified testers." We estimate; we don't certify.
- Never "proven to improve fluency." No RCT has been run. We can say "based on a pedagogy informed by X, Y, Z" — never "proven."
- Never "fluent in X weeks." Unethical and untrue.
- Never hide our model costs. The API spend is the user's; be transparent.
- Never fake users or testimonials.

## Channels for launch

Ordered by effort and likely reward.

### 1. Launch post on Hacker News (low effort, high variance)

Title: "Langouste — open source AI language-learning chat, powered by Claude Code"

Post content:
- 1 paragraph: what it is and who it's for.
- 1 paragraph: what's novel (the self-correction + ontology + local angle).
- 1 paragraph: what it isn't (honest about limits).
- Link to repo + to a 2-min demo video + to `docs/ONTOLOGY.md` for the curious.

Launch Tuesday–Thursday, 7–9 a.m. PT. Brace for negative comments; respond technically, never defensively.

### 2. r/languagelearning (medium effort, high reward if done right)

That subreddit has a self-promotion rule. Post as "made this, wanted to share, would love your brutal feedback on the pedagogy." Include the eval-harness dashboard. Engage every substantive comment personally for 48 h.

### 3. Dev-focused channels (low effort, builds audience 3)

- Anthropic's developer Discord: "new MCP server surface" angle.
- Post in appropriate channels about the Claude Code integration as the example user-facing product.
- Tweet/Bluesky thread: architecture walkthrough.

### 4. Language-influencer outreach (high effort, high reward)

Write personalised messages to 5–10 serious language-learning content creators (not the flashy YouTube ones — the ones who actually care about method). Offer them a free-forever self-hosted install and ask for honest public feedback. Expect 1–2 to engage.

### 5. Blog posts (sustained effort, long tail)

One per month, each with a concrete technical or pedagogical hook:

- "Why we use self-correction instead of recasts" (pedagogy citation post).
- "Building an MCP server that teaches Claude Code about your vocabulary" (developer post).
- "Claude Code as a language tutor: what the SDK gets right" (developer post).
- "The CEFR band vector: honest progress tracking" (pedagogy post).
- "Adding a new language to Langouste" (contributor onboarding post).

Publish on a project blog. Syndicate to HN if high-value.

## Pricing

At v1: free, OSS, self-hosted. User pays their own Anthropic tokens.

Optional future: hosted tier for users who don't want to self-host. Priced around $10–15/mo plus token pass-through. Don't launch this until we have 500+ active self-hosters and know what we'd be selling.

## Privacy position

Critical for audience 1 and 2. Must be explicit.

```
- Your messages stay on your machine (self-hosted) or in your Supabase
  instance (hosted). We never send them anywhere except Anthropic's API
  to get completions, and they're subject to Anthropic's data policy.
- No analytics by default. Optional PostHog opt-in with redacted data
  for us to improve the app. Off unless you flip it.
- No accounts required for self-hosted mode.
- Export your data at any time: `langouste export` produces SQL + JSON.
- Delete your data: `langouste delete-me` removes everything locally.
```

This goes on the landing page, in the repo README, and in a dedicated `PRIVACY.md`.

## The landing page

One page. Above-the-fold:

- Headline: the one-sentence positioning.
- Sub-head: "For serious learners who want a real tool, not a game."
- 30-second demo video (autoplay, muted).
- Two CTAs: "Install (Docker)" and "Download Desktop App."

Below:

- The four pillars as feature blocks with a concrete screenshot each.
- The dimension band vector explained with a sample radar chart.
- "Who it's for" with explicit "not for" section (audiences 1 + 2 see themselves; audience we don't want self-selects out).
- Pedagogy credentials: link to `docs/LEARNING-MODEL.md`, `docs/ONTOLOGY.md`, `docs/TESTING.md`. Most visitors won't read them; the handful who do will be our most valuable users.
- Honest disclaimers (no certification, no fluency claims).
- GitHub star count, last release date, contributor count. Prove we're alive.

No testimonials at v1 (we don't have real ones). No pricing (it's free). No mailing list (maybe a blog RSS).

## Sustaining attention

Monthly release cadence visible. Monthly blog post. Respond to every GitHub issue within 72 h. Keep the Discord low-volume but actually staffed.

The steady-state metric: GitHub stars are vanity; issues opened and contributors merged are the real ones. If a release cycle goes by without an external PR merged, something's wrong with the onboarding.

## What we stop doing if it's not working

Every quarter, review:

- If the HN launch bombed, skip to 3/4/5 and grind.
- If audience 1 isn't showing up, the onboarding is too developer-heavy. Invest in the desktop app polish.
- If audience 3 isn't showing up, the MCP story isn't told loudly enough. Invest in the architecture posts.
- If eval scores are slipping, ship nothing user-facing until they're back up.

Signal over noise. An honest "we have 30 daily users and they love us" beats a viral launch that dies in three weeks.
