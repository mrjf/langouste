import { createHash } from "node:crypto";
import type { Database } from "../../lib/db/index.ts";
import { languageName } from "../../lib/languages.ts";
import type { CefrLevel, LanguageCode, VocabularyItem } from "../../types/index.ts";
import { getDueGrammarGaps } from "../database/grammar-gaps.ts";
import { getDueVocabulary } from "../database/vocabulary.ts";
import {
  recordInteraction,
  type EventType,
  type Outcome,
} from "../spaced-repetition/interactions.ts";

export type ExerciseKind =
  | "meaning_choice"
  | "reverse_translation_choice"
  | "translation_recall"
  | "spelling_recall"
  | "grammar_concept_choice"
  | "use_target_word"
  | "sentence_build"
  | "guided_translation"
  | "sentence_transform"
  | "error_repair"
  | "form_focus"
  | "dialogue_reply"
  | "question_answer"
  | "micro_writing"
  | "fluency_sprint"
  // Legacy rows may still exist in exercise_attempts history.
  | "vocabulary_recall"
  | "vocabulary_cloze"
  | "grammar_focus"
  | "level_target";

export type ExerciseItemType = "vocabulary" | "grammar";
export type ExerciseResponseMode = "exact" | "choice" | "open";
export type ExerciseFamily =
  | "recognition"
  | "controlled_recall"
  | "morphology"
  | "syntax"
  | "cloze"
  | "matching"
  | "sorting"
  | "transformation"
  | "dialogue"
  | "production";
export type ExerciseTaskType =
  | "choice"
  | "typed_recall"
  | "completion"
  | "classification"
  | "ordering"
  | "short_production";
export type ExerciseSkill = "reading" | "writing" | "listening" | "speaking_adjacent";
export type LinguisticDimension =
  | "phonology"
  | "orthography"
  | "morphology"
  | "syntax"
  | "lexis"
  | "pragmatics"
  | "discourse";
export type ExerciseScoringPolicy =
  | "option_id"
  | "normalized_exact"
  | "accent_lenient"
  | "per_blank"
  | "token_order"
  | "record_only";

export interface ExerciseDifficulty {
  cefrLevel: CefrLevel | null;
  cefrRange: { min: CefrLevel; max: CefrLevel };
  score: number;
  factors: string[];
}

export interface ExerciseSessionOptions {
  targetLexemes?: string[];
  targetConceptIds?: string[];
  targetGrammarTags?: string[];
  exerciseKinds?: ExerciseKind[];
  deterministicOnly?: boolean;
}

export interface Exercise {
  attemptId: string;
  exerciseId: string;
  kind: ExerciseKind;
  itemType: ExerciseItemType;
  itemId: string | null;
  conceptId: string | null;
  language: LanguageCode;
  cefrLevel: CefrLevel | null;
  prompt: string;
  instructions: string;
  expected: string | null;
  reason: string;
  payload: ExercisePayload;
}

export interface ExerciseSession {
  language: LanguageCode;
  cefrLevel: CefrLevel | null;
  generatedAt: string;
  exercises: Exercise[];
  summary: {
    pending: number;
    new: number;
    dueVocabulary: number;
    dueGrammar: number;
    levelTargets: number;
  };
}

export interface ExerciseSubmissionResult {
  attempt: ExerciseAttempt;
  feedback: string;
  correct: boolean;
  outcome: Outcome;
  quality: number;
  expected: string | null;
}

export interface ExerciseAttempt extends Exercise {
  answer: string | null;
  correct: boolean | null;
  quality: number | null;
  feedback: string | null;
  createdAt: string;
  answeredAt: string | null;
}

export interface ExercisePayload {
  kind: ExerciseKind;
  itemType: ExerciseItemType;
  responseMode: ExerciseResponseMode;
  eventType: EventType;
  lookupKey: string;
  label: string;
  expected: string | null;
  alternatives: string[];
  options?: string[];
  targetInstructions?: string;
  translation?: string;
  contextSentence?: string;
  description?: string;
  conceptId?: string;
  cefrLevel?: CefrLevel | null;
  templateId?: string;
  family?: ExerciseFamily;
  taskType?: ExerciseTaskType;
  skill?: ExerciseSkill;
  dimensions?: LinguisticDimension[];
  grammarTags?: string[];
  lexicalItemIds?: string[];
  typologyFeatures?: string[];
  scoringPolicy?: ExerciseScoringPolicy;
  difficulty?: ExerciseDifficulty;
  reason: string;
}

interface ExerciseGrade {
  correct: boolean;
  outcome: Outcome;
  quality: number;
  feedback: string;
}

interface ExerciseAttemptRow {
  attempt_id: string;
  user_id: string;
  language: string;
  exercise_id: string;
  item_type: ExerciseItemType;
  item_id: string | null;
  concept_id: string | null;
  kind: ExerciseKind;
  prompt: string;
  instructions: string;
  expected: string | null;
  answer: string | null;
  correct: number | boolean | null;
  quality: number | null;
  feedback: string | null;
  payload: ExercisePayload;
  created_at: string;
  answered_at: string | null;
}

interface Candidate {
  kind: ExerciseKind;
  itemType: ExerciseItemType;
  itemId: string | null;
  conceptId: string | null;
  language: LanguageCode;
  cefrLevel: CefrLevel | null;
  prompt: string;
  instructions: string;
  expected: string | null;
  reason: string;
  priority: number;
  payload: ExercisePayload;
}

interface ProfileRow {
  learning_languages?: Array<{ lang: string; cefr_level?: CefrLevel | string | null }>;
}

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const PENDING_REUSE_MS = 24 * 60 * 60 * 1000;

interface LevelTranslationBlueprint {
  key: string;
  label: string;
  source: string;
  expected: Record<string, string[]>;
  priority: number;
}

interface ExerciseTemplateDefinition {
  kind: ExerciseKind;
  family: ExerciseFamily;
  taskType: ExerciseTaskType;
  skill: ExerciseSkill;
  dimensions: LinguisticDimension[];
  grammarTags: string[];
  typologyFeatures: string[];
  scoringPolicy: ExerciseScoringPolicy;
  cefrRange: { min: CefrLevel; max: CefrLevel };
}

interface NormalizedExerciseSessionOptions {
  targetLexemes: Set<string>;
  targetConceptIds: Set<string>;
  targetGrammarTags: Set<string>;
  exerciseKinds: Set<ExerciseKind>;
  deterministicOnly: boolean;
}

const TEMPLATE_BANK = {
  "lexis.meaning-choice": {
    kind: "meaning_choice",
    family: "recognition",
    taskType: "choice",
    skill: "reading",
    dimensions: ["lexis"],
    grammarTags: [],
    typologyFeatures: ["lexis.translation", "semantics.gloss"],
    scoringPolicy: "option_id",
    cefrRange: { min: "A1", max: "C2" },
  },
  "lexis.reverse-translation-choice": {
    kind: "reverse_translation_choice",
    family: "recognition",
    taskType: "choice",
    skill: "reading",
    dimensions: ["lexis"],
    grammarTags: [],
    typologyFeatures: ["lexis.translation", "controlled_recall.recognition"],
    scoringPolicy: "option_id",
    cefrRange: { min: "A1", max: "C2" },
  },
  "lexis.translation-recall": {
    kind: "translation_recall",
    family: "controlled_recall",
    taskType: "typed_recall",
    skill: "writing",
    dimensions: ["lexis", "orthography"],
    grammarTags: [],
    typologyFeatures: ["lexis.translation", "orthography.spelling"],
    scoringPolicy: "accent_lenient",
    cefrRange: { min: "A1", max: "C2" },
  },
  "orthography.spelling-recall": {
    kind: "spelling_recall",
    family: "controlled_recall",
    taskType: "typed_recall",
    skill: "writing",
    dimensions: ["orthography", "lexis"],
    grammarTags: ["spelling:word_form", "spelling:diacritics"],
    typologyFeatures: ["orthography.spelling", "orthography.diacritics"],
    scoringPolicy: "accent_lenient",
    cefrRange: { min: "A1", max: "C2" },
  },
  "grammar.category-choice": {
    kind: "grammar_concept_choice",
    family: "recognition",
    taskType: "classification",
    skill: "reading",
    dimensions: ["morphology", "syntax", "orthography", "pragmatics", "discourse"],
    grammarTags: [],
    typologyFeatures: ["grammar.category", "typology.feature_mapping"],
    scoringPolicy: "option_id",
    cefrRange: { min: "A1", max: "C2" },
  },
  "production.use-target-word": {
    kind: "use_target_word",
    family: "production",
    taskType: "short_production",
    skill: "writing",
    dimensions: ["lexis", "syntax"],
    grammarTags: [],
    typologyFeatures: ["lexis.active_use"],
    scoringPolicy: "record_only",
    cefrRange: { min: "A1", max: "C2" },
  },
  "grammar.error-repair": {
    kind: "error_repair",
    family: "production",
    taskType: "short_production",
    skill: "writing",
    dimensions: ["morphology", "syntax", "orthography", "pragmatics", "discourse"],
    grammarTags: [],
    typologyFeatures: ["grammar.gap_repair"],
    scoringPolicy: "record_only",
    cefrRange: { min: "A1", max: "C2" },
  },
  "grammar.form-focus": {
    kind: "form_focus",
    family: "production",
    taskType: "short_production",
    skill: "writing",
    dimensions: ["morphology", "syntax", "orthography", "pragmatics", "discourse"],
    grammarTags: [],
    typologyFeatures: ["grammar.focused_production"],
    scoringPolicy: "record_only",
    cefrRange: { min: "A1", max: "C2" },
  },
  "catalog.guided-translation": {
    kind: "guided_translation",
    family: "controlled_recall",
    taskType: "typed_recall",
    skill: "writing",
    dimensions: ["lexis", "morphology", "syntax"],
    grammarTags: [],
    typologyFeatures: ["translation.controlled", "syntax.surface_realization"],
    scoringPolicy: "normalized_exact",
    cefrRange: { min: "A1", max: "C2" },
  },
} satisfies Record<string, ExerciseTemplateDefinition>;

