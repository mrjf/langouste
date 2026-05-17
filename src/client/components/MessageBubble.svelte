<script lang="ts">
  import type { Message, Correction } from "../lib/stores.svelte";
  import { langTag } from "../lib/languages";
  import { md } from "../lib/md";
  import { api } from "../lib/api";
  import { playExclusive, stopCurrent, isCurrent } from "../lib/audio-player";

  interface Props {
    message: Message;
    sent: boolean;
    senderName?: string | null;
    viewerLangs?: string[];
    baseLangs?: string[];
    challenge?: string | null;
    conversationId?: string;
  }

  let {
    message,
    sent,
    senderName = null,
    viewerLangs = [],
    baseLangs = [],
    challenge = null,
    conversationId,
  }: Props = $props();

  // Lazy per-language audio cache: lang → { url, audio element, status }.
  // Only one bubble plays at a time across the whole app — see lib/audio-player.
  type AudioState = {
    url?: string;
    audio?: HTMLAudioElement;
    loading: boolean;
    error?: string;
    playing: boolean;
  };
  let audioByLang = $state<Record<string, AudioState>>({});

  function markStopped(lang: string) {
    const cur = audioByLang[lang];
    if (!cur) return;
    audioByLang = { ...audioByLang, [lang]: { ...cur, playing: false } };
  }

  async function playLang(lang: string) {
    if (!conversationId || !message.message_id) return;
    const cur = audioByLang[lang];
    if (cur?.loading) return;

    // Toggle off if this lang is already playing.
    if (cur?.playing && cur.audio && isCurrent(cur.audio)) {
      stopCurrent();
      return;
    }

    audioByLang = { ...audioByLang, [lang]: { ...cur, loading: true, error: undefined, playing: false } };
    try {
      let url = cur?.url;
      if (!url) {
        url = await api.fetchMessageAudio(conversationId, message.message_id, lang);
      }
      const audio = cur?.audio ?? new Audio(url);
      // Always start from the beginning when (re)triggered.
      audio.currentTime = 0;
      await playExclusive(audio, () => markStopped(lang));
      audioByLang = { ...audioByLang, [lang]: { url, audio, loading: false, playing: true } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      audioByLang = { ...audioByLang, [lang]: { ...cur, loading: false, playing: false, error: msg } };
    }
  }

  $effect(() => {
    return () => {
      // If this bubble's track is the active one, stop it.
      for (const v of Object.values(audioByLang)) {
        if (v.audio && isCurrent(v.audio)) {
          stopCurrent();
          break;
        }
      }
      for (const v of Object.values(audioByLang)) {
        if (v.url) URL.revokeObjectURL(v.url);
      }
    };
  });

  // Primary viewer language (first target language)
  const viewerLang = $derived(viewerLangs[0] ?? "");
  const baseLang = $derived(baseLangs[0] ?? "");

  // What's visible below the bubble
  let showBase = $state(false);
  let showOriginal = $state(false);
  let showCorrections = $state(false);
  let showChallenge = $state(false);
  let shownLangs = $state<Set<string>>(new Set());

  let hasTargetTranslation = $derived(
    !viewerLang || !!message.translations?.[viewerLang]
  );

  let displayText = $derived(
    viewerLang && message.translations?.[viewerLang]
      ? message.translations[viewerLang]
      : message.healed_text
  );

  let loading = $derived(viewerLang && !hasTargetTranslation && !message._pending);

  let baseText = $derived.by(() => {
    if (!baseLang || baseLang === viewerLang) return null;
    const t = message.translations?.[baseLang];
    if (!t || t === displayText) return null;
    return t;
  });

  let hasOriginal = $derived(message.raw_text !== message.healed_text);
  let hasCorrections = $derived(message.corrections?.length > 0);
  let hasChallenge = $derived(!!challenge);

  // Other languages available in translations (not viewer's target or base languages)
  let otherLangs = $derived.by(() => {
    if (!message.translations) return [];
    const exclude = new Set([...viewerLangs, ...baseLangs]);
    return Object.keys(message.translations).filter((l) => !exclude.has(l));
  });

  let time = $derived(
    new Date(message.created_at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })
  );

  function toggleLang(lang: string) {
    const next = new Set(shownLangs);
    if (next.has(lang)) next.delete(lang); else next.add(lang);
    shownLangs = next;
  }

  let hasDetails = $derived(
    showBase || showOriginal || showCorrections || showChallenge || shownLangs.size > 0
  );
