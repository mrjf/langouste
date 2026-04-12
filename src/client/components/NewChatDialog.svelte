<script lang="ts">
  import { api } from "../lib/api";
  import { profile, conversations, activeConversation } from "../lib/stores.svelte";
  import { langOption, LANGUAGES } from "../lib/languages";
  import type { AgentConnector } from "../lib/stores.svelte";

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  let mode: "choose" | "person" | "agent" | "new-agent" = $state("choose");
  let connectors: AgentConnector[] = $state([]);
  let loading = $state(false);

  // Agent connector form
  let agentName = $state("");
  let agentType: "claude" | "openclaw" | "http" = $state("claude");
  const CLAUDE_MODELS = [
    { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ];
  let agentModel = $state("claude-sonnet-4-6");
  let agentSystemPrompt = $state("");
  let agentUrl = $state("");

  const langCodes = Object.keys(LANGUAGES);

  async function loadConnectors() {
    try {
      connectors = await api.getAgentConnectors();
    } catch (err) {
      console.error("Failed to load connectors:", err);
    }
  }

  function chooseAgent() {
    mode = "agent";
    loadConnectors();
  }

  async function createPersonChat() {
    loading = true;
    try {
      const learningLangs = profile.value?.learning_languages ?? [];
      const targetLangs = learningLangs.length > 0
        ? learningLangs.map((l) => ({ lang: l.lang, cefr_level: l.cefr_level ?? "A1" }))
        : [{ lang: "fr", cefr_level: "A1" }];
      const baseLangs = [profile.value?.base_language || "en"];
      const conv = await api.createConversation({ target_languages: targetLangs, base_languages: baseLangs });
      conversations.value = await api.getConversations();
      activeConversation.value = conv;
      onclose();
    } catch (err) {
      console.error("Failed to create conversation:", err);
    } finally {
      loading = false;
    }
  }

  async function startAgentChat(connector: AgentConnector) {
    loading = true;
    try {
      const learningLangs = profile.value?.learning_languages ?? [];
      const targetLangs = learningLangs.length > 0
        ? learningLangs.map((l) => ({ lang: l.lang, cefr_level: l.cefr_level ?? "A1" }))
        : [{ lang: "fr", cefr_level: "A1" }];
      const baseLangs = [profile.value?.base_language || "en"];
      const conv = await api.createConversation({
        target_languages: targetLangs,
        base_languages: baseLangs,
        agent_connector_id: connector.connector_id,
      });
      conversations.value = await api.getConversations();
      activeConversation.value = conv;
      onclose();
    } catch (err) {
      console.error("Failed to create agent chat:", err);
    } finally {
      loading = false;
    }
  }

  async function saveNewConnector() {
    loading = true;
    try {
      const config: Record<string, unknown> = {};
      if (agentType === "claude") {
        config.model = agentModel;
        if (agentSystemPrompt) config.system_prompt = agentSystemPrompt;
      } else if (agentType === "openclaw") {
        config.url = agentUrl || "ws://127.0.0.1:18789";
      } else if (agentType === "http") {
        config.url = agentUrl;
      }

      const connector = await api.createAgentConnector({
        name: agentName || `${agentType} agent`,
        type: agentType,
        config,
      });

      // Start a chat with the new connector immediately
      await startAgentChat(connector);
    } catch (err) {
      console.error("Failed to create connector:", err);
    } finally {
      loading = false;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onclose} onkeydown={(e) => e.key === "Escape" && onclose()}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="dialog" onclick={(e) => e.stopPropagation()}>
    {#if mode === "choose"}
      <h3>New conversation</h3>
      <div class="options">
        <button class="option-btn" onclick={createPersonChat} disabled={loading}>
          <span class="option-icon">👤</span>
          <span class="option-label">Chat with a person</span>
          <span class="option-desc">Share an invite link</span>
        </button>
        <button class="option-btn" onclick={chooseAgent} disabled={loading}>
          <span class="option-icon">🤖</span>
          <span class="option-label">Chat with an agent</span>
          <span class="option-desc">Claude, OpenClaw, or any AI</span>
        </button>
      </div>
    {:else if mode === "agent"}
      <h3>Choose an agent</h3>
      {#if connectors.length > 0}
        <div class="connector-list">
          {#each connectors as c}
            <button class="connector-btn" onclick={() => startAgentChat(c)} disabled={loading}>
              <span class="connector-type">{c.type}</span>
              <span class="connector-name">{c.name}</span>
            </button>
          {/each}
        </div>
      {/if}
      <button class="new-connector-btn" onclick={() => mode = "new-agent"}>
        + New agent connector
      </button>
      <button class="back-btn" onclick={() => mode = "choose"}>Back</button>
    {:else if mode === "new-agent"}
      <h3>New agent connector</h3>
      <div class="form">
        <div class="field">
          <label>Type</label>
          <select bind:value={agentType}>
            <option value="claude">Claude (Anthropic API)</option>
            <option value="openclaw">OpenClaw (local agent)</option>
            <option value="http">HTTP endpoint</option>
          </select>
        </div>
        <div class="field">
          <label>Name</label>
          <input type="text" bind:value={agentName} placeholder={agentType === "claude" ? "Claude" : agentType === "openclaw" ? "My OpenClaw" : "Custom agent"}>
        </div>
        {#if agentType === "claude"}
          <div class="field">
            <label>Model</label>
            <select bind:value={agentModel}>
              {#each CLAUDE_MODELS as m}
                <option value={m.id}>{m.label}</option>
              {/each}
            </select>
          </div>
          <div class="field">
            <label>System prompt (optional)</label>
            <textarea bind:value={agentSystemPrompt} rows={3} placeholder="You are a helpful assistant..."></textarea>
          </div>
        {:else if agentType === "openclaw"}
          <div class="field">
            <label>Gateway URL</label>
            <input type="text" bind:value={agentUrl} placeholder="ws://127.0.0.1:18789">
          </div>
        {:else if agentType === "http"}
          <div class="field">
            <label>Endpoint URL</label>
            <input type="text" bind:value={agentUrl} placeholder="https://api.example.com/chat">
          </div>
        {/if}
        <button class="save-btn" onclick={saveNewConnector} disabled={loading}>
          {loading ? "Creating..." : "Create & start chat"}
        </button>
        <button class="back-btn" onclick={() => { mode = "agent"; loadConnectors(); }}>Back</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .dialog {
    background: var(--color-surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    padding: 1.5rem;
    width: 100%;
    max-width: 380px;
  }

  h3 {
    font-size: 1rem;
    margin-bottom: 1rem;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .option-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
    padding: 0.75rem 1rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: none;
    text-align: left;
    transition: background 0.1s;
  }

  .option-btn:hover {
    background: var(--color-bg);
  }

  .option-icon {
    font-size: 1.2rem;
  }

  .option-label {
    font-weight: 600;
    font-size: 0.9rem;
  }

  .option-desc {
    font-size: 0.8rem;
    color: var(--color-text-light);
  }

  .connector-list {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-bottom: 0.75rem;
  }

  .connector-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: none;
    text-align: left;
  }

  .connector-btn:hover {
    background: var(--color-bg);
  }

  .connector-type {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--color-primary);
    background: var(--color-primary-light);
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    text-transform: uppercase;
  }

  .connector-name {
    font-size: 0.9rem;
  }

  .new-connector-btn {
    width: 100%;
    padding: 0.5rem;
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-light);
    font-size: 0.85rem;
    margin-bottom: 0.5rem;
  }

  .new-connector-btn:hover {
    background: var(--color-bg);
    color: var(--color-text);
  }

  .back-btn {
    width: 100%;
    padding: 0.4rem;
    border: none;
    background: none;
    color: var(--color-text-light);
    font-size: 0.8rem;
    text-decoration: underline;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .field label {
    display: block;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--color-text-light);
    margin-bottom: 0.2rem;
  }

  .field input, .field select, .field textarea {
    width: 100%;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
  }

  .field textarea {
    resize: vertical;
  }

  .save-btn {
    padding: 0.6rem;
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-weight: 600;
    font-size: 0.9rem;
  }

  .save-btn:disabled {
    opacity: 0.5;
  }
</style>