type TemplateId = keyof typeof TEMPLATE_BANK;

const EXERCISE_KINDS = new Set<ExerciseKind>([
  "meaning_choice",
  "reverse_translation_choice",
  "translation_recall",
  "spelling_recall",
  "grammar_concept_choice",
  "use_target_word",
  "sentence_build",
  "guided_translation",
  "sentence_transform",
  "error_repair",
  "form_focus",
  "dialogue_reply",
  "question_answer",
  "micro_writing",
  "fluency_sprint",
  "vocabulary_recall",
  "vocabulary_cloze",
  "grammar_focus",
  "level_target",
]);

const CEFR_TRANSLATION_BLUEPRINTS: Record<CefrLevel, LevelTranslationBlueprint[]> = {
  A1: [
    {
      key: "study-every-day",
      label: "Basic daily routine",
      source: "I study every day.",
      expected: { hu: ["Minden nap tanulok."] },
      priority: 58,
    },
    {
      key: "student-self",
      label: "Basic identity statement",
      source: "I am a student.",
      expected: { hu: ["Diák vagyok.", "Tanuló vagyok."] },
      priority: 57,
    },
    {
      key: "like-bread",
      label: "Simple preference",
      source: "I like bread.",
      expected: { hu: ["Szeretem a kenyeret."] },
      priority: 56,
    },
    {
      key: "good-morning",
      label: "Common greeting",
      source: "Good morning.",
      expected: { hu: ["Jó reggelt."] },
      priority: 55,
    },
  ],
  A2: [
    {
      key: "meet-friend-tomorrow",
      label: "Near-future plan",
      source: "Tomorrow I am meeting a friend.",
      expected: { hu: ["Holnap találkozom egy barátommal."] },
      priority: 62,
    },
    {
      key: "buy-bread",
      label: "Transactional request",
      source: "I would like to buy bread.",
      expected: { hu: ["Szeretnék kenyeret venni."] },
      priority: 61,
    },
    {
      key: "no-time-today",
      label: "Negation in context",
      source: "I do not have time today.",
      expected: { hu: ["Ma nincs időm."] },
      priority: 60,
    },
    {
      key: "meet-at-six",
      label: "Meeting arrangement",
      source: "We are meeting at six.",
      expected: { hu: ["Hatkor találkozunk."] },
      priority: 59,
    },
  ],
  B1: [
    {
      key: "late-traffic",
      label: "Cause and effect",
      source: "I was late because there was traffic.",
      expected: { hu: ["Elkéstem, mert dugó volt.", "Késtem, mert dugó volt."] },
      priority: 66,
    },
    {
      key: "useful-app",
      label: "Contrast in a past event",
      source: "I found a useful app, but it was difficult at first.",
      expected: { hu: ["Találtam egy hasznos alkalmazást, de eleinte nehéz volt."] },
      priority: 65,
    },
    {
      key: "friend-advice",
      label: "Practical advice",
      source: "You should rest before the exam.",
      expected: { hu: ["Pihenned kellene a vizsga előtt."] },
      priority: 64,
    },
  ],
  B2: [
    {
      key: "benefits-risks",
      label: "Counterargument",
      source: "I understand the concern, but the benefits are greater than the risks.",
      expected: {
        hu: ["Értem az aggodalmat, de az előnyök nagyobbak, mint a kockázatok."],
      },
      priority: 70,
    },
    {
      key: "reschedule-appointment",
      label: "Formal request",
      source: "Could we reschedule the appointment?",
      expected: { hu: ["Át tudnánk tenni az időpontot?"] },
      priority: 69,
    },
    {
      key: "depends-on-context",
      label: "Qualified opinion",
      source: "It depends on the context.",
      expected: { hu: ["Ez a kontextustól függ.", "A kontextustól függ."] },
      priority: 68,
    },
  ],
  C1: [
    {
      key: "principle-practice",
      label: "Concession",
      source: "The policy is useful in principle, although it may fail in practice.",
      expected: {
        hu: ["Az irányelv elvben hasznos, bár a gyakorlatban kudarcot vallhat."],
      },
      priority: 74,
    },
    {
      key: "clear-responsibility",
      label: "Precision",
      source: "We need to make responsibility clearer.",
      expected: { hu: ["Világosabbá kell tennünk a felelősséget."] },
      priority: 73,
    },
    {
      key: "careful-limitation",
      label: "Careful limitation",
      source: "The conclusion is plausible, but not certain.",
      expected: { hu: ["A következtetés valószínű, de nem biztos."] },
      priority: 72,
    },
  ],
  C2: [
    {
      key: "elegance-durability",
      label: "Abstract contrast",
      source: "The proposal is elegant, but elegance alone does not make it durable.",
      expected: {
        hu: ["A javaslat elegáns, de az elegancia önmagában nem teszi tartóssá."],
      },
      priority: 78,
    },
    {
      key: "faster-not-always-better",
      label: "Nuanced critique",
      source: "Faster is not always better.",
      expected: { hu: ["A gyorsabb nem mindig jobb."] },
      priority: 77,
    },
    {
      key: "understated-style",
      label: "Controlled style",
      source: "The result is impressive without being surprising.",
      expected: { hu: ["Az eredmény lenyűgöző anélkül, hogy meglepő lenne."] },
      priority: 76,
    },
  ],
};

const CEFR_ORDER: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export async function getExerciseSession(
  db: Database,
  userId: string,
  language: LanguageCode,
  limitInput = DEFAULT_LIMIT,
  optionsInput: ExerciseSessionOptions = {},
): Promise<ExerciseSession> {
  const limit = clampLimit(limitInput);
  const options = normalizeSessionOptions(optionsInput);
  const cefrLevel = await learnerCefrLevel(db, userId, language);
  const recent = await recentAttempts(db, userId, language, 120);
  const now = new Date();
  const pending = recent
    .filter((attempt) => !attempt.answeredAt)
    .filter(isReusablePendingAttempt)
    .filter((attempt) => now.getTime() - Date.parse(attempt.createdAt) < PENDING_REUSE_MS)
    .slice(0, limit);
  if (pending.length >= limit) {
    return sessionResponse(language, cefrLevel, pending, {
      pending: pending.length,
      new: 0,
      dueVocabulary: 0,
      dueGrammar: 0,
      levelTargets: 0,
    });
  }

  const [dueVocabulary, dueGrammar, vocabulary] = await Promise.all([
    getDueVocabulary(db, userId, language, limit * 2),
    getDueGrammarGaps(db, userId, language, limit * 2),
    db.select<VocabularyItem>("vocabulary", {
      filters: [
        { op: "eq", column: "user_id", value: userId },
        { op: "eq", column: "language", value: language },
      ],
      limit: 500,
    }),
  ]);

  const recentExerciseIds = new Set(recent.map((attempt) => attempt.exerciseId));
  const candidates = buildCandidates({
    language,
    cefrLevel,
    dueVocabulary,
    vocabulary,
    recentExerciseIds,
    options,
  });
  const needed = Math.max(0, limit - pending.length);
  const created = await insertAttempts(
    db,
    userId,
    candidates.slice(0, needed),
    new Date().toISOString(),
  );

  return sessionResponse(language, cefrLevel, [...pending, ...created], {
    pending: pending.length,
    new: created.length,
    dueVocabulary: dueVocabulary.length,
    dueGrammar: dueGrammar.length,
    levelTargets: candidates.filter((candidate) => isCefrCatalogCandidate(candidate)).length,
  });
}

