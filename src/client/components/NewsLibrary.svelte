<script lang="ts">
  import { NEWS_LANGUAGE_OPTIONS, type ReadyReadingSummary } from "../../types/news";

  interface Props {
    items: ReadyReadingSummary[];
    loading: boolean;
    openingKey: string;
    error: string;
    hrefFor: (item: ReadyReadingSummary) => string;
    onopen: (item: ReadyReadingSummary) => void;
    onrefresh: () => void;
  }

  let { items, loading, openingKey, error, hrefFor, onopen, onrefresh }: Props = $props();

  function sourceLabel(source: ReadyReadingSummary["source"]): string {
    if (source === "hacker-news") return "Hacker News";
    if (source === "nytimes") return "The New York Times";
    return "San Francisco Chronicle";
  }

  function languageLabel(code: string): string {
    return NEWS_LANGUAGE_OPTIONS.find((language) => language.code === code)?.nativeName ?? code;
  }

  function storedDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "Saved"
      : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
</script>

<section class="library" aria-labelledby="ready-heading">
  <header>
    <div>
      <p>Already translated</p>
      <h2 id="ready-heading">Ready to read</h2>
    </div>
    <button type="button" onclick={onrefresh} disabled={loading}>Refresh library</button>
  </header>

  {#if loading && !items.length}
    <div class="status">Opening your translated library…</div>
  {:else if error && !items.length}
    <div class="status error">Couldn’t load the translated library. {error}</div>
  {:else if !items.length}
    <div class="empty">
      <strong>Your finished editions will collect here.</strong>
      <span>Choose a new story below; once its Filo layers are saved, it will move into this shelf.</span>
    </div>
  {:else}
    <div class="grid">
      {#each items as item (item.key)}
        <article data-ready-id={item.articleId}>
          <div class="meta">
            <span>{sourceLabel(item.source)}</span>
            <span>{item.level}</span>
            <span>{storedDate(item.storedAt)}</span>
          </div>
          <h3><a href={hrefFor(item)}>{item.title}</a></h3>
          <p class="scope">{item.sentenceCount} sentences · {item.languages.length} {item.languages.length === 1 ? "language" : "languages"}</p>
          <div class="languages" aria-label="Available languages">
            {#each item.languages as language}<span>{languageLabel(language)}</span>{/each}
          </div>
          <div class="actions">
            <button
              type="button"
              disabled={openingKey === item.key}
              aria-busy={openingKey === item.key}
              onclick={() => onopen(item)}
            >{openingKey === item.key ? "Opening…" : "Read now"}</button>
            <a href={item.discussionUrl ?? item.sourceUrl} target="_blank" rel="noreferrer">Original ↗</a>
          </div>
        </article>
      {/each}
    </div>
    {#if error}<p class="inline-error">Library refresh failed: {error}</p>{/if}
  {/if}
</section>

<style>
  .library { margin: 1.4rem 0 2rem; border-top: 5px solid var(--ink); border-bottom: 1px solid var(--ink); }
  header { display: flex; justify-content: space-between; align-items: end; padding: .85rem 0 .7rem; border-bottom: 1px solid var(--ink); }
  header p { margin: 0 0 .15rem; color: var(--accent); font: 750 .58rem var(--sans); letter-spacing: .13em; text-transform: uppercase; }
  h2 { margin: 0; font: 700 clamp(1.7rem, 4vw, 2.7rem)/1 var(--display); }
  header button { padding: .35rem 0; border: 0; border-bottom: 1px solid currentColor; background: none; color: var(--muted); font: 700 .62rem var(--sans); cursor: pointer; }
  header button:disabled { opacity: .55; cursor: wait; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); }
  article { display: flex; min-height: 16.5rem; padding: 1.1rem 1.15rem 1.15rem; flex-direction: column; border-right: 1px solid var(--line); }
  article:last-child { border-right: 0; }
  .meta { display: flex; flex-wrap: wrap; gap: .55rem; color: var(--accent); font: 750 .54rem var(--sans); letter-spacing: .08em; text-transform: uppercase; }
  h3 { margin: .55rem 0 .45rem; font: 700 clamp(1.15rem, 2vw, 1.55rem)/1.08 var(--display); }
  h3 a { color: inherit; text-decoration: none; }
  h3 a:hover { color: var(--accent); }
  .scope { margin: 0 0 .8rem; color: var(--muted); font: italic .78rem var(--serif); }
  .languages { display: flex; flex-wrap: wrap; gap: .3rem; margin-bottom: 1rem; }
  .languages span { padding: .24rem .38rem; border: 1px solid var(--line); background: color-mix(in srgb, var(--paper-deep) 65%, transparent); font: 650 .57rem var(--sans); }
  .actions { display: flex; align-items: center; gap: .8rem; margin-top: auto; }
  .actions button { padding: .55rem .8rem; border: 1px solid var(--accent); background: var(--accent); color: var(--paper); font: 750 .63rem var(--sans); cursor: pointer; }
  .actions button:disabled { opacity: .65; cursor: wait; }
  .actions a { color: var(--muted); font: 700 .61rem var(--sans); text-decoration: none; }
  .status, .empty { display: flex; min-height: 7rem; padding: 1.3rem 0; flex-direction: column; justify-content: center; color: var(--muted); font: .9rem/1.5 var(--serif); }
  .empty strong { color: var(--ink); font: 700 1rem var(--display); }
  .error, .inline-error { color: var(--accent); }
  .inline-error { margin: 0; padding: .6rem 0; border-top: 1px solid var(--line); font: .65rem var(--sans); }
  @media (max-width: 720px) {
    article { min-height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
    article:last-child { border-bottom: 0; }
  }
</style>

