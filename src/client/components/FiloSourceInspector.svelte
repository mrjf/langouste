<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    fallbackDocumentForVisibleText,
    serializeSourceSummaries,
    sourceSummariesForDocument,
    type FiloSourceSummary,
  } from "../lib/filo-provenance";

  let active = $state(false);
  let visible = $state(false);
  let x = $state(0);
  let y = $state(0);
  let preview = $state("");
  let sources = $state<FiloSourceSummary[]>([]);
  let modeLabel = $state("Filo source");
  let lastMouse: { x: number; y: number; target: EventTarget | null } | null = null;
  let observer: MutationObserver | null = null;

  onMount(() => {
    sourceUnsourcedVisibleText();
    observer = new MutationObserver(() => sourceUnsourcedVisibleText());
    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("blur", hide, true);
  });

  onDestroy(() => {
    observer?.disconnect();
    observer = null;
    window.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("keyup", handleKeyUp, true);
    window.removeEventListener("mousemove", handleMouseMove, true);
    window.removeEventListener("blur", hide, true);
    document.documentElement.classList.remove("filo-source-mode");
  });

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "Alt") return;
    active = true;
    document.documentElement.classList.add("filo-source-mode");
    if (lastMouse) inspect(lastMouse.target, lastMouse.x, lastMouse.y);
  }

  function handleKeyUp(event: KeyboardEvent) {
    if (event.key === "Alt") hide();
  }

  function handleMouseMove(event: MouseEvent) {
    lastMouse = { x: event.clientX, y: event.clientY, target: event.target };
    if (!active && !event.altKey) return;
    active = true;
    document.documentElement.classList.add("filo-source-mode");
    inspect(event.target, event.clientX, event.clientY);
  }

  function inspect(target: EventTarget | null, clientX: number, clientY: number) {
    const element = elementFromTarget(target);
    if (!element) {
      visible = false;
      return;
    }

    const sourced = element.closest<HTMLElement>("[data-filo-sources]");
    if (sourced) {
      const parsed = parseSources(sourced.dataset.filoSources);
      sources = parsed.length ? parsed : sourceSummariesForDocument(null);
      preview = truncate(sourced.dataset.filoPreview || sourced.textContent || "");
      modeLabel = sourced.dataset.filoDocument ? "Filo document" : "Filo source";
      place(clientX, clientY);
      visible = sources.length > 0 || !!preview;
      return;
    }

    const fallbackText = visibleTextNear(element);
    if (!fallbackText) {
      visible = false;
      return;
    }
    const fallbackDocument = fallbackDocumentForVisibleText(fallbackText);
    const fallbackSources = sourceSummariesForDocument(fallbackDocument);
    applyFallback(element, fallbackText);
    sources = fallbackSources;
    preview = truncate(fallbackText);
    modeLabel = "Filo fallback";
    place(clientX, clientY);
    visible = true;
  }

  function hide() {
    active = false;
    visible = false;
    document.documentElement.classList.remove("filo-source-mode");
  }

  function place(clientX: number, clientY: number) {
    x = Math.min(clientX + 14, window.innerWidth - 320);
    y = Math.min(clientY + 16, window.innerHeight - 180);
  }

  function elementFromTarget(target: EventTarget | null): HTMLElement | null {
    if (target instanceof HTMLElement) return target;
    if (target instanceof SVGElement) return target.closest("svg") as HTMLElement | null;
    return null;
  }

  function parseSources(value: string | undefined): FiloSourceSummary[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((source) => source && typeof source === "object")
        .map((source) => source as FiloSourceSummary)
        .filter((source) => typeof source.id === "string" && source.id.trim());
    } catch {
      return [];
    }
  }

  function visibleTextNear(element: HTMLElement): string {
    let current: HTMLElement | null = element;
    while (current && current !== document.body && current !== document.documentElement) {
      const text = textForElement(current);
      if (text && text.length <= 240) return text;
      current = current.parentElement;
    }
    return "";
  }

  function textForElement(element: HTMLElement): string {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return (element.value || element.placeholder || "").trim();
    }
    if (element instanceof HTMLSelectElement) {
      return element.selectedOptions[0]?.textContent?.trim() ?? "";
    }
    return collapseWhitespace(element.textContent ?? "");
  }

  function collapseWhitespace(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  function truncate(value: string): string {
    const text = collapseWhitespace(value);
    return text.length > 140 ? `${text.slice(0, 137)}...` : text;
  }

  function sourceUnsourcedVisibleText() {
    if (!document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      if (walker.currentNode instanceof Text) textNodes.push(walker.currentNode);
    }

    for (const textNode of textNodes) {
      const text = collapseWhitespace(textNode.data);
      if (!text) continue;
      const parent = textNode.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) continue;
      if (parent.closest(".filo-source-tooltip")) continue;
      const sourced = parent.closest<HTMLElement>("[data-filo-sources]");
      if (sourced && sourced.dataset.filoFallback !== "true") continue;
      applyFallback(parent, textForElement(parent) || text);
    }

    for (const control of document.querySelectorAll<HTMLElement>(
      "input[placeholder], textarea[placeholder], select, [aria-label], [title]",
    )) {
      if (control.closest(".filo-source-tooltip")) continue;
      if (control.closest("[data-filo-sources]") && control.dataset.filoFallback !== "true") {
        continue;
      }
      const text = textForElement(control);
      if (text) applyFallback(control, text);
    }
  }

  function applyFallback(element: HTMLElement, text: string) {
    const fallbackDocument = fallbackDocumentForVisibleText(text);
    const fallbackSources = sourceSummariesForDocument(fallbackDocument);
    element.dataset.filoFallback = "true";
    element.dataset.filoDocument = JSON.stringify(fallbackDocument);
    element.dataset.filoDocumentId = fallbackDocument.id;
    element.dataset.filoPreview = fallbackDocument.text;
    element.dataset.filoSources = serializeSourceSummaries(fallbackSources);
  }
</script>

{#if visible}
  <aside
    class="filo-source-tooltip"
    style={`left: ${Math.max(8, x)}px; top: ${Math.max(8, y)}px;`}
    aria-live="polite"
  >
    <div class="tooltip-kicker">{modeLabel}</div>
    {#if preview}
      <div class="tooltip-preview">{preview}</div>
    {/if}
    <div class="source-list">
      {#each sources as source}
        <div class="source-row">
          <span>{source.kind}</span>
          <strong>{source.label}</strong>
          <small>{source.provider ?? source.module ?? source.id}</small>
        </div>
      {/each}
    </div>
  </aside>
{/if}

<style>
  :global(.filo-source-mode [data-filo-sources]) {
    outline: 1px solid color-mix(in srgb, var(--color-accent) 70%, transparent);
    outline-offset: 2px;
  }

  .filo-source-tooltip {
    position: fixed;
    z-index: 10000;
    width: min(20rem, calc(100vw - 1rem));
    max-height: min(18rem, calc(100vh - 1rem));
    overflow: auto;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18);
    color: var(--color-text);
    padding: var(--space-3);
    pointer-events: none;
  }

  .tooltip-kicker {
    color: var(--color-accent);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    text-transform: uppercase;
  }

  .tooltip-preview {
    margin-top: var(--space-2);
    color: var(--color-text);
    font-size: var(--text-sm);
    line-height: 1.35;
  }

  .source-list {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .source-row {
    display: grid;
    gap: 0.125rem;
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-2);
  }

  .source-row span,
  .source-row small {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
  }

  .source-row strong {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }
</style>
