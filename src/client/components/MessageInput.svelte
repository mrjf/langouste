<script lang="ts">
  import { langTag, LANGUAGES } from "../lib/languages";
  import { mdInline as renderMarkdown } from "../lib/md";
  import type { Chat, TextError } from "../lib/chat.svelte";

  // Pure renderer: all draft / review / send state lives on the Chat.
  interface Props {
    chat: Chat;
    disabled?: boolean;
  }
  let { chat, disabled = false }: Props = $props();

  const member = $derived(chat.member);
  const targetLangCodes = $derived(member?.target_languages.map((t) => t.lang) ?? []);
  const baseLangs = $derived(member?.base_languages ?? []);

  // Editor element. The contenteditable is not reactively bound to
  // chat.draft.text (browsers fight two-way innerText binding), so we sync
  // it: DOM → model on input, model → DOM when the chat (or its draft)
  // changes underneath us — e.g. switching conversations, or a pipeline
  // that auto-cleared the draft on send.
  let editableEl = $state<HTMLDivElement>();
  let domText = $state(""); // last value we wrote to / read from the DOM

  $effect(() => {
    const text = chat.draft.text;
    if (!editableEl) return;
    if (text !== domText) {
      editableEl.innerText = text;
      domText = text;
    }
  });

  let showLangDropdown = $state(false);
  let shownBaseLang = $state("");
  $effect(() => {
    if (!shownBaseLang && baseLangs.length) shownBaseLang = baseLangs[0];
  });

  // --- view derivations of the review state (pure) ---------------------

  function isResolved(
    errText: string,
    corrected: string,
    currentLower: string,
    fullyMatched: boolean,
  ): boolean {
    if (fullyMatched) return true;
    if (!corrected) return false;
    const orig = errText.toLowerCase();
    const fix = corrected.toLowerCase();
    if (orig === fix) return false;
    if (currentLower.includes(orig)) return false;
    return currentLower.includes(fix);
  }

  interface ResolvableExplanation {
    error: TextError;
    corrected: string;
    explanations: Record<string, string>;
    resolved: boolean;
  }

  const explanationList = $derived.by<ResolvableExplanation[]>(() => {
    const r = chat.review;
    const currentLower = chat.draft.text.toLowerCase();
    const target = r.correctedMessage.trim().toLowerCase();
    const normCurrent = currentLower.trim().replace(/\s+/g, " ");
    const normTarget = target.replace(/\s+/g, " ");
    const fullyMatched = !!target && normCurrent === normTarget;

    const rows: ResolvableExplanation[] = [];
    const seen = new Set<string>();
    for (const e of r.explanations) {
      const key = e.error.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        error: e.error,
        corrected: e.corrected,
        explanations: e.explanations,
        resolved: isResolved(e.error.text, e.corrected, currentLower, fullyMatched),
      });
    }
    for (const e of r.additionalErrors) {
      const key = e.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        error: { start: e.start, end: e.end, text: e.text, kind: e.kind },
        corrected: e.corrected,
        explanations: e.explanations,
        resolved: isResolved(e.text, e.corrected, currentLower, fullyMatched),
      });
    }
    return rows.sort((a, b) => a.error.start - b.error.start);
  });

  const activeErrors = $derived.by<TextError[]>(() => {
    const r = chat.review;
    if (r.errors.length === 0 && r.additionalErrors.length === 0) return [];
    const currentLower = chat.draft.text.toLowerCase();
    const anyCorrectedLoaded = explanationList.some((e) => !!e.corrected);
    const explainedKeys = new Set(explanationList.map((e) => e.error.text.toLowerCase()));
    const active: TextError[] = [];
    for (const row of explanationList) if (!row.resolved) active.push(row.error);
    for (const err of r.errors) {
      if (explainedKeys.has(err.text.toLowerCase())) continue;
      if (anyCorrectedLoaded) continue;
      if (currentLower.includes(err.text.toLowerCase())) active.push(err);
    }
    return active;
  });

  const activeExplanations = $derived(explanationList);

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
  }

  const decoratedHtml = $derived.by(() => {
    const text = chat.draft.text;
    if (activeErrors.length === 0 || !text) return escapeHtml(text);
    const sorted = [...activeErrors].sort((a, b) => a.start - b.start);
    let result = "";
    let lastEnd = 0;
    for (const err of sorted) {
      if (err.start < lastEnd) continue;
      result += escapeHtml(text.slice(lastEnd, err.start));
      const cls = err.kind === "spelling" ? "squiggle-spelling" : "squiggle-grammar";
      result += `<span class="${cls}">${escapeHtml(text.slice(err.start, err.end))}</span>`;
      lastEnd = err.end;
    }
    result += escapeHtml(text.slice(lastEnd));
    return result;
  });

  const detectedLang = $derived(chat.draft.lang);
  const showProcessing = $derived(chat.review.phase === "checking");

  // --- input handlers --------------------------------------------------

  function handleInput() {
    if (!editableEl) return;
    domText = editableEl.innerText;
    chat.setDraftText(domText);
  }

  function syncText() {
    if (editableEl) {
      domText = editableEl.innerText ?? "";
      chat.setDraftText(domText);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== "Enter") return;

    // Shift+Enter — force-send verbatim.
    if (e.shiftKey) {
      e.preventDefault();
      syncText();
      if (!chat.draft.text.trim() || disabled) return;
      chat.sendNow();
      return;
    }

    e.preventDefault();
    syncText();

    // Enter while a check is running cancels it.
    if (chat.review.phase === "checking") {
      chat.cancelReview();
      return;
    }
    if (!chat.draft.text.trim() || disabled) return;

    // Text already matches Opus's correction → send straight away.
    const corrected = chat.review.correctedMessage.trim();
    if (corrected && chat.draft.text.trim() === corrected) {
      chat.sendNow();
      return;
    }
    chat.runReview();
  }

  function selectLanguage(lang: string) {
    chat.setDraftLang(lang);
    showLangDropdown = false;
  }
