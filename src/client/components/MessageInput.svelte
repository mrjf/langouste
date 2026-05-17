<script module lang="ts">
  // Per-conversation unsent-draft cache. Module-scoped so a draft survives
  // switching conversations (and even a remount of this component). Entries
  // are written when leaving a conversation and cleared on successful send.
  interface DraftSnapshot {
    text: string;
    checkedText: string;
    intentText: string;
    detectedLang: string;
    state: "idle" | "checking" | "squiggled" | "explained";
    errors: unknown[];
    explanations: unknown[];
    additionalErrors: unknown[];
    correctedMessage: string;
  }
  const draftCache = new Map<string, DraftSnapshot>();

  // Conversations with a check/explain pipeline currently in flight. Used so
  // that returning to a chat whose check is still running shows its progress
  // instead of starting a duplicate run, and so an explicit cancel/resend
  // can still abort it. The pipeline keeps running across conversation
  // switches (it's pinned to its own convId) — results land in that
  // conversation's draftCache regardless of which chat is open.
  const runningChecks = new Map<string, AbortController>();
</script>

<script lang="ts">
  import { api } from "../lib/api";
  import { langTag, LANGUAGES } from "../lib/languages";
  import type { ConversationMember } from "../lib/stores.svelte";
  import { setAgentWorking } from "../lib/stores.svelte";
  import { mdInline as renderMarkdown } from "../lib/md";

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
    // conversationId is passed through so the parent always sends to the
    // chat the text was composed in, never whatever is active now.
    onSend: (
      conversationId: string,
      text: string,
      language: string,
      intent?: string,
    ) => void;
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

  // Per-error resolution status.
  //
  // An individual error is "resolved" when the user has replaced its
  // erroneous text with the suggested correction. Concretely:
  //   - If the error text is gone from the current message AND the corrected
  //     form is present → resolved.
  //   - If the entire current message matches the LLM's corrected_message
  //     (whitespace/case-normalised) → every error resolved.
  //   - Otherwise → unresolved.
  //
  // Resolved errors stay visible in the hint panel but marked done, and
  // their squiggles are dropped from the overlay.

  function isResolved(errText: string, corrected: string, currentLower: string, fullyMatched: boolean): boolean {
    if (fullyMatched) return true;
    if (!corrected) return false;
    const orig = errText.toLowerCase();
    const fix = corrected.toLowerCase();
    // Identical correction: can't tell edit state; trust "full match" path.
    if (orig === fix) return false;
    const origStill = currentLower.includes(orig);
    const fixThere = currentLower.includes(fix);
    if (origStill) return false;          // user hasn't removed the wrong text yet
    return fixThere;                       // wrong gone AND right arrived
  }

  // Build a single ordered, de-duplicated list of explanations from both
  // sources, tagged with resolution state. Used for the hint panel and to
  // derive the squiggled errors.
  interface ResolvableExplanation {
    error: TextError;
    corrected: string;
    explanations: Record<string, string>;
    resolved: boolean;
  }

  let explanationList = $derived.by<ResolvableExplanation[]>(() => {
    const currentLower = text.toLowerCase();
    const target = correctedMessage.trim().toLowerCase();
    const normCurrent = currentLower.trim().replace(/\s+/g, " ");
    const normTarget = target.replace(/\s+/g, " ");
    const fullyMatched = !!target && normCurrent === normTarget;

    const rows: ResolvableExplanation[] = [];
    const seen = new Set<string>();

    for (const e of explanations) {
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
    for (const e of additionalErrors) {
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

  // Errors still needing attention — drives the inline squiggles and the
  // "can submit?" logic. When the LLM hasn't returned a corrected form yet,
  // fall back to "is the erroneous text still in the message?" so stale
  // squiggles anchored to deleted characters don't linger.
  let activeErrors = $derived.by(() => {
    if (errors.length === 0 && additionalErrors.length === 0) return [];

    const currentLower = text.toLowerCase();
    const anyCorrectedLoaded = explanationList.some((e) => !!e.corrected);

    // Errors we have explanations for: use the resolved flag.
    const active: TextError[] = [];
    const explainedKeys = new Set(explanationList.map((e) => e.error.text.toLowerCase()));

    for (const row of explanationList) {
      if (!row.resolved) active.push(row.error);
    }

    // Raw spell-check errors without an explanation (LLM hasn't answered
    // yet): keep them visible while the erroneous text is still present.
    for (const err of errors) {
      if (explainedKeys.has(err.text.toLowerCase())) continue;
      if (anyCorrectedLoaded) continue; // partial response; don't re-add
      if (currentLower.includes(err.text.toLowerCase())) active.push(err);
    }

    return active;
  });

  // Backward-compat name for the hint panel: show ALL explanations (resolved
  // and unresolved), so the user sees what they've fixed.
  let activeExplanations = $derived(explanationList);

  // Refs
  let editableEl: HTMLDivElement | undefined = $state();
  let checkController: AbortController | null = null;
  let explainController: AbortController | null = null;

  // Snapshot the current draft into the module cache (or drop the entry if
  // there's nothing worth keeping).
  function captureDraft(convId: string) {
    if (!text.trim() && !intentText.trim()) {
      draftCache.delete(convId);
      return;
    }
    // These arrays are always replaced wholesale (never mutated in place),
    // so a shallow copy is a safe snapshot and avoids $state.snapshot().
    draftCache.set(convId, {
      text,
      checkedText,
      intentText,
      detectedLang,
      state,
      errors: [...errors],
      explanations: [...explanations],
      additionalErrors: [...additionalErrors],
      correctedMessage,
    });
  }

  // Restore a cached draft for `convId`, or reset to a clean idle editor.
  // If the draft was mid-check when we left (no results yet), re-run the
  // pipeline so the user lands back where they were.
  function restoreDraft(convId: string) {
    const d = draftCache.get(convId);
    text = d?.text ?? "";
    checkedText = d?.checkedText ?? "";
    intentText = d?.intentText ?? "";
    if (d?.detectedLang) detectedLang = d.detectedLang;
    errors = (d?.errors ?? []) as TextError[];
    explanations = (d?.explanations ?? []) as ErrorExplanation[];
    additionalErrors = (d?.additionalErrors ?? []) as typeof additionalErrors;
    correctedMessage = d?.correctedMessage ?? "";
    state = d?.state ?? "idle";

    // Re-sync the contenteditable (it isn't reactively bound to `text`).
    requestAnimationFrame(() => {
      if (editableEl) editableEl.innerText = text;
    });

    // If a pipeline is still running for this conversation, leave it be —
    // it will deliver results here via applyToConv. Only re-run when the
    // draft says "checking" but nothing is actually in flight (e.g. a
    // check that was interrupted by a reload).
    if (state === "checking" && text.trim() && !runningChecks.has(convId)) {
      runCheckPipeline();
    }
  }

  // Merge a partial draft into conversation `convId`: always update its
  // cache entry (so a later switch restores it), and if that conversation
  // is the one on screen, mirror it into the live editor state too. This
  // is how a background pipeline delivers its results to the right chat
  // whether or not the user is looking at it.
  function applyToConv(convId: string, patch: Partial<DraftSnapshot>) {
    const prev: DraftSnapshot =
      draftCache.get(convId) ??
      ({
        text,
        checkedText,
        intentText,
        detectedLang,
        state: "idle",
        errors: [],
        explanations: [],
        additionalErrors: [],
        correctedMessage: "",
      } as DraftSnapshot);
    const merged = { ...prev, ...patch };
    draftCache.set(convId, merged);

    if (convId === conversationId) {
      if (patch.text !== undefined) text = merged.text;
      if (patch.checkedText !== undefined) checkedText = merged.checkedText;
      if (patch.detectedLang !== undefined) detectedLang = merged.detectedLang;
      if (patch.state !== undefined) state = merged.state;
      if (patch.errors !== undefined) errors = merged.errors as TextError[];
      if (patch.explanations !== undefined)
        explanations = merged.explanations as ErrorExplanation[];
      if (patch.additionalErrors !== undefined)
        additionalErrors = merged.additionalErrors as typeof additionalErrors;
      if (patch.correctedMessage !== undefined)
        correctedMessage = merged.correctedMessage;
    }
  }

  // Save the outgoing draft and restore the incoming one when the
  // conversation changes. Track only conversationId. The in-flight check
  // (if any) is NOT aborted — it keeps running and writes its results into
  // its own conversation's cache via applyToConv.
  let prevConvId = conversationId;
  $effect.pre(() => {
    if (conversationId === prevConvId) return;
    const leaving = prevConvId;
    prevConvId = conversationId;

    captureDraft(leaving);
    restoreDraft(conversationId);
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
    if (e.key !== "Enter") return;

    // Shift+Enter — force submit, bypassing all checks. The agent gets the
    // user's text verbatim; the translator does its best with whatever's
    // there. This is the escape hatch when the user knows they're right or
    // doesn't want to iterate on a correction.
    if (e.shiftKey) {
      e.preventDefault();
      syncText();
      if (!text.trim() || disabled) return;
      cancelProcessing();
      submit();
      return;
    }

    // Plain Enter — run the check / explain pipeline.
    e.preventDefault();
    syncText();

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

  function cancelProcessing() {
    console.log("[Pipeline] Cancelled");
    const convId = conversationId;
    runningChecks.get(convId)?.abort();
    checkController?.abort();
    explainController?.abort();
    checkController = null;
    explainController = null;
    runningChecks.delete(convId);
    setAgentWorking(convId, false);
    // Reflect the cancel in both the live editor and the cache so a
    // switch-away/return doesn't restore a stale "checking" state.
    applyToConv(convId, {
      errors: [],
      explanations: [],
      additionalErrors: [],
      state: "idle",
    });
  }

  // Background-safe submit: sends `convId`'s composed text via onSend and
  // clears that conversation's draft, whether or not it's on screen.
  function submitConv(
    convId: string,
    convText: string,
    lang: string,
    intent: string,
  ) {
    const trimmed = convText.trim();
    if (!trimmed) return;
    console.log(`[Send] Sending "${trimmed}" (lang: ${lang}) [conv ${convId.slice(0, 8)}]`);
    onSend(convId, trimmed, lang, intent || undefined);
    draftCache.delete(convId);
    if (convId === conversationId) clearLiveState();
  }

  async function runCheckPipeline() {
    // Pin this run to the conversation + the draft it started with. The
    // pipeline keeps running across conversation switches; results are
    // delivered to `myConvId` via applyToConv (live if it's on screen,
    // otherwise into its draftCache). Only an explicit cancel/resend
    // (AbortController) stops it — switching chats does not.
    const myConvId = conversationId;
    const myText = text;
    const myIntent = intentText.trim();
    let myLang = detectedLang;
    const myController = new AbortController();
    checkController = myController;
    runningChecks.set(myConvId, myController);
    setAgentWorking(myConvId, true);
    const aborted = () => myController.signal.aborted;

    applyToConv(myConvId, { state: "checking", checkedText: myText });
    console.log(`[SpellCheck] Checking "${myText}" (lang: ${myLang}) [conv ${myConvId.slice(0, 8)}]`);

    let handedOff = false; // submitConv took ownership — don't clear working
    try {
      // Step 1: deterministic spell check (may be noop)
      const result = await api.checkMessage(myConvId, myText, myLang);
      if (aborted()) return;

      myLang = result.language;
      applyToConv(myConvId, {
        detectedLang: result.language,
        errors: [...result.errors],
        ...(result.errors.length > 0 ? { state: "squiggled" as const } : {}),
      });
      console.log(`[SpellCheck] Result: clean=${result.clean}, errors=${result.errors.length}, detected=${result.language}`);

      // Step 2: always call LLM for corrections/explanations
      const myExplain = new AbortController();
      explainController = myExplain;
      try {
        const explainResult = await api.explainErrors(myConvId, {
          text: myText,
          errors: result.errors,
          language: result.language,
          intent: myIntent || undefined,
        });

        if (aborted() || myExplain.signal.aborted) return;

        const corrected = explainResult.corrected_message ?? "";
        const expl = explainResult.explanations ?? [];
        const addl = explainResult.additional_errors ?? [];
        const activeErrCount = (result.errors as TextError[]).length;
        console.log(`[Explain] Corrected: "${corrected}" — ${expl.length} expl, ${addl.length} extra`);

        // LLM says it's already correct → send.
        if (corrected && myText.trim() === corrected.trim() && activeErrCount === 0 && addl.length === 0) {
          handedOff = true;
          submitConv(myConvId, myText, myLang, myIntent);
          return;
        }

        if (expl.length > 0 || addl.length > 0) {
          applyToConv(myConvId, {
            correctedMessage: corrected,
            explanations: [...expl],
            additionalErrors: [...addl],
            state: "explained",
          });
        } else {
          // No issues found by anyone → send.
          handedOff = true;
          submitConv(myConvId, myText, myLang, myIntent);
        }
      } catch (err: any) {
        if (err?.name === "AbortError" || aborted() || myExplain.signal.aborted) return;
        console.error("[Explain] Failed:", err);
        if (result.clean) {
          handedOff = true;
          submitConv(myConvId, myText, myLang, myIntent);
        } else {
          applyToConv(myConvId, { state: "squiggled" });
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError" || aborted()) return;
      console.error("Failed to check message:", err);
      handedOff = true;
      submitConv(myConvId, myText, myLang, myIntent);
    } finally {
      runningChecks.delete(myConvId);
      if (checkController === myController) checkController = null;
      // If we submitted, handleSend re-asserts "working" for the agent
      // phase — keep it on for a seamless indicator. Otherwise the
      // check/explain phase is over: stop the indicator.
      if (!handedOff) setAgentWorking(myConvId, false);
    }
  }

  // Reset the live editor (only valid for whatever conversation is on
  // screen). Does not touch the draftCache — callers handle that.
  function clearLiveState() {
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

  // Synchronous submit of the on-screen draft (Shift+Enter / "send anyway"
  // / matches-correction shortcut). Background pipeline sends go through
  // submitConv directly.
  function submit() {
    submitConv(conversationId, text, detectedLang, intentText.trim());
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
        if (e.key !== "Enter") return;
        if (e.shiftKey) {
          e.preventDefault();
          syncText();
          if (text.trim() && !disabled) {
            cancelProcessing();
            submit();
          }
          return;
        }
        e.preventDefault();
        syncText();
        if (text.trim() && !disabled) runCheckPipeline();
      }}
    ></textarea>
  </div>

  <!-- Hint panel (explanations from Opus). Shows all errors with resolved
       ones marked done rather than removed, so the user keeps the context. -->
  {#if explanations.length > 0 || additionalErrors.length > 0}
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
