<script lang="ts">
  import { api } from "../lib/api";
  import { user } from "../lib/stores.svelte";
  import { chatStore } from "../lib/chat.svelte";
  import { langOption, LANGUAGES } from "../lib/languages";
  import MessageBubble from "./MessageBubble.svelte";
  import MessageInput from "./MessageInput.svelte";
  import type { LanguageUpdateField, UpdateLanguagesRequest } from "../lib/api-contracts";
  import type { WorkbenchTextPayload } from "../lib/workbench";

  interface Props {
    onWorkbenchText?: (payload: WorkbenchTextPayload) => void;
  }

  let { onWorkbenchText }: Props = $props();

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
  const partnerName = $derived(agentName);
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
    field: LanguageUpdateField,
    value: string,
  ) {
    if (!chat) return;
    const id = chat.id;
    try {
      const updates =
        field === "target_languages"
          ? { target_languages: [{ lang: value, cefr_level: "A1" }] }
          : { base_languages: [value] };
      await api.updateLanguages(id, updates satisfies UpdateLanguagesRequest);
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
          <span class="lang-label">Target</span>
          <select
            value={myLang}
            onchange={(e) =>
              switchLanguage("target_languages", (e.target as HTMLSelectElement).value)}
          >
            {#each langCodes as code}
              <option value={code}>{langOption(code)}</option>
            {/each}
          </select>
        </label>
        <label class="lang-selector" title="Base language — hints and explanations shown in this language">
          <span class="lang-label">Base</span>
          <select
            value={myBaseLang}
            onchange={(e) =>
              switchLanguage("base_languages", (e.target as HTMLSelectElement).value)}
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
        senderName={msg.is_agent ? agentName : null}
        viewerLangs={myLangs}
        baseLangs={myBaseLangs}
        challenge={msg.next_challenge ?? null}
        conversationId={chat.id}
        {onWorkbenchText}
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
    color: var(--color-text-muted);
    font-size: var(--text-md);
  }

  .agent-error {
    padding: var(--space-3) var(--space-5);
    background: color-mix(in srgb, var(--color-error) 8%, var(--color-panel));
    color: var(--color-error);
    border-top: 1px solid color-mix(in srgb, var(--color-error) 24%, transparent);
    font-size: var(--text-sm);
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .dismiss-btn {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--color-error);
    font-size: var(--text-lg);
    cursor: pointer;
    padding: 0 0.25rem;
  }

  .translating {
    padding: var(--space-2) var(--space-5);
    text-align: center;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    background: var(--color-challenge);
  }

  .thread-header {
    min-height: 5rem;
    padding: var(--space-5) var(--space-6);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-panel);
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .header-info {
    display: grid;
    gap: var(--space-2);
    width: 100%;
  }

  .partner-name {
    color: var(--color-text);
    font-size: var(--text-lg);
    font-weight: var(--font-medium);
  }

  .lang-selectors {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .lang-selector {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .lang-label {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    white-space: nowrap;
  }

  .lang-selector select {
    min-height: 1.9rem;
    font-size: var(--text-xs);
    padding: 0 var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-5) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    background: var(--color-panel);
  }

  .input-area {
    padding: var(--space-4) var(--space-6);
    border-top: 1px solid var(--color-border);
    background: var(--color-panel);
  }

  .orphan-banner {
    padding: var(--space-4) var(--space-6);
    background: color-mix(in srgb, var(--color-warning) 10%, var(--color-panel));
    border-bottom: 1px solid color-mix(in srgb, var(--color-warning) 28%, transparent);
    color: var(--color-warning);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .orphan-msg strong {
    display: block;
    margin-bottom: 0.15rem;
  }

  .orphan-actions {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .orphan-actions select {
    flex: 1;
    min-height: 2.1rem;
    padding: 0 var(--space-2);
    border: 1px solid color-mix(in srgb, var(--color-warning) 34%, transparent);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    font-size: var(--text-sm);
  }

  .btn-attach {
    padding: var(--space-2) var(--space-4);
    background: var(--color-warning);
    color: var(--color-accent-contrast);
    border: none;
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
  }

  .btn-attach:disabled { opacity: 0.5; cursor: default; }
</style>