export async function submitExerciseAttempt(
  db: Database,
  userId: string,
  attemptId: string,
  answerInput: unknown,
): Promise<ExerciseSubmissionResult> {
  const answer = typeof answerInput === "string" ? answerInput.trim() : "";
  const row = await db.selectOne<ExerciseAttemptRow>("exercise_attempts", {
    filters: [
      { op: "eq", column: "attempt_id", value: attemptId },
      { op: "eq", column: "user_id", value: userId },
    ],
  });
  if (!row) throw new Error("Exercise attempt not found");

  const existing = attemptFromRow(row);
  if (existing.answeredAt) {
    const resubmissionGrade = gradeAnswer(existing, answer);
    const answerChanged =
      !!answer && normalizeAnswer(answer) !== normalizeAnswer(existing.answer ?? "");
    if (answerChanged && existing.correct !== true && resubmissionGrade.correct) {
      const corrected = await persistExerciseGrade(db, userId, existing, answer, resubmissionGrade);
      return resultFromAttempt(corrected);
    }
    return resultFromAttempt(existing);
  }

  const grade = gradeAnswer(existing, answer);
  const updated = await persistExerciseGrade(db, userId, existing, answer, grade);
  return resultFromAttempt(updated);
}

async function persistExerciseGrade(
  db: Database,
  userId: string,
  existing: ExerciseAttempt,
  answer: string,
  grade: ExerciseGrade,
): Promise<ExerciseAttempt> {
  const answeredAt = new Date().toISOString();
  await db.update(
    "exercise_attempts",
    {
      answer,
      correct: grade.correct,
      quality: grade.quality,
      feedback: grade.feedback,
      answered_at: answeredAt,
    },
    [{ op: "eq", column: "attempt_id", value: existing.attemptId }],
  );

  const eventType = existing.payload.eventType ?? defaultEventTypeFor(existing);
  await recordInteraction(db, {
    userId,
    language: existing.language,
    itemType: existing.itemType,
    itemId: existing.itemId ?? undefined,
    lookupKey: existing.itemId ? undefined : existing.payload.lookupKey,
    seed: {
      translation: existing.payload.translation,
      context_sentence: existing.payload.contextSentence,
      cefr_level: existing.payload.cefrLevel ?? undefined,
      description: existing.payload.description ?? existing.payload.label,
      concept_id: existing.conceptId ?? existing.payload.conceptId,
    },
    eventType,
    quality: eventType === "recall" ? grade.quality : undefined,
    outcome: grade.outcome,
    source: "exercise",
    evidence: {
      original: existing.prompt,
      corrected: answer,
      commentary: grade.feedback,
    },
  });

  return {
    ...existing,
    answer,
    correct: grade.correct,
    quality: grade.quality,
    feedback: grade.feedback,
    answeredAt,
  };
}

function resultFromAttempt(attempt: ExerciseAttempt): ExerciseSubmissionResult {
  return {
    attempt,
    feedback: attempt.feedback ?? "",
    correct: attempt.correct === true,
    outcome: outcomeFromQuality(attempt.quality ?? 0),
    quality: attempt.quality ?? 0,
    expected: attempt.expected,
  };
}

export async function getExerciseHistory(
  db: Database,
  userId: string,
  language: LanguageCode,
  limitInput = 20,
): Promise<ExerciseAttempt[]> {
  return (await recentAttempts(db, userId, language, clampLimit(limitInput) * 3))
    .filter(isDisplayableHistoryAttempt)
    .slice(0, clampLimit(limitInput));
}

function buildCandidates(input: {
  language: LanguageCode;
  cefrLevel: CefrLevel | null;
  dueVocabulary: VocabularyItem[];
  vocabulary: VocabularyItem[];
  recentExerciseIds: Set<string>;
  options: NormalizedExerciseSessionOptions;
}): Candidate[] {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: Candidate) => {
    if (!candidateMatchesOptions(candidate, input.options)) return;
    const exerciseId = exerciseIdFor(candidate);
    if (seen.has(exerciseId) || input.recentExerciseIds.has(exerciseId)) return;
    seen.add(exerciseId);
    candidates.push(candidate);
  };

  const targetLevel = input.cefrLevel ?? "A1";
  const targetLanguage = languageName(input.language);
  const dueVocabIds = new Set(input.dueVocabulary.map((item) => item.vocab_id));
  const vocabularyPool = uniqueVocabulary([...input.dueVocabulary, ...input.vocabulary])
    .filter((item) => vocabularyMatchesOptions(item, input.options))
    .filter((item) => isVocabularyUsableAtLevel(item, targetLevel))
    .sort(
      (left, right) =>
        vocabularyPriority(right, targetLevel, dueVocabIds) -
        vocabularyPriority(left, targetLevel, dueVocabIds),
    );

  for (const item of vocabularyPool) {
    const basePriority = vocabularyPriority(item, targetLevel, dueVocabIds);
    const reason = dueVocabIds.has(item.vocab_id)
      ? "Due CEFR-matched vocabulary"
      : "CEFR-matched vocabulary practice";
    const choice = meaningChoiceCandidate(
      input.language,
      targetLanguage,
      item,
      vocabularyPool,
      reason,
      basePriority + 10,
    );
    if (choice) add(choice);
    if (primaryTranslation(item)) {
      add(
        translationRecallCandidate(input.language, targetLanguage, item, reason, basePriority + 9),
      );
      const reverse = reverseTranslationChoiceCandidate(
        input.language,
        targetLanguage,
        item,
        vocabularyPool,
        reason,
        basePriority + 8,
      );
      if (reverse) add(reverse);
      add(spellingRecallCandidate(input.language, targetLanguage, item, reason, basePriority + 7));
    }
  }

  for (const blueprint of CEFR_TRANSLATION_BLUEPRINTS[targetLevel]) {
    const candidate = catalogTranslationCandidate(
      input.language,
      targetLanguage,
      targetLevel,
      blueprint,
    );
    if (candidate) add(candidate);
  }

  return sortAndDiversifyCandidates(candidates);
}

function meaningChoiceCandidate(
  language: LanguageCode,
  targetLanguage: string,
  item: VocabularyItem,
  vocabulary: VocabularyItem[],
  reason: string,
  priority: number,
): Candidate | null {
  const expected = primaryTranslation(item);
  if (!expected) return null;
  const options = stableOptions(
    [
      expected,
      ...vocabulary
        .filter((candidate) => candidate.vocab_id !== item.vocab_id)
        .map(primaryTranslation)
        .filter(
          (candidate) => candidate && normalizeAnswer(candidate) !== normalizeAnswer(expected),
        ),
    ],
    item.vocab_id,
    4,
  );
  if (options.length < 2) return null;

  return {
    kind: "meaning_choice",
    itemType: "vocabulary",
    itemId: item.vocab_id,
    conceptId: item.concept_id,
    language,
    cefrLevel: item.cefr_level,
    prompt: `Choose the translation of this ${targetLanguage} word or phrase: ${item.term}`,
    instructions: "Choose the closest translation.",
    expected,
    reason,
    priority,
    payload: {
      kind: "meaning_choice",
      itemType: "vocabulary",
      responseMode: "choice",
      eventType: "recall",
      lookupKey: item.term,
      label: item.term,
      expected,
      alternatives: translationAlternatives(item.translation),
      options,
      targetInstructions: targetInstructionFor("meaning_choice", language),
      translation: item.translation,
      conceptId: item.concept_id ?? undefined,
      cefrLevel: item.cefr_level,
      ...templateMetadata("lexis.meaning-choice", {
        cefrLevel: item.cefr_level,
        lexicalItemIds: [item.vocab_id],
        factors: ["recognition", "translation distractors", ...levelFactors(item.cefr_level)],
      }),
      reason,
    },
  };
}

