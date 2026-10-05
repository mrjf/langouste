<script lang="ts">
  import { localCourseRequest } from "../lib/local-course";
  import CourseAudio from "./CourseAudio.svelte";
  import { onMount } from "svelte";
  import { apiRequest } from "../lib/api";
  import type { CourseAction, CourseActionResult, CourseLanguage, CourseProgress, CourseSentence, PublicCourseLesson } from "../../types/course";
  let { route = "", onRouteChange, guest = false, hosted = false, localOnly = false }: { route?: string; onRouteChange: (route: string) => void; guest?: boolean; hosted?: boolean; localOnly?: boolean } = $props();
  const courseRequest = <T,>(path:string, options?:RequestInit):Promise<T> => localOnly ? localCourseRequest<T>(path,options) : apiRequest<T>(path,options);
  type Summary = Pick<PublicCourseLesson, "id" | "courseId" | "day" | "language" | "title" | "subtitle" | "estimatedMinutes" | "objectives"> & { exerciseCount: number };
  let catalog = $state<Summary[]>([]);
  let allProgress = $state<CourseProgress[]>([]);
  let lesson = $state<PublicCourseLesson | null>(null);
  let progress = $state<CourseProgress | null>(null);
  let feedback = $state<Record<string, NonNullable<CourseActionResult["feedback"]>>>({});
  let error = $state("");
  let loading = $state(true);
  let busy = $state(false);
  let language = $derived<CourseLanguage>(route.split("/")[0] === "ar-EG" ? "ar-EG" : "hu");
  let selectedId = $derived(route.split("/")[1] ?? "");
  let lessons = $derived(catalog.filter(l => l.language === language).sort((a,b)=>a.day-b.day || a.id.localeCompare(b.id)));
  let showEnglish = $state(true);
  let showTransliteration = $state(true);
  let drafts = $state<Record<string, string>>({});
  let tokenSelections = $state<Record<string, number[]>>({});
  let matches = $state<Record<string, Record<string,string>>>({});
  let exerciseIndex = $state(0);
  let expandedWords = $state<string[]>([]);
  let expandedGrammar = $state<string[]>([]);
  let requestNumber = 0;
  const pendingAttempts = new Map<string, {answer:string; id:string}>();
  const steps = ["read", "words", "grammar", "practice"] as const;
  const stepLabels = { read: "Reading", words: "Vocabulary", grammar: "Grammar", practice: "Exercises" };
  let currentExercise = $derived(lesson?.exercises[exerciseIndex]);
  let attempts = $derived(Object.values(progress?.exercises ?? {}).flatMap(e => e.attempts));
  let scored = $derived(attempts.filter(a => a.scored));
  let answered = $derived(Object.values(progress?.exercises ?? {}).filter(e => e.attempts.length > 0).length);
  let completeCount = $derived(allProgress.filter(p => p.language === language && p.completed_at).length);
  let isArabic = $derived(language === "ar-EG");
  let canComplete = $derived(!!lesson && !!progress && progress.read_sections.length === lesson.readings.length && answered === lesson.exercises.length);
  function label(lang: CourseLanguage) { return lang === "hu" ? "Hungarian" : "Egyptian Arabic"; }
  onMount(async () => {
    try { const data = await courseRequest<{ lessons: Summary[]; progress: CourseProgress[] }>("/course"); catalog = data.lessons; allProgress = data.progress; }
    catch (e) { error = e instanceof Error ? e.message : "Could not load the course"; }
    finally { loading = false; }
  });
  $effect(() => {
    const id = selectedId;
    const number = ++requestNumber;
    lesson = null; progress = null; feedback = {}; drafts = {}; matches = {}; tokenSelections = {}; expandedWords = []; expandedGrammar = []; error = "";
    if (!id) return;
    loading = true;
    courseRequest<{ lesson: PublicCourseLesson; progress: CourseProgress; feedback: typeof feedback }>(`/course/${encodeURIComponent(id)}`).then(data => {
      if (number !== requestNumber) return;
      lesson = data.lesson; progress = data.progress; feedback = data.feedback;
      const next = data.lesson.exercises.findIndex(e => !data.progress.exercises[e.id]?.attempts.length);
      exerciseIndex = next < 0 ? 0 : next;
    }).catch(e => { if (number === requestNumber) error = e.message; }).finally(() => { if (number === requestNumber) loading = false; });
  });
  async function act(action: CourseAction) {
    if (!lesson || busy) return;
    if (guest) {
      if (action.type === "navigate" && progress) { progress = { ...progress, step: action.step }; return { progress }; }
      if (action.type === "encounter" && progress) return { progress };
      error = "Sign in above to save practice and receive feedback."; return;
    }
    const id = lesson.id;
    busy = true; error = "";
    try {
      const result = await courseRequest<CourseActionResult>(`/course/${encodeURIComponent(id)}/actions`, { method: "POST", body: JSON.stringify(action) });
      allProgress = [...allProgress.filter(p => p.lesson_id !== id), result.progress];
      if (lesson?.id !== id) return;
      progress = result.progress;
      if ("exerciseId" in action && result.feedback) feedback = { ...feedback, [action.exerciseId]: result.feedback };
      return result;
    } catch (e) { error = e instanceof Error ? e.message : "Progress was not saved. Please try again."; }
    finally { busy = false; }
  }
  async function inspect(type: "vocabulary" | "grammar", targetId: string) {
    const result = await act({ type: "encounter", itemType: type, targetId });
    if (!result) return;
    if (type === "vocabulary") expandedWords = [...expandedWords, targetId];
    else expandedGrammar = [...expandedGrammar, targetId];
  }
  function chooseToken(index: number) {
    if (!currentExercise) return;
    const id = currentExercise.id;
    tokenSelections = { ...tokenSelections, [id]: [...(tokenSelections[id] ?? []), index] };
    drafts = { ...drafts, [id]: tokenSelections[id].map(i => currentExercise!.choices![i]).join(" ") };
  }
  function attemptId(exerciseId:string, answer:string) { const previous=pendingAttempts.get(exerciseId); if(previous?.answer===answer)return previous.id; const id=crypto.randomUUID(); pendingAttempts.set(exerciseId,{answer,id});return id; }
  async function submit() {
    if (!currentExercise || !drafts[currentExercise.id]?.trim()) return;
    await act({ type: "answer", exerciseId: currentExercise.id, attemptId: attemptId(currentExercise.id, drafts[currentExercise.id]), answer: drafts[currentExercise.id], transliterationVisible: isArabic && showTransliteration });
  }
