<script lang="ts">
  import { onDestroy } from "svelte";
  import {readingPopoverStyle} from "../lib/popover-position";
  import { isCurrent, playExclusive, stopCurrent } from "../lib/audio-player";

  interface DictionaryCardLookup {
    source_term: string | null;
    source_url: string | null;
    target_source_url: string | null;
    form_description: string | null;
    definitions: string[];
    senses: Array<{ part_of_speech: string; definition: string; examples: string[] }>;
  }

  interface Props {
    term: string;
    inline?: boolean;
    resources?: boolean;
    onopen?: () => void;
    onclose?: () => void;
    language: string;
    languageLabel?: string;
    headword?: string;
    lookup?: DictionaryCardLookup | null;
    contextMeaning?: string | null;
    loading?: boolean;
    error?: string;
    anchor: HTMLElement | null;
    dictionaryHref?: string;
    profileHref?: string;
    loadAudio?: (term: string, language: string) => Promise<string>;
    onaudioplay?: () => void;
    onpointerenter?: (event: PointerEvent) => void;
    onpointerleave?: (event: PointerEvent) => void;
  }

  let {
    term,
    inline=false, resources=true, onopen, onclose,
    language,
    languageLabel = language,
    headword,
    lookup = null,
    contextMeaning = null,
    loading = false,
    error = "",
    anchor,
    dictionaryHref,
    profileHref,
    loadAudio,
    onaudioplay,
    onpointerenter,
    onpointerleave,
  }: Props = $props();

  let position = $state("");
  let audioLoading = $state(false);
  let audioError = $state("");
  let audioPlaying = $state(false);
  let audioElement: HTMLAudioElement | null = null;
  let audioUrl: string | null = null;

  const displayHeadword = $derived(headword?.trim() || lookup?.source_term?.trim() || term);
  const normalizedContextMeaning = $derived(contextMeaning?.trim() || "");
  const englishWiktionaryHref = $derived(
    lookup?.source_url?.trim() || wiktionaryHref("en", displayHeadword),
  );
  const targetWiktionaryHref = $derived(
    lookup?.target_source_url?.trim() || wiktionaryHref(language, displayHeadword),
  );
  const showTargetWiktionary = $derived(
    language.split("-")[0]?.toLocaleLowerCase() !== "en"
      && targetWiktionaryHref !== englishWiktionaryHref,
  );

  $effect(() => {
    if (anchor) position = positionPopover(anchor);
  });

  function updatePosition(): void {
    if (anchor) position = positionPopover(anchor);
  }

  function positionPopover(target:HTMLElement):string { return readingPopoverStyle(target); }

  async function playPronunciation(event: MouseEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    if (!loadAudio) return;
    if (audioElement && audioPlaying && isCurrent(audioElement)) {
      stopCurrent();
      audioElement = null;
      audioPlaying = false;
      return;
    }

    audioLoading = true;
    audioError = "";
    try {
      if (!audioUrl) audioUrl = await loadAudio(displayHeadword, language);
      const audio = new Audio(audioUrl);
      audioElement = audio;
      audioPlaying = true;
      await playExclusive(audio, () => {
        if (audioElement === audio) audioElement = null;
        audioPlaying = false;
      });
      onaudioplay?.();
    } catch (cause) {
      audioError = cause instanceof Error ? cause.message : String(cause);
      audioElement = null;
      audioPlaying = false;
    } finally {
      audioLoading = false;
    }
  }

  function isExternal(href: string): boolean {
    return /^https?:\/\//u.test(href);
  }

  function wiktionaryHref(locale: string, word: string): string {
    const subdomain = locale.split("-")[0]?.toLocaleLowerCase().replace(/[^a-z]/gu, "") || "en";
    return `https://${subdomain}.wiktionary.org/wiki/${encodeURIComponent(word.trim().replace(/\s+/gu, "_"))}`;
  }

  onDestroy(() => {
    if (audioElement && isCurrent(audioElement)) stopCurrent();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  });
</script>

<svelte:window onresize={updatePosition} onscroll={updatePosition} />