function reverseTranslationChoiceCandidate(
  language: LanguageCode,
  targetLanguage: string,
  item: VocabularyItem,
  vocabulary: VocabularyItem[],
  reason: string,
  priority: number,
): Candidate | null {
  const translation = primaryTranslation(item);
  if (!translation) return null;
  const options = stableOptions(
    [
      item.term,
      ...vocabulary
        .filter((candidate) => candidate.vocab_id !== item.vocab_id)
        .map((candidate) => candidate.term)
        .filter(
          (candidate) => candidate && normalizeAnswer(candidate) !== normalizeAnswer(item.term),
        ),
    ],
    `${item.vocab_id}:reverse`,
    4,
  );
  if (options.length < 2) return null;

  return {
    kind: "reverse_translation_choice",
    itemType: "vocabulary",
    itemId: item.vocab_id,
    conceptId: item.concept_id,
    language,
    cefrLevel: item.cefr_level,
    prompt: `Which ${targetLanguage} word or phrase means: ${translation}`,
    instructions: "Choose the target-language item.",
    expected: item.term,
    reason,
    priority,
    payload: {
      kind: "reverse_translation_choice",
      itemType: "vocabulary",
      responseMode: "choice",
      eventType: "recall",
      lookupKey: item.term,
      label: item.term,
      expected: item.term,
      alternatives: [item.term],
      options,
      targetInstructions: targetInstructionFor("reverse_translation_choice", language),
      translation: item.translation,
      conceptId: item.concept_id ?? undefined,
      cefrLevel: item.cefr_level,
      ...templateMetadata("lexis.reverse-translation-choice", {
        cefrLevel: item.cefr_level,
        lexicalItemIds: [item.vocab_id],
        factors: ["recognition", "target-language distractors", ...levelFactors(item.cefr_level)],
      }),
      reason,
    },
  };
}

function translationRecallCandidate(
  language: LanguageCode,
  targetLanguage: string,
  item: VocabularyItem,
  reason: string,
  priority: number,
): Candidate {
  return {
    kind: "translation_recall",
    itemType: "vocabulary",
    itemId: item.vocab_id,
    conceptId: item.concept_id,
    language,
    cefrLevel: item.cefr_level,
    prompt: `Translate into ${targetLanguage}: ${item.translation || item.term}`,
    instructions:
      "Recall the target-language word or short phrase. Do not use a sentence unless the term is a phrase.",
    expected: item.term,
    reason,
    priority,
    payload: {
      kind: "translation_recall",
      itemType: "vocabulary",
      responseMode: "exact",
      eventType: "recall",
      lookupKey: item.term,
      label: item.term,
      expected: item.term,
      alternatives: [item.term],
      targetInstructions: targetInstructionFor("translation_recall", language),
      translation: item.translation,
      conceptId: item.concept_id ?? undefined,
      cefrLevel: item.cefr_level,
      ...templateMetadata("lexis.translation-recall", {
        cefrLevel: item.cefr_level,
        lexicalItemIds: [item.vocab_id],
        factors: ["typed recall", "orthographic production", ...levelFactors(item.cefr_level)],
      }),
      reason,
    },
  };
}

function spellingRecallCandidate(
  language: LanguageCode,
  targetLanguage: string,
  item: VocabularyItem,
  reason: string,
  priority: number,
): Candidate {
  const translation = primaryTranslation(item) || item.translation || item.term;
  return {
    kind: "spelling_recall",
    itemType: "vocabulary",
    itemId: item.vocab_id,
    conceptId: item.concept_id,
    language,
    cefrLevel: item.cefr_level,
    prompt: `Type the ${targetLanguage} word or phrase for "${translation}". Hint: ${wordShapeHint(
      item.term,
    )}`,
    instructions: "Type the target-language item exactly. Accents and spelling matter.",
    expected: item.term,
    reason,
    priority,
    payload: {
      kind: "spelling_recall",
      itemType: "vocabulary",
      responseMode: "exact",
      eventType: "recall",
      lookupKey: item.term,
      label: item.term,
      expected: item.term,
      alternatives: [item.term],
      targetInstructions: targetInstructionFor("spelling_recall", language),
      translation: item.translation,
      conceptId: item.concept_id ?? undefined,
      cefrLevel: item.cefr_level,
      ...templateMetadata("orthography.spelling-recall", {
        cefrLevel: item.cefr_level,
        lexicalItemIds: [item.vocab_id],
        factors: ["typed recall", "spelling", "diacritics", ...levelFactors(item.cefr_level)],
      }),
      reason,
    },
  };
}

function catalogTranslationCandidate(
  language: LanguageCode,
  targetLanguage: string,
  cefrLevel: CefrLevel,
  blueprint: LevelTranslationBlueprint,
): Candidate | null {
  const alternatives = answerAlternatives(blueprint.expected[language] ?? []);
  const expected = alternatives[0];
  if (!expected) return null;
  const conceptId = `cefr:${language}:${cefrLevel}:translation:${blueprint.key}`;
  return {
    kind: "guided_translation",
    itemType: "grammar",
    itemId: null,
    conceptId,
    language,
    cefrLevel,
    prompt: `Translate into ${targetLanguage}: ${blueprint.source}`,
    instructions: "Type the specific target-language translation.",
    expected,
    reason: `${cefrLevel} translation: ${blueprint.label}`,
    priority: blueprint.priority,
    payload: {
      kind: "guided_translation",
      itemType: "grammar",
      responseMode: "exact",
      eventType: "recall",
      lookupKey: conceptId,
      label: blueprint.label,
      expected,
      alternatives,
      targetInstructions: targetInstructionFor("guided_translation", language),
      translation: blueprint.source,
      conceptId,
      cefrLevel,
      ...templateMetadata("catalog.guided-translation", {
        cefrLevel,
        grammarTags: [`cefr:${cefrLevel}`],
        typologyFeatures: [`cefr.${cefrLevel}`, "translation.controlled"],
        factors: ["curated answer key", "sentence-level recall", ...levelFactors(cefrLevel)],
      }),
      reason: `${cefrLevel} translation`,
    },
  };
}

async function insertAttempts(
  db: Database,
  userId: string,
  candidates: Candidate[],
  createdAt: string,
): Promise<ExerciseAttempt[]> {
  const attempts: ExerciseAttempt[] = [];
  for (const candidate of candidates) {
    const exerciseId = exerciseIdFor(candidate);
    const row = await db.insert<ExerciseAttemptRow>("exercise_attempts", {
      user_id: userId,
      language: candidate.language,
      exercise_id: exerciseId,
      item_type: candidate.itemType,
      item_id: candidate.itemId,
      concept_id: candidate.conceptId,
      kind: candidate.kind,
      prompt: candidate.prompt,
      instructions: candidate.instructions,
      expected: candidate.expected,
      payload: candidate.payload,
      created_at: createdAt,
    });
    attempts.push(attemptFromRow(row));
  }
  return attempts;
}

async function recentAttempts(
  db: Database,
  userId: string,
  language: LanguageCode,
  limit: number,
): Promise<ExerciseAttempt[]> {
  const rows = await db.select<ExerciseAttemptRow>("exercise_attempts", {
    filters: [
      { op: "eq", column: "user_id", value: userId },
      { op: "eq", column: "language", value: language },
    ],
    order: [{ column: "created_at", ascending: false }],
    limit,
  });
  return rows.map(attemptFromRow);
}

