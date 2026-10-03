<script lang="ts">
  import { chatStore } from "../lib/chat.svelte";
  import { LANGUAGES, langName, langTag } from "../lib/languages";
  import {
    buildParallelSentences,
    parallelReaderLanguages,
  } from "../lib/parallel-reader";

  let activeIndex = $state(0);
  let appliedConversationId = "";
  let wheelDelta = 0;
  let wheelLockedUntil = 0;
  let pointerStart: { x: number; y: number } | null = null;

  const readerChat = $derived(chatStore.active ?? chatStore.list[0] ?? null);
  const languages = $derived.by(() =>
    parallelReaderLanguages(readerChat?.member, readerChat?.messages ?? []),
  );
  const sentences = $derived.by(() =>
    buildParallelSentences(readerChat?.messages ?? [], languages),
  );
  const partnerName = $derived(readerChat?.conversation?.agent_connector?.name ?? "Agent");
  const targetLanguages = $derived(
    new Set(readerChat?.member?.target_languages.map((language) => language.lang) ?? []),
  );
  const sentenceNumber = $derived(sentences.length === 0 ? 0 : activeIndex + 1);

  $effect(() => {
    const chat = readerChat;
    if (!chat) return;
    void chat.load();
    if (chat.id !== appliedConversationId) {
      appliedConversationId = chat.id;
      activeIndex = 0;
    }
  });

  $effect(() => {
    if (sentences.length === 0) {
      activeIndex = 0;
    } else if (activeIndex >= sentences.length) {
      activeIndex = sentences.length - 1;
    }
  });

  function selectConversation(event: Event) {
    chatStore.setActive((event.currentTarget as HTMLSelectElement).value);
  }

  function goTo(index: number) {
    if (sentences.length === 0) return;
    activeIndex = Math.max(0, Math.min(index, sentences.length - 1));
  }

  function moveBy(amount: number) {
    goTo(activeIndex + amount);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) {
      event.preventDefault();
      moveBy(1);
      return;
    }
    if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
      event.preventDefault();
      moveBy(-1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      goTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      goTo(sentences.length - 1);
    }
  }

  function wheelNavigation(node: HTMLElement) {
    function handleWheel(event: WheelEvent) {
      if (sentences.length < 2) return;
      event.preventDefault();

      const dominantDelta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const now = performance.now();
      if (now < wheelLockedUntil) {
        wheelDelta = 0;
        return;
      }

      wheelDelta += dominantDelta;
      if (Math.abs(wheelDelta) < 24) return;

      moveBy(wheelDelta > 0 ? 1 : -1);
      wheelDelta = 0;
      wheelLockedUntil = now + 340;
    }

    node.addEventListener("wheel", handleWheel, { passive: false });
    return {
      destroy() {
        node.removeEventListener("wheel", handleWheel);
      },
    };
  }

  function handlePointerDown(event: PointerEvent) {
    if (event.pointerType === "mouse") return;
    pointerStart = { x: event.clientX, y: event.clientY };
  }

  function handlePointerUp(event: PointerEvent) {
    if (!pointerStart) return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    pointerStart = null;
    const distance = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    if (Math.abs(distance) < 42) return;
    moveBy(distance < 0 ? 1 : -1);
  }

  function languageRole(language: string): string {
    if (targetLanguages.has(language)) return "Target";
    if (readerChat?.member?.base_languages.includes(language)) return "Base";
    return "Translation";
  }

  function textDirection(language: string): "rtl" | "ltr" {
    return language === "ar" || language === "he" ? "rtl" : "ltr";
  }

  function sentenceAuthor(isAgent: boolean): string {
    return isAgent ? partnerName : "You";
  }
</script>