<dialog
  open
  class="dictionary-popover word-popover"
  class:inline
  onfocusin={()=>onpointerenter?.(new PointerEvent("pointerenter"))}
  onfocusout={()=>onpointerleave?.(new PointerEvent("pointerleave"))}
  aria-label={`Dictionary entry for ${term}`}
  data-dictionary-interactive
  style={inline?undefined:position}
  {onpointerenter}
  {onpointerleave}
>
  <div class="dictionary-popover-head word-popover-head">
    <strong><bdi lang={language}>{displayHeadword}</bdi></strong>
    <div class="dictionary-popover-actions">
      <span>{languageLabel}</span>
      {#if onclose}<button type="button" aria-label="Close dictionary popup" onclick={onclose}>×</button>{/if}
      {#if loadAudio}
        <button
          type="button"
          class:active={audioPlaying}
          disabled={audioLoading}
          title={audioError || `Play pronunciation for ${displayHeadword}`}
          aria-label={`${audioPlaying ? "Stop" : "Play"} pronunciation for ${displayHeadword}`}
          onclick={playPronunciation}
        >{audioLoading ? "…" : audioPlaying ? "■" : "▶"}</button>
      {/if}
    </div>
  </div>

  {#if displayHeadword.toLocaleLowerCase(language) !== term.toLocaleLowerCase(language)}
    <p class="dictionary-form">from <em>{term}</em></p>
  {/if}
  {#if lookup?.form_description}
    <div class="dictionary-form-detail">
      <span class="dictionary-section-label">Form</span>
      <p>{lookup.form_description}</p>
    </div>
  {/if}

  {#if normalizedContextMeaning}
    <div class="dictionary-context">
      <span class="dictionary-section-label">In this sentence</span>
      <p>{normalizedContextMeaning}</p>
    </div>
  {/if}

  {#if loading}
    <p class="dictionary-muted">
      {normalizedContextMeaning ? "Checking dictionary sources…" : "Looking up…"}
    </p>
  {:else if lookup?.senses?.length}
    <section class="dictionary-entry">
      <span class="dictionary-section-label">
        {lookup.senses.length === 1 ? "Dictionary sense" : `${lookup.senses.length} dictionary senses`}
      </span>
      <div class="dictionary-senses">
        {#each lookup.senses as sense}
          <div class="dictionary-sense">
            {#if sense.part_of_speech}<span class="dictionary-pos">{sense.part_of_speech}</span>{/if}
            <p>{sense.definition}</p>
            {#each sense.examples as example}
              <p class="dictionary-example">{example}</p>
            {/each}
          </div>
        {/each}
      </div>
    </section>
  {:else if lookup?.definitions?.length}
    <section class="dictionary-entry">
      <span class="dictionary-section-label">
        {lookup.definitions.length === 1 ? "Dictionary meaning" : `${lookup.definitions.length} dictionary meanings`}
      </span>
      <div class="dictionary-senses">
        {#each lookup.definitions as definition}<p>{definition}</p>{/each}
      </div>
    </section>
  {:else if error}
    <p class="dictionary-muted">{error}</p>
  {:else}
    <p class="dictionary-muted">No dictionary entry found.</p>
  {/if}

  {#if audioError}<p class="dictionary-muted">{audioError}</p>{/if}

  {#if onopen}<button class="open-sidebar" type="button" onclick={onopen}>Open dictionary</button>{/if}
  {#if resources}<nav class="dictionary-links" aria-label="Dictionary resources">
    {#if profileHref}<a href={profileHref}>My word</a>{/if}
    {#if dictionaryHref}
      <a
        href={dictionaryHref}
        target={isExternal(dictionaryHref) ? "_blank" : undefined}
        rel={isExternal(dictionaryHref) ? "noreferrer" : undefined}
      >Langouste dictionary</a>
    {/if}
    <a href={englishWiktionaryHref} target="_blank" rel="noreferrer">English Wiktionary ↗</a>
    {#if showTargetWiktionary}
      <a href={targetWiktionaryHref} target="_blank" rel="noreferrer">
        {languageLabel} Wiktionary ↗
      </a>
    {/if}
  </nav>{/if}
</dialog>

<style>
  .dictionary-popover {
    position: fixed;
    inset: auto;
    z-index: 60;
    display: flex;
    height: fit-content;
    margin: 0;
    padding: 0.65rem 0.75rem;
    flex-direction: column;
    gap: 0.35rem;
    overflow-y: auto;
    border: 1px solid var(--color-border, var(--line, #c7c2b8));
    border-radius: var(--radius-sm, 0.2rem);
    background: var(--color-surface, var(--paper, #fff));
    box-shadow: var(--shadow-lg, 0 12px 30px rgb(0 0 0 / 18%));
    color: var(--color-text, var(--ink, #222));
    font-family: var(--dictionary-font, var(--sans, inherit));
    font-size: 0.78rem;
    line-height: 1.35;
    text-align: start;
    white-space: normal;
    direction: ltr;
  }

  .dictionary-popover.inline {position:static;width:100%;max-height:none;padding:0;border:0;background:transparent;box-shadow:none;font-size:15px;z-index:auto;}
  .open-sidebar {font:inherit;min-height:36px;padding:6px 10px;border:1px solid #a6b6a8;background:white;color:#245c44;border-radius:3px;}
  .dictionary-popover p { margin: 0; }
  .dictionary-popover-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .dictionary-popover-head strong {
    color: var(--color-primary, var(--accent, #a73628));
    font-size: 0.9rem;
  }
  .dictionary-popover-actions { display: flex; align-items: center; gap: 0.45rem; }
  .dictionary-popover-actions > span,
  .dictionary-pos {
    color: var(--color-text-light, var(--muted, #74746d));
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .dictionary-popover-actions button {
    display: inline-grid;
    width: 1.7rem;
    height: 1.7rem;
    padding: 0;
    place-items: center;
    flex: 0 0 auto;
    border: 1px solid var(--color-border, var(--line, #c7c2b8));
    border-radius: 999px;
    background: var(--color-bg, var(--paper-deep, #f5f2ea));
    color: var(--color-text, var(--ink, #222));
    font-size: 0.68rem;
    line-height: 1;
    cursor: pointer;
  }
  .dictionary-popover-actions button:hover:not(:disabled),
  .dictionary-popover-actions button.active {
    border-color: var(--color-primary, var(--accent, #a73628));
    background: var(--color-primary, var(--accent, #a73628));
    color: white;
  }
  .dictionary-popover-actions button:disabled { cursor: wait; opacity: 0.72; }
  .dictionary-form,
  .dictionary-muted { color: var(--color-text-light, var(--muted, #74746d)); }
  .dictionary-form-detail,
  .dictionary-context,
  .dictionary-entry { display: grid; gap: 0.28rem; }
  .dictionary-form-detail { color: var(--color-text-light, var(--muted, #74746d)); }
  .dictionary-context {
    padding: 0.45rem 0.55rem;
    border-left: 3px solid var(--color-primary, var(--accent, #a73628));
    background: color-mix(in srgb, var(--color-primary, var(--accent, #a73628)) 7%, transparent);
  }
  .dictionary-context p { font-weight: 650; }
  .dictionary-section-label {
    color: var(--color-text-light, var(--muted, #74746d));
    font-size: 0.58rem;
    font-weight: 750;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
  .dictionary-senses { display: grid; gap: 0.55rem; }
  .dictionary-sense { display: grid; gap: 0.2rem; }
  .dictionary-pos {
    display: inline-flex;
    width: fit-content;
    padding: 0.08rem 0.38rem;
    border-radius: 999px;
    background: var(--color-bg, var(--paper-deep, #f5f2ea));
  }
  .dictionary-example {
    padding-left: 0.6rem;
    border-left: 2px solid var(--color-border, var(--line, #c7c2b8));
    color: var(--color-text-light, var(--muted, #74746d));
    font-style: italic;
  }
  .dictionary-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
    padding-top: 0.25rem;
    border-top: 1px solid var(--color-border, var(--line, #c7c2b8));
  }
  .dictionary-links a {
    color: var(--color-primary, var(--accent, #a73628));
    font-size: 0.72rem;
    font-weight: 700;
    text-decoration: none;
  }
  .dictionary-links a:hover { text-decoration: underline; }
</style>
