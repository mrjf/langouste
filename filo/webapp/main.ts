import {
  FiloDocument,
  NYTIMES_FIXTURE_HTML,
  buildCustomAnalysisDocument,
  buildExampleCatalog,
  documentFromArticleHtml,
  type FiloAnnotation,
  type FiloDocumentJson,
  type FiloExample,
  type FiloTierJson,
  type WordPayload,
} from "../src/index";
import "./styles.css";

interface AppState {
  examples: FiloExample[];
  activeExampleId: string;
  currentJson: FiloDocumentJson;
  activeTierIds: Set<string>;
  selectedOffset: number;
  selectedAnnotationId: string | null;
  hoveredOffset: number | null;
  timelineScrollTop: number;
  customText: string;
  customLanguage: string;
  articleHtml: string;
  notice: string | null;
}

interface PositionedAnnotation {
  annotation: FiloAnnotation<unknown>;
  level: number;
}

const root = window.document.getElementById("app");
if (!root) throw new Error("Missing #app");
const appRoot: HTMLElement = root;

let state: AppState;

void start();

async function start(): Promise<void> {
  const examples = await buildExampleCatalog();
  const firstExample = examples[0];
  if (!firstExample) throw new Error("No examples available");

  state = {
    examples,
    activeExampleId: firstExample.id,
    currentJson: firstExample.document,
    activeTierIds: new Set(firstExample.document.tiers.map((tier) => tier.id)),
    selectedOffset: 0,
    selectedAnnotationId: null,
    hoveredOffset: null,
    timelineScrollTop: 0,
    customText:
      "The layered document stores words, dictionary links, phrase tiers, audio spans, and translations in one byte-indexed text.",
    customLanguage: "en",
    articleHtml: NYTIMES_FIXTURE_HTML.trim(),
    notice: null,
  };

  render();
}

