<script lang="ts">
  import {
    conversations,
    activeConversation,
    profile,
    clearUnread,
    isAgentWorking,
  } from "../lib/stores.svelte";
  import { langTag } from "../lib/languages";
  import { api } from "../lib/api";
  import type { Conversation } from "../lib/stores.svelte";

  function selectConversation(conv: Conversation) {
    activeConversation.value = conv;
    // Optimistically clear the badge, then persist last_read_at. Failure
    // is non-fatal — the count reconciles on the next list reload.
    if (conv.unread_count) {
      clearUnread(conv.conversation_id);
      api
        .markConversationRead(conv.conversation_id)
        .catch((err) => console.error("[Unread] mark-read failed:", err));
    }
  }

  /** Slack-style: show the number, cap the width at "99+". */
  function badgeLabel(n: number): string {
    return n > 99 ? "99+" : String(n);
  }

  function unreadFor(conv: Conversation): number {
    // Never show a badge on the open conversation.
    if (activeConversation.value?.conversation_id === conv.conversation_id) return 0;
    return conv.unread_count ?? 0;
  }

  function myMember(conv: Conversation) {
    return conv.members?.find((m) => m.user_id === profile.value?.user_id);
  }

  function displayName(conv: Conversation): string {
    return conv.agent_connector?.name ?? "Agent";
  }

  function myLang(conv: Conversation): string {
    return myMember(conv)?.target_languages?.[0]?.lang ?? "?";
  }
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
        <span class="conv-lang">{langTag(myLang(conv))}</span>
        <span class="conv-main">
          <span class="conv-partner">🤖 {displayName(conv)}</span>
          {#if isAgentWorking(conv.conversation_id)}
            <span class="conv-working">working…</span>
          {/if}
        </span>
        {#if unreadFor(conv) > 0}
          <span
            class="unread-badge"
            aria-label={`${unreadFor(conv)} unread messages`}
          >
            {badgeLabel(unreadFor(conv))}
          </span>
        {/if}
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

  /* Name + optional working line, stacked. Takes the row's flex space. */
  .conv-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .conv-partner {
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Subtle, static "agent is working" hint. No animation by design. */
  .conv-working {
    font-size: 0.72rem;
    color: var(--color-text-light);
    font-style: italic;
    line-height: 1;
  }

  /* Slack-style number-in-circle unread indicator. */
  .unread-badge {
    flex-shrink: 0;
    min-width: 1.25rem;
    height: 1.25rem;
    padding: 0 0.4rem;
    border-radius: 999px;
    background: var(--color-primary, #e02f5b);
    color: #fff;
    font-size: 0.72rem;
    font-weight: 700;
    line-height: 1.25rem;
    text-align: center;
    box-sizing: border-box;
  }
</style>
