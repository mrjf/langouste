/** Authored, source-grounded lessons; no runtime AI or audio generation required. */
export type CourseLanguage = "hu" | "ar-EG";

export interface CourseSource {
  id: string;
  title: string;
  url: string;
  publishedOn: string | null;
  verifiedAsOf?: string; // YYYY-MM-DD, verified publication date
  publisher: string;
  factSummary: string; // English paraphrase, attributed to the source
}

export interface CourseSentence {
  id: string;
  text: string;
  english: string;
  transliteration?: string; // Required for ar-EG; consistent learner-friendly convention
  kind: "source-summary" | "teaching-example";
  sourceIds: string[];
}

export interface CourseVocabulary {
  teachingNote?: string;
  forms?: {arabic?:string;term?:string;transliteration?:string;english?:string}[];
  lexicalTerm?: string;
  plannedRole?: string;
  semanticConcept?: string;
  recognitionOnly?: boolean;
  trackInSrs?: boolean;
  id: string; // Stable across days within this language, for shared review history
  term: string;
  english: string;
  transliteration?: string;
  example: CourseSentence;
}

export interface CourseConcept {
  recognitionOnly?: boolean;
  trackInSrs?: boolean;
  id: string; // Stable language-learning concept, not a news topic
  title: string;
  explanation: string; // Beginner-friendly English
  examples: CourseSentence[];
}

export interface CourseExercise {
  id: string;
  type: "choice" | "recall" | "order" | "self-check" | "matching";
  trackInSrs?: boolean;
  showChoiceEnglish?: boolean;
  promptAtom?: CourseSentence;
  supportAtoms?: CourseSentence[];
  answerAtoms?: CourseSentence[];
  modelAnswer?: string;
  rubricText?: string;
  orderMode?: string;
  matchingPairs?: {
    id: string;
    text: string;
    transliteration?: string;
    answer: string;
    target?: CourseExercise["target"];
  }[];
  prompt: string;
  choices?: string[]; // choice: options; order: shuffled tokens
  acceptedAnswers: string[]; // For order, complete sentence(s) in correct order
  hint: string;
  explanation: string;
  targetIds?: string[];
  choiceSupport?: Record<string, { transliteration?: string; english?: string }>;
  originalExercise?: Record<string, unknown>;
  target: { type: "vocabulary" | "grammar"; id: string; semanticConcept?: string };
}

export interface CourseLesson {
  schemaVersion: 1;
  id: string; // e.g. ai-news-2026-10-hu-01
  courseId: string; // ai-news-2026-10
  day: number;
  language: CourseLanguage;
  title: string;
  subtitle: string;
  estimatedMinutes: number;
  objectives: string[];
  instructionBlocks?: { title: string; body: string; examples?: CourseSentence[] }[];
  route?: string[];
  optionalDialogue?: CourseSentence[];
  review?: { instructions: string; prompts: string[] };
  sources: CourseSource[];
  readings: {
    id: string;
    title: string;
    sentences: CourseSentence[];
    sourceSentenceRefs?: string[];
    instruction?: string;
    recognitionOnly?: CourseSentence[];
  }[];
  vocabulary: CourseVocabulary[];
  concepts: CourseConcept[];
  exercises: CourseExercise[];
}

export interface CourseAttempt {
  evidenceVersion?: 2;
  supportUsed?: boolean;
  contentVersion?: string;
  direction?: string;
  support?: {hint:boolean;answer:boolean;transliteration:boolean;reference:boolean;supplied:boolean};
  pairResults?: { id: string; targetId?: string; semanticConcept?: string; correct: boolean }[];
  selfAssessment?: "again" | "close" | "met";
  transliterationVisible?: boolean;
  responseMode?: "arabic-script" | "latin" | "other";
  targetId?: string;
  semanticConcept?: string;
  id: string;
  answer: string;
  correct: boolean | null;
  scored: boolean;
  at: string;
}
export interface CourseExerciseState {
  hinted: boolean;
  revealed: boolean;
  attempts: CourseAttempt[];
}
export interface CourseProgress {
  lesson_id: string;
  language: CourseLanguage;
  read_sections: string[];
  reading_evidence?: {
    sectionId: string;
    englishVisible: boolean;
    transliterationVisible: boolean;
    at: string;
  }[];
  encounters: string[];
  exercises: Record<string, CourseExerciseState>;
  step: "read" | "words" | "grammar" | "practice";
  sync_receipts?: {
    id: string;
    status: "pending" | "confirmed" | "uncertain";
    eventType: "encounter" | "recall";
    targetId: string;
    at: string;
  }[];
  completed_at: string | null;
  updated_at: string;
}
export type PublicCourseLesson = Omit<CourseLesson, "exercises"> & {
  exercises: (Omit<
    CourseExercise,
    "acceptedAnswers" | "hint" | "explanation" | "matchingPairs" | "promptAtom"
  > & {
    matchingPairs?: Omit<NonNullable<CourseExercise["matchingPairs"]>[number], "answer">[];
    promptAtom?: Omit<CourseSentence, "english">;
  })[];
};
export type CourseAction =
  | { type: "read"; sectionId: string; englishVisible?: boolean; transliterationVisible?: boolean }
  | { type: "encounter"; itemType: "vocabulary" | "grammar"; targetId: string }
  | { type: "hint" | "reveal"; exerciseId: string }
  | {
      type: "answer";
      exerciseId: string;
      attemptId: string;
      answer: string;
      transliterationVisible?: boolean;
      supportUsed?: boolean;
      evidenceVersion?: 2;
    }
  | { type: "self-assess"; exerciseId: string; assessment: "again" | "close" | "met" }
  | { type: "navigate"; step: CourseProgress["step"] }
  | { type: "complete" };
export interface CourseActionResult {
  progress: CourseProgress;
  feedback?: {
    correct?: boolean | null;
    scored?: boolean;
    text: string;
    answer?: string;
    choiceSupport?: CourseExercise["choiceSupport"];
    answerAtoms?: CourseSentence[];
    rubricText?: string;
    promptEnglish?: string;
  };
}
