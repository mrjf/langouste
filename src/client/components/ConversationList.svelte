<script lang="ts">
  import { api } from "../lib/api";
  import { conversations, activeConversation, profile } from "../lib/stores.svelte";
  import { langName } from "../lib/languages";
  import type { Conversation } from "../lib/stores.svelte";

  async function loadConversations() {
    try {
      conversations.value = await api.getConversations();
    } catch (err) {
      console.error("Failed to load conversations:", err);
    }
  }

  function selectConversation(conv: Conversation) {
    activeConversation.value = conv;
  }

  function myMember(conv: Conversation) {
    return conv.members?.find((m) => m.user_id === profile.value?.user_id);
  }

  function otherMembers(conv: Conversation) {
    return conv.members?.filter((m) => m.user_id !== profile.value?.user_id) ?? [];
  }

  function displayName(conv: Conversation): string {
    const others = otherMembers(conv);
    if (others.length === 0) return "Waiting for partner...";
    return others.map((m) => m.profile?.display_name ?? "Partner").join(", ");
  }

  function myLang(conv: Conversation): string {
    return myMember(conv)?.target_language ?? "?";
  }

  // Load on mount
  loadConversations();
</script>

<div class="conv-list">
  {#if conversations.value.length === 0}
    <div class="conv-empty">No conversations yet</div>
  {:else}
    {#each conversations.value as conv (conv.conversation_id)}
      <button
        class="conv-item"
        class:active={activeConversation.value?.conversation_id === conv.conversation_id}
        onclick={() => selectConversation(conv)}
      >
        <span class="conv-lang">{langName(myLang(conv))}</span>
        <span class="conv-partner">{displayName(conv)}</span>
      </button>
    {/each}
  {/if}
</div>

<style>
  .conv-list {
    flex: 1;
    overflow-y: auto;
  }

  .conv-empty {
    padding: 2rem 1rem;
    text-align: center;
    color: var(--color-text-light);
    font-size: 0.9rem;
  }

  .conv-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.75rem 1.25rem;
    border: none;
    background: none;
    text-align: left;
    font-size: 0.9rem;
    border-bottom: 1px solid var(--color-border);
    transition: background 0.1s;
  }

  .conv-item:hover {
    background: var(--color-bg);
  }

  .conv-item.active {
    background: var(--color-primary-light);
  }

  .conv-lang {
    font-weight: 600;
    font-size: 0.8rem;
    color: var(--color-primary);
    background: var(--color-primary-light);
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .conv-partner {
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
