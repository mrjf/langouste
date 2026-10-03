<script lang="ts">
  import type { NewsListingItem, NewsSourceId } from "../../types/news";

  interface Props {
    source: NewsSourceId;
    items: NewsListingItem[];
    loading: boolean;
    jobs: Record<string, { status: "building" | "ready" | "error"; error?: string }>;
    hrefFor: (item: NewsListingItem) => string;
    onread: (item: NewsListingItem) => void;
    onrefresh: () => void;
  }

  let { source, items, loading, jobs, hrefFor, onread, onrefresh }: Props = $props();

  const label = $derived(source === "hacker-news" ? "Hacker News" : source === "nytimes" ? "The New York Times" : "San Francisco Chronicle");

  function inputFor(item: NewsListingItem): string {
    return source === "hacker-news" ? item.id : item.articleUrl ?? item.url;
  }

  function jobFor(item: NewsListingItem) {
    return jobs[inputFor(item)];
  }
</script>

<section class="feed">
  <header>
    <div><p>New &amp; untranslated · Current desk</p><h2>{label}</h2></div>
    <button type="button" onclick={onrefresh} disabled={loading}>Refresh</button>
  </header>
  {#if loading}
    <div class="status">Gathering the edition…</div>
  {:else if !items.length}
    <div class="status">No front-page stories found. Open a specific story above.</div>
  {:else}
    <ol>
      {#each items as item, index (item.id)}
        {@const job = jobFor(item)}
        <li>
          <span class="number">{String(index + 1).padStart(2, "0")}</span>
          <article data-story-id={item.id}>
            <div class="meta">
              {#if item.section}<span>{item.section}</span>{/if}
              {#if item.score !== undefined}<span>{item.score} points</span>{/if}
              {#if item.commentCount !== undefined}<span>{item.commentCount} comments</span>{/if}
            </div>
            <h3><a href={hrefFor(item)}>{item.title}</a></h3>
            {#if item.summary}<p>{item.summary}</p>{/if}
            <div class="actions">
              <button
                type="button"
                class:ready={job?.status === "ready"}
                disabled={job?.status === "building"}
                aria-busy={job?.status === "building"}
                onclick={() => onread(item)}
              >
                {#if job?.status === "building"}<span class="spinner" aria-hidden="true"></span>{/if}
                {job?.status === "building" ? "Building this edition…" : job?.status === "ready" ? "Open edition" : job?.status === "error" ? "Retry edition" : "Read in parallel"}
              </button>
              <a href={item.url} target="_blank" rel="noreferrer">Original ↗</a>
            </div>
            {#if job?.status === "error"}<p class="job-error">{job.error}</p>{/if}
          </article>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .feed { border-top: 4px double var(--ink); }
  header { display: flex; justify-content: space-between; align-items: end; padding: 1.2rem 0 0.75rem; border-bottom: 1px solid var(--ink); }
  header p { margin: 0 0 0.15rem; color: var(--accent); font: 750 0.58rem var(--sans); letter-spacing: 0.12em; text-transform: uppercase; }
  h2 { margin: 0; font: 700 clamp(1.55rem, 4vw, 2.5rem)/1 var(--display); }
  header button { padding: 0.35rem 0; border: 0; border-bottom: 1px solid currentColor; background: none; color: var(--muted); font: 700 0.64rem var(--sans); cursor: pointer; }
  ol { margin: 0; padding: 0; list-style: none; }
  li { display: grid; grid-template-columns: 2.7rem 1fr; gap: 0.8rem; padding: 1.1rem 0; border-bottom: 1px solid var(--line); }
  .number { color: var(--accent); font: 1.05rem var(--display); }
  .meta { display: flex; gap: 0.6rem; color: var(--muted); font: 700 0.55rem var(--sans); letter-spacing: 0.08em; text-transform: uppercase; }
  h3 { max-width: 52rem; margin: 0.3rem 0 0.35rem; font: 700 clamp(1.05rem, 2vw, 1.45rem)/1.12 var(--display); }
  h3 a { color: inherit; text-decoration: none; }
  h3 a:hover { color: var(--accent); }
  article > p { max-width: 50rem; margin: 0 0 0.65rem; color: var(--ink-soft); font: 0.9rem/1.45 var(--serif); }
  .actions { display: flex; align-items: center; gap: 0.9rem; }
  .actions button { padding: 0.5rem 0.7rem; border: 1px solid var(--ink); background: var(--ink); color: var(--paper); font: 750 0.62rem var(--sans); cursor: pointer; }
  .actions button:hover:not(:disabled) { border-color: var(--accent); background: var(--accent); }
  .actions button:disabled { opacity: 0.72; cursor: wait; }
  .actions button.ready { border-color: var(--accent); background: var(--accent); }
  .spinner {
    display: inline-block; width: .72em; height: .72em; margin-right: .38rem;
    border: 1px solid color-mix(in srgb, var(--paper) 42%, transparent); border-top-color: var(--paper);
    border-radius: 50%; animation: spin .7s linear infinite;
  }
  .job-error { margin: .55rem 0 0; color: var(--accent); font: .68rem/1.35 var(--sans); }
  .actions a { color: var(--muted); font: 700 0.62rem var(--sans); text-decoration: none; }
  .status { padding: 3rem 0; color: var(--muted); font: italic 0.95rem var(--serif); }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>

