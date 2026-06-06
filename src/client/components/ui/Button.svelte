<script lang="ts">
  import FiloText from "../FiloText.svelte";

  export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
  export type ButtonSize = "sm" | "md";

  interface Props {
    label: string;
    type?: "button" | "submit" | "reset";
    variant?: ButtonVariant;
    size?: ButtonSize;
    active?: boolean;
    disabled?: boolean;
    title?: string;
    prefix?: string;
    class?: string;
    onclick?: (event: MouseEvent) => void;
  }

  let {
    label,
    type = "button",
    variant = "secondary",
    size = "md",
    active = false,
    disabled = false,
    title,
    prefix,
    class: className = "",
    onclick,
  }: Props = $props();
</script>

<button
  class={`ui-button ${variant} ${size} ${active ? "active" : ""} ${className}`.trim()}
  {type}
  {disabled}
  {title}
  aria-pressed={active || undefined}
  onclick={onclick}
>
  {#if prefix}
    <span class="prefix" aria-hidden="true">
      <FiloText text={prefix} role="button-prefix" ariaHidden />
    </span>
  {/if}
  <FiloText text={label} role="button-label" />
</button>

<style>
  .ui-button {
    min-height: 2.25rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
    font-weight: var(--font-medium);
    line-height: 1;
    text-decoration: none;
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      color 120ms ease,
      opacity 120ms ease;
  }

  .ui-button.sm {
    min-height: 2rem;
    padding: 0 var(--space-3);
    font-size: var(--text-xs);
  }

  .ui-button.md {
    padding: 0 var(--space-4);
    font-size: var(--text-sm);
  }

  .ui-button.primary {
    background: var(--color-accent);
    color: var(--color-accent-contrast);
    border-color: var(--color-accent);
  }

  .ui-button.secondary {
    background: var(--color-surface);
    color: var(--color-text);
    border-color: var(--color-border-strong);
  }

  .ui-button.ghost {
    background: transparent;
    color: var(--color-text-muted);
    border-color: transparent;
  }

  .ui-button.danger {
    background: transparent;
    color: var(--color-error);
    border-color: color-mix(in srgb, var(--color-error) 30%, transparent);
  }

  .ui-button:hover:not(:disabled),
  .ui-button.active {
    background: var(--color-text);
    border-color: var(--color-text);
    color: var(--color-surface);
  }

  .ui-button.primary:hover:not(:disabled) {
    background: var(--color-accent-strong);
    border-color: var(--color-accent-strong);
  }

  .ui-button:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .prefix {
    font-family: var(--font-mono);
    font-size: 0.85em;
  }
</style>
