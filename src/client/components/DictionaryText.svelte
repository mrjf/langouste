<script lang="ts">
  import { onDestroy } from "svelte";
  import { api } from "../lib/api";
  import { isCurrent, playExclusive, stopCurrent } from "../lib/audio-player";

  interface Props {
    text: string | null | undefined;
    language: string;
  }

  interface DictionaryLookup {
    term: string;
    language: string;
    source_term: string | null;
    source_url: string | null;
    target_source_url: string | null;
    form_description: string | null;
    definitions: string[];
    senses?: Array<{ part_of_speech: string; definition: string; examples: string[] }>;
  }

  interface PopoverPosition {
    left: number;
    width: number;
    maxHeight: number;
    top?: number;
    bottom?: number;
  }

  let { text, language }: Props = $props();

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
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let activeAnchor: HTMLElement | null = null;
  let popoverPosition = $state<PopoverPosition | null>(null);

  const segments = $derived.by(() => splitWords(text ?? ""));

  function keyFor(word: string): string {
    return `${language}:${word.toLocaleLowerCase()}`;
  }

  async function show(word: string, instanceKey: string, anchor?: HTMLElement) {
    if (!language || !word.trim()) return;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (anchor) {
      activeAnchor = anchor;
      popoverPosition = positionPopover(anchor);
    }
    const key = keyFor(word);
    activeInstanceKey = instanceKey;
    if (lookups[key] || loading[key]) return;
    loading = { ...loading, [key]: true };
    try {
      const promise = lookupCache.get(key) ?? api.lookupDictionary(word, language);
      lookupCache.set(key, promise);
      const result = (await promise) as DictionaryLookup;
      lookups = { ...lookups, [key]: result };
    } catch (err) {
      errors = { ...errors, [key]: err instanceof Error ? err.message : String(err) };
      lookups = { ...lookups, [key]: null };
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

  function showFromEvent(word: string, instanceKey: string, event: MouseEvent | FocusEvent) {
    const target = event.currentTarget;
    show(word, instanceKey, target instanceof HTMLElement ? target : undefined);
  }

  function keepOpen() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function updateActivePosition() {
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

  function splitWords(value: string): Array<{ kind: "word" | "text"; value: string }> {
    const segments: Array<{ kind: "word" | "text"; value: string }> = [];
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
</script>

<svelte:window onresize={updateActivePosition} onscroll={updateActivePosition} />

<span class="dictionary-text">{#each segments as segment, index}{#if segment.kind === "word"}{@const key = keyFor(segment.value)}{@const instanceKey = `${key}:${index}`}<span class="dict-wrap"><span
          class="dict-word"
          role="button"
          tabindex="0"
          onmouseenter={(event) => showFromEvent(segment.value, instanceKey, event)}
          onfocus={(event) => showFromEvent(segment.value, instanceKey, event)}
          onmouseleave={() => hideSoon(instanceKey)}
          onblur={() => hideSoon(instanceKey)}
        >{segment.value}</span>{#if activeInstanceKey === instanceKey}<span
            class="dict-popover"
            role="tooltip"
            style={popoverStyle(popoverPosition)}
            onmouseenter={keepOpen}
            onmouseleave={() => hideSoon(instanceKey)}
          ><span class="dict-header"><strong>{segment.value}</strong><button class="dict-audio-btn" class:active={audioPlayingKey === key} title={audioErrors[key] || "Play pronunciation"} aria-label="Play pronunciation" onclick={(event) => playPronunciation(event, segment.value)}>{audioLoading[key] ? "…" : audioPlayingKey === key ? "⏸" : "🔊"}</button></span>{#if loading[key]}<span class="dict-muted">Looking up…</span>{:else if lookups[key]?.senses?.length || lookups[key]?.definitions?.length}{#if lookups[key]?.source_term && lookups[key]?.source_term !== segment.value}<span class="dict-muted">lemma: {lookups[key]?.source_term}</span>{/if}{#if lookups[key]?.form_description}<span class="dict-form">form: {lookups[key]?.form_description}</span>{/if}{#if lookups[key]?.senses?.length}{#each lookups[key]?.senses ?? [] as sense}<span class="dict-sense"><span class="dict-pos">{sense.part_of_speech}</span><span class="dict-definition">{sense.definition}</span>{#each sense.examples as example}<span class="dict-example">{example}</span>{/each}</span>{/each}{:else}{#each lookups[key]?.definitions ?? [] as definition}<span class="dict-definition">{definition}</span>{/each}{/if}{#if audioErrors[key]}<span class="dict-muted">{audioErrors[key]}</span>{/if}<span class="dict-links">{#if lookups[key]?.source_url}<a href={lookups[key]?.source_url ?? undefined} target="_blank" rel="noreferrer">Definitions</a>{/if}{#if lookups[key]?.target_source_url}<a href={lookups[key]?.target_source_url ?? undefined} target="_blank" rel="noreferrer">Target Wiktionary</a>{/if}</span>{:else if errors[key]}<span class="dict-muted">{errors[key]}</span>{:else}<span class="dict-muted">No dictionary entry found.</span>{/if}</span>{/if}</span>{:else}{segment.value}{/if}{/each}</span>

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
    cursor: help;
    outline: none;
    text-decoration: inherit;
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
