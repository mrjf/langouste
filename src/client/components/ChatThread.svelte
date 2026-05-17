<script lang="ts">
  import { api } from "../lib/api";
  import { user } from "../lib/stores.svelte";
  import { chatStore } from "../lib/chat.svelte";
  import { langOption, LANGUAGES } from "../lib/languages";
  import MessageBubble from "./MessageBubble.svelte";
  import MessageInput from "./MessageInput.svelte";

  // Pure renderer of the active Chat. No local message/sending/error state.
  const chat = $derived(chatStore.active);
  const userId = $derived(user.value?.id);

  // Load messages + realtime whenever the active chat changes. The Chat
  // caches its own messages, so re-entering is instant and idempotent.
  $effect(() => {
    const c = chat;
    if (!c) return;
    c.load();
    c.markRead();
  });

  const conv = $derived(chat?.conversation ?? null);
  const myMember = $derived(chat?.member);
  const myLangs = $derived(myMember?.target_languages?.map((t) => t.lang) ?? []);
  const myBaseLangs = $derived(myMember?.base_languages ?? []);
  const myLang = $derived(myLangs[0] ?? "");
  const myBaseLang = $derived(myBaseLangs[0] ?? "");
  const agentName = $derived(conv?.agent_connector?.name ?? "Agent");
  const partnerName = $derived(`🤖 ${agentName}`);
  const isOrphan = $derived(conv != null && !conv.agent_connector_id);

  let messagesEl = $state<HTMLElement>();
  let translating = $state(false);

  // Depend on the active chat's messages SIGNAL directly. `chat` is a
  // stable Chat instance (chatStore.active returns the same object), so a
  // chained $derived over `chat` memoises on that unchanging reference and
  // does NOT propagate an invalidation when chat.messages is reassigned
  // (the agent reply replacing the "…" bubble) — that was the
  // "stuck until reload" bug. In sqlite mode the HTTP response in #send is
  // the ONLY updater (no realtime), so this must react. Reading
  // chatStore.active?.messages inside this single $derived.by makes the
  // messages $state itself the tracked dependency.
  const uniqueMessages = $derived.by(() => {
    const msgs = chatStore.active?.messages ?? [];
    const seen = new Set<string>();
    return msgs.filter((m) => {
      if (seen.has(m.message_id)) return false;
      seen.add(m.message_id);
      return true;
    });
  });

  // Auto-scroll on new messages.
  $effect(() => {
    uniqueMessages.length;
    requestAnimationFrame(() => {
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  });

  // --- orphan reattach -------------------------------------------------
  let availableConnections = $state<Array<{ connector_id: string; name: string; type: string }>>([]);
  let reattaching = $state(false);
  let reattachTargetId = $state("");

  $effect(() => {
    if (isOrphan) {
      api
        .getAgentConnectors()
        .then((list) => {
          availableConnections = list;
          if (list.length > 0 && !reattachTargetId) reattachTargetId = list[0].connector_id;
        })
        .catch(() => {
          availableConnections = [];
        });
    }
  });

  async function reattachConnector() {
    if (!chat || !reattachTargetId) return;
    reattaching = true;
    try {
      await api.setConversationConnector(chat.id, reattachTargetId);
      const convs = await api.getConversations();
      chatStore.setConversations(convs);
    } catch (err) {
      console.error("Reattach failed:", err);
      alert("Reattach failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      reattaching = false;
    }
  }

  // --- language switch + (re)translation -------------------------------
  async function switchLanguage(
    field: "target_languages" | "base_languages",
    value: string,
  ) {
    if (!chat) return;
    const id = chat.id;
    try {
      const updates =
        field === "target_languages"
          ? { target_languages: [{ lang: value, cefr_level: "A1" }] }
          : { base_languages: [value] };
      await api.updateLanguages(id, updates as Record<string, unknown>);
      const convs = await api.getConversations();
      chatStore.setConversations(convs);

      const c = chatStore.get(id);
      if (c && c.messages.length > 0) {
        translating = true;
        try {
          const langs = [
            ...new Set(
              [
                ...(c.member?.target_languages?.map((t) => t.lang) ?? []),
                ...(c.member?.base_languages ?? []),
              ].filter(Boolean),
            ),
          ];
          c.messages = (await api.translateMessages(id, langs)) as typeof c.messages;
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

{#if !chat}
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
        conversationId={chat.id}
      />
    {/each}
  </div>

  {#if translating}
    <div class="translating">Translating messages...</div>
  {/if}

  {#if chat.agentError}
    <div class="agent-error">
      <strong>Agent error:</strong> {chat.agentError}
      <button class="dismiss-btn" onclick={() => (chat.agentError = null)}>×</button>
    </div>
  {/if}

  <div class="input-area">
    {#if myMember}
      <MessageInput {chat} disabled={isOrphan} />
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
