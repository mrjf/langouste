<script lang="ts">
  import { NEWS_LANGUAGE_OPTIONS } from "../../types/news";

  interface Props {
    selected: string[];
    onchange: (languages: string[]) => void;
    disabled?: boolean;
  }

  let { selected, onchange, disabled = false }: Props = $props();

  function toggle(code: string): void {
    if (selected.includes(code)) {
      if (selected.length > 1) onchange(selected.filter((candidate) => candidate !== code));
    } else if (selected.length < 8) {
      onchange([...selected, code]);
    }
  }
</script>

<div class="picker" aria-label="Edition languages">
  {#each NEWS_LANGUAGE_OPTIONS as language}
    <button
      type="button"
      class:active={selected.includes(language.code)}
      aria-pressed={selected.includes(language.code)}
      {disabled}
      onclick={() => toggle(language.code)}
    >
      <span>{language.nativeName}</span>
      <small>{language.code}</small>
    </button>
  {/each}
</div>

<style>
  .picker { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  button {
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
    padding: 0.42rem 0.55rem;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
  }
  button:hover:not(:disabled) { border-color: var(--accent); }
  button.active { border-color: var(--ink); background: var(--ink); color: var(--paper); }
  button:disabled { opacity: 0.55; cursor: wait; }
  span { font: 700 0.76rem var(--serif); }
  small { font: 700 0.52rem var(--sans); letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.65; }
</style>

