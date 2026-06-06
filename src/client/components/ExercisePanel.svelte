<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { api } from "../lib/api";
  import { LANGUAGES, langName, langTag } from "../lib/languages";
  import { profile } from "../lib/stores.svelte";
  import type {
    Exercise,
    ExerciseAttempt,
    ExerciseSessionResponse,
    ExerciseSubmissionResponse,
  } from "../lib/api-contracts";
  import Button from "./ui/Button.svelte";

  const languageCodes = Object.keys(LANGUAGES);

  let selectedLang = $state("");
  let session = $state<ExerciseSessionResponse | null>(null);
  let history = $state<ExerciseAttempt[]>([]);
  let answers = $state<Record<string, string>>({});
  let results = $state<Record<string, ExerciseSubmissionResponse>>({});
  let activeIndex = $state(0);
  let loading = $state(false);
  let submitting = $state<Record<string, boolean>>({});
  let advancingAttemptId = $state<string | null>(null);
  let audioState = $state<Record<string, "loading" | "playing" | "error">>({});
  let error = $state("");
  let advanceTimer: ReturnType<typeof setTimeout> | null = null;

  const languageOptions = $derived.by(() => {
    const learning = profile.value?.learning_languages ?? [];
    if (learning.length > 0) return learning.map((entry) => entry.lang);
    return languageCodes;
  });

  const answeredCount = $derived.by(
    () => session?.exercises.filter((exercise) => results[exercise.attemptId]).length ?? 0,
  );

  const activeExercise = $derived.by(() => session?.exercises[activeIndex] ?? null);
  const baseLangCode = $derived(profile.value?.base_language ?? "en");

  onMount(() => {
    selectedLang = profile.value?.learning_languages?.[0]?.lang ?? "hu";
    void load();
  });

  onDestroy(() => {
    clearAdvanceTimer();
  });

  async function load() {
    if (!selectedLang || loading) return;
    clearAdvanceTimer();
    loading = true;
    error = "";
    activeIndex = 0;
    advancingAttemptId = null;
    try {
      session = await api.getExerciseSession(selectedLang, 8);
      history = (await api.getExerciseHistory(selectedLang, 12)).attempts;
      answers = {};
      results = {};
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function submitAnswer(exercise: Exercise, answerOverride?: string) {
    const answer = (answerOverride ?? answers[exercise.attemptId] ?? "").trim();
    if (!answer || submitting[exercise.attemptId] || results[exercise.attemptId]) return;
    clearAdvanceTimer();
    answers = { ...answers, [exercise.attemptId]: answer };
    submitting = { ...submitting, [exercise.attemptId]: true };
    try {
      const result = await api.submitExerciseAttempt(exercise.attemptId, { answer });
      const nextResults = { ...results, [exercise.attemptId]: result };
      results = nextResults;
      history = (await api.getExerciseHistory(selectedLang, 12)).attempts;
      handleAnswerResult(exercise, result, nextResults);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      submitting = { ...submitting, [exercise.attemptId]: false };
    }
  }

  function handleAnswerResult(
    exercise: Exercise,
    result: ExerciseSubmissionResponse,
    resultSet: Record<string, ExerciseSubmissionResponse>,
  ) {
    advancingAttemptId = exercise.attemptId;
    if (result.outcome !== "correct") return;
    advanceTimer = setTimeout(() => {
      advanceToNext(exercise, resultSet);
    }, 950);
  }

  function advanceToNext(
    exercise: Exercise,
    resultSet: Record<string, ExerciseSubmissionResponse> = results,
  ) {
    clearAdvanceTimer();
    const nextIndex = nextUnansweredIndex(exercise.attemptId, resultSet);
    activeIndex = nextIndex >= 0 ? nextIndex : session?.exercises.length ?? 0;
    advancingAttemptId = null;
  }

  function nextUnansweredIndex(
    currentAttemptId: string,
    resultSet: Record<string, ExerciseSubmissionResponse>,
  ): number {
    const exercises = session?.exercises ?? [];
    const currentIndex = exercises.findIndex((exercise) => exercise.attemptId === currentAttemptId);
    if (currentIndex < 0) return -1;
    return exercises.findIndex(
      (exercise, index) => index > currentIndex && !resultSet[exercise.attemptId],
    );
  }

  function clearAdvanceTimer() {
    if (!advanceTimer) return;
    clearTimeout(advanceTimer);
    advanceTimer = null;
  }

  async function playAudio(key: string, text: string, language: string) {
    const cleaned = text.trim();
    if (!cleaned || audioState[key] === "loading") return;
    audioState = { ...audioState, [key]: "loading" };
    try {
      const result = await api.fetchWorkbenchAudio(cleaned, language);
      const audio = new Audio(result.url);
      audioState = { ...audioState, [key]: "playing" };
      audio.onended = () => {
        URL.revokeObjectURL(result.url);
        const next = { ...audioState };
        delete next[key];
        audioState = next;
      };
      audio.onerror = () => {
        URL.revokeObjectURL(result.url);
        audioState = { ...audioState, [key]: "error" };
      };
      await audio.play();
    } catch {
      try {
        await playBrowserSpeech(cleaned, language);
        const next = { ...audioState };
        delete next[key];
        audioState = next;
      } catch {
        audioState = { ...audioState, [key]: "error" };
      }
    }
  }

  function playBrowserSpeech(text: string, language: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        reject(new Error("Speech synthesis unavailable"));
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language;
      utterance.onend = () => resolve();
      utterance.onerror = () => reject(new Error("Speech synthesis failed"));
      window.speechSynthesis.speak(utterance);
    });
  }

  function labelForKind(kind: Exercise["kind"]): string {
    if (kind === "meaning_choice") return "Choose";
    if (kind === "reverse_translation_choice") return "Pick word";
    if (kind === "translation_recall" || kind === "vocabulary_recall") return "Recall";
    if (kind === "spelling_recall") return "Spell";
    if (kind === "grammar_concept_choice") return "Grammar";
    if (kind === "use_target_word") return "Use it";
    if (kind === "sentence_build") return "Build";
    if (kind === "guided_translation") return "Translate";
    if (kind === "sentence_transform") return "Transform";
    if (kind === "error_repair") return "Fix it";
    if (kind === "form_focus" || kind === "grammar_focus") return "Form";
    if (kind === "dialogue_reply") return "Reply";
    if (kind === "question_answer") return "Answer";
    if (kind === "micro_writing") return "Write";
    if (kind === "fluency_sprint") return "Sprint";
    if (kind === "vocabulary_cloze") return "Cloze";
    return "Level target";
  }

  function isChoice(exercise: Exercise): boolean {
    return exercise.payload.responseMode === "choice";
  }

  function isOpen(exercise: Exercise): boolean {
    return exercise.payload.responseMode === "open";
  }

  function targetAudioText(exercise: Exercise): string {
    const label = exercise.payload.label?.trim() ?? "";
    if (!label || exercise.itemType !== "vocabulary") return "";
    return exercise.prompt.includes(label) ? label : "";
  }

  function canSend(exercise: Exercise): boolean {
    return !!(answers[exercise.attemptId] ?? "").trim() && !results[exercise.attemptId];
  }

  function resultClass(result: ExerciseSubmissionResponse | undefined): string {
    if (!result) return "";
    if (result.outcome === "correct") return "correct";
    if (result.outcome === "partial") return "partial";
    return "incorrect";
  }

  function flashLabel(result: ExerciseSubmissionResponse): string {
    if (result.outcome === "correct") return "Correct";
    if (result.outcome === "partial") return "Close";
    return "Incorrect";
  }