</script>

{#snippet sentence(item: CourseSentence)}
  <div class="sentence">
    <p class="target" lang={language} dir={isArabic ? "rtl" : "ltr"}>{item.text}</p><CourseAudio {language} text={item.text}/>
    {#if showTransliteration && item.transliteration}<p class="transliteration" dir="ltr">{item.transliteration}</p>{/if}
    {#if showEnglish}<p class="translation">{item.english}</p>{/if}
    <span class="sentence-kind">{item.kind === "teaching-example" ? "Practice example · invented" : "Adapted from source"}</span>
  </div>
{/snippet}

<div class="course-shell">
  <header class="course-topbar">
    <div class="language-switch" aria-label="Course language">
      {#each ["hu", "ar-EG"] as lang}
        <button class:chosen={language === lang} aria-pressed={language === lang} onclick={() => onRouteChange(lang)}>{label(lang as CourseLanguage)}</button>
      {/each}
    </div>
  </header>
  {#if error}<div role="alert" class="error">{error} <button onclick={() => location.reload()}>Reload</button></div>{/if}
  {#if loading}<p class="loading" role="status">Loading lessons…</p>
  {:else if !selectedId}
    <section class="index-heading"><div><h1>{label(language)}</h1><p>{completeCount} / {lessons.length} lessons completed · {lessons.reduce((n,l)=>n+l.exerciseCount,0)} exercises</p></div><button class="primary" disabled={!lessons.length} onclick={() => { const next = lessons.find(l => !allProgress.find(p => p.lesson_id === l.id)?.completed_at) ?? lessons[0]; if(next)onRouteChange(`${language}/${next.id}`); }}>Continue</button></section>
    {#if !lessons.length}<p class="empty">No lessons have been installed for this language yet. Your existing learning history is unchanged.</p>{/if}
    <div class="day-grid">
      {#each lessons as item}
        {@const state = allProgress.find(p => p.lesson_id === item.id)}
        <button class="day-card" class:finished={!!state?.completed_at} onclick={() => onRouteChange(`${language}/${item.id}`)}>
          <span class="day-number">{String(item.day).padStart(2,"0")}</span><h3>{item.title}</h3><span class="day-detail">{item.estimatedMinutes} min · {item.exerciseCount} exercises{#if state}<small>{state.completed_at ? "✓ Completed" : "In progress"}</small>{/if}</span>
        </button>
      {/each}
    </div>
  {:else if lesson && progress}
    {#if progress.sync_receipts?.some(r => r.status !== "confirmed")}<div class="error" role="status">Your course attempt is saved. A spaced-review update is unconfirmed after an interrupted write. It will not be retried automatically, to avoid duplicate credit.</div>{/if}<div class="lesson-heading"><button class="back" onclick={() => onRouteChange(language)}>← Lessons</button><div class="lesson-meta">DAY {String(lesson.day).padStart(2, "0")} · {label(language)} · {lesson.estimatedMinutes} MIN</div><h1>{lesson.title}</h1></div>
    <nav class="steps" aria-label="Lesson steps">{#each steps as step, index}<button aria-label={stepLabels[step]} aria-current={progress.step === step ? "step" : undefined} class:active={progress.step === step} disabled={busy} onclick={() => act({ type: "navigate", step })}><span>0{index + 1}</span>{stepLabels[step]}</button>{/each}</nav>
    <div class="lesson-layout"><main class="lesson-content">
      <div class="display-controls"><label><input type="checkbox" bind:checked={showEnglish} /> English support</label>{#if isArabic}<label><input type="checkbox" bind:checked={showTransliteration} /> Transliteration</label>{/if}<span>{busy ? "Saving…" : guest ? "Reading as guest · sign in to save" : progress.updated_at ? localOnly ? "Saved in this browser" : "Progress saved" : "Not attempted yet"}</span></div>
      {#if progress.step === "read"}
        {#if lesson.instructionBlocks?.length}<section class="teaching-note"><p class="eyebrow">BEFORE YOU BEGIN</p>{#each lesson.instructionBlocks as block}<h3>{block.title}</h3><p>{block.body}</p>{#each block.examples ?? [] as example}{@render sentence(example)}{/each}{/each}</section>{/if}
        {#if lesson.route?.length}<ol class="learning-route">{#each lesson.route as instruction}<li>{instruction}</li>{/each}</ol>{/if}
        {#each lesson.readings as reading, i}<article class="reading"><p class="eyebrow">READING {i + 1}</p><h2>{reading.title}</h2>{#if reading.instruction}<p class="section-intro">{reading.instruction}</p>{/if}{#each reading.sentences as item}{@render sentence(item)}{/each}{#if reading.recognitionOnly?.length}<details class="recognition-support"><summary>Reading support · recognize, no memorization required</summary>{#each reading.recognitionOnly as item}{@render sentence(item)}{/each}</details>{/if}<button class="secondary" disabled={busy || progress.read_sections.includes(reading.id)} onclick={() => act({ type: "read", sectionId: reading.id, englishVisible: showEnglish, transliterationVisible: isArabic && showTransliteration })}>{progress.read_sections.includes(reading.id) ? "✓ Reading acknowledged" : "I’ve read this section"}</button></article>{/each}
        {#if lesson.optionalDialogue?.length}<details class="dialogue"><summary>Try the conversation</summary><p>An invented dialogue for practice.</p>{#each lesson.optionalDialogue as line}{@render sentence(line)}{/each}</details>{/if}
        <button class="primary" disabled={busy} onclick={() => act({ type: "navigate", step: "words" })}>Explore the vocabulary →</button>
      {:else if progress.step === "words"}
        <h2>Vocabulary</h2><p class="section-intro">Try to remember the meaning, then open a card. Opening it records an encounter, not a correct answer.</p><div class="vocab-grid">{#each lesson.vocabulary as word}<article class="vocab-card"><span class="eyebrow">{word.recognitionOnly ? "RECOGNITION ONLY" : word.plannedRole?.includes("review") ? "REVIEW WORD" : "FOCUS WORD"}</span><h3 lang={language} dir={isArabic ? "rtl" : "ltr"}>{word.term}</h3><CourseAudio {language} text={word.term} context={word.semanticConcept??""}/>{#if word.transliteration && showTransliteration}<p class="transliteration">{word.transliteration}</p>{/if}{#if expandedWords.includes(word.id)}<p class="meaning">{word.english}</p>{@render sentence(word.example)}{#if !hosted}<a href={`#/dictionary/${encodeURIComponent(language)}/${encodeURIComponent(word.term)}`}>Open in dictionary ↗</a>{/if}{:else}<button class="secondary" disabled={busy} onclick={() => inspect("vocabulary", word.id)}>Reveal meaning</button>{/if}</article>{/each}</div><button class="primary" disabled={busy} onclick={() => act({ type: "navigate", step: "grammar" })}>Find the pattern →</button>
      {:else if progress.step === "grammar"}
        <h2>A pattern you can use</h2><p class="section-intro">Notice what changes. Keep the explanation open while you practise the examples.</p>{#each lesson.concepts as concept}<article class="grammar-card"><h3>{concept.title}</h3>{#if expandedGrammar.includes(concept.id)}<p>{concept.explanation}</p>{#each concept.examples as example}{@render sentence(example)}{/each}{:else}<button class="secondary" disabled={busy} onclick={() => inspect("grammar", concept.id)}>Explore this pattern</button>{/if}</article>{/each}<button class="primary" disabled={busy} onclick={() => act({ type: "navigate", step: "practice" })}>Put it into practice →</button>
      {:else if currentExercise}
        <div class="practice-heading"><p class="eyebrow">QUESTION {exerciseIndex + 1} / {lesson.exercises.length}</p><span>{answered} attempted</span></div><div class="progress-track"><div style={`width:${100 * answered / lesson.exercises.length}%`}></div></div>
        <section class="quiz" aria-label="Practice question"><span class="quiz-kind">{currentExercise.type === "choice" ? "Choose an answer" : currentExercise.type === "order" ? "Build the sentence" : currentExercise.type === "matching" ? "Match each pair" : currentExercise.type === "self-check" ? "Write and compare · self-check" : "Recall from memory"}</span><h2>{currentExercise.prompt}</h2>
          {#if currentExercise.promptAtom}<div class="sentence"><p class="target" dir={isArabic ? "rtl" : "ltr"}>{currentExercise.promptAtom.text}</p><CourseAudio {language} text={currentExercise.promptAtom.text}/>{#if showTransliteration && currentExercise.promptAtom.transliteration}<p class="transliteration">{currentExercise.promptAtom.transliteration}</p>{/if}{#if feedback[currentExercise.id]?.promptEnglish}<p class="translation">{feedback[currentExercise.id].promptEnglish}</p>{/if}</div>{/if}
          {#each currentExercise.supportAtoms ?? [] as support}<div class="teaching-note"><p>Supplied support · assisted production</p>{@render sentence(support)}</div>{/each}
          {#if currentExercise.type === "matching"}<div class="matching-pairs">{#each currentExercise.matchingPairs ?? [] as pair}<label class="matching-row"><span><b dir="auto">{pair.text}</b><CourseAudio {language} text={pair.text}/>{#if progress.exercises[currentExercise.id]?.attempts.at(-1)?.pairResults}{@const pairResult = progress.exercises[currentExercise.id].attempts.at(-1)?.pairResults?.find(p => p.id === pair.id)}<small>{pairResult?.correct ? "✓ Matched" : "Try this pair again"}</small>{/if}{#if showTransliteration && pair.transliteration}<small class="transliteration">{pair.transliteration}</small>{/if}</span><select aria-label={`Meaning for ${pair.text}`} value={matches[currentExercise.id]?.[pair.id] ?? ""} disabled={busy} onchange={event => { const id=currentExercise!.id; matches={...matches,[id]:{...matches[id],[pair.id]:event.currentTarget.value}}; drafts={...drafts,[id]:Object.keys(matches[id]).length===currentExercise!.matchingPairs!.length && Object.values(matches[id]).every(Boolean) ? JSON.stringify(matches[id]) : ""}; }}><option value="">Choose a meaning</option>{#each currentExercise.choices ?? [] as meaning}<option value={meaning}>{meaning}</option>{/each}</select></label>{/each}</div>
          {:else if currentExercise.type === "choice"}<div class="choices">{#each currentExercise.choices ?? [] as choice, index}<button class:selected={drafts[currentExercise.id] === choice} aria-pressed={drafts[currentExercise.id] === choice} disabled={busy} onclick={() => drafts = { ...drafts, [currentExercise.id]: choice }}><span class="option-index">{String.fromCharCode(65 + index)}</span><span><b dir="auto">{choice}</b>{#if currentExercise.choiceSupport?.[choice]?.transliteration && showTransliteration}<small>{currentExercise.choiceSupport[choice].transliteration}</small>{/if}{#if (feedback[currentExercise.id]?.choiceSupport ?? currentExercise.choiceSupport)?.[choice]?.english}<small>{(feedback[currentExercise.id]?.choiceSupport ?? currentExercise.choiceSupport)?.[choice]?.english}</small>{/if}</span></button>{#if currentExercise.choiceSupport?.[choice]}<CourseAudio {language} text={choice}/>{/if}{/each}</div>
          {:else if currentExercise.type === "order"}<div class="answer-built" dir={isArabic ? "rtl" : "ltr"}>{drafts[currentExercise.id] || "Select the words below"}</div><div class="tokens">{#each currentExercise.choices ?? [] as token, i}<button disabled={busy || tokenSelections[currentExercise.id]?.includes(i)} onclick={() => chooseToken(i)}>{token}{#if showTransliteration && currentExercise.choiceSupport?.[token]?.transliteration}<small>{currentExercise.choiceSupport[token].transliteration}</small>{/if}</button><CourseAudio {language} text={token}/>{/each}</div><button class="text-button" onclick={() => { tokenSelections = { ...tokenSelections, [currentExercise!.id]: [] }; drafts = { ...drafts, [currentExercise!.id]: "" }; }}>Clear sentence</button>
          {:else if currentExercise.type === "self-check"}<label class="answer-label" for="self-check-answer">Your response</label><textarea id="self-check-answer" class="answer-input" rows="4" dir="auto" value={drafts[currentExercise.id] ?? ""} oninput={event => drafts = { ...drafts, [currentExercise!.id]: event.currentTarget.value }} placeholder="Write your response, then compare it with the model and rubric."></textarea>
          {:else}<label class="answer-label" for="recall-answer">Your answer</label><input id="recall-answer" class="answer-input" dir="auto" autocomplete="off" value={drafts[currentExercise.id] ?? ""} oninput={event => drafts = { ...drafts, [currentExercise!.id]: event.currentTarget.value }} onkeydown={event => { if (event.key === "Enter") void submit(); }} placeholder={isArabic ? "Type Arabic (or transliteration when requested)" : "Type your answer…"} />{/if}
          <div class="quiz-actions"><button class="primary" disabled={busy || !drafts[currentExercise.id]?.trim()} onclick={submit}>{progress.exercises[currentExercise.id]?.attempts.length ? "Check practice answer" : "Check answer"}</button><button class="text-button" disabled={busy} onclick={() => act({ type: "hint", exerciseId: currentExercise!.id })}>Give me a hint</button><button class="text-button" disabled={busy} onclick={() => act({ type: "reveal", exerciseId: currentExercise!.id })}>Show answer</button></div>
          {#if feedback[currentExercise.id]}{@const result = feedback[currentExercise.id]}<div class="feedback" class:correct={result.correct === true} role="status"><strong>{result.correct == null ? "Learning support" : result.correct ? "That’s right." : "Not quite. Let’s look at it."}</strong>{#if result.answerAtoms?.length}{#each result.answerAtoms as atom}{@render sentence(atom)}{/each}{:else if result.answer}<p class="feedback-answer" dir="auto">{result.answer}</p>{#if language==="hu"||/[\u0600-\u06ff]/u.test(result.answer)}<CourseAudio {language} text={result.answer}/>{/if}{/if}<p>{result.text}</p>{#if result.rubricText}<p class="rubric">{result.rubricText}</p>{/if}
          {#if currentExercise.type === "self-check" && progress.exercises[currentExercise.id]?.attempts.length}<div class="self-assessment"><p>After comparing, how did your response meet the rubric?</p>{#each [["again","Needs another try"],["close","Partly meets it"],["met","Meets the rubric"]] as option}<button class="secondary" disabled={busy} aria-pressed={progress.exercises[currentExercise.id].attempts.at(-1)?.selfAssessment === option[0]} onclick={() => act({type:"self-assess",exerciseId:currentExercise!.id,assessment:option[0] as "again"|"close"|"met"})}>{option[1]}</button>{/each}<small>Self-reported reflection, not independently verified recall.</small></div>{/if}{#if result.scored !== undefined}<small>{result.scored ? localOnly ? "First independent attempt saved in this browser only." : "First independent attempt recorded in your spaced-review profile." : "Recognition or supported practice recorded; no independent recall credit."}</small>{:else}<small>Using support makes this a practice attempt, not independent recall.</small>{/if}</div>{/if}
          <div class="question-nav"><button class="secondary" disabled={exerciseIndex === 0 || busy} onclick={() => exerciseIndex--}>← Previous</button><button class="secondary" disabled={exerciseIndex === lesson.exercises.length - 1 || busy} onclick={() => exerciseIndex++}>Next question →</button></div>
        </section>
        {#if lesson.review}<section class="teaching-note"><h3>Keep it with you</h3><p>{lesson.review.instructions}</p><ul>{#each lesson.review.prompts as prompt}<li>{prompt}</li>{/each}</ul></section>{/if}
        <section class="completion"><h3>{progress.completed_at ? "Lesson completed. Keep practising." : "Lesson progress"}</h3><p>{scored.filter(a => a.correct).length} correct of {scored.length} independent attempts · {attempts.length - scored.length} recognition / supported practice attempts.</p><p>Completion records participation, not mastery. {localOnly ? "These records stay in this browser; they do not sync to an account or its spaced-review profile." : "Your independent answers update the same spaced-review profile used throughout Langouste."}</p><button class="primary" disabled={busy || !canComplete || !!progress.completed_at} onclick={() => act({ type: "complete" })}>{progress.completed_at ? "✓ Completed" : "Complete lesson"}</button>{#if !canComplete}<small>Acknowledge every reading and attempt every question first.</small>{/if}{#if !hosted}<a href={`#/profile/${language}`}>See your learning evidence ↗</a>{/if}</section>
      {/if}
    </main><aside class="lesson-aside"><section><p class="eyebrow">Objectives</p><ul>{#each lesson.objectives as objective}<li>{objective}</li>{/each}</ul></section><section><p class="eyebrow">Sources</p>{#each lesson.sources as source}<details class="source"><summary>{source.title}</summary><p>{source.publisher} · {source.publishedOn ?? "Undated reference"}</p><p>{source.factSummary}</p><a href={source.url} target="_blank" rel="noreferrer">Read original source ↗</a></details>{/each}<p class="aside-note">Source summaries describe reported news. Dialogues and practice examples are invented for learning.</p></section></aside></div>
  {/if}
</div>

<style>
.course-shell{height:100%;overflow:auto;background:#fff;padding:0 20px 20px;color:#252922;font-size:14px;line-height:1.45}
.course-topbar{display:flex;align-items:center;padding:8px 0;border-bottom:1px solid #d6d9d2}
.language-switch{display:flex;gap:4px}.language-switch button{padding:6px 12px;background:white;border:1px solid #c1c9bd;border-radius:3px;color:#345341;font-size:13px}.language-switch button.chosen{background:#244a40;color:white}
.index-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0}.index-heading h1{font-size:22px;font-weight:600;margin:0}.index-heading p{font-size:12px;color:#61685d;margin:3px 0 0}
.day-grid{display:block;border-top:1px solid #d6d9d2}.day-card{width:100%;display:grid;grid-template-columns:32px minmax(0,1fr) 160px;gap:10px;align-items:center;padding:8px 6px;text-align:left;border:0;border-bottom:1px solid #e0e3dd;background:white;color:inherit}.day-card:hover{background:#f3f5ef}.day-card.finished{background:#f1f6ed}.day-number{font-size:12px;color:#67725f;font-variant-numeric:tabular-nums}.day-card h3{font-size:14px;line-height:1.35;font-weight:500;margin:0}.day-detail{text-align:right;font-size:11px;color:#61685d}.day-detail small{display:block;font-size:11px;color:#315945}
.primary,.secondary{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid #a9b8a2;border-radius:3px;padding:6px 10px;font-size:13px;line-height:1.4}.primary{background:#244a40;color:white;border-color:#244a40}.secondary{background:#fff;color:#35543f}.primary:disabled,.secondary:disabled{opacity:.5;cursor:default}.back,.text-button{background:none;border:0;color:#315945;text-decoration:underline;font-size:12px;padding:3px 0}
.loading,.empty{padding:12px 0;color:#61685d}.error{background:#fff0eb;border:1px solid #dcaa96;padding:8px;margin:8px 0;font-size:13px}.error button{margin-left:8px}
.lesson-heading{padding:8px 0}.lesson-meta{font-size:11px;color:#67725f;margin:4px 0}.lesson-heading h1{font-size:23px;line-height:1.25;font-weight:600;margin:4px 0}.steps{display:flex;gap:4px;border-top:1px solid #d6d9d2;border-bottom:1px solid #d6d9d2}.steps button{flex:1;background:white;border:0;padding:8px 6px;color:#53614b;font-size:13px;text-align:left}.steps span{font-size:10px;margin-right:5px;color:#798273}.steps .active{box-shadow:inset 0 -2px #244a40;color:#244a40;font-weight:600}
.lesson-layout{display:grid;grid-template-columns:minmax(0,1fr) 210px;gap:20px}.lesson-content{min-width:0}.display-controls{display:flex;flex-wrap:wrap;gap:12px;padding:8px 0;font-size:11px;color:#61685d}.display-controls label{display:flex;align-items:center;gap:5px}.display-controls>span{margin-left:auto}
.reading,.teaching-note,.grammar-card,.quiz,.dialogue{padding:10px 0;margin-bottom:12px;border-bottom:1px solid #d9dfd4;background:#fff}.reading h2,.lesson-content>h2{font-size:18px;font-weight:600;margin:0 0 6px}.sentence{padding:7px 0;border-bottom:1px solid #eef0eb;line-height:1.5}.sentence:last-of-type{margin-bottom:8px}.target{font-size:18px;font-weight:500}.target[dir="rtl"]{font-size:22px;line-height:1.65;font-family:Tahoma,"Noto Sans Arabic",sans-serif}.transliteration{font-family:var(--font-mono);font-size:12px;line-height:1.5;direction:ltr;color:#4d6655;margin-top:2px}.translation{font-size:13px;color:#5e6658;margin-top:2px}.sentence-kind{display:block;font-size:9px;color:#727d68;margin-top:2px}
.eyebrow{font-size:11px;font-weight:600;color:#58654f;margin:0 0 6px}.lesson-aside{padding:10px 0}.lesson-aside section{padding-bottom:10px;margin-bottom:10px;border-bottom:1px solid #d6d9d2}.lesson-aside ul{padding-left:16px;font-size:12px;line-height:1.45;color:#58654f}.lesson-aside li+li{margin-top:4px}.source{padding:5px 0;font-size:12px;line-height:1.45}.source summary{cursor:pointer;font-weight:500}.source p,.source a{display:block;margin-top:5px}.source a{color:#315945}.aside-note{font-size:10px;line-height:1.5;color:#66705d;margin-top:7px}
.teaching-note h3,.grammar-card h3{font-size:16px;font-weight:600;margin:5px 0}.teaching-note p,.grammar-card>p{font-size:14px;line-height:1.5;white-space:pre-line}.teaching-note ul{padding-left:18px;font-size:13px;line-height:1.5;margin-top:5px}.learning-route{padding:4px 0 8px 18px;font-size:12px;line-height:1.5}.dialogue summary{cursor:pointer;font-weight:600}.dialogue>p{font-size:12px;color:#61685d;margin-top:5px}.section-intro{font-size:13px;line-height:1.5;color:#61685d;margin-bottom:8px}.vocab-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 18px;margin-bottom:12px}.vocab-card{padding:10px 0;border-bottom:1px solid #d9dfd4}.vocab-card h3{font-size:20px;font-weight:500;overflow-wrap:anywhere}.vocab-card .secondary{margin-top:6px}.meaning{font-size:14px;margin-top:5px}.vocab-card a{font-size:11px;color:#315945}
.practice-heading{display:flex;justify-content:space-between;font-size:11px;color:#61685d;margin-top:3px}.progress-track{height:3px;background:#e0e4d7;margin:4px 0 8px}.progress-track>div{height:100%;background:#315945}.quiz-kind{font-size:11px;color:#58654f}.quiz h2{font-size:19px;font-weight:600;line-height:1.35;margin:5px 0 10px;white-space:pre-line}.choices{display:grid;gap:5px}.choices button{display:flex;align-items:center;gap:10px;padding:8px 10px;background:#fff;border:1px solid #cbd3c4;border-radius:3px;text-align:left;color:#30382a}.choices button.selected{border-color:#315945;background:#eff4e8}.choices b{font-size:16px;font-weight:400}.choices small,.tokens small{display:block;font-size:11px;color:#586d4d;margin-top:3px}.option-index{font-size:11px;color:#748566}.quiz-actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:10px}.answer-label{display:block;font-size:12px;margin-bottom:4px}.answer-input{width:100%;padding:8px;border:1px solid #abbc9f;border-radius:3px;font-size:18px;background:white}.answer-built{min-height:44px;padding:8px;border:1px dashed #a9ba9c;font-size:18px}.tokens{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0}.tokens button{padding:6px 9px;border:1px solid #b9c7ad;border-radius:3px;background:white;font-size:16px}.tokens button:disabled{opacity:.3}
.feedback{padding:10px;margin-top:10px;background:#fff6e8;border-left:3px solid #c79d65;line-height:1.5}.feedback.correct{background:#eff5e9;border-left-color:#5b8650}.feedback>p{font-size:13px;margin-top:5px}.feedback .feedback-answer{font-size:19px}.feedback small{display:block;font-size:11px;margin-top:6px;color:#58654f}.feedback-answer,.rubric{white-space:pre-line}.question-nav{display:flex;justify-content:space-between;gap:8px;margin-top:10px}.completion{border-top:1px solid #d5ddcc;padding:10px 0;display:flex;align-items:start;flex-direction:column;gap:6px}.completion h3{font-size:17px;font-weight:600}.completion p{font-size:12px;line-height:1.5;color:#61685d}.completion small,.completion a{font-size:11px;color:#61685d}
.matching-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0;align-items:center}.matching-row select{max-width:100%;padding:7px;border:1px solid #abbc9f;background:white;border-radius:3px}.matching-row b{font-size:18px}.self-assessment{margin:10px 0;display:flex;flex-wrap:wrap;gap:6px}.self-assessment p{width:100%}.self-assessment [aria-pressed="true"]{background:#dfead3}.recognition-support{margin:8px 0;font-size:12px}.recognition-support summary{cursor:pointer}button:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid #315945;outline-offset:2px}
@media(max-width:850px){.lesson-layout{grid-template-columns:minmax(0,1fr)}.lesson-aside{display:grid;grid-template-columns:1fr 1fr;gap:12px}.course-shell{padding:0 12px 16px}}
@media(max-width:500px){.course-shell{padding:0 10px 12px}.day-card{grid-template-columns:22px minmax(0,1fr) 85px;gap:6px;padding:7px 2px}.day-detail{font-size:10px}.day-card h3{font-size:13px}.index-heading h1{font-size:20px}.lesson-heading h1{font-size:21px}.steps button{font-size:12px;padding:8px 3px}.steps span{display:none}.vocab-grid,.lesson-aside{grid-template-columns:1fr}.display-controls{gap:8px}.display-controls>span{margin-left:0}.target[dir="rtl"]{font-size:21px}}
</style>
