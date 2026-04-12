<script lang="ts">
  import { api } from "../lib/api";
  import { langTag, LANGUAGES } from "../lib/languages";
  import type { ConversationMember } from "../lib/stores.svelte";

  /** Minimal inline markdown: **bold**, *italic*, `code` */
  function renderMarkdown(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>");
  }

  interface TextError {
    start: number;
    end: number;
    text: string;
    kind: "spelling" | "grammar";
    suggestions?: string[];
  }

  interface ErrorExplanation {
    error: TextError;
    explanations: Record<string, string>;
  }

  interface Props {
    conversationId: string;
    member: ConversationMember;
    disabled?: boolean;
    onSend: (text: string, language: string, intent?: string) => void;
  }

  let {
    conversationId,
    member,
    disabled = false,
    onSend,
  }: Props = $props();

  // State
  let text = $state("");
  let checkedText = "";  // the text that was last spell-checked (not reactive)
  let intentText = $state("");
  let detectedLang = $state(member.target_languages[0]?.lang ?? "");
  // Update detected language when member changes (e.g. conversation switch)
  $effect.pre(() => {
    const lang = member.target_languages[0]?.lang;
    if (lang && lang !== detectedLang) detectedLang = lang;
  });
  let showLangDropdown = $state(false);

  type InputState = "idle" | "checking" | "squiggled" | "explained";
  let state: InputState = $state("idle");

  let errors: TextError[] = $state([]);
  let explanations: ErrorExplanation[] = $state([]);
  let additionalErrors: Array<TextError & { corrected: string; explanations: Record<string, string> }> = $state([]);
  let correctedMessage = "";  // the fully corrected message from Opus

  // Build a map from error text → corrected form (from both explanation sources)
  let correctionMap = $derived.by(() => {
    const map = new Map<string, string>();
    for (const e of explanations) {
      if (e.corrected) map.set(e.error.text.toLowerCase(), e.corrected.toLowerCase());
    }
    for (const e of additionalErrors) {
      if (e.corrected) map.set(e.text.toLowerCase(), e.corrected.toLowerCase());
    }
    return map;
  });

  // Filter out errors where the user has already typed the corrected form
  let activeErrors = $derived.by(() => {
    if (errors.length === 0 && additionalErrors.length === 0) return [];

    const currentText = text.toLowerCase();
    const active: TextError[] = [];

    for (const err of errors) {
      const corrected = correctionMap.get(err.text.toLowerCase());
      // If we know the correction, check if it appears in the text where the error was
      if (corrected && currentText.includes(corrected)) continue;
      // Also skip if the original erroneous text is no longer in the current text
      if (!currentText.includes(err.text.toLowerCase())) continue;
      active.push(err);
    }

    for (const err of additionalErrors) {
      const corrected = err.corrected?.toLowerCase();
      if (corrected && currentText.includes(corrected)) continue;
      if (!currentText.includes(err.text.toLowerCase())) continue;
      active.push(err);
    }

    return active;
  });

  // Active explanations (only for errors that haven't been fixed)
  let activeExplanations = $derived.by(() => {
    const activeTexts = new Set(activeErrors.map((e) => e.text.toLowerCase()));
    const result: Array<{ error: TextError; corrected: string; explanations: Record<string, string> }> = [];

    for (const e of explanations) {
      if (activeTexts.has(e.error.text.toLowerCase())) {
        result.push(e);
      }
    }
    for (const e of additionalErrors) {
      if (activeTexts.has(e.text.toLowerCase())) {
        result.push({
          error: { start: e.start, end: e.end, text: e.text, kind: e.kind },
          corrected: e.corrected,
          explanations: e.explanations,
        });
      }
    }

    return result.sort((a, b) => a.error.start - b.error.start);
  });

  // Refs
  let editableEl: HTMLDivElement | undefined = $state();
  let checkController: AbortController | null = null;
  let explainController: AbortController | null = null;

  // Reset state when conversation changes — track only conversationId
  let prevConvId = conversationId;
  $effect.pre(() => {
    if (conversationId === prevConvId) return;
    prevConvId = conversationId;

    checkController?.abort();
    explainController?.abort();
    checkController = null;
    explainController = null;
    text = "";
    checkedText = "";
    correctedMessage = "";
    intentText = "";
    errors = [];
    explanations = [];
    additionalErrors = [];
    state = "idle";
    requestAnimationFrame(() => {
      if (editableEl) editableEl.innerText = "";
    });
  });

  // Debounce timer for language detection
  let detectTimer: ReturnType<typeof setTimeout> | null = null;

  // Preferred base language for showing explanations
  let preferredBaseLang = $derived(member.base_languages[0] ?? "en");
  let shownBaseLang = $state("");
  $effect(() => { if (!shownBaseLang) shownBaseLang = preferredBaseLang; });

  const targetLangCodes = $derived(member.target_languages.map((t) => t.lang));

  // Build decorated HTML for the overlay
  let decoratedHtml = $derived.by(() => {
    if (activeErrors.length === 0 || !text) return escapeHtml(text);

    // Sort errors by start position
    const sorted = [...activeErrors].sort((a, b) => a.start - b.start);
    let result = "";
    let lastEnd = 0;

    for (const err of sorted) {
      if (err.start < lastEnd) continue; // skip overlapping
      result += escapeHtml(text.slice(lastEnd, err.start));
      const cls = err.kind === "spelling" ? "squiggle-spelling" : "squiggle-grammar";
      result += `<span class="${cls}">${escapeHtml(text.slice(err.start, err.end))}</span>`;
      lastEnd = err.end;
    }
    result += escapeHtml(text.slice(lastEnd));
    return result;
  });

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
  }

  function handleInput() {
    if (!editableEl) return;
    text = editableEl.innerText;

    // Errors are filtered reactively via activeErrors — no need to clear manually

    // Debounced language detection
    if (detectTimer) clearTimeout(detectTimer);
    detectTimer = setTimeout(() => {
      if (text.trim().length >= 3 && targetLangCodes.length > 1) {
        // Client-side detection using simple heuristic:
        // We'll rely on the server's detection since tinyld is server-side
        // For now, keep the current detected language
      }
    }, 300);
  }

  /** Sync text state from the contenteditable element */
  function syncText() {
    if (editableEl) {
      text = editableEl.innerText ?? "";
    }
  }

  async function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();

      // Always sync text from DOM before processing
      syncText();

      // Cancel if currently waiting for check/explain results
      if (state === "checking") {
        cancelProcessing();
        return;
      }

      if (!text.trim() || disabled) return;

      // If user's text exactly matches the LLM's corrected message, submit immediately
      if (correctedMessage && text.trim() === correctedMessage.trim()) {
        console.log("[Send] Text matches corrected message — submitting without re-check");
        submit();
        return;
      }

      // Re-check (will submit if clean, or show new errors)
      await runCheckPipeline();
    }
  }

  function cancelProcessing() {
    console.log("[Pipeline] Cancelled");
    checkController?.abort();
    explainController?.abort();
    checkController = null;
    explainController = null;
    errors = [];
    explanations = [];
    additionalErrors = [];
    state = "idle";
  }

  async function runCheckPipeline() {
    state = "checking";
    checkController = new AbortController();
    checkedText = text;
    console.log(`[SpellCheck] Checking "${text}" (lang: ${detectedLang})`);

    try {
      // Step 1: deterministic spell check (may be noop)
      const result = await api.checkMessage(conversationId, text, detectedLang);
      if (checkController?.signal.aborted) return;

      detectedLang = result.language;
      errors = result.errors;
      console.log(`[SpellCheck] Result: clean=${result.clean}, errors=${result.errors.length}, detected=${result.language}`, result.errors);

      if (result.errors.length > 0) {
        state = "squiggled";
      }

      // Step 2: always call LLM for corrections/explanations
      explainController = new AbortController();
      console.log(`[Explain] Requesting Opus review (${result.errors.length} spell error(s) to explain)`);
      try {
        const explainResult = await api.explainErrors(conversationId, {
          text,
          errors: result.errors,
          language: result.language,
          intent: intentText.trim() || undefined,
        });

        if (explainController?.signal.aborted) return;

        correctedMessage = explainResult.corrected_message ?? "";
        explanations = explainResult.explanations ?? [];
        additionalErrors = explainResult.additional_errors ?? [];
        console.log(`[Explain] Corrected: "${correctedMessage}"`);
        console.log(`[Explain] Got ${explanations.length} explanation(s), ${additionalErrors.length} additional grammar error(s)`, $state.snapshot(explanations), $state.snapshot(additionalErrors));

        // If LLM says the message is already correct, submit
        if (correctedMessage && text.trim() === correctedMessage.trim() && activeErrors.length === 0 && additionalErrors.length === 0) {
          console.log("[Explain] Message is correct — submitting");
          submit();
          return;
        }

        // If LLM found issues, show them
        if (explanations.length > 0 || additionalErrors.length > 0) {
          state = "explained";
        } else {
          // No issues found by anyone — submit
          console.log("[Explain] No issues found — submitting");
          submit();
        }
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        console.error("[Explain] Failed:", err);
        // LLM failed — if spell check was clean, submit anyway
        if (result.clean) {
          submit();
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error("Failed to check message:", err);
      submit();
    }
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;

    console.log(`[Send] Sending "${trimmed}" (lang: ${detectedLang}, intent: ${intentText.trim() || "none"})`);
    onSend(trimmed, detectedLang, intentText.trim() || undefined);

    // Clear state
    text = "";
    checkedText = "";
    correctedMessage = "";
    intentText = "";
    errors = [];
    explanations = [];
    additionalErrors = [];
    state = "idle";
    if (editableEl) editableEl.innerText = "";
  }

  function selectLanguage(lang: string) {
    detectedLang = lang;
    showLangDropdown = false;
  }

  let showProcessing = $derived(state === "checking");

  // Allow submit when all errors are fixed (activeErrors empty) even if state is squiggled/explained
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
          onclick={() => showLangDropdown = !showLangDropdown}
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
      bind:value={intentText}
      onkeydown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          syncText();
          if (text.trim() && !disabled) runCheckPipeline();
        }
      }}
    ></textarea>
  </div>

  <!-- Hint panel (explanations from Opus) -->
  {#if explanations.length > 0 || additionalErrors.length > 0}
    <div class="hint-panel">
      <div class="hint-header">
        <span class="hint-title">
          {activeExplanations.length} error{activeExplanations.length !== 1 ? "s" : ""} found
        </span>
        {#if member.base_languages.length > 1}
          <div class="base-lang-toggle">
            {#each member.base_languages as bl}
              <button
                class="base-lang-btn"
                class:active={bl === shownBaseLang}
                onclick={() => shownBaseLang = bl}
              >
                {langTag(bl)}
              </button>
            {/each}
          </div>
        {/if}
      </div>
      {#each activeExplanations as hint}
        <div class="hint-item" class:spelling={hint.error.kind === "spelling"} class:grammar={hint.error.kind === "grammar"}>
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
  {:else if state === "squiggled" && errors.length > 0}
    <div class="hint-panel loading">
      <span class="loading-dot"></span>
      Getting explanations...
    </div>
  {/if}

  <!-- Processing indicator -->
  {#if state === "checking"}
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
  }

  .hint-item:first-of-type {
    border-top: none;
  }

  .hint-word {
    font-weight: 600;
  }

  .spelling .hint-word { color: #e74c3c; }
  .grammar .hint-word { color: #4a90d9; }

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