</script>

<section class="exercise-panel">
  <header class="exercise-header">
    <div>
      <p class="eyebrow">Exercise generator</p>
      <h1>Practice from your progress</h1>
      <p class="lede">
        Exercises are mixed by type and aimed at your current level, with review items folded in
        when they fit the same band.
      </p>
    </div>
    <div class="controls">
      <label>
        Language
        <select bind:value={selectedLang} onchange={() => load()}>
          {#each languageOptions as code}
            <option value={code}>{langTag(code)} {langName(code)}</option>
          {/each}
        </select>
      </label>
      <Button label={loading ? "Loading…" : "New set"} variant="primary" disabled={loading} onclick={load} />
    </div>
  </header>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if session}
    <div class="summary-grid">
      <div><span>Level</span><strong>{session.cefrLevel ?? "—"}</strong></div>
      <div><span>Due words</span><strong>{session.summary.dueVocabulary}</strong></div>
      <div><span>Due grammar</span><strong>{session.summary.dueGrammar}</strong></div>
      <div><span>Done</span><strong>{answeredCount}/{session.exercises.length}</strong></div>
    </div>

    <div class="exercise-list">
      {#if activeExercise}
        {@const exercise = activeExercise}
        {@const result = results[exercise.attemptId]}
        {@const audioText = targetAudioText(exercise)}
        {@const targetInstructions = exercise.payload.targetInstructions}
        <article
          class={`exercise-card ${resultClass(result)} ${advancingAttemptId === exercise.attemptId ? "flashing" : ""}`}
        >
          <div class="exercise-meta">
            <span>{labelForKind(exercise.kind)}</span>
            <span>{exercise.reason}</span>
            {#if exercise.cefrLevel}
              <span>{exercise.cefrLevel}</span>
            {/if}
          </div>
          <div class="prompt-row">
            <h2>{exercise.prompt}</h2>
            {#if audioText}
              <button
                class="audio-button"
                type="button"
                aria-label="Play {audioText}"
                title="Play {audioText}"
                disabled={audioState[`${exercise.attemptId}:term`] === "loading"}
                onclick={() => playAudio(`${exercise.attemptId}:term`, audioText, exercise.language)}
              >
                {audioState[`${exercise.attemptId}:term`] === "loading" ? "..." : "▶"}
              </button>
            {/if}
          </div>
          <div class="instructions">
            <div class="instruction-row">
              <span>{langTag(baseLangCode)} {langName(baseLangCode)}</span>
              <p>{exercise.instructions}</p>
            </div>
            {#if targetInstructions}
              <div class="instruction-row target" lang={exercise.language}>
                <span>{langTag(exercise.language)} {langName(exercise.language)}</span>
                <p>{targetInstructions}</p>
                <button
                  class="audio-button small"
                  type="button"
                  aria-label="Play target-language instructions"
                  title="Play target-language instructions"
                  disabled={audioState[`${exercise.attemptId}:instructions`] === "loading"}
                  onclick={() =>
                    playAudio(`${exercise.attemptId}:instructions`, targetInstructions, exercise.language)}
                >
                  {audioState[`${exercise.attemptId}:instructions`] === "loading" ? "..." : "▶"}
                </button>
              </div>
            {/if}
          </div>

          {#if isOpen(exercise)}
            <textarea
              rows="3"
              bind:value={answers[exercise.attemptId]}
              placeholder="Type your answer…"
              disabled={!!result}
              onkeydown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submitAnswer(exercise);
              }}
            ></textarea>
          {:else if isChoice(exercise)}
            <div class="choice-grid">
              {#each exercise.payload.options ?? [] as option}
                <button
                  class:selected={answers[exercise.attemptId] === option}
                  class="choice-tile"
                  type="button"
                  disabled={!!result || submitting[exercise.attemptId]}
                  onclick={() => submitAnswer(exercise, option)}
                >
                  <span>{option}</span>
                </button>
              {/each}
            </div>
          {:else}
            <input
              bind:value={answers[exercise.attemptId]}
              placeholder="Type the answer…"
              disabled={!!result}
              onkeydown={(event) => {
                if (event.key === "Enter") submitAnswer(exercise);
              }}
            />
          {/if}

          <div class="actions">
            {#if !isChoice(exercise)}
              <button
                class="check-button"
                type="button"
                aria-label="Check answer"
                title="Check answer"
                disabled={!canSend(exercise) || submitting[exercise.attemptId]}
                onclick={() => submitAnswer(exercise)}
              >
                {submitting[exercise.attemptId] ? "..." : result ? "✓" : "✓"}
              </button>
            {/if}
            {#if result}
              <span class="feedback">{result.feedback}</span>
              {#if result.outcome !== "correct"}
                <button
                  class="next-button"
                  type="button"
                  onclick={() => advanceToNext(exercise)}
                >
                  Next
                </button>
              {/if}
            {/if}
          </div>
          {#if result && advancingAttemptId === exercise.attemptId}
            <div class={`answer-flash ${resultClass(result)}`} role="status" aria-live="polite">
              {flashLabel(result)}
            </div>
          {/if}
        </article>
      {:else}
        <div class="empty-card">
          <strong>Set complete</strong>
          <span>{answeredCount}/{session.exercises.length} answered</span>
        </div>
      {/if}
    </div>

    {#if history.length > 0}
      <section class="history-card">
        <div class="section-heading">
          <h2>Recent exercise memory</h2>
          <span>Generated and answered attempts are kept separate from review logs.</span>
        </div>
        <div class="history-list">
          {#each history as attempt}
            <div class="history-row">
              <span>{labelForKind(attempt.kind)}</span>
              <strong>{attempt.prompt}</strong>
              <small>{attempt.feedback ?? "pending"}</small>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  {:else if loading}
    <div class="empty-card">Generating exercises…</div>
  {:else}
    <div class="empty-card">No exercise data yet.</div>
  {/if}
</section>

<style>
  .exercise-panel {
    height: 100%;
    padding: var(--space-6);
    overflow-y: auto;
    background: var(--color-bg);
  }

  .exercise-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-5);
    margin-bottom: var(--space-5);
  }

  .eyebrow {
    margin: 0 0 var(--space-2);
    color: var(--color-accent);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    text-transform: uppercase;
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    font-size: clamp(2rem, 4vw, 3.5rem);
    letter-spacing: -0.05em;
  }

  h2 {
    font-size: var(--text-xl);
    letter-spacing: -0.03em;
  }

  .lede {
    max-width: 44rem;
    margin-top: var(--space-3);
    color: var(--color-text-muted);
    font-size: var(--text-md);
  }

  .controls {
    display: flex;
    align-items: end;
    gap: var(--space-3);
  }

  label {
    display: grid;
    gap: var(--space-2);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    text-transform: uppercase;
  }

  select,
  input,
  textarea {
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
  }

  select,
  input {
    min-height: 2.5rem;
    padding: 0 var(--space-3);
  }

  textarea {
    padding: var(--space-3);
    line-height: 1.45;
    resize: vertical;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-3);
    margin-bottom: var(--space-5);
  }

  .summary-grid > div,
  .exercise-card,
  .history-card,
  .empty-card,
  .error {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .summary-grid > div {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-4);
  }

  .summary-grid span,
  .section-heading span {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }

  .summary-grid strong {
    font-size: var(--text-xl);
    font-weight: var(--font-medium);
  }

  .exercise-list {
    display: grid;
    gap: var(--space-4);
    max-width: 60rem;
  }

  .exercise-card {
    position: relative;
    display: grid;
    gap: var(--space-4);
    padding: var(--space-5);
  }

  .exercise-card.correct {
    border-color: color-mix(in srgb, var(--color-success) 40%, var(--color-border));
  }

  .exercise-card.partial {
    border-color: color-mix(in srgb, var(--color-warning) 45%, var(--color-border));
  }

  .exercise-card.incorrect {
    border-color: color-mix(in srgb, var(--color-error) 35%, var(--color-border));
  }

  .exercise-card.flashing.correct {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-success) 35%, transparent);
  }

  .exercise-card.flashing.partial {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-warning) 40%, transparent);
  }

  .exercise-card.flashing.incorrect {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-error) 35%, transparent);
  }

  .exercise-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .exercise-meta span {
    border-radius: 999px;
    background: var(--color-bg);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    padding: 0.2rem 0.55rem;
  }

  .prompt-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--space-3);
  }

  .instructions {
    display: grid;
    gap: var(--space-2);
  }

  .instruction-row {
    display: grid;
    grid-template-columns: 8rem minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .instruction-row span {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    text-transform: uppercase;
  }

  .instruction-row.target p {
    color: var(--color-text);
  }

  .audio-button,
  .check-button {
    width: 2.25rem;
    min-width: 2.25rem;
    height: 2.25rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    color: var(--color-text);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .next-button {
    min-height: 2.25rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-text);
    color: var(--color-surface);
    cursor: pointer;
    font: inherit;
    font-size: var(--text-sm);
    padding: 0 var(--space-4);
  }

  .audio-button.small {
    width: 2rem;
    min-width: 2rem;
    height: 2rem;
    font-size: var(--text-caption);
  }

  .audio-button:hover:not(:disabled),
  .check-button:hover:not(:disabled),
  .choice-tile:hover:not(:disabled),
  .next-button:hover:not(:disabled) {
    border-color: var(--color-text);
    background: var(--color-text);
    color: var(--color-surface);
  }

  .audio-button:disabled,
  .check-button:disabled,
  .choice-tile:disabled,
  .next-button:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .choice-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
    max-width: 24rem;
  }

  .choice-tile {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    padding: var(--space-3);
    color: var(--color-text);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--text-sm);
    line-height: 1.3;
    text-align: center;
  }

  .choice-tile span {
    overflow-wrap: anywhere;
    hyphens: auto;
  }

  .choice-tile.selected {
    border-color: var(--color-accent);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .feedback {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .answer-flash {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 3rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    text-transform: uppercase;
    animation: answer-flash 950ms ease-out;
  }

  .answer-flash.correct {
    background: color-mix(in srgb, var(--color-success) 14%, var(--color-surface));
    color: var(--color-success);
  }

  .answer-flash.partial {
    background: color-mix(in srgb, var(--color-warning) 16%, var(--color-surface));
    color: var(--color-warning);
  }

  .answer-flash.incorrect {
    background: color-mix(in srgb, var(--color-error) 14%, var(--color-surface));
    color: var(--color-error);
  }

  .history-card,
  .empty-card,
  .error {
    margin-top: var(--space-5);
    padding: var(--space-5);
  }

  .empty-card {
    display: grid;
    gap: var(--space-2);
    color: var(--color-text-muted);
  }

  .empty-card strong {
    color: var(--color-text);
    font-size: var(--text-lg);
    font-weight: var(--font-medium);
  }

  .error {
    color: var(--color-error);
  }

  .section-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
  }

  .history-list {
    display: grid;
    gap: var(--space-2);
  }

  .history-row {
    display: grid;
    grid-template-columns: 7rem minmax(0, 1fr) minmax(12rem, 0.8fr);
    gap: var(--space-3);
    padding: var(--space-3) 0;
    border-top: 1px solid var(--color-border);
  }

  .history-row span,
  .history-row small {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }

  @media (max-width: 900px) {
    .exercise-header,
    .controls {
      display: grid;
    }

    .summary-grid,
    .history-row,
    .instruction-row,
    .prompt-row {
      grid-template-columns: 1fr;
    }
  }

  @keyframes answer-flash {
    0% {
      transform: scale(0.98);
      opacity: 0;
    }

    18%,
    72% {
      transform: scale(1);
      opacity: 1;
    }

    100% {
      transform: scale(1);
      opacity: 0.78;
    }
  }
</style>
