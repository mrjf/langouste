<script lang="ts">
  import { onDestroy } from "svelte";
  import { api } from "../lib/api";
  import type { DictionaryLookupResponse as DictionaryLookup } from "../lib/api-contracts";
  import type { FiloDocumentJson } from "../lib/stores.svelte";
  import DictionaryPopover from "./DictionaryPopover.svelte";
  import SentenceGlossPopover from "./SentenceGlossPopover.svelte";
  import type { SentenceSupport } from "../lib/course-reading-support";

  interface Props {
    text: string | null | undefined;
    language: string;
    filoDoc?: FiloDocumentJson | null;
    baseByteOffset?: number;
    tooltip?: boolean;
    sentenceSupport?: SentenceSupport;
    onSupportUsed?: () => void;
    onOpenDictionary?: (entry: {term:string;headword:string;lookup:DictionaryLookup|null;contextMeaning:string;anchor:HTMLElement}) => void;
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
    senses?: Array<{ part_of_speech: string; definition: string; examples: string[] }>;
    sourceUrl?: string;
    targetSourceUrl?: string;
    sourceTerm?: string;
    formDescription?: string;
    notFound?: boolean;
    contextMeaning?: string;
  }

  let { text, language, filoDoc = null, baseByteOffset = 0, tooltip = true, sentenceSupport, onSupportUsed, onOpenDictionary }: Props = $props();

  const lookupCache = new Map<string, Promise<DictionaryLookup>>();
  let activeInstanceKey = $state<string | null>(null);
  let pinnedInstanceKey = $state<string | null>(null);
  let lookups = $state<Record<string, DictionaryLookup | null>>({});
  let loading = $state<Record<string, boolean>>({});
  let errors = $state<Record<string, string>>({});
  const textEncoder = new TextEncoder();
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let rootElement: HTMLSpanElement | null = null;
  let activeAnchor = $state<HTMLElement | null>(null);
  let hoverPart = $state<"sentence" | "word">("word");
  let activeSegment: WordSegment | null = null;
  let suppressFocus = false;
  let modality = "mouse";
  let popupHeld=false;
  function enterPopup(){popupHeld=true;keepOpen();}
  function leavePopup(instanceKey:string){popupHeld=false;hideSoon(instanceKey);}
  function claimHover() { window.dispatchEvent(new CustomEvent("langouste-dictionary-hover", {detail:rootElement})); }
  function otherHover(event:Event) { if((event as CustomEvent).detail!==rootElement)closePopover(); }
  function pointerWord(segment:WordSegment,instanceKey:string,event:PointerEvent) {
    if(!sentenceSupport || event.pointerType==='touch')return;
    const anchor=event.currentTarget as HTMLElement,rect=anchor.getBoundingClientRect();
    const next=event.clientY<rect.top+rect.height/2?'sentence':'word';
    if(activeInstanceKey!==instanceKey||hoverPart!==next){pinnedInstanceKey=null;hoverPart=next;void show(segment,instanceKey,anchor);}
    else keepOpen();
  }
  function focusWord(segment:WordSegment,instanceKey:string,event:FocusEvent){
    if(suppressFocus){suppressFocus=false;return;}
    if(sentenceSupport){hoverPart='sentence';pinnedInstanceKey=null;}
    showFromEvent(segment,instanceKey,event);
  }
  function openDictionary(segment:WordSegment,anchor:HTMLElement){
    if(!onOpenDictionary)return;
    const lookup=lookupFromFilo(segment);
    onSupportUsed?.();
    closePopover();
    onOpenDictionary({term:segment.value,headword:profileHeadword(segment.value,lookup,segment.lookupTerm),lookup,contextMeaning:segment.filoLookup?.contextMeaning??'',anchor});
  }
  function splitClick(segment:WordSegment,instanceKey:string,event:MouseEvent){
    if(!sentenceSupport){toggleFromClick(segment,instanceKey,event);return;}
    if(event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return;
    event.preventDefault();
    const anchor=event.currentTarget as HTMLElement,rect=anchor.getBoundingClientRect();
    if(event.detail===0||modality!=='touch'&&event.clientY>=rect.top+rect.height/2){openDictionary(segment,anchor);return;}
    hoverPart='sentence';pinnedInstanceKey=instanceKey;void show(segment,instanceKey,anchor);
  }
  function wordKey(segment:WordSegment,instanceKey:string,event:KeyboardEvent){
    if(!sentenceSupport)return;
    if(event.key==='ArrowUp'||event.key==='ArrowDown'||event.key===' '){
      event.preventDefault();hoverPart=event.key==='ArrowDown'?'word':'sentence';pinnedInstanceKey=instanceKey;void show(segment,instanceKey,event.currentTarget as HTMLElement);
    }
  }

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

  function lookupFromFilo(segment: WordSegment): DictionaryLookup | null {
    const filoLookup = segment.filoLookup;
    if (!filoLookup || filoLookup.notFound) return null;
    const definitions = Array.isArray(filoLookup.definitions) ? filoLookup.definitions : [];
    const senses = Array.isArray(filoLookup.senses) ? filoLookup.senses : [];
    if (
      definitions.length === 0 &&
      senses.length === 0 &&
      !filoLookup.lemma &&
      !filoLookup.sourceTerm
    ) {
      return null;
    }
    return {
      term: lookupTermFor(segment),
      language,
      source_term: filoLookup.sourceTerm ?? null,
      source_url: filoLookup.sourceUrl ?? null,
      target_source_url: filoLookup.targetSourceUrl ?? null,
      form_description: filoLookup.formDescription ?? null,
      definitions,
      senses,
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
    }
    claimHover();
    activeSegment = segment;
    onSupportUsed?.();
    const key = keyForWord(segment);
    activeInstanceKey = instanceKey;
    const seededLookup = lookupFromFilo(segment);
    // A dictionary annotation is an immutable lookup snapshot. It is the
    // authority for this word, including a stored miss, so opening its card
    // must never trigger a second lookup for a supposedly "full" entry.
    if (segment.filoLookup) {
      lookups = { ...lookups, [key]: seededLookup };
      loading = { ...loading, [key]: false };
      return;
    }
    if (sentenceSupport) { // Course support is offline-only, including a missing annotation.
      lookups = {...lookups,[key]:null};
      return;
    }
    if (loading[key] || hasDictionaryEntry(lookups[key])) return;
    errors = { ...errors, [key]: "" };
    loading = { ...loading, [key]: true };
    try {
      const lookupKey = keyFor(lookupTerm);
      const promise = lookupCache.get(lookupKey) ?? api.lookupDictionary(lookupTerm, language);
      lookupCache.set(lookupKey, promise);
      const result = (await promise) as DictionaryLookup;
      if (!hasDictionaryEntry(result)) lookupCache.delete(lookupKey);
      if (!hasCurrentFiloLookup(key)) lookups = { ...lookups, [key]: result };
    } catch (err) {
      lookupCache.delete(keyFor(lookupTerm));
      if (!hasCurrentFiloLookup(key) && !hasDictionaryEntry(lookups[key])) {
        lookups = { ...lookups, [key]: null };
      }
    } finally {
      loading = { ...loading, [key]: false };
    }
  }

  function hasCurrentFiloLookup(key: string): boolean {
    return segments.some(
      (segment) =>
        segment.kind === "word" && keyForWord(segment) === key && segment.filoLookup !== undefined,
    );
  }

  function hideSoon(instanceKey: string) {
    if (pinnedInstanceKey === instanceKey) return;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (activeInstanceKey === instanceKey && !popupHeld) {
        activeInstanceKey = null;
        activeAnchor = null;
      }
      hideTimer = null;
    }, 400);
  }

  function showFromEvent(segment: WordSegment, instanceKey: string, event: MouseEvent | FocusEvent) {
    if (!tooltip) return;
    if (pinnedInstanceKey && pinnedInstanceKey !== instanceKey) return;
    const target = event.currentTarget;
    show(segment, instanceKey, target instanceof HTMLElement ? target : undefined);
  }

  function toggleFromClick(segment: WordSegment, instanceKey: string, event: MouseEvent) {
    if (
      !tooltip ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    if (pinnedInstanceKey === instanceKey) {
      closePopover();
      return;
    }
    pinnedInstanceKey = instanceKey;
    const target = event.currentTarget;
    void show(segment, instanceKey, target instanceof HTMLElement ? target : undefined);
  }

  function closePopover() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    popupHeld=false;
    pinnedInstanceKey = null;
    activeInstanceKey = null;
    activeAnchor = null;
  }

  function closePinnedFromWindow(event: MouseEvent) {
    if (event.target instanceof Node && rootElement?.contains(event.target)) return;
    if (activeInstanceKey) closePopover();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && activeInstanceKey) {
      const anchor=activeAnchor;
      closePopover();
      if(anchor?.isConnected&&document.activeElement!==anchor){suppressFocus=true;anchor.focus({preventScroll:true});}
    }
  }

  function keepOpen() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  $effect(()=>{
    window.addEventListener('langouste-dictionary-hover',otherHover);
    return ()=>window.removeEventListener('langouste-dictionary-hover',otherHover);
  });
  $effect(()=>{text;language;filoDoc;closePopover();});
  onDestroy(() => {
    if (hideTimer) clearTimeout(hideTimer);
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
    const wordRe = /[\p{Letter}\p{Mark}\p{Number}]+(?:['’.-][\p{Letter}\p{Mark}\p{Number}]+)*/gu;
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

<svelte:window
  onclick={closePinnedFromWindow}
  onkeydown={handleWindowKeydown}
/>

<span class="dictionary-text" bind:this={rootElement}>
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
        onmouseenter={(event) => {if(!sentenceSupport)showFromEvent(segment, instanceKey, event);}}
        onpointermove={(event)=>pointerWord(segment,instanceKey,event)}
        onpointerdown={(event)=>{modality=event.pointerType;}}
        onkeydown={(event)=>wordKey(segment,instanceKey,event)}
        onfocus={(event) => focusWord(segment, instanceKey, event)}
        onmouseleave={() => hideSoon(instanceKey)}
        onblur={() => hideSoon(instanceKey)}
        onclick={(event) => splitClick(segment, instanceKey, event)}
        aria-label={sentenceSupport?`${segment.value}: sentence meaning; Arrow Down for dictionary; Enter to open dictionary`:undefined}
        aria-haspopup={sentenceSupport?"dialog":undefined}
        aria-expanded={tooltip ? activeInstanceKey === instanceKey : undefined}
      >{segment.value}</a>{#if tooltip && activeInstanceKey === instanceKey}
          {#key instanceKey}
            {#if sentenceSupport && hoverPart==='sentence'}
              <SentenceGlossPopover support={sentenceSupport} {language} anchor={activeAnchor} onpointerenter={enterPopup} onpointerleave={()=>leavePopup(instanceKey)} onclose={closePopover} onDictionary={()=>{if(activeSegment&&activeAnchor)openDictionary(activeSegment,activeAnchor);}}/>
            {:else}
            <DictionaryPopover
              term={segment.value}
              {language}
              languageLabel={language.toUpperCase()}
              {headword}
              {lookup}
              loading={loading[key]}
              error={errors[key]}
              anchor={activeAnchor}
              dictionaryHref={dictionaryHref(segment.value, lookupTerm)}
              profileHref={profileHref(segment.value, lookup, segment.lookupTerm)}
              loadAudio={sentenceSupport?undefined:(word, activeLanguage) => api.fetchDictionaryAudio(word, activeLanguage)}
              contextMeaning={segment.filoLookup?.contextMeaning}
              resources={!sentenceSupport}
              onclose={sentenceSupport?closePopover:undefined}
              onopen={sentenceSupport?()=>{if(activeAnchor)openDictionary(segment,activeAnchor);}:undefined}
              onpointerenter={enterPopup}
              onpointerleave={() => leavePopup(instanceKey)}
            />
            {/if}
          {/key}
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
    outline-offset: 3px;
    text-decoration: none;
  }

  .dict-word:hover,
  .dict-word:focus {
    color: inherit;
    text-decoration: none;
  }

  .dict-word:focus-visible { outline: 2px solid var(--accent, #245c44); }

  :global(a.dict-word),
  :global(a.dict-word:visited),
  :global(a.dict-word:hover),
  :global(a.dict-word:focus),
  :global(a.dict-word:active) {
    color: inherit !important;
    text-decoration: none !important;
  }

</style>
