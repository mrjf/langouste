<script lang="ts">
  import { ipaLayerPreference } from "../lib/display-settings.svelte";
  import { filoSource } from "../lib/filo-provenance";
  import { formatIpa, ipaForText } from "../lib/ipa-layer";
  import type { FiloDocumentJson } from "../lib/stores.svelte";
  import FiloText from "./FiloText.svelte";

  interface Props {
    text: string | null | undefined;
    language: string | null | undefined;
    filoDoc?: FiloDocumentJson | null;
    baseByteOffset?: number;
    class?: string;
  }

  let {
    text,
    language,
    filoDoc = null,
    baseByteOffset = 0,
    class: className = "",
  }: Props = $props();

  const ipa = $derived.by(() =>
    ipaLayerPreference.enabled ? ipaForText(text, language, filoDoc, baseByteOffset) : null,
  );
  const formatted = $derived(ipa ? formatIpa(ipa) : "");
</script>

{#if formatted}
  <span
    class={`ipa-layer ${className}`.trim()}
    lang={language ?? undefined}
    use:filoSource={{ document: filoDoc, text: formatted, role: "ipa-layer", includeDocument: false }}
  >
    <span class="ipa-label"><FiloText text="IPA" role="ipa-label" /></span>
    <span class="ipa-value">{formatted}</span>
  </span>
{/if}

<style>
  .ipa-layer {
    display: block;
    margin-top: 0.28rem;
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .ipa-label {
    margin-right: var(--space-2);
    color: var(--color-text-subtle);
    font-size: var(--text-caption);
    text-transform: uppercase;
  }

  .ipa-value {
    font-variant-ligatures: none;
  }
</style>
