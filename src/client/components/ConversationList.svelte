<script lang="ts">
  import { chatStore, type Chat } from "../lib/chat.svelte";
  import { langTag } from "../lib/languages";

  interface Props {
    onSelect?: (chat: Chat) => void;
  }

  let { onSelect }: Props = $props();

  // Pure renderer of the ChatStore. Each row is a Chat; its draft, unread,
  // and working state all live on the Chat object itself.
  //
  // NOTE: do NOT wrap chatStore.list in $derived. That memoises on the
  // list's own dependencies (order + the chats Map) and would NOT re-run
  // when an individual chat's reactive fields (working/unread) change, so
  // the indicator would never update. Reading chatStore.list inline in the
  // template lets the {#each} + {#if chat.working} subscribe per-field.

  function select(chat: Chat) {
    chatStore.setActive(chat.id);
    chat.markRead();
    onSelect?.(chat);
  }

  /** Slack-style: show the number, cap the width at "99+". */
  function badgeLabel(n: number): string {
    return n > 99 ? "99+" : String(n);
  }

  /** Don't badge the conversation that's currently open. */
  function unreadFor(chat: Chat): number {
    if (chatStore.activeId === chat.id) return 0;
    return chat.unread;
  }

  function displayName(chat: Chat): string {
    return chat.conversation?.agent_connector?.name ?? "Agent";
  }

  function myLang(chat: Chat): string {
    return chat.member?.target_languages?.[0]?.lang ?? "?";
  }
</script>

<div class="conv-list">
  {#if chatStore.list.length === 0}
    <div class="conv-empty">No conversations yet</div>
  {:else}
    {#each chatStore.list as chat (chat.id)}
      <button
        class="conv-item"
        class:active={chatStore.activeId === chat.id}
        onclick={() => select(chat)}
      >
        <span class="conv-lang">{langTag(myLang(chat))}</span>
        <span class="conv-main">
          <span class="conv-partner">🤖 {displayName(chat)}</span>
          {#if chat.working}
            <span class="conv-working">working…</span>
          {/if}
        </span>
        {#if unreadFor(chat) > 0}
          <span
            class="unread-badge"
            aria-label={`${unreadFor(chat)} unread messages`}
          >
            {badgeLabel(unreadFor(chat))}
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
