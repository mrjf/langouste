<script lang="ts">
  import { onDestroy } from "svelte";
  import { api } from "../lib/api";
  import { isCurrent, playExclusive, stopCurrent } from "../lib/audio-player";
  import type { DictionaryLookupResponse as DictionaryLookup } from "../lib/api-contracts";
  import type { FiloDocumentJson } from "../lib/stores.svelte";

  interface Props {
    text: string | null | undefined;
    language: string;
    filoDoc?: FiloDocumentJson | null;
    baseByteOffset?: number;
    tooltip?: boolean;
  }

  interface PopoverPosition {
    left: number;
    width: number;
    maxHeight: number;
    top?: number;
    bottom?: number;
  }

  type TextSegment = { kind: "text"; value: string };
  type WordSegment = {
    kind: "word";
    value: string;
    lookupTerm?: string;
    filoLookup?: FiloDictionaryPayload;
  };
  type Segment = TextSegment | WordSegment;

  interface FiloDictionaryPayload {
    surface?: string;
    lemma?: string;
    language?: string;
    definitions?: string[];
    sourceTerm?: string;
    formDescription?: string;
    notFound?: boolean;
  }

  let { text, language, filoDoc = null, baseByteOffset = 0, tooltip = true }: Props = $props();

  const lookupCache = new Map<string, Promise<DictionaryLookup>>();
  let activeInstanceKey = $state<string | null>(null);
  let lookups = $state<Record<string, DictionaryLookup | null>>({});
  let loading = $state<Record<string, boolean>>({});
  let errors = $state<Record<string, string>>({});
  let audioLoading = $state<Record<string, boolean>>({});
  let audioErrors = $state<Record<string, string>>({});
  let audioPlayingKey = $state<string | null>(null);
  let audioElement: HTMLAudioElement | null = null;
  const audioUrls = new Map<string, string>();
  const textEncoder = new TextEncoder();
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let activeAnchor: HTMLElement | null = null;
  let popoverPosition = $state<PopoverPosition | null>(null);

  const segments = $derived.by(() => segmentsFor(text ?? "", language, filoDoc, baseByteOffset));
  const lowercaseLemmaLangs = new Set([
    "en",
    "fr",
    "es",
    "hu",
    "it",
    "pt",
    "nl",
    "ru",
    "tr",
    "da",
    "pl",
  ]);

  function keyFor(word: string): string {
    return `${language}:${word.toLocaleLowerCase()}`;
  }

  function keyForWord(segment: WordSegment): string {
    return keyFor(segment.value);
  }

  function lookupTermFor(segment: WordSegment): string {
    return cleanHeadword(segment.lookupTerm) || segment.value;
  }

  function dictionaryHref(word: string, lookupTerm?: string): string {
    const term = cleanHeadword(lookupTerm) || cleanHeadword(word);
    if (!language || !term) return "#/dictionary";
    return `#/dictionary/${encodeURIComponent(language)}/${encodeURIComponent(term)}`;
  }

  function profileHref(
    word: string,
    lookup?: DictionaryLookup | null,
    fallbackLemma?: string,
  ): string {
    if (!language || !word.trim()) return "#/profile";
    const headword = profileHeadword(word, lookup, fallbackLemma);
    const routeKey = headword.trim().replace(/\s+/gu, "_");
    return `#/profile/${encodeURIComponent(language)}/lexis/vocabulary/${encodeURIComponent(routeKey)}`;
  }

  function profileHeadword(
    word: string,
    lookup?: DictionaryLookup | null,
    fallbackLemma?: string,
  ): string {
    const fallbackHeadword = cleanHeadword(fallbackLemma);
    const lemma =
      (lemmaFromFormDescription(lookup?.form_description, word) ??
        (usesSourceTermAsLemma(lookup?.form_description)
          ? distinctLemma(lookup?.source_term, word)
          : null) ??
        fallbackHeadword
      ) ||
      word;
    const clean = lemma.trim().replace(/\s+/gu, " ");
    return lowercaseLemmaLangs.has(language) ? clean.toLocaleLowerCase(language) : clean;
  }

  function lemmaFromFormDescription(
    formDescription: string | null | undefined,
    word: string,
  ): string | null {
    if (!formDescription) return null;
    if (!usesSourceTermAsLemma(formDescription)) return null;
    const match = /\bof\s+([\p{Letter}\p{Mark}'’.-]+)(?:\b|[:.;,])/iu.exec(formDescription);
    return distinctLemma(match?.[1], word);
  }

  function usesSourceTermAsLemma(formDescription: string | null | undefined): boolean {
    return !formDescription || !/\bprefixed verb\b|\bbase\b/iu.test(formDescription);
  }

  function distinctLemma(lemma: string | null | undefined, word: string): string | null {
    const clean = typeof lemma === "string" ? lemma.trim().replace(/\s+/gu, " ") : "";
    if (!clean) return null;
    return clean === word ? null : clean;
  }

  function hasDictionaryEntry(lookup: DictionaryLookup | null | undefined): boolean {
    return !!(
      lookup &&
      ((lookup.senses?.length ?? 0) > 0 ||
        (lookup.definitions?.length ?? 0) > 0 ||
        lookup.source_term)
    );
  }

  function hasFullDictionaryEntry(lookup: DictionaryLookup | null | undefined): boolean {
    return !!(
      lookup &&
      ((lookup.senses?.length ?? 0) > 0 || lookup.source_url || lookup.target_source_url)
    );
  }

  function lookupFromFilo(segment: WordSegment): DictionaryLookup | null {
    const filoLookup = segment.filoLookup;
    if (!filoLookup || filoLookup.notFound) return null;
    const definitions = Array.isArray(filoLookup.definitions) ? filoLookup.definitions : [];
    if (definitions.length === 0 && !filoLookup.lemma && !filoLookup.sourceTerm) return null;
    return {
      term: lookupTermFor(segment),
      language,
      source_term: filoLookup.sourceTerm ?? null,
      source_url: null,
      target_source_url: null,
      form_description: filoLookup.formDescription ?? null,
      definitions,
      senses: [],
    };
  }

  async function show(segment: WordSegment, instanceKey: string, anchor?: HTMLElement) {
    if (!tooltip) return;
    const lookupTerm = lookupTermFor(segment);
    if (!language || !lookupTerm.trim()) return;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (anchor) {
      activeAnchor = anchor;
      popoverPosition = positionPopover(anchor);
    }
    const key = keyForWord(segment);
    activeInstanceKey = instanceKey;
    const seededLookup = lookupFromFilo(segment);
    if (!lookups[key] && seededLookup) lookups = { ...lookups, [key]: seededLookup };
    if (loading[key] || hasFullDictionaryEntry(lookups[key])) return;
    errors = { ...errors, [key]: "" };
    loading = { ...loading, [key]: true };
    try {
      const lookupKey = keyFor(lookupTerm);
      const promise = lookupCache.get(lookupKey) ?? api.lookupDictionary(lookupTerm, language);
      lookupCache.set(lookupKey, promise);
      const result = (await promise) as DictionaryLookup;
      if (!hasDictionaryEntry(result)) lookupCache.delete(lookupKey);
      lookups = { ...lookups, [key]: result };
    } catch (err) {
      lookupCache.delete(keyFor(lookupTerm));
      if (seededLookup || hasDictionaryEntry(lookups[key])) {
        lookups = { ...lookups, [key]: lookups[key] ?? seededLookup };
      } else {
        lookups = { ...lookups, [key]: null };
      }
    } finally {
      loading = { ...loading, [key]: false };
    }
  }

  function hideSoon(instanceKey: string) {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (activeInstanceKey === instanceKey) {
        activeInstanceKey = null;
        activeAnchor = null;
        popoverPosition = null;
      }
      hideTimer = null;
    }, 400);
  }

  function showFromEvent(segment: WordSegment, instanceKey: string, event: MouseEvent | FocusEvent) {
    if (!tooltip) return;
    const target = event.currentTarget;
    show(segment, instanceKey, target instanceof HTMLElement ? target : undefined);
  }

  function keepOpen() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function updateActivePosition() {
    if (!tooltip) return;
    if (activeAnchor) popoverPosition = positionPopover(activeAnchor);
  }

  function positionPopover(anchor: HTMLElement): PopoverPosition {
    const rect = anchor.getBoundingClientRect();
    const margin = 12;
    const gap = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(320, Math.max(180, viewportWidth - margin * 2));
    const left = clamp(rect.left + rect.width / 2 - width / 2, margin, viewportWidth - width - margin);
    const spaceAbove = rect.top - margin - gap;
    const spaceBelow = viewportHeight - rect.bottom - margin - gap;
    const openBelow = spaceBelow >= 180 || spaceBelow >= spaceAbove;

    if (openBelow) {
      return {
        left,
        width,
        top: rect.bottom + gap,
        maxHeight: Math.max(120, spaceBelow),
      };
    }

    return {
      left,
      width,
      bottom: viewportHeight - rect.top + gap,
      maxHeight: Math.max(120, spaceAbove),
    };
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  function popoverStyle(position: PopoverPosition | null): string {
    if (!position) return "";
    const vertical =
      position.top === undefined
        ? `bottom: ${position.bottom ?? 12}px;`
        : `top: ${position.top}px;`;
    return `left: ${position.left}px; width: ${position.width}px; max-height: ${position.maxHeight}px; ${vertical}`;
  }

  async function playPronunciation(event: MouseEvent, word: string) {
    event.preventDefault();
    event.stopPropagation();
    const key = keyFor(word);
    if (audioElement && audioPlayingKey === key && isCurrent(audioElement)) {
      stopCurrent();
      audioPlayingKey = null;
      audioElement = null;
      return;
    }

    audioLoading = { ...audioLoading, [key]: true };
    audioErrors = { ...audioErrors, [key]: "" };
    try {
      let url = audioUrls.get(key);
      if (!url) {
        url = await api.fetchDictionaryAudio(word, language);
        audioUrls.set(key, url);
      }
      const audio = new Audio(url);
      audioElement = audio;
      audioPlayingKey = key;
      await playExclusive(audio, () => {
        if (audioElement === audio) audioElement = null;
        if (audioPlayingKey === key) audioPlayingKey = null;
      });
    } catch (err) {
      audioErrors = { ...audioErrors, [key]: err instanceof Error ? err.message : String(err) };
      audioPlayingKey = null;
    } finally {
      audioLoading = { ...audioLoading, [key]: false };
    }
  }

  onDestroy(() => {
    if (audioElement && isCurrent(audioElement)) stopCurrent();
    for (const url of audioUrls.values()) URL.revokeObjectURL(url);
    audioUrls.clear();
  });

  function segmentsFor(
    value: string,
    activeLanguage: string,
    documentJson: FiloDocumentJson | null,
    offset: number,
  ): Segment[] {
    return segmentsFromFilo(value, activeLanguage, documentJson, offset) ?? splitWords(value);
  }

  function segmentsFromFilo(
    value: string,
    activeLanguage: string,
    documentJson: FiloDocumentJson | null,
    offset: number,
  ): Segment[] | null {
    if (!documentJson) return null;
    const baseByteOffset = documentJson.text === value ? 0 : Math.max(0, offset);
    const endByteOffset = baseByteOffset + textEncoder.encode(value).length;
    if (sliceByByteRange(documentJson.text, baseByteOffset, endByteOffset) !== value) return null;
    const documentLanguage =
      typeof documentJson.metadata?.language === "string" ? documentJson.metadata.language : "";
    if (documentLanguage && activeLanguage && documentLanguage !== activeLanguage) return null;

    const wordTier = documentJson.tiers.find((tier) => tier.id === "word" && tier.kind === "word");
    if (!wordTier?.annotations.length) return null;
    const dictionaryTier = documentJson.tiers.find((tier) => tier.id === "dictionary");
    const dictionaryByWordId = new Map<string, FiloDictionaryPayload>();
    for (const annotation of dictionaryTier?.annotations ?? []) {
      const wordAnnotationId = annotation.payload.wordAnnotationId;
      if (typeof wordAnnotationId === "string") {
        dictionaryByWordId.set(wordAnnotationId, annotation.payload as FiloDictionaryPayload);
      }
    }

    const segments: Segment[] = [];
    let lastStringIndex = 0;
    const baseStringIndex = stringIndexForByteOffset(documentJson.text, baseByteOffset);
    const words = [...wordTier.annotations]
      .filter((word) => baseByteOffset <= word.start && word.end <= endByteOffset)
      .sort((left, right) => left.start - right.start);
    for (const word of words) {
      const start = stringIndexForByteOffset(documentJson.text, word.start) - baseStringIndex;
      const end = stringIndexForByteOffset(documentJson.text, word.end) - baseStringIndex;
      if (start < lastStringIndex || end < start) return null;
      if (start > lastStringIndex) {
        segments.push({ kind: "text", value: value.slice(lastStringIndex, start) });
      }
      const surface = value.slice(start, end);
      const filoLookup = dictionaryByWordId.get(word.id);
      segments.push({
        kind: "word",
        value: surface,
        lookupTerm: cleanHeadword(filoLookup?.lemma) || cleanHeadword(filoLookup?.sourceTerm),
        filoLookup,
      });
      lastStringIndex = end;
    }
    if (lastStringIndex < value.length) {
      segments.push({ kind: "text", value: value.slice(lastStringIndex) });
    }
    return segments;
  }

  function splitWords(value: string): Segment[] {
    const segments: Segment[] = [];
    const wordRe = /[\p{Letter}\p{Mark}]+(?:['’.-][\p{Letter}\p{Mark}]+)*/gu;
    let last = 0;
    for (const match of value.matchAll(wordRe)) {
      const index = match.index ?? 0;
      if (index > last) segments.push({ kind: "text", value: value.slice(last, index) });
      segments.push({ kind: "word", value: match[0] });
      last = index + match[0].length;
    }
    if (last < value.length) segments.push({ kind: "text", value: value.slice(last) });
    return segments;
  }

  function stringIndexForByteOffset(value: string, byteOffset: number): number {
    const target = Math.max(0, Math.min(byteOffset, textEncoder.encode(value).length));
    let low = 0;
    let high = value.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const bytes = textEncoder.encode(value.slice(0, mid)).length;
      if (bytes < target) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  function sliceByByteRange(value: string, startByte: number, endByte: number): string {
    const start = stringIndexForByteOffset(value, startByte);
    const end = stringIndexForByteOffset(value, endByte);
    return value.slice(start, end);
  }

  function cleanHeadword(value: string | null | undefined): string {
    return typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
  }
</script>

<svelte:window onresize={updateActivePosition} onscroll={updateActivePosition} />

<span class="dictionary-text">
  {#each segments as segment, index}
    {#if segment.kind === "word"}
      {@const key = keyForWord(segment)}
      {@const lookupTerm = lookupTermFor(segment)}
      {@const lookup = lookups[key]}
      {@const headword = profileHeadword(segment.value, lookup, segment.lookupTerm)}
      {@const instanceKey = `${key}:${index}`}
      <span class="dict-wrap"><a
        class="dict-word"
        href={dictionaryHref(segment.value, lookupTerm)}
        onmouseenter={(event) => showFromEvent(segment, instanceKey, event)}
        onfocus={(event) => showFromEvent(segment, instanceKey, event)}
        onmouseleave={() => hideSoon(instanceKey)}
        onblur={() => hideSoon(instanceKey)}
      >{segment.value}</a>{#if tooltip && activeInstanceKey === instanceKey}
          <span
            class="dict-popover"
            role="tooltip"
            style={popoverStyle(popoverPosition)}
            onmouseenter={keepOpen}
            onmouseleave={() => hideSoon(instanceKey)}
          >
            <span class="dict-header">
              <strong>{segment.value}</strong>
              <button
                class="dict-audio-btn"
                class:active={audioPlayingKey === key}
                title={audioErrors[key] || "Play pronunciation"}
                aria-label="Play pronunciation"
                onclick={(event) => playPronunciation(event, segment.value)}
              >
                {audioLoading[key] ? "…" : audioPlayingKey === key ? "⏸" : "🔊"}
              </button>
            </span>
            {#if loading[key] && !hasDictionaryEntry(lookup)}
              <span class="dict-muted">Looking up…</span>
            {:else if lookup?.senses?.length || lookup?.definitions?.length}
              {#if headword !== segment.value}
                <span class="dict-muted">lemma: {headword}</span>
              {/if}
              {#if lookup?.form_description}
                <span class="dict-form">form: {lookup.form_description}</span>
              {/if}
              {#if lookup?.senses?.length}
                {#each lookup.senses ?? [] as sense}
                  <span class="dict-sense">
                    <span class="dict-pos">{sense.part_of_speech}</span>
                    <span class="dict-definition">{sense.definition}</span>
                    {#each sense.examples as example}
                      <span class="dict-example">{example}</span>
                    {/each}
                  </span>
                {/each}
              {:else}
                {#each lookup?.definitions ?? [] as definition}
                  <span class="dict-definition">{definition}</span>
                {/each}
              {/if}
              {#if loading[key]}
                <span class="dict-muted">Refreshing full entry…</span>
              {/if}
              {#if audioErrors[key]}
                <span class="dict-muted">{audioErrors[key]}</span>
              {/if}
              <span class="dict-links">
                <a href={profileHref(segment.value, lookup, segment.lookupTerm)}>My word</a>
                <a href={dictionaryHref(segment.value, lookupTerm)}>Dictionary page</a>
                {#if lookup?.source_url}
                  <a href={lookup.source_url ?? undefined} target="_blank" rel="noreferrer">
                    Definitions
                  </a>
                {/if}
                {#if lookup?.target_source_url}
                  <a href={lookup.target_source_url ?? undefined} target="_blank" rel="noreferrer">
                    Target Wiktionary
                  </a>
                {/if}
              </span>
            {:else if errors[key]}
              <span class="dict-muted">{errors[key]}</span>
            {:else}
              <span class="dict-muted">No dictionary entry found.</span>
            {/if}
          </span>
        {/if}</span>
    {:else}
      {segment.value}
    {/if}
  {/each}
</span>

<style>
  .dictionary-text {
    white-space: pre-wrap;
  }

  .dict-wrap {
    position: relative;
    display: inline;
  }

  .dict-word {
    display: inline;
    margin: 0;
    padding: 0;
    color: inherit;
    cursor: help;
    outline: none;
    text-decoration: none;
  }

  .dict-word:hover,
  .dict-word:focus {
    color: inherit;
    text-decoration: none;
  }

  :global(a.dict-word),
  :global(a.dict-word:visited),
  :global(a.dict-word:hover),
  :global(a.dict-word:focus),
  :global(a.dict-word:active) {
    color: inherit !important;
    text-decoration: none !important;
  }

  .dict-popover {
    position: fixed;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.65rem 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    box-shadow: var(--shadow-lg);
    color: var(--color-text);
    font-size: 0.78rem;
    line-height: 1.35;
    white-space: normal;
    overflow-y: auto;
  }

  .dict-popover strong {
    color: var(--color-primary);
    font-size: 0.82rem;
  }

  .dict-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .dict-audio-btn {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-bg);
    color: var(--color-text);
    cursor: pointer;
    width: 1.6rem;
    height: 1.6rem;
    display: inline-grid;
    place-items: center;
    flex: 0 0 auto;
    font-size: 0.72rem;
    line-height: 1;
  }

  .dict-audio-btn:hover,
  .dict-audio-btn.active {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
  }

  .dict-definition {
    display: block;
  }

  .dict-sense {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .dict-pos {
    display: inline-flex;
    width: fit-content;
    padding: 0.08rem 0.38rem;
    border-radius: 999px;
    background: var(--color-bg);
    color: var(--color-text-light);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.035em;
    text-transform: uppercase;
  }

  .dict-example {
    display: block;
    padding-left: 0.6rem;
    border-left: 2px solid var(--color-border);
    color: var(--color-text-light);
    font-style: italic;
  }

  .dict-form {
    display: block;
    padding: 0.3rem 0.45rem;
    border-radius: var(--radius-sm);
    background: var(--color-primary-light);
    color: var(--color-primary);
    font-size: 0.74rem;
    font-weight: 650;
  }

  .dict-muted {
    color: var(--color-text-light);
  }

  .dict-popover a {
    color: var(--color-primary);
    text-decoration: none;
    font-size: 0.74rem;
  }

  .dict-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
  }
</style>
