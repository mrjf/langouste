<script lang="ts">
  import FiloText from "../FiloText.svelte";

  export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "error";

  interface Props {
    label: string;
    tone?: BadgeTone;
    title?: string;
    class?: string;
  }

  let { label, tone = "neutral", title, class: className = "" }: Props = $props();
</script>

<span class={`ui-badge ${tone} ${className}`.trim()} {title}>
  <FiloText text={label} role="badge-label" />
</span>

<style>
  .ui-badge {
    min-height: 1.25rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 0 var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    line-height: 1;
    white-space: nowrap;
  }

  .neutral {
    color: var(--color-text-muted);
    background: transparent;
  }

  .accent {
    color: var(--color-accent);
    border-color: var(--color-accent-soft);
    background: var(--color-accent-wash);
  }

  .success {
    color: var(--color-success);
    border-color: color-mix(in srgb, var(--color-success) 28%, transparent);
  }

  .warning {
    color: var(--color-warning);
    border-color: color-mix(in srgb, var(--color-warning) 30%, transparent);
  }

  .error {
    color: var(--color-error);
    border-color: color-mix(in srgb, var(--color-error) 30%, transparent);
  }
</style>
