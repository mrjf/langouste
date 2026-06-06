<script lang="ts">
  import { profile } from "../lib/stores.svelte";
  import { api } from "../lib/api";
  import { LANGUAGES, langName, langTag } from "../lib/languages";
  import type {
    DictionaryLookupResponse,
    DictionaryTranslationResponse,
  } from "../lib/api-contracts";
  import Button from "./ui/Button.svelte";
  import Badge from "./ui/Badge.svelte";
  import DictionaryText from "./DictionaryText.svelte";

  interface Props {
    route?: string;
    onRouteChange?: (route: string) => void;
  }

  interface LookupState {
    loading: boolean;
    result: DictionaryLookupResponse | null;
    error: string | null;
  }

  interface TranslationState {
    loading: boolean;
    result: DictionaryTranslationResponse | null;
    error: string | null;
  }

  interface DictionaryRoute {
    language: string;
    term: string;
  }

  interface ExampleParts {
    source: string;
    separator: string | null;
    translation: string | null;
  }

  let { route = "", onRouteChange }: Props = $props();

  const languageCodes = Object.keys(LANGUAGES);
  let primaryLanguage = $state("hu");
  let termInput = $state("");
  let routeTerm = $state("");
  let visibleLanguages = $state<string[]>([]);
  let lookups = $state<Record<string, LookupState>>({});
  let translations = $state<Record<string, TranslationState>>({});

  const preferredLanguages = $derived.by(() => {
    const langs = [
      primaryLanguage,
      profile.value?.base_language ?? "en",
    ].filter(Boolean);
    return [...new Set(langs)];
  });

  $effect(() => {
    const parsed = parseDictionaryRoute(route);
    if (parsed.language && primaryLanguage !== parsed.language) primaryLanguage = parsed.language;
    if (parsed.term !== routeTerm) {
      routeTerm = parsed.term;
      termInput = parsed.term;
    }
    if (visibleLanguages.length === 0) {
      visibleLanguages = preferredLanguages;
    } else if (parsed.language && !visibleLanguages.includes(parsed.language)) {
      visibleLanguages = [parsed.language, ...visibleLanguages];
    }
  });

  $effect(() => {
    const term = routeTerm.trim();
    if (!term) return;
    void loadLookup(term, primaryLanguage);
    for (const language of visibleLanguages) {
      if (language !== primaryLanguage) {
        void loadTranslation(term, primaryLanguage, language);
      }
    }
  });

  async function loadLookup(term: string, language: string) {
    const key = lookupKey(term, language);
    if (lookups[key]?.loading || hasDictionaryResult(lookups[key]?.result)) return;
    lookups = {
      ...lookups,
      [key]: { loading: true, result: null, error: null },
    };
    try {
      const result = await api.lookupDictionary(term, language, { recordSeen: true });
      lookups = {
        ...lookups,
        [key]: { loading: false, result, error: null },
      };
    } catch (err) {
      lookups = {
        ...lookups,
        [key]: {
          loading: false,
          result: null,
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async function loadTranslation(term: string, sourceLanguage: string, targetLanguage: string) {
    const key = translationKey(term, sourceLanguage, targetLanguage);
    if (translations[key]?.loading || translations[key]?.result) return;
    translations = {
      ...translations,
      [key]: { loading: true, result: null, error: null },
    };
    try {
      const result = await api.translateDictionary(term, sourceLanguage, targetLanguage);
      translations = {
        ...translations,
        [key]: { loading: false, result, error: null },
      };
    } catch (err) {
      translations = {
        ...translations,
        [key]: {
          loading: false,
          result: null,
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  function submitSearch(event: Event) {
    event.preventDefault();
    const term = termInput.trim();
    if (!term) return;
    replaceRoute({ language: primaryLanguage, term });
  }

  function pivotLanguage(language: string) {
    primaryLanguage = language;
    if (!visibleLanguages.includes(language)) {
      visibleLanguages = [language, ...visibleLanguages];
    }
    if (routeTerm) replaceRoute({ language, term: routeTerm });
  }

  function toggleLanguage(language: string) {
    if (visibleLanguages.includes(language)) {
      visibleLanguages = visibleLanguages.filter((item) => item !== language);
      if (language === primaryLanguage && visibleLanguages.length > 0) {
        pivotLanguage(visibleLanguages[0]);
      }
      return;
    }
    visibleLanguages = [...visibleLanguages, language];
  }

  function openWord(term: string, language: string) {
    termInput = term;
    primaryLanguage = language;
    if (!visibleLanguages.includes(language)) visibleLanguages = [language, ...visibleLanguages];
    replaceRoute({ language, term });
  }

  function replaceRoute(next: DictionaryRoute) {
    onRouteChange?.(`${encodeURIComponent(next.language)}/${encodeURIComponent(next.term)}`);
  }

  function parseDictionaryRoute(value: string): DictionaryRoute {
    const parts = value.split("/").filter(Boolean).map(decodeURIComponent);
    return {
      language: parts[0] && LANGUAGES[parts[0]] ? parts[0] : primaryLanguage,
      term: parts[1] ?? "",
    };
  }

  function lookupKey(term: string, language: string): string {
    return `${language}:${term.toLocaleLowerCase(language)}`;
  }

  function hasDictionaryResult(result: DictionaryLookupResponse | null | undefined): boolean {
    return !!(
      result &&
      ((result.senses?.length ?? 0) > 0 ||
        (result.definitions?.length ?? 0) > 0 ||
        result.source_term)
    );
  }

  function translationKey(term: string, sourceLanguage: string, targetLanguage: string): string {
    return `${sourceLanguage}:${targetLanguage}:${term.toLocaleLowerCase(sourceLanguage)}`;
  }

  function primaryState(): LookupState | null {
    if (!routeTerm) return null;
    return lookups[lookupKey(routeTerm, primaryLanguage)] ?? null;
  }

  function translationStateFor(language: string): TranslationState | null {
    if (!routeTerm) return null;
    return translations[translationKey(routeTerm, primaryLanguage, language)] ?? null;
  }

  function sourceTerm(result: DictionaryLookupResponse | null, fallback: string): string {
    return result?.source_term || fallback;
  }

  function targetHeadword(
    translation: DictionaryTranslationResponse | null,
    language: string,
  ): string {
    return (
      translation?.equivalents.find((equivalent) => equivalent.trim().length > 0)?.trim() ??
      `${langName(language)} equivalents`
    );
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

  function englishWiktionaryUrl(term: string, language: string): string {
    return `https://en.wiktionary.org/wiki/${encodeURIComponent(term)}#${encodeURIComponent(langName(language))}`;
  }

  function targetWiktionaryUrl(term: string, language: string): string {
    return `https://${language}.wiktionary.org/wiki/${encodeURIComponent(term)}`;
  }
</script>

<section class="dictionary">
  <header class="dictionary-header">
    <div>
      <p class="eyebrow">Dictionary</p>
      <h1>{routeTerm || "Look up a word"}</h1>
    </div>
    <form class="lookup-form" onsubmit={submitSearch}>
      <label>
        <span>Word</span>
        <input bind:value={termInput} placeholder="szétszórva" autocomplete="off" />
      </label>
      <label>
        <span>Primary language</span>
        <select value={primaryLanguage} onchange={(event) => pivotLanguage((event.target as HTMLSelectElement).value)}>
          {#each languageCodes as code}
            <option value={code}>{langTag(code)} — {langName(code)}</option>
          {/each}
        </select>
      </label>
      <Button type="submit" label="Look up" variant="primary" />
    </form>
  </header>

  <div class="language-strip" aria-label="Visible dictionary languages">
    {#each languageCodes as code}
      <button
        class="language-toggle"
        class:active={visibleLanguages.includes(code)}
        class:primary={primaryLanguage === code}
        onclick={() => toggleLanguage(code)}
      >
        <span>{langTag(code)}</span>
        <small>{langName(code)}</small>
      </button>
    {/each}
  </div>

  {#if !routeTerm}
    <div class="empty">Open this view from any word, or search directly.</div>
  {:else}
    <div class="lookup-grid">
      {#each visibleLanguages as language}
        {@const state = language === primaryLanguage ? primaryState() : null}
        {@const translationState = language === primaryLanguage ? null : translationStateFor(language)}
        {@const result = state?.result ?? null}
        {@const translation = translationState?.result ?? null}
        {@const sourceLookupTerm = language === primaryLanguage ? sourceTerm(result, routeTerm) : (translation?.source_term ?? routeTerm)}
        {@const cardHeadword = language === primaryLanguage ? sourceLookupTerm : targetHeadword(translation, language)}
        <article class="lookup-card" class:primary={primaryLanguage === language}>
          <div class="lookup-card-head">
            <div>
              <span class="lookup-language">{langTag(language)} {langName(language)}</span>
              <h2>{cardHeadword}</h2>
            </div>
            {#if language === primaryLanguage && result?.form_description}
              <Badge label={result.form_description} tone="accent" />
            {:else if language !== primaryLanguage}
              <Badge label={`${langName(language)} equivalents`} tone="neutral" />
            {/if}
          </div>

          {#if language === primaryLanguage && state?.loading}
            <p class="muted">Looking up…</p>
          {:else if language !== primaryLanguage && translationState?.loading}
            <p class="muted">Translating glosses…</p>
          {:else if language === primaryLanguage && state?.error}
            <p class="muted">{state.error}</p>
          {:else if language !== primaryLanguage && translationState?.error}
            <p class="muted">{translationState.error}</p>
          {:else if language !== primaryLanguage && translation?.equivalents?.length}
            <ol class="definitions">
              {#each translation.equivalents as equivalent}
                <li>{equivalent}</li>
              {/each}
            </ol>
            {#if translation.source_glosses.length > 0}
              <div class="source-glosses">
                <span>Source glosses from Wiktionary</span>
                {#each translation.source_glosses as gloss}
                  <p>{gloss}</p>
                {/each}
              </div>
            {/if}
          {:else if language === primaryLanguage && result?.senses?.length}
            <div class="senses">
              {#each result.senses as sense}
                <section class="sense">
                  <span class="part-of-speech">{sense.part_of_speech}</span>
                  <p>{sense.definition}</p>
                  {#each sense.examples as example}
                    {@const exampleParts = splitExample(example)}
                    <blockquote>
                      <DictionaryText text={exampleParts.source} language={primaryLanguage} />
                      {#if exampleParts.translation}
                        <span class="example-separator">{exampleParts.separator}</span>
                        <DictionaryText text={exampleParts.translation} language="en" />
                      {/if}
                    </blockquote>
                  {/each}
                </section>
              {/each}
            </div>
          {:else if language === primaryLanguage && result?.definitions?.length}
            <ol class="definitions">
              {#each result.definitions as definition}
                <li>{definition}</li>
              {/each}
            </ol>
          {:else}
            <p class="muted">
              {language === primaryLanguage
                ? "No entry found for this language."
                : "No translated equivalents found yet."}
            </p>
          {/if}

          <div class="sources">
            <a href={result?.source_url ?? englishWiktionaryUrl(sourceLookupTerm, primaryLanguage)} target="_blank" rel="noreferrer">
              English Wiktionary
            </a>
            {#if primaryLanguage !== "en"}
              <a href={result?.target_source_url ?? targetWiktionaryUrl(sourceLookupTerm, primaryLanguage)} target="_blank" rel="noreferrer">
                {langName(primaryLanguage)} Wiktionary
              </a>
            {/if}
          </div>

          {#if language === primaryLanguage && result?.source_term && result.source_term !== routeTerm}
            <button class="lemma-button" onclick={() => openWord(result.source_term ?? routeTerm, language)}>
              Pivot to lemma
            </button>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  .dictionary {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-6) var(--space-8);
    background: var(--color-panel);
  }

  .dictionary-header {
    display: grid;
    grid-template-columns: minmax(12rem, 18rem) minmax(0, 1fr);
    gap: var(--space-6);
    align-items: end;
    margin-bottom: var(--space-6);
  }

  .eyebrow,
  .lookup-form label span,
  .lookup-language {
    display: block;
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    margin-top: var(--space-1);
    font-size: var(--text-xl);
    font-weight: var(--font-medium);
    line-height: 1.1;
  }

  h2 {
    margin-top: var(--space-1);
    font-size: var(--text-lg);
    font-weight: var(--font-medium);
  }

  .lookup-form {
    display: grid;
    grid-template-columns: minmax(10rem, 1fr) minmax(12rem, 1fr) auto;
    gap: var(--space-3);
    align-items: end;
  }

  .lookup-form label {
    display: grid;
    gap: var(--space-1);
  }

  input,
  select {
    min-height: 2.5rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: var(--text-sm);
    padding: 0 var(--space-3);
  }

  .language-strip {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
    gap: var(--space-2);
    margin-bottom: var(--space-6);
  }

  .language-toggle {
    display: grid;
    gap: var(--space-1);
    min-height: 3rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    padding: var(--space-2) var(--space-3);
    text-align: left;
  }

  .language-toggle.active {
    background: var(--color-surface);
    color: var(--color-text);
    border-color: var(--color-border-strong);
  }

  .language-toggle.primary {
    border-color: var(--color-accent);
    box-shadow: inset 0 -3px 0 var(--color-accent);
  }

  .language-toggle small {
    color: var(--color-text-muted);
  }

  .lookup-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
    gap: var(--space-4);
  }

  .lookup-card {
    display: grid;
    gap: var(--space-4);
    align-content: start;
    min-height: 16rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    padding: var(--space-5);
  }

  .lookup-card.primary {
    border-color: var(--color-accent-soft);
  }

  .lookup-card-head {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    align-items: start;
  }

  .senses {
    display: grid;
    gap: var(--space-3);
  }

  .sense {
    display: grid;
    gap: var(--space-2);
  }

  .part-of-speech {
    width: fit-content;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    padding: 0.1rem var(--space-2);
    text-transform: uppercase;
  }

  .definitions {
    margin: 0;
    padding-left: var(--space-5);
  }

  .definitions li + li {
    margin-top: var(--space-2);
  }

  blockquote {
    margin: 0;
    border-left: 2px solid var(--color-border);
    color: var(--color-text-muted);
    padding-left: var(--space-3);
  }

  .example-separator {
    display: inline-block;
    margin: 0 var(--space-2);
  }

  .source-glosses {
    display: grid;
    gap: var(--space-1);
    border-top: 1px solid var(--color-border);
    color: var(--color-text-muted);
    padding-top: var(--space-3);
  }

  .source-glosses span {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .source-glosses p {
    font-size: var(--text-sm);
  }

  .sources {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-3);
  }

  .sources a,
  .lemma-button {
    color: var(--color-accent);
    font-size: var(--text-sm);
    text-decoration: none;
  }

  .lemma-button {
    width: fit-content;
    border: 0;
    background: transparent;
    padding: 0;
  }

  .muted,
  .empty {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .empty {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-8);
    text-align: center;
  }

  @media (max-width: 900px) {
    .dictionary {
      padding: var(--space-5);
    }

    .dictionary-header,
    .lookup-form {
      grid-template-columns: 1fr;
    }
  }
</style>
