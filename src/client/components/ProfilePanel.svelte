<script lang="ts">
  import { onMount } from "svelte";
  import { profile, activeConversation } from "../lib/stores.svelte";
  import { api } from "../lib/api";
  import { langOption, langTag, LANGUAGES } from "../lib/languages";

  type DashboardLevel = { kind: "dashboard" };
  type DimensionLevel = { kind: "dimension"; dimension: string };
  type ItemLevel = { kind: "item"; itemType: "vocabulary" | "grammar"; itemId: string };
  type Level = DashboardLevel | DimensionLevel | ItemLevel;

  const DIMENSIONS = [
    { key: "lexis",       label: "Lexis",       subtitle: "Vocabulary & collocations" },
    { key: "morphology",  label: "Morphology",  subtitle: "Word forms, conjugation, gender" },
    { key: "syntax",      label: "Syntax",      subtitle: "Word order, agreement, clauses" },
    { key: "orthography", label: "Orthography", subtitle: "Spelling, accents, punctuation" },
    { key: "phonology",   label: "Phonology",   subtitle: "Sounds & pronunciation" },
    { key: "pragmatics",  label: "Pragmatics",  subtitle: "Register, politeness" },
    { key: "discourse",   label: "Discourse",   subtitle: "Connectors, coherence" },
  ] as const;

  const learningLangs = $derived.by(() => {
    const profs = profile.value?.learning_languages ?? [];
    if (profs.length > 0) return profs;
    return [{ lang: "fr", cefr_level: "A1", assessed_at: "" }];
  });

  let selectedLang = $state<string>("");
  let level: Level = $state({ kind: "dashboard" });
  let stats: any = $state(null);
  let dimensionData: any = $state(null);
  let itemData: any = $state(null);
  let loading = $state(false);

  $effect(() => {
    if (!selectedLang && learningLangs.length > 0) {
      selectedLang = learningLangs[0].lang;
    }
  });

  $effect(() => {
    if (!selectedLang) return;
    loadDashboard(selectedLang);
  });

  async function loadDashboard(lang: string) {
    loading = true;
    try {
      stats = await api.getLanguageStats(lang);
    } catch (err) {
      console.error("stats load failed:", err);
      stats = null;
    } finally {
      loading = false;
    }
  }

  async function openDimension(dimension: string) {
    level = { kind: "dimension", dimension };
    loading = true;
    try {
      dimensionData = await api.getDimensionItems(selectedLang, dimension, { sort: "problematic" });
    } catch (err) {
      console.error("dimension load failed:", err);
      dimensionData = null;
    } finally {
      loading = false;
    }
  }

  async function openItem(itemType: "vocabulary" | "grammar", itemId: string) {
    level = { kind: "item", itemType, itemId };
    loading = true;
    try {
      itemData = await api.getProfileItem(itemType, itemId);
    } catch (err) {
      console.error("item load failed:", err);
      itemData = null;
    } finally {
      loading = false;
    }
  }

  function backToDashboard() {
    level = { kind: "dashboard" };
    dimensionData = null;
    itemData = null;
  }

  function backToDimension() {
    if (level.kind === "item") {
      // dimensionData is still populated from the prior step
      const d = dimensionData?.dimension ?? "lexis";
      level = { kind: "dimension", dimension: d };
      itemData = null;
    }
  }

  function jumpToMessage(conversationId: string) {
    const short = conversationId.slice(0, 8);
    // Find the Conversation object in the store and open it.
    const conv = { conversation_id: conversationId } as any;
    activeConversation.value = conv;
    location.hash = `#/c/${short}`;
  }

  function fmtDate(iso: string | null | undefined): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function accuracyPct(item: any): string {
    if (!item.productions) return "—";
    return `${Math.round((item.correct_productions / item.productions) * 100)}%`;
  }

  function dimensionLabel(key: string): string {
    return DIMENSIONS.find((d) => d.key === key)?.label ?? key;
  }
</script>