function render(): void {
  const filoDocument = FiloDocument.fromJSON(state.currentJson);
  const activeTiers = filoDocument.tiers().filter((tier) => state.activeTierIds.has(tier.id));
  const selectedAnnotations = selectedAnnotationsFor(filoDocument);
  const selectedExample = state.examples.find((example) => example.id === state.activeExampleId);

  appRoot.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">F</div>
          <div>
            <h1>Filo</h1>
            <p>Tiered byte-offset annotation explorer</p>
          </div>
        </div>
        <section class="panel compact">
          <h2>Examples</h2>
          <div class="example-list">
            ${state.examples.map((example) => renderExampleButton(example)).join("")}
          </div>
        </section>
        <section class="panel compact">
          <h2>Tiers</h2>
          <div class="tier-filter-list">
            ${filoDocument.tiers().map((tier, index) => renderTierToggle(tier.toJSON(), index)).join("")}
          </div>
        </section>
      </aside>

      <main class="workspace">
        <header class="hero">
          <div>
            <div class="eyebrow">${escapeHtml(selectedExample?.language ?? "custom")} · ${escapeHtml(
              String(state.currentJson.metadata?.source ?? "filo"),
            )}</div>
            <h1>${escapeHtml(String(state.currentJson.metadata?.title ?? selectedExample?.title ?? "Filo document"))}</h1>
            <p>${escapeHtml(selectedExample?.description ?? "Interactive layered annotation document.")}</p>
          </div>
          <div class="metrics">
            <div><strong>${filoDocument.byteLength}</strong><span>bytes</span></div>
            <div><strong>${filoDocument.tiers().length}</strong><span>tiers</span></div>
            <div><strong>${filoDocument.annotations().length}</strong><span>annotations</span></div>
          </div>
        </header>

        ${state.notice ? `<div class="notice">${escapeHtml(state.notice)}</div>` : ""}

        <section class="document-inspector-grid">
          <div class="panel reading-panel">
            <div class="section-head">
              <div>
                <h2><span class="step-label">1</span> Text Surface</h2>
                <p>Plain document text. Hover a word to light up covering tier spans; click to inspect.</p>
              </div>
              <button class="ghost-button" data-action="select-start">Select start</button>
            </div>
            <div class="reading-surface" data-field="document-text">${renderTextSurface(filoDocument)}</div>
          </div>

          <div class="panel inspector-panel">
            <div class="section-head">
              <div>
                <h2><span class="step-label">2</span> Inspector</h2>
                <p>${selectedAnnotations.length} active annotation${selectedAnnotations.length === 1 ? "" : "s"} at byte ${state.selectedOffset}.</p>
              </div>
            </div>
            <div class="inspector">${renderInspector(filoDocument, selectedAnnotations)}</div>
          </div>
        </section>

        <section class="panel timeline-panel">
          <div class="section-head">
            <div>
              <h2>Tier Timeline</h2>
              <p>Byte ranges are drawn on parallel lanes. Nested NPs, VPs, and PPs stack vertically.</p>
            </div>
            <div class="legend">${activeTiers.map((tier, index) => renderLegendItem(tier.toJSON(), index)).join("")}</div>
          </div>
          <div class="timeline">${renderTimeline(filoDocument, activeTiers.map((tier) => tier.toJSON()))}</div>
        </section>

        <section class="panel json-panel">
          <h2>Document JSON</h2>
          <pre class="json-preview">${escapeHtml(JSON.stringify(documentSummary(filoDocument), null, 2))}</pre>
        </section>

        <section class="split-grid">
          <div class="panel lab">
            <h2>Custom Text Lab</h2>
            <label>
              Language
              <input data-field="custom-language" value="${escapeAttribute(state.customLanguage)}" />
            </label>
            <label>
              Text
              <textarea data-field="custom-text">${escapeHtml(state.customText)}</textarea>
            </label>
            <button data-action="analyze-custom">Analyze as Filo document</button>
          </div>

          <div class="panel lab">
            <h2>NYTimes Article HTML Ingest</h2>
            <p class="muted">The library includes a live URL scraper for CLI use. The browser app parses pasted article HTML to avoid CORS and paywall bypasses.</p>
            <textarea data-field="article-html">${escapeHtml(state.articleHtml)}</textarea>
            <div class="button-row">
              <button data-action="parse-article">Parse pasted article</button>
              <button class="ghost-button" data-action="load-article-fixture">Load fixture</button>
            </div>
            <code>bun run scrape:nytimes -- &lt;article-url&gt;</code>
          </div>
        </section>
      </main>
    </div>
  `;

  bindEvents();
  restoreTimelineScroll();
}

function bindEvents(): void {
  for (const button of appRoot.querySelectorAll<HTMLButtonElement>("[data-example-id]")) {
    button.addEventListener("click", () => {
      const example = state.examples.find((candidate) => candidate.id === button.dataset.exampleId);
      if (!example) return;
      state.activeExampleId = example.id;
      state.currentJson = example.document;
      state.activeTierIds = new Set(example.document.tiers.map((tier) => tier.id));
      state.selectedOffset = 0;
      state.selectedAnnotationId = null;
      state.hoveredOffset = null;
      state.timelineScrollTop = 0;
      state.notice = null;
      render();
    });
  }

  for (const checkbox of appRoot.querySelectorAll<HTMLInputElement>("[data-tier-id]")) {
    checkbox.addEventListener("change", () => {
      const tierId = checkbox.dataset.tierId;
      if (!tierId) return;
      if (checkbox.checked) state.activeTierIds.add(tierId);
      else state.activeTierIds.delete(tierId);
      render();
    });
  }

  for (const textWord of appRoot.querySelectorAll<HTMLElement>("[data-text-byte-start]")) {
    textWord.addEventListener("click", () => {
      state.selectedOffset = Number(textWord.dataset.textByteStart ?? "0");
      state.selectedAnnotationId = null;
      render();
    });
    textWord.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      state.selectedOffset = Number(textWord.dataset.textByteStart ?? "0");
      state.selectedAnnotationId = null;
      render();
    });
    textWord.addEventListener("mouseenter", () => {
      state.hoveredOffset = Number(textWord.dataset.textByteStart ?? "0");
      updateHoverHighlights();
    });
  }

  appRoot.querySelector<HTMLElement>('[data-field="document-text"]')?.addEventListener("mouseleave", () => {
    state.hoveredOffset = null;
    updateHoverHighlights();
  });
  const textSurface = appRoot.querySelector<HTMLElement>('[data-field="document-text"]');
  textSurface?.addEventListener("mouseover", updateHoveredWordFromEvent);
  textSurface?.addEventListener("mousemove", updateHoveredWordFromEvent);

  for (const bar of appRoot.querySelectorAll<HTMLButtonElement>("[data-annotation-id]")) {
    bar.addEventListener("click", () => {
      rememberTimelineScroll();
      state.selectedAnnotationId = bar.dataset.annotationId ?? null;
      state.selectedOffset = Number(bar.dataset.byteStart ?? "0");
      render();
    });
  }

  appRoot.querySelector<HTMLElement>(".timeline")?.addEventListener("scroll", (event) => {
    state.timelineScrollTop = (event.currentTarget as HTMLElement).scrollTop;
  });

  appRoot.querySelector<HTMLButtonElement>('[data-action="select-start"]')?.addEventListener("click", () => {
    state.selectedOffset = 0;
    state.selectedAnnotationId = null;
    render();
  });

  appRoot.querySelector<HTMLTextAreaElement>('[data-field="custom-text"]')?.addEventListener("input", (event) => {
    state.customText = (event.currentTarget as HTMLTextAreaElement).value;
  });
  appRoot.querySelector<HTMLInputElement>('[data-field="custom-language"]')?.addEventListener("input", (event) => {
    state.customLanguage = (event.currentTarget as HTMLInputElement).value;
  });
  appRoot.querySelector<HTMLTextAreaElement>('[data-field="article-html"]')?.addEventListener("input", (event) => {
    state.articleHtml = (event.currentTarget as HTMLTextAreaElement).value;
  });

  appRoot.querySelector<HTMLButtonElement>('[data-action="analyze-custom"]')?.addEventListener("click", async () => {
      state.currentJson = await buildCustomAnalysisDocument(state.customText, {
        language: state.customLanguage.trim() || "en",
      });
      state.activeExampleId = "custom";
      state.activeTierIds = new Set(state.currentJson.tiers.map((tier) => tier.id));
      state.selectedOffset = 0;
      state.selectedAnnotationId = null;
      state.hoveredOffset = null;
      state.timelineScrollTop = 0;
      state.notice = "Custom text analyzed with words, phrases, dictionary lookups, sentences, and links.";
      render();
  });

  appRoot.querySelector<HTMLButtonElement>('[data-action="parse-article"]')?.addEventListener("click", async () => {
    try {
      state.currentJson = await documentFromArticleHtml(state.articleHtml);
      state.activeExampleId = "article-custom";
      state.activeTierIds = new Set(state.currentJson.tiers.map((tier) => tier.id));
      state.selectedOffset = 0;
      state.selectedAnnotationId = null;
      state.hoveredOffset = null;
      state.timelineScrollTop = 0;
      state.notice = "Article HTML parsed and annotated.";
    } catch (error) {
      state.notice = `Could not parse article HTML: ${error instanceof Error ? error.message : String(error)}`;
    }
    render();
  });

  appRoot
    .querySelector<HTMLButtonElement>('[data-action="load-article-fixture"]')
    ?.addEventListener("click", () => {
      state.articleHtml = NYTIMES_FIXTURE_HTML.trim();
      state.notice = "Fixture HTML loaded into the article ingest editor.";
      render();
    });
}

function renderExampleButton(example: FiloExample): string {
  const active = example.id === state.activeExampleId ? " active" : "";
  return `
    <button class="example-card${active}" data-example-id="${escapeAttribute(example.id)}">
      <strong>${escapeHtml(example.title)}</strong>
      <span>${escapeHtml(example.description)}</span>
      <small>${example.tags.map(escapeHtml).join(" · ")}</small>
    </button>
  `;
}

function renderTierToggle(tier: FiloTierJson<unknown>, index: number): string {
  const checked = state.activeTierIds.has(tier.id) ? "checked" : "";
  const count = tier.annotations.length;
  return `
    <label class="tier-toggle" style="--tier-color: ${tierColor(tier, index)}">
      <input type="checkbox" data-tier-id="${escapeAttribute(tier.id)}" ${checked} />
      <span class="tier-swatch"></span>
      <span>
        <strong>${escapeHtml(tier.id)}</strong>
        <small>${escapeHtml(tier.kind)} · ${count}</small>
      </span>
    </label>
  `;
}

function renderLegendItem(tier: FiloTierJson<unknown>, index: number): string {
  return `
    <span class="legend-item" style="--tier-color: ${tierColor(tier, index)}">
      <span></span>${escapeHtml(tier.id)}
    </span>
  `;
}

function rememberTimelineScroll(): void {
  const timeline = appRoot.querySelector<HTMLElement>(".timeline");
  if (!timeline) return;
  state.timelineScrollTop = timeline.scrollTop;
}

function restoreTimelineScroll(): void {
  const timeline = appRoot.querySelector<HTMLElement>(".timeline");
  if (!timeline) return;
  timeline.scrollTop = state.timelineScrollTop;
}

function renderTextSurface(filoDocument: FiloDocument): string {
  const selectedAnnotation = selectedAnnotationFor(filoDocument);
  const words = (filoDocument.tier<WordPayload>("word")?.annotations ?? []).sort(
    (left, right) => left.start - right.start,
  );
  if (words.length === 0) {
    return renderTextSegment(filoDocument, { start: 0, end: filoDocument.byteLength }, selectedAnnotation);
  }

  const parts: string[] = [];
  let cursor = 0;
  for (const word of words) {
    if (word.start > cursor) {
      parts.push(renderTextSegment(filoDocument, { start: cursor, end: word.start }, selectedAnnotation));
    }
    const selected = selectedAnnotation ? rangesOverlap(word, selectedAnnotation) : false;
    parts.push(
      `<span class="text-word${selected ? " selected" : ""}" data-text-byte-start="${word.start}" data-text-byte-end="${word.end}" tabindex="0" title="${escapeAttribute(`${word.payload.surface} · ${word.start}–${word.end}`)}">${escapeHtml(word.payload.surface)}</span>`,
    );
    cursor = word.end;
  }
  if (cursor < filoDocument.byteLength) {
    parts.push(renderTextSegment(filoDocument, { start: cursor, end: filoDocument.byteLength }, selectedAnnotation));
  }
  return parts.join("");
}

function renderTextSegment(
  filoDocument: FiloDocument,
  range: { start: number; end: number },
  selectedAnnotation: FiloAnnotation<unknown> | null,
): string {
  const selected = selectedAnnotation ? rangesOverlap(range, selectedAnnotation) : false;
  return `<span class="text-segment${selected ? " selected" : ""}">${escapeHtml(filoDocument.textOf(range))}</span>`;
}

function selectedAnnotationFor(filoDocument: FiloDocument): FiloAnnotation<unknown> | null {
  if (!state.selectedAnnotationId) return null;
  return (
    filoDocument.annotations().find((annotation) => annotation.id === state.selectedAnnotationId) ?? null
  );
}

function updateHoverHighlights(): void {
  for (const bar of appRoot.querySelectorAll<HTMLElement>("[data-annotation-id]")) {
    const start = Number(bar.dataset.byteStart ?? "0");
    const end = Number(bar.dataset.byteEnd ?? "0");
    bar.classList.toggle("hovered", offsetInsideRange(state.hoveredOffset, { start, end }));
  }
}

function updateHoveredWordFromEvent(event: Event): void {
  const target = event.target instanceof HTMLElement ? event.target : null;
  const word = target?.closest<HTMLElement>("[data-text-byte-start]");
  if (!word) {
    if (state.hoveredOffset !== null) {
      state.hoveredOffset = null;
      updateHoverHighlights();
    }
    return;
  }

  const nextOffset = Number(word.dataset.textByteStart ?? "0");
  if (state.hoveredOffset === nextOffset) return;
  state.hoveredOffset = nextOffset;
  updateHoverHighlights();
}

function renderTimeline(filoDocument: FiloDocument, tiers: Array<FiloTierJson<unknown>>): string {
  if (tiers.length === 0) return `<p class="empty">No active tiers.</p>`;
  return tiers.map((tier, index) => renderLane(filoDocument, tier, index)).join("");
}

function renderLane(filoDocument: FiloDocument, tier: FiloTierJson<unknown>, index: number): string {
  const positioned = positionAnnotations(tier.annotations);
  const levelCount = Math.max(1, ...positioned.map((item) => item.level + 1));
  const laneHeight = 52 + levelCount * 28;
  return `
    <div class="timeline-lane" style="height: ${laneHeight}px; --tier-color: ${tierColor(tier, index)}">
      <div class="lane-label">
        <strong>${escapeHtml(tier.id)}</strong>
        <span>${escapeHtml(tier.kind)}</span>
      </div>
      <div class="lane-track">
        ${positioned
          .map((item) => renderBar(filoDocument, item.annotation, item.level))
          .join("")}
      </div>
    </div>
  `;
}

function positionAnnotations(annotations: Array<FiloAnnotation<unknown>>): PositionedAnnotation[] {
  const levels: number[] = [];
  return annotations
    .slice()
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .map((annotation) => {
      let level = levels.findIndex((end) => annotation.start >= end);
      if (level === -1) {
        level = levels.length;
        levels.push(annotation.end);
      } else {
        levels[level] = annotation.end;
      }
      return { annotation, level };
    });
}

function renderBar(filoDocument: FiloDocument, annotation: FiloAnnotation<unknown>, level: number): string {
  const left = percent(annotation.start, filoDocument.byteLength);
  const width = Math.max(0.6, percent(annotation.end - annotation.start, filoDocument.byteLength));
  const selected = annotation.id === state.selectedAnnotationId ? " selected" : "";
  const hovered = offsetInsideRange(state.hoveredOffset, annotation) ? " hovered" : "";
  return `
    <button
      class="annotation-bar${selected}${hovered}"
      data-annotation-id="${escapeAttribute(annotation.id)}"
      data-byte-start="${annotation.start}"
      data-byte-end="${annotation.end}"
      style="left: ${left}%; width: ${width}%; top: ${28 + level * 26}px"
      title="${escapeAttribute(`${annotation.tierId}: ${filoDocument.textOf(annotation)}`)}"
    >
      ${escapeHtml(annotationLabel(filoDocument, annotation))}
    </button>
  `;
}

function renderInspector(
  filoDocument: FiloDocument,
  annotations: Array<FiloAnnotation<unknown>>,
): string {
  if (annotations.length === 0) {
    return `<p class="empty">No active annotations at this byte offset.</p>`;
  }
  return annotations.map((annotation) => renderAnnotationCard(filoDocument, annotation)).join("");
}

function renderAnnotationCard(filoDocument: FiloDocument, annotation: FiloAnnotation<unknown>): string {
  const payload = isRecord(annotation.payload) ? annotation.payload : {};
  const links = annotationLinks(payload);
  return `
    <article class="annotation-card">
      <div class="annotation-card-head">
        <div>
          <strong>${escapeHtml(annotation.tierId)}</strong>
          <span>${escapeHtml(annotation.kind)}</span>
        </div>
        <code>${annotation.start}–${annotation.end}</code>
      </div>
      <blockquote>${escapeHtml(filoDocument.textOf(annotation))}</blockquote>
      ${renderPayload(payload)}
      ${
        links.length > 0
          ? `<div class="link-row">${links
              .map(
                (link) =>
                  `<a href="${escapeAttribute(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(
                    link.label,
                  )}</a>`,
              )
              .join("")}</div>`
          : ""
      }
    </article>
  `;
}

function renderPayload(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload).filter(([key]) => key !== "links");
  if (entries.length === 0) return "";
  return `
    <dl class="payload-grid">
      ${entries
        .map(
          ([key, value]) => `
            <dt>${escapeHtml(key)}</dt>
            <dd>${escapeHtml(payloadValue(value))}</dd>
          `,
        )
        .join("")}
    </dl>
  `;
}

function selectedAnnotationsFor(filoDocument: FiloDocument): Array<FiloAnnotation<unknown>> {
  if (state.selectedAnnotationId) {
    const selected = filoDocument
      .annotations()
      .find((annotation) => annotation.id === state.selectedAnnotationId);
    if (selected) {
      return filoDocument
        .annotationsAt(selected.start)
        .filter((annotation) => state.activeTierIds.has(annotation.tierId));
    }
  }
  return filoDocument
    .annotationsAt(state.selectedOffset)
    .filter((annotation) => state.activeTierIds.has(annotation.tierId));
}

function offsetInsideRange(offset: number | null, range: { start: number; end: number }): boolean {
  if (offset === null) return false;
  if (range.start === range.end) return offset === range.start;
  return range.start <= offset && offset < range.end;
}

function rangesOverlap(
  left: { start: number; end: number },
  right: { start: number; end: number },
): boolean {
  if (left.start === left.end || right.start === right.end) {
    return left.start === right.start;
  }
  return left.start < right.end && right.start < left.end;
}

function annotationLabel(filoDocument: FiloDocument, annotation: FiloAnnotation<unknown>): string {
  const payload = isRecord(annotation.payload) ? annotation.payload : {};
  return String(
    payload.label ??
      payload.phraseType ??
      payload.lemma ??
      payload.surface ??
      payload.speaker ??
      payload.text ??
      filoDocument.textOf(annotation),
  );
}

function annotationLinks(payload: Record<string, unknown>): Array<{ label: string; url: string }> {
  const links: Array<{ label: string; url: string }> = [];
  const payloadLinks = payload.links;
  if (Array.isArray(payloadLinks)) {
    for (const link of payloadLinks) {
      if (!isRecord(link) || typeof link.url !== "string") continue;
      links.push({
        label: typeof link.label === "string" ? link.label : link.url,
        url: link.url,
      });
    }
  }
  if (typeof payload.sourceUrl === "string") {
    links.push({ label: "source", url: payload.sourceUrl });
  }
  if (typeof payload.url === "string") {
    links.push({ label: "url", url: payload.url });
  }
  return links;
}

function documentSummary(filoDocument: FiloDocument): Record<string, unknown> {
  return {
    id: filoDocument.id,
    byteLength: filoDocument.byteLength,
    metadata: state.currentJson.metadata,
    tiers: filoDocument.tiers().map((tier) => ({
      id: tier.id,
      kind: tier.kind,
      annotations: tier.annotations.length,
    })),
  };
}

function percent(value: number, total: number): number {
  if (total <= 0) return 0;
  return (value / total) * 100;
}

function tierColor(tier: FiloTierJson<unknown>, index: number): string {
  const palette = [
    "#d41131",
    "#0f766e",
    "#2563eb",
    "#7c3aed",
    "#c2410c",
    "#047857",
    "#be185d",
    "#4f46e5",
    "#ca8a04",
    "#0891b2",
  ];
  const hash = [...tier.id].reduce((total, character) => total + character.charCodeAt(0), index);
  return palette[hash % palette.length] ?? "#d41131";
}

function payloadValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
      .join(", ");
  }
  if (isRecord(value)) return JSON.stringify(value);
  return String(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/gu, "&#96;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
