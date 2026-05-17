<script lang="ts">
  import { onMount } from "svelte";
  import { user, profile, conversations, activeConversation } from "../lib/stores.svelte";
  import { loadSession, clearSession, loadProfile, loadLocalSession } from "../lib/auth";

  const SINGLE_USER =
    (import.meta.env.VITE_SINGLE_USER as string | undefined)?.toLowerCase() === "true";
  import { initSupabase } from "../lib/supabase";
  import { api } from "../lib/api";
  import LoginForm from "./LoginForm.svelte";
  import ConversationList from "./ConversationList.svelte";
  import ChatThread from "./ChatThread.svelte";
  import ProfilePanel from "./ProfilePanel.svelte";
  import ConnectionsPanel from "./ConnectionsPanel.svelte";
  import NewChatDialog from "./NewChatDialog.svelte";

  let ready = $state(false);
  let routed = $state(false);
  let showNewChat = $state(false);
  let view: "chat" | "profile" | "connections" = $state("chat");
  const loggedIn = $derived(!!user.value && !!profile.value);
  let updatingHash = false;

  function shortId(id: string): string {
    return id.slice(0, 8);
  }

  function findConv(convs: any[], slug: string) {
    return convs.find((c: any) => c.conversation_id.startsWith(slug));
  }

  // Update URL hash when view / active conversation changes.
  $effect(() => {
    if (!routed) return;
    let target = "";
    if (view === "profile") {
      target = "#/profile";
    } else if (view === "connections") {
      target = "#/connections";
    } else {
      const id = activeConversation.value?.conversation_id;
      target = id ? `#/c/${shortId(id)}` : "";
    }
    if (location.hash !== target) {
      updatingHash = true;
      history.pushState(null, "", target || location.pathname);
      updatingHash = false;
    }
  });

  onMount(async () => {
    initSupabase(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    );

    let hasSession = loadSession();
    // Single-user local mode: auto-issue a session on every boot if we don't
    // have one already. No login screen.
    if (!hasSession && SINGLE_USER) {
      hasSession = await loadLocalSession();
    }

    if (hasSession) {
      const [, convs] = await Promise.all([
        loadProfile(),
        api.getConversations().catch(() => []),
      ]);
      conversations.value = convs;
      await routeFromHash(convs);
    }

    routed = true;
    ready = true;

    window.addEventListener("popstate", () => {
      if (updatingHash) return;
      if (location.hash.startsWith("#/profile")) {
        view = "profile";
        return;
      }
      if (location.hash.startsWith("#/connections")) {
        view = "connections";
        return;
      }
      const convs = conversations.value;
      const match = location.hash.match(/^#\/c\/(.+)$/);
      if (match) {
        view = "chat";
        const conv = findConv(convs, match[1]);
        if (conv) activeConversation.value = conv;
      } else if (!location.hash || location.hash === "#") {
        view = "chat";
        activeConversation.value = null;
      }
    });
  });

  async function routeFromHash(convs: any[]) {
    if (location.hash.startsWith("#/profile")) {
      view = "profile";
      return;
    }
    if (location.hash.startsWith("#/connections")) {
      view = "connections";
      return;
    }
    const convMatch = location.hash.match(/^#\/c\/(.+)$/);
    if (convMatch) {
      view = "chat";
      const conv = findConv(convs, convMatch[1]);
      if (conv) activeConversation.value = conv;
    }
  }

  async function onAuthenticated() {
    const convs = await api.getConversations();
    conversations.value = convs;
    await routeFromHash(convs);
    routed = true;
  }

  function logout() {
    clearSession();
    history.replaceState(null, "", location.pathname);
  }
</script>

{#if !ready}
  <!-- loading -->
{:else if !loggedIn}
  <LoginForm onauthenticated={onAuthenticated} />
{:else}
  <div class="layout">
    <div class="sidebar">
      <div class="sidebar-header">
        <h2>Langouste</h2>
        <button class="btn-new" onclick={() => { view = "chat"; showNewChat = true; }}>+ New</button>
      </div>
      <nav class="sidebar-nav">
        <button
          class="nav-item"
          class:active={view === "chat" && !!activeConversation.value}
          onclick={() => { view = "chat"; }}
        >
          💬 Chats
        </button>
        <button
          class="nav-item"
          class:active={view === "profile"}
          onclick={() => { view = "profile"; activeConversation.value = null; }}
        >
          📊 Your progress
        </button>
        <button
          class="nav-item"
          class:active={view === "connections"}
          onclick={() => { view = "connections"; activeConversation.value = null; }}
        >
          🔌 Connections
        </button>
      </nav>
      {#if view === "chat"}
        <ConversationList />
      {/if}
      <div class="sidebar-footer">
        <span>{profile.value?.display_name}</span>
        {#if !SINGLE_USER}
          <button class="btn-logout" onclick={logout}>Logout</button>
        {/if}
      </div>
    </div>
    <div class="main-panel">
      {#if view === "profile"}
        <ProfilePanel />
      {:else if view === "connections"}
        <ConnectionsPanel />
      {:else}
        <ChatThread />
      {/if}
    </div>
  </div>
  {#if showNewChat}
    <NewChatDialog onclose={() => showNewChat = false} />
  {/if}
{/if}

<style>
  .layout {
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  .sidebar {
    width: 300px;
    background: var(--color-surface);
    border-right: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .sidebar-header {
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--color-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .sidebar-header h2 {
    font-size: 1.1rem;
    color: var(--color-primary);
  }

  .btn-new {
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    padding: 0.4rem 0.75rem;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .sidebar-nav {
    display: flex;
    flex-direction: column;
    padding: 0.5rem;
    gap: 0.1rem;
    border-bottom: 1px solid var(--color-border);
  }

  .nav-item {
    text-align: left;
    padding: 0.5rem 0.75rem;
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
    cursor: pointer;
    color: var(--color-text);
  }

  .nav-item:hover { background: var(--color-bg); }

  .nav-item.active {
    background: var(--color-primary-light);
    color: var(--color-primary);
    font-weight: 600;
  }

  .sidebar-footer {
    padding: 0.75rem 1.25rem;
    border-top: 1px solid var(--color-border);
    font-size: 0.8rem;
    color: var(--color-text-light);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .btn-logout {
    background: none;
    border: none;
    color: var(--color-text-light);
    font-size: 0.8rem;
    text-decoration: underline;
  }

  .main-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  @media (max-width: 640px) {
    .sidebar {
      position: fixed;
      z-index: 10;
      left: 0;
      top: 0;
      bottom: 0;
      width: 280px;
      transform: translateX(-100%);
      transition: transform 0.2s ease;
    }

    .sidebar.open {
      transform: translateX(0);
      box-shadow: var(--shadow-lg);
    }

    .main-panel {
      width: 100%;
    }
  }
</style>