<section class="reader-shell">
  <header class="reader-header">
    <div class="reader-title">
      <span class="eyebrow">Parallel reader</span>
      <h1>Read one thought in every language.</h1>
    </div>

    {#if readerChat}
      <label class="conversation-picker">
        <span>Conversation</span>
        <select value={readerChat.id} onchange={selectConversation}>
          {#each chatStore.list as chat (chat.id)}
            <option value={chat.id}>
              {chat.conversation?.agent_connector?.name ?? "Agent"} · {langTag(chat.member?.target_languages?.[0]?.lang ?? "")}
            </option>
          {/each}
        </select>
      </label>
    {/if}
  </header>

  {#if !readerChat}
    <div class="reader-empty">
      <span class="empty-index">00</span>
      <h2>Your parallel reader starts with a conversation.</h2>
      <p>Begin a chat, then return here to read it sentence by sentence in every configured language.</p>
      <a href="#/connections">Set up a connection</a>
    </div>
  {:else if sentences.length === 0}
    <div class="reader-empty">
      <span class="empty-index">01</span>
      <h2>There is nothing to read yet.</h2>
      <p>Send a few messages in this conversation. Their language versions will line up here automatically.</p>
      <a href={`#/c/${readerChat.id.slice(0, 8)}`}>Open conversation</a>
    </div>
  {:else}
    <div class="reader-context">
      <div class="context-copy">
        <span class="context-kicker">Conversation with {partnerName}</span>
        <span class="language-summary">
          {languages.length} {languages.length === 1 ? "language" : "languages"} · {sentences.length} {sentences.length === 1 ? "sentence" : "sentences"}
        </span>
      </div>
      <div class="position" aria-live="polite">
        <span>{String(sentenceNumber).padStart(2, "0")}</span>
        <span class="position-divider">/</span>
        <span>{String(sentences.length).padStart(2, "0")}</span>
      </div>
    </div>

    <div
      class="reader-stage"
      role="slider"
      aria-label="Aligned parallel sentences"
      aria-valuemin="1"
      aria-valuemax={sentences.length}
      aria-valuenow={sentenceNumber}
      aria-valuetext={`Sentence ${sentenceNumber} of ${sentences.length}. Scroll, swipe, or use the arrow keys to move every language together.`}
      tabindex="0"
      use:wheelNavigation
      onkeydown={handleKeydown}
      onpointerdown={handlePointerDown}
      onpointerup={handlePointerUp}
      onpointercancel={() => (pointerStart = null)}
    >
      <div class="language-rows">
        {#each languages as language, languageIndex (language)}
          <section class="language-row" aria-labelledby={`reader-language-${language}`}>
            <header class="language-label">
              <span class="language-order">{String(languageIndex + 1).padStart(2, "0")}</span>
              <span class="language-code" id={`reader-language-${language}`}>{langTag(language)}</span>
              <span class="language-name">{langName(language)}</span>
              <span class="language-role">{languageRole(language)}</span>
            </header>

            <div class="sentence-rail">
              {#each sentences as sentence, sentenceIndex (sentence.id)}
                {@const text = sentence.texts[language]}
                <article
                  class="sentence-card"
                  class:active={sentenceIndex === activeIndex}
                  aria-hidden={sentenceIndex !== activeIndex}
                  style={`--sentence-offset: ${sentenceIndex - activeIndex}`}
                  dir={textDirection(language)}
                  lang={language}
                >
                  <p class:missing={!text}>
                    {text || "No separate sentence in this language"}
                  </p>
                  <span class="sentence-source">{sentenceAuthor(sentence.isAgent)}</span>
                </article>
              {/each}
            </div>
          </section>
        {/each}
      </div>

      <span class="scroll-cue" aria-hidden="true">Scroll to continue ↓</span>
    </div>

    <footer class="reader-controls">
      <button
        class="step-button"
        aria-label="Previous sentence"
        disabled={activeIndex === 0}
        onclick={() => moveBy(-1)}
      >
        <span aria-hidden="true">←</span>
        <span>Previous</span>
      </button>

      <label class="progress-control">
        <span class="sr-only">Sentence {sentenceNumber} of {sentences.length}</span>
        <input
          type="range"
          min="1"
          max={sentences.length}
          value={sentenceNumber}
          aria-label="Choose sentence"
          oninput={(event) => goTo(Number((event.currentTarget as HTMLInputElement).value) - 1)}
        />
        <span class="progress-caption">All languages move together</span>
      </label>

      <button
        class="step-button next"
        aria-label="Next sentence"
        disabled={activeIndex === sentences.length - 1}
        onclick={() => moveBy(1)}
      >
        <span>Next</span>
        <span aria-hidden="true">→</span>
      </button>
    </footer>
  {/if}
</section>

<style>
  .reader-shell {
    --reader-paper: #f7f4ed;
    --reader-ink: #201e1a;
    --reader-rule: rgba(32, 30, 26, 0.16);
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    background:
      linear-gradient(rgba(32, 30, 26, 0.025) 1px, transparent 1px),
      var(--reader-paper);
    background-size: 100% 2rem;
    color: var(--reader-ink);
  }

  .reader-header {
    min-height: 7.5rem;
    padding: var(--space-5) clamp(1.5rem, 4vw, 4rem);
    border-bottom: 1px solid var(--reader-rule);
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-6);
    background: color-mix(in srgb, var(--reader-paper) 94%, white);
  }

  .reader-title {
    display: grid;
    gap: var(--space-2);
  }

  .eyebrow,
  .conversation-picker > span,
  .context-kicker,
  .language-order,
  .language-role,
  .sentence-source,
  .progress-caption,
  .scroll-cue {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .eyebrow,
  .context-kicker,
  .language-order {
    color: var(--color-accent);
  }

  h1 {
    max-width: 42rem;
    font-family: Georgia, "Times New Roman", serif;
    font-size: clamp(1.55rem, 3vw, 2.55rem);
    font-weight: 400;
    line-height: 1.05;
    letter-spacing: -0.025em;
  }

  .conversation-picker {
    display: grid;
    gap: var(--space-2);
    min-width: min(18rem, 42vw);
    color: var(--color-text-muted);
  }

  .conversation-picker select {
    width: 100%;
    min-height: 2.5rem;
    padding: 0 2.25rem 0 var(--space-3);
    border: 1px solid var(--reader-rule);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--reader-ink);
    font-size: var(--text-sm);
  }

  .reader-context {
    padding: var(--space-4) clamp(1.5rem, 4vw, 4rem);
    border-bottom: 1px solid var(--reader-rule);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .context-copy {
    display: grid;
    gap: var(--space-1);
  }

  .language-summary {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }

  .position {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-md);
  }

  .position span:first-child {
    color: var(--color-accent);
    font-size: var(--text-xl);
  }

  .position-divider {
    color: var(--color-text-subtle);
  }

  .reader-stage {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    touch-action: pan-x;
  }

  .reader-stage:focus-visible {
    outline-offset: -3px;
  }

  .language-rows {
    height: 100%;
    overflow-y: auto;
    display: grid;
    grid-auto-rows: minmax(8.5rem, 1fr);
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }

  .language-row {
    display: grid;
    grid-template-columns: clamp(8rem, 17vw, 12rem) minmax(0, 1fr);
    min-height: 0;
    border-bottom: 1px solid var(--reader-rule);
  }

  .language-label {
    padding: var(--space-5) var(--space-4) var(--space-5) clamp(1.5rem, 4vw, 4rem);
    border-right: 1px solid var(--reader-rule);
    display: grid;
    align-content: center;
    gap: var(--space-1);
    background: rgba(255, 255, 255, 0.26);
  }

  .language-code {
    font-size: var(--text-md);
    font-weight: var(--font-medium);
  }

  .language-name {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }

  .language-role {
    margin-top: var(--space-2);
    color: var(--color-text-subtle);
  }

  .sentence-rail {
    position: relative;
    min-width: 0;
    min-height: 8.5rem;
    overflow: hidden;
  }

  .sentence-card {
    position: absolute;
    inset: 0;
    padding: clamp(1.5rem, 4vw, 3.5rem) clamp(1.5rem, 5vw, 5rem);
    display: grid;
    align-content: center;
    gap: var(--space-3);
    opacity: 0;
    pointer-events: none;
    transform: translate3d(calc(var(--sentence-offset) * 100%), 0, 0);
    transition:
      transform 420ms cubic-bezier(0.22, 1, 0.36, 1),
      opacity 220ms ease;
  }

  .sentence-card.active {
    opacity: 1;
    pointer-events: auto;
  }

  .sentence-card p {
    max-width: 64rem;
    font-family: Georgia, "Times New Roman", serif;
    font-size: clamp(1.25rem, 2.25vw, 2rem);
    line-height: 1.42;
    letter-spacing: -0.012em;
  }

  .sentence-card p.missing {
    color: var(--color-text-subtle);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-style: italic;
  }

  .sentence-source {
    color: var(--color-text-subtle);
  }

  .scroll-cue {
    position: absolute;
    right: clamp(1.5rem, 4vw, 4rem);
    bottom: var(--space-3);
    color: var(--color-text-subtle);
    pointer-events: none;
  }

  .reader-controls {
    min-height: 4.5rem;
    padding: var(--space-3) clamp(1.5rem, 4vw, 4rem);
    border-top: 1px solid var(--reader-rule);
    display: grid;
    grid-template-columns: auto minmax(10rem, 1fr) auto;
    align-items: center;
    gap: clamp(1rem, 3vw, 3rem);
    background: color-mix(in srgb, var(--reader-paper) 96%, white);
  }

  .step-button {
    min-height: 2.5rem;
    padding: 0 var(--space-3);
    border: 1px solid var(--reader-rule);
    border-radius: var(--radius-sm);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    background: transparent;
    color: var(--reader-ink);
    font-size: var(--text-xs);
  }

  .step-button:hover:not(:disabled) {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }

  .step-button:disabled {
    cursor: default;
    opacity: 0.32;
  }

  .progress-control {
    display: grid;
    gap: var(--space-1);
    text-align: center;
  }

  .progress-control input {
    width: 100%;
    height: 1rem;
    accent-color: var(--color-accent);
    cursor: pointer;
  }

  .progress-caption {
    color: var(--color-text-subtle);
  }

  .reader-empty {
    flex: 1;
    padding: clamp(2rem, 8vw, 7rem);
    display: grid;
    place-content: center;
    justify-items: start;
    gap: var(--space-4);
  }

  .empty-index {
    color: var(--color-accent);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .reader-empty h2 {
    max-width: 36rem;
    font-family: Georgia, "Times New Roman", serif;
    font-size: clamp(1.6rem, 4vw, 2.6rem);
    font-weight: 400;
    line-height: 1.1;
  }

  .reader-empty p {
    max-width: 34rem;
    color: var(--color-text-muted);
    line-height: 1.6;
  }

  .reader-empty a {
    padding-bottom: var(--space-1);
    border-bottom: 1px solid var(--color-accent);
    color: var(--color-accent);
    font-size: var(--text-sm);
    text-decoration: none;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (max-width: 760px) {
    .reader-header {
      min-height: auto;
      align-items: stretch;
      flex-direction: column;
      gap: var(--space-4);
    }

    .conversation-picker {
      min-width: 0;
    }

    .language-row {
      grid-template-columns: 7.25rem minmax(0, 1fr);
      min-height: 9rem;
    }

    .language-label {
      padding: var(--space-4);
    }

    .sentence-card {
      padding: var(--space-5);
    }

    .sentence-card p {
      font-size: clamp(1.05rem, 5vw, 1.45rem);
    }

    .scroll-cue,
    .progress-caption,
    .step-button span:not([aria-hidden="true"]) {
      display: none;
    }

    .reader-controls {
      grid-template-columns: 2.5rem minmax(8rem, 1fr) 2.5rem;
      gap: var(--space-3);
    }

    .step-button {
      justify-content: center;
      padding: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sentence-card {
      transition: none;
    }
  }
</style>
