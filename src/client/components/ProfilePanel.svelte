<script lang="ts">
  import { onMount } from "svelte";
  import { profile } from "../lib/stores.svelte";
  import { chatStore } from "../lib/chat.svelte";
  import { api } from "../lib/api";
  import { langOption, langTag, LANGUAGES } from "../lib/languages";
  import { isCurrent, playExclusive, stopCurrent } from "../lib/audio-player";
  import MessageBubble from "./MessageBubble.svelte";
  import DictionaryText from "./DictionaryText.svelte";

  type DashboardLevel = { kind: "dashboard" };
  type DimensionLevel = { kind: "dimension"; dimension: string };
  type ItemLevel = {
    kind: "item";
    dimension: string;
    itemType: "vocabulary" | "grammar";
    itemId: string;
  };
  type Level = DashboardLevel | DimensionLevel | ItemLevel;
  type ItemType = "vocabulary" | "grammar";

  const DIMENSIONS = [
    { key: "lexis",       label: "Lexis",       subtitle: "Vocabulary & collocations" },
    { key: "morphology",  label: "Morphology",  subtitle: "Word forms, conjugation, gender" },
    { key: "syntax",      label: "Syntax",      subtitle: "Word order, agreement, clauses" },
    { key: "orthography", label: "Orthography", subtitle: "Spelling, accents, punctuation" },
    { key: "phonology",   label: "Phonology",   subtitle: "Sounds & pronunciation" },
    { key: "pragmatics",  label: "Pragmatics",  subtitle: "Register, politeness" },
    { key: "discourse",   label: "Discourse",   subtitle: "Connectors, coherence" },
  ] as const;

  const DIMENSION_KEYS = new Set(DIMENSIONS.map((d) => d.key) as readonly string[]);
  const GRAMMAR_LABELS: Record<string, string> = {
    "u:syntax:agreement.subject-verb": "Subject-Verb Agreement",
    "u:syntax:determiner.definiteness": "Definite vs. Indefinite Articles",
    "u:syntax:word-order.adjective": "Adjective Position",
    "u:syntax:word-order.object": "Object Position",
    "u:syntax:word-order.question": "Question Word Order",
    "u:syntax:word-order.verb": "Verb Position",
    "u:syntax:adposition.selection": "Adposition Selection",
    "u:syntax:clause.relative": "Relative Clauses",
    "u:syntax:clause.subordination": "Subordinate Clauses",
    "u:syntax:relative-pronoun": "Relative Pronouns",
    "u:syntax:negation.placement": "Negation Placement",
    "fr:syntax:preposition.a-vs-de": "À vs. De",
    "articles:definite_vs_indefinite": "Definite vs. Indefinite Articles",
    "word_order:question_formation": "Question Word Order",
  };

  interface ProfileLanguage {
    lang: string;
    cefr_level: string | null;
    messages?: number;
    vocabulary?: number;
    grammar?: number;
  }

  interface ItemReference {
    term: string;
    language: string;
    source_term: string | null;
    source: "wiktionary" | null;
    source_url: string | null;
    part_of_speech: string | null;
    pronunciations: Array<{
      kind: "audio" | "ipa";
      label: string;
      value: string;
      source: string;
      url?: string;
    }>;
    conjugation_html: string | null;
    links: Array<{ label: string; url: string; source: string }>;
    notes: string[];
  }

  interface Props {
    /** Active route after #/profile. Owned by App's router. */
    route?: string;
    /** Notify the router when the active profile route changes. */
    onRouteChange?: (route: string) => void;
  }
  let { route = "", onRouteChange }: Props = $props();

  const profileLangs = $derived.by(() => {
    const profs = profile.value?.learning_languages ?? [];
    if (profs.length > 0) return profs;
    return [{ lang: "fr", cefr_level: "A1", assessed_at: "" }];
  });

  let selectedLang = $state<string>("");
  let availableLangs = $state<ProfileLanguage[]>([]);
  let level: Level = $state({ kind: "dashboard" });
  let stats: any = $state(null);
  let dimensionData: any = $state(null);
  let itemData: any = $state(null);
  let referenceData = $state<ItemReference | null>(null);
  let referenceLoading = $state(false);
  let referenceError = $state<string | null>(null);
  let itemAudioLoading = $state(false);
  let itemAudioPlaying = $state(false);
  let itemAudioError = $state<string | null>(null);
  let itemAudioElement = $state<HTMLAudioElement | null>(null);
  let itemAudioObjectUrl = $state<string | null>(null);
  let loading = $state(false);
  let pendingRoute = $state("");

  const languageOptions = $derived.by<ProfileLanguage[]>(() => {
    if (availableLangs.length > 0) return availableLangs;
    return profileLangs.map((l) => ({ lang: l.lang, cefr_level: l.cefr_level }));
  });

  onMount(async () => {
    try {
      availableLangs = (await api.getProfileLanguages()) as ProfileLanguage[];
    } catch (err) {
      console.error("profile languages load failed:", err);
      availableLangs = [];
    }
  });

  $effect(() => {
    if (pendingRoute && route === pendingRoute) pendingRoute = "";
    const effectiveRoute = pendingRoute || route;
    const parsed = parseProfileRoute(effectiveRoute);
    if (parsed.lang) {
      if (selectedLang !== parsed.lang) {
        selectedLang = parsed.lang;
        stats = null;
        dimensionData = null;
        itemData = null;
      }
    } else if (!selectedLang && languageOptions.length > 0) {
      selectedLang = languageOptions[0].lang;
      replaceRoute(
        parsed.dimension && DIMENSION_KEYS.has(parsed.dimension)
          ? { kind: "dimension", dimension: parsed.dimension }
          : { kind: "dashboard" },
        selectedLang,
      );
      return;
    } else if (selectedLang && effectiveRoute === "") {
      replaceRoute({ kind: "dashboard" }, selectedLang);
      return;
    }

    if (!selectedLang) return;

    if (
      parsed.dimension &&
      parsed.itemType &&
      parsed.itemId &&
      isItemType(parsed.itemType)
    ) {
      if (
        level.kind !== "item" ||
        level.dimension !== parsed.dimension ||
        level.itemType !== parsed.itemType ||
        level.itemId !== parsed.itemId
      ) {
        openItem(parsed.itemType, parsed.itemId, parsed.dimension, false);
      }
      return;
    }

    if (parsed.dimension && DIMENSION_KEYS.has(parsed.dimension)) {
      if (level.kind !== "dimension" || level.dimension !== parsed.dimension) {
        openDimension(parsed.dimension, false);
      }
      return;
    }

    if (level.kind !== "dashboard") {
      showDashboard(false);
    }
  });

  $effect(() => {
    return () => {
      if (itemAudioElement && isCurrent(itemAudioElement)) stopCurrent();
      if (itemAudioObjectUrl) URL.revokeObjectURL(itemAudioObjectUrl);
    };
  });

  $effect(() => {
    if (!selectedLang || level.kind !== "dashboard") return;
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

  async function openDimension(dimension: string, updateRoute = true) {
    level = { kind: "dimension", dimension };
    itemData = null;
    referenceData = null;
    if (updateRoute) replaceRoute(level);
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

  async function openItem(
    itemType: ItemType,
    itemId: string,
    dimension = level.kind === "dimension" ? level.dimension : "lexis",
    updateRoute = true,
  ) {
    level = { kind: "item", dimension, itemType, itemId };
    if (updateRoute) replaceRoute(level);
    referenceData = null;
    referenceError = null;
    referenceLoading = false;
    resetItemAudio();
    loading = true;
    try {
      itemData = await api.getProfileItem(itemType, itemId, selectedLang);
      const routeKey = itemType === "vocabulary"
        ? itemData?.route_key ?? itemData?.item?.route_key ?? vocabularyRouteKey(itemData?.item?.term)
        : itemId;
      if (routeKey && routeKey !== itemId) {
        level = { kind: "item", dimension, itemType, itemId: routeKey };
        replaceRoute(level, selectedLang, true);
      }
      if (itemType === "vocabulary") loadItemReference(itemType, routeKey || itemId);
    } catch (err) {
      console.error("item load failed:", err);
      itemData = null;
    } finally {
      loading = false;
    }
  }

  function showDashboard(updateRoute = true) {
    level = { kind: "dashboard" };
    dimensionData = null;
    itemData = null;
    referenceData = null;
    resetItemAudio();
    if (updateRoute) replaceRoute(level);
  }

  async function loadItemReference(itemType: ItemType, itemId: string) {
    referenceLoading = true;
    referenceError = null;
    const routeKey = `${itemType}:${itemId}`;
    try {
      const data = (await api.getProfileItemReference(itemType, itemId, selectedLang)) as ItemReference;
      if (level.kind !== "item" || `${level.itemType}:${level.itemId}` !== routeKey) return;
      referenceData = data;
    } catch (err) {
      if (level.kind !== "item" || `${level.itemType}:${level.itemId}` !== routeKey) return;
      console.error("reference load failed:", err);
      referenceError = err instanceof Error ? err.message : String(err);
      referenceData = null;
    } finally {
      if (level.kind === "item" && `${level.itemType}:${level.itemId}` === routeKey) {
        referenceLoading = false;
      }
    }
  }

  function backToDashboard() {
    showDashboard();
  }

  function backToDimension() {
    if (level.kind === "item") {
      // dimensionData is still populated from the prior step
      const d = level.dimension || dimensionData?.dimension || "lexis";
      itemData = null;
      openDimension(d);
    }
  }

  function jumpToMessage(conversationId: string) {
    const short = conversationId.slice(0, 8);
    chatStore.setActive(conversationId);
    location.hash = `#/c/${short}`;
  }

  function baseLangs(): string[] {
    return profile.value?.base_language ? [profile.value.base_language] : ["en"];
  }

  const itemAudioPronunciation = $derived(
    referenceData?.pronunciations?.find((p) => p.kind === "audio" && p.url),
  );
  const itemIpa = $derived(referenceData?.pronunciations?.find((p) => p.kind === "ipa"));

  async function playItemPronunciation() {
    if (level.kind !== "item" || !itemData?.item?.term) return;
    if (itemAudioElement && itemAudioPlaying && isCurrent(itemAudioElement)) {
      stopCurrent();
      return;
    }

    itemAudioLoading = true;
    itemAudioError = null;
    try {
      let url = itemAudioPronunciation?.url;
      if (!url) {
        if (itemAudioObjectUrl) {
          URL.revokeObjectURL(itemAudioObjectUrl);
          itemAudioObjectUrl = null;
        }
        url = await api.fetchProfileItemAudio(level.itemType, level.itemId, selectedLang);
        itemAudioObjectUrl = url;
      }
      const audio = new Audio(url);
      itemAudioElement = audio;
      await playExclusive(audio, () => {
        itemAudioPlaying = false;
      });
      itemAudioPlaying = true;
    } catch (err) {
      itemAudioError = err instanceof Error ? err.message : String(err);
      itemAudioPlaying = false;
    } finally {
      itemAudioLoading = false;
    }
  }

  function resetItemAudio() {
    if (itemAudioElement && isCurrent(itemAudioElement)) stopCurrent();
    if (itemAudioObjectUrl) URL.revokeObjectURL(itemAudioObjectUrl);
    itemAudioElement = null;
    itemAudioObjectUrl = null;
    itemAudioLoading = false;
    itemAudioPlaying = false;
    itemAudioError = null;
  }

  function fmtDate(iso: string | null | undefined): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function accuracyPct(item: any): string {
    if (!item.productions) return "—";
    return `${Math.round((item.correct_productions / item.productions) * 100)}%`;
  }

  function dataCount(lang: ProfileLanguage): number {
    return (lang.messages ?? 0) + (lang.vocabulary ?? 0) + (lang.grammar ?? 0);
  }

  function selectLanguage(lang: string) {
    selectedLang = lang;
    showDashboard(false);
    replaceRoute({ kind: "dashboard" }, lang);
  }

  function dimensionLabel(key: string): string {
    return DIMENSIONS.find((d) => d.key === key)?.label ?? key;
  }

  function itemLabel(item: any): string {
    if (!item) return "Loading…";
    if (item.term) return item.term;
    return grammarCategoryLabel(item.category ?? item.label ?? "");
  }

  function vocabularyRouteKey(term: unknown): string {
    return typeof term === "string" ? term.trim().replace(/\s+/gu, "_") : "";
  }

  function grammarCategoryLabel(category: string): string {
    if (GRAMMAR_LABELS[category]) return GRAMMAR_LABELS[category];
    const scoped = category.match(/^(u|[a-z]{2}):([a-z]+):(.+)$/u);
    if (scoped) return humanizeKey(scoped[3].replace(/[.:]/gu, " "));
    const [head, ...tail] = category.split(":");
    const topic = humanizeKey(head);
    const detail = humanizeKey(tail.join(":"));
    if (topic && detail) return `${topic}: ${detail}`;
    return topic || detail || category;
  }

  function humanizeKey(value: string): string {
    return value
      .split(/[_\s-]+/u)
      .filter(Boolean)
      .map((word) =>
        word.toLowerCase() === "vs" ? "vs." : word.charAt(0).toUpperCase() + word.slice(1),
      )
      .join(" ");
  }

  function learningEventCommentaries(message: any): string[] {
    if (!Array.isArray(message?.learning_events)) return [];
    return message.learning_events
      .map((event: any) => event?.commentary)
      .filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value: string) => value.trim());
  }

  function replaceRoute(nextLevel: Level, lang = selectedLang, replaceHistory = false) {
    if (!lang) return;
    const nextRoute = buildProfileRoute(lang, nextLevel);
    const nextHash = `#/profile/${nextRoute}`;
    const hashChanged = location.hash !== nextHash;
    if (hashChanged) {
      if (replaceHistory) {
        history.replaceState(null, "", nextHash);
      } else {
        history.pushState(null, "", nextHash);
      }
    }
    if (route !== nextRoute || pendingRoute !== nextRoute || hashChanged) {
      pendingRoute = nextRoute;
      onRouteChange?.(nextRoute);
    }
  }

  function parseProfileRoute(value: string): {
    lang: string;
    dimension: string;
    itemType: string;
    itemId: string;
  } {
    const parts = value.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts.length === 0) return { lang: "", dimension: "", itemType: "", itemId: "" };

    // Backward compatibility for old #/profile/<dimension> hashes.
    if (DIMENSION_KEYS.has(parts[0])) {
      return { lang: "", dimension: parts[0], itemType: parts[1] ?? "", itemId: parts[2] ?? "" };
    }

    return {
      lang: parts[0] ?? "",
      dimension: parts[1] ?? "",
      itemType: parts[2] ?? "",
      itemId: parts[3] ?? "",
    };
  }

  function buildProfileRoute(lang: string, nextLevel: Level): string {
    const parts = [lang];
    if (nextLevel.kind === "dimension") {
      parts.push(nextLevel.dimension);
    }
    if (nextLevel.kind === "item") {
      parts.push(nextLevel.dimension, nextLevel.itemType, nextLevel.itemId);
    }
    return parts.map(encodeURIComponent).join("/");
  }

  function isItemType(value: string): value is ItemType {
    return value === "vocabulary" || value === "grammar";
  }
