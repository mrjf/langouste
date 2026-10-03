<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type { NewsListingItem, NewsSourceId } from "../../types/news";
  import type {
    CefrLevel,
    ReadingRequest,
    ReadingResponse,
    ReadyReadingSummary,
  } from "../../types/news";
  import {
    fetchReadingJob,
    fetchReadyReading,
    fetchReadyReadings,
    fetchNewsSource,
    startReadingJob,
  } from "../lib/news-api";
  import NewsFeed from "./NewsFeed.svelte";
  import NewsLanguagePicker from "./NewsLanguagePicker.svelte";
  import NewsLibrary from "./NewsLibrary.svelte";
  import NewsReader from "./NewsReader.svelte";
  import {
    defaultNewsReaderState,
    newsHref,
    parseNewsRoute,
    sameReadingRequest,
    type NewsDeskState,
    type NewsRouteState,
    type NewsReaderViewState,
    type NewsReadingState,
    newsRoute,
  } from "../lib/news-route";

  interface Props {
    route: string;
    onRouteChange: (route: string, navigation?: "push" | "replace") => void;
  }

  let { route, onRouteChange }: Props = $props();

  const SOURCES: Array<{ id: NewsSourceId; label: string; short: string }> = [
    { id: "hacker-news", label: "Hacker News", short: "HN" },
    { id: "nytimes", label: "The New York Times", short: "NYT" },
    { id: "sfchronicle", label: "San Francisco Chronicle", short: "SFC" },
  ];
  const PERSISTED_STATE_KEY = "langouste.news:active-builds:v1";
  const LEVELS = new Set<CefrLevel>(["A1", "A2", "B1", "B2", "C1"]);
  const JOB_POLL_INTERVAL_MS = 1_000;

  type JobStatus = "building" | "ready" | "error";
  interface GenerationJob {
    key: string;
    source: NewsSourceId;
    input: string;
    title: string;
    languages: string[];
    level: CefrLevel;
    status: JobStatus;
    response?: ReadingResponse;
    error?: string;
  }

  interface PersistedGenerationJob {
    key: string;
    source: NewsSourceId;
    input: string;
    title: string;
    languages: string[];
    level: CefrLevel;
  }

  interface PersistedAppState {
    jobs: PersistedGenerationJob[];
  }

  const initialUrlState = untrack(() => parseNewsRoute(route));
  const initialRequest = initialUrlState.view === "read" ? initialUrlState.request : null;
  const initialSource = initialUrlState.view === "read"
    ? initialUrlState.request.source
    : initialUrlState.source;
  const initialLanguages = initialUrlState.view === "read"
    ? initialUrlState.request.languages
    : initialUrlState.languages;
  const initialLevel = initialUrlState.view === "read"
    ? initialUrlState.request.level
    : initialUrlState.level;
  const persistedJobs = restoreJobs();

  let activeSource = $state<NewsSourceId>(initialSource);
  let selectedLanguages = $state([...initialLanguages]);
  let level = $state<CefrLevel>(initialLevel);
  let listings = $state<Partial<Record<NewsSourceId, NewsListingItem[]>>>({});
  let loadingSource = $state(false);
  let jobs = $state<Record<string, GenerationJob>>(Object.fromEntries(
    persistedJobs.map((job) => [job.key, { ...job, status: "building" as const }]),
  ));
  let directInput = $state(
    initialUrlState.view === "desk" ? initialUrlState.input : initialUrlState.request.input,
  );
  let reading = $state<ReadingResponse | null>(null);
  let readingRequest = $state<ReadingRequest | null>(
    initialRequest ? copyRequest(initialRequest) : null,
  );
  let readerState = $state<NewsReaderViewState>(
    initialUrlState.view === "read"
      ? { ...initialUrlState.reader }
      : defaultNewsReaderState(initialLanguages),
  );
  let error = $state("");
  let readyReadings = $state<ReadyReadingSummary[]>([]);
  let loadingReady = $state(false);
  let openingReadyKey = $state("");
  let readyError = $state("");
  let pageUnloading = false;
  let urlReady = false;
  let appliedRoute = untrack(() => route);
  const activeBuildKeys = new Set<string>();

  const activeItems = $derived(listings[activeSource] ?? []);
  const readyArticleIds = $derived(new Set(readyReadings.map((item) => item.articleId)));
  const unprocessedItems = $derived(activeItems.filter((item) => (
    !readyArticleIds.has(`${item.source}:${item.id}`)
    && !readyReadings.some((ready) => ready.source === item.source
      && ready.sourceUrl === (item.articleUrl ?? item.url))
  )));
  const activeJobStates = $derived.by(() => Object.fromEntries(unprocessedItems.flatMap((item) => {
    const input = inputFor(item);
    const job = jobs[requestKey(item.source, input, selectedLanguages, level)];
    return job ? [[input, { status: job.status, error: job.error }]] : [];
  })));
  const directJob = $derived.by(() => {
    const input = directInput.trim();
    return input ? jobs[requestKey(activeSource, input, selectedLanguages, level)] : undefined;
  });
  const buildingCount = $derived(Object.values(jobs).filter((job) => job.status === "building").length);
  const readyCount = $derived(Object.values(jobs).filter((job) => job.status === "ready").length);
  const directPlaceholder = $derived(
    activeSource === "hacker-news"
      ? "HN item id or discussion URL"
      : activeSource === "nytimes"
        ? "https://www.nytimes.com/…"
        : "https://www.sfchronicle.com/…",
  );

  $effect(() => {
    persistAppState();
  });

  $effect(() => {
    const nextRoute = route;
    if (!urlReady || nextRoute === appliedRoute) return;
    appliedRoute = nextRoute;
    untrack(() => applyUrlState(parseNewsRoute(nextRoute)));
  });

  onMount(() => {
    const markUnloading = () => { pageUnloading = true; };
    window.addEventListener("pagehide", markUnloading);
    window.addEventListener("beforeunload", markUnloading);
    urlReady = true;
    applyUrlState(parseNewsRoute(route));
    void loadReadyReadings();
    for (const job of Object.values(jobs)) {
      void buildReading(job.source, job.input, job.title, job.languages, job.level, job.key);
    }
    return () => {
      window.removeEventListener("pagehide", markUnloading);
      window.removeEventListener("beforeunload", markUnloading);
    };
  });

  async function loadSource(source: NewsSourceId, force = false): Promise<void> {
    error = "";
    if (!force && listings[source]) return;
    loadingSource = true;
    try {
      const response = await fetchNewsSource(source);
      listings = { ...listings, [source]: response.items };
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      listings = { ...listings, [source]: [] };
    } finally {
      loadingSource = false;
    }
  }

  async function loadReadyReadings(): Promise<void> {
    loadingReady = true;
    readyError = "";
    try {
      readyReadings = (await fetchReadyReadings()).items;
    } catch (cause) {
      readyError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loadingReady = false;
    }
  }

  function inputFor(item: NewsListingItem): string {
    return item.source === "hacker-news" ? item.id : item.articleUrl ?? item.url;
  }

  function readItem(item: NewsListingItem): void {
    const input = inputFor(item);
    const request = currentRequest(item.source, input);
    const key = requestKey(request.source, request.input, request.languages, request.level);
    const existing = jobs[key];
    if (existing?.status === "ready" && existing.response) {
      openReading(existing.response, request);
      return;
    }
    if (existing?.status !== "building") {
      void buildReading(
        request.source,
        request.input,
        item.title,
        request.languages,
        request.level,
        key,
      );
    }
  }

  function submitDirect(event: SubmitEvent): void {
    event.preventDefault();
    const input = directInput.trim();
    if (!input) return;
    const request = currentRequest(activeSource, input);
    const key = requestKey(request.source, request.input, request.languages, request.level);
    const existing = jobs[key];
    if (existing?.status === "ready" && existing.response) {
      openReading(existing.response, request);
      return;
    }
    if (existing?.status !== "building") {
      void buildReading(
        request.source,
        request.input,
        input,
        request.languages,
        request.level,
        key,
      );
    }
  }

  async function buildReading(
    source: NewsSourceId,
    input: string,
    title: string,
    languages: string[],
    readingLevel: CefrLevel,
    key: string,
  ): Promise<void> {
    if (activeBuildKeys.has(key)) return;
    activeBuildKeys.add(key);
    jobs = { ...jobs, [key]: { key, source, input, title, languages, level: readingLevel, status: "building" } };
    try {
      const request = {
        source,
        input,
        languages,
        level: readingLevel,
      };
      let job = await startReadingJob(request);
      while (job.status === "building") {
        await delay(JOB_POLL_INTERVAL_MS);
        job = await fetchReadingJob(job.id);
      }
      if (job.status === "error") throw new Error(job.error || "Reading generation failed");
      if (!job.response) throw new Error("The completed reading job has no edition");
      const response = job.response;
      jobs = { ...jobs, [key]: { ...jobs[key]!, status: "ready", response, error: undefined } };
      void loadReadyReadings();
      if (readingRequest && sameReadingRequest(readingRequest, request)) {
        openReading(response, request, readerState, "replace");
      }
    } catch (cause) {
      if (pageUnloading) return;
      jobs = {
        ...jobs,
        [key]: {
          ...jobs[key]!,
          status: "error",
          error: cause instanceof Error ? cause.message : String(cause),
        },
      };
    } finally {
      activeBuildKeys.delete(key);
    }
  }

  function openReading(
    response: ReadingResponse,
    request: ReadingRequest,
    nextReaderState = defaultNewsReaderState(request.languages),
    navigation: "push" | "replace" = "push",
  ): void {
    activeSource = request.source;
    selectedLanguages = [...request.languages];
    level = request.level;
    readingRequest = copyRequest(request);
    readerState = { ...nextReaderState };
    reading = response;
    writeUrl({ view: "read", request: copyRequest(request), reader: { ...nextReaderState } }, navigation);
  }

  async function openReadyReading(item: ReadyReadingSummary): Promise<void> {
    const state = readyReadingState(item);
    openingReadyKey = item.key;
    error = "";
    try {
      const response = await fetchReadyReading(item.key);
      openReading(response, state.request, state.reader, "push");
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      openingReadyKey = "";
    }
  }

  function feedReadingUrl(item: NewsListingItem): string {
    return urlForRequest(currentRequest(item.source, inputFor(item)));
  }

  function readyReadingUrl(item: ReadyReadingSummary): string {
    return newsHref(readyReadingState(item));
  }

  function readyReadingState(item: ReadyReadingSummary): NewsReadingState {
    const request: ReadingRequest = {
      source: item.source,
      input: item.input,
      languages: [...item.languages],
      level: item.level,
    };
    return {
      view: "read",
      request,
      reader: defaultNewsReaderState(request.languages),
    };
  }

  function urlForRequest(request: ReadingRequest): string {
    return newsHref({ view: "read", request, reader: defaultNewsReaderState(request.languages) });
  }

  function selectSource(source: NewsSourceId): void {
    const sourceChanged = source !== activeSource;
    activeSource = source;
    reading = null;
    readingRequest = null;
    if (sourceChanged) directInput = "";
    replaceDeskUrl();
    void loadSource(source);
  }

  function selectLanguages(languages: string[]): void {
    selectedLanguages = [...languages];
    leavePendingReading();
    replaceDeskUrl();
  }

  function selectLevel(event: Event): void {
    level = (event.currentTarget as HTMLSelectElement).value as CefrLevel;
    leavePendingReading();
    replaceDeskUrl();
  }

  function updateDirectInput(event: Event): void {
    directInput = (event.currentTarget as HTMLInputElement).value;
    leavePendingReading();
    replaceDeskUrl();
  }

  function leavePendingReading(): void {
    if (!readingRequest || reading) return;
    readingRequest = null;
    readerState = defaultNewsReaderState(selectedLanguages);
  }

  function updateReaderState(state: NewsReaderViewState): void {
    readerState = { ...state };
    if (!readingRequest) return;
    writeUrl({
      view: "read",
      request: copyRequest(readingRequest),
      reader: { ...state },
    }, "replace");
  }

  function openFrontPage(): void {
    const state: NewsDeskState = {
      view: "desk",
      source: activeSource,
      languages: [...selectedLanguages],
      level,
      input: "",
    };
    writeUrl(state, "push");
    applyUrlState(state);
  }

  function applyUrlState(state: NewsRouteState): void {
    if (state.view === "desk") {
      activeSource = state.source;
      selectedLanguages = [...state.languages];
      level = state.level;
      directInput = state.input;
      reading = null;
      readingRequest = null;
      readerState = defaultNewsReaderState(state.languages);
      void loadSource(state.source);
      return;
    }

    const requestChanged = !readingRequest || !sameReadingRequest(readingRequest, state.request);
    activeSource = state.request.source;
    selectedLanguages = [...state.request.languages];
    level = state.request.level;
    directInput = state.request.input;
    readingRequest = copyRequest(state.request);
    readerState = { ...state.reader };
    void loadSource(state.request.source);
    if (requestChanged) reading = null;
    if (reading && !requestChanged) return;

    const key = requestKey(
      state.request.source,
      state.request.input,
      state.request.languages,
      state.request.level,
    );
    const existing = jobs[key];
    if (existing?.status === "ready" && existing.response) {
      openReading(existing.response, state.request, state.reader, "replace");
      return;
    }
    void buildReading(
      state.request.source,
      state.request.input,
      state.request.input,
      [...state.request.languages],
      state.request.level,
      key,
    );
  }

  function replaceDeskUrl(): void {
    if (!urlReady || readingRequest) return;
    replaceUrl({
      view: "desk",
      source: activeSource,
      languages: [...selectedLanguages],
      level,
      input: directInput,
    });
  }

  function replaceUrl(state: NewsRouteState): void {
    writeUrl(state, "replace");
  }

  function writeUrl(state: NewsRouteState, navigation: "push" | "replace"): void {
    if (!urlReady) return;
    const nextRoute = newsRoute(state);
    if (nextRoute === appliedRoute) return;
    appliedRoute = nextRoute;
    onRouteChange(nextRoute, navigation);
  }

  function currentRequest(source: NewsSourceId, input: string): ReadingRequest {
    return { source, input: input.trim(), languages: [...selectedLanguages], level };
  }

  function copyRequest(request: ReadingRequest): ReadingRequest {
    return { ...request, languages: [...request.languages] };
  }

  function requestKey(
    source: NewsSourceId,
    input: string,
    languages: string[],
    readingLevel: CefrLevel,
  ): string {
    return JSON.stringify([source, input.trim(), [...languages].sort(), readingLevel]);
  }

  function restoreJobs(): PersistedGenerationJob[] {
    if (typeof localStorage === "undefined") return [];
    try {
      const value = JSON.parse(localStorage.getItem(PERSISTED_STATE_KEY) ?? "null") as unknown;
      if (!isRecord(value)) return [];
      return Array.isArray(value.jobs)
        ? value.jobs.flatMap((candidate) => restoreJob(candidate))
        : [];
    } catch {
      return [];
    }
  }

  function restoreJob(value: unknown): PersistedGenerationJob[] {
    if (!isRecord(value) || !isSource(value.source) || typeof value.input !== "string") return [];
    if (typeof value.title !== "string" || !Array.isArray(value.languages)) return [];
    if (typeof value.level !== "string" || !LEVELS.has(value.level as CefrLevel)) return [];
    const languages = value.languages.filter((language): language is string => typeof language === "string");
    if (!languages.length || languages.length > 8) return [];
    const level = value.level as CefrLevel;
    const key = requestKey(value.source, value.input, languages, level);
    if (value.key !== key) return [];
    return [{ key, source: value.source, input: value.input, title: value.title, languages, level }];
  }

  function persistAppState(): void {
    if (typeof localStorage === "undefined") return;
    const activeJobs: PersistedGenerationJob[] = Object.values(jobs)
      .filter((job) => job.status === "building" || job.status === "ready")
      .map(({ key, source, input, title, languages, level: jobLevel }) => ({
        key,
        source,
        input,
        title,
        languages: [...languages],
        level: jobLevel,
      }))
      .slice(-24);
    try {
      localStorage.setItem(PERSISTED_STATE_KEY, JSON.stringify({
        jobs: activeJobs,
      } satisfies PersistedAppState));
    } catch {
      // Storage is an enhancement; generation remains usable when it is unavailable.
    }
  }

  function isSource(value: unknown): value is NewsSourceId {
    return typeof value === "string" && SOURCES.some((source) => source.id === value);
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }
</script>

