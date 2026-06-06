<script lang="ts">
  import {
    filoTextDocument,
    serializeFiloDocument,
    serializeSourceSummaries,
    sourceSummariesForDocument,
    UI_COPY_SOURCE,
    type FiloTextDocumentOptions,
  } from "../lib/filo-provenance";
  import type { FiloSourceJson } from "../lib/stores.svelte";

  interface Props {
    text: string | number | null | undefined;
    role?: string;
    language?: string;
    source?: FiloSourceJson;
    class?: string;
    ariaHidden?: boolean;
  }

  let {
    text,
    role = "text",
    language = "en",
    source = UI_COPY_SOURCE,
    class: className = "",
    ariaHidden = false,
  }: Props = $props();

  const value = $derived(text === null || text === undefined ? "" : String(text));
  const documentOptions = $derived<FiloTextDocumentOptions>({ role, language, source });
  const document = $derived(filoTextDocument(value, documentOptions));
  const summaries = $derived(sourceSummariesForDocument(document));
</script>

<span
  class={`filo-text ${className}`.trim()}
  aria-hidden={ariaHidden || undefined}
  data-filo-document={serializeFiloDocument(document)}
  data-filo-document-id={document.id}
  data-filo-preview={value}
  data-filo-sources={serializeSourceSummaries(summaries)}
>{value}</span>
