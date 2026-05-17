<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { profile } from "../lib/stores.svelte";
  import { chatStore } from "../lib/chat.svelte";
  import type { AgentConnector } from "../lib/stores.svelte";
  import ConnectionForm from "./ConnectionForm.svelte";

  type PanelState =
    | { kind: "list" }
    | { kind: "new" }
    | { kind: "edit"; connector: AgentConnector };

  let state: PanelState = $state({ kind: "list" });
  let connectors: AgentConnector[] = $state([]);
  let loading = $state(false);
  let saving = $state(false);
  let actionState = $state<Record<string, { label: string; kind?: "ok" | "error" }>>({});
  let deleteConfirmId = $state<string | null>(null);

  onMount(load);

  async function load() {
    loading = true;
    try {
      connectors = await api.getAgentConnectors();
    } catch (err) {
      console.error("Failed to load connections:", err);
    } finally {
      loading = false;
    }
  }

  async function createConnection(payload: { name: string; type: string; config: Record<string, unknown> }) {
    saving = true;
    try {
      await api.createAgentConnector(payload);
      state = { kind: "list" };
      await load();
    } catch (err) {
      console.error("Create failed:", err);
      alert("Create failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      saving = false;
    }
  }

  async function updateConnection(payload: { name: string; type: string; config: Record<string, unknown> }) {
    if (state.kind !== "edit") return;
    saving = true;
    try {
      await api.updateAgentConnector(state.connector.connector_id, {
        name: payload.name,
        config: payload.config,
      });
      state = { kind: "list" };
      await load();
    } catch (err) {
      console.error("Update failed:", err);
      alert("Update failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      saving = false;
    }
  }

  async function testConnection(c: AgentConnector) {
    actionState[c.connector_id] = { label: "Testing…" };
    try {
      const result = await api.testAgentConnector(c.connector_id);
      if (result.ok) {
        actionState[c.connector_id] = { label: "✓ Connected", kind: "ok" };
      } else {
        actionState[c.connector_id] = { label: "✗ " + (result.error ?? "Test failed"), kind: "error" };
      }
    } catch (err) {
      actionState[c.connector_id] = {
        label: "✗ " + (err instanceof Error ? err.message : "Test failed"),
        kind: "error",
      };
    }
    // Clear after a few seconds
    setTimeout(() => {
      const next = { ...actionState };
      delete next[c.connector_id];
      actionState = next;
    }, 5000);
  }

  async function deleteConnection(c: AgentConnector) {
    saving = true;
    try {
      await api.deleteAgentConnector(c.connector_id);
      deleteConfirmId = null;
      await load();
      // Refresh conversations list — any that used this connector are now orphaned.
      chatStore.setConversations(await api.getConversations());
    } catch (err) {
      console.error("Delete failed:", err);
      alert("Delete failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      saving = false;
    }
  }

  async function startChatWith(c: AgentConnector) {
    try {
      const learningLangs = profile.value?.learning_languages ?? [];
      const targetLangs = learningLangs.length > 0
        ? learningLangs.map((l) => ({ lang: l.lang, cefr_level: l.cefr_level ?? "A1" }))
        : [{ lang: "fr", cefr_level: "A1" }];
      const baseLangs = [profile.value?.base_language || "en"];
      const conv = await api.createConversation({
        target_languages: targetLangs,
        base_languages: baseLangs,
        agent_connector_id: c.connector_id,
      });
      chatStore.setConversations(await api.getConversations());
      chatStore.setActive(conv.conversation_id);
      location.hash = `#/c/${conv.conversation_id.slice(0, 8)}`;
    } catch (err) {
      console.error("Start chat failed:", err);
    }
  }

  function fmtDate(iso: string | null | undefined): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
</script>

<div class="connections">
  <header class="panel-header">
    <h1>Connections</h1>
    {#if state.kind === "list"}
      <button class="btn-primary" onclick={() => state = { kind: "new" }}>+ New connection</button>
    {/if}
  </header>

  {#if state.kind === "new"}
    <div class="card">
      <h2>New connection</h2>
      <ConnectionForm
        saveLabel="Create"
        saving={saving}
        onsave={createConnection}
        oncancel={() => state = { kind: "list" }}
      />
    </div>
  {:else if state.kind === "edit"}
    <div class="card">
      <h2>Edit: {state.connector.name}</h2>
      <ConnectionForm
        initial={state.connector}
        saveLabel="Save changes"
        saving={saving}
        onsave={updateConnection}
        oncancel={() => state = { kind: "list" }}
      />
    </div>
  {:else}
    {#if loading}
      <div class="empty">Loading…</div>
    {:else if connectors.length === 0}
      <div class="empty">
        <p>No connections yet.</p>
        <button class="btn-primary" onclick={() => state = { kind: "new" }}>Create your first connection</button>
      </div>
    {:else}
      <div class="list">
        {#each connectors as c}
          <div class="row">
            <div class="row-info">
              <div class="row-head">
                <span class="type-badge">{c.type}</span>
                <span class="name">{c.name}</span>
              </div>
              <div class="row-meta">Created {fmtDate((c as any).created_at)}</div>
              {#if actionState[c.connector_id]}
                <div class="action-result" class:ok={actionState[c.connector_id].kind === "ok"} class:err={actionState[c.connector_id].kind === "error"}>
                  {actionState[c.connector_id].label}
                </div>
              {/if}
            </div>
            <div class="row-actions">
              <button class="btn-ghost" onclick={() => startChatWith(c)} title="Start a new chat with this connection">
                💬 Chat
              </button>
              <button class="btn-ghost" onclick={() => testConnection(c)} title="Send a test message to verify it's reachable">
                🧪 Test
              </button>
              <button class="btn-ghost" onclick={() => state = { kind: "edit", connector: c }}>
                ✎ Edit
              </button>
              {#if deleteConfirmId === c.connector_id}
                <button class="btn-danger" onclick={() => deleteConnection(c)} disabled={saving}>
                  Confirm delete
                </button>
                <button class="btn-ghost" onclick={() => deleteConfirmId = null}>Cancel</button>
              {:else}
                <button class="btn-ghost danger" onclick={() => deleteConfirmId = c.connector_id}>
                  🗑 Delete
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .connections {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem 2rem;
    background: var(--color-bg);
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .panel-header h1 {
    font-size: 1.5rem;
    margin: 0;
  }

  .btn-primary {
    padding: 0.5rem 1rem;
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
  }

  .card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: 1.25rem 1.5rem;
    max-width: 560px;
  }

  .card h2 {
    font-size: 1.05rem;
    margin: 0 0 1rem;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
  }

  .row-info {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    flex: 1;
    min-width: 0;
  }

  .row-head {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .type-badge {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--color-primary);
    background: var(--color-primary-light);
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    text-transform: uppercase;
  }

  .name {
    font-weight: 500;
    font-size: 0.95rem;
  }

  .row-meta {
    font-size: 0.75rem;
    color: var(--color-text-light);
  }

  .action-result {
    font-size: 0.8rem;
    margin-top: 0.25rem;
    color: var(--color-text-light);
  }

  .action-result.ok { color: #256a2b; }
  .action-result.err { color: #9a2b2b; }

  .row-actions {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .btn-ghost {
    padding: 0.35rem 0.6rem;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    cursor: pointer;
    color: var(--color-text);
  }

  .btn-ghost:hover { background: var(--color-bg); }

  .btn-ghost.danger { color: #9a2b2b; }
  .btn-ghost.danger:hover { background: #fde2e2; }

  .btn-danger {
    padding: 0.35rem 0.6rem;
    background: #c0392b;
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }

  .empty {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--color-text-light);
  }

  .empty p { margin: 0 0 1rem; }
</style>
