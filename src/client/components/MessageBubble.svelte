<script lang="ts">
  import type { Message } from "../lib/stores.svelte";

  interface Props {
    message: Message;
    sent: boolean;
    senderName?: string | null;
  }

  let { message, sent, senderName = null }: Props = $props();

  let time = $derived(
    new Date(message.created_at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })
  );

  let showRaw = $derived(sent && message.raw_text !== message.healed_text);
</script>

<div class="message-bubble" class:sent class:received={!sent}>
  {#if !sent && senderName}
    <div class="sender-name">{senderName}</div>
  {/if}
  <div class="bubble" class:pending={message._pending}>
    <div class="healed-text">{message.healed_text}</div>
    {#if message.translation}
      <div class="translation">{message.translation}</div>
    {/if}
  </div>
  {#if showRaw}
    <div class="raw-text">You wrote: {message.raw_text}</div>
  {/if}
  <div class="timestamp">{time}</div>
</div>

<style>
  .message-bubble {
    display: block;
    max-width: 80%;
  }

  .sent {
    align-self: flex-end;
  }

  .received {
    align-self: flex-start;
  }

  .bubble {
    padding: 0.6rem 0.9rem;
    border-radius: var(--radius);
    line-height: 1.45;
    font-size: 0.95rem;
    position: relative;
  }

  .sent .bubble {
    background: var(--color-sent);
    border-bottom-right-radius: 4px;
  }

  .received .bubble {
    background: var(--color-received);
    border: 1px solid var(--color-border);
    border-bottom-left-radius: 4px;
  }

  .sender-name {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-primary);
    margin-bottom: 0.15rem;
    padding: 0 0.25rem;
  }

  .translation {
    margin-top: 0.4rem;
    padding-top: 0.4rem;
    border-top: 1px solid var(--color-border);
    font-size: 0.85rem;
    color: var(--color-text-light);
    font-style: italic;
  }

  .raw-text {
    font-size: 0.8rem;
    color: var(--color-text-light);
    margin-top: 0.25rem;
    padding: 0 0.25rem;
  }

  .timestamp {
    font-size: 0.7rem;
    color: var(--color-text-light);
    margin-top: 0.15rem;
    padding: 0 0.25rem;
  }

  .pending {
    opacity: 0.6;
  }
</style>
