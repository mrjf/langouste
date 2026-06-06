<script lang="ts">
  import { ipaLayerPreference, setIpaLayerEnabled } from "../lib/display-settings.svelte";
  import FiloText from "./FiloText.svelte";

  function toggle() {
    setIpaLayerEnabled(!ipaLayerPreference.enabled);
  }
</script>

<button
  class="ipa-toggle"
  class:active={ipaLayerPreference.enabled}
  type="button"
  aria-pressed={ipaLayerPreference.enabled}
  title={ipaLayerPreference.enabled ? "Hide IPA layer" : "Show IPA layer"}
  onclick={toggle}
>
  <FiloText text="IPA" role="toggle-label" />
</button>

<style>
  .ipa-toggle {
    min-height: 2rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    line-height: 1;
    padding: 0 var(--space-2);
    white-space: nowrap;
  }

  .ipa-toggle:hover,
  .ipa-toggle.active {
    border-color: var(--color-accent-soft);
    background: var(--color-accent-wash);
    color: var(--color-accent);
  }
</style>