</script>

<div class="message-bubble" class:sent class:received={!sent}>
  {#if !sent && senderName}
    <div class="sender-name">{senderName}</div>
  {/if}

  <div class="bubble" class:pending={message._pending} class:loading>
    {#if loading}
      <div class="loading-bar"></div>
      <div class="loading-bar short"></div>
    {:else}
      {#if viewerLang}
        <span class="target-badge">{langTag(viewerLang)}</span>
      {/if}
      <div class="healed-text">{@html md(displayText)}</div>
    {/if}
  </div>

  {#if !loading && !message._pending}
    <div class="actions">
      {#if conversationId && viewerLang && (message.translations?.[viewerLang] || !message.language || message.language === viewerLang)}
        <button
          class="action-btn speaker-btn"
          class:active={audioByLang[viewerLang]?.playing}
          class:loading={audioByLang[viewerLang]?.loading}
          aria-label="Play audio"
          title={audioByLang[viewerLang]?.error ?? "Play audio"}
          onclick={() => playLang(viewerLang)}
        >
          {audioByLang[viewerLang]?.loading ? "…" : audioByLang[viewerLang]?.playing ? "⏸" : "🔊"}
        </button>
      {/if}
      {#if baseText}
        <button class="action-btn" class:active={showBase} onclick={() => showBase = !showBase}>
          {langTag(baseLang)}
        </button>
      {/if}
      {#each otherLangs as lang}
        <button class="action-btn" class:active={shownLangs.has(lang)} onclick={() => toggleLang(lang)}>
          {langTag(lang)}
        </button>
      {/each}
      {#if hasOriginal}
        <button class="action-btn" class:active={showOriginal} onclick={() => showOriginal = !showOriginal}>
          original
        </button>
      {/if}
      {#if hasCorrections}
        <button class="action-btn corrections-btn" class:active={showCorrections} onclick={() => showCorrections = !showCorrections}>
          {message.corrections.length} correction{message.corrections.length > 1 ? "s" : ""}
        </button>
      {/if}
      {#if hasChallenge}
        <button class="action-btn challenge-btn" class:active={showChallenge} onclick={() => showChallenge = !showChallenge}>
          tip
        </button>
      {/if}
      <span class="timestamp">{time}</span>
    </div>

    {#if hasDetails}
      <div class="details">
        {#if showBase && baseText}
          <div class="detail-row base-row">
            <span class="detail-label">{langTag(baseLang)}</span>
            {#if conversationId}
              <button
                class="detail-speaker"
                class:active={audioByLang[baseLang]?.playing}
                class:loading={audioByLang[baseLang]?.loading}
                aria-label="Play audio"
                title={audioByLang[baseLang]?.error ?? "Play audio"}
                onclick={() => playLang(baseLang)}
              >
                {audioByLang[baseLang]?.loading ? "…" : audioByLang[baseLang]?.playing ? "⏸" : "🔊"}
              </button>
            {/if}
            <div class="detail-text">{@html md(baseText)}</div>
          </div>
        {/if}

        {#each otherLangs as lang}
          {#if shownLangs.has(lang) && message.translations?.[lang]}
            <div class="detail-row">
              <span class="detail-label">{langTag(lang)}</span>
              {#if conversationId}
                <button
                  class="detail-speaker"
                  class:active={audioByLang[lang]?.playing}
                  class:loading={audioByLang[lang]?.loading}
                  aria-label="Play audio"
                  title={audioByLang[lang]?.error ?? "Play audio"}
                  onclick={() => playLang(lang)}
                >
                  {audioByLang[lang]?.loading ? "…" : audioByLang[lang]?.playing ? "⏸" : "🔊"}
                </button>
              {/if}
              <div class="detail-text">{@html md(message.translations[lang])}</div>
            </div>
          {/if}
        {/each}

        {#if showOriginal && hasOriginal}
          <div class="detail-row original-row">
            <span class="detail-label">original</span>
            <div class="detail-text">{@html md(message.raw_text)}</div>
          </div>
        {/if}

        {#if showCorrections && hasCorrections}
          <div class="detail-row corrections-row">
            {#each message.corrections as c}
              <div class="correction-item">
                <span class="original-text">{c.original}</span>
                <span class="arrow">&rarr;</span>
                <span class="corrected-text">{c.corrected}</span>
                <span class="explanation">{c.explanation}</span>
              </div>
            {/each}
          </div>
        {/if}

        {#if showChallenge && challenge}
          <div class="detail-row challenge-row">
            <span class="detail-text">{challenge}</span>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .message-bubble {
    display: flex;
    flex-direction: column;
    max-width: 80%;
  }

  .sent {
    align-self: flex-end;
  }

  .received {
    align-self: flex-start;
  }

  .bubble {
    padding: 0.6rem 0.9rem;
    border-radius: var(--radius);
    line-height: 1.45;
    font-size: 0.95rem;
    position: relative;
    min-width: 120px;
  }

  .sent .bubble {
    background: var(--color-sent);
    border-bottom-right-radius: 4px;
  }

  .received .bubble {
    background: var(--color-received);
    border: 1px solid var(--color-border);
    border-bottom-left-radius: 4px;
  }

  .bubble.loading {
    min-height: 2.5rem;
  }

  .loading-bar {
    height: 0.7rem;
    border-radius: 4px;
    background: var(--color-border);
    animation: shimmer 1.5s ease-in-out infinite;
    margin-bottom: 0.4rem;
  }

  .loading-bar.short {
    width: 60%;
    margin-bottom: 0;
  }

  @keyframes shimmer {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.7; }
  }

  .sender-name {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-primary);
    margin-bottom: 0.15rem;
    padding: 0 0.25rem;
  }

  .pending {
    opacity: 0.6;
  }

  /* Action buttons row */
  .actions {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
    align-items: center;
    margin-top: 0.2rem;
    padding: 0 0.15rem;
  }

  .target-badge {
    float: right;
    font-size: 0.65rem;
    color: var(--color-text-light);
    opacity: 0.5;
    margin-left: 0.5rem;
    margin-top: -0.1rem;
    line-height: 1;
  }

  .action-btn {
    background: none;
    border: 1px solid transparent;
    color: var(--color-text-light);
    font-size: 0.7rem;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    opacity: 0.5;
    transition: opacity 0.15s, background 0.15s;
  }

  .action-btn:hover {
    opacity: 1;
    background: var(--color-bg);
  }

  .action-btn.active {
    opacity: 1;
    background: var(--color-bg);
    border-color: var(--color-border);
  }

  .corrections-btn {
    color: #f39c12;
  }

  .speaker-btn {
    font-size: 0.85rem;
    padding: 0.05rem 0.3rem;
    line-height: 1;
  }

  .speaker-btn.loading {
    opacity: 0.6;
    cursor: progress;
  }

  .detail-speaker {
    background: none;
    border: 1px solid transparent;
    border-radius: 3px;
    font-size: 0.85rem;
    line-height: 1;
    padding: 0.05rem 0.25rem;
    margin-right: 0.3rem;
    color: var(--color-text-light);
    opacity: 0.55;
    cursor: pointer;
    transition: opacity 0.15s, background 0.15s;
    vertical-align: middle;
  }

  .detail-speaker:hover {
    opacity: 1;
    background: var(--color-bg-alt, rgba(0,0,0,0.05));
  }

  .detail-speaker.active {
    opacity: 1;
    border-color: var(--color-border);
  }

  .detail-speaker.loading {
    opacity: 0.5;
    cursor: progress;
  }

  .challenge-btn {
    color: #1565c0;
  }

  .timestamp {
    font-size: 0.65rem;
    color: var(--color-text-light);
    margin-left: auto;
    opacity: 0.6;
  }

  /* Expandable detail panels */
  .details {
    margin-top: 0.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .detail-row {
    padding: 0.4rem 0.6rem;
    border-radius: var(--radius-sm);
    font-size: 0.82rem;
    line-height: 1.4;
    background: var(--color-bg);
    border-left: 2px solid var(--color-border);
  }

  .detail-label {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--color-text-light);
    text-transform: lowercase;
    display: block;
    margin-bottom: 0.1rem;
  }

  .detail-text {
    color: var(--color-text);
  }

  /* Compact markdown blocks inside message content. User-agent defaults on
     <p>/<ul>/<ol>/<h1-3>/<hr> add too much vertical margin for a chat bubble. */
  .healed-text :global(p),
  .detail-text :global(p) {
    margin: 0 0 0.35rem;
  }

  .healed-text :global(p:last-child),
  .detail-text :global(p:last-child) {
    margin-bottom: 0;
  }

  .healed-text :global(ul),
  .healed-text :global(ol),
  .detail-text :global(ul),
  .detail-text :global(ol) {
    margin: 0.25rem 0 0.35rem;
    padding-left: 1.2rem;
  }

  .healed-text :global(li),
  .detail-text :global(li) {
    margin: 0.1rem 0;
  }

  .healed-text :global(h1),
  .healed-text :global(h2),
  .healed-text :global(h3),
  .detail-text :global(h1),
  .detail-text :global(h2),
  .detail-text :global(h3) {
    margin: 0.5rem 0 0.25rem;
    font-size: 1em;
    font-weight: 700;
    line-height: 1.2;
  }

  .healed-text :global(h1:first-child),
  .healed-text :global(h2:first-child),
  .healed-text :global(h3:first-child),
  .detail-text :global(h1:first-child),
  .detail-text :global(h2:first-child),
  .detail-text :global(h3:first-child) {
    margin-top: 0;
  }

  .healed-text :global(hr),
  .detail-text :global(hr) {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: 0.5rem 0;
  }

  .healed-text :global(code),
  .detail-text :global(code) {
    font-family: var(--font-mono);
    font-size: 0.88em;
    background: rgba(0, 0, 0, 0.06);
    padding: 0.05em 0.3em;
    border-radius: 3px;
  }

  .healed-text :global(a),
  .detail-text :global(a) {
    color: var(--color-primary);
    text-decoration: underline;
  }

  .base-row {
    font-style: italic;
    color: var(--color-text-light);
  }

  .base-row .detail-text {
    color: var(--color-text-light);
  }

  .original-row {
    border-left-color: var(--color-text-light);
  }

  .original-row .detail-text {
    color: var(--color-text-light);
  }

  .corrections-row {
    border-left-color: #f39c12;
    background: var(--color-correction);
  }

  .correction-item {
    margin-bottom: 0.3rem;
  }

  .correction-item:last-child {
    margin-bottom: 0;
  }

  .original-text {
    text-decoration: line-through;
    color: var(--color-error);
  }

  .corrected-text {
    color: var(--color-success);
    font-weight: 500;
  }

  .arrow {
    color: var(--color-text-light);
    margin: 0 0.25rem;
    font-size: 0.75rem;
  }

  .explanation {
    display: block;
    color: var(--color-text-light);
    font-size: 0.78rem;
    margin-top: 0.1rem;
  }

  .challenge-row {
    border-left-color: #1565c0;
    background: var(--color-challenge);
    color: #1565c0;
  }

  .challenge-row .detail-text {
    color: #1565c0;
  }
</style>