function gradeAnswer(
  attempt: ExerciseAttempt,
  answer: string,
): { correct: boolean; outcome: Outcome; quality: number; feedback: string } {
  const responseMode = attempt.payload.responseMode ?? defaultResponseModeFor(attempt);
  if (responseMode === "exact" || responseMode === "choice") {
    const expected = attempt.expected ?? "";
    const alternatives = [expected, ...attempt.payload.alternatives].filter(Boolean);
    const normalizedAnswer = normalizeAnswer(answer);
    const exact = alternatives.some((candidate) => normalizeAnswer(candidate) === normalizedAnswer);
    if (exact) {
      return {
        correct: true,
        outcome: "correct",
        quality: 5,
        feedback: `Correct: ${expected}.`,
      };
    }

    const loose =
      responseMode === "exact" &&
      alternatives.some((candidate) => accentless(candidate) === accentless(answer));
    if (loose) {
      return {
        correct: false,
        outcome: "partial",
        quality: 3,
        feedback: `Close, but check accents or spelling. Expected: ${expected}.`,
      };
    }

    return {
      correct: false,
      outcome: "incorrect",
      quality: 1,
      feedback: `Expected: ${expected}. Your answer was recorded for review.`,
    };
  }

  if (!answer) {
    return {
      correct: false,
      outcome: "incorrect",
      quality: 1,
      feedback: "No answer was entered. Try producing a full sentence next time.",
    };
  }

  return {
    correct: false,
    outcome: "partial",
    quality: 3,
    feedback: `Recorded as production practice. Focus point: ${attempt.payload.label}`,
  };
}

function attemptFromRow(row: ExerciseAttemptRow): ExerciseAttempt {
  const payload = normalizePayload(row);
  return {
    attemptId: row.attempt_id,
    exerciseId: row.exercise_id,
    kind: row.kind,
    itemType: row.item_type,
    itemId: row.item_id ?? null,
    conceptId: row.concept_id ?? null,
    language: row.language,
    cefrLevel: payload.cefrLevel ?? null,
    prompt: row.prompt,
    instructions: row.instructions,
    expected: row.expected ?? payload.expected ?? null,
    reason: payload.reason,
    payload,
    answer: row.answer ?? null,
    correct: row.correct == null ? null : Boolean(row.correct),
    quality: row.quality ?? null,
    feedback: row.feedback ?? null,
    createdAt: row.created_at,
    answeredAt: row.answered_at ?? null,
  };
}

function sessionResponse(
  language: LanguageCode,
  cefrLevel: CefrLevel | null,
  exercises: ExerciseAttempt[],
  summary: ExerciseSession["summary"],
): ExerciseSession {
  return {
    language,
    cefrLevel,
    generatedAt: new Date().toISOString(),
    exercises: exercises.map(
      ({ answer, correct, quality, feedback, createdAt, answeredAt, ...exercise }) => exercise,
    ),
    summary,
  };
}

async function learnerCefrLevel(
  db: Database,
  userId: string,
  language: LanguageCode,
): Promise<CefrLevel | null> {
  const assessment = await db.selectOne<{ cefr_level?: string }>("assessments", {
    columns: "cefr_level",
    filters: [
      { op: "eq", column: "user_id", value: userId },
      { op: "eq", column: "language", value: language },
    ],
    order: [{ column: "assessed_at", ascending: false }],
  });
  if (isCefrLevel(assessment?.cefr_level)) return assessment.cefr_level;

  const profile = await db.selectOne<ProfileRow>("profiles", {
    columns: "learning_languages",
    filters: [{ op: "eq", column: "user_id", value: userId }],
  });
  const level = profile?.learning_languages?.find((entry) => entry.lang === language)?.cefr_level;
  return isCefrLevel(level) ? level : "A1";
}

function normalizePayload(row: ExerciseAttemptRow): ExercisePayload {
  const raw = (row.payload ?? {}) as Partial<ExercisePayload>;
  const rawResponseMode = (row.payload as { responseMode?: unknown } | null | undefined)
    ?.responseMode;
  const kind = raw.kind ?? row.kind;
  const itemType = raw.itemType ?? row.item_type;
  const responseMode = coerceResponseMode(rawResponseMode, itemType, kind);
  const eventType = isEventType(raw.eventType) ? raw.eventType : defaultEventType(responseMode);
  return {
    kind,
    itemType,
    responseMode,
    eventType,
    lookupKey: raw.lookupKey ?? row.item_id ?? row.concept_id ?? row.exercise_id,
    label: raw.label ?? row.expected ?? row.prompt,
    expected: raw.expected ?? row.expected ?? null,
    alternatives: raw.alternatives ?? (row.expected ? [row.expected] : []),
    options: raw.options,
    targetInstructions:
      raw.targetInstructions ?? targetInstructionFor(kind, row.language as LanguageCode),
    translation: raw.translation,
    contextSentence: raw.contextSentence,
    description: raw.description,
    conceptId: raw.conceptId ?? row.concept_id ?? undefined,
    cefrLevel: raw.cefrLevel ?? null,
    templateId: raw.templateId,
    family: raw.family,
    taskType: raw.taskType,
    skill: raw.skill,
    dimensions: raw.dimensions,
    grammarTags: raw.grammarTags,
    lexicalItemIds: raw.lexicalItemIds,
    typologyFeatures: raw.typologyFeatures,
    scoringPolicy: raw.scoringPolicy,
    difficulty: raw.difficulty,
    reason: raw.reason ?? "Exercise",
  };
}

function normalizeSessionOptions(
  options: ExerciseSessionOptions = {},
): NormalizedExerciseSessionOptions {
  return {
    targetLexemes: normalizedSet(options.targetLexemes ?? []),
    targetConceptIds: normalizedSet(options.targetConceptIds ?? []),
    targetGrammarTags: normalizedSet(options.targetGrammarTags ?? []),
    exerciseKinds: new Set((options.exerciseKinds ?? []).filter(isExerciseKind)),
    deterministicOnly: options.deterministicOnly ?? true,
  };
}

export function isExerciseKind(value: unknown): value is ExerciseKind {
  return typeof value === "string" && EXERCISE_KINDS.has(value as ExerciseKind);
}

function candidateMatchesOptions(
  candidate: Candidate,
  options: NormalizedExerciseSessionOptions,
): boolean {
  if (options.exerciseKinds.size > 0 && !options.exerciseKinds.has(candidate.kind)) return false;
  if (options.deterministicOnly && candidate.payload.scoringPolicy === "record_only") return false;
  if (options.targetLexemes.size > 0 && candidate.itemType !== "vocabulary") return false;
  if (options.targetGrammarTags.size > 0) {
    const tags = candidate.payload.grammarTags ?? [];
    if (!tags.some((tag) => options.targetGrammarTags.has(normalizeAnswer(tag)))) return false;
  }
  if (options.targetConceptIds.size > 0) {
    const ids = stringValues([
      candidate.itemId,
      candidate.conceptId,
      candidate.payload.conceptId,
      candidate.payload.lookupKey,
      ...(candidate.payload.lexicalItemIds ?? []),
    ]);
    if (!ids.some((id) => options.targetConceptIds.has(normalizeAnswer(id)))) return false;
  }
  return true;
}

function vocabularyMatchesOptions(
  item: VocabularyItem,
  options: NormalizedExerciseSessionOptions,
): boolean {
  if (options.targetGrammarTags.size > 0 && options.targetLexemes.size === 0) return false;
  if (options.targetLexemes.size > 0) {
    const lexicalKeys = stringValues([
      item.term,
      item.translation,
      primaryTranslation(item),
      item.vocab_id,
      item.concept_id,
    ]);
    if (!lexicalKeys.some((key) => options.targetLexemes.has(normalizeAnswer(key)))) return false;
  }
  if (options.targetConceptIds.size > 0) {
    const ids = stringValues([item.vocab_id, item.concept_id]);
    if (!ids.some((id) => options.targetConceptIds.has(normalizeAnswer(id)))) return false;
  }
  return true;
}

function templateMetadata(
  templateId: TemplateId,
  input: {
    cefrLevel: CefrLevel | null;
    lexicalItemIds?: string[];
    grammarTags?: string[];
    typologyFeatures?: string[];
    factors?: string[];
  },
): Pick<
  ExercisePayload,
  | "templateId"
  | "family"
  | "taskType"
  | "skill"
  | "dimensions"
  | "grammarTags"
  | "lexicalItemIds"
  | "typologyFeatures"
  | "scoringPolicy"
  | "difficulty"
