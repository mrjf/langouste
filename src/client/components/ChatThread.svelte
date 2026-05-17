<script lang="ts">
  import { api } from "../lib/api";
  import { activeConversation, conversations, user, clearUnread } from "../lib/stores.svelte";
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

  // Persist that the open conversation is read, so its badge stays cleared
  // across reloads. Optimistic + non-fatal; clears the local badge too.
  function markActiveRead(convId: string) {
    clearUnread(convId);
    api
      .markConversationRead(convId)
      .catch((err) => console.error("[Unread] mark-read failed:", err));
  }

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
  const isOrphan = $derived(conv != null && !conv.agent_connector_id);

  // Agent error banner for the *open* chat only (cleared on switch).
  let agentError: string | null = $state(null);

  // Available connections to reattach to when this conversation is orphaned.
  let availableConnections: Array<{ connector_id: string; name: string; type: string }> = $state([]);
  let reattaching = $state(false);
  let reattachTargetId = $state("");

  $effect(() => {
    if (isOrphan) {
      api.getAgentConnectors().then((list) => {
        availableConnections = list;
        if (list.length > 0 && !reattachTargetId) {
          reattachTargetId = list[0].connector_id;
        }
      }).catch(() => { availableConnections = []; });
    }
  });

  async function reattachConnector() {
    if (!conv || !reattachTargetId) return;
    reattaching = true;
    try {
      const updated = await api.setConversationConnector(conv.conversation_id, reattachTargetId);
      // Refresh store + active conversation.
      conversations.value = await api.getConversations();
      activeConversation.value = updated;
    } catch (err) {
      console.error("Reattach failed:", err);
      alert("Reattach failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      reattaching = false;
    }
  }

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

    // Transient, chat-scoped UI must not bleed across a switch.
    agentError = null;

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
        markActiveRead(convId); // opening the chat marks it read
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
      // This chat is open, so a freshly-arrived agent reply is already
      // "read" — advance the server cursor so it doesn't resurface.
      if (newMsg.is_agent) markActiveRead(convId);
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
  async function handleSend(
    convId: string,
    text: string,
    language: string,
    intent?: string,
  ) {
    if (sending) return;
    console.log(`[Send] handleSend conv=${convId.slice(0, 8)} text="${text.slice(0, 50)}" lang=${language} intent=${intent ?? "none"}`);

    sending = true;

    // Everything here is scoped to convId (the chat the text was composed
    // in), never the currently-active conv. We only touch the visible
    // `messages` array when convId is still the open conversation;
    // otherwise we update that conversation's cache so it's correct when
    // the user returns.
    const isActive = () => activeConversation.value?.conversation_id === convId;
    const base = messageCache.get(convId) ?? (isActive() ? messages : []);

    const pendingMsg: Message = {
      message_id: "pending-" + Date.now(),
      conversation_id: convId,
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

    let convMsgs = [...base, pendingMsg];
    messageCache.set(convId, convMsgs);
    if (isActive()) messages = convMsgs;

    try {
      const result = await api.sendMessage(convId, text, language, intent);
      convMsgs = (messageCache.get(convId) ?? convMsgs).map((m) =>
        m.message_id === pendingMsg.message_id ? result.message : m
      );
      if (result.agent_message) {
        if (!convMsgs.find((m) => m.message_id === result.agent_message.message_id)) {
          convMsgs = [...convMsgs, result.agent_message];
        }
      } else if (result.agent_error && isActive()) {
        agentError = result.agent_error;
      }
      messageCache.set(convId, convMsgs);
      if (isActive()) {
        messages = convMsgs;
        if (result.agent_message) fillMissingTranslations(convId);
      }
    } catch (err) {
      console.error("Failed to send message:", err);
      const pruned = (messageCache.get(convId) ?? convMsgs).filter(
        (m) => m.message_id !== pendingMsg.message_id,
      );
      messageCache.set(convId, pruned);
      if (isActive()) messages = pruned;
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
  {#if isOrphan}
    <div class="orphan-banner">
      <div class="orphan-msg">
        <strong>This chat's connection was deleted.</strong>
        Pick a connection to keep talking:
      </div>
      <div class="orphan-actions">
        {#if availableConnections.length > 0}
          <select bind:value={reattachTargetId} disabled={reattaching}>
            {#each availableConnections as c}
              <option value={c.connector_id}>{c.name} ({c.type})</option>
            {/each}
          </select>
          <button class="btn-attach" onclick={reattachConnector} disabled={reattaching || !reattachTargetId}>
            {reattaching ? "Attaching…" : "Attach"}
          </button>
        {:else}
          <a class="btn-attach" href="#/connections">Create a connection</a>
        {/if}
      </div>
    </div>
  {/if}

  <div class="thread-header">
    <div class="header-info">
      <span class="partner-name">{isOrphan ? "⚠ No connection" : partnerName}</span>
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
        conversationId={conv?.conversation_id}
      />
    {/each}
  </div>

  {#if translating}
    <div class="translating">Translating messages...</div>
  {/if}

  {#if agentError}
    <div class="agent-error">
      <strong>Agent error:</strong> {agentError}
      <button class="dismiss-btn" onclick={() => agentError = null}>×</button>
    </div>
  {/if}

  <div class="input-area">
    {#if myMember}
      <MessageInput
        conversationId={conv.conversation_id}
        member={myMember}
        disabled={sending || isOrphan}
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

  .agent-error {
    padding: 0.6rem 1rem;
    background: #fdecea;
    color: #b71c1c;
    border-top: 1px solid #f5c6cb;
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .dismiss-btn {
    margin-left: auto;
    background: none;
    border: none;
    color: #b71c1c;
    font-size: 1.1rem;
    cursor: pointer;
    padding: 0 0.25rem;
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

  .orphan-banner {
    padding: 0.75rem 1.25rem;
    background: #fff4e1;
    border-bottom: 1px solid #f0d294;
    color: #5d4100;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .orphan-msg strong {
    display: block;
    margin-bottom: 0.15rem;
  }

  .orphan-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .orphan-actions select {
    flex: 1;
    padding: 0.35rem 0.5rem;
    border: 1px solid #d8b870;
    border-radius: var(--radius-sm);
    background: white;
    font-size: 0.85rem;
  }

  .btn-attach {
    padding: 0.4rem 0.9rem;
    background: #b88528;
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
  }

  .btn-attach:disabled { opacity: 0.5; cursor: default; }
</style>
