<script lang="ts">
  import { api } from "../lib/api";
  import { activeConversation, conversations, user } from "../lib/stores.svelte";
  import { subscribeToMessages, subscribeToConversation } from "../lib/supabase";
  import { langTag, langOption, langName, LANGUAGES } from "../lib/languages";
  import type { Message } from "../lib/stores.svelte";
  import MessageBubble from "./MessageBubble.svelte";
  import MessageInput from "./MessageInput.svelte";

  let messages: Message[] = $state([]);
  let sending = $state(false);
  let messagesEl: HTMLElement | undefined = $state();

  // Per-conversation message cache so switching is instant
  const messageCache = new Map<string, Message[]>();

  const conv = $derived(activeConversation.value);
  const userId = $derived(user.value?.id);

  // My membership in this conversation
  const myMember = $derived(conv?.members?.find((m) => m.user_id === userId));
  const myLangs = $derived(myMember?.target_languages?.map((t) => t.lang) ?? []);
  const myBaseLangs = $derived(myMember?.base_languages ?? []);
  const myLang = $derived(myLangs[0] ?? "");
  const myBaseLang = $derived(myBaseLangs[0] ?? "");

  const agentName = $derived(conv?.agent_connector?.name ?? "Agent");
  const partnerName = $derived(`🤖 ${agentName}`);

  // Deduplicated messages for rendering
  const uniqueMessages = $derived.by(() => {
    const seen = new Set<string>();
    return messages.filter((m) => {
      if (seen.has(m.message_id)) return false;
      seen.add(m.message_id);
      return true;
    });
  });

  // Subscribe to realtime when conversation changes
  $effect(() => {
    const c = conv;
    const convId = c?.conversation_id;

    if (!convId) {
      messages = [];
      return;
    }

    // Show cached messages immediately, then refresh in background
    const cached = messageCache.get(convId);
    if (cached) {
      console.log(`[Messages] Showing ${cached.length} cached message(s) for ${convId.slice(0, 8)}`);
      messages = cached;
    } else {
      messages = [];
    }

    let cancelled = false;

    (async () => {
      try {
        console.log(`[Messages] Fetching messages for ${convId.slice(0, 8)}`);
        const loaded = await api.getMessages(convId);
        if (cancelled) return;
        console.log(`[Messages] Loaded ${loaded.length} message(s) for ${convId.slice(0, 8)}`);
        messages = loaded;
        messageCache.set(convId, loaded);
        fillMissingTranslations(convId);
      } catch (err) {
        console.error("[Messages] Failed to load:", err);
      }
    })();

    const unsubMessages = subscribeToMessages(convId, async (msg) => {
      const newMsg = msg as unknown as Message;
      if (messages.some((m) => m.message_id === newMsg.message_id)) return;
      console.log(`[Realtime] New message in ${convId.slice(0, 8)}:`, newMsg.healed_text?.slice(0, 50));

      const hasPending = messages.some((m) => m._pending);
      if (hasPending) {
        messages = messages.map((m) =>
          m._pending && m.sender_id === newMsg.sender_id ? newMsg : m
        );
      } else {
        messages = [...messages, newMsg];
      }
      messageCache.set(convId, messages);
      fillMissingTranslations(convId);
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

  /** Send a message (called by MessageInput after check passes) */
  async function handleSend(text: string, language: string, intent?: string) {
    if (sending || !conv) return;
    console.log(`[Send] handleSend text="${text.slice(0, 50)}" lang=${language} intent=${intent ?? "none"}`);

    sending = true;

    const pendingMsg: Message = {
      message_id: "pending-" + Date.now(),
      conversation_id: conv.conversation_id,
      sender_id: userId!,
      raw_text: text,
      healed_text: text,
      language,
      translation: null,
      translations: {},
      corrections: [],
      next_challenge: null,
      created_at: new Date().toISOString(),
      _pending: true,
    };

    messages = [...messages, pendingMsg];

    try {
      const result = await api.sendMessage(conv.conversation_id, text, language, intent);
      messages = messages.map((m) =>
        m.message_id === pendingMsg.message_id ? result.message : m
      );
      if (result.agent_message) {
        if (!messages.find((m) => m.message_id === result.agent_message.message_id)) {
          messages = [...messages, result.agent_message];
        }
        fillMissingTranslations(conv.conversation_id);
      }
      messageCache.set(conv.conversation_id, messages);
    } catch (err) {
      console.error("Failed to send message:", err);
      messages = messages.filter((m) => m.message_id !== pendingMsg.message_id);
    } finally {
      sending = false;
    }
  }

  async function fillMissingTranslations(convId: string) {
    const langs = [...new Set([...myLangs, ...myBaseLangs].filter(Boolean))];
    if (langs.length === 0) return;

    const needsWork = messages.some(
      (m) => !m._pending && langs.some((l) => !m.translations?.[l])
    );
    if (!needsWork) return;

    console.log(`[Translation] Filling missing translations for langs=[${langs.join(",")}] in ${convId.slice(0, 8)}`);
    try {
      const translated = await api.translateMessages(convId, langs);
      if (conv?.conversation_id === convId) {
        console.log(`[Translation] Filled translations for ${translated.length} message(s)`);
        messages = translated;
        messageCache.set(convId, translated);
      }
    } catch (err) {
      console.error("[Translation] Failed to fill:", err);
    }
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  let translating = $state(false);

  async function switchLanguage(field: "target_languages" | "base_languages", value: string) {
    if (!conv) return;
    try {
      // For now, wrap single selection in array format
      const updates = field === "target_languages"
        ? { target_languages: [{ lang: value, cefr_level: "A1" }] }
        : { base_languages: [value] };

      await api.updateLanguages(conv.conversation_id, updates as any);
      const convs = await api.getConversations();
      const updated = convs.find((cv: any) => cv.conversation_id === conv.conversation_id);
      if (updated) {
        conversations.value = convs;
        activeConversation.value = updated;
      }

      if (messages.length > 0) {
        translating = true;
        try {
          const updatedMember = updated?.members?.find((m: any) => m.user_id === userId);
          const targetLangs = updatedMember?.target_languages?.map((t: any) => t.lang) ?? [myLang];
          const baseLangs = updatedMember?.base_languages ?? [myBaseLang];
          const langs = [...new Set([...targetLangs, ...baseLangs])];
          const translated = await api.translateMessages(conv.conversation_id, langs);
          messages = translated;
        } catch (err) {
          console.error("Failed to translate messages:", err);
        } finally {
          translating = false;
        }
      }
    } catch (err) {
      console.error("Failed to update language:", err);
    }
  }

  const langCodes = Object.keys(LANGUAGES);
</script>

{#if !conv}
  <div class="empty-state">Select a conversation to start chatting</div>
{:else}
  <div class="thread-header">
    <div class="header-info">
      <span class="partner-name">{partnerName}</span>
      <div class="lang-selectors">
        <label class="lang-selector" title="Target language — the language you're practicing">
          <span class="lang-label">🎯</span>
          <select
            value={myLang}
            onchange={(e) => switchLanguage("target_languages", (e.target as HTMLSelectElement).value)}
          >
            {#each langCodes as code}
              <option value={code}>{langOption(code)}</option>
            {/each}
          </select>
        </label>
        <label class="lang-selector" title="Base language — hints and explanations shown in this language">
          <span class="lang-label">💡</span>
          <select
            value={myBaseLang}
            onchange={(e) => switchLanguage("base_languages", (e.target as HTMLSelectElement).value)}
          >
            {#each langCodes as code}
              <option value={code}>{langOption(code)}</option>
            {/each}
          </select>
        </label>
      </div>
    </div>
  </div>

  <div class="messages" bind:this={messagesEl}>
    {#each uniqueMessages as msg (msg.message_id)}
      {@const isSent = !msg.is_agent && msg.sender_id === userId}
      <MessageBubble
        message={msg}
        sent={isSent}
        senderName={msg.is_agent ? `🤖 ${agentName}` : null}
        viewerLangs={myLangs}
        baseLangs={myBaseLangs}
        challenge={msg.next_challenge ?? null}
      />
    {/each}
  </div>

  {#if translating}
    <div class="translating">Translating messages...</div>
  {/if}

  <div class="input-area">
    {#if myMember}
      <MessageInput
        conversationId={conv.conversation_id}
        member={myMember}
        disabled={sending}
        onSend={handleSend}
      />
    {/if}
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

  .translating {
    padding: 0.5rem 1rem;
    text-align: center;
    font-size: 0.85rem;
    color: var(--color-text-light);
    background: var(--color-challenge);
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
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
  }
</style>
