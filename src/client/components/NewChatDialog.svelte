<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { profile, conversations, activeConversation } from "../lib/stores.svelte";
  import type { AgentConnector } from "../lib/stores.svelte";
  import ConnectionForm from "./ConnectionForm.svelte";

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  let mode: "pick" | "new" = $state("pick");
  let connectors: AgentConnector[] = $state([]);
  let loading = $state(false);

  onMount(loadConnectors);

  async function loadConnectors() {
    try {
      connectors = await api.getAgentConnectors();
    } catch (err) {
      console.error("Failed to load connectors:", err);
    }
  }

  async function startChat(connector: AgentConnector) {
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
      console.error("Failed to create chat:", err);
    } finally {
      loading = false;
    }
  }

  async function createAndStart(payload: { name: string; type: string; config: Record<string, unknown> }) {
    loading = true;
    try {
      const connector = await api.createAgentConnector(payload);
      await startChat(connector);
    } catch (err) {
      console.error("Failed to create connection:", err);
      loading = false;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onclose} onkeydown={(e) => e.key === "Escape" && onclose()}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="dialog" onclick={(e) => e.stopPropagation()}>
    {#if mode === "pick"}
      <h3>New chat</h3>
      {#if connectors.length > 0}
        <div class="connector-list">
          {#each connectors as c}
            <button class="connector-btn" onclick={() => startChat(c)} disabled={loading}>
              <span class="connector-type">{c.type}</span>
              <span class="connector-name">{c.name}</span>
            </button>
          {/each}
        </div>
      {/if}
      <button class="new-connector-btn" onclick={() => mode = "new"}>
        + New connection
      </button>
      <button class="back-btn" onclick={onclose}>Cancel</button>
    {:else}
      <h3>New connection</h3>
      <ConnectionForm
        saveLabel="Create & start chat"
        saving={loading}
        onsave={createAndStart}
        oncancel={() => { mode = "pick"; loadConnectors(); }}
      />
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
    max-width: 420px;
    max-height: 90vh;
    overflow-y: auto;
  }

  h3 {
    font-size: 1rem;
    margin-bottom: 1rem;
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
    cursor: pointer;
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
    cursor: pointer;
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
    cursor: pointer;
  }
</style>
