<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import type { FiloDocumentJson } from "filo";
  import { isCurrent, playExclusive, stopCurrent } from "../lib/audio-player";
  import type { DictionaryLookupResponse as DictionaryLookup } from "../lib/api-contracts";
  import DictionaryPopover from "./DictionaryPopover.svelte";
  import {
    NEWS_LANGUAGE_OPTIONS,
    type AlignedToken,
    type ProfilePersistence,
    type ReadingDocumentMetadata,
    type ReadingInteractionRequest,
  } from "../../types/news";
  import { fetchDictionary, fetchSentenceAudio, recordReadingInteraction } from "../lib/news-api";
  import { dictionaryUrl, rowsFromDocument, workbenchUrl } from "../lib/news-reading";
  import type { NewsReaderViewState as ReaderViewState } from "../lib/news-route";

  interface Props {
    document: FiloDocumentJson<ReadingDocumentMetadata>;
    persistence?: ProfilePersistence;
    cacheHit?: boolean;
    state: ReaderViewState;
    onstatechange: (state: ReaderViewState) => void;
    onback: () => void;
  }

  type HoverMode = "none" | "word" | "sentence";
  interface SentenceAudioState {
    loading: boolean;
    playing: boolean;
    error: string;
    url?: string;
    audioId?: string;
    audio?: HTMLAudioElement;
  }

  interface ActiveWord {
    key: string;
    term: string;
    language: string;
    sentenceOrdinal: number;
    tokenOrdinal: number;
  }

  let {
    document,
    persistence,
    cacheHit = false,
    state: viewState,
    onstatechange,
    onback,
  }: Props = $props();
  let showBase = $state(false);
  let selectedOrdinal = $state(0);
  let selectedLanguage = $state("");
  let hoverMode = $state<HoverMode>("none");
  let hoveredSentence = $state<number | null>(null);
  let hoveredSourceWords = $state<number[]>([]);
  let hoveredOrigin = $state("");
  let activeWord = $state<ActiveWord | null>(null);
  let pinnedWordKey = $state<string | null>(null);
  let dictionaryLookups = $state<Record<string, DictionaryLookup | null>>({});
  let dictionaryLoading = $state<Record<string, boolean>>({});
  let dictionaryErrors = $state<Record<string, string>>({});
  let audioByKey = $state<Record<string, SentenceAudioState>>({});
  let activeWordAnchor = $state<HTMLElement | null>(null);
  let dictionaryHideTimer: ReturnType<typeof setTimeout> | null = null;
  const dictionaryCache = new Map<string, Promise<DictionaryLookup>>();
  const completedDictionaryKeys = new Set<string>();
  const trackedInteractions = new Set<string>();
  let currentAudioKey = "";
  let currentAudio: HTMLAudioElement | null = null;
  let restoreWordSequence = 0;
  let wheelDelta = 0;
  let wheelLockedUntil = 0;
  let pointerStart: { x: number; y: number } | null = null;

  const rows = $derived(rowsFromDocument(document));
  const selectedRow = $derived(rows.find((row) => row.ordinal === selectedOrdinal) ?? rows[0]);
  const selectedRowIndex = $derived(
    Math.max(0, rows.findIndex((row) => row.ordinal === selectedRow?.ordinal)),
  );
  const selectedCell = $derived(selectedRow?.languages[selectedLanguage]);
  const selectedLanguageOption = $derived(languageFor(selectedLanguage));

  $effect(() => {
    if (!document.metadata.languages.includes(selectedLanguage)) {
      selectedLanguage = document.metadata.languages[0] ?? "hu";
    }
  });

  $effect(() => {
    const next = viewState;
    untrack(() => applyReaderState(next));
  });

  function languageFor(code: string) {
    return NEWS_LANGUAGE_OPTIONS.find((language) => language.code === code);
  }

  function inspect(ordinal: number, language: string, track = true): void {
    if (track && pinnedWordKey) closeWord(false);
    selectedOrdinal = ordinal;
    selectedLanguage = language;
    if (track) {
      saveInteraction({ eventType: "sentence_inspected", language, sentenceOrdinal: ordinal });
      publishReaderState();
    }
  }

  function toggleBase(): void {
    showBase = !showBase;
    publishReaderState();
  }

  function publishReaderState(wordOrdinal?: number): void {
    onstatechange({
      sentenceOrdinal: selectedOrdinal,
      language: selectedLanguage,
      showBase,
      ...(wordOrdinal === undefined ? {} : { wordOrdinal }),
    });
  }

  function applyReaderState(next: ReaderViewState): void {
    showBase = next.showBase;
    selectedOrdinal = rows.some((row) => row.ordinal === next.sentenceOrdinal)
      ? next.sentenceOrdinal
      : rows[0]?.ordinal ?? 0;
    selectedLanguage = document.metadata.languages.includes(next.language)
      ? next.language
      : document.metadata.languages[0] ?? "hu";

    if (next.wordOrdinal === undefined) {
      restoreWordSequence += 1;
      if (pinnedWordKey) closeWord(false);
      return;
    }
    const expectedKey = `${selectedLanguage}:${selectedOrdinal}:${next.wordOrdinal}`;
    if (pinnedWordKey === expectedKey && activeWord?.key === expectedKey) return;
    const sequence = ++restoreWordSequence;
    void restoreWord(next.wordOrdinal, sequence);
  }

  function goToSentence(index: number): void {
    const nextRow = rows[Math.max(0, Math.min(index, rows.length - 1))];
    if (!nextRow || nextRow.ordinal === selectedOrdinal) return;
    if (pinnedWordKey) closeWord(false);
    clearHover();
    selectedOrdinal = nextRow.ordinal;
    saveInteraction({
      eventType: "sentence_inspected",
      language: selectedLanguage,
      sentenceOrdinal: nextRow.ordinal,
    });
    publishReaderState();
  }

  function moveSentence(amount: number): void {
    goToSentence(selectedRowIndex + amount);
  }

  function handleReaderKeydown(event: KeyboardEvent): void {
    if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) {
      event.preventDefault();
      moveSentence(1);
      return;
    }
    if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
      event.preventDefault();
      moveSentence(-1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      goToSentence(0);
    } else if (event.key === "End") {
      event.preventDefault();
      goToSentence(rows.length - 1);
    }
  }

  function readerNavigation(node: HTMLElement) {
    function handleWheel(event: WheelEvent): void {
      if (rows.length < 2) return;
      event.preventDefault();
      const now = performance.now();
      if (now < wheelLockedUntil) {
        wheelDelta = 0;
        return;
      }

      const dominantDelta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      wheelDelta += dominantDelta;
      if (Math.abs(wheelDelta) < 24) return;

      moveSentence(wheelDelta > 0 ? 1 : -1);
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

  function handleReaderPointerDown(event: PointerEvent): void {
    if (event.pointerType === "mouse") return;
    pointerStart = { x: event.clientX, y: event.clientY };
  }

  function handleReaderPointerUp(event: PointerEvent): void {
    if (!pointerStart) return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    pointerStart = null;
    const distance = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    if (Math.abs(distance) < 42) return;
    moveSentence(distance < 0 ? 1 : -1);
  }

  async function restoreWord(wordOrdinal: number, sequence: number): Promise<void> {
    await tick();
    if (sequence !== restoreWordSequence) return;
    const row = rows.find((candidate) => candidate.ordinal === selectedOrdinal);
    const token = row?.languages[selectedLanguage]?.tokens.find(
      (candidate) => candidate.ordinal === wordOrdinal,
    );
    const anchor = globalThis.document.querySelector<HTMLElement>(
      `article[data-sentence-ordinal="${selectedOrdinal}"] .sentence-cell[data-language="${selectedLanguage}"] [data-token-ordinal="${wordOrdinal}"]`,
    );
    if (!token?.wordLike || !anchor || sequence !== restoreWordSequence) {
      closeWord(false);
      return;
    }
    pinnedWordKey = wordInstanceKey(selectedOrdinal, selectedLanguage, token);
    await showWord(selectedOrdinal, selectedLanguage, token, anchor, true, false, false);
  }

  function wordInstanceKey(sentenceOrdinal: number, language: string, token: AlignedToken): string {
    return `${language}:${sentenceOrdinal}:${token.ordinal}`;
  }

  function dictionaryKey(term: string, language: string): string {
    return `${language}:${term.toLocaleLowerCase(language)}`;
  }

  function showSentence(sentenceOrdinal: number, language: string): void {
    hoverMode = "sentence";
    hoveredSentence = sentenceOrdinal;
    hoveredSourceWords = [];
    hoveredOrigin = "";
    inspect(sentenceOrdinal, language, false);
    saveInteraction({
      eventType: "sentence_hovered",
      language,
      sentenceOrdinal,
    });
  }

  function sentencePointer(
    event: PointerEvent,
    sentenceOrdinal: number,
    language: string,
    tokens: AlignedToken[],
  ): void {
    const cell = event.currentTarget as HTMLElement;
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-token-ordinal]")
      : null;
    if (target && cell.contains(target) && tokens[Number(target.dataset.tokenOrdinal)]?.wordLike) return;
    showSentence(sentenceOrdinal, language);
  }

  function clearHover(): void {
    if (pinnedWordKey) return;
    hoverMode = "none";
    hoveredSentence = null;
    hoveredSourceWords = [];
    hoveredOrigin = "";
  }

  function seededDictionaryLookup(
    sentenceOrdinal: number,
    language: string,
    token: AlignedToken,
  ): DictionaryLookup | null {
    const row = rows.find((candidate) => candidate.ordinal === sentenceOrdinal);
    const cell = row?.languages[language];
    const normalized = token.text.toLocaleLowerCase(language);
    const item = cell?.vocabulary.find(
      (candidate) => candidate.term.toLocaleLowerCase(language) === normalized,
    );
    const alignedGloss = token.sourceWordOrdinals
      .map((ordinal) => row?.sourceWords[ordinal])
      .filter((word): word is string => !!word)
      .join(" ");
    if (!item && !alignedGloss) return null;
    const meaning = item?.meaning ?? alignedGloss;
    return {
      term: token.text,
      language,
      source: null,
      source_term: item?.term ?? token.text,
      source_url: null,
      target_source_url: null,
      form_description: null,
      definitions: [meaning],
      senses: item?.partOfSpeech
        ? [{ part_of_speech: item.partOfSpeech, definition: meaning, examples: [] }]
        : [],
    };
  }

  function hasDictionaryEntry(lookup: DictionaryLookup | null | undefined): boolean {
    return !!lookup && ((lookup.senses?.length ?? 0) > 0 || (lookup.definitions?.length ?? 0) > 0);
  }

  async function showWord(
    sentenceOrdinal: number,
    language: string,
    token: AlignedToken,
    anchor: HTMLElement,
    pin = false,
    publish = pin,
    track = true,
  ): Promise<void> {
    if (!token.wordLike || (!pin && pinnedWordKey && pinnedWordKey !== wordInstanceKey(sentenceOrdinal, language, token))) {
      return;
    }
    keepWordOpen();
    const key = wordInstanceKey(sentenceOrdinal, language, token);
    const lookupKey = dictionaryKey(token.text, language);
    activeWord = {
      key,
      term: token.text,
      language,
      sentenceOrdinal,
      tokenOrdinal: token.ordinal,
    };
    activeWordAnchor = anchor;
    hoverMode = "word";
    hoveredSentence = sentenceOrdinal;
    hoveredSourceWords = token.sourceWordOrdinals;
    hoveredOrigin = key;
    if (pin) {
      selectedOrdinal = sentenceOrdinal;
      selectedLanguage = language;
      if (publish) publishReaderState(token.ordinal);
    }
    if (track) {
      saveInteraction({
        eventType: "word_hovered",
        language,
        sentenceOrdinal,
        tokenOrdinal: token.ordinal,
      });
    }

    const seeded = seededDictionaryLookup(sentenceOrdinal, language, token);
    if (!dictionaryLookups[lookupKey] && seeded) {
      dictionaryLookups = { ...dictionaryLookups, [lookupKey]: seeded };
    }
    if (dictionaryLoading[lookupKey] || completedDictionaryKeys.has(lookupKey)) return;

    dictionaryLoading = { ...dictionaryLoading, [lookupKey]: true };
    dictionaryErrors = { ...dictionaryErrors, [lookupKey]: "" };
    try {
      const pending = dictionaryCache.get(lookupKey) ?? fetchDictionary(token.text, language);
      dictionaryCache.set(lookupKey, pending);
      const lookup = await pending;
      completedDictionaryKeys.add(lookupKey);
      if (hasDictionaryEntry(lookup) || !hasDictionaryEntry(dictionaryLookups[lookupKey])) {
        dictionaryLookups = { ...dictionaryLookups, [lookupKey]: lookup };
      }
    } catch (error) {
      dictionaryCache.delete(lookupKey);
      dictionaryErrors = {
        ...dictionaryErrors,
        [lookupKey]: hasDictionaryEntry(dictionaryLookups[lookupKey])
          ? ""
          : error instanceof Error ? error.message : String(error),
      };
    } finally {
      dictionaryLoading = { ...dictionaryLoading, [lookupKey]: false };
    }
  }

  function wordPointer(
    event: PointerEvent | FocusEvent,
    sentenceOrdinal: number,
    language: string,
    token: AlignedToken,
  ): void {
    const anchor = event.currentTarget;
    if (anchor instanceof HTMLElement) void showWord(sentenceOrdinal, language, token, anchor);
  }

  function toggleWord(
    event: MouseEvent,
    sentenceOrdinal: number,
    language: string,
    token: AlignedToken,
  ): void {
    event.stopPropagation();
    const key = wordInstanceKey(sentenceOrdinal, language, token);
    if (pinnedWordKey === key) {
      closeWord();
      return;
    }
    pinnedWordKey = key;
    const anchor = event.currentTarget;
    if (anchor instanceof HTMLElement) void showWord(sentenceOrdinal, language, token, anchor, true, true);
  }

  function hideWordSoon(key: string): void {
    if (pinnedWordKey === key) return;
    if (dictionaryHideTimer) clearTimeout(dictionaryHideTimer);
    dictionaryHideTimer = setTimeout(() => {
      if (activeWord?.key === key) closeWord();
      dictionaryHideTimer = null;
    }, 350);
  }

  function keepWordOpen(): void {
    if (!dictionaryHideTimer) return;
    clearTimeout(dictionaryHideTimer);
    dictionaryHideTimer = null;
  }

  function closeWord(publish = true): void {
    keepWordOpen();
    const wasPinned = pinnedWordKey !== null;
    pinnedWordKey = null;
    activeWord = null;
    activeWordAnchor = null;
    if (hoverMode === "word") clearHover();
    if (publish && wasPinned) publishReaderState();
  }

  function closeWordFromWindow(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest("[data-dictionary-interactive]")) {
      return;
    }
    if (pinnedWordKey) closeWord();
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") closeWord();
  }

  function tokenHighlighted(
    sentenceOrdinal: number,
    language: string,
    token: AlignedToken,
  ): boolean {
    if (hoverMode !== "word" || hoveredSentence !== sentenceOrdinal || !token.wordLike) return false;
    if (`${language}:${sentenceOrdinal}:${token.ordinal}` === hoveredOrigin) return true;
    return token.sourceWordOrdinals.some((ordinal) => hoveredSourceWords.includes(ordinal));
  }

  function sentenceAudioKey(ordinal: number, language: string): string {
    return `${ordinal}:${language}`;
  }

  function audioState(ordinal: number, language: string): SentenceAudioState | undefined {
    return audioByKey[sentenceAudioKey(ordinal, language)];
  }

  function audioLabel(ordinal: number, language: string): string {
    const state = audioState(ordinal, language);
    const languageName = languageFor(language)?.name ?? language;
    const prefix = state?.loading ? "Generating" : state?.playing ? "Stop" : state?.error ? "Retry" : "Play";
    return `${prefix} ${languageName} sentence ${ordinal + 1}`;
  }

  function setAudioState(key: string, patch: Partial<SentenceAudioState>): void {
    const previous = audioByKey[key];
    audioByKey = {
      ...audioByKey,
      [key]: {
        loading: patch.loading ?? previous?.loading ?? false,
        playing: patch.playing ?? previous?.playing ?? false,
        error: patch.error ?? previous?.error ?? "",
        ...(patch.url ?? previous?.url ? { url: patch.url ?? previous?.url } : {}),
        ...(patch.audioId ?? previous?.audioId ? { audioId: patch.audioId ?? previous?.audioId } : {}),
        ...(patch.audio ?? previous?.audio ? { audio: patch.audio ?? previous?.audio } : {}),
      },
    };
  }

  function stopCurrentAudio(): void {
    if (!currentAudio) return;
    const audio = currentAudio;
    const key = currentAudioKey;
    if (isCurrent(audio)) stopCurrent();
    else audio.pause();
    audio.currentTime = 0;
    if (key) setAudioState(key, { playing: false });
    if (currentAudio === audio) currentAudio = null;
    if (currentAudioKey === key) currentAudioKey = "";
  }

  async function loadWordAudio(term: string, language: string): Promise<string> {
    return (await fetchSentenceAudio(term, language)).url;
  }

  async function toggleSentenceAudio(ordinal: number, language: string, text: string): Promise<void> {
    const key = sentenceAudioKey(ordinal, language);
    const current = audioByKey[key];
    if (current?.loading) return;
    if (current?.playing && current.audio === currentAudio) {
      stopCurrentAudio();
      return;
    }

    stopCurrentAudio();
    setAudioState(key, { loading: true, playing: false, error: "" });
    try {
      let url = current?.url;
      let audioId = current?.audioId;
      if (!url) {
        const asset = await fetchSentenceAudio(text, language);
        url = asset.url;
        audioId = asset.audioId ?? undefined;
      }
      const audio = current?.audio ?? new Audio(url);
      audio.currentTime = 0;
      audio.onerror = () => {
        setAudioState(key, { playing: false, error: "Audio playback failed" });
      };
      currentAudio = audio;
      currentAudioKey = key;
      setAudioState(key, { url, audioId, audio, loading: false, playing: true });
      await playExclusive(audio, () => {
        if (currentAudio === audio) {
          currentAudio = null;
          currentAudioKey = "";
        }
        setAudioState(key, { playing: false });
      });
      saveInteraction({ eventType: "audio_played", language, sentenceOrdinal: ordinal });
    } catch (error) {
      if (currentAudioKey === key) {
        currentAudio = null;
        currentAudioKey = "";
      }
      setAudioState(key, {
        loading: false,
        playing: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function saveInteraction(
    input: Omit<ReadingInteractionRequest, "documentId">,
  ): void {
    if (!persistence?.documentId) return;
    const request: ReadingInteractionRequest = {
      documentId: persistence.documentId,
      ...input,
    };
    const key = JSON.stringify(request);
    if (trackedInteractions.has(key)) return;
    trackedInteractions.add(key);
    void recordReadingInteraction(request).catch((error) => {
      trackedInteractions.delete(key);
      console.error("News reading interaction save failed:", error);
    });
  }

  onMount(() => {
    saveInteraction({ eventType: "article_opened" });
  });

  onDestroy(() => {
    if (dictionaryHideTimer) clearTimeout(dictionaryHideTimer);
    stopCurrentAudio();
    for (const state of Object.values(audioByKey)) {
      if (state.url) URL.revokeObjectURL(state.url);
    }
  });
</script>

<svelte:window
  onclick={closeWordFromWindow}
  onkeydown={handleWindowKeydown}
/>

<section class="reader">
  <header class="toolbar">
    <button type="button" class="back" onclick={onback}>← Today’s front page</button>
    <div class="provenance">
      <span>{document.metadata.source.replace("-", " ")}</span>
      <span>{document.metadata.level}</span>
      <span>{document.metadata.languages.length} languages</span>
      {#if document.metadata.extraction === "feed-summary"}<span>feed summary</span>{/if}
      {#if cacheHit}<span>cached</span>{/if}
    </div>
    <div class="actions">
      <button type="button" class:active={showBase} onclick={toggleBase}>
        {showBase ? "Hide English" : "Reveal English"}
      </button>
      <a href={document.metadata.sourceUrl} target="_blank" rel="noreferrer">Original ↗</a>
      {#if document.metadata.discussionUrl}
        <a href={document.metadata.discussionUrl} target="_blank" rel="noreferrer">Discussion ↗</a>
      {/if}
    </div>
  </header>

  <div class="interaction-guide">
    <strong>{hoverMode === "word" ? "Word dictionary" : hoverMode === "sentence" ? "Sentence explanation" : "Words + sentences"}</strong>
    <span>{hoverMode === "none" ? "Scroll, swipe, or use arrow keys to advance every language together" : "Hover or select a word for its definition · use the sentence tab for the full sidebar explanation"}</span>
  </div>

  <div class="reader-layout">
    <div
      class="parallel-stage"
      role="slider"
      aria-label="Aligned news sentences"
      aria-valuemin="1"
      aria-valuemax={rows.length}
      aria-valuenow={selectedRowIndex + 1}
      aria-valuetext={`Sentence ${selectedRowIndex + 1} of ${rows.length}. Scroll, swipe, or use arrow keys to move every language together.`}
      tabindex="0"
      use:readerNavigation
      onkeydown={handleReaderKeydown}
      onpointerdown={handleReaderPointerDown}
      onpointerup={handleReaderPointerUp}
      onpointercancel={() => (pointerStart = null)}
    >
      <header class="sentence-navigation">
        <button
          type="button"
          aria-label="Previous sentence"
          disabled={selectedRowIndex === 0}
          onclick={() => moveSentence(-1)}
        >← <span>Previous</span></button>
        <div class="sentence-position" aria-live="polite">
          <strong>{String(selectedRowIndex + 1).padStart(2, "0")}</strong>
          <span>/ {String(rows.length).padStart(2, "0")}</span>
          <small>one sentence · every language</small>
        </div>
        <button
          type="button"
          aria-label="Next sentence"
          disabled={selectedRowIndex === rows.length - 1}
          onclick={() => moveSentence(1)}
        ><span>Next</span> →</button>
      </header>

      {#if selectedRow}
        <article
          data-sentence-ordinal={selectedRow.ordinal}
          class:headline={selectedRow.ordinal === 0}
          class:sentence-hovered={hoverMode === "sentence" && hoveredSentence === selectedRow.ordinal}
          class:selected={selectedOrdinal === selectedRow.ordinal}
          onpointerleave={clearHover}
        >
          {#if showBase}
            <div class="base parallel-language-row" class:linked={hoverMode === "sentence" && hoveredSentence === selectedRow.ordinal}>
              <div class="parallel-language-label">
                <strong>English</strong>
                <span>Source</span>
              </div>
              <p>{selectedRow.baseText}</p>
            </div>
          {/if}
          <div class="parallel-language-rows">
            {#each document.metadata.languages as language}
              {@const option = languageFor(language)}
              {@const cell = selectedRow.languages[language]}
              <section class="parallel-language-row">
                <header class="parallel-language-label">
                  <strong dir={option?.direction ?? "ltr"}>{option?.nativeName ?? language}</strong>
                  <span>{option?.name ?? language}</span>
                </header>
                <div
                  class="sentence-cell"
                  data-language={language}
                  class:active={selectedLanguage === language}
                  dir={option?.direction ?? "ltr"}
                  role="group"
                  aria-label={`${option?.name ?? language} sentence ${selectedRow.ordinal + 1}`}
                  onpointerenter={(event) => sentencePointer(event, selectedRow.ordinal, language, cell?.tokens ?? [])}
                >
                  {#if cell?.text}
                    {@const state = audioState(selectedRow.ordinal, language)}
                    <button
                      type="button"
                      class="sentence-audio"
                      class:playing={state?.playing}
                      class:failed={!!state?.error}
                      disabled={state?.loading}
                      aria-label={audioLabel(selectedRow.ordinal, language)}
                      title={state?.error || audioLabel(selectedRow.ordinal, language)}
                      onclick={(event) => {
                        event.stopPropagation();
                        inspect(selectedRow.ordinal, language);
                        void toggleSentenceAudio(selectedRow.ordinal, language, cell.text);
                      }}
                    >{state?.loading ? "…" : state?.playing ? "■" : "▶"}</button>
                  {/if}
                  {#if cell?.tokens.length}
                    {#each cell.tokens as token (token.ordinal)}{token.leading}{#if token.wordLike}<button
                          type="button"
                          class="token word"
                          class:word-linked={tokenHighlighted(selectedRow.ordinal, language, token)}
                          data-token-ordinal={token.ordinal}
                          data-dictionary-interactive
                          aria-expanded={activeWord?.key === wordInstanceKey(selectedRow.ordinal, language, token)}
                          onpointerenter={(event) => wordPointer(event, selectedRow.ordinal, language, token)}
                          onpointerleave={() => hideWordSoon(wordInstanceKey(selectedRow.ordinal, language, token))}
                          onfocus={(event) => wordPointer(event, selectedRow.ordinal, language, token)}
                          onblur={() => hideWordSoon(wordInstanceKey(selectedRow.ordinal, language, token))}
                          onclick={(event) => toggleWord(event, selectedRow.ordinal, language, token)}
                        >{token.text}</button>{:else}<span class="token">{token.text}</span>{/if}{/each}
                  {:else}
                    {cell?.text || "Translation unavailable"}
                  {/if}
                  <button
                    type="button"
                    class="sentence-inspect"
                    aria-label={`Show ${(option?.name ?? language)} sentence ${selectedRow.ordinal + 1} explanation`}
                    onpointerenter={() => showSentence(selectedRow.ordinal, language)}
                    onfocus={() => showSentence(selectedRow.ordinal, language)}
                    onclick={() => inspect(selectedRow.ordinal, language)}
                  >sentence {selectedRow.ordinal + 1} · details</button>
                </div>
              </section>
            {/each}
          </div>
        </article>

        <label class="sentence-progress">
          <span class="sr-only">Choose sentence</span>
          <input
            type="range"
            min="1"
            max={rows.length}
            value={selectedRowIndex + 1}
            aria-label="Choose sentence"
            oninput={(event) => goToSentence(Number((event.currentTarget as HTMLInputElement).value) - 1)}
          />
          <span>Scroll to continue ↓</span>
        </label>
      {/if}
    </div>

    <aside class="inspector">
      {#if selectedRow && selectedCell && selectedLanguageOption}
        <p class="eyebrow">Sentence {selectedRow.ordinal + 1} · Langouste layers</p>
        <div class="language-tabs">
          {#each document.metadata.languages as language}
            {@const option = languageFor(language)}
            <button
              type="button"
              class:active={selectedLanguage === language}
              onclick={() => inspect(selectedRow.ordinal, language)}
            >{option?.nativeName ?? language}</button>
          {/each}
        </div>

        <div class="selected-text" dir={selectedLanguageOption.direction}>
          <h2>{selectedCell.text}</h2>
          <button
            type="button"
            class="listen"
            class:playing={audioState(selectedRow.ordinal, selectedLanguage)?.playing}
            disabled={audioState(selectedRow.ordinal, selectedLanguage)?.loading}
            onclick={() => void toggleSentenceAudio(selectedRow.ordinal, selectedLanguage, selectedCell.text)}
          >
            {audioState(selectedRow.ordinal, selectedLanguage)?.loading
              ? "Generating audio…"
              : audioState(selectedRow.ordinal, selectedLanguage)?.playing
                ? "■ Stop audio"
                : audioState(selectedRow.ordinal, selectedLanguage)?.error
                  ? "↻ Retry audio"
                  : "▶ Listen to this sentence"}
          </button>
          {#if audioState(selectedRow.ordinal, selectedLanguage)?.error}
            <p class="audio-error">{audioState(selectedRow.ordinal, selectedLanguage)?.error}</p>
          {/if}
        </div>

        {#if selectedCell.explanation}
          <section>
            <h3>Translation note</h3>
            <p>{selectedCell.explanation}</p>
          </section>
        {/if}

        <section>
          <h3>Constructions & grammar</h3>
          {#if selectedCell.grammar.length}
            <ul class="notes">
              {#each selectedCell.grammar as point}
                <li>
                  <strong>{point.label}</strong>
                  {#if point.targetText}<em dir={selectedLanguageOption.direction}>{point.targetText}</em>{/if}
                  <p>{point.explanation}</p>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="empty">No construction was singled out for this sentence.</p>
          {/if}
        </section>

        <section>
          <h3>Vocabulary</h3>
          {#if selectedCell.vocabulary.length}
            <dl>
              {#each selectedCell.vocabulary as item, vocabularyOrdinal}
                <div>
                  <dt dir={selectedLanguageOption.direction}>
                    <button
                      type="button"
                      class="vocabulary-term"
                      onclick={() => saveInteraction({
                        eventType: "vocabulary_inspected",
                        language: selectedLanguage,
                        sentenceOrdinal: selectedRow.ordinal,
                        vocabularyOrdinal,
                      })}
                    >{item.term}</button>
                  </dt>
                  <dd>{item.meaning}{item.partOfSpeech ? ` · ${item.partOfSpeech}` : ""}</dd>
                </div>
              {/each}
            </dl>
          {:else}
            <p class="empty">No vocabulary note for this sentence.</p>
          {/if}
        </section>

        {#if showBase}
          <section>
            <h3>English source</h3>
            <p>{selectedRow.baseText}</p>
          </section>
        {/if}

        <a
          class="workbench"
          href={workbenchUrl({
            text: selectedCell.text,
            sourceLanguage: selectedLanguage,
            title: `${document.metadata.title} — sentence ${selectedRow.ordinal + 1}`,
          })}
          onclick={() => saveInteraction({
            eventType: "workbench_opened",
            language: selectedLanguage,
            sentenceOrdinal: selectedRow.ordinal,
          })}
        >Dive deeper in Langouste Workbench ↗</a>
      {/if}
    </aside>
  </div>

  {#if activeWord}
    {@const activeLookupKey = dictionaryKey(activeWord.term, activeWord.language)}
    {@const lookup = dictionaryLookups[activeLookupKey]}
    {@const headword = lookup?.source_term || activeWord.term}
    {#key activeWord.key}
      <DictionaryPopover
        term={activeWord.term}
        language={activeWord.language}
        languageLabel={languageFor(activeWord.language)?.name ?? activeWord.language}
        {headword}
        {lookup}
        loading={dictionaryLoading[activeLookupKey]}
        error={dictionaryErrors[activeLookupKey]}
        anchor={activeWordAnchor}
        dictionaryHref={dictionaryUrl(headword, activeWord.language)}
        loadAudio={loadWordAudio}
        onaudioplay={() => saveInteraction({
          eventType: "audio_played",
          language: activeWord?.language,
          sentenceOrdinal: activeWord?.sentenceOrdinal,
          tokenOrdinal: activeWord?.tokenOrdinal,
        })}
        onpointerenter={keepWordOpen}
        onpointerleave={() => hideWordSoon(activeWord?.key ?? "")}
      />
    {/key}
  {/if}
</section>

<style>
  .reader {
    display: flex; height: 100%; min-height: 0; flex-direction: column; overflow: hidden;
    background: var(--paper);
  }
  .toolbar {
    position: sticky; top: 0; z-index: 30;
    display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 1rem;
    min-height: 3.3rem; padding: 0.62rem 0.9rem;
    border-bottom: 1px solid var(--ink);
    background: color-mix(in srgb, var(--paper) 94%, transparent); backdrop-filter: blur(14px);
  }
  .back { padding: 0; border: 0; background: none; color: var(--ink); font: 750 0.68rem var(--sans); cursor: pointer; }
  .provenance, .actions { display: flex; align-items: center; flex-wrap: wrap; gap: 0.55rem; }
  .provenance span { color: var(--muted); font: 700 0.53rem var(--sans); letter-spacing: 0.09em; text-transform: uppercase; }
  .actions button, .actions a {
    padding: 0.35rem 0.48rem; border: 1px solid var(--line); background: transparent; color: var(--ink-soft);
    font: 700 0.58rem var(--sans); text-decoration: none; cursor: pointer;
  }
  .actions button.active { border-color: var(--accent); color: var(--accent); }
  .interaction-guide {
    display: flex; justify-content: center; gap: 0.65rem; padding: 0.38rem 1rem;
    border-bottom: 1px solid var(--line); background: var(--paper-deep);
    color: var(--muted); font: 0.58rem var(--sans);
  }
  .interaction-guide strong { color: var(--accent); letter-spacing: 0.08em; text-transform: uppercase; }
  .reader-layout {
    display: grid; grid-template-columns: minmax(0, 1fr) 19.5rem; align-items: stretch;
    flex: 1; min-height: 0;
  }
  .parallel-stage {
    display: grid; grid-template-rows: auto minmax(0, 1fr) auto;
    min-width: 0; min-height: 0; overflow: hidden; border-right: 1px solid var(--ink);
    touch-action: pan-x;
  }
  .parallel-stage:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .sentence-navigation {
    display: grid; grid-template-columns: 5.5rem minmax(0, 1fr) 5.5rem; align-items: center;
    min-height: 3.2rem; border-bottom: 4px double var(--ink); background: var(--paper);
  }
  .sentence-navigation button {
    align-self: stretch; padding: 0 .7rem; border: 0; background: transparent; color: var(--ink-soft);
    font: 750 .58rem var(--sans); cursor: pointer;
  }
  .sentence-navigation button:first-child { border-right: 1px solid var(--line); text-align: left; }
  .sentence-navigation button:last-child { border-left: 1px solid var(--line); text-align: right; }
  .sentence-navigation button:hover:not(:disabled) { color: var(--accent); }
  .sentence-navigation button:disabled { cursor: default; opacity: .28; }
  .sentence-position {
    display: flex; align-items: baseline; justify-content: center; gap: .35rem;
    font-family: var(--sans);
  }
  .sentence-position strong { color: var(--accent); font-size: 1.05rem; }
  .sentence-position span { color: var(--muted); font-size: .65rem; }
  .sentence-position small {
    margin-left: .55rem; color: var(--muted); font: 700 .49rem var(--sans);
    letter-spacing: .08em; text-transform: uppercase;
  }
  article {
    display: flex; min-height: 0; flex-direction: column; overflow-y: auto;
    border-bottom: 1px solid var(--line); transition: background 90ms ease;
  }
  article.sentence-hovered { background: var(--sentence-highlight); }
  .parallel-language-rows {
    display: grid; grid-auto-rows: minmax(5.25rem, 1fr); flex: 1;
  }
  .parallel-language-row {
    display: grid; grid-template-columns: clamp(7.5rem, 15vw, 10rem) minmax(0, 1fr);
    min-height: 5.25rem; border-bottom: 1px solid var(--line);
  }
  .parallel-language-label {
    display: grid; align-content: center; gap: .1rem; padding: .65rem .8rem;
    border-right: 1px solid var(--line); background: color-mix(in srgb, var(--paper-deep) 52%, transparent);
  }
  .parallel-language-label strong { font: 700 .82rem var(--serif); }
  .parallel-language-label span {
    color: var(--muted); font: 700 .5rem var(--sans); letter-spacing: .08em; text-transform: uppercase;
  }
  .base { border-bottom-style: dashed; background: var(--paper-deep); }
  .base.linked { background: var(--sentence-highlight-strong); }
  .base p {
    align-self: center; max-width: 64rem; margin: 0; padding: .7rem 2.35rem .7rem .8rem;
    color: var(--ink-soft); font: italic .82rem/1.4 var(--serif);
  }
  .sentence-cell {
    position: relative; min-height: 5.25rem; padding: 0.75rem 2.35rem 1.75rem 0.8rem;
    color: var(--ink); font: 0.9rem/1.52 var(--serif); white-space: pre-wrap;
  }
  .sentence-cell.active { background: color-mix(in srgb, var(--accent) 4%, transparent); box-shadow: inset 3px 0 var(--accent); }
  .sentence-cell:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .sentence-audio {
    position: absolute; top: .42rem; right: .42rem; z-index: 2;
    display: grid; width: 1.42rem; height: 1.42rem; padding: 0; place-items: center;
    border: 1px solid var(--line); border-radius: 50%; background: color-mix(in srgb, var(--paper) 92%, transparent);
    color: var(--muted); font: 700 .55rem var(--sans); cursor: pointer;
  }
  .sentence-audio:hover:not(:disabled), .sentence-audio.playing { border-color: var(--accent); background: var(--accent); color: var(--paper); }
  .sentence-audio.failed { border-color: var(--accent); color: var(--accent); }
  .sentence-audio:disabled { cursor: wait; }
  .headline .sentence-cell { min-height: 5.75rem; font: 700 clamp(1.05rem, 1.4vw, 1.42rem)/1.12 var(--display); }
  .token { position: relative; border-radius: 0.12rem; transition: color 70ms ease, background 70ms ease; }
  .token.word {
    display: inline; margin: 0; padding: 0; border: 0; background: none; color: inherit;
    font: inherit; letter-spacing: inherit; text-align: inherit; cursor: help;
  }
  .token.word::after {
    content: ""; position: absolute; right: 0; bottom: -0.08em; left: 0; height: 1px;
    background: transparent;
  }
  .token.word:hover::after { background: color-mix(in srgb, var(--accent) 42%, transparent); }
  .token.word-linked { background: var(--word-highlight); color: #fff; box-shadow: 0 0 0 1px var(--word-highlight); }
  .sentence-inspect {
    position: absolute; right: 2.35rem; bottom: 0.42rem; left: 0.7rem;
    overflow: hidden; padding: 0.18rem 0; border: 0; border-top: 1px solid var(--line);
    background: transparent; color: var(--muted); font: 700 0.48rem var(--sans);
    letter-spacing: 0.07em; text-align: start; text-overflow: ellipsis; text-transform: uppercase;
    white-space: nowrap; cursor: pointer;
  }
  .sentence-inspect:hover, .sentence-inspect:focus-visible { border-color: var(--accent); color: var(--accent); outline: 0; }
  .sentence-progress {
    display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: .8rem;
    min-height: 2.55rem; padding: .45rem .75rem; border-top: 1px solid var(--ink); background: var(--paper-deep);
  }
  .sentence-progress input { width: 100%; accent-color: var(--accent); cursor: pointer; }
  .sentence-progress > span:last-child {
    color: var(--muted); font: 700 .49rem var(--sans); letter-spacing: .08em; text-transform: uppercase;
  }
  .inspector {
    min-height: 0; overflow-y: auto;
    padding: 1rem 1.05rem 1.4rem;
  }
  .eyebrow { margin: 0 0 0.65rem; color: var(--accent); font: 750 0.54rem var(--sans); letter-spacing: 0.1em; text-transform: uppercase; }
  .language-tabs { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-bottom: 0.85rem; }
  .language-tabs button { padding: 0.27rem 0.38rem; border: 1px solid var(--line); background: none; color: var(--ink-soft); font: 650 0.58rem var(--sans); cursor: pointer; }
  .language-tabs button.active { border-color: var(--ink); background: var(--ink); color: var(--paper); }
  .selected-text { padding-bottom: 0.85rem; border-bottom: 4px double var(--ink); }
  .listen { margin-top: .7rem; padding: .45rem .6rem; border: 1px solid var(--accent); background: transparent; color: var(--accent); font: 750 .61rem var(--sans); cursor: pointer; }
  .listen.playing { background: var(--accent); color: var(--paper); }
  .listen:disabled { opacity: .6; cursor: wait; }
  .selected-text .audio-error { margin-top: .45rem; color: var(--accent); font: .64rem/1.3 var(--sans); }
  h2 { margin: 0; font: 700 1.15rem/1.25 var(--display); }
  .inspector section { padding: 0.8rem 0; border-bottom: 1px solid var(--line); }
  h3 { margin: 0 0 0.45rem; font: 750 0.58rem var(--sans); letter-spacing: 0.09em; text-transform: uppercase; }
  section p, .notes p { margin: 0; color: var(--ink-soft); font: 0.8rem/1.45 var(--serif); }
  .notes { display: grid; gap: 0.7rem; margin: 0; padding: 0; list-style: none; }
  .notes strong, .notes em { display: block; margin-bottom: 0.12rem; }
  .notes strong { font: 700 0.77rem var(--serif); }
  .notes em { color: var(--accent); font: italic 0.75rem var(--serif); }
  dl, dl div { display: grid; gap: 0.35rem; margin: 0; }
  dl div { grid-template-columns: minmax(4.5rem, auto) 1fr; padding-bottom: 0.35rem; }
  dt { font: 700 0.76rem var(--serif); }
  .vocabulary-term {
    padding: 0; border: 0; background: transparent; color: inherit;
    font: inherit; text-decoration: underline dotted; text-underline-offset: 0.18em; cursor: pointer;
  }
  dd { margin: 0; color: var(--ink-soft); font: 0.68rem/1.3 var(--sans); }
  .empty { color: var(--muted); font-style: italic; }
  .workbench {
    display: block; margin-top: 0.9rem; padding: 0.68rem; border: 1px solid var(--accent);
    color: var(--accent); font: 750 0.62rem var(--sans); text-align: center; text-decoration: none;
  }
  .workbench:hover { background: var(--accent); color: var(--paper); }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
    clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
  @media (max-width: 1050px) {
    .reader { height: auto; min-height: 100%; overflow: visible; }
    .reader-layout { grid-template-columns: 1fr; }
    .parallel-stage { min-height: calc(100vh - 5.7rem); border-right: 0; }
    .inspector { max-height: none; border-top: 4px double var(--ink); }
  }
  @media (max-width: 700px) {
    .toolbar { position: relative; grid-template-columns: 1fr; }
    .provenance { display: none; }
    .actions { overflow-x: auto; flex-wrap: nowrap; }
    .interaction-guide { justify-content: start; overflow-x: auto; white-space: nowrap; }
    .parallel-language-row { grid-template-columns: 6rem minmax(0, 1fr); }
    .parallel-language-label { padding: .55rem; }
    .sentence-navigation { grid-template-columns: 2.75rem minmax(0, 1fr) 2.75rem; }
    .sentence-navigation button span, .sentence-position small, .sentence-progress > span:last-child { display: none; }
    .sentence-cell { padding-left: .65rem; }
  }
</style>
