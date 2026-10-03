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
    loadRecentWorkbenchStates,
    loadSavedWorkbenchStateById,
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
    properties: GrammarPropertyView[];
  }

  type LiteralToken =
    | { kind: "text"; id: string; text: string }
    | {
        kind: "word";
        id: string;
        start: number;
        end: number;
        text: string;
        literal: string;
        notFound: boolean;
        properties: GrammarPropertyView[];
        trailingPunctuation: string;
      };

  interface SpanMapSegment {
    id: string;
    text: string;
    spanId: string | null;
    spanIndex: number;
    start: number;
    end: number;
  }

  const SPAN_MAP_TIERS = ["sentence", "phrase", "word"] as const;
  type SpanMapTierId = (typeof SPAN_MAP_TIERS)[number];

  interface GrammarReferenceView {
    label: string;
    url: string;
    source: string;
    kind: string;
  }

  interface GrammarPropertyView {
    id: string;
    start: number;
    end: number;
    text: string;
    category: string;
    conceptId: string;
    label: string;
    description: string;
    dimension: string;
    level: "word" | "phrase" | "sentence";
    references: GrammarReferenceView[];
  }

  interface WordView {
    id: string;
    start: number;
    end: number;
    surface: string;
    lemma: string;
    definition: string;
    form: string;
    lookupStatus: "found" | "not-found" | "error";
    lookupError: string;
    href: string;
    properties: GrammarPropertyView[];
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
  const maxTranslatedSpans = 80;
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
  let pinnedSentenceId = $state<string | null>(null);
  let activeLiteralWordId = $state<string | null>(null);
  let sourceFiloDoc = $state<FiloDocumentJson | null>(null);
  let audioByKey = $state<Record<string, AudioState>>({});
  let recentWorkbenchStates = $state<SavedWorkbenchState[]>([]);
  let appliedRoute = "";
  let loadedSavedWorkbench = false;
  let sentenceHideTimer: ReturnType<typeof setTimeout> | null = null;
  const trackedInteractionKeys = new Set<string>();
  let showSpanMap = $state(false);
  let spanMapTier = $state<SpanMapTierId>("sentence");

  const document = $derived(result?.document ?? null);
  const sentences = $derived.by(() => spanViews(document, "sentence", "sentence"));
  const activeSentence = $derived(
    sentences.find((sentence) => sentence.id === activeSentenceId) ?? null,
  );
  const phrases = $derived.by(() => spanViews(document, "phrase", "phrase"));
  const words = $derived.by(() => wordViews(document, sourceLanguage));
  const grammarProperties = $derived.by(() => grammarPropertyViews(document));
  const spanMapSegments = $derived.by(() => buildSpanMap(document, spanMapTier));

  $effect(() => {
    refreshRecentWorkbenchStates();
  });

  $effect(() => {
    if (!route || route === appliedRoute) return;
    appliedRoute = route;
    const saved = loadSavedWorkbenchStateById(route);
    if (saved) {
      loadedSavedWorkbench = true;
      applySavedWorkbenchState(saved);
      saveWorkbenchState(saved);
      refreshRecentWorkbenchStates();
      if ((saved.autoAnalyze && !saved.result) || savedNeedsAnalysisRefresh(saved)) {
        setTimeout(() => {
          void analyze();
        }, 0);
      }
      return;
    }

    const payload = parseWorkbenchRoute(route);
    if (!payload) {
      if (route.startsWith("w-")) {
        loadedSavedWorkbench = true;
        error = "Workbench document not found on this device.";
      }
      return;
    }

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
    pinnedSentenceId = null;
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
    if (savedNeedsAnalysisRefresh(saved)) {
      setTimeout(() => {
        void analyze();
      }, 0);
    }
  });

  async function analyze() {
    const cleanText = text.trim();
    if (!cleanText || loading) return;
    loading = true;
    error = "";
    activeSentenceId = null;
    pinnedSentenceId = null;
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
    pinnedSentenceId = null;
    activeLiteralWordId = null;
    sourceFiloDoc = null;
    audioByKey = {};
    trackedInteractionKeys.clear();
    appliedRoute = "";
    loadedSavedWorkbench = true;
    refreshRecentWorkbenchStates();
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
    pinnedSentenceId = null;
    activeLiteralWordId = null;
    audioByKey = {};
    trackedInteractionKeys.clear();
  }

  function saveCurrentWorkbenchState(nextResult: WorkbenchAnalyzeResponse | null = result) {
    const cleanText = text.trim();
    if (!cleanText) return;
    const saved = saveWorkbenchState({
      title,
      text: cleanText,
      sourceLanguage,
      targetLanguage,
      filoDoc: nextResult?.document ?? sourceFiloDoc,
      result: nextResult,
    });
    refreshRecentWorkbenchStates();
    if (saved) {
      appliedRoute = saved.workbenchId;
      onRouteChange?.(saved.workbenchId);
    }
  }

  function refreshRecentWorkbenchStates() {
    recentWorkbenchStates = loadRecentWorkbenchStates();
  }

  function openRecentWorkbenchState(saved: SavedWorkbenchState) {
    applySavedWorkbenchState(saved);
    const opened = saveWorkbenchState(saved) ?? saved;
    refreshRecentWorkbenchStates();
    appliedRoute = opened.workbenchId;
    loadedSavedWorkbench = true;
    onRouteChange?.(opened.workbenchId);
    if ((opened.autoAnalyze && !opened.result) || savedNeedsAnalysisRefresh(opened)) {
      setTimeout(() => {
        void analyze();
      }, 0);
    }
  }

  function workbenchHref(saved: SavedWorkbenchState): string {
    return `#/workbench/${encodeURIComponent(saved.workbenchId)}`;
  }

  function shouldHandleLinkClick(event: MouseEvent): boolean {
    return (
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    );
  }

  function recentDocumentKey(saved: SavedWorkbenchState): string {
    return [saved.sourceLanguage, saved.targetLanguage ?? "", saved.text].join(
      "\u0000",
    );
  }

  function recentDocumentMeta(saved: SavedWorkbenchState): string {
    const pieces = [
      `${langTag(saved.sourceLanguage)} -> ${langTag(saved.targetLanguage ?? "")}`,
      formatRecentDate(saved.savedAt),
    ];
    if (saved.result) pieces.splice(1, 0, `${saved.result.summary.words} words`);
    return pieces.filter(Boolean).join(" · ");
  }

  function recentDocumentPreview(saved: SavedWorkbenchState): string {
    const compact = saved.text.replace(/\s+/g, " ").trim();
    return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
  }

  function isCurrentRecentDocument(saved: SavedWorkbenchState): boolean {
    return (
      saved.text === text.trim() &&
      saved.sourceLanguage === sourceLanguage &&
      (saved.targetLanguage ?? "") === (targetLanguage ?? "")
    );
  }

  function formatRecentDate(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function savedNeedsAnalysisRefresh(saved: SavedWorkbenchState): boolean {
    const savedTargetLanguage = saved.targetLanguage ?? saved.result?.summary.targetLanguage ?? "";
    return (
      !!saved.result &&
      !!savedTargetLanguage &&
      (hasDictionaryLookupErrors(saved.result.document) ||
        !hasGrammarTier(saved.result.document) ||
        !hasProperTranslationCoverage(saved.result.document, savedTargetLanguage) ||
        hasMissingLiteralFallbacks(saved.result.document, savedTargetLanguage, saved.sourceLanguage))
    );
  }

  function hasGrammarTier(doc: FiloDocumentJson): boolean {
    return doc.tiers.some((candidate) => candidate.id === "grammar");
  }

  function hasDictionaryLookupErrors(doc: FiloDocumentJson): boolean {
    return tier(doc, "dictionary").some(
      (annotation) =>
        stringValue(annotation.payload.lookupStatus) === "error" ||
        !!stringValue(annotation.payload.lookupError),
    );
  }

  function hasProperTranslationCoverage(doc: FiloDocumentJson, target: string): boolean {
    return (
      hasTranslationCoverage(doc, "sentence", `sentence.translation:${target}:proper`) &&
      hasTranslationCoverage(doc, "phrase", `phrase.translation:${target}:proper`)
    );
  }

  function hasTranslationCoverage(
    doc: FiloDocumentJson,
    sourceTierId: string,
    translationTierId: string,
  ): boolean {
    const sourceAnnotations = tier(doc, sourceTierId).slice(0, maxTranslatedSpans);
    if (sourceAnnotations.length === 0) return true;
    const translatedRanges = new Set(
      tier(doc, translationTierId)
        .filter((annotation) => stringValue(annotation.payload.text))
        .map((annotation) => rangeKey(annotation)),
    );
    return sourceAnnotations.every((annotation) => translatedRanges.has(rangeKey(annotation)));
  }

  function hasMissingLiteralFallbacks(
    doc: FiloDocumentJson,
    target: string,
    source: string,
  ): boolean {
    const notFoundLiteralWordIds = new Set<string>();
    const notFoundLiteralRanges = new Set<string>();
    for (const annotation of tier(doc, `word.translation:${target}:literal`)) {
      if (annotation.payload.notFound !== true) continue;
      const sourceWordAnnotationId = stringValue(annotation.payload.sourceWordAnnotationId);
      if (sourceWordAnnotationId) notFoundLiteralWordIds.add(sourceWordAnnotationId);
      notFoundLiteralRanges.add(rangeKey(annotation));
    }

    return tier(doc, "dictionary").some((annotation) => {
      if (!isDictionaryMiss(annotation, doc, source)) return false;
      const wordAnnotationId = stringValue(annotation.payload.wordAnnotationId);
      if (wordAnnotationId && notFoundLiteralWordIds.has(wordAnnotationId)) return false;
      return !notFoundLiteralRanges.has(rangeKey(annotation));
    });
  }

  function isDictionaryMiss(
    annotation: FiloAnnotationJson,
    doc: FiloDocumentJson,
    source: string,
  ): boolean {
    if (annotation.payload.notFound === true) return true;
    const definitions = Array.isArray(annotation.payload.definitions)
      ? annotation.payload.definitions
      : [];
    if (definitions.some((definition) => stringValue(definition))) return false;
    if (stringValue(annotation.payload.sourceTerm) || stringValue(annotation.payload.source_term)) {
      return false;
    }
    if (
      stringValue(annotation.payload.formDescription) ||
      stringValue(annotation.payload.form_description) ||
      stringValue(annotation.payload.sourceUrl) ||
      stringValue(annotation.payload.source_url)
    ) {
      return false;
    }
    const surface = stringValue(annotation.payload.surface) || textOf(doc, annotation);
    const lemma = stringValue(annotation.payload.lemma);
    return !!surface && (!lemma || equivalentText(lemma, surface, source));
  }

  function equivalentText(left: string, right: string, locale: string): boolean {
    return normalizeComparable(left, locale) === normalizeComparable(right, locale);
  }

  function normalizeComparable(value: string, locale: string): string {
    return value
      .replace(/\s+/gu, " ")
      .replace(/[.,;:!?()[\]{}"“”'’`]+/gu, "")
      .trim()
      .toLocaleLowerCase(locale || undefined);
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
      properties: grammarPropertiesForRange(doc, span, level),
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
    const literalByWordId = new Map<string, { text: string; notFound: boolean }>();
    const literalByRange = new Map<string, { text: string; notFound: boolean }>();
    for (const annotation of tier(doc, `word.translation:${target}:literal`)) {
      const literal = stringValue(annotation.payload.text);
      const literalValue = {
        text: literal,
        notFound: annotation.payload.notFound === true,
      };
      const sourceWordAnnotationId = stringValue(annotation.payload.sourceWordAnnotationId);
      if (sourceWordAnnotationId) literalByWordId.set(sourceWordAnnotationId, literalValue);
      literalByRange.set(rangeKey(annotation), literalValue);
    }

    const tokens: LiteralToken[] = [];
    let cursor = span.start;
    for (const word of words) {
      if (cursor < word.start) {
        pushGapText(tokens, textOf(doc, { start: cursor, end: word.start }), cursor);
      }
      const literal = literalByWordId.get(word.id) ?? literalByRange.get(rangeKey(word));
      tokens.push({
        kind: "word",
        id: word.id,
        start: word.start,
        end: word.end,
        text: textOf(doc, word),
        literal: literal?.text ?? "",
        notFound: literal?.notFound ?? false,
        properties: grammarPropertiesForRange(doc, word, "word"),
        trailingPunctuation: "",
      });
      cursor = word.end;
    }
    if (cursor < span.end) {
      pushGapText(tokens, textOf(doc, { start: cursor, end: span.end }), cursor);
    }
    return tokens;
  }

  // Punctuation directly after a word (e.g. the "." in "könyvtárban.") is its
  // own inline-flex sibling once words are stacked with a gloss underneath,
  // so it can wrap onto its own line as an orphan. Attach it to the
  // preceding word's box instead, so it always wraps together with it.
  function pushGapText(tokens: LiteralToken[], text: string, start: number): void {
    if (!text) return;
    const attached = /^[^\s\p{L}\p{M}]+/u.exec(text)?.[0] ?? "";
    const previous = tokens[tokens.length - 1];
    if (attached && previous?.kind === "word") {
      previous.trailingPunctuation += attached;
      const rest = text.slice(attached.length);
      if (rest) tokens.push({ kind: "text", id: `text:${start}:${tokens.length}`, text: rest });
      return;
    }
    tokens.push({ kind: "text", id: `text:${start}:${tokens.length}`, text });
  }

  function wordViews(doc: FiloDocumentJson | null, language: string): WordView[] {
    if (!doc) return [];
    return tier(doc, "dictionary").map((annotation) => {
      const payload = annotation.payload;
      const surface = stringValue(payload.surface) || textOf(doc, annotation);
      const lemma = stringValue(payload.lemma) || stringValue(payload.sourceTerm) || surface;
      const definition = firstString(payload.definitions) || "";
      const form = stringValue(payload.formDescription);
      const lookupStatus = lookupStatusForPayload(payload, definition);
      return {
        id: annotation.id,
        start: annotation.start,
        end: annotation.end,
        surface,
        lemma,
        definition,
        form,
        lookupStatus,
        lookupError: stringValue(payload.lookupError),
        href: `#/dictionary/${encodeURIComponent(language)}/${encodeURIComponent(lemma)}`,
        properties: grammarPropertiesForRange(doc, annotation, "word"),
      };
    });
  }

  function grammarPropertiesForRange(
    doc: FiloDocumentJson,
    range: { start: number; end: number },
    level: GrammarPropertyView["level"],
  ): GrammarPropertyView[] {
    return grammarPropertyViews(doc).filter(
      (property) =>
        property.level === level && property.start === range.start && property.end === range.end,
    );
  }

  function grammarPropertyViews(doc: FiloDocumentJson | null): GrammarPropertyView[] {
    if (!doc) return [];
    return tier(doc, "grammar").map((annotation) => {
      const payload = annotation.payload;
      const category = stringValue(payload.category);
      return {
        id: annotation.id,
        start: annotation.start,
        end: annotation.end,
        text: stringValue(payload.text) || textOf(doc, annotation),
        category,
        conceptId: stringValue(payload.conceptId) || stringValue(payload.concept_id),
        label: stringValue(payload.label) || humanizeGrammarCategory(category),
        description: stringValue(payload.description),
        dimension: stringValue(payload.dimension),
        level: grammarLevel(payload.level),
        references: grammarReferenceViews(payload.references),
      };
    });
  }

  function grammarLevel(value: unknown): GrammarPropertyView["level"] {
    return value === "sentence" || value === "phrase" || value === "word" ? value : "phrase";
  }

  function grammarReferenceViews(value: unknown): GrammarReferenceView[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => {
        const link = item as Record<string, unknown>;
        return {
          label: stringValue(link.label),
          url: stringValue(link.url),
          source: stringValue(link.source),
          kind: stringValue(link.kind),
        };
      })
      .filter((link) => link.label && link.url);
  }

  function humanizeGrammarCategory(category: string): string {
    return category
      .split(":")
      .filter(Boolean)
      .map((part) =>
        part
          .replace(/[._-]+/g, " ")
          .replace(/\b\w/g, (char) => char.toLocaleUpperCase()),
      )
      .join(": ");
  }

  function linkTarget(url: string): "_blank" | undefined {
    return /^https?:\/\//u.test(url) ? "_blank" : undefined;
  }

  function lookupStatusForPayload(
    payload: Record<string, unknown>,
    definition: string,
  ): "found" | "not-found" | "error" {
    const status = stringValue(payload.lookupStatus);
    if (status === "found" || status === "not-found" || status === "error") return status;
    if (payload.notFound === true) return "not-found";
    return definition ? "found" : "not-found";
  }

  function dictionaryStatusText(word: WordView): string {
    if (word.definition) return word.definition;
    if (word.lookupStatus === "error") return "Lookup failed";
    if (word.lookupStatus === "found") return "No definition in entry";
    return "No dictionary entry found";
  }

  /**
   * Lay the whole document out as a flat sequence of segments, one per span
   * of the chosen tier (plus a segment for any gap the tier doesn't cover),
   * so the parser's actual span boundaries can be inspected directly.
   */
  function buildSpanMap(doc: FiloDocumentJson | null, tierId: SpanMapTierId): SpanMapSegment[] {
    if (!doc) return [];
    const spans = tier(doc, tierId);
    const segments: SpanMapSegment[] = [];
    let cursor = 0;
    spans.forEach((span, index) => {
      if (cursor < span.start) {
        segments.push({
          id: `gap:${cursor}:${span.start}`,
          text: textOf(doc, { start: cursor, end: span.start }),
          spanId: null,
          spanIndex: -1,
          start: cursor,
          end: span.start,
        });
      }
      segments.push({
        id: span.id,
        text: textOf(doc, span),
        spanId: span.id,
        spanIndex: index,
        start: span.start,
        end: span.end,
      });
      cursor = span.end;
    });
    if (cursor < doc.byteLength) {
      segments.push({
        id: `gap:${cursor}:${doc.byteLength}`,
        text: textOf(doc, { start: cursor, end: doc.byteLength }),
        spanId: null,
        spanIndex: -1,
        start: cursor,
        end: doc.byteLength,
      });
    }
    return segments;
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
    if (pinnedSentenceId && pinnedSentenceId !== sentence.id) return;
    keepSentenceOpen();
    activeSentenceId = sentence.id;
    void recordWorkbenchInteraction("encounter", "workbench_definition", sentence, true);
  }

  function hideSentenceSoon() {
    if (pinnedSentenceId) return;
    if (sentenceHideTimer) clearTimeout(sentenceHideTimer);
    sentenceHideTimer = setTimeout(() => {
      activeSentenceId = null;
      activeLiteralWordId = null;
      sentenceHideTimer = null;
    }, 180);
  }

  function keepSentenceOpen() {
    if (!sentenceHideTimer) return;
    clearTimeout(sentenceHideTimer);
    sentenceHideTimer = null;
  }

  function toggleSentence(sentence: SpanView) {
    keepSentenceOpen();
    if (pinnedSentenceId === sentence.id) {
      pinnedSentenceId = null;
      activeSentenceId = null;
      activeLiteralWordId = null;
      return;
    }
    pinnedSentenceId = sentence.id;
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
    if (sentenceHideTimer) clearTimeout(sentenceHideTimer);
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

  {#if recentWorkbenchStates.length}
    <section class="recent-documents" aria-label="Recent workbench documents">
      <div class="recent-heading">
        <h2><FiloText text="Recent documents" role="section-heading" /></h2>
      </div>
      <div class="recent-list">
        {#each recentWorkbenchStates as saved (recentDocumentKey(saved))}
          <a
            class="recent-document"
            class:active={isCurrentRecentDocument(saved)}
            href={workbenchHref(saved)}
            onclick={(event) => {
              if (!shouldHandleLinkClick(event)) return;
              event.preventDefault();
              openRecentWorkbenchState(saved);
            }}
          >
            <span class="recent-title">{saved.title || "Workbench document"}</span>
            <span class="recent-meta">{recentDocumentMeta(saved)}</span>
            <span class="recent-preview">{recentDocumentPreview(saved)}</span>
          </a>
        {/each}
      </div>
    </section>
  {/if}

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
        <span><FiloText text="Original text with word-aligned literal glosses. Hover a word for its gloss and dictionary entry." role="section-description" /></span>
      </div>
      <div class="span-map-toggle">
        <button
          type="button"
          class:active={showSpanMap}
          aria-pressed={showSpanMap}
          onclick={() => (showSpanMap = !showSpanMap)}
        >{showSpanMap ? "Hide parse spans" : "Visualize parse spans"}</button>
        {#if showSpanMap}
          <div class="span-map-tiers" role="tablist" aria-label="Span tier">
            {#each SPAN_MAP_TIERS as tierId}
              <button
                type="button"
                role="tab"
                aria-selected={spanMapTier === tierId}
                class:active={spanMapTier === tierId}
                onclick={() => (spanMapTier = tierId)}
              >{tierId}</button>
            {/each}
          </div>
        {/if}
      </div>
      {#if showSpanMap}
        <div class="span-map" aria-label={`${spanMapTier} span map`}>
          {#each spanMapSegments as segment (segment.id)}
            <span
              class="span-segment"
              class:covered={segment.spanId !== null}
              class:alt={segment.spanIndex % 2 === 1}
              title={
                segment.spanId
                  ? `${spanMapTier} span · bytes ${segment.start}-${segment.end}`
                  : `uncovered by ${spanMapTier} tier · bytes ${segment.start}-${segment.end}`
              }
            >{segment.text}</span>
          {/each}
        </div>
      {/if}
      <div class="surface-layout">
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
          {#each sentences as sentence, sentenceIndex}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="sentence-row"
              class:active={activeSentenceId === sentence.id}
              onmouseenter={() => showSentence(sentence)}
              onmouseleave={hideSentenceSoon}
            >
              <button
                class="sentence-handle"
                class:pinned={pinnedSentenceId === sentence.id}
                type="button"
                title="Show this sentence's full explanation"
                aria-label={`Show explanation for sentence ${sentenceIndex + 1}`}
                aria-pressed={pinnedSentenceId === sentence.id}
                onfocus={() => showSentence(sentence)}
                onblur={hideSentenceSoon}
                onclick={() => toggleSentence(sentence)}
              >{sentenceIndex + 1}</button>
              <span class="sentence-wrap">
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
                          />{token.trailingPunctuation}</span>
                        <span
                          class="literal-gloss"
                          class:notFound={token.notFound}
                          title={token.notFound ? "No dictionary gloss found; source word shown verbatim" : undefined}
                        >{token.literal}</span>
                      </span>
                    {:else}
                      <span class="literal-text">{token.text}</span>
                    {/if}
                  {/each}
                </span>
              </span>
            </div>
          {/each}
        </div>

        <aside
          class="sentence-inspector"
          class:populated={!!activeSentence}
          aria-live="polite"
          onmouseenter={keepSentenceOpen}
          onmouseleave={hideSentenceSoon}
        >
          {#if activeSentence}
            <div class="inspector-heading">
              <span class="popover-title">
                <FiloText text={`Sentence ${sentences.findIndex((sentence) => sentence.id === activeSentence.id) + 1}`} role="popover-title" />
              </span>
              <button
                type="button"
                onclick={() => playSpan(`sentence:${activeSentence.id}`, activeSentence.text, activeSentence)}
              >
                {audioByKey[`sentence:${activeSentence.id}`]?.loading
                  ? "…"
                  : audioByKey[`sentence:${activeSentence.id}`]?.playing
                    ? "stop"
                    : "audio"}
              </button>
            </div>
            <strong class="inspector-source">{activeSentence.text}</strong>
            {#if activeSentence.proper}
              <span class="label"><FiloText text="Good translation" role="popover-label" /></span>
              <span>{activeSentence.proper}</span>
            {/if}
            {#if activeSentence.literal}
              <span class="label"><FiloText text="Literal dictionary gloss" role="popover-label" /></span>
              <span>{activeSentence.literal}</span>
            {/if}
            {#if activeSentence.properties.length}
              <span class="label"><FiloText text="Grammar" role="popover-label" /></span>
              <span class="grammar-chips">
                {#each activeSentence.properties as property}
                  <span class="grammar-chip" title={property.description}>{property.label}</span>
                {/each}
              </span>
            {/if}
          {:else}
            <span class="popover-title"><FiloText text="Sentence explanation" role="popover-title" /></span>
            <span class="inspector-empty">
              Hover a sentence to see its full translation and grammar. Select its number to keep the explanation open.
            </span>
          {/if}
        </aside>
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
                {#if phrase.proper}
                  <p>{phrase.proper}</p>
                {/if}
                {#if phrase.literal}
                  <small>{phrase.literal}</small>
                {/if}
                {#if phrase.properties.length}
                  <div class="grammar-chips">
                    {#each phrase.properties as property}
                      <span class="grammar-chip" title={property.description}>{property.label}</span>
                    {/each}
                  </div>
                {/if}
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
              class:lookupError={word.lookupStatus === "error"}
              class:notFound={word.lookupStatus === "not-found"}
              href={word.href}
              title={word.lookupStatus === "error" && word.lookupError ? word.lookupError : undefined}
              onmouseenter={() =>
                recordWorkbenchInteraction("encounter", "workbench_definition", word, true)}
            >
              <strong>{word.surface}</strong>
              <span>{word.lemma}</span>
              <span>{dictionaryStatusText(word)}</span>
              {#if word.form}
                <small>{word.form}</small>
              {/if}
              {#if word.properties.length}
                <span class="grammar-chips compact">
                  {#each word.properties as property}
                    <span class="grammar-chip" title={property.description}>{property.label}</span>
                  {/each}
                </span>
              {/if}
            </a>
          {/each}
        </div>
      </div>

      {#if grammarProperties.length}
        <div class="analysis-card">
          <div class="section-heading">
            <h2><FiloText text="Grammar properties" role="section-heading" /></h2>
            <span><FiloText text="Concept annotations aligned to sentence, phrase, and word spans." role="section-description" /></span>
          </div>
          <div class="grammar-list">
            {#each grammarProperties as property}
              <article
                class="grammar-row"
                onmouseenter={() =>
                  recordWorkbenchInteraction("encounter", "workbench_definition", property, true)}
              >
                <div class="grammar-main">
                  <strong>{property.label}</strong>
                  <span>{property.level} · {property.text}</span>
                  {#if property.description}
                    <small>{property.description}</small>
                  {/if}
                  <code>{property.conceptId || property.category}</code>
                </div>
                {#if property.references.length}
                  <div class="grammar-links">
                    {#each property.references as link}
                      <a
                        href={link.url}
                        target={linkTarget(link.url)}
                        rel={linkTarget(link.url) ? "noreferrer" : undefined}
                      >
                        {link.label}
                        <span>{link.source}</span>
                      </a>
                    {/each}
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        </div>
      {/if}
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

  .recent-documents {
    display: grid;
    max-width: 58rem;
    gap: var(--space-3);
    margin: 0 0 var(--space-5);
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-panel);
  }

  .recent-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .recent-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: var(--space-2);
  }

  .recent-document {
    display: grid;
    min-height: 7rem;
    gap: var(--space-1);
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
    text-align: left;
    text-decoration: none;
  }

  .recent-document:hover,
  .recent-document.active {
    border-color: var(--color-accent);
  }

  .recent-title {
    overflow: hidden;
    font-weight: var(--font-medium);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .recent-meta {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    line-height: 1.3;
  }

  .recent-preview {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    line-height: 1.35;
    overflow-wrap: anywhere;
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
  .sentence-inspector button,
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

  .surface-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(17rem, 22rem);
    align-items: start;
    gap: var(--space-5);
  }

  .section-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
  }

  .span-map-toggle {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }

  .span-map-toggle > button,
  .span-map-tiers button {
    min-height: 1.9rem;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    color: var(--color-text-muted);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    text-transform: uppercase;
  }

  .span-map-toggle > button.active,
  .span-map-tiers button.active {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-bg));
    color: var(--color-accent);
  }

  .span-map-tiers {
    display: flex;
    gap: var(--space-1);
  }

  .span-map {
    margin-bottom: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    font-size: var(--text-md);
    line-height: 1.8;
    white-space: pre-wrap;
  }

  .span-segment {
    border-radius: 2px;
  }

  .span-segment.covered {
    background: color-mix(in srgb, var(--color-accent) 16%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 32%, transparent);
  }

  .span-segment.covered.alt {
    background: color-mix(in srgb, var(--color-accent) 30%, transparent);
  }

  .text-surface {
    display: grid;
    min-width: 0;
    gap: var(--space-2);
    font-size: clamp(1.25rem, 2.2vw, 2rem);
    line-height: 1.55;
    white-space: pre-wrap;
  }

  .sentence-row {
    display: grid;
    grid-template-columns: 1.7rem minmax(0, 1fr);
    align-items: start;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
  }

  .sentence-row:hover,
  .sentence-row.active {
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }

  .sentence-handle {
    display: inline-grid;
    place-items: center;
    width: 1.65rem;
    height: 1.65rem;
    margin-top: 0.05rem;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    color: var(--color-text-muted);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    line-height: 1;
  }

  .sentence-handle:hover,
  .sentence-handle:focus-visible,
  .sentence-handle.pinned {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-bg));
    color: var(--color-accent);
    outline: none;
  }

  .sentence-wrap {
    min-width: 0;
    border-radius: var(--radius-sm);
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
    opacity: 0;
    overflow-wrap: anywhere;
    transition: opacity 100ms ease;
  }

  .literal-word:hover .literal-gloss,
  .literal-word.active .literal-gloss,
  .literal-word:focus-within .literal-gloss {
    opacity: 1;
  }

  .literal-gloss.notFound {
    color: color-mix(in srgb, var(--color-text-muted) 72%, transparent);
    font-family: var(--font-serif, serif);
    font-style: italic;
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

  .sentence-inspector {
    position: sticky;
    top: var(--space-4);
    display: grid;
    min-height: 12rem;
    gap: var(--space-2);
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    color: var(--color-text);
    font-size: var(--text-sm);
    line-height: 1.35;
  }

  .sentence-inspector.populated {
    border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
  }

  .sentence-inspector button {
    min-height: 1.8rem;
    padding: 0 var(--space-2);
  }

  .inspector-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .inspector-source {
    font-size: var(--text-md);
    font-weight: var(--font-medium);
  }

  .inspector-empty {
    max-width: 28rem;
    color: var(--color-text-muted);
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
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-5);
    margin-top: var(--space-5);
  }

  .analysis-card {
    min-height: 24rem;
    padding: var(--space-5);
  }

  .span-list,
  .word-table,
  .grammar-list {
    display: grid;
    gap: var(--space-2);
  }

  .span-row,
  .word-row,
  .grammar-row {
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

  .grammar-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .span-row p {
    margin-top: var(--space-1);
  }

  .span-row small,
  .word-row small,
  .grammar-row small {
    color: var(--color-text-muted);
  }

  .word-row {
    color: inherit;
    text-decoration: none;
  }

  .word-row:hover {
    border-color: var(--color-text);
  }

  .word-row.lookupError {
    border-color: color-mix(in srgb, var(--color-danger, #b00020) 42%, var(--color-border));
  }

  .word-row.lookupError span {
    color: var(--color-danger, #b00020);
  }

  .word-row.notFound span {
    font-style: italic;
  }

  .word-row span {
    color: var(--color-text-muted);
  }

  .grammar-chips {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-2);
  }

  .grammar-chips.compact {
    margin-top: 0;
  }

  .grammar-chip {
    display: inline-flex;
    align-items: center;
    min-height: 1.35rem;
    padding: 0 var(--space-2);
    border: 1px solid color-mix(in srgb, var(--color-accent) 34%, var(--color-border));
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-accent) 8%, var(--color-bg));
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    line-height: 1;
  }

  .grammar-main {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }

  .grammar-main span {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }

  .grammar-main code {
    width: fit-content;
    max-width: 100%;
    overflow-wrap: anywhere;
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
  }

  .grammar-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .grammar-links a {
    display: inline-grid;
    gap: 0.1rem;
    min-height: 2rem;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text);
    font-size: var(--text-xs);
    text-decoration: none;
  }

  .grammar-links a:hover {
    border-color: var(--color-accent);
  }

  .grammar-links span {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
  }

  @media (max-width: 1100px) {
    .surface-layout {
      grid-template-columns: 1fr;
    }

    .sentence-inspector {
      position: static;
      min-height: 0;
    }
  }

  @media (max-width: 900px) {
    .field-row,
    .analysis-grid,
    .summary-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