<svelte:head>
  <title>{reading ? `${reading.document.metadata.title} · Langouste News` : "News · Langouste"}</title>
</svelte:head>

<section class="news-surface">
{#if reading}
  <NewsReader
    document={reading.document}
    persistence={reading.persistence}
    cacheHit={reading.cacheHit}
    state={readerState}
    onstatechange={updateReaderState}
    onback={openFrontPage}
  />
{:else}
  <main class="shell">
    <header class="masthead">
      <div>
        <p class="edition">Parallel editions · Read across languages</p>
        <h1>News</h1>
      </div>
      <p class="date">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
    </header>

    <nav class="sources" aria-label="News sources">
      {#each SOURCES as source}
        <button type="button" class:active={activeSource === source.id} onclick={() => selectSource(source.id)}>
          <span>{source.short}</span>{source.label}
        </button>
      {/each}
    </nav>

    <NewsLibrary
      items={readyReadings}
      loading={loadingReady}
      openingKey={openingReadyKey}
      error={readyError}
      hrefFor={readyReadingUrl}
      onopen={openReadyReading}
      onrefresh={() => void loadReadyReadings()}
    />

    <section class="edition-builder">
      <div class="builder-heading">
        <div>
          <p>New &amp; untranslated</p>
          <h1>Build another parallel edition</h1>
        </div>
        <label>
          Reading level
          <select value={level} onchange={selectLevel}>
            <option value="A1">A1 · Essential</option>
            <option value="A2">A2 · Simple</option>
            <option value="B1">B1 · Independent</option>
            <option value="B2">B2 · Detailed</option>
            <option value="C1">C1 · Full register</option>
          </select>
        </label>
      </div>

      <NewsLanguagePicker selected={selectedLanguages} onchange={selectLanguages} />
      <p class="selection-note">{selectedLanguages.length} columns selected · choose up to eight</p>
      {#if buildingCount || readyCount}
        <p class="job-summary" aria-live="polite">
          {buildingCount ? `${buildingCount} building in parallel` : ""}{buildingCount && readyCount ? " · " : ""}{readyCount ? `${readyCount} ready to read` : ""}
        </p>
      {/if}

      <form class="direct" onsubmit={submitDirect}>
        <label for="story-input">Open a specific story</label>
        <div>
          <input id="story-input" value={directInput} oninput={updateDirectInput} placeholder={directPlaceholder} />
          <button type="submit" disabled={!directInput.trim() || directJob?.status === "building"}>
            {directJob?.status === "building" ? "Building aligned Filo tiers…" : directJob?.status === "ready" ? "Open parallel edition" : directJob?.status === "error" ? "Retry parallel edition" : "Build parallel edition"}
          </button>
        </div>
        {#if directJob?.status === "error"}<p class="direct-error">{directJob.error}</p>{/if}
      </form>
    </section>

    {#if error}
      <div class="error" role="alert"><strong>Couldn’t load this desk.</strong><span>{error}</span></div>
    {/if}

    <NewsFeed
      source={activeSource}
      items={unprocessedItems}
      loading={loadingSource}
      jobs={activeJobStates}
      hrefFor={feedReadingUrl}
      onread={readItem}
      onrefresh={() => void loadSource(activeSource, true)}
    />

    <footer>
      <span>Original reporting remains with its publisher.</span>
      <span>Sentences, translations, word alignments, grammar, and vocabulary are Filo tiers.</span>
    </footer>
  </main>
{/if}
</section>

<style>
  .news-surface {
    --paper: #f6f3ed;
    --paper-deep: #ebe6dc;
    --ink: #171914;
    --ink-soft: #444740;
    --muted: #74766e;
    --line: #c9c5bc;
    --accent: var(--color-accent);
    --word-highlight: var(--color-accent);
    --sentence-highlight: #e9dfc5;
    --sentence-highlight-strong: #dfd0aa;
    --serif: Georgia, "Times New Roman", serif;
    --display: Georgia, "Times New Roman", serif;
    --sans: var(--font-sans);
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    color: var(--ink);
    background: radial-gradient(circle at 25% 0%, rgba(255,255,255,.65), transparent 30rem), var(--paper);
    font-family: var(--serif);
  }
  .shell { width: min(76rem, calc(100% - 2rem)); margin: 0 auto; }
  .masthead {
    display: flex; align-items: end; justify-content: space-between; gap: 1rem;
    padding: 0.85rem 0 0.7rem; border-bottom: 4px double var(--ink);
  }
  .masthead h1 { margin: 0; font: 700 clamp(2rem, 5vw, 3.8rem)/.9 var(--display); }
  .edition, .date { margin: 0 0 0.2rem; color: var(--muted); font: 700 0.56rem/1.3 var(--sans); letter-spacing: .08em; text-transform: uppercase; }
  .date { text-align: right; }
  .sources { display: flex; justify-content: center; border-bottom: 1px solid var(--ink); }
  .sources button {
    display: flex; align-items: baseline; gap: .42rem; padding: .65rem .9rem;
    border: 0; border-left: 1px solid var(--line); background: transparent;
    color: var(--ink-soft); font: 700 .62rem var(--sans); cursor: pointer;
  }
  .sources button:last-child { border-right: 1px solid var(--line); }
  .sources button span { color: var(--accent); font-family: var(--serif); }
  .sources button.active { background: var(--ink); color: var(--paper); }
  .edition-builder { padding: 1.15rem 0 1.3rem; }
  .builder-heading { display: flex; align-items: end; justify-content: space-between; gap: 1rem; margin-bottom: .75rem; }
  .builder-heading p { margin: 0 0 .15rem; color: var(--accent); font: 750 .57rem var(--sans); letter-spacing: .12em; text-transform: uppercase; }
  .builder-heading h1 { margin: 0; font: 700 clamp(1.25rem, 3vw, 1.85rem)/1 var(--display); }
  .builder-heading label, .direct > label { display: grid; gap: .25rem; color: var(--muted); font: 700 .56rem var(--sans); letter-spacing: .08em; text-transform: uppercase; }
  select, input { border: 1px solid var(--line); background: rgba(255,255,255,.25); color: var(--ink); }
  select { padding: .44rem 1.8rem .44rem .5rem; font: 650 .7rem var(--sans); }
  .selection-note { margin: .42rem 0 0; color: var(--muted); font: .57rem var(--sans); }
  .job-summary { margin: .35rem 0 0; color: var(--accent); font: 750 .6rem var(--sans); letter-spacing: .04em; }
  .direct { margin-top: .85rem; padding-top: .85rem; border-top: 1px dashed var(--line); }
  .direct > div { display: grid; grid-template-columns: 1fr auto; gap: .45rem; }
  input { min-width: 0; padding: .65rem .72rem; font: .72rem var(--sans); }
  .direct button { padding: .6rem .8rem; border: 1px solid var(--accent); background: var(--accent); color: var(--paper); font: 750 .62rem var(--sans); cursor: pointer; }
  .direct button:disabled { opacity: .45; cursor: not-allowed; }
  .direct-error { margin: .4rem 0 0; color: var(--accent); font: .68rem/1.35 var(--sans); }
  .error { display: grid; gap: .16rem; margin-bottom: 1rem; padding: .75rem .9rem; border-left: 3px solid var(--accent); background: #ecd9d2; color: #6d2519; font: .72rem/1.4 var(--sans); }
  footer { display: flex; justify-content: space-between; gap: 1rem; padding: 1rem 0 2rem; color: var(--muted); font: .56rem var(--sans); }
  @media (max-width: 720px) {
    .masthead { align-items: start; flex-direction: column; }
    .edition, .date { display: none; }
    .sources { justify-content: start; overflow-x: auto; }
    .sources button { white-space: nowrap; }
    .builder-heading { align-items: start; flex-direction: column; }
    .direct > div { grid-template-columns: 1fr; }
    footer { flex-direction: column; }
  }
</style>
