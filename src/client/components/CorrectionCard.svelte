<script lang="ts">
  import type { Correction } from "../lib/stores.svelte";

  interface Props {
    corrections: Correction[];
  }

  let { corrections }: Props = $props();
  let expanded = $state(false);
</script>

{#if corrections.length > 0}
  <div class="card">
    <button class="toggle-btn" onclick={() => expanded = !expanded}>
      {expanded ? "Hide corrections" : `${corrections.length} correction${corrections.length > 1 ? "s" : ""}`}
    </button>
    {#if expanded}
      <div class="details">
        {#each corrections as c}
          <div class="correction-item">
            <span class="original">{c.original}</span>
            <span class="arrow">&rarr;</span>
            <span class="corrected">{c.corrected}</span>
            <span class="explanation">{c.explanation}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .card {
    background: var(--color-correction);
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
    border-left: 3px solid #f39c12;
    max-width: 80%;
    align-self: flex-end;
    margin-top: 0.35rem;
  }

  .correction-item {
    margin-bottom: 0.4rem;
  }

  .correction-item:last-child {
    margin-bottom: 0;
  }

  .original {
    text-decoration: line-through;
    color: var(--color-error);
  }

  .corrected {
    color: var(--color-success);
    font-weight: 500;
  }

  .arrow {
    color: var(--color-text-light);
    margin: 0 0.3rem;
  }

  .explanation {
    display: block;
    color: var(--color-text-light);
    font-size: 0.8rem;
    margin-top: 0.1rem;
  }

  .toggle-btn {
    background: none;
    border: none;
    color: #f39c12;
    font-size: 0.8rem;
    font-weight: 500;
    padding: 0;
  }
</style>
