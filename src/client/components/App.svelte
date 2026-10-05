<script lang="ts">
  import { onMount } from "svelte";
  import { user, profile } from "../lib/stores.svelte";
  import { chatStore } from "../lib/chat.svelte";
  import { loadSession, clearSession, loadProfile, loadLocalSession } from "../lib/auth";
  import { loadDisplaySettings } from "../lib/display-settings.svelte";
  import { api } from "../lib/api";
  import LoginForm from "./LoginForm.svelte";
  import ConversationList from "./ConversationList.svelte";
  import ChatThread from "./ChatThread.svelte";
  import ProfilePanel from "./ProfilePanel.svelte";
  import ConnectionsPanel from "./ConnectionsPanel.svelte";
  import DictionaryPanel from "./DictionaryPanel.svelte";
  import WorkbenchPanel from "./WorkbenchPanel.svelte";
  import AudioDrillEditor from "./AudioDrillEditor.svelte";
  import ExercisePanel from "./ExercisePanel.svelte";
  import ResourcesPanel from "./ResourcesPanel.svelte";
  import ParallelReader from "./ParallelReader.svelte";
  import CoursePanel from "./CoursePanel.svelte";
  import NewsPanel from "./NewsPanel.svelte";
  import NewChatDialog from "./NewChatDialog.svelte";
  import IpaToggle from "./IpaToggle.svelte";
  import FiloSourceInspector from "./FiloSourceInspector.svelte";
  import FiloText from "./FiloText.svelte";
  import Button from "./ui/Button.svelte";
  import SidebarNavButton from "./navigation/SidebarNavButton.svelte";
  import { routeForWorkbenchPayload, type WorkbenchTextPayload } from "../lib/workbench";

  const SINGLE_USER =
    (import.meta.env.VITE_SINGLE_USER as string | undefined)?.toLowerCase() === "true";

  let ready = $state(false);
  let routed = $state(false);
  let showNewChat = $state(false);
  let view:
    | "chat"
    | "profile"
    | "connections"
    | "dictionary"
    | "workbench"
    | "reader"
    | "news"
    | "audio-drills"
    | "exercises"
    | "course"
    | "resources" = $state("chat");
  // Profile route after #/profile. Examples:
  //   fr
  //   fr/lexis
  //   fr/lexis/vocabulary/<id>
  let profileRoute = $state("");
  let dictionaryRoute = $state("");
  let workbenchRoute = $state("");
  let newsRoute = $state("");
  let courseRoute = $state("");
  let audioDrillRoute = $state("");
  const loggedIn = $derived(!!user.value && !!profile.value);
  let updatingHash = false;
  let newsHashNavigation: "push" | "replace" = "push";

  function profileRouteFromHash(hash: string): string {
    const m = hash.match(/^#\/profile(?:\/(.+))?$/);
    return m?.[1] ?? "";
  }

  function dictionaryRouteFromHash(hash: string): string {
    const m = hash.match(/^#\/dictionary(?:\/(.+))?$/);
    return m?.[1] ?? "";
  }

  function workbenchRouteFromHash(hash: string): string {
    const pathMatch = hash.match(/^#\/workbench\/([^?]+)(?:\?.*)?$/);
    if (pathMatch?.[1]) {
      try {
        return decodeURIComponent(pathMatch[1]);
      } catch {
        return pathMatch[1];
      }
    }
    const queryMatch = hash.match(/^#\/workbench(?:\?(.*))?$/);
    return queryMatch?.[1] ?? "";
  }

  function workbenchHash(route: string): string {
    if (!route) return "#/workbench";
    if (route.startsWith("?")) return `#/workbench${route}`;
    if (route.includes("=")) return `#/workbench?${route}`;
    return `#/workbench/${encodeURIComponent(route)}`;
  }

  function audioDrillRouteFromHash(hash: string): string {
    const m = hash.match(/^#\/audio-drills(?:\/([^?]+))?(?:\?.*)?$/);
    if (!m?.[1]) return "";
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }

  function newsRouteFromHash(hash: string): string {
    const match = hash.match(/^#\/news(?:\/(.*))?$/);
    return match?.[1] ?? "";
  }

  function audioDrillHash(route: string): string {
    return route ? `#/audio-drills/${encodeURIComponent(route)}` : "#/audio-drills";
  }

  function shortId(id: string): string {
    return id.slice(0, 8);
  }

  // Resolve a #/c/<slug> short id to a full conversation id in the store.
  function activeIdFromSlug(slug: string): string | null {
    const chat = chatStore.list.find((c) => c.id.startsWith(slug));
    return chat?.id ?? null;
  }

  // Update URL hash when view / active conversation changes.
  $effect(() => {
    if (!routed) return;
    let target = "";
    if (view === "profile") {
      target = profileRoute ? `#/profile/${profileRoute}` : "#/profile";
    } else if (view === "connections") {
      target = "#/connections";
    } else if (view === "dictionary") {
      target = dictionaryRoute ? `#/dictionary/${dictionaryRoute}` : "#/dictionary";
    } else if (view === "workbench") {
      target = workbenchHash(workbenchRoute);
    } else if (view === "reader") {
      target = "#/reader";
    } else if (view === "course") {
      target = courseRoute ? `#/course/${courseRoute}` : "#/course";
    } else if (view === "news") {
      target = newsRoute ? `#/news/${newsRoute}` : "#/news";
    } else if (view === "audio-drills") {
      target = audioDrillHash(audioDrillRoute);
    } else if (view === "exercises") {
      target = "#/exercises";
    } else if (view === "resources") {
      target = "#/resources";
    } else {
      const id = chatStore.activeId;
      target = id ? `#/c/${shortId(id)}` : "";
    }
    if (location.hash !== target) {
      updatingHash = true;
      history[view === "news" && newsHashNavigation === "replace" ? "replaceState" : "pushState"](
        null,
        "",
        target || location.pathname,
      );
      newsHashNavigation = "push";
      updatingHash = false;
    }
  });

  onMount(async () => {
    loadDisplaySettings();
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
      chatStore.setConversations(convs);
      routeFromHash();
    }

    routed = true;
    ready = true;

    window.addEventListener("popstate", () => {
      if (updatingHash) return;
      if (location.hash.startsWith("#/profile")) {
        view = "profile";
        profileRoute = profileRouteFromHash(location.hash);
        return;
      }
      if (location.hash.startsWith("#/connections")) {
        view = "connections";
        return;
      }
      if (location.hash.startsWith("#/dictionary")) {
        view = "dictionary";
        dictionaryRoute = dictionaryRouteFromHash(location.hash);
        return;
      }
      if (location.hash.startsWith("#/workbench")) {
        view = "workbench";
        workbenchRoute = workbenchRouteFromHash(location.hash);
        return;
      }
      if (location.hash.startsWith("#/reader")) {
        view = "reader";
        return;
      }
      if (location.hash.startsWith("#/course")) { view = "course"; courseRoute = location.hash.replace(/^#\/course\/?/, ""); return; }
    if (location.hash.startsWith("#/news")) {
        view = "news";
        newsRoute = newsRouteFromHash(location.hash);
        return;
      }
      if (location.hash.startsWith("#/audio-drills")) {
        view = "audio-drills";
        audioDrillRoute = audioDrillRouteFromHash(location.hash);
        return;
      }
      if (location.hash.startsWith("#/exercises")) {
        view = "exercises";
        return;
      }
      if (location.hash.startsWith("#/resources")) {
        view = "resources";
        return;
      }
      const match = location.hash.match(/^#\/c\/(.+)$/);
      if (match) {
        view = "chat";
        const id = activeIdFromSlug(match[1]);
        if (id) chatStore.setActive(id);
      } else if (!location.hash || location.hash === "#") {
        view = "chat";
        chatStore.setActive(null);
      }
    });
  });

  function routeFromHash() {
    if (location.hash.startsWith("#/profile")) {
      view = "profile";
      profileRoute = profileRouteFromHash(location.hash);
      return;
    }
    if (location.hash.startsWith("#/connections")) {
      view = "connections";
      return;
    }
    if (location.hash.startsWith("#/dictionary")) {
      view = "dictionary";
      dictionaryRoute = dictionaryRouteFromHash(location.hash);
      return;
    }
    if (location.hash.startsWith("#/workbench")) {
      view = "workbench";
      workbenchRoute = workbenchRouteFromHash(location.hash);
      return;
    }
    if (location.hash.startsWith("#/reader")) {
      view = "reader";
      return;
    }
    if (location.hash.startsWith("#/course")) { view = "course"; courseRoute = location.hash.replace(/^#\/course\/?/, ""); return; }
    if (location.hash.startsWith("#/news")) {
      view = "news";
      newsRoute = newsRouteFromHash(location.hash);
      return;
    }
    if (location.hash.startsWith("#/audio-drills")) {
      view = "audio-drills";
      audioDrillRoute = audioDrillRouteFromHash(location.hash);
      return;
    }
    if (location.hash.startsWith("#/exercises")) {
      view = "exercises";
      return;
    }
    if (location.hash.startsWith("#/resources")) {
      view = "resources";
      return;
    }
    const convMatch = location.hash.match(/^#\/c\/(.+)$/);
    if (convMatch) {
      view = "chat";
      const id = activeIdFromSlug(convMatch[1]);
      if (id) chatStore.setActive(id);
    }
  }

  async function onAuthenticated() {
    const convs = await api.getConversations();
    chatStore.setConversations(convs);
    routeFromHash();
    routed = true;
  }

  function logout() {
    clearSession();
    history.replaceState(null, "", location.pathname);
  }

  function openWorkbenchText(payload: WorkbenchTextPayload) {
    workbenchRoute = routeForWorkbenchPayload({ ...payload, autoAnalyze: true });
    view = "workbench";
    chatStore.setActive(null);
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
        <div class="brand">
          <span class="brand-index"><FiloText text="LG" role="brand-index" /></span>
          <h2><FiloText text="Langouste" role="brand-name" /></h2>
        </div>
        <div class="sidebar-header-actions">
          <IpaToggle />
          <Button
            label="New"
            prefix="+"
            variant="primary"
            size="sm"
            onclick={() => { view = "chat"; showNewChat = true; }}
          />
        </div>
      </div>
      <nav class="sidebar-nav">
        <SidebarNavButton
          index="01"
          label="Chats"
          active={view === "chat" && !!chatStore.activeId}
          onclick={() => { view = "chat"; }}
        />
        <SidebarNavButton
          index="02"
          label="Progress"
          active={view === "profile"}
          onclick={() => { view = "profile"; chatStore.setActive(null); }}
        />
        <SidebarNavButton
          index="03"
          label="Connections"
          active={view === "connections"}
          onclick={() => { view = "connections"; chatStore.setActive(null); }}
        />
        <SidebarNavButton
          index="04"
          label="Dictionary"
          active={view === "dictionary"}
          onclick={() => { view = "dictionary"; chatStore.setActive(null); }}
        />
        <SidebarNavButton
          index="05"
          label="Workbench"
          active={view === "workbench"}
          onclick={() => { view = "workbench"; workbenchRoute = ""; chatStore.setActive(null); }}
        />
        <SidebarNavButton
          index="06"
          label="Reader"
          active={view === "reader"}
          onclick={() => { view = "reader"; }}
        />
        <SidebarNavButton
          index="07"
          label="News"
          active={view === "news"}
          onclick={() => { view = "news"; chatStore.setActive(null); }}
        />
        <SidebarNavButton
          index="08"
          label="Audio"
          active={view === "audio-drills"}
          onclick={() => { view = "audio-drills"; audioDrillRoute = ""; chatStore.setActive(null); }}
        />
        <SidebarNavButton
          index="09"
          label="Exercises"
          active={view === "exercises"}
          onclick={() => { view = "exercises"; chatStore.setActive(null); }}
        />
        <SidebarNavButton
          index="10"
          label="Resources"
          active={view === "resources"}
          onclick={() => { view = "resources"; chatStore.setActive(null); }}
        />
        <SidebarNavButton index="11" label="AI course" active={view === "course"} onclick={() => { view = "course"; chatStore.setActive(null); }} />
      </nav>
      <!-- Sidebar list is always mounted: working/unread indicators must
           stay visible no matter which main view (chat/profile/connections)
           is open. -->
      <ConversationList onSelect={() => { view = "chat"; }} />
      <div class="sidebar-footer">
        <span class="footer-name"><FiloText text={profile.value?.display_name} role="profile-display-name" /></span>
        {#if !SINGLE_USER}
          <Button label="Logout" variant="ghost" size="sm" onclick={logout} />
        {/if}
      </div>
    </div>
    <div class="main-panel">
      {#if view === "profile"}
        <ProfilePanel
          route={profileRoute}
          onRouteChange={(route) => (profileRoute = route)}
          onWorkbenchText={openWorkbenchText}
        />
      {:else if view === "connections"}
        <ConnectionsPanel />
      {:else if view === "dictionary"}
        <DictionaryPanel
          route={dictionaryRoute}
          onRouteChange={(route) => (dictionaryRoute = route)}
        />
      {:else if view === "workbench"}
        <WorkbenchPanel route={workbenchRoute} onRouteChange={(route) => (workbenchRoute = route)} />
      {:else if view === "reader"}
        <ParallelReader />
      {:else if view === "course"}
        <CoursePanel route={courseRoute} onRouteChange={(route) => (courseRoute = route)} />
      {:else if view === "news"}
        <NewsPanel
          route={newsRoute}
          onRouteChange={(route, navigation = "replace") => {
            newsHashNavigation = navigation;
            newsRoute = route;
          }}
        />
      {:else if view === "audio-drills"}
        <AudioDrillEditor
          route={audioDrillRoute}
          onRouteChange={(route) => (audioDrillRoute = route)}
        />
      {:else if view === "exercises"}
        <ExercisePanel />
      {:else if view === "resources"}
        <ResourcesPanel />
      {:else}
        <ChatThread onWorkbenchText={openWorkbenchText} />
      {/if}
    </div>
  </div>
  {#if showNewChat}
    <NewChatDialog onclose={() => showNewChat = false} />
  {/if}
{/if}
<FiloSourceInspector />

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(17.5rem, 20rem) minmax(0, 1fr);
    height: 100dvh;
    overflow: hidden;
    background: var(--color-bg);
  }

  .sidebar {
    background: var(--color-surface);
    border-right: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .sidebar-header {
    min-height: 5rem;
    padding: var(--space-5);
    border-bottom: 1px solid var(--color-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .brand {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr);
    align-items: baseline;
    min-width: 0;
  }

  .brand-index {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    color: var(--color-accent);
  }

  .sidebar-header h2 {
    overflow: hidden;
    color: var(--color-text);
    font-size: var(--text-lg);
    font-weight: var(--font-medium);
    letter-spacing: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sidebar-header-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: 0 0 auto;
  }

  .sidebar-nav {
    display: block;
  }

  .sidebar-footer {
    padding: var(--space-4) var(--space-5);
    border-top: 1px solid var(--color-border);
    color: var(--color-text-muted);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
  }

  .footer-name {
    min-width: 0;
    overflow: hidden;
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .main-panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--color-panel);
  }

  @media (max-width: 760px) {
    .layout {
      display: flex;
      flex-direction: column;
      overflow: auto;
    }

    .sidebar {
      width: 100%;
      max-height: 42dvh;
      border-right: 0;
      border-bottom: 1px solid var(--color-border);
    }

    .main-panel {
      width: 100%;
      min-height: 58dvh;
    }
  }
</style>