</script>

<div class="profile">
  <header class="profile-header">
    <h1>Your progress</h1>
    <div class="lang-selector">
      {#each languageOptions as l (l.lang)}
        <button
          class="lang-chip"
          class:active={selectedLang === l.lang}
          onclick={() => selectLanguage(l.lang)}
        >
          {langTag(l.lang)} {langOption(l.lang).split(" ").slice(1).join(" ")}
          {#if l.cefr_level}
            <span class="lang-level">{l.cefr_level}</span>
          {/if}
          {#if dataCount(l) > 0}
            <span class="lang-data">{dataCount(l)}</span>
          {/if}
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
            <span class="tile-value">{stats.corrections_count + stats.vocab_self_corrected + stats.grammar_self_corrected}</span>
            <span class="tile-sub">{stats.vocab_self_corrected + stats.grammar_self_corrected} self-corrected</span>
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
              <th>Self-corrected</th>
              <th>Errors</th>
              <th>Reviews</th>
              <th>Next due</th>
            </tr>
          </thead>
          <tbody>
            {#each dimensionData.items as item}
              <tr onclick={() => openItem(item.item_type, item.route_key ?? item.item_id)}>
                <td>
                  <div class="item-label">
                    {#if item.item_type === "vocabulary"}
                      <DictionaryText text={itemLabel(item)} language={selectedLang} />
                    {:else}
                      {itemLabel(item)}
                    {/if}
                  </div>
                  {#if item.sublabel}
                    <div class="item-sublabel">{item.sublabel}</div>
                  {/if}
                </td>
                <td>{item.cefr_level ?? "—"}</td>
                <td>{item.encounters}</td>
                <td>{item.productions}</td>
                <td>{accuracyPct(item)}</td>
                <td>{item.self_corrected_productions || 0}</td>
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
        <strong>{itemLabel(itemData?.item)}</strong>
      </nav>

      {#if loading && !itemData}
        <div class="empty">Loading…</div>
      {:else if itemData}
        {@const it = itemData.item}
        <header class="item-hero">
          <div class="item-title-row">
            <h2>
              {#if it.term}
                <DictionaryText text={itemLabel(it)} language={it.language ?? selectedLang} />
              {:else}
                {itemLabel(it)}
              {/if}
            </h2>
            {#if it.term}
              <button
                class="pronunciation-btn"
                class:active={itemAudioPlaying}
                class:loading={itemAudioLoading}
                title={itemAudioError ?? (itemAudioPronunciation ? `Play Wiktionary audio: ${itemAudioPronunciation.label}` : "Play pronunciation")}
                aria-label="Play pronunciation"
                onclick={playItemPronunciation}
              >
                {itemAudioLoading ? "…" : itemAudioPlaying ? "⏸" : "🔊"}
              </button>
            {/if}
          </div>
          {#if it.translation}
            <p class="translation">{it.translation}</p>
          {:else if it.description}
            <p class="description">{it.description}</p>
          {/if}
          {#if referenceData?.part_of_speech}
            <p class="part-of-speech">{referenceData.part_of_speech}</p>
          {/if}
          {#if itemIpa}
            <p class="ipa">IPA {itemIpa.value}</p>
          {/if}
          {#if it.context_sentence}
            <p class="context">
              “<DictionaryText text={it.context_sentence} language={it.language ?? selectedLang} />”
            </p>
            {#if itemData.context_translation}
              <p class="context-translation">{itemData.context_translation}</p>
            {/if}
          {/if}
        </header>

        <div class="stat-grid">
          <div><span>CEFR</span><strong>{it.cefr_level ?? "—"}</strong></div>
          <div><span>Seen</span><strong>{it.encounters ?? 0}</strong></div>
          <div><span>Produced</span><strong>{it.productions ?? 0}</strong></div>
          <div><span>Correct</span><strong>{it.correct_productions ?? 0}</strong></div>
          <div><span>Self-corrected</span><strong>{it.self_corrected_productions ?? 0}</strong></div>
          <div><span>Reviews</span><strong>{it.repetitions ?? 0}</strong></div>
          <div><span>Difficulty</span><strong>{(it.ease_factor ?? 0).toFixed(2)}</strong></div>
          <div><span>Interval</span><strong>{it.interval_days ?? 0}d</strong></div>
          <div><span>Next due</span><strong>{fmtDate(it.next_review_at)}</strong></div>
        </div>

        {#if level.itemType === "vocabulary"}
          <div class="section reference-section">
            <h3>Reference</h3>
            {#if referenceLoading}
              <p class="empty-sub">Loading reference data…</p>
            {:else if referenceData}
              {#if referenceData.conjugation_html}
                <div class="reference-head">
                  <div>
                    <strong>Conjugation table</strong>
                    <span>
                      from {referenceData.source === "wiktionary" ? "Wiktionary" : "external sources"}
                      {#if referenceData.source_term && referenceData.source_term !== referenceData.term}
                        · lemma: {referenceData.source_term}
                      {/if}
                    </span>
                  </div>
                  {#if referenceData.source_url}
                    <a href={referenceData.source_url} target="_blank" rel="noreferrer">Open source</a>
                  {/if}
                </div>
                <div class="reference-html mw-parser-output">
                  {@html referenceData.conjugation_html}
                </div>
              {:else}
                <p class="empty-sub">{referenceData.notes?.[0] ?? "No conjugation table found yet."}</p>
              {/if}

              {#if referenceData.links?.length}
                <div class="reference-links">
                  {#each referenceData.links as link}
                    <a href={link.url} target="_blank" rel="noreferrer">
                      {link.label}
                      <span>{link.source}</span>
                    </a>
                  {/each}
                </div>
              {/if}
            {:else if referenceError}
              <p class="empty-sub">Reference lookup failed: {referenceError}</p>
            {:else}
              <p class="empty-sub">No reference data yet.</p>
            {/if}
          </div>
        {/if}

        <div class="section">
          <h3>Recent messages</h3>
          {#if itemData.messages && itemData.messages.length > 0}
            <div class="profile-message-list">
              {#each itemData.messages as m}
                <div class="profile-message-row" class:sent-row={!m.is_agent} class:received-row={m.is_agent}>
                  <MessageBubble
                    message={m}
                    sent={!m.is_agent}
                    senderName={m.is_agent ? "🤖 Agent" : null}
                    viewerLangs={[it.language ?? selectedLang]}
                    baseLangs={baseLangs()}
                    challenge={m.next_challenge ?? null}
                    conversationId={m.conversation_id}
                  />
                  {#each learningEventCommentaries(m) as commentary}
                    <div class="learning-event-note">
                      {commentary}
                    </div>
                  {/each}
                  <button class="open-chat-btn" onclick={() => jumpToMessage(m.conversation_id)}>
                    Open in chat
                  </button>
                </div>
              {/each}
            </div>
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
                  <span
                    class="ev-outcome"
                    class:correct={ev.outcome === "correct"}
                    class:partial={ev.outcome === "partial"}
                    class:incorrect={ev.outcome === "incorrect"}
                  >
                    {ev.source === "chat_self_correct" ? "self-corrected fail" : (ev.outcome ?? "—")}
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

  .lang-data {
    font-size: 0.7rem;
    color: var(--color-text-light);
    background: var(--color-bg);
    padding: 0.05rem 0.3rem;
    border-radius: 999px;
  }

  .lang-chip.active .lang-data {
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

  .item-title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  .item-hero h2 { margin: 0; font-size: 1.3rem; }

  .pronunciation-btn {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-bg);
    cursor: pointer;
    width: 2rem;
    height: 2rem;
    display: inline-grid;
    place-items: center;
    font-size: 0.9rem;
  }

  .pronunciation-btn:hover,
  .pronunciation-btn.active {
    background: var(--color-primary);
    color: white;
    border-color: var(--color-primary);
  }

  .pronunciation-btn.loading {
    opacity: 0.75;
    cursor: wait;
  }

  .translation { color: var(--color-text-light); margin: 0; }
  .description { margin: 0; }
  .part-of-speech {
    display: inline-flex;
    width: fit-content;
    margin: 0.45rem 0 0;
    padding: 0.18rem 0.45rem;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-bg);
    color: var(--color-text-light);
    font-size: 0.78rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.035em;
  }
  .ipa { margin: 0.25rem 0 0; font-size: 0.82rem; color: var(--color-text-light); }
  .context { margin: 0.5rem 0 0; font-style: italic; color: var(--color-text-light); }
  .context-translation { margin: 0.2rem 0 0; color: var(--color-text); font-size: 0.9rem; }

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

  .reference-section {
    margin-bottom: 1rem;
  }

  .reference-head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
    margin-bottom: 0.6rem;
  }

  .reference-head > div {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .reference-head span {
    color: var(--color-text-light);
    font-size: 0.8rem;
  }

  .reference-head a,
  .reference-links a {
    color: var(--color-primary);
    text-decoration: none;
  }

  .reference-html {
    width: 100%;
    max-height: 680px;
    overflow: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: white;
    padding: 0.75rem;
    font-size: 0.85rem;
    line-height: 1.4;
  }

  :global(.reference-html h4) {
    margin: 0 0 0.65rem;
    font-size: 1rem;
  }

  :global(.reference-html table) {
    border-collapse: collapse;
    margin: 0.5rem 0 1rem;
    background: white;
    width: max-content;
    max-width: none;
  }

  :global(.reference-html table.vsSwitcher),
  :global(.reference-html table.inflection-table) {
    display: table !important;
  }

  :global(.reference-html th),
  :global(.reference-html td) {
    border: 1px solid var(--color-border);
    padding: 0.25rem 0.45rem;
    vertical-align: top;
  }

  :global(.reference-html th) {
    background: var(--color-bg);
    font-weight: 650;
  }

  :global(.reference-html a) {
    color: var(--color-primary);
    text-decoration: none;
  }

  :global(.reference-html .mw-editsection),
  :global(.reference-html .NavToggle) {
    display: none !important;
  }

  :global(.reference-html .inflection-table-wrapper) {
    display: block !important;
    max-width: 100% !important;
    overflow-x: auto !important;
    max-height: none !important;
  }

  :global(.reference-html .inflection-table-collapsed),
  :global(.reference-html .NavFrame),
  :global(.reference-html .NavContent) {
    display: block !important;
    max-height: none !important;
    overflow: visible !important;
  }

  .reference-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .reference-links a {
    display: inline-flex;
    gap: 0.35rem;
    align-items: center;
    padding: 0.35rem 0.55rem;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-bg);
    font-size: 0.82rem;
  }

  .reference-links span {
    color: var(--color-text-light);
    font-size: 0.72rem;
  }

  .profile-message-list {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  .profile-message-row {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    width: min(100%, 720px);
  }

  .sent-row {
    align-self: flex-end;
    align-items: flex-end;
  }

  .received-row {
    align-self: flex-start;
    align-items: flex-start;
  }

  .open-chat-btn {
    border: 0;
    background: transparent;
    color: var(--color-text-light);
    cursor: pointer;
    font-size: 0.72rem;
    padding: 0 0.2rem;
  }

  .open-chat-btn:hover {
    color: var(--color-primary);
    text-decoration: underline;
  }

  .learning-event-note {
    max-width: min(100%, 720px);
    padding: 0.45rem 0.65rem;
    border-left: 3px solid var(--color-primary);
    border-radius: var(--radius-sm);
    background: var(--color-correction);
    color: var(--color-text);
    font-size: 0.8rem;
    line-height: 1.35;
  }

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
  .ev-outcome.partial { background: #fff0c2; color: #7a5200; }
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
