<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type {
    AudioDrillDocumentResponse,
    AudioDrillListItem,
  } from "../lib/api-contracts";
  import { api } from "../lib/api";
  import { session, type FiloAnnotationJson, type FiloDocumentJson } from "../lib/stores.svelte";
  import Button from "./ui/Button.svelte";
  import FiloText from "./FiloText.svelte";

  interface Props {
    route?: string;
    onRouteChange?: (route: string) => void;
  }

  interface SegmentRow {
    id: string;
    order: number;
    text: string;
    type: string;
    itemLevel: string;
    audioSource: string;
    language: string;
    segment: FiloAnnotationJson;
    generated: FiloAnnotationJson | null;
    audioId: string;
    provider: string;
    sourceStartMs: number | null;
    sourceEndMs: number | null;
    clipStartMs: number | null;
    clipEndMs: number | null;
    durationMs: number | null;
  }

  interface SoundAssetView {
    audioId: string;
    count: number;
    text: string;
    audioSource: string;
    provider: string;
    language: string;
    firstOrder: number;
    sourceStartMs: number | null;
    sourceEndMs: number | null;
    clipStartMs: number | null;
    clipEndMs: number | null;
  }

  let { route = "", onRouteChange }: Props = $props();

  let drills = $state<AudioDrillListItem[]>([]);
  let detail = $state<AudioDrillDocumentResponse | null>(null);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state("");
  let selectedDrillId = $state("");
  let selectedSegmentId = $state("");
  let sourceFilter = $state("all");
  let activeAudioKey = $state("");
  let dirty = $state(false);
  let appliedRoute = $state("");
  let currentAudio: HTMLAudioElement | null = null;
  let currentObjectUrl: string | null = null;

  const lesson = $derived(detail?.lesson ?? null);
  const source = $derived(detail?.source ?? null);
  const segmentRows = $derived(lesson ? buildSegmentRows(lesson) : []);
  const visibleSegmentRows = $derived(
    sourceFilter === "all"
      ? segmentRows
      : segmentRows.filter((row) => row.audioSource === sourceFilter),
  );
  const selectedRow = $derived(
    segmentRows.find((row) => row.id === selectedSegmentId) ?? segmentRows[0] ?? null,
  );
  const soundInventory = $derived(buildSoundInventory(segmentRows));
  const trackViews = $derived(lesson ? buildTrackViews(lesson) : []);
  const sourceWordCount = $derived(source ? tier(source, "word").length : 0);
  const sourcePhraseCount = $derived(source ? tier(source, "phrase").length : 0);
  const sourceSentenceCount = $derived(source ? tier(source, "sentence").length : 0);

  onMount(() => {
    void loadDrills();
  });

  $effect(() => {
    if (route === appliedRoute) return;
    appliedRoute = route;
    if (route) {
      void openDrill(route);
    }
  });

  onDestroy(stopAudio);

  async function loadDrills() {
    loading = true;
    error = "";
    try {
      const response = await api.getAudioDrills();
      drills = response.drills;
      const requested = route || response.drills[0]?.id || "";
      if (requested) await openDrill(requested);
    } catch (err) {
      error = errorMessage(err);
    } finally {
      loading = false;
    }
  }

  async function openDrill(id: string) {
    if (!id) return;
    loading = true;
    error = "";
    stopAudio();
    try {
      const response = await api.getAudioDrill(id);
      detail = cloneJson(response);
      selectedDrillId = response.drill.id;
      const firstSegment = response.lesson.tiers
        .find((entry) => entry.id === "lesson.segment")
        ?.annotations.sort(orderBySegment)[0];
      selectedSegmentId = firstSegment
        ? String(firstSegment.payload.segmentId ?? firstSegment.id)
        : "";
      dirty = false;
      appliedRoute = response.drill.id;
      onRouteChange?.(response.drill.id);
    } catch (err) {
      error = errorMessage(err);
    } finally {
      loading = false;
    }
  }

  async function saveLesson() {
    if (!detail || !dirty) return;
    saving = true;
    error = "";
    try {
      const response = await api.saveAudioDrillLesson(detail.drill.id, detail.lesson);
      detail = { ...detail, drill: response.drill, lesson: response.lesson };
      dirty = false;
    } catch (err) {
      error = errorMessage(err);
    } finally {
      saving = false;
    }
  }

  async function playFinalAudio() {
    if (!detail?.audioUrl) return;
    await playUrl("final", detail.audioUrl);
  }

  async function playClip(audioId: string) {
    if (!detail || !audioId) return;
    await playUrl(
      `clip:${audioId}`,
      `/api/audio-drills/${encodeURIComponent(detail.drill.id)}/clips/${audioId}`,
    );
  }

  async function playUrl(key: string, url: string) {
    if (activeAudioKey === key && currentAudio) {
      stopAudio();
      return;
    }
    stopAudio();
    try {
      const objectUrl = await fetchAudioObjectUrl(url);
      const audio = new Audio(objectUrl);
      currentAudio = audio;
      currentObjectUrl = objectUrl;
      activeAudioKey = key;
      audio.onended = stopAudio;
      audio.onerror = stopAudio;
      await audio.play();
    } catch (err) {
      stopAudio();
      error = errorMessage(err);
    }
  }

  async function fetchAudioObjectUrl(url: string): Promise<string> {
    const headers: Record<string, string> = session.value
      ? { Authorization: `Bearer ${session.value.access_token}` }
      : {};
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return URL.createObjectURL(await res.blob());
  }

  function stopAudio() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.src = "";
      currentAudio = null;
    }
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
    activeAudioKey = "";
  }

  function selectSegment(row: SegmentRow) {
    selectedSegmentId = row.id;
  }

  function updateSelectedTiming(
    field: "sourceStartMs" | "sourceEndMs" | "clipStartMs" | "clipEndMs" | "durationMs",
    value: string,
  ) {
    if (!detail || !selectedRow) return;
    const parsed = value.trim() === "" ? null : Number.parseInt(value, 10);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) return;
    const nextLesson = cloneJson(detail.lesson);
    const segment = tier(nextLesson, "lesson.segment").find(
      (entry) => String(entry.payload.segmentId ?? entry.id) === selectedRow.id,
    );
    const generated = tier(nextLesson, "audio:generated").find(
      (entry) => String(entry.payload.segmentId ?? "") === selectedRow.id,
    );
    if (field === "sourceStartMs" || field === "sourceEndMs" || field === "durationMs") {
      setPayloadNumber(segment, field, parsed);
    }
    setPayloadNumber(generated, field, parsed);
    detail = { ...detail, lesson: nextLesson };
    dirty = true;
  }

  function setPayloadNumber(
    annotation: FiloAnnotationJson | undefined,
    field: string,
    value: number | null,
  ) {
    if (!annotation) return;
    if (value === null) delete annotation.payload[field];
    else annotation.payload[field] = value;
  }

  function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  function buildSegmentRows(doc: FiloDocumentJson): SegmentRow[] {
    const generatedBySegment = new Map(
      tier(doc, "audio:generated").map((annotation) => [
        String(annotation.payload.segmentId ?? ""),
        annotation,
      ]),
    );
    return tier(doc, "lesson.segment")
      .toSorted(orderBySegment)
      .map((segment) => {
        const segmentId = String(segment.payload.segmentId ?? segment.id);
        const generated = generatedBySegment.get(segmentId) ?? null;
        const payload = generated?.payload ?? segment.payload;
        return {
          id: segmentId,
          order: numberValue(segment.payload.order) ?? 0,
          text: textOf(doc, segment),
          type: stringValue(segment.payload.type),
          itemLevel: stringValue(segment.payload.itemLevel),
          audioSource: stringValue(segment.payload.audioSource),
          language: stringValue(segment.payload.language),
          segment,
          generated,
          audioId: stringValue(payload.audioId),
          provider: stringValue(payload.provider),
          sourceStartMs: numberValue(payload.sourceStartMs),
          sourceEndMs: numberValue(payload.sourceEndMs),
          clipStartMs: numberValue(payload.clipStartMs),
          clipEndMs: numberValue(payload.clipEndMs),
          durationMs: numberValue(payload.durationMs),
        };
      });
  }

  function buildSoundInventory(rows: SegmentRow[]): SoundAssetView[] {
    const byAudioId = new Map<string, SoundAssetView>();
    for (const row of rows) {
      if (!row.audioId) continue;
      const existing = byAudioId.get(row.audioId);
      if (existing) {
        existing.count += 1;
        continue;
      }
      byAudioId.set(row.audioId, {
        audioId: row.audioId,
        count: 1,
        text: row.text,
        audioSource: row.audioSource,
        provider: row.provider,
        language: row.language,
        firstOrder: row.order,
        sourceStartMs: row.sourceStartMs,
        sourceEndMs: row.sourceEndMs,
        clipStartMs: row.clipStartMs,
        clipEndMs: row.clipEndMs,
      });
    }
    return [...byAudioId.values()].sort(
      (left, right) => left.firstOrder - right.firstOrder || left.audioId.localeCompare(right.audioId),
    );
  }

  function buildTrackViews(doc: FiloDocumentJson): Array<{ id: string; kind: string; count: number }> {
    return doc.tiers
      .map((entry) => ({ id: entry.id, kind: entry.kind, count: entry.annotations.length }))
      .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id));
  }

  function tier(doc: FiloDocumentJson, tierId: string): FiloAnnotationJson[] {
    return doc.tiers.find((entry) => entry.id === tierId)?.annotations ?? [];
  }

  function orderBySegment(left: FiloAnnotationJson, right: FiloAnnotationJson): number {
    return (numberValue(left.payload.order) ?? 0) - (numberValue(right.payload.order) ?? 0);
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

  function numberValue(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function stringValue(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  function formatMs(value: number | null): string {
    if (value === null) return "—";
    if (value >= 60000) {
      const minutes = Math.floor(value / 60000);
      const seconds = ((value % 60000) / 1000).toFixed(1).padStart(4, "0");
      return `${minutes}:${seconds}`;
    }
    return `${(value / 1000).toFixed(3)}s`;
  }

  function formatBytes(value: number | null): string {
    if (value === null) return "—";
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${value} B`;
  }

  function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
</script>

<section class="audio-editor">
  <header class="editor-header">
    <div>
      <p class="eyebrow"><FiloText text="Audio drills" role="view-eyebrow" /></p>
      <h1><FiloText text="Drill editor" role="view-title" /></h1>
    </div>
    <div class="header-actions">
      <label>
        <FiloText text="Drill" role="field-label" />
        <select
          bind:value={selectedDrillId}
          onchange={(event) => void openDrill((event.currentTarget as HTMLSelectElement).value)}
        >
          {#each drills as drill}
            <option value={drill.id}>{drill.title}</option>
          {/each}
        </select>
      </label>
      <Button
        label={activeAudioKey === "final" ? "Stop" : "Play"}
        variant="secondary"
        size="sm"
        disabled={!detail?.audioUrl}
        onclick={playFinalAudio}
      />
      <Button
        label={saving ? "Saving" : dirty ? "Save" : "Saved"}
        variant={dirty ? "primary" : "ghost"}
        size="sm"
        disabled={!dirty || saving}
        onclick={saveLesson}
      />
    </div>
  </header>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if loading && !detail}
    <div class="empty-state"><FiloText text="Loading" role="status" /></div>
  {:else if detail && lesson}
    <section class="summary-grid" aria-label="Drill summary">
      <div><span><FiloText text="Segments" role="summary-label" /></span><strong>{segmentRows.length}</strong></div>
      <div><span><FiloText text="Clips" role="summary-label" /></span><strong>{soundInventory.length}</strong></div>
      <div><span><FiloText text="Words" role="summary-label" /></span><strong>{sourceWordCount}</strong></div>
      <div><span><FiloText text="Audio" role="summary-label" /></span><strong>{formatBytes(detail.drill.audioByteLength)}</strong></div>
    </section>

    <section class="editor-grid">
      <div class="track-panel">
        <div class="section-heading">
          <h2><FiloText text="Tracks" role="section-heading" /></h2>
          <select bind:value={sourceFilter} aria-label="Track filter">
            <option value="all">all</option>
            <option value="tts">tts</option>
            <option value="source">source</option>
            <option value="silence">silence</option>
          </select>
        </div>
        <div class="track-list">
          {#each trackViews as track}
            <div class="track-row">
              <span>{track.id}</span>
              <small>{track.kind}</small>
              <strong>{track.count}</strong>
            </div>
          {/each}
        </div>
      </div>

      <div class="segment-panel">
        <div class="section-heading">
          <h2><FiloText text="Segment timeline" role="section-heading" /></h2>
          <span>{visibleSegmentRows.length}</span>
        </div>
        <div class="segment-list">
          {#each visibleSegmentRows as row}
            <button
              type="button"
              class="segment-row"
              class:active={selectedRow?.id === row.id}
              onclick={() => selectSegment(row)}
            >
              <span class="segment-order">{String(row.order + 1).padStart(3, "0")}</span>
              <span class={`source-pill ${row.audioSource}`}>{row.audioSource}</span>
              <span class="segment-text">{row.text}</span>
              <span class="segment-time">{formatMs(row.clipStartMs ?? row.sourceStartMs)}-{formatMs(row.clipEndMs ?? row.sourceEndMs)}</span>
            </button>
          {/each}
        </div>
      </div>

      <div class="edit-panel">
        <div class="section-heading">
          <h2><FiloText text="Segment editor" role="section-heading" /></h2>
          {#if selectedRow?.audioId}
            <button class="mini-button" type="button" onclick={() => playClip(selectedRow?.audioId ?? "")}>
              {activeAudioKey === `clip:${selectedRow.audioId}` ? "stop" : "clip"}
            </button>
          {/if}
        </div>
        {#if selectedRow}
          <div class="selected-summary">
            <strong>{selectedRow.text}</strong>
            <span>{selectedRow.type} · {selectedRow.audioSource} · {selectedRow.language}</span>
            <code>{selectedRow.audioId || selectedRow.id}</code>
          </div>
          <div class="timing-grid">
            <label>
              <FiloText text="Source start" role="field-label" />
              <input
                type="number"
                min="0"
                value={selectedRow.sourceStartMs ?? ""}
                oninput={(event) => updateSelectedTiming("sourceStartMs", (event.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label>
              <FiloText text="Source end" role="field-label" />
              <input
                type="number"
                min="0"
                value={selectedRow.sourceEndMs ?? ""}
                oninput={(event) => updateSelectedTiming("sourceEndMs", (event.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label>
              <FiloText text="Clip start" role="field-label" />
              <input
                type="number"
                min="0"
                value={selectedRow.clipStartMs ?? ""}
                oninput={(event) => updateSelectedTiming("clipStartMs", (event.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label>
              <FiloText text="Clip end" role="field-label" />
              <input
                type="number"
                min="0"
                value={selectedRow.clipEndMs ?? ""}
                oninput={(event) => updateSelectedTiming("clipEndMs", (event.currentTarget as HTMLInputElement).value)}
              />
            </label>
          </div>
        {/if}
      </div>
    </section>

    <section class="inventory-panel">
      <div class="section-heading">
        <h2><FiloText text="Sound inventory" role="section-heading" /></h2>
        <span>{sourcePhraseCount} phrases · {sourceSentenceCount} sentences</span>
      </div>
      <div class="inventory-table">
        {#each soundInventory as sound}
          <article class="inventory-row">
            <button class="mini-button" type="button" onclick={() => playClip(sound.audioId)}>
              {activeAudioKey === `clip:${sound.audioId}` ? "stop" : "play"}
            </button>
            <strong>{sound.text}</strong>
            <span>{sound.audioSource}</span>
            <span>{sound.language || "—"}</span>
            <span>{sound.count}x</span>
            <span>{formatMs(sound.clipStartMs ?? sound.sourceStartMs)}-{formatMs(sound.clipEndMs ?? sound.sourceEndMs)}</span>
            <code>{sound.audioId.slice(0, 12)}</code>
          </article>
        {/each}
      </div>
    </section>
  {:else}
    <div class="empty-state"><FiloText text="No drills" role="empty-state" /></div>
  {/if}
</section>

<style>
  .audio-editor {
    height: 100%;
    overflow: auto;
    padding: var(--space-6);
    background: var(--color-bg);
  }

  .editor-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-5);
    margin-bottom: var(--space-5);
  }

  .header-actions {
    display: flex;
    align-items: end;
    gap: var(--space-2);
    flex-wrap: wrap;
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
    font-size: clamp(2rem, 4vw, 3.4rem);
    letter-spacing: 0;
  }

  h2 {
    font-size: var(--text-lg);
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
  select {
    min-height: 2.35rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    padding: 0 var(--space-3);
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-3);
    margin-bottom: var(--space-5);
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

  .editor-grid {
    display: grid;
    grid-template-columns: minmax(14rem, 0.7fr) minmax(24rem, 1.6fr) minmax(18rem, 0.9fr);
    gap: var(--space-5);
  }

  .track-panel,
  .segment-panel,
  .edit-panel,
  .inventory-panel {
    min-height: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    padding: var(--space-4);
  }

  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .track-list,
  .segment-list,
  .inventory-table {
    display: grid;
    gap: var(--space-2);
  }

  .segment-list {
    max-height: 42rem;
    overflow: auto;
  }

  .track-row,
  .segment-row,
  .inventory-row {
    display: grid;
    align-items: center;
    gap: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
  }

  .track-row {
    grid-template-columns: minmax(0, 1fr) auto auto;
    padding: var(--space-3);
  }

  .track-row span,
  .track-row strong,
  .segment-order,
  code {
    font-family: var(--font-mono);
  }

  .track-row small,
  .segment-time {
    color: var(--color-text-muted);
    font-size: var(--text-caption);
  }

  .segment-row {
    grid-template-columns: 3rem 4.6rem minmax(0, 1fr) 8.5rem;
    width: 100%;
    min-height: 2.7rem;
    padding: 0 var(--space-3);
    color: var(--color-text);
    cursor: pointer;
    text-align: left;
  }

  .segment-row:hover,
  .segment-row.active {
    border-color: var(--color-accent);
  }

  .segment-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-pill {
    justify-self: start;
    min-width: 4rem;
    padding: 0.2rem 0.45rem;
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    text-align: center;
  }

  .source-pill.source {
    color: var(--color-accent);
  }

  .source-pill.tts {
    color: var(--color-success, #2a8c57);
  }

  .selected-summary {
    display: grid;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
  }

  .selected-summary span,
  .selected-summary code {
    color: var(--color-text-muted);
    font-size: var(--text-caption);
  }

  .timing-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .mini-button {
    min-height: 2rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    color: var(--color-text);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    padding: 0 var(--space-3);
  }

  .inventory-panel {
    margin-top: var(--space-5);
  }

  .inventory-table {
    max-height: 36rem;
    overflow: auto;
  }

  .inventory-row {
    grid-template-columns: auto minmax(12rem, 1fr) 5rem 4rem 3rem 9rem 7rem;
    min-height: 2.7rem;
    padding: 0 var(--space-3);
  }

  .inventory-row span,
  .inventory-row code {
    color: var(--color-text-muted);
    font-size: var(--text-caption);
  }

  .error {
    margin-bottom: var(--space-4);
    color: var(--color-error);
  }

  .empty-state {
    padding: var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text-muted);
  }

  @media (max-width: 1100px) {
    .editor-grid {
      grid-template-columns: 1fr;
    }

    .summary-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .inventory-row {
      grid-template-columns: auto minmax(0, 1fr) 4rem 3rem;
    }

    .inventory-row span:nth-of-type(2),
    .inventory-row span:nth-of-type(4),
    .inventory-row code {
      display: none;
    }
  }

  @media (max-width: 700px) {
    .audio-editor {
      padding: var(--space-4);
    }

    .editor-header,
    .header-actions {
      display: grid;
      width: 100%;
    }

    .summary-grid {
      grid-template-columns: 1fr;
    }

    .segment-row {
      grid-template-columns: 2.6rem 4.3rem minmax(0, 1fr);
    }

    .segment-time {
      display: none;
    }
  }
</style>