> {
  const template = TEMPLATE_BANK[templateId];
  const factors = uniqueStrings(input.factors ?? []);
  return {
    templateId,
    family: template.family,
    taskType: template.taskType,
    skill: template.skill,
    dimensions: template.dimensions,
    grammarTags: uniqueStrings([...template.grammarTags, ...(input.grammarTags ?? [])]),
    lexicalItemIds: uniqueStrings(input.lexicalItemIds ?? []),
    typologyFeatures: uniqueStrings([
      ...template.typologyFeatures,
      ...(input.typologyFeatures ?? []),
    ]),
    scoringPolicy: template.scoringPolicy,
    difficulty: {
      cefrLevel: input.cefrLevel,
      cefrRange: template.cefrRange,
      score: difficultyScore(input.cefrLevel, template, factors),
      factors,
    },
  };
}

function normalizedSet(values: string[]): Set<string> {
  return new Set(values.map(normalizeAnswer).filter(Boolean));
}

function stringValues(values: Array<string | null | undefined>): string[] {
  return values.filter(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
}

function sortAndDiversifyCandidates(candidates: Candidate[]): Candidate[] {
  const sorted = [...candidates].sort(candidateSort);
  const buckets = new Map<ExerciseKind, Candidate[]>();
  for (const candidate of sorted) {
    buckets.set(candidate.kind, [...(buckets.get(candidate.kind) ?? []), candidate]);
  }

  const kindOrder = [...buckets.keys()];
  const diversified: Candidate[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const kind of kindOrder) {
      const bucket = buckets.get(kind);
      const next = bucket?.shift();
      if (!next) continue;
      diversified.push(next);
      added = true;
    }
  }
  return diversified;
}

function isReusablePendingAttempt(attempt: ExerciseAttempt): boolean {
  return isBoundedScoreableAttempt(attempt);
}

function isDisplayableHistoryAttempt(attempt: ExerciseAttempt): boolean {
  return isBoundedScoreableAttempt(attempt);
}

function isBoundedScoreableAttempt(attempt: ExerciseAttempt): boolean {
  const responseMode = attempt.payload.responseMode ?? defaultResponseModeFor(attempt);
  return (
    attempt.kind !== "vocabulary_cloze" &&
    attempt.kind !== "grammar_concept_choice" &&
    !attempt.prompt.includes("_____") &&
    !/^Which grammar focus matches\b/i.test(attempt.prompt) &&
    !mentionsSelfRating(attempt.instructions) &&
    (responseMode === "exact" || responseMode === "choice") &&
    !!attempt.expected
  );
}

function mentionsSelfRating(value: string): boolean {
  return /\bself[- ]?rat(?:e|ing)\b|\brate how well\b/i.test(value);
}

function candidateSort(left: Candidate, right: Candidate): number {
  return right.priority - left.priority || left.prompt.localeCompare(right.prompt);
}

function uniqueVocabulary(items: VocabularyItem[]): VocabularyItem[] {
  const byId = new Map<string, VocabularyItem>();
  for (const item of items) {
    if (!item.vocab_id || byId.has(item.vocab_id)) continue;
    byId.set(item.vocab_id, item);
  }
  return [...byId.values()];
}

function vocabularyPriority(
  item: VocabularyItem,
  targetLevel: CefrLevel,
  dueVocabIds: Set<string>,
): number {
  const targetIndex = CEFR_ORDER.indexOf(targetLevel);
  const itemIndex = item.cefr_level ? CEFR_ORDER.indexOf(item.cefr_level) : targetIndex - 1;
  const distance = Math.abs(targetIndex - itemIndex);
  const levelFit = item.cefr_level === targetLevel ? 10 : Math.max(1, 6 - distance * 2);
  const weakScore =
    (item.productions === 0 ? 8 : 0) +
    (item.repetitions <= 1 ? 6 : 0) +
    (item.correct_productions === 0 ? 6 : 0);
  return 46 + (dueVocabIds.has(item.vocab_id) ? 18 : 0) + levelFit + weakScore;
}

function wordShapeHint(value: string): string {
  const tokens = value.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return "empty answer";
  return tokens
    .map((token) => {
      const chars = [...token];
      const first = chars[0] ?? "";
      return `${first}${"·".repeat(Math.max(0, chars.length - 1))} (${chars.length})`;
    })
    .join(" ");
}

function levelFactors(level: CefrLevel | null): string[] {
  return level ? [`${level} item`] : ["ungraded item"];
}

function difficultyScore(
  level: CefrLevel | null,
  template: ExerciseTemplateDefinition,
  factors: string[],
): number {
  const levelScore = level ? CEFR_ORDER.indexOf(level) + 1 : 1;
  const productionPressure = template.taskType === "short_production" ? 2 : 0;
  const typedPressure = template.taskType === "typed_recall" ? 1 : 0;
  const distractorPressure = factors.some((factor) => factor.includes("distractor")) ? 1 : 0;
  return levelScore + productionPressure + typedPressure + distractorPressure;
}

function isVocabularyUsableAtLevel(item: VocabularyItem, targetLevel: CefrLevel): boolean {
  if (!item.term?.trim()) return false;
  if (!item.cefr_level) return true;
  return CEFR_ORDER.indexOf(item.cefr_level) <= CEFR_ORDER.indexOf(targetLevel);
}

function primaryTranslation(item: VocabularyItem): string {
  return translationAlternatives(item.translation)[0] ?? "";
}

function translationAlternatives(value: string | null | undefined): string[] {
  if (!value) return [];
  const parts = value
    .split(/\s*(?:[,;/]|\bor\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
  return uniqueStrings(parts.length > 0 ? parts : [value]);
}

function answerAlternatives(values: string[]): string[] {
  return uniqueStrings(values.flatMap((value) => [value, value.replace(/[.!?]+$/u, "")]));
}

function stableOptions(values: string[], seed: string, limit: number): string[] {
  const [expected, ...rest] = uniqueStrings(values);
  if (!expected) return [];
  const distractors = rest
    .sort((left, right) => hashScore(`${seed}:${left}`) - hashScore(`${seed}:${right}`))
    .slice(0, Math.max(0, limit - 1));
  return [expected, ...distractors].sort(
    (left, right) => hashScore(`${seed}:option:${left}`) - hashScore(`${seed}:option:${right}`),
  );
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeAnswer(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value);
  }
  return result;
}

function hashScore(value: string): number {
  return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16);
}

function targetInstructionFor(kind: ExerciseKind, language: LanguageCode): string {
  const byLanguage = TARGET_INSTRUCTIONS[language] ?? TARGET_INSTRUCTIONS.en;
  return byLanguage[kind] ?? TARGET_INSTRUCTIONS.en[kind] ?? byLanguage.default ?? "";
}