<div class="profile">
  <header class="profile-header">
    <h1>Your progress</h1>
    <div class="lang-selector">
      {#each learningLangs as l}
        <button
          class="lang-chip"
          class:active={selectedLang === l.lang}
          onclick={() => { selectedLang = l.lang; backToDashboard(); }}
        >
          {langTag(l.lang)} {langOption(l.lang).split(" ").slice(1).join(" ")}
          <span class="lang-level">{l.cefr_level}</span>
        </button>
      {/each}
    </div>
  </header>

  {#if level.kind === "dashboard"}
    {#if loading && !stats}
      <div class="empty">Loading…</div>
    {:else if stats}
      <section class="dashboard">
        <div class="tiles">
          <div class="tile">
            <span class="tile-label">Messages sent</span>
            <span class="tile-value">{stats.messages_sent}</span>
          </div>
          <div class="tile">
            <span class="tile-label">Vocabulary items</span>
            <span class="tile-value">{stats.vocab_total}</span>
            <span class="tile-sub">{stats.vocab_mastered} mastered · {stats.vocab_struggling} struggling</span>
          </div>
          <div class="tile">
            <span class="tile-label">Grammar concepts</span>
            <span class="tile-value">{stats.grammar_gap_total}</span>
            <span class="tile-sub">{stats.grammar_gap_active} active</span>
          </div>
          <div class="tile">
            <span class="tile-label">Total corrections</span>
            <span class="tile-value">{stats.corrections_count}</span>
          </div>
        </div>

        <div class="section">
          <h2>Vocabulary by CEFR level</h2>
          <div class="cefr-bars">
            {#each ["A1","A2","B1","B2","C1","C2"] as band}
              {@const count = stats.vocab_by_cefr?.[band] ?? 0}
              <div class="cefr-row">
                <span class="cefr-label">{band}</span>
                <div class="cefr-bar">
                  <div class="cefr-fill" style="width: {Math.min(100, count * 4)}%"></div>
                </div>
                <span class="cefr-count">{count}</span>
              </div>
            {/each}
            {#if stats.vocab_by_cefr?.unknown}
              <div class="cefr-row">
                <span class="cefr-label">?</span>
                <div class="cefr-bar">
                  <div class="cefr-fill muted" style="width: {Math.min(100, stats.vocab_by_cefr.unknown * 4)}%"></div>
                </div>
                <span class="cefr-count">{stats.vocab_by_cefr.unknown}</span>
              </div>
            {/if}
          </div>
        </div>

        <div class="section">
          <h2>Dimensions</h2>
          <p class="section-note">
            Click a dimension to see the specific items you've practiced.
            Band estimates arrive with Phase 1 of the pedagogy pipeline.
          </p>
          <div class="dimensions">
            {#each DIMENSIONS as d}
              {@const match = stats.dimensions?.find((x: any) => x.dimension === d.key)}
              {@const count = match?.evidence_count ?? 0}
              <button
                class="dim-card"
                class:empty={count === 0}
                onclick={() => openDimension(d.key)}
              >
                <span class="dim-name">{d.label}</span>
                <span class="dim-sub">{d.subtitle}</span>
                <span class="dim-stat">
                  {#if count > 0}
                    {count} item{count === 1 ? "" : "s"} tracked
                  {:else}
                    no data yet
                  {/if}
                </span>
              </button>
            {/each}
          </div>
        </div>

        <div class="section">
          <h2>Last 30 days</h2>
          <div class="spark">
            {#each stats.activity_30d as day}
              {@const h = Math.min(100, day.messages * 14)}
              <div class="spark-bar" style="height: {h}%" title="{day.date}: {day.messages}"></div>
            {/each}
          </div>
        </div>
      </section>
    {:else}
      <div class="empty">No data for this language yet. Start a conversation.</div>
    {/if}
  {:else if level.kind === "dimension"}
    <section class="drill">
      <nav class="breadcrumb">
        <button onclick={backToDashboard}>← Your progress</button>
        <span class="sep">/</span>
        <strong>{dimensionLabel(level.dimension)}</strong>
      </nav>

      {#if loading && !dimensionData}
        <div class="empty">Loading…</div>
      {:else if dimensionData && !dimensionData.ready}
        <div class="empty">
          This dimension isn't measured yet. It activates once the Phase&nbsp;1
          parsing pipeline ships.
        </div>
      {:else if dimensionData && dimensionData.items.length === 0}
        <div class="empty">Nothing tracked here yet.</div>
      {:else if dimensionData}
        <table class="items-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>CEFR</th>
              <th>Seen</th>
              <th>Used</th>
              <th>Accuracy</th>
              <th>Errors</th>
              <th>Reviews</th>
              <th>Next due</th>
            </tr>
          </thead>
          <tbody>
            {#each dimensionData.items as item}
              <tr onclick={() => openItem(item.item_type, item.item_id)}>
                <td>
                  <div class="item-label">{item.label}</div>
                  {#if item.sublabel}
                    <div class="item-sublabel">{item.sublabel}</div>
                  {/if}
                </td>
                <td>{item.cefr_level ?? "—"}</td>
                <td>{item.encounters}</td>
                <td>{item.productions}</td>
                <td>{accuracyPct(item)}</td>
                <td>{item.error_count || 0}</td>
                <td>{item.repetitions}</td>
                <td>{fmtDate(item.next_review_at)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  {:else if level.kind === "item"}
    <section class="item-detail">
      <nav class="breadcrumb">
        <button onclick={backToDashboard}>← Your progress</button>
        <span class="sep">/</span>
        <button onclick={backToDimension}>{dimensionLabel(dimensionData?.dimension ?? "")}</button>
        <span class="sep">/</span>
        <strong>{itemData?.item?.term ?? itemData?.item?.category ?? "Loading…"}</strong>
      </nav>

      {#if loading && !itemData}
        <div class="empty">Loading…</div>
      {:else if itemData}
        {@const it = itemData.item}
        <header class="item-hero">
          <h2>{it.term ?? it.category}</h2>
          {#if it.translation}
            <p class="translation">{it.translation}</p>
          {:else if it.description}
            <p class="description">{it.description}</p>
          {/if}
          {#if it.context_sentence}
            <p class="context">“{it.context_sentence}”</p>
          {/if}
        </header>

        <div class="stat-grid">
          <div><span>CEFR</span><strong>{it.cefr_level ?? "—"}</strong></div>
          <div><span>Seen</span><strong>{it.encounters ?? 0}</strong></div>
          <div><span>Produced</span><strong>{it.productions ?? 0}</strong></div>
          <div><span>Correct</span><strong>{it.correct_productions ?? 0}</strong></div>
          <div><span>Reviews</span><strong>{it.repetitions ?? 0}</strong></div>
          <div><span>Ease</span><strong>{(it.ease_factor ?? 2.5).toFixed(2)}</strong></div>
          <div><span>Interval</span><strong>{it.interval_days ?? 0}d</strong></div>
          <div><span>Next due</span><strong>{fmtDate(it.next_review_at)}</strong></div>
        </div>

        <div class="section">
          <h3>Recent messages</h3>
          {#if itemData.messages && itemData.messages.length > 0}
            <ul class="messages-list">
              {#each itemData.messages as m}
                <button class="msg-link" onclick={() => jumpToMessage(m.conversation_id)}>
                  <div class="msg-text">{m.healed_text}</div>
                  {#if m.raw_text && m.raw_text !== m.healed_text}
                    <div class="msg-raw">You wrote: {m.raw_text}</div>
                  {/if}
                  <div class="msg-date">{fmtDate(m.created_at)}</div>
                </button>
              {/each}
            </ul>
          {:else}
            <p class="empty-sub">No linked messages yet.</p>
          {/if}
        </div>

        <div class="section">
          <h3>Activity</h3>
          {#if itemData.events && itemData.events.length > 0}
            <ul class="events-list">
              {#each itemData.events as ev}
                <li>
                  <span class="ev-type">{ev.event_type}</span>
                  <span class="ev-outcome" class:correct={ev.outcome === "correct"} class:incorrect={ev.outcome === "incorrect"}>
                    {ev.outcome ?? "—"}
                  </span>
                  {#if ev.quality !== null && ev.quality !== undefined}
                    <span class="ev-quality">q={ev.quality}</span>
                  {/if}
                  <span class="ev-source">{ev.source}</span>
                  <span class="ev-date">{fmtDate(ev.observed_at)}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="empty-sub">No events recorded yet.</p>
          {/if}
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .profile {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem 2rem;
    background: var(--color-bg);
  }

  .profile-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .profile-header h1 {
    font-size: 1.5rem;
    margin: 0;
  }

  .lang-selector {
    display: flex;
    gap: 0.35rem;
  }

  .lang-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.7rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    font-size: 0.85rem;
    cursor: pointer;
  }

  .lang-chip.active {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
    color: var(--color-primary);
  }

  .lang-level {
    font-size: 0.7rem;
    color: var(--color-text-light);
    background: var(--color-bg);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }

  .lang-chip.active .lang-level {
    background: white;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .tile {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: 0.9rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .tile-label {
    font-size: 0.75rem;
    color: var(--color-text-light);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .tile-value {
    font-size: 1.6rem;
    font-weight: 600;
  }

  .tile-sub {
    font-size: 0.75rem;
    color: var(--color-text-light);
  }

  .section {
    margin-bottom: 1.75rem;
  }

  .section h2 {
    font-size: 1rem;
    margin-bottom: 0.5rem;
  }

  .section-note {
    font-size: 0.8rem;
    color: var(--color-text-light);
    margin-bottom: 0.75rem;
  }

  .cefr-bars {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .cefr-row {
    display: grid;
    grid-template-columns: 40px 1fr 40px;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
  }

  .cefr-label {
    font-weight: 600;
    color: var(--color-text-light);
  }

  .cefr-bar {
    height: 14px;
    background: var(--color-bg);
    border-radius: 7px;
    overflow: hidden;
  }

  .cefr-fill {
    height: 100%;
    background: var(--color-primary);
    border-radius: 7px;
    min-width: 4px;
  }

  .cefr-fill.muted {
    background: var(--color-text-light);
    opacity: 0.4;
  }

  .cefr-count {
    text-align: right;
    color: var(--color-text-light);
  }

  .dimensions {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 0.6rem;
  }

  .dim-card {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.8rem 0.9rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
  }

  .dim-card:hover { background: var(--color-bg); }
  .dim-card.empty { opacity: 0.6; }

  .dim-name { font-weight: 600; font-size: 0.9rem; }
  .dim-sub { font-size: 0.75rem; color: var(--color-text-light); }
  .dim-stat { font-size: 0.75rem; margin-top: 0.25rem; color: var(--color-primary); }
  .dim-card.empty .dim-stat { color: var(--color-text-light); }

  .spark {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 60px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: 0.5rem;
  }

  .spark-bar {
    flex: 1;
    background: var(--color-primary);
    border-radius: 2px;
    min-height: 1px;
    opacity: 0.85;
  }

  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    font-size: 0.85rem;
  }

  .breadcrumb button {
    background: none;
    border: none;
    color: var(--color-primary);
    cursor: pointer;
    padding: 0;
    font-size: inherit;
  }

  .breadcrumb .sep { color: var(--color-text-light); }

  .items-table {
    width: 100%;
    border-collapse: collapse;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .items-table th, .items-table td {
    text-align: left;
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
    border-bottom: 1px solid var(--color-border);
  }

  .items-table th {
    background: var(--color-bg);
    font-weight: 600;
    color: var(--color-text-light);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .items-table tbody tr {
    cursor: pointer;
  }

  .items-table tbody tr:hover {
    background: var(--color-bg);
  }

  .item-label { font-weight: 500; }
  .item-sublabel { font-size: 0.75rem; color: var(--color-text-light); }

  .item-hero {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: 1rem 1.25rem;
    margin-bottom: 1.25rem;
  }

  .item-hero h2 { margin: 0 0 0.25rem; font-size: 1.3rem; }
  .translation { color: var(--color-text-light); margin: 0; }
  .description { margin: 0; }
  .context { margin: 0.5rem 0 0; font-style: italic; color: var(--color-text-light); }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .stat-grid > div {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.7rem;
    display: flex;
    flex-direction: column;
  }

  .stat-grid span { font-size: 0.7rem; color: var(--color-text-light); text-transform: uppercase; }
  .stat-grid strong { font-size: 1rem; }

  .messages-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .msg-link {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    text-align: left;
    padding: 0.6rem 0.9rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .msg-link:hover { background: var(--color-bg); }

  .msg-text { font-size: 0.9rem; }
  .msg-raw { font-size: 0.75rem; color: var(--color-text-light); }
  .msg-date { font-size: 0.7rem; color: var(--color-text-light); margin-top: 0.15rem; }

  .events-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .events-list li {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.8rem;
    padding: 0.35rem 0.6rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
  }

  .ev-type {
    font-weight: 600;
    color: var(--color-primary);
    min-width: 80px;
  }

  .ev-outcome {
    font-size: 0.75rem;
    padding: 0.05rem 0.35rem;
    border-radius: 3px;
    background: var(--color-bg);
    color: var(--color-text-light);
  }

  .ev-outcome.correct { background: #d4f1d4; color: #256a2b; }
  .ev-outcome.incorrect { background: #fde2e2; color: #9a2b2b; }

  .ev-quality { font-family: var(--font-mono); color: var(--color-text-light); }
  .ev-source { color: var(--color-text-light); }
  .ev-date { margin-left: auto; color: var(--color-text-light); }

  .empty {
    padding: 3rem 1rem;
    text-align: center;
    color: var(--color-text-light);
  }

  .empty-sub {
    color: var(--color-text-light);
    font-size: 0.85rem;
    margin: 0;
  }
</style>
