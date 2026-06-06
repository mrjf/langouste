<script lang="ts">
  import { onDestroy } from "svelte";
  import { api } from "../lib/api";
  import { filoSource } from "../lib/filo-provenance";
  import { LANGUAGES, langName, langTag } from "../lib/languages";
  import { isCurrent, playExclusive, stopCurrent } from "../lib/audio-player";
  import {
    profile,
    type FiloAnnotationJson,
    type FiloDocumentJson,
    type FiloTierJson,
  } from "../lib/stores.svelte";
  import type { WorkbenchAnalyzeResponse } from "../lib/api-contracts";
  import {
    clearSavedWorkbenchState,
    loadSavedWorkbenchState,
    parseWorkbenchRoute,
    saveWorkbenchState,
    type SavedWorkbenchState,
  } from "../lib/workbench";
  import Button from "./ui/Button.svelte";
  import DictionaryText from "./DictionaryText.svelte";
  import FiloText from "./FiloText.svelte";
  import IpaLayer from "./IpaLayer.svelte";

  interface Props {
    route?: string;
    onRouteChange?: (route: string) => void;
  }

  interface SpanView {
    id: string;
    start: number;
    end: number;
    text: string;
    proper: string;
    literal: string;
    tokens: LiteralToken[];
  }

  type LiteralToken =
    | { kind: "text"; id: string; text: string }
    | { kind: "word"; id: string; start: number; end: number; text: string; literal: string };

  interface WordView {
    id: string;
    start: number;
    end: number;
    surface: string;
    lemma: string;
    definition: string;
    form: string;
    href: string;
  }

  type AudioState = {
    url?: string;
    audioId?: string;
    contentType?: string;
    byteLength?: number;
    audio?: HTMLAudioElement;
    loading: boolean;
    playing: boolean;
    error?: string;
  };

  const languageCodes = Object.keys(LANGUAGES);
  const sampleText =
    "Számos README található szétszórva ebben a könyvtárban. Meg tudnád pontosítani, melyik projektet keresed?";
  let { route = "", onRouteChange }: Props = $props();
  let title = $state("Workbench document");
  let text = $state(sampleText);
  let sourceLanguage = $state(profile.value?.learning_languages?.[0]?.lang ?? "hu");
  let targetLanguage = $state(profile.value?.base_language ?? "en");
  let result = $state<WorkbenchAnalyzeResponse | null>(null);
  let editing = $state(true);
  let loading = $state(false);
  let error = $state("");
  let activeSentenceId = $state<string | null>(null);
  let activeLiteralWordId = $state<string | null>(null);
  let sourceFiloDoc = $state<FiloDocumentJson | null>(null);
  let audioByKey = $state<Record<string, AudioState>>({});
  let appliedRoute = "";
  let loadedSavedWorkbench = false;
  const trackedInteractionKeys = new Set<string>();

  const document = $derived(result?.document ?? null);
  const sentences = $derived.by(() => spanViews(document, "sentence", "sentence"));
  const phrases = $derived.by(() => spanViews(document, "phrase", "phrase"));
  const words = $derived.by(() => wordViews(document, sourceLanguage));

  $effect(() => {
    if (!route || route === appliedRoute) return;
    appliedRoute = route;
    const payload = parseWorkbenchRoute(route);
    if (!payload) return;

    loadedSavedWorkbench = true;
    title = payload.title ?? "Workbench document";
    text = payload.text;
    sourceLanguage = payload.sourceLanguage;
    targetLanguage = payload.targetLanguage ?? profile.value?.base_language ?? "en";
    sourceFiloDoc = payload.filoDoc?.text === payload.text ? payload.filoDoc : null;
    result = null;
    editing = false;
    error = "";
    activeSentenceId = null;
    activeLiteralWordId = null;
    audioByKey = {};
    trackedInteractionKeys.clear();

    if (payload.autoAnalyze) {
      setTimeout(() => {
        void analyze();
      }, 0);
    }
  });

  $effect(() => {
    if (route || loadedSavedWorkbench) return;
    loadedSavedWorkbench = true;
    const saved = loadSavedWorkbenchState();
    if (!saved) return;
    applySavedWorkbenchState(saved);
  });

  async function analyze() {
    const cleanText = text.trim();
    if (!cleanText || loading) return;
    loading = true;
    error = "";
    activeSentenceId = null;
    activeLiteralWordId = null;
    try {
      text = cleanText;
      const analyzed = await api.analyzeWorkbench({
        text: cleanText,
        source_language: sourceLanguage,
        target_language: targetLanguage,
        title,
        document: sourceFiloDoc,
      });
      result = analyzed;
      sourceFiloDoc = analyzed.document;
      saveCurrentWorkbenchState(analyzed);
      editing = false;
      trackedInteractionKeys.clear();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function startNewDocument() {
    clearSavedWorkbenchState();
    title = "Workbench document";
    text = "";
    result = null;
    editing = true;
    loading = false;
    error = "";
    activeSentenceId = null;
    activeLiteralWordId = null;
    sourceFiloDoc = null;
    audioByKey = {};
    trackedInteractionKeys.clear();
    appliedRoute = "";
    loadedSavedWorkbench = true;
    onRouteChange?.("");
  }

  function applySavedWorkbenchState(saved: SavedWorkbenchState) {
    title = saved.title ?? "Workbench document";
    text = saved.text;
    sourceLanguage = saved.sourceLanguage;
    targetLanguage = saved.targetLanguage ?? profile.value?.base_language ?? "en";
    result = saved.result?.document.text === saved.text ? saved.result : null;
    sourceFiloDoc =
      result?.document ?? (saved.filoDoc?.text === saved.text ? saved.filoDoc : null);
    editing = !result;
    error = "";
    activeSentenceId = null;
    activeLiteralWordId = null;
    audioByKey = {};
    trackedInteractionKeys.clear();
  }

  function saveCurrentWorkbenchState(nextResult: WorkbenchAnalyzeResponse | null = result) {
    const cleanText = text.trim();
    if (!cleanText) return;
    saveWorkbenchState({
      title,
      text: cleanText,
      sourceLanguage,
      targetLanguage,
      filoDoc: nextResult?.document ?? sourceFiloDoc,
      result: nextResult,
    });
  }

  function spanViews(
    doc: FiloDocumentJson | null,
    tierId: string,
    level: "sentence" | "phrase",
  ): SpanView[] {
    if (!doc) return [];
    const spans = tier(doc, tierId);
    return spans.map((span) => ({
      id: span.id,
      start: span.start,
      end: span.end,
      text: textOf(doc, span),
      proper: translationFor(doc, span, `${level}.translation:${targetLanguage}:proper`),
      literal: translationFor(doc, span, `${level}.translation:${targetLanguage}:literal`),
      tokens: literalTokensForSpan(doc, span, targetLanguage),
    }));
  }

  function literalTokensForSpan(
    doc: FiloDocumentJson,
    span: FiloAnnotationJson,
    target: string,
  ): LiteralToken[] {
    const words = tier(doc, "word").filter(
      (word) => span.start <= word.start && word.end <= span.end,
    );
    const literalByWordId = new Map<string, string>();
    const literalByRange = new Map<string, string>();
    for (const annotation of tier(doc, `word.translation:${target}:literal`)) {
      const literal = stringValue(annotation.payload.text);
      const sourceWordAnnotationId = stringValue(annotation.payload.sourceWordAnnotationId);
      if (sourceWordAnnotationId) literalByWordId.set(sourceWordAnnotationId, literal);
      literalByRange.set(rangeKey(annotation), literal);
    }

    const tokens: LiteralToken[] = [];
    let cursor = span.start;
    for (const word of words) {
      if (cursor < word.start) {
        tokens.push({
          kind: "text",
          id: `text:${cursor}:${word.start}`,
          text: textOf(doc, { start: cursor, end: word.start }),
        });
      }
      tokens.push({
        kind: "word",
        id: word.id,
        start: word.start,
        end: word.end,
        text: textOf(doc, word),
        literal: literalByWordId.get(word.id) ?? literalByRange.get(rangeKey(word)) ?? "",
      });
      cursor = word.end;
    }
    if (cursor < span.end) {
      tokens.push({
        kind: "text",
        id: `text:${cursor}:${span.end}`,
        text: textOf(doc, { start: cursor, end: span.end }),
      });
    }
    return tokens;
  }

  function wordViews(doc: FiloDocumentJson | null, language: string): WordView[] {
    if (!doc) return [];
    return tier(doc, "dictionary").map((annotation) => {
      const payload = annotation.payload;
      const surface = stringValue(payload.surface) || textOf(doc, annotation);
      const lemma = stringValue(payload.lemma) || stringValue(payload.sourceTerm) || surface;
      const definition = firstString(payload.definitions) || "";
      const form = stringValue(payload.formDescription);
      return {
        id: annotation.id,
        start: annotation.start,
        end: annotation.end,
        surface,
        lemma,
        definition,
        form,
        href: `#/dictionary/${encodeURIComponent(language)}/${encodeURIComponent(lemma)}`,
      };
    });
  }

  function tier(doc: FiloDocumentJson, tierId: string): FiloAnnotationJson[] {
    return (
      doc.tiers
        .find((candidate) => candidate.id === tierId)
        ?.annotations.slice()
        .sort((left, right) => left.start - right.start || left.end - right.end) ?? []
    );
  }

  function translationFor(doc: FiloDocumentJson, span: FiloAnnotationJson, tierId: string): string {
    const annotation = tier(doc, tierId).find(
      (candidate) => candidate.start === span.start && candidate.end === span.end,
    );
    return stringValue(annotation?.payload.text);
  }

  function rangeKey(range: { start: number; end: number }): string {
    return `${range.start}:${range.end}`;
  }

  function textOf(doc: FiloDocumentJson, range: { start: number; end: number }): string {
    const start = stringIndexForByteOffset(doc.text, range.start);
    const end = stringIndexForByteOffset(doc.text, range.end);
    return doc.text.slice(start, end);
  }

  function stringIndexForByteOffset(value: string, byteOffset: number): number {
    const encoder = new TextEncoder();
    const target = Math.max(0, Math.min(byteOffset, encoder.encode(value).length));
    let low = 0;
    let high = value.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const bytes = encoder.encode(value.slice(0, mid)).length;
      if (bytes < target) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  function stringValue(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  function firstString(value: unknown): string {
    return Array.isArray(value) && typeof value[0] === "string" ? value[0] : "";
  }

  function markStopped(key: string) {
    const current = audioByKey[key];
    if (!current) return;
    audioByKey = { ...audioByKey, [key]: { ...current, playing: false } };
  }

  async function playSpan(key: string, spanText: string, range?: { start: number; end: number }) {
    const current = audioByKey[key];
    if (current?.loading) return;
    if (current?.playing && current.audio && isCurrent(current.audio)) {
      stopCurrent();
      return;
    }

    audioByKey = { ...audioByKey, [key]: { ...current, loading: true, playing: false, error: "" } };
    try {
      let url = current?.url;
      let audioId = current?.audioId;
      let contentType = current?.contentType;
      let byteLength = current?.byteLength;
      if (!url) {
        const audioAsset = await api.fetchWorkbenchAudio(spanText, sourceLanguage);
        url = audioAsset.url;
        audioId = audioAsset.audioId ?? undefined;
        contentType = audioAsset.contentType;
        byteLength = audioAsset.byteLength;
      }
      if (audioId && range) {
        annotateWorkbenchAudio(range, {
          audioId,
          contentType: contentType ?? "audio/mpeg",
          byteLength: byteLength ?? 0,
        });
      }
      const audio = current?.audio ?? new Audio(url);
      audio.currentTime = 0;
      await playExclusive(audio, () => markStopped(key));
      audioByKey = {
        ...audioByKey,
        [key]: {
          url,
          audioId,
          contentType,
          byteLength,
          audio,
          loading: false,
          playing: true,
        },
      };
      void recordWorkbenchInteraction("heard", "workbench_audio", range);
    } catch (err) {
      audioByKey = {
        ...audioByKey,
        [key]: {
          ...current,
          loading: false,
          playing: false,
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  function annotateWorkbenchAudio(
    range: { start: number; end: number },
    asset: { audioId: string; contentType: string; byteLength: number },
  ) {
    if (!result) return;
    const currentDocument = result.document;
    const start = Math.max(0, Math.min(currentDocument.byteLength, range.start));
    const end = Math.max(start, Math.min(currentDocument.byteLength, range.end));
    if (start >= end) return;

    const language = sourceLanguage || "und";
    const tierId = `audio:${language}`;
    const existingTier = currentDocument.tiers.find((tier) => tier.id === tierId);
    const existingAnnotations = existingTier?.annotations ?? [];
    const alreadyAnnotated = existingAnnotations.some(
      (annotation) =>
        annotation.start === start &&
        annotation.end === end &&
        annotation.payload.audioId === asset.audioId,
    );
    if (alreadyAnnotated) return;

    const annotation: FiloAnnotationJson = {
      id: `audio:${asset.audioId}:${start}:${end}`,
      tierId,
      kind: "audio",
      start,
      end,
      source: "langouste.workbench.audio",
      payload: {
        url: `audio:${asset.audioId}`,
        audioId: asset.audioId,
        mimeType: asset.contentType,
        source: "langouste.workbench.audio",
        language,
        byteLength: asset.byteLength,
        generatedAt: new Date().toISOString(),
      },
    };

    const audioTier: FiloTierJson = existingTier
      ? { ...existingTier, annotations: [...existingAnnotations, annotation] }
      : {
          id: tierId,
          kind: "audio",
          description: "Audio asset ids aligned to workbench byte ranges",
          source: "langouste.workbench.audio",
          annotations: [annotation],
        };

    const tiers = existingTier
      ? currentDocument.tiers.map((tier) => (tier.id === tierId ? audioTier : tier))
      : [...currentDocument.tiers, audioTier];

    result = {
      ...result,
      document: {
        ...currentDocument,
        tiers,
      },
    };
    sourceFiloDoc = result.document;
    saveCurrentWorkbenchState(result);
  }

  function showSentence(sentence: SpanView) {
    activeSentenceId = sentence.id;
    void recordWorkbenchInteraction("encounter", "workbench_definition", sentence, true);
  }

  async function recordWorkbenchInteraction(
    eventType: "encounter" | "heard",
    source: "workbench_definition" | "workbench_audio",
    range?: { start: number; end: number },
    once = false,
  ) {
    if (!document) return;
    const targetRange = range ?? { start: 0, end: document.byteLength };
    const key = `${document.id}:${eventType}:${source}:${targetRange.start}:${targetRange.end}`;
    if (once && trackedInteractionKeys.has(key)) return;
    if (once) trackedInteractionKeys.add(key);
    try {
      await api.recordWorkbenchInteraction({
        document,
        language: sourceLanguage,
        event_type: eventType,
        source,
        range: targetRange,
      });
    } catch (err) {
      console.error("workbench interaction tracking failed:", err);
      if (once) trackedInteractionKeys.delete(key);
    }
  }

  onDestroy(() => {
    for (const value of Object.values(audioByKey)) {
      if (value.audio && isCurrent(value.audio)) stopCurrent();
      if (value.url) URL.revokeObjectURL(value.url);
    }
  });
</script>

<section class="workbench">
  <header class="workbench-header">
    <div>
      <p class="eyebrow"><FiloText text="Filo workbench" role="view-eyebrow" /></p>
      <h1><FiloText text="Layered document analysis" role="view-title" /></h1>
      <p class="lede">
        <FiloText
          text="Paste any text, then inspect word dictionaries, phrase spans, sentence translations, and literal dictionary glosses from one Filo document."
          role="view-description"
        />
      </p>
    </div>
    <button class="new-document-button" type="button" onclick={startNewDocument}>
      <FiloText text="+ New" role="button-label" />
    </button>
  </header>

  {#if editing}
    <form class="input-card" onsubmit={(event) => { event.preventDefault(); analyze(); }}>
      <div class="field-row">
        <label>
          <FiloText text="Title" role="field-label" />
          <input bind:value={title} placeholder="Document title" />
        </label>
        <label>
          <FiloText text="Source" role="field-label" />
          <select bind:value={sourceLanguage}>
            {#each languageCodes as code}
              <option value={code}>{langTag(code)} — {langName(code)}</option>
            {/each}
          </select>
        </label>
        <label>
          <FiloText text="Translation" role="field-label" />
          <select bind:value={targetLanguage}>
            {#each languageCodes as code}
              <option value={code}>{langTag(code)} — {langName(code)}</option>
            {/each}
          </select>
        </label>
      </div>
      <textarea bind:value={text} rows="7" placeholder="Paste a document…"></textarea>
      <div class="actions">
        <Button label={loading ? "Analyzing…" : "Analyze"} type="submit" variant="primary" disabled={loading} />
        {#if error}
          <span class="error">{error}</span>
        {/if}
      </div>
    </form>
  {:else}
    <section class="input-card document-card">
      <div class="document-meta">
        <div><span><FiloText text="Title" role="metadata-label" /></span><strong>{title || "Workbench document"}</strong></div>
        <div><span><FiloText text="Source" role="metadata-label" /></span><strong>{langTag(sourceLanguage)} {langName(sourceLanguage)}</strong></div>
        <div><span><FiloText text="Translation" role="metadata-label" /></span><strong>{langTag(targetLanguage)} {langName(targetLanguage)}</strong></div>
      </div>
      <pre
        class="read-only-text"
        use:filoSource={{
          document,
          text,
          role: "workbench-source-text",
          language: sourceLanguage,
          includeDocument: false,
        }}
      >{text}</pre>
      <IpaLayer text={text} language={sourceLanguage} filoDoc={document} />
      <div class="actions">
        {#if !result}
          <Button label={loading ? "Analyzing…" : "Analyze"} type="button" variant="primary" disabled={loading} onclick={analyze} />
        {/if}
        {#if result}
          <button
            class="audio-button"
            type="button"
            onclick={() =>
              playSpan("document", result?.document.text ?? "", {
                start: 0,
                end: result?.document.byteLength ?? 0,
              })}
          >
            {audioByKey.document?.loading ? "…" : audioByKey.document?.playing ? "stop audio" : "hear document"}
          </button>
        {/if}
        {#if error}
          <span class="error">{error}</span>
        {/if}
      </div>
    </section>
  {/if}

  {#if result && document}
    <div class="summary-grid">
      <div><span><FiloText text="Words" role="summary-label" /></span><strong>{result.summary.words}</strong></div>
      <div><span><FiloText text="Sentences" role="summary-label" /></span><strong>{result.summary.sentences}</strong></div>
      <div><span><FiloText text="Phrases" role="summary-label" /></span><strong>{result.summary.phrases}</strong></div>
      <div><span><FiloText text="Target" role="summary-label" /></span><strong>{langTag(result.summary.targetLanguage)}</strong></div>
    </div>

    <section class="surface-card">
      <div class="section-heading">
        <h2><FiloText text="Text surface" role="section-heading" /></h2>
        <span><FiloText text="Original text with word-aligned literal glosses." role="section-description" /></span>
      </div>
      <div
        class="text-surface"
        use:filoSource={{
          document,
          text,
          role: "workbench-text-surface",
          language: sourceLanguage,
          includeDocument: false,
        }}
      >
        {#each sentences as sentence}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            class="sentence-wrap"
            onmouseenter={() => showSentence(sentence)}
            onmouseleave={() => {
              activeSentenceId = null;
              activeLiteralWordId = null;
            }}
          >
            <span class="interlinear-sentence">
              {#each sentence.tokens as token (token.id)}
                {#if token.kind === "word"}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <span
                    class="literal-word"
                    class:active={activeLiteralWordId === token.id}
                    onmouseenter={() => (activeLiteralWordId = token.id)}
                    onfocusin={() => (activeLiteralWordId = token.id)}
                    onmouseleave={() => (activeLiteralWordId = null)}
                    onfocusout={() => (activeLiteralWordId = null)}
                  >
                    <span class="literal-source">
                      <DictionaryText
                        text={token.text}
                        language={sourceLanguage}
                        filoDoc={document}
                        baseByteOffset={token.start}
                      />
                    </span>
                    <span class="literal-gloss">{token.literal}</span>
                  </span>
                {:else}
                  <span class="literal-text">{token.text}</span>
                {/if}
              {/each}
            </span>
            {#if activeSentenceId === sentence.id}
              <span class="sentence-popover" role="tooltip">
                <span class="popover-title"><FiloText text="Sentence" role="popover-title" /></span>
                <button type="button" onclick={() => playSpan(`sentence:${sentence.id}`, sentence.text, sentence)}>
                  {audioByKey[`sentence:${sentence.id}`]?.loading
                    ? "…"
                    : audioByKey[`sentence:${sentence.id}`]?.playing
                      ? "stop"
                      : "audio"}
                </button>
                <span class="label"><FiloText text="Good translation" role="popover-label" /></span>
                <span>{sentence.proper || "No proper translation available."}</span>
                <span class="label"><FiloText text="Literal dictionary gloss" role="popover-label" /></span>
                <span>{sentence.literal || "No literal gloss available."}</span>
              </span>
            {/if}
          </span>{" "}
        {/each}
      </div>
    </section>

    <section class="analysis-grid">
      <div class="analysis-card">
        <div class="section-heading">
          <h2><FiloText text="Phrase spans" role="section-heading" /></h2>
          <span><FiloText text="Phrase-level proper and literal translations." role="section-description" /></span>
        </div>
        <div class="span-list">
          {#each phrases as phrase}
            <article
              class="span-row"
              onmouseenter={() =>
                recordWorkbenchInteraction("encounter", "workbench_definition", phrase, true)}
            >
              <div>
                <strong>{phrase.text}</strong>
                <p>{phrase.proper || "No proper translation available."}</p>
                <small>{phrase.literal || "No literal gloss available."}</small>
              </div>
              <button type="button" onclick={() => playSpan(`phrase:${phrase.id}`, phrase.text, phrase)}>
                {audioByKey[`phrase:${phrase.id}`]?.loading
                  ? "…"
                  : audioByKey[`phrase:${phrase.id}`]?.playing
                    ? "stop"
                    : "audio"}
              </button>
            </article>
          {/each}
        </div>
      </div>

      <div class="analysis-card">
        <div class="section-heading">
          <h2><FiloText text="Word dictionary" role="section-heading" /></h2>
          <span><FiloText text="Filo dictionary tier aligned to byte offsets." role="section-description" /></span>
        </div>
        <div class="word-table">
          {#each words as word}
            <a
              class="word-row"
              href={word.href}
              onmouseenter={() =>
                recordWorkbenchInteraction("encounter", "workbench_definition", word, true)}
            >
              <strong>{word.surface}</strong>
              <span>{word.lemma}</span>
              <span>{word.definition || "No definition found"}</span>
              {#if word.form}
                <small>{word.form}</small>
              {/if}
            </a>
          {/each}
        </div>
      </div>
    </section>
  {/if}
</section>

<style>
  .workbench {
    height: 100%;
    padding: var(--space-6);
    overflow-y: auto;
    background: var(--color-bg);
  }

  .workbench-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-5);
    max-width: 58rem;
    margin-bottom: var(--space-5);
  }

  .new-document-button {
    flex: 0 0 auto;
    min-height: 2.25rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-accent);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    padding: 0 var(--space-3);
  }

  .new-document-button:hover {
    background: var(--color-bg);
  }

  .eyebrow {
    margin: 0 0 var(--space-2);
    color: var(--color-accent);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    text-transform: uppercase;
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    font-size: clamp(2rem, 4vw, 3.5rem);
    letter-spacing: -0.05em;
  }

  h2 {
    font-size: var(--text-lg);
  }

  .lede {
    max-width: 44rem;
    margin-top: var(--space-3);
    color: var(--color-text-muted);
    font-size: var(--text-md);
  }

  .input-card,
  .surface-card,
  .analysis-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .input-card {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-5);
  }

  .document-card {
    background: var(--color-panel);
  }

  .document-meta {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .document-meta div {
    display: grid;
    gap: var(--space-1);
  }

  .document-meta span {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    text-transform: uppercase;
  }

  .document-meta strong {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }

  .read-only-text {
    max-height: 14rem;
    overflow: auto;
    margin: 0;
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .field-row {
    display: grid;
    grid-template-columns: minmax(12rem, 1fr) minmax(10rem, 14rem) minmax(10rem, 14rem);
    gap: var(--space-3);
  }

  label {
    display: grid;
    gap: var(--space-2);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    text-transform: uppercase;
  }

  input,
  select,
  textarea {
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    color: var(--color-text);
    font: inherit;
  }

  input,
  select {
    min-height: 2.5rem;
    padding: 0 var(--space-3);
  }

  textarea {
    min-height: 10rem;
    padding: var(--space-3);
    resize: vertical;
    line-height: 1.45;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .audio-button,
  .sentence-popover button,
  .span-row button {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    color: var(--color-text);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--text-caption);
  }

  .audio-button,
  .span-row button {
    min-height: 2rem;
    padding: 0 var(--space-3);
  }

  .error {
    color: var(--color-error);
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-3);
    margin: var(--space-5) 0;
  }

  .summary-grid > div {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
  }

  .summary-grid span,
  .section-heading span {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }

  .summary-grid strong {
    font-size: var(--text-xl);
    font-weight: var(--font-medium);
  }

  .surface-card {
    padding: var(--space-5);
  }

  .section-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
  }

  .text-surface {
    max-width: 64rem;
    font-size: clamp(1.25rem, 2.2vw, 2rem);
    line-height: 1.55;
    white-space: pre-wrap;
  }

  .sentence-wrap {
    position: relative;
    border-radius: var(--radius-sm);
  }

  .sentence-wrap:hover {
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }

  .interlinear-sentence {
    white-space: pre-wrap;
  }

  .literal-word {
    display: inline-flex;
    min-width: 1.7rem;
    min-height: 3.1rem;
    flex-direction: column;
    justify-content: flex-start;
    gap: 0.05rem;
    margin: 0 0.08rem 0.18rem;
    padding: 0 0.12rem;
    border-radius: var(--radius-sm);
    vertical-align: top;
  }

  .literal-word:hover,
  .literal-word.active {
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
  }

  .literal-source {
    display: inline-block;
    color: var(--color-text);
    line-height: 1.15;
  }

  .literal-gloss {
    display: block;
    min-height: 1.05rem;
    max-width: 9rem;
    color: var(--color-text-muted);
    font-size: var(--text-caption);
    line-height: 1.05;
    overflow-wrap: anywhere;
  }

  .literal-word:hover .literal-source,
  .literal-word.active .literal-source {
    color: var(--color-accent);
  }

  .literal-word:hover .literal-gloss,
  .literal-word.active .literal-gloss {
    color: var(--color-text);
  }

  .literal-text {
    white-space: pre-wrap;
  }

  .sentence-popover {
    position: absolute;
    left: 0;
    top: calc(100% + 0.3rem);
    z-index: 40;
    display: grid;
    width: min(28rem, 80vw);
    gap: var(--space-2);
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    box-shadow: var(--shadow-lg);
    color: var(--color-text);
    font-size: var(--text-sm);
    line-height: 1.35;
  }

  .popover-title,
  .label {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    text-transform: uppercase;
  }

  .analysis-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.8fr);
    gap: var(--space-5);
    margin-top: var(--space-5);
  }

  .analysis-card {
    min-height: 24rem;
    padding: var(--space-5);
  }

  .span-list,
  .word-table {
    display: grid;
    gap: var(--space-2);
  }

  .span-row,
  .word-row {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
  }

  .span-row {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
  }

  .span-row p {
    margin-top: var(--space-1);
  }

  .span-row small,
  .word-row small {
    color: var(--color-text-muted);
  }

  .word-row {
    color: inherit;
    text-decoration: none;
  }

  .word-row:hover {
    border-color: var(--color-text);
  }

  .word-row span {
    color: var(--color-text-muted);
  }

  @media (max-width: 900px) {
    .field-row,
    .analysis-grid,
    .summary-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
