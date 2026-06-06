<script lang="ts">
  import { chatStore, type Chat } from "../lib/chat.svelte";
  import { langTag } from "../lib/languages";
  import Badge from "./ui/Badge.svelte";

  interface ConversationListItem {
    id: string;
    language: string;
    title: string;
    working: boolean;
    unread: number;
    active: boolean;
  }

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

  function toListItem(chat: Chat): ConversationListItem {
    return {
      id: chat.id,
      language: myLang(chat),
      title: displayName(chat),
      working: chat.working,
      unread: unreadFor(chat),
      active: chatStore.activeId === chat.id,
    };
  }
</script>

<div class="conv-list">
  {#if chatStore.list.length === 0}
    <div class="conv-empty">No conversations yet</div>
  {:else}
    {#each chatStore.list as chat (chat.id)}
      {@const item = toListItem(chat)}
      <button
        class="conv-item"
        class:active={item.active}
        onclick={() => select(chat)}
      >
        <Badge label={langTag(item.language)} tone={item.active ? "accent" : "neutral"} />
        <span class="conv-main">
          <span class="conv-partner">{item.title}</span>
          {#if item.working}
            <span class="conv-working">working…</span>
          {/if}
        </span>
        {#if item.unread > 0}
          <span
            class="unread-badge"
            aria-label={`${item.unread} unread messages`}
          >
            {badgeLabel(item.unread)}
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
    min-height: 0;
  }

  .conv-empty {
    padding: var(--space-8) var(--space-5);
    text-align: center;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .conv-item {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 3.4rem;
    padding: var(--space-3) var(--space-5);
    border: none;
    border-bottom: 1px solid var(--color-border);
    background: none;
    text-align: left;
    color: var(--color-text);
    transition: background-color 120ms ease;
  }

  .conv-item:hover {
    background: var(--color-panel);
  }

  .conv-item.active {
    background: var(--color-panel);
    box-shadow: inset 3px 0 0 var(--color-accent);
  }

  /* Name + optional working line, stacked. Takes the row's flex space. */
  .conv-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .conv-partner {
    color: var(--color-text);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Subtle, static "agent is working" hint. No animation by design. */
  .conv-working {
    font-size: var(--text-caption);
    color: var(--color-text-muted);
    line-height: 1;
  }

  /* Slack-style number-in-circle unread indicator. */
  .unread-badge {
    flex-shrink: 0;
    min-width: 1.25rem;
    height: 1.25rem;
    padding: 0 0.4rem;
    border-radius: var(--radius-sm);
    background: var(--color-accent);
    color: var(--color-accent-contrast);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--font-medium);
    line-height: 1.25rem;
    text-align: center;
    box-sizing: border-box;
  }
</style>