const TARGET_INSTRUCTIONS: Record<string, Partial<Record<ExerciseKind | "default", string>>> = {
  en: {
    meaning_choice: "Choose the closest translation.",
    reverse_translation_choice: "Choose the target-language word or short phrase.",
    translation_recall: "Recall the target-language word or short phrase.",
    spelling_recall: "Type the target-language word or short phrase exactly.",
    grammar_concept_choice: "Choose the grammar focus.",
    use_target_word: "Use the item naturally in a complete sentence.",
    sentence_build: "Write a sentence for the situation.",
    guided_translation: "Translate the prompt into the target language.",
    sentence_transform: "Transform the sentence as requested.",
    error_repair: "Write a natural sentence and focus on the stated point.",
    form_focus: "Practice the stated form in one sentence.",
    dialogue_reply: "Reply naturally to the situation.",
    question_answer: "Answer in the target language.",
    micro_writing: "Write a short text in the target language.",
    fluency_sprint: "Write quickly and focus on flow.",
    default: "Write in the target language.",
  },
  fr: {
    meaning_choice: "Choisis le sens le plus proche.",
    translation_recall: "Rappelle-toi le mot ou la courte expression en langue cible.",
    use_target_word: "Utilise cet élément naturellement dans une phrase complète.",
    sentence_build: "Écris une phrase pour la situation donnée.",
    guided_translation: "Traduis l'invite en langue cible.",
    sentence_transform: "Transforme la phrase comme demandé.",
    error_repair: "Écris une phrase naturelle et concentre-toi sur le point indiqué.",
    form_focus: "Travaille la forme indiquée dans une phrase.",
    dialogue_reply: "Réponds naturellement à la situation.",
    question_answer: "Réponds en langue cible.",
    micro_writing: "Écris un court texte en langue cible.",
    fluency_sprint: "Écris vite et cherche la fluidité.",
    default: "Écris en langue cible.",
  },
  es: {
    meaning_choice: "Elige el significado más cercano.",
    translation_recall: "Recuerda la palabra o expresión corta en la lengua meta.",
    use_target_word: "Usa el elemento de forma natural en una oración completa.",
    sentence_build: "Escribe una oración para la situación dada.",
    guided_translation: "Traduce la consigna a la lengua meta.",
    sentence_transform: "Transforma la oración como se pide.",
    error_repair: "Escribe una oración natural y concéntrate en el punto indicado.",
    form_focus: "Practica la forma indicada en una oración.",
    dialogue_reply: "Responde de forma natural a la situación.",
    question_answer: "Responde en la lengua meta.",
    micro_writing: "Escribe un texto breve en la lengua meta.",
    fluency_sprint: "Escribe rápido y busca fluidez.",
    default: "Escribe en la lengua meta.",
  },
  de: {
    meaning_choice: "Wähle die nächstliegende Bedeutung.",
    translation_recall: "Rufe dir das zielsprachliche Wort oder die kurze Wendung in Erinnerung.",
    use_target_word: "Verwende das Element natürlich in einem vollständigen Satz.",
    sentence_build: "Schreibe einen Satz zur gegebenen Situation.",
    guided_translation: "Übersetze die Vorgabe in die Zielsprache.",
    sentence_transform: "Forme den Satz wie gefordert um.",
    error_repair: "Schreibe einen natürlichen Satz und achte auf den genannten Punkt.",
    form_focus: "Übe die genannte Form in einem Satz.",
    dialogue_reply: "Antworte natürlich auf die Situation.",
    question_answer: "Antworte in der Zielsprache.",
    micro_writing: "Schreibe einen kurzen Text in der Zielsprache.",
    fluency_sprint: "Schreibe zügig und achte auf Flüssigkeit.",
    default: "Schreibe in der Zielsprache.",
  },
  hu: {
    meaning_choice: "Válaszd ki a legközelebbi fordítást.",
    reverse_translation_choice: "Válaszd ki a célnyelvi szót vagy rövid kifejezést.",
    translation_recall: "Idézd fel a célnyelvi szót vagy rövid kifejezést.",
    spelling_recall: "Írd be pontosan a célnyelvi szót vagy rövid kifejezést.",
    grammar_concept_choice: "Válaszd ki a nyelvtani fókuszt.",
    use_target_word: "Használd természetesen egy teljes mondatban.",
    sentence_build: "Írj mondatot a megadott helyzethez.",
    guided_translation: "Fordítsd le a megadott szöveget magyarra.",
    sentence_transform: "Alakítsd át a mondatot a feladat szerint.",
    error_repair: "Írj természetes mondatot, és figyelj a megadott pontra.",
    form_focus: "Gyakorold a megadott formát egy mondatban.",
    dialogue_reply: "Válaszolj természetesen a helyzetre.",
    question_answer: "Válaszolj magyarul.",
    micro_writing: "Írj rövid szöveget magyarul.",
    fluency_sprint: "Írj gyorsan, és törekedj a folyamatosságra.",
    default: "Írj magyarul.",
  },
  it: {
    meaning_choice: "Scegli il significato più vicino.",
    translation_recall: "Richiama la parola o la breve espressione nella lingua di arrivo.",
    use_target_word: "Usa l'elemento in modo naturale in una frase completa.",
    sentence_build: "Scrivi una frase per la situazione data.",
    guided_translation: "Traduci la traccia nella lingua di arrivo.",
    sentence_transform: "Trasforma la frase come richiesto.",
    error_repair: "Scrivi una frase naturale e concentrati sul punto indicato.",
    form_focus: "Esercita la forma indicata in una frase.",
    dialogue_reply: "Rispondi in modo naturale alla situazione.",
    question_answer: "Rispondi nella lingua di arrivo.",
    micro_writing: "Scrivi un breve testo nella lingua di arrivo.",
    fluency_sprint: "Scrivi rapidamente e cerca la fluidità.",
    default: "Scrivi nella lingua di arrivo.",
  },
  pt: {
    meaning_choice: "Escolha o significado mais próximo.",
    translation_recall: "Lembre a palavra ou expressão curta na língua-alvo.",
    use_target_word: "Use o item naturalmente em uma frase completa.",
    sentence_build: "Escreva uma frase para a situação dada.",
    guided_translation: "Traduza o enunciado para a língua-alvo.",
    sentence_transform: "Transforme a frase conforme pedido.",
    error_repair: "Escreva uma frase natural e foque no ponto indicado.",
    form_focus: "Pratique a forma indicada em uma frase.",
    dialogue_reply: "Responda naturalmente à situação.",
    question_answer: "Responda na língua-alvo.",
    micro_writing: "Escreva um texto curto na língua-alvo.",
    fluency_sprint: "Escreva rápido e busque fluidez.",
    default: "Escreva na língua-alvo.",
  },
  nl: {
    meaning_choice: "Kies de dichtstbijzijnde betekenis.",
    translation_recall: "Haal het woord of de korte uitdrukking in de doeltaal op.",
    use_target_word: "Gebruik het item natuurlijk in een volledige zin.",
    sentence_build: "Schrijf een zin voor de gegeven situatie.",
    guided_translation: "Vertaal de opdracht naar de doeltaal.",
    sentence_transform: "Zet de zin om zoals gevraagd.",
    error_repair: "Schrijf een natuurlijke zin en let op het genoemde punt.",
    form_focus: "Oefen de genoemde vorm in één zin.",
    dialogue_reply: "Reageer natuurlijk op de situatie.",
    question_answer: "Antwoord in de doeltaal.",
    micro_writing: "Schrijf een korte tekst in de doeltaal.",
    fluency_sprint: "Schrijf snel en let op vloeiendheid.",
    default: "Schrijf in de doeltaal.",
  },
  ru: {
    meaning_choice: "Выберите наиболее близкое значение.",
    translation_recall: "Вспомните слово или короткую фразу на целевом языке.",
    use_target_word: "Используйте этот элемент естественно в полном предложении.",
    sentence_build: "Напишите предложение для заданной ситуации.",
    guided_translation: "Переведите задание на целевой язык.",
    sentence_transform: "Преобразуйте предложение, как указано.",
    error_repair: "Напишите естественное предложение и сосредоточьтесь на указанном моменте.",
    form_focus: "Отработайте указанную форму в одном предложении.",
    dialogue_reply: "Ответьте естественно в этой ситуации.",
    question_answer: "Ответьте на целевом языке.",
    micro_writing: "Напишите короткий текст на целевом языке.",
    fluency_sprint: "Пишите быстро и стремитесь к плавности.",
    default: "Пишите на целевом языке.",
  },
  zh: {
    meaning_choice: "选择最接近的意思。",
    translation_recall: "回想目标语言中的单词或短语。",
    use_target_word: "在完整句子中自然使用这个项目。",
    sentence_build: "根据给定情境写一个句子。",
    guided_translation: "把提示翻译成目标语言。",
    sentence_transform: "按要求改写句子。",
    error_repair: "写一个自然的句子，并注意指定的重点。",
    form_focus: "用一个句子练习指定形式。",
    dialogue_reply: "自然地回应这个情境。",
    question_answer: "用目标语言回答。",
    micro_writing: "用目标语言写一小段文字。",
    fluency_sprint: "快速书写，并注意流畅度。",
    default: "用目标语言书写。",
  },
  ja: {
    meaning_choice: "最も近い意味を選んでください。",
    translation_recall: "目標言語の単語または短い表現を思い出してください。",
    use_target_word: "その項目を完全な文の中で自然に使ってください。",
    sentence_build: "指定された状況に合う文を書いてください。",
    guided_translation: "提示文を目標言語に翻訳してください。",
    sentence_transform: "指示どおりに文を変形してください。",
    error_repair: "自然な文を書き、指定された点に注意してください。",
    form_focus: "指定された形を一文で練習してください。",
    dialogue_reply: "状況に自然に返答してください。",
    question_answer: "目標言語で答えてください。",
    micro_writing: "目標言語で短い文章を書いてください。",
    fluency_sprint: "すばやく書き、流れを意識してください。",
    default: "目標言語で書いてください。",
  },
  ko: {
    meaning_choice: "가장 가까운 뜻을 고르세요.",
    translation_recall: "목표 언어의 단어나 짧은 표현을 떠올리세요.",
    use_target_word: "그 항목을 완전한 문장 안에서 자연스럽게 사용하세요.",
    sentence_build: "주어진 상황에 맞는 문장을 쓰세요.",
    guided_translation: "제시문을 목표 언어로 번역하세요.",
    sentence_transform: "요청한 대로 문장을 바꾸세요.",
    error_repair: "자연스러운 문장을 쓰고 지정된 부분에 집중하세요.",
    form_focus: "지정된 형태를 한 문장으로 연습하세요.",
    dialogue_reply: "상황에 자연스럽게 답하세요.",
    question_answer: "목표 언어로 답하세요.",
    micro_writing: "목표 언어로 짧은 글을 쓰세요.",
    fluency_sprint: "빠르게 쓰고 흐름에 집중하세요.",
    default: "목표 언어로 쓰세요.",
  },
  ar: {
    meaning_choice: "اختر أقرب معنى.",
    translation_recall: "تذكّر الكلمة أو العبارة القصيرة في اللغة الهدف.",
    use_target_word: "استخدم العنصر بشكل طبيعي في جملة كاملة.",
    sentence_build: "اكتب جملة تناسب الموقف المعطى.",
    guided_translation: "ترجم النص المطلوب إلى اللغة الهدف.",
    sentence_transform: "حوّل الجملة كما هو مطلوب.",
    error_repair: "اكتب جملة طبيعية وركّز على النقطة المحددة.",
    form_focus: "تدرّب على الصيغة المحددة في جملة واحدة.",
    dialogue_reply: "ردّ بشكل طبيعي على الموقف.",
    question_answer: "أجب باللغة الهدف.",
    micro_writing: "اكتب نصًا قصيرًا باللغة الهدف.",
    fluency_sprint: "اكتب بسرعة وركز على السلاسة.",
    default: "اكتب باللغة الهدف.",
  },
  he: {
    meaning_choice: "בחר את המשמעות הקרובה ביותר.",
    translation_recall: "היזכר במילה או בביטוי הקצר בשפת היעד.",
    use_target_word: "השתמש בפריט באופן טבעי במשפט מלא.",
    sentence_build: "כתוב משפט למצב הנתון.",
    guided_translation: "תרגם את ההנחיה לשפת היעד.",
    sentence_transform: "שנה את המשפט לפי ההנחיה.",
    error_repair: "כתוב משפט טבעי והתמקד בנקודה שצוינה.",
    form_focus: "תרגל את הצורה שצוינה במשפט אחד.",
    dialogue_reply: "השב באופן טבעי למצב.",
    question_answer: "ענה בשפת היעד.",
    micro_writing: "כתוב טקסט קצר בשפת היעד.",
    fluency_sprint: "כתוב במהירות והתמקד בשטף.",
    default: "כתוב בשפת היעד.",
  },
  tr: {
    meaning_choice: "En yakın anlamı seç.",
    translation_recall: "Hedef dildeki kelimeyi veya kısa ifadeyi hatırla.",
    use_target_word: "Öğeyi tam bir cümlede doğal biçimde kullan.",
    sentence_build: "Verilen duruma uygun bir cümle yaz.",
    guided_translation: "Verilen ifadeyi hedef dile çevir.",
    sentence_transform: "Cümleyi istendiği gibi dönüştür.",
    error_repair: "Doğal bir cümle yaz ve belirtilen noktaya odaklan.",
    form_focus: "Belirtilen biçimi bir cümlede çalış.",
    dialogue_reply: "Duruma doğal biçimde cevap ver.",
    question_answer: "Hedef dilde cevap ver.",
    micro_writing: "Hedef dilde kısa bir metin yaz.",
    fluency_sprint: "Hızlı yaz ve akıcılığa odaklan.",
    default: "Hedef dilde yaz.",
  },
  da: {
    meaning_choice: "Vælg den nærmeste betydning.",
    translation_recall: "Husk ordet eller den korte vending på målsproget.",
    use_target_word: "Brug elementet naturligt i en hel sætning.",
    sentence_build: "Skriv en sætning til den givne situation.",
    guided_translation: "Oversæt prompten til målsproget.",
    sentence_transform: "Omskriv sætningen som bedt om.",
    error_repair: "Skriv en naturlig sætning, og fokuser på det angivne punkt.",
    form_focus: "Øv den angivne form i én sætning.",
    dialogue_reply: "Svar naturligt på situationen.",
    question_answer: "Svar på målsproget.",
    micro_writing: "Skriv en kort tekst på målsproget.",
    fluency_sprint: "Skriv hurtigt, og fokuser på flow.",
    default: "Skriv på målsproget.",
  },
  pl: {
    meaning_choice: "Wybierz najbliższe znaczenie.",
    translation_recall: "Przypomnij sobie słowo lub krótkie wyrażenie w języku docelowym.",
    use_target_word: "Użyj elementu naturalnie w pełnym zdaniu.",
    sentence_build: "Napisz zdanie do podanej sytuacji.",
    guided_translation: "Przetłumacz polecenie na język docelowy.",
    sentence_transform: "Przekształć zdanie zgodnie z poleceniem.",
    error_repair: "Napisz naturalne zdanie i skup się na wskazanym punkcie.",
    form_focus: "Przećwicz wskazaną formę w jednym zdaniu.",
    dialogue_reply: "Odpowiedz naturalnie na sytuację.",
    question_answer: "Odpowiedz w języku docelowym.",
    micro_writing: "Napisz krótki tekst w języku docelowym.",
    fluency_sprint: "Pisz szybko i skup się na płynności.",
    default: "Pisz w języku docelowym.",
  },
};

