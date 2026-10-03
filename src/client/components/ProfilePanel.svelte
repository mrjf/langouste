<script lang="ts">
  import { onMount } from "svelte";
  import { profile } from "../lib/stores.svelte";
  import { chatStore } from "../lib/chat.svelte";
  import { api } from "../lib/api";
  import { langTag, LANGUAGES } from "../lib/languages";
  import { isCurrent, playExclusive, stopCurrent } from "../lib/audio-player";
  import type { WorkbenchTextPayload } from "../lib/workbench";
  import { ipaLayerPreference } from "../lib/display-settings.svelte";
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
    reading_interactions?: number;
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

  interface ExampleParts {
    source: string;
    separator: string | null;
    translation: string | null;
  }

  interface Props {
    /** Active route after #/profile. Owned by App's router. */
    route?: string;
    /** Notify the router when the active profile route changes. */
    onRouteChange?: (route: string) => void;
    /** Open arbitrary text in the Filo workbench. */
    onWorkbenchText?: (payload: WorkbenchTextPayload) => void;
  }
  let { route = "", onRouteChange, onWorkbenchText }: Props = $props();

  const profileLangs = $derived.by(() => {
    const profs = profile.value?.learning_languages ?? [];
    if (profs.length > 0) return profs;
    return [{ lang: "fr", cefr_level: "A1", assessed_at: "" }];
  });

  let selectedLang = $state<string>("");
  let availableLangs = $state<ProfileLanguage[]>([]);
  let level: Level = $state({ kind: "dashboard" });
  let stats: any = $state(null);
  let readingInteractions: any[] = $state([]);
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
        readingInteractions = [];
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
      const [nextStats, readingResponse] = await Promise.all([
        api.getLanguageStats(lang),
        api.getReadingInteractions(lang, 12).catch((err) => {
          console.error("reading interactions load failed:", err);
          return { items: [] };
        }),
      ]);
      stats = nextStats;
      readingInteractions = readingResponse.items;
    } catch (err) {
      console.error("stats load failed:", err);
      stats = null;
      readingInteractions = [];
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

  function workbenchTargetFor(sourceLanguage: string): string {
    const baseLanguage = profile.value?.base_language ?? "en";
    if (baseLanguage !== sourceLanguage) return baseLanguage;
    return "en";
  }

  function openWorkbench(value: string | null | undefined, sourceLanguage: string, title: string) {
    const cleanText = value?.trim() ?? "";
    const cleanSourceLanguage = sourceLanguage || selectedLang;
    if (!onWorkbenchText || !cleanText || !cleanSourceLanguage) return;
    onWorkbenchText({
      text: cleanText,
      sourceLanguage: cleanSourceLanguage,
      targetLanguage: workbenchTargetFor(cleanSourceLanguage),
      title,
      autoAnalyze: true,
    });
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
    if (typeof item.accuracy_score === "number") {
      return `${Math.round(item.accuracy_score * 100)}%`;
    }
    const productions = item.productions ?? 0;
    if (!productions) return "—";
    return `${Math.round(((item.correct_productions ?? 0) / productions) * 100)}%`;
  }

  function scoredProgressLabel(item: any): string {
    const attempts = item?.scored_attempts ?? 0;
    if (!attempts) return "—";
    return `${item.scored_correct ?? 0}/${item.scored_partial ?? 0}/${item.scored_incorrect ?? 0}`;
  }

  function masteryLabel(item: any): string {
    if (typeof item.accuracy_score !== "number") return "—";
    const score = item.accuracy_score;
    const repetitions = item.repetitions ?? 0;
    if (score >= 0.9 && repetitions >= 3) return "strong";
    if (score >= 0.75) return "learning";
    if (score >= 0.5) return "mixed";
    return "needs work";
  }

  function exerciseProgressLabel(item: any): string {
    const attempts = item?.exercise_attempts ?? 0;
    if (!attempts) return "—";
    return `${item.exercise_correct ?? 0}/${item.exercise_partial ?? 0}/${item.exercise_incorrect ?? 0}`;
  }

  function dataCount(lang: ProfileLanguage): number {
    return (lang.messages ?? 0) + (lang.vocabulary ?? 0) + (lang.grammar ?? 0)
      + (lang.reading_interactions ?? 0);
  }

  function readingEventLabel(value: string): string {
    return value.replaceAll("_", " ");
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
    if (item.item_type === "vocabulary" && typeof item.label === "string") return item.label;
    return grammarCategoryLabel(item.category ?? item.label ?? "");
  }

  function itemDisplayLabel(data: any): string {
    const lemma = itemLemma(data);
    if (lemma) return lemma;
    return itemLabel(data?.item);
  }

  function itemLemma(data: any): string | null {
    const lemma = data?.dictionary?.lemma;
    return typeof lemma === "string" && lemma.trim().length > 0 ? lemma.trim() : null;
  }

  function itemObservedForm(data: any): string | null {
    const term = data?.item?.term;
    const lemma = itemLemma(data);
    if (typeof term !== "string" || !term.trim() || !lemma) return null;
    return term.toLocaleLowerCase(data?.item?.language ?? selectedLang) ===
      lemma.toLocaleLowerCase(data?.item?.language ?? selectedLang)
      ? null
      : term.trim();
  }

  function dictionaryRouteHref(data: any): string {
    const dictionary = data?.dictionary;
    const language =
      typeof dictionary?.language === "string" && dictionary.language.trim()
        ? dictionary.language.trim()
        : selectedLang;
    const term =
      typeof dictionary?.term === "string" && dictionary.term.trim()
        ? dictionary.term.trim()
        : itemLabel(data?.item);
    return `#/dictionary/${encodeURIComponent(language)}/${encodeURIComponent(term)}`;
  }

  function splitExample(value: string): ExampleParts {
    const separatorMatch = /\s+([―–—])\s+/u.exec(value);
    if (!separatorMatch || separatorMatch.index <= 0) {
      return { source: value, separator: null, translation: null };
    }

    const translationStart = separatorMatch.index + separatorMatch[0].length;
    const source = value.slice(0, separatorMatch.index).trim();
    const translation = value.slice(translationStart).trim();
    if (!source || !translation) return { source: value, separator: null, translation: null };
    return { source, separator: separatorMatch[1] ?? "―", translation };
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
          <span class="lang-code">{langTag(l.lang)}</span>
          <span class="lang-name">{LANGUAGES[l.lang]?.name ?? l.lang.toUpperCase()}</span>
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
            <span class="tile-label">Article interactions</span>
            <span class="tile-value">{stats.reading_interactions ?? 0}</span>
            <span class="tile-sub">from News and other reading surfaces</span>
          </div>
          <div class="tile">
            <span class="tile-label">Vocabulary items</span>
            <span class="tile-value">{stats.vocab_total}</span>
            <span class="tile-sub">{stats.vocab_mastered} mastered · {stats.vocab_heard ?? 0} heard · {stats.vocab_spoken ?? 0} spoken</span>
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

        {#if readingInteractions.length > 0}
          <div class="section">
            <h2>Recent article text</h2>
            <p class="section-note">
              Text you inspected, hovered, heard, or opened from connected reading surfaces.
            </p>
            <div class="reading-events">
              {#each readingInteractions as interaction (interaction.interaction_id)}
                <article class="reading-event">
                  <div>
                    <span>{readingEventLabel(interaction.event_type)}</span>
                    <time datetime={interaction.observed_at}>{fmtDate(interaction.observed_at)}</time>
                  </div>
                  <h3>{interaction.title}</h3>
                  <p>{interaction.text}</p>
                  <div class="reading-actions">
                    {#if onWorkbenchText}
                      <button
                        type="button"
                        onclick={() => openWorkbench(
                          interaction.text,
                          interaction.language ?? selectedLang,
                          `${interaction.title} — News reading`,
                        )}
                      >Open in Workbench</button>
                    {/if}
                    {#if interaction.source_url}
                      <a href={interaction.source_url} target="_blank" rel="noreferrer">Original ↗</a>
                    {/if}
                  </div>
                </article>
              {/each}
            </div>
          </div>
        {/if}

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
        <span class="crumb-lang">{langTag(selectedLang)} {LANGUAGES[selectedLang]?.name ?? selectedLang}</span>
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
              <th>Heard</th>
              <th>Used</th>
              <th>Spoken</th>
              <th>Accuracy</th>
              <th>Mastery</th>
              <th>Scored C/P/W</th>
              <th>Exercises C/P/W</th>
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
                <td>{item.heard ?? 0}</td>
                <td>{item.productions}</td>
                <td>{item.spoken ?? 0}</td>
                <td>{accuracyPct(item)}</td>
                <td>{masteryLabel(item)}</td>
                <td>{scoredProgressLabel(item)}</td>
                <td>{exerciseProgressLabel(item)}</td>
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
        <span class="crumb-lang">{langTag(selectedLang)} {LANGUAGES[selectedLang]?.name ?? selectedLang}</span>
        <span class="sep">/</span>
        <button onclick={backToDimension}>{dimensionLabel(level.dimension)}</button>
        <span class="sep">/</span>
        <strong>{itemDisplayLabel(itemData)}</strong>
      </nav>

      {#if loading && !itemData}
        <div class="empty">Loading…</div>
      {:else if itemData}
        {@const it = itemData.item}
        {@const displayLabel = itemDisplayLabel(itemData)}
        {@const observedForm = itemObservedForm(itemData)}
        {@const dictionary = itemData.dictionary}
        <header class="item-hero">
          <div class="item-title-row">
            <h2>
              {#if it.term}
                <DictionaryText text={displayLabel} language={it.language ?? selectedLang} />
              {:else}
                {displayLabel}
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
                {itemAudioLoading ? "…" : itemAudioPlaying ? "⏸" : "▶"}
              </button>
            {/if}
            {#if level.itemType === "vocabulary" && onWorkbenchText && displayLabel}
              <button
                class="workbench-link hero-workbench"
                title="Analyze this word in the Filo workbench"
                onclick={() => openWorkbench(displayLabel, it.language ?? selectedLang, `Vocabulary: ${displayLabel}`)}
              >
                workbench
              </button>
            {/if}
          </div>
          {#if observedForm}
            <p class="observed-form">
              form: <DictionaryText text={observedForm} language={it.language ?? selectedLang} />
              {#if itemData.dictionary?.form_description}
                <span>· {itemData.dictionary.form_description}</span>
              {/if}
            </p>
          {/if}
          {#if dictionary?.source_term && dictionary.source_term !== displayLabel}
            <p class="headword-meta">
              Wiktionary headword:
              <DictionaryText text={dictionary.source_term} language={it.language ?? selectedLang} />
            </p>
          {/if}
          {#if it.description && !it.translation}
            <p class="description">{it.description}</p>
          {/if}
          {#if dictionary?.senses?.length}
            <div class="headword-definition">
              {#each dictionary.senses as sense}
                <section class="headword-sense">
                  <span class="part-of-speech">{sense.part_of_speech}</span>
                  <p>{sense.definition}</p>
                  {#each sense.examples as example}
                    {@const exampleParts = splitExample(example)}
                    <div class="example-line">
                      <blockquote>
                        <DictionaryText text={exampleParts.source} language={it.language ?? selectedLang} />
                        {#if exampleParts.translation}
                          <span class="example-separator">{exampleParts.separator}</span>
                          <DictionaryText text={exampleParts.translation} language={profile.value?.base_language ?? "en"} />
                        {/if}
                      </blockquote>
                      {#if onWorkbenchText}
                        <button
                          class="workbench-link"
                          title="Analyze this example in the Filo workbench"
                          onclick={() => openWorkbench(exampleParts.source, it.language ?? selectedLang, `Example: ${displayLabel}`)}
                        >
                          workbench
                        </button>
                      {/if}
                    </div>
                  {/each}
                </section>
              {/each}
            </div>
          {:else if dictionary?.definitions?.length}
            <ol class="headword-definitions">
              {#each dictionary.definitions as definition}
                <li>{definition}</li>
              {/each}
            </ol>
          {:else if referenceData?.part_of_speech}
            <p class="part-of-speech">{referenceData.part_of_speech}</p>
          {/if}
          {#if it.translation}
            <p class="saved-translation">saved translation: {it.translation}</p>
          {/if}
          {#if itemData.has_profile_data === false}
            <p class="headword-meta">
              No profile data recorded for this word yet. Counts below start at zero.
            </p>
          {/if}
          {#if itemIpa && ipaLayerPreference.enabled}
            <p class="ipa">IPA {itemIpa.value}</p>
          {/if}
          {#if level.itemType === "vocabulary" && dictionary}
            <div class="headword-links">
              <a href={dictionaryRouteHref(itemData)}>Dictionary page</a>
              {#if dictionary.source_url}
                <a href={dictionary.source_url} target="_blank" rel="noreferrer">Definitions</a>
              {/if}
              {#if dictionary.target_source_url}
                <a href={dictionary.target_source_url} target="_blank" rel="noreferrer">Target Wiktionary</a>
              {/if}
            </div>
          {/if}
          {#if it.context_sentence}
            <div class="context-row">
              <p class="context">
                “<DictionaryText text={it.context_sentence} language={it.language ?? selectedLang} />”
              </p>
              {#if onWorkbenchText}
                <button
                  class="workbench-link"
                  title="Analyze this context sentence in the Filo workbench"
                  onclick={() => openWorkbench(it.context_sentence, it.language ?? selectedLang, `Context: ${displayLabel}`)}
                >
                  workbench
                </button>
              {/if}
            </div>
            {#if itemData.context_translation}
              <p class="context-translation">{itemData.context_translation}</p>
            {/if}
          {/if}
        </header>

        <div class="stat-grid">
          <div><span>CEFR</span><strong>{it.cefr_level ?? "—"}</strong></div>
          <div><span>Seen</span><strong>{it.encounters ?? 0}</strong></div>
          <div><span>Heard</span><strong>{it.heard ?? 0}</strong></div>
          <div><span>Produced</span><strong>{it.productions ?? 0}</strong></div>
          <div><span>Spoken</span><strong>{it.spoken ?? 0}</strong></div>
          <div><span>Accuracy</span><strong>{accuracyPct(it)}</strong></div>
          <div><span>Mastery</span><strong>{masteryLabel(it)}</strong></div>
          <div><span>Scored C/P/W</span><strong>{scoredProgressLabel(it)}</strong></div>
          <div><span>Correct</span><strong>{it.correct_productions ?? 0}</strong></div>
          <div><span>Exercise C/P/W</span><strong>{exerciseProgressLabel(it)}</strong></div>
          <div><span>Exercise score</span><strong>{it.exercise_score == null ? "—" : `${Math.round((it.exercise_score ?? 0) * 100)}%`}</strong></div>
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
                    {onWorkbenchText}
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
    padding: var(--space-6) var(--space-8);
    background: var(--color-panel);
  }

  .profile-header {
    display: grid;
    grid-template-columns: minmax(8rem, 12rem) minmax(0, 1fr);
    align-items: start;
    gap: var(--space-6);
    margin-bottom: var(--space-6);
  }

  .profile-header h1 {
    font-size: var(--text-xl);
    font-weight: var(--font-medium);
    line-height: 1.1;
    margin: 0;
  }

  .lang-selector {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
    gap: var(--space-2);
  }

  .lang-chip {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--space-2);
    min-height: 3.5rem;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }

  .lang-chip.active {
    border-color: var(--color-accent);
    background: var(--color-surface);
    color: var(--color-accent);
    box-shadow: inset 0 -3px 0 var(--color-accent);
  }

  .lang-code {
    white-space: nowrap;
  }

  .lang-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lang-level {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    color: var(--color-text-muted);
    background: transparent;
    padding: 0;
  }

  .lang-chip.active .lang-level {
    color: var(--color-accent);
  }

  .lang-data {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    color: var(--color-text-muted);
    background: transparent;
    padding: 0;
  }

  .lang-chip.active .lang-data {
    color: var(--color-accent);
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: var(--space-3);
    margin-bottom: var(--space-6);
  }

  .tile {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .tile-label {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .tile-value {
    font-size: var(--text-xl);
    font-weight: var(--font-medium);
  }

  .tile-sub {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .section {
    margin-bottom: var(--space-8);
  }

  .section h2 {
    font-size: var(--text-md);
    font-weight: var(--font-medium);
    margin-bottom: var(--space-2);
  }

  .section-note {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    margin-bottom: var(--space-3);
  }

  .reading-events {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    gap: var(--space-3);
  }

  .reading-event {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
  }

  .reading-event > div:first-child,
  .reading-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .reading-event > div:first-child,
  .reading-event time {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    text-transform: uppercase;
  }

  .reading-event h3,
  .reading-event p {
    margin: 0;
  }

  .reading-event h3 {
    font-size: var(--text-sm);
  }

  .reading-event p {
    color: var(--color-text);
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .reading-actions {
    justify-content: flex-start;
  }

  .reading-actions button,
  .reading-actions a {
    border: 0;
    background: transparent;
    color: var(--color-accent);
    font-size: var(--text-xs);
    text-decoration: none;
    cursor: pointer;
  }

  .cefr-bars {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-3) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .cefr-row {
    display: grid;
    grid-template-columns: 40px 1fr 40px;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-sm);
  }

  .cefr-label {
    font-family: var(--font-mono);
    font-weight: var(--font-medium);
    color: var(--color-text-muted);
  }

  .cefr-bar {
    height: 0.7rem;
    background: var(--color-bg);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .cefr-fill {
    height: 100%;
    background: var(--color-accent);
    border-radius: var(--radius-sm);
    min-width: 4px;
  }

  .cefr-fill.muted {
    background: var(--color-text-muted);
    opacity: 0.4;
  }

  .cefr-count {
    text-align: right;
    color: var(--color-text-muted);
  }

  .dimensions {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: var(--space-3);
  }

  .dim-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 6.5rem;
    padding: var(--space-4);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
  }

  .dim-card:hover { background: var(--color-panel); border-color: var(--color-border-strong); }
  .dim-card.empty { opacity: 0.6; }

  .dim-name { font-weight: var(--font-medium); font-size: var(--text-sm); }
  .dim-sub { font-size: var(--text-xs); color: var(--color-text-muted); }
  .dim-stat { font-size: var(--text-xs); margin-top: var(--space-1); color: var(--color-accent); }
  .dim-card.empty .dim-stat { color: var(--color-text-muted); }

  .spark {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 60px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
  }

  .spark-bar {
    flex: 1;
    background: var(--color-accent);
    border-radius: 2px;
    min-height: 1px;
    opacity: 0.85;
  }

  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    font-size: var(--text-sm);
  }

  .breadcrumb button {
    background: none;
    border: none;
    color: var(--color-accent);
    cursor: pointer;
    padding: 0;
    font-size: inherit;
  }

  .breadcrumb .sep,
  .breadcrumb .crumb-lang {
    color: var(--color-text-muted);
  }

  .items-table {
    width: 100%;
    border-collapse: collapse;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .items-table th, .items-table td {
    text-align: left;
    padding: var(--space-3);
    font-size: var(--text-sm);
    border-bottom: 1px solid var(--color-border);
  }

  .items-table th {
    background: var(--color-bg);
    font-family: var(--font-mono);
    font-weight: var(--font-medium);
    color: var(--color-text-muted);
    font-size: var(--text-caption);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .items-table tbody tr {
    cursor: pointer;
  }

  .items-table tbody tr:hover {
    background: var(--color-bg);
  }

  .item-label { font-weight: var(--font-medium); }
  .item-sublabel { font-size: var(--text-xs); color: var(--color-text-muted); }

  .item-hero {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-5);
    margin-bottom: var(--space-5);
  }

  .item-title-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-1);
  }

  .item-hero h2 { margin: 0; font-size: var(--text-lg); font-weight: var(--font-medium); }

  .pronunciation-btn {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
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
    background: var(--color-accent);
    color: var(--color-accent-contrast);
    border-color: var(--color-accent);
  }

  .pronunciation-btn.loading {
    opacity: 0.75;
    cursor: wait;
  }

  .workbench-link {
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    line-height: 1;
    padding: 0.12rem var(--space-2);
  }

  .workbench-link:hover {
    background: var(--color-bg);
    border-color: var(--color-border);
    color: var(--color-accent);
  }

  .hero-workbench {
    margin-left: var(--space-1);
  }

  .description { margin: 0; }
  .observed-form {
    margin: 0 0 var(--space-2);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
  }
  .headword-meta,
  .saved-translation {
    margin: 0 0 var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .headword-definition {
    display: grid;
    gap: var(--space-3);
    margin: var(--space-3) 0;
  }

  .headword-sense {
    display: grid;
    gap: var(--space-2);
  }

  .headword-sense p {
    margin: 0;
    font-size: var(--text-md);
  }

  .headword-sense blockquote {
    margin: 0;
    border-left: 2px solid var(--color-border);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    padding-left: var(--space-3);
  }

  .example-line {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
  }

  .example-line blockquote {
    flex: 1;
    min-width: 0;
  }

  .example-separator {
    display: inline-block;
    margin: 0 var(--space-2);
  }

  .headword-definitions {
    margin: var(--space-3) 0;
    padding-left: var(--space-5);
  }

  .headword-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }

  .headword-links a {
    color: var(--color-accent);
    font-size: var(--text-sm);
    text-decoration: none;
  }

  .part-of-speech {
    display: inline-flex;
    width: fit-content;
    margin: var(--space-2) 0 0;
    padding: 0.18rem var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--font-medium);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .ipa { margin: var(--space-1) 0 0; font-size: var(--text-xs); color: var(--color-text-muted); }
  .context-row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  .context { flex: 1; min-width: 0; margin: 0; font-style: italic; color: var(--color-text-muted); }
  .context-translation { margin: var(--space-1) 0 0; color: var(--color-text); font-size: var(--text-sm); }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: var(--space-2);
    margin-bottom: var(--space-6);
  }

  .stat-grid > div {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
  }

  .stat-grid span {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    color: var(--color-text-muted);
    text-transform: uppercase;
  }
  .stat-grid strong { font-size: var(--text-md); font-weight: var(--font-medium); }

  .reference-section {
    margin-bottom: 1rem;
  }

  .reference-head {
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    align-items: flex-start;
    margin-bottom: var(--space-3);
  }

  .reference-head > div {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .reference-head span {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .reference-head a,
  .reference-links a {
    color: var(--color-accent);
    text-decoration: none;
  }

  .reference-html {
    width: 100%;
    max-height: 680px;
    overflow: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    padding: var(--space-3);
    font-size: var(--text-sm);
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
    font-weight: var(--font-medium);
  }

  :global(.reference-html a) {
    color: var(--color-accent);
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
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .reference-links a {
    display: inline-flex;
    gap: var(--space-1);
    align-items: center;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    font-size: var(--text-sm);
  }

  .reference-links span {
    color: var(--color-text-muted);
    font-size: var(--text-caption);
  }

  .profile-message-list {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .profile-message-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
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
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 0.72rem;
    padding: 0 0.2rem;
  }

  .open-chat-btn:hover {
    color: var(--color-accent);
    text-decoration: underline;
  }

  .learning-event-note {
    max-width: min(100%, 720px);
    padding: var(--space-2) var(--space-3);
    border-left: 3px solid var(--color-accent);
    border-radius: var(--radius-sm);
    background: var(--color-correction);
    color: var(--color-text);
    font-size: var(--text-sm);
    line-height: 1.35;
  }

  .events-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .events-list li {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
  }

  .ev-type {
    font-weight: var(--font-medium);
    color: var(--color-accent);
    min-width: 80px;
  }

  .ev-outcome {
    font-size: var(--text-caption);
    padding: 0.05rem var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    color: var(--color-text-muted);
  }

  .ev-outcome.correct { background: color-mix(in srgb, var(--color-success) 12%, transparent); color: var(--color-success); }
  .ev-outcome.partial { background: color-mix(in srgb, var(--color-warning) 12%, transparent); color: var(--color-warning); }
  .ev-outcome.incorrect { background: color-mix(in srgb, var(--color-error) 10%, transparent); color: var(--color-error); }

  .ev-quality { font-family: var(--font-mono); color: var(--color-text-muted); }
  .ev-source { color: var(--color-text-muted); }
  .ev-date { margin-left: auto; color: var(--color-text-muted); }

  .empty {
    padding: var(--space-8) var(--space-4);
    text-align: center;
    color: var(--color-text-muted);
  }

  .empty-sub {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    margin: 0;
  }

  @media (max-width: 900px) {
    .profile {
      padding: var(--space-5);
    }

    .profile-header {
      grid-template-columns: 1fr;
    }
  }
</style>