</script>

<div class="message-input" class:processing={showProcessing}>
  <div class="input-bubble">
    <!-- Main input area with overlay -->
    <div class="main-input-area">
      <div class="input-wrapper">
        <!-- Decoration overlay (squiggly underlines) -->
        <div class="decoration-overlay" aria-hidden="true">
          {@html decoratedHtml || "&nbsp;"}
        </div>

        <!-- Editable layer -->
        <div
          class="editable"
          contenteditable="true"
          spellcheck="false"
          autocorrect="off"
          autocapitalize="off"
          bind:this={editableEl}
          oninput={handleInput}
          onkeydown={handleKeydown}
          role="textbox"
          aria-multiline="true"
          data-placeholder="Write in {langTag(detectedLang)}..."
        ></div>
      </div>

      <!-- Language indicator -->
      <div class="lang-indicator">
        <button
          class="lang-flag-btn"
          onclick={() => (showLangDropdown = !showLangDropdown)}
          disabled={targetLangCodes.length <= 1}
        >
          {langTag(detectedLang)}
        </button>
        {#if showLangDropdown && targetLangCodes.length > 1}
          <div class="lang-dropdown">
            {#each targetLangCodes as code}
              <button
                class="lang-option"
                class:active={code === detectedLang}
                onclick={() => selectLanguage(code)}
              >
                {langTag(code)} — {LANGUAGES[code]?.name ?? code}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Divider -->
    <div class="divider"></div>

    <!-- Intent input -->
    <textarea
      class="intent-input"
      placeholder="What are you trying to say? (any language)"
      rows={1}
      value={chat.draft.intent}
      oninput={(e) => chat.setDraftIntent((e.currentTarget as HTMLTextAreaElement).value)}
      onkeydown={(e) => {
        if (e.key !== "Enter") return;
        if (e.shiftKey) {
          e.preventDefault();
          syncText();
          if (chat.draft.text.trim() && !disabled) chat.sendNow();
          return;
        }
        e.preventDefault();
        syncText();
        if (chat.draft.text.trim() && !disabled) chat.runReview();
      }}
    ></textarea>
  </div>

  <!-- Hint panel (explanations from Opus). -->
  {#if chat.review.explanations.length > 0 || chat.review.additionalErrors.length > 0}
    {@const totalCount = activeExplanations.length}
    {@const resolvedCount = activeExplanations.filter((e) => e.resolved).length}
    {@const remainingCount = totalCount - resolvedCount}
    <div class="hint-panel">
      <div class="hint-header">
        <span class="hint-title">
          {#if remainingCount === 0}
            ✓ All {totalCount} error{totalCount !== 1 ? "s" : ""} fixed — press Enter to send
          {:else}
            {remainingCount} of {totalCount} error{totalCount !== 1 ? "s" : ""} remaining
          {/if}
        </span>
        {#if baseLangs.length > 1}
          <div class="base-lang-toggle">
            {#each baseLangs as bl}
              <button
                class="base-lang-btn"
                class:active={bl === shownBaseLang}
                onclick={() => (shownBaseLang = bl)}
              >
                {langTag(bl)}
              </button>
            {/each}
          </div>
        {/if}
      </div>
      {#each activeExplanations as hint}
        <div
          class="hint-item"
          class:spelling={hint.error.kind === "spelling"}
          class:grammar={hint.error.kind === "grammar"}
          class:resolved={hint.resolved}
        >
          {#if hint.resolved}
            <span class="hint-check" aria-label="Resolved">✓</span>
          {/if}
          <span class="hint-word">"{hint.error.text}"</span>
          {#if hint.corrected}
            <span class="hint-correction">&rarr; <strong>{hint.corrected}</strong></span>
          {/if}
          <div class="hint-explanation">
            {@html renderMarkdown(hint.explanations[shownBaseLang] ?? hint.explanations[Object.keys(hint.explanations)[0]] ?? "")}
          </div>
        </div>
      {/each}
    </div>
  {:else if chat.review.phase === "reviewing" && chat.review.errors.length > 0}
    <div class="hint-panel loading">
      <span class="loading-dot"></span>
      Getting explanations...
    </div>
  {/if}

  <!-- Processing indicator -->
  {#if chat.review.phase === "checking"}
    <div class="processing-indicator">
      <span class="loading-dot"></span>
      Checking...
    </div>
  {/if}
</div>

<style>
  .message-input {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .input-bubble {
    border: 1px solid var(--color-border);
    border-radius: var(--radius, 8px);
    background: var(--color-surface, white);
    overflow: hidden;
    transition: border-color 0.2s;
  }

  .message-input.processing .input-bubble {
    border-color: var(--color-primary, #4a90d9);
    animation: pulse-border 1.5s ease-in-out infinite;
  }

  @keyframes pulse-border {
    0%, 100% { border-color: var(--color-primary, #4a90d9); }
    50% { border-color: var(--color-border); }
  }

  .main-input-area {
    display: flex;
    align-items: flex-start;
    min-height: 44px;
  }

  .input-wrapper {
    flex: 1;
    position: relative;
    min-height: 44px;
  }

  .editable,
  .decoration-overlay {
    padding: 0.75rem;
    font-size: 0.95rem;
    line-height: 1.45;
    font-family: inherit;
    word-wrap: break-word;
    white-space: pre-wrap;
  }

  .editable {
    position: relative;
    z-index: 1;
    outline: none;
    min-height: 44px;
    color: var(--color-text);
    caret-color: var(--color-text);
  }

  .editable:empty::before {
    content: attr(data-placeholder);
    color: var(--color-text-light);
    opacity: 0.6;
    pointer-events: none;
  }

  .decoration-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    z-index: 2;
    color: transparent;
    /* Let underlines show through */
  }

  .decoration-overlay :global(.squiggle-spelling) {
    text-decoration: wavy underline red;
    text-decoration-skip-ink: none;
    text-underline-offset: 2px;
  }

  .decoration-overlay :global(.squiggle-grammar) {
    text-decoration: wavy underline #4a90d9;
    text-decoration-skip-ink: none;
    text-underline-offset: 2px;
  }

  .lang-indicator {
    position: relative;
    flex-shrink: 0;
    padding: 0.5rem;
  }

  .lang-flag-btn {
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 0.25rem 0.4rem;
    font-size: 0.8rem;
    color: var(--color-text-light);
    white-space: nowrap;
    cursor: pointer;
  }

  .lang-flag-btn:hover:not(:disabled) {
    background: var(--color-bg);
    border-color: var(--color-border);
  }

  .lang-flag-btn:disabled {
    cursor: default;
  }

  .lang-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 10;
    background: var(--color-surface, white);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm, 4px);
    box-shadow: var(--shadow-lg, 0 4px 12px rgba(0,0,0,0.15));
    min-width: 160px;
    overflow: hidden;
  }

  .lang-option {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.5rem 0.75rem;
    border: none;
    background: none;
    font-size: 0.85rem;
    color: var(--color-text);
    cursor: pointer;
  }

  .lang-option:hover {
    background: var(--color-bg);
  }

  .lang-option.active {
    font-weight: 600;
    color: var(--color-primary);
  }

  .divider {
    height: 1px;
    background: var(--color-border);
    margin: 0 0.75rem;
  }

  .intent-input {
    width: 100%;
    border: none;
    outline: none;
    resize: none;
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
    color: var(--color-text-light);
    background: transparent;
    font-family: inherit;
    line-height: 1.4;
  }

  .intent-input::placeholder {
    color: var(--color-text-light);
    opacity: 0.5;
  }

  /* Hint panel */
  .hint-panel {
    margin-top: 0.35rem;
    padding: 0.6rem 0.75rem;
    background: var(--color-correction, #fff8e1);
    border: 1px solid #f39c12;
    border-radius: var(--radius-sm, 4px);
    animation: slideUp 0.2s ease-out;
  }

  .hint-panel.loading {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--color-text-light);
  }

  @keyframes slideUp {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .hint-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.4rem;
  }

  .hint-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: #e67e22;
  }

  .base-lang-toggle {
    display: flex;
    gap: 0.2rem;
  }

  .base-lang-btn {
    background: none;
    border: 1px solid transparent;
    border-radius: 3px;
    padding: 0.1rem 0.3rem;
    font-size: 0.7rem;
    color: var(--color-text-light);
    cursor: pointer;
  }

  .base-lang-btn.active {
    border-color: var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
  }

  .hint-item {
    padding: 0.35rem 0;
    border-top: 1px solid rgba(243, 156, 18, 0.2);
    font-size: 0.82rem;
    transition: opacity 0.15s;
  }

  .hint-item:first-of-type {
    border-top: none;
  }

  .hint-item.resolved {
    opacity: 0.55;
  }

  .hint-item.resolved .hint-word,
  .hint-item.resolved .hint-correction {
    text-decoration: line-through;
    text-decoration-color: rgba(0, 0, 0, 0.3);
  }

  .hint-check {
    color: var(--color-success, #27ae60);
    font-weight: 700;
    margin-right: 0.25rem;
  }

  .hint-word {
    font-weight: 600;
  }

  .spelling .hint-word { color: #e74c3c; }
  .grammar .hint-word { color: #4a90d9; }

  .hint-item.resolved .hint-word {
    color: var(--color-text-light);
  }

  .hint-correction {
    color: var(--color-success, #27ae60);
    font-size: 0.82rem;
    margin-left: 0.3rem;
  }

  .hint-suggestions {
    color: var(--color-success, #27ae60);
    font-size: 0.78rem;
  }

  .hint-explanation {
    color: var(--color-text);
    margin-top: 0.15rem;
    line-height: 1.4;
  }

  /* Processing indicator */
  .processing-indicator {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0;
    font-size: 0.8rem;
    color: var(--color-text-light);
  }

  .loading-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-primary, #4a90d9);
    animation: dot-pulse 1s ease-in-out infinite;
    flex-shrink: 0;
  }

  @keyframes dot-pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
</style>
