<script lang="ts">
  import { api } from "../lib/api";
  import { activeConversation, conversations, user } from "../lib/stores.svelte";
  import { subscribeToMessages, subscribeToConversation } from "../lib/supabase";
  import { langName, LANGUAGES } from "../lib/languages";
  import type { Message } from "../lib/stores.svelte";
  import MessageBubble from "./MessageBubble.svelte";
  import CorrectionCard from "./CorrectionCard.svelte";
  import ChallengeBanner from "./ChallengeBanner.svelte";

  let messages: Message[] = $state([]);
  let challenge: string | null = $state(null);
  let sending = $state(false);
  let inputText = $state("");
  let messagesEl: HTMLElement | undefined = $state();

  const conv = $derived(activeConversation.value);
  const userId = $derived(user.value?.id);

  // My membership in this conversation
  const myMember = $derived(conv?.members?.find((m) => m.user_id === userId));
  const myLang = $derived(myMember?.target_language ?? "");
  const myBaseLang = $derived(myMember?.base_language ?? "");

  // Other members
  const otherMembers = $derived(conv?.members?.filter((m) => m.user_id !== userId) ?? []);
  const needsPartner = $derived(otherMembers.length === 0);
  const partnerName = $derived(
    needsPartner
      ? "Waiting for partner..."
      : otherMembers.map((m) => m.profile?.display_name ?? "Partner").join(", ")
  );

  const joinUrl = $derived(conv ? `${location.origin}/#join/${conv.invite_code}` : "");

  // Participant name lookup
  const participants = $derived.by(() => {
    if (!conv?.members) return {};
    const map: Record<string, string> = {};
    for (const m of conv.members) {
      if (m.profile) map[m.user_id] = m.profile.display_name;
    }
    return map;
  });

  // Subscribe to realtime when conversation changes; cleanup on change or unmount
  $effect(() => {
    const c = conv;
    const convId = c?.conversation_id;

    if (!convId) {
      messages = [];
      challenge = null;
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const loaded = await api.getMessages(convId);
        if (!cancelled) messages = loaded;
      } catch (err) {
        console.error("Failed to load messages:", err);
      }
    })();

    const unsubMessages = subscribeToMessages(convId, (msg) => {
      const newMsg = msg as unknown as Message;
      if (!messages.find((m) => m.message_id === newMsg.message_id)) {
        messages = [...messages, newMsg];
      }
    });

    const unsubConv = subscribeToConversation(convId, async () => {
      try {
        const convs = await api.getConversations();
        const updated = convs.find((cv: any) => cv.conversation_id === convId);
        if (updated) {
          conversations.value = convs;
          activeConversation.value = updated;
        }
      } catch (err) {
        console.error("Failed to refresh conversation:", err);
      }
    });

    return () => {
      cancelled = true;
      unsubMessages();
      unsubConv();
    };
  });

  // Auto-scroll when messages change
  $effect(() => {
    messages.length;
    scrollToBottom();
  });

  async function send() {
    const text = inputText.trim();
    if (!text || sending || !conv) return;

    sending = true;
    const pendingMsg: Message = {
      message_id: "pending-" + Date.now(),
      conversation_id: conv.conversation_id,
      sender_id: userId!,
      raw_text: text,
      healed_text: text,
      translation: null,
      corrections: [],
      next_challenge: null,
      created_at: new Date().toISOString(),
      _pending: true,
    };

    messages = [...messages, pendingMsg];
    inputText = "";

    try {
      const result = await api.sendMessage(conv.conversation_id, text);
      messages = messages.map((m) =>
        m.message_id === pendingMsg.message_id ? result.message : m
      );
      challenge = result.next_challenge;
    } catch (err) {
      console.error("Failed to send message:", err);
      messages = messages.filter((m) => m.message_id !== pendingMsg.message_id);
      inputText = text;
    } finally {
      sending = false;
    }
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  let copyLabel = $state("Copy invite link");
  let copyLabelInline = $state("Copy");

  async function copyInviteLink(inline = false) {
    try {
      await navigator.clipboard.writeText(joinUrl);
      if (inline) {
        copyLabelInline = "Copied!";
        setTimeout(() => copyLabelInline = "Copy", 2000);
      } else {
        copyLabel = "Copied!";
        setTimeout(() => copyLabel = "Copy invite link", 2000);
      }
    } catch {
      // Fallback
    }
  }

  async function switchLanguage(field: "target_language" | "base_language", value: string) {
    if (!conv) return;
    try {
      await api.updateLanguages(conv.conversation_id, { [field]: value });
      // Refresh conversation data
      const convs = await api.getConversations();
      const updated = convs.find((cv: any) => cv.conversation_id === conv.conversation_id);
      if (updated) {
        conversations.value = convs;
        activeConversation.value = updated;
      }
    } catch (err) {
      console.error("Failed to update language:", err);
    }
  }

  const langEntries = Object.entries(LANGUAGES);
</script>

{#if !conv}
  <div class="empty-state">Select a conversation to start chatting</div>
{:else}
  <div class="thread-header">
    <div class="header-info">
      <span class="partner-name">{partnerName}</span>
      <div class="lang-selectors">
        <label class="lang-selector">
          <span class="lang-label">Practicing</span>
          <select
            value={myLang}
            onchange={(e) => switchLanguage("target_language", (e.target as HTMLSelectElement).value)}
          >
            {#each langEntries as [code, label]}
              <option value={code}>{label}</option>
            {/each}
          </select>
        </label>
        <label class="lang-selector">
          <span class="lang-label">Hints in</span>
          <select
            value={myBaseLang}
            onchange={(e) => switchLanguage("base_language", (e.target as HTMLSelectElement).value)}
          >
            {#each langEntries as [code, label]}
              <option value={code}>{label}</option>
            {/each}
          </select>
        </label>
      </div>
    </div>
    {#if needsPartner}
      <button class="btn-copy-link" onclick={() => copyInviteLink(false)}>{copyLabel}</button>
    {/if}
  </div>

  {#if needsPartner}
    <div class="invite-banner">
      Waiting for a partner to join. Share this link:
      <span class="invite-url">{joinUrl}</span>
      <button class="btn-copy-link-inline" onclick={() => copyInviteLink(true)}>{copyLabelInline}</button>
    </div>
  {/if}

  <div class="messages" bind:this={messagesEl}>
    {#each messages as msg (msg.message_id)}
      {@const isSent = msg.sender_id === userId}
      <MessageBubble
        message={msg}
        sent={isSent}
        senderName={participants[msg.sender_id] ?? null}
      />
      {#if isSent && msg.corrections?.length}
        <CorrectionCard corrections={msg.corrections} />
      {/if}
    {/each}
  </div>

  <ChallengeBanner {challenge} />

  <div class="input-area">
    <textarea
      placeholder="Write in {langName(myLang)} (or mix languages!)..."
      rows={1}
      bind:value={inputText}
      onkeydown={handleKeydown}
    ></textarea>
    <button class="btn-send" disabled={sending} onclick={send}>Send</button>
  </div>
{/if}

<style>
  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-light);
    font-size: 1.1rem;
  }

  .thread-header {
    padding: 0.75rem 1.25rem;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .header-info {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .partner-name {
    font-weight: 600;
  }

  .lang-selectors {
    display: flex;
    gap: 0.75rem;
  }

  .lang-selector {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.8rem;
    color: var(--color-text-light);
  }

  .lang-label {
    font-size: 0.75rem;
    white-space: nowrap;
  }

  .lang-selector select {
    font-size: 0.8rem;
    padding: 0.15rem 0.3rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: var(--color-bg);
    color: var(--color-text);
  }

  .btn-copy-link {
    margin-left: auto;
    background: var(--color-challenge);
    color: #1565c0;
    border: 1px solid #90caf9;
    border-radius: var(--radius-sm);
    padding: 0.35rem 0.75rem;
    font-size: 0.8rem;
    font-weight: 500;
    flex-shrink: 0;
  }

  .invite-banner {
    padding: 0.75rem 1.25rem;
    background: var(--color-challenge);
    border-bottom: 1px solid #90caf9;
    font-size: 0.85rem;
    color: #1565c0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .invite-url {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    background: white;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    word-break: break-all;
    user-select: all;
  }

  .btn-copy-link-inline {
    background: #1565c0;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 0.25rem 0.6rem;
    font-size: 0.8rem;
    font-weight: 500;
    flex-shrink: 0;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .input-area {
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--color-border);
    background: var(--color-surface);
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;
  }

  textarea {
    flex: 1;
    resize: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    font-size: 0.95rem;
    min-height: 44px;
    max-height: 120px;
    outline: none;
    line-height: 1.4;
  }

  textarea:focus {
    border-color: var(--color-primary);
  }

  .btn-send {
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    padding: 0.75rem 1.25rem;
    font-weight: 600;
    font-size: 0.9rem;
    white-space: nowrap;
  }

  .btn-send:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
