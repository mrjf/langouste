<script lang="ts">
  interface Props {
    challenge: string | null;
  }

  let { challenge }: Props = $props();
</script>

{#if challenge}
  <div class="banner">
    <span class="icon">&#128161;</span>
    <span class="text">{challenge}</span>
  </div>
{/if}

<style>
  .banner {
    background: var(--color-challenge);
    border-radius: var(--radius-sm);
    padding: 0.6rem 0.9rem;
    margin: 0.5rem 1rem;
    font-size: 0.85rem;
    color: #1565c0;
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    border-left: 3px solid #1565c0;
  }

  .icon {
    font-size: 1rem;
    flex-shrink: 0;
  }

  .text {
    line-height: 1.4;
  }
</style>