function isCefrCatalogCandidate(candidate: Candidate): boolean {
  return candidate.conceptId?.startsWith(`cefr:${candidate.language}:`) === true;
}

function defaultResponseModeFor(attempt: ExerciseAttempt): ExerciseResponseMode {
  return defaultResponseMode(attempt.itemType, attempt.kind);
}

function defaultResponseMode(itemType: ExerciseItemType, kind: ExerciseKind): ExerciseResponseMode {
  if (
    kind === "meaning_choice" ||
    kind === "reverse_translation_choice" ||
    kind === "grammar_concept_choice"
  ) {
    return "choice";
  }
  if (kind === "spelling_recall" || kind === "translation_recall") return "exact";
  if (kind === "use_target_word") return "open";
  if (itemType === "vocabulary") return "exact";
  return "open";
}

function defaultEventTypeFor(attempt: ExerciseAttempt): EventType {
  return defaultEventType(attempt.payload.responseMode ?? defaultResponseModeFor(attempt));
}

function defaultEventType(responseMode: ExerciseResponseMode): EventType {
  return responseMode === "exact" || responseMode === "choice" ? "recall" : "production";
}

function isResponseMode(value: unknown): value is ExerciseResponseMode {
  return value === "exact" || value === "choice" || value === "open";
}

function coerceResponseMode(
  value: unknown,
  itemType: ExerciseItemType,
  kind: ExerciseKind,
): ExerciseResponseMode {
  if (isResponseMode(value)) return value;
  if (value === "self_rated") return "open";
  return defaultResponseMode(itemType, kind);
}

function isEventType(value: unknown): value is EventType {
  return (
    value === "encounter" ||
    value === "production" ||
    value === "recall" ||
    value === "heard" ||
    value === "spoken"
  );
}

function exerciseIdFor(candidate: Candidate): string {
  const key = [
    candidate.kind,
    candidate.language,
    candidate.itemType,
    candidate.itemId ?? candidate.conceptId ?? candidate.payload.lookupKey,
  ].join("\0");
  return `ex_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

function outcomeFromQuality(quality: number): Outcome {
  if (quality >= 4) return "correct";
  if (quality >= 3) return "partial";
  return "incorrect";
}

function clampLimit(value: number): number {
  return Math.max(
    1,
    Math.min(MAX_LIMIT, Math.floor(Number.isFinite(value) ? value : DEFAULT_LIMIT)),
  );
}

function normalizeAnswer(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[.!?]+$/u, "")
    .replace(/\s+/g, " ");
}

function accentless(value: string): string {
  return normalizeAnswer(value).normalize("NFD").replace(/\p{M}/gu, "");
}

function isCefrLevel(value: unknown): value is CefrLevel {
  return typeof value === "string" && CEFR_ORDER.includes(value as CefrLevel);
}
