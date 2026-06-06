<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { profile } from "../lib/stores.svelte";
  import type {
    LanguageResource,
    LanguageResourceGroup,
    LanguageResourcesCatalog,
    ResourceReuseRights,
  } from "../lib/api-contracts";

  interface LanguageOption {
    code: string;
    name: string;
    resourceCount: number;
  }

  interface SelectedLanguage {
    code: string;
    language: LanguageResourceGroup;
  }

  let catalog = $state<LanguageResourcesCatalog | null>(null);
  let loading = $state(true);
  let error = $state("");
  let selectedLanguageCode = $state("");
  let query = $state("");
  let sourceFilter = $state("all");
  let rightsFilter = $state<"all" | ResourceReuseRights>("all");
  let resourceSort = $state<"title" | "source" | "rights">("title");

  const languageOptions = $derived.by<LanguageOption[]>(() => {
    if (!catalog) return [];
    return Object.entries(catalog.languages)
      .map(([code, language]) => ({
        code,
        name: language.name,
        resourceCount: language.resources.length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
  });

  const selectedLanguage = $derived.by<SelectedLanguage | null>(() => {
    if (!catalog || !selectedLanguageCode) return null;
    const language = catalog.languages[selectedLanguageCode];
    return language ? { code: selectedLanguageCode, language } : null;
  });

  const sourceOptions = $derived.by(() => {
    if (!selectedLanguage) return [];
    const ids = new Set<string>();
    for (const resource of selectedLanguage.language.resources) {
      ids.add(resource.source_id);
    }
    return [...ids].sort((a, b) => sourceTitle(a).localeCompare(sourceTitle(b)));
  });

  const rightsOptions = $derived.by<ResourceReuseRights[]>(() => {
    if (!selectedLanguage) return [];
    const ids = new Set<ResourceReuseRights>();
    for (const resource of selectedLanguage.language.resources) {
      ids.add(resource.reuse_rights);
    }
    return [...ids].sort((a, b) => rightsLabel(a).localeCompare(rightsLabel(b)));
  });

  const filteredResources = $derived.by<LanguageResource[]>(() => {
    if (!selectedLanguage) return [];
    const text = query.trim().toLocaleLowerCase();
    return selectedLanguage.language.resources
      .filter((resource) => matchesControls(resource))
      .filter((resource) => !text || matchesResourceText(resource, text))
      .sort(resourceSorter);
  });

  onMount(async () => {
    loading = true;
    error = "";
    try {
      const nextCatalog = await api.getLanguageResources();
      catalog = nextCatalog;
      selectedLanguageCode = defaultLanguageCode(nextCatalog);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  function selectLanguage(code: string): void {
    selectedLanguageCode = code;
    query = "";
    sourceFilter = "all";
    rightsFilter = "all";
  }

  function onLanguageChange(event: Event): void {
    const target = event.currentTarget as HTMLSelectElement | null;
    if (target) selectLanguage(target.value);
  }

  function matchesControls(resource: LanguageResource): boolean {
    if (sourceFilter !== "all" && resource.source_id !== sourceFilter) return false;
    if (rightsFilter !== "all" && resource.reuse_rights !== rightsFilter) return false;
    return true;
  }

  function matchesResourceText(resource: LanguageResource, text: string): boolean {
    return [
      resource.title,
      resource.source_id,
      resource.resource_type,
      resource.reuse_rights,
      resource.license_spdx ?? "",
      resource.formats.join(" "),
      resource.notes,
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(text);
  }

  function resourceSorter(a: LanguageResource, b: LanguageResource): number {
    if (resourceSort === "source") {
      return sourceTitle(a.source_id).localeCompare(sourceTitle(b.source_id)) || titleSort(a, b);
    }
    if (resourceSort === "rights") {
      return (
        rightsLabel(a.reuse_rights).localeCompare(rightsLabel(b.reuse_rights)) || titleSort(a, b)
      );
    }
    return titleSort(a, b);
  }

  function titleSort(a: LanguageResource, b: LanguageResource): number {
    return a.title.localeCompare(b.title) || a.source_id.localeCompare(b.source_id);
  }

  function defaultLanguageCode(nextCatalog: LanguageResourcesCatalog): string {
    const preferredCodes = [
      ...(profile.value?.learning_languages ?? []).map((language) => language.lang),
      "fr",
    ];
    for (const code of preferredCodes) {
      const match = findLanguageCode(nextCatalog, code);
      if (match) return match;
    }
    return (
      Object.entries(nextCatalog.languages).sort(
        ([codeA, languageA], [codeB, languageB]) =>
          languageA.name.localeCompare(languageB.name) || codeA.localeCompare(codeB),
      )[0]?.[0] ?? ""
    );
  }

  function findLanguageCode(nextCatalog: LanguageResourcesCatalog, code: string): string | null {
    return (
      Object.keys(nextCatalog.languages).find(
        (candidate) => candidate.toLocaleLowerCase() === code.toLocaleLowerCase(),
      ) ?? null
    );
  }

  function sourceTitle(sourceId: string): string {
    return catalog?.source_families[sourceId]?.title ?? formatLabel(sourceId);
  }

  function rightsLabel(value: ResourceReuseRights): string {
    if (value === "link_only") return "Link only";
    if (value === "reusable_noncommercial_sharealike") return "Reusable NC-SA";
    if (value === "reusable_sharealike") return "Reusable SA";
    if (value === "reusable_with_attribution_or_cc0_subset") return "Attribution / CC0";
    if (value === "reusable_public_domain_dedication") return "CC0";
    if (value === "public_domain") return "Public domain";
    if (value === "public_domain_or_reusable_sharealike") return "PD / Share-alike";
    return "Reusable";
  }

  function formatLabel(value: string): string {
    return value
      .replace(/[_-]/g, " ")
      .replace(/\b\w/g, (char) => char.toLocaleUpperCase());
  }
</script>

<section class="resources-panel">
  <header class="resources-header">
    <div>
      <p class="eyebrow">Resources</p>
      <h1>Human language learning materials</h1>
      {#if catalog}
        <p class="lede">
          {catalog.coverage_stats.language_code_count} language codes,
          {catalog.coverage_stats.source_family_count} source families,
          {catalog.coverage_stats.course_or_catalog_entries} resource entries.
        </p>
      {/if}
    </div>
    <div class="controls">
      <label class="language-control">
        Language
        <select value={selectedLanguageCode} onchange={onLanguageChange}>
          {#each languageOptions as option}
            <option value={option.code}>
              {option.name} ({option.code.toLocaleUpperCase()}) - {option.resourceCount} resources
            </option>
          {/each}
        </select>
      </label>
      <label>
        Search
        <input bind:value={query} placeholder="FSI, public domain, audio" />
      </label>
      <label>
        Source
        <select bind:value={sourceFilter}>
          <option value="all">All sources</option>
          {#each sourceOptions as sourceId}
            <option value={sourceId}>{sourceTitle(sourceId)}</option>
          {/each}
        </select>
      </label>
      <label>
        Rights
        <select bind:value={rightsFilter}>
          <option value="all">All rights</option>
          {#each rightsOptions as rights}
            <option value={rights}>{rightsLabel(rights)}</option>
          {/each}
        </select>
      </label>
      <label>
        Order
        <select bind:value={resourceSort}>
          <option value="title">Title</option>
          <option value="source">Source</option>
          <option value="rights">Rights</option>
        </select>
      </label>
    </div>
  </header>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if loading}
    <div class="empty-card">Loading resources...</div>
  {:else if catalog && selectedLanguage}
    <div class="summary-grid">
      <div>
        <span>Visible resources</span>
        <strong>{filteredResources.length}</strong>
      </div>
      <div>
        <span>Total resources</span>
        <strong>{selectedLanguage.language.resources.length}</strong>
      </div>
      <div>
        <span>Reusable</span>
        <strong>{selectedLanguage.language.reusable_resource_count}</strong>
      </div>
      <div>
        <span>Broad references</span>
        <strong>{selectedLanguage.language.default_reference_sources.length}</strong>
      </div>
    </div>

    {#if filteredResources.length === 0}
      <div class="empty-card">No resources match the current filters.</div>
    {:else}
      <div class="language-list">
        <article class="language-card">
          <div class="language-heading">
            <div class="language-title">
              <span>{selectedLanguage.code}</span>
              <div>
                <h2>{selectedLanguage.language.name}</h2>
                <p>{selectedLanguage.language.code_system}</p>
              </div>
            </div>
            <div class="language-counts">
              <span>{filteredResources.length} shown</span>
              <span>{selectedLanguage.language.reusable_resource_count} reusable</span>
              {#if selectedLanguage.language.link_only_resource_count > 0}
                <span>{selectedLanguage.language.link_only_resource_count} link-only</span>
              {/if}
            </div>
          </div>

          <div class="resource-list">
            {#each filteredResources as resource}
              <div class="resource-row">
                <div class="resource-main">
                  <h3>{resource.title}</h3>
                  <div class="resource-meta">
                    <span>{sourceTitle(resource.source_id)}</span>
                    <span>{formatLabel(resource.resource_type)}</span>
                    <span>{rightsLabel(resource.reuse_rights)}</span>
                    {#if resource.license_spdx}
                      <span>{resource.license_spdx}</span>
                    {/if}
                  </div>
                  <p>{resource.notes}</p>
                  {#if resource.formats.length > 0}
                    <div class="format-list">
                      {#each resource.formats as format}
                        <span>{format}</span>
                      {/each}
                    </div>
                  {/if}
                </div>
                <a class="open-link" href={resource.url} target="_blank" rel="noreferrer">
                  Open
                </a>
              </div>
            {/each}
          </div>

          {#if selectedLanguage.language.default_reference_sources.length > 0}
            <details class="reference-details">
              <summary>Broad references</summary>
              <div class="reference-list">
                {#each selectedLanguage.language.default_reference_sources as reference}
                  <a href={reference.lookup} target="_blank" rel="noreferrer">
                    <strong>{sourceTitle(reference.source_id)}</strong>
                    <span>{reference.notes}</span>
                  </a>
                {/each}
              </div>
            </details>
          {/if}
        </article>
      </div>
    {/if}
  {:else}
    <div class="empty-card">No language resources are available.</div>
  {/if}
</section>

<style>
  .resources-panel {
    height: 100%;
    overflow-y: auto;
    background: var(--color-bg);
    padding: var(--space-6);
  }

  .resources-header {
    display: grid;
    grid-template-columns: minmax(14rem, 1fr) minmax(18rem, 34rem);
    gap: var(--space-6);
    align-items: start;
    margin-bottom: var(--space-5);
  }

  .eyebrow {
    margin: 0 0 var(--space-2);
    color: var(--color-accent);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    color: var(--color-text);
    font-size: var(--text-xl);
    font-weight: var(--font-semibold);
    letter-spacing: 0;
  }

  .lede {
    max-width: 44rem;
    margin-top: var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--space-3);
  }

  .language-control {
    grid-column: 1 / -1;
  }

  label {
    display: grid;
    gap: var(--space-1);
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
  }

  input,
  select {
    min-width: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    color: var(--color-text);
    font-size: var(--text-sm);
    min-height: 2.5rem;
    padding: 0 var(--space-3);
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-3);
    margin-bottom: var(--space-5);
  }

  .summary-grid > div {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-panel);
    padding: var(--space-4);
  }

  .summary-grid span {
    display: block;
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }

  .summary-grid strong {
    display: block;
    margin-top: var(--space-2);
    color: var(--color-text);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
  }

  .language-list {
    display: grid;
    gap: var(--space-4);
  }

  .language-card,
  .empty-card,
  .error {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-panel);
  }

  .language-card {
    overflow: hidden;
  }

  .language-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4);
    border-bottom: 1px solid var(--color-border);
  }

  .language-title {
    display: grid;
    grid-template-columns: 3.5rem minmax(0, 1fr);
    gap: var(--space-3);
    min-width: 0;
  }

  .language-title > span {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: start;
    min-height: 2rem;
    border-radius: var(--radius-sm);
    background: var(--color-accent-wash);
    color: var(--color-accent-strong);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
  }

  h2,
  h3 {
    margin: 0;
    color: var(--color-text);
    font-weight: var(--font-semibold);
    letter-spacing: 0;
  }

  h2 {
    font-size: var(--text-lg);
  }

  h3 {
    font-size: var(--text-md);
  }

  .language-title p {
    margin-top: var(--space-1);
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }

  .language-counts,
  .resource-meta,
  .format-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .language-counts {
    justify-content: flex-end;
  }

  .language-counts span,
  .resource-meta span,
  .format-list span {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    font-size: var(--text-caption);
    line-height: 1;
    padding: 0.35rem 0.45rem;
  }

  .resource-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-4);
    padding: var(--space-4);
    border-bottom: 1px solid var(--color-border);
  }

  .resource-row:last-child {
    border-bottom: 0;
  }

  .resource-main {
    min-width: 0;
  }

  .resource-meta {
    margin-top: var(--space-2);
  }

  .resource-main p {
    margin-top: var(--space-3);
    max-width: 74rem;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .format-list {
    margin-top: var(--space-3);
  }

  .open-link {
    align-self: start;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    color: var(--color-text);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    min-width: 4.25rem;
    padding: 0.55rem 0.75rem;
    text-align: center;
    text-decoration: none;
  }

  .open-link:hover {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }

  .reference-details {
    border-top: 1px solid var(--color-border);
    padding: var(--space-4);
  }

  .reference-details summary {
    color: var(--color-text);
    cursor: pointer;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }

  .reference-list {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .reference-list a {
    display: grid;
    gap: var(--space-1);
    color: var(--color-text);
    font-size: var(--text-sm);
    text-decoration: none;
  }

  .reference-list span {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    line-height: 1.45;
  }

  .empty-card,
  .error {
    padding: var(--space-5);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .error {
    margin-bottom: var(--space-4);
    border-color: color-mix(in srgb, var(--color-error) 35%, var(--color-border));
    color: var(--color-error);
  }

  @media (max-width: 980px) {
    .resources-header {
      grid-template-columns: 1fr;
    }

    .summary-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 640px) {
    .resources-panel {
      padding: var(--space-4);
    }

    .controls,
    .summary-grid {
      grid-template-columns: 1fr;
    }

    .language-heading,
    .resource-row {
      grid-template-columns: 1fr;
      display: grid;
    }

    .language-counts {
      justify-content: flex-start;
    }

    .open-link {
      justify-self: start;
    }
  }
</style>
