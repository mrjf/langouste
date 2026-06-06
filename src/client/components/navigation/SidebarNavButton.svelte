<script lang="ts">
  import FiloText from "../FiloText.svelte";

  interface Props {
    index: string;
    label: string;
    active?: boolean;
    onclick?: (event: MouseEvent) => void;
  }

  let { index, label, active = false, onclick }: Props = $props();
</script>

<button class="sidebar-nav-button" class:active aria-current={active ? "page" : undefined} onclick={onclick}>
  <span class="index"><FiloText text={index} role="sidebar-index" /></span>
  <span class="label"><FiloText text={label} role="sidebar-label" /></span>
</button>

<style>
  .sidebar-nav-button {
    width: 100%;
    min-height: 2.5rem;
    display: grid;
    grid-template-columns: 2.25rem minmax(0, 1fr);
    align-items: center;
    border: 0;
    border-top: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text-muted);
    text-align: left;
  }

  .sidebar-nav-button:last-child {
    border-bottom: 1px solid var(--color-border);
  }

  .sidebar-nav-button:hover,
  .sidebar-nav-button.active {
    color: var(--color-text);
    background: var(--color-surface);
  }

  .sidebar-nav-button.active {
    box-shadow: inset 3px 0 0 var(--color-accent);
  }

  .index {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    color: var(--color-text-subtle);
  }

  .label {
    overflow: hidden;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
