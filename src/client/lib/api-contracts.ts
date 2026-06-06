import type {
  AgentConnector,
  Conversation,
  FiloDocumentJson,
  Message,
  Profile,
  User,
  UserSession,
} from "./stores.svelte";
import type { SelfCorrectedSpan } from "../../types/index.ts";

export type JsonObject = Record<string, unknown>;
export type ItemType = "vocabulary" | "grammar";
export type LanguageUpdateField = "target_languages" | "base_languages";

export interface AuthResponse {
  session: UserSession;
  user: User;
}

export interface CreateConversationRequest {
  agent_connector_id: string;
  target_languages: Array<{ lang: string; cefr_level: string }>;
  base_languages: string[];
}

export interface UpdateLanguagesRequest {
  target_languages?: Array<{ lang: string; cefr_level: string }>;
  base_languages?: string[];
}

export interface CheckMessageResponse {
  clean: boolean;
  text: string;
  language: string;
  errors: Array<{
    start: number;
    end: number;
    text: string;
    kind: "spelling" | "grammar";
    suggestions?: string[];
  }>;
}

export interface ExplainErrorsRequest {
  text: string;
  errors: CheckMessageResponse["errors"];
  language: string;
  intent?: string;
}

export interface SendMessageRequest {
  text: string;
  language: string;
  intent?: string;
  self_corrected_spans?: SelfCorrectedSpan[];
}

export interface AgentConnectorPayload {
  name: string;
  type: string;
  config: JsonObject;
}

export interface AgentConnectorTestResult {
  ok: boolean;
  error?: string;
}

export interface ProfileLanguageSummary {
  lang: string;
  cefr_level: string | null;
  messages?: number;
  vocabulary?: number;
  grammar?: number;
}

export interface LanguageStatsResponse {
  messages_sent: number;
  vocab_total: number;
  vocab_mastered: number;
  vocab_struggling: number;
  grammar_gap_total: number;
  grammar_gap_active: number;
  corrections_count: number;
  vocab_self_corrected: number;
  vocab_heard: number;
  vocab_spoken: number;
  grammar_self_corrected: number;
  [key: string]: unknown;
}

export interface DimensionItemsResponse {
  dimension: string;
  items: unknown[];
  [key: string]: unknown;
}

export interface ProfileItemResponse {
  item?: {
    term?: string;
    category?: string;
    route_key?: string;
    [key: string]: unknown;
  };
  route_key?: string;
  has_profile_data?: boolean;
  dictionary?: {
    term: string;
    language: string;
    lemma: string | null;
    source_term: string | null;
    form_description: string | null;
    definitions: string[];
    senses: Array<{ part_of_speech: string; definition: string; examples: string[] }>;
    source_url: string | null;
    target_source_url: string | null;
  } | null;
  [key: string]: unknown;
}

export interface ItemReferenceResponse {
  term: string;
  language: string;
  source_term: string | null;
  source: "wiktionary" | null;
  source_url: string | null;
  part_of_speech: string | null;
  pronunciations: Array<{
    kind: "audio" | "ipa";
    label: string;
    value: string;
    source: string;
    url?: string;
  }>;
  conjugation_html: string | null;
  links: Array<{ label: string; url: string; source: string }>;
  notes: string[];
}

export interface DictionaryLookupResponse {
  term: string;
  language: string;
  source_term: string | null;
  source_url: string | null;
  target_source_url: string | null;
  form_description: string | null;
  definitions: string[];
  senses: Array<{ part_of_speech: string; definition: string; examples: string[] }>;
  [key: string]: unknown;
}

export interface DictionaryTranslationResponse {
  term: string;
  source_language: string;
  target_language: string;
  source_term: string;
  source_definition_language: "en";
  source_glosses: string[];
  equivalents: string[];
  source: "wiktionary-gloss" | "wiktionary-gloss-translation";
}

export interface WorkbenchAnalyzeRequest {
  text: string;
  source_language: string;
  target_language: string;
  title?: string;
  document?: FiloDocumentJson | null;
}

export interface WorkbenchAnalyzeResponse {
  document: FiloDocumentJson;
  summary: {
    words: number;
    sentences: number;
    phrases: number;
    targetLanguage: string;
  };
}

export interface WorkbenchInteractionRequest {
  document: FiloDocumentJson;
  language: string;
  event_type: "encounter" | "heard";
  source: "workbench_definition" | "workbench_audio";
  range?: { start: number; end: number };
}

export interface WorkbenchInteractionResponse {
  ok: boolean;
  recorded: number;
}

export interface WorkbenchAudioResponse {
  url: string;
  audioId: string | null;
  contentType: string;
  byteLength: number;
}

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
  | "vocabulary_recall"
  | "vocabulary_cloze"
  | "grammar_focus"
  | "level_target";

export type ExerciseItemType = "vocabulary" | "grammar";
export type ExerciseResponseMode = "exact" | "choice" | "open";
export type ExerciseEventType = "encounter" | "production" | "recall" | "heard" | "spoken";
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
  cefrLevel: string | null;
  cefrRange: { min: string; max: string };
  score: number;
  factors: string[];
}

export interface ExercisePayload {
  kind: ExerciseKind;
  itemType: ExerciseItemType;
  responseMode: ExerciseResponseMode;
  eventType: ExerciseEventType;
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
  cefrLevel?: string | null;
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

export interface Exercise {
  attemptId: string;
  exerciseId: string;
  kind: ExerciseKind;
  itemType: ExerciseItemType;
  itemId: string | null;
  conceptId: string | null;
  language: string;
  cefrLevel: string | null;
  prompt: string;
  instructions: string;
  expected: string | null;
  reason: string;
  payload: ExercisePayload;
}

export interface ExerciseAttempt extends Exercise {
  answer: string | null;
  correct: boolean | null;
  quality: number | null;
  feedback: string | null;
  createdAt: string;
  answeredAt: string | null;
}

export interface ExerciseSessionResponse {
  language: string;
  cefrLevel: string | null;
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

export interface ExerciseSubmissionResponse {
  attempt: ExerciseAttempt;
  feedback: string;
  correct: boolean;
  outcome: "correct" | "partial" | "incorrect";
  quality: number;
  expected: string | null;
}

export interface ExerciseHistoryResponse {
  attempts: ExerciseAttempt[];
}

export interface FSRSConfigResponse {
  config_id: string | null;
  user_id: string;
  language: string;
  parameters: number[];
  request_retention: number;
  maximum_interval_days: number;
  failure_review_delay_minutes: number;
  quality_weights: Record<string, number | null>;
  created_at: string | null;
  updated_at: string | null;
}

export type ResourceReuseRights =
  | "reusable"
  | "link_only"
  | "reusable_noncommercial_sharealike"
  | "reusable_sharealike"
  | "reusable_with_attribution_or_cc0_subset"
  | "reusable_public_domain_dedication"
  | "public_domain"
  | "public_domain_or_reusable_sharealike";

export interface ResourceSourceFamily {
  title: string;
  publisher: string;
  type: string;
  human_generated: boolean;
  price: "free" | string;
  reuse_rights: ResourceReuseRights;
  license: string;
  license_spdx: string | null;
  formats: string[];
  source_url: string;
  evidence_urls: string[];
  ingestion_guidance: string;
}

export interface LanguageResource {
  source_id: string;
  title: string;
  url: string;
  resource_type: string;
  reuse_rights: ResourceReuseRights;
  license_spdx: string | null;
  formats: string[];
  notes: string;
}

export interface DefaultReferenceSource {
  source_id: string;
  lookup: string;
  notes: string;
}

export interface LanguageResourceGroup {
  name: string;
  code_system: string;
  reusable_resource_count: number;
  link_only_resource_count: number;
  resources: LanguageResource[];
  default_reference_sources: DefaultReferenceSource[];
}

export interface LanguageResourcesCatalog {
  schema_version: number;
  generated_at: string;
  title: string;
  scope: {
    intent: string;
    language_key_policy: string;
    coverage_policy: string;
    inclusion_rules: string[];
  };
  coverage_stats: {
    language_code_count: number;
    reusable_language_count: number;
    link_only_language_count: number;
    source_family_count: number;
    course_or_catalog_entries: number;
  };
  source_families: Record<string, ResourceSourceFamily>;
  languages: Record<string, LanguageResourceGroup>;
  follow_up_research: string[];
}

export interface ApiClient {
  signup(body: JsonObject): Promise<AuthResponse>;
  login(body: JsonObject): Promise<AuthResponse>;
  localSession(): Promise<AuthResponse>;
  getProfile(): Promise<Profile>;
  updateProfile(body: JsonObject): Promise<Profile>;
  getConversations(): Promise<Conversation[]>;
  createConversation(body: CreateConversationRequest): Promise<Conversation>;
  updateLanguages(conversationId: string, body: UpdateLanguagesRequest): Promise<Conversation>;
  markConversationRead(conversationId: string): Promise<{ ok: boolean }>;
  getMessages(conversationId: string, params?: Record<string, string>): Promise<Message[]>;
  checkMessage(
    conversationId: string,
    text: string,
    language?: string,
  ): Promise<CheckMessageResponse>;
  explainErrors(conversationId: string, body: ExplainErrorsRequest): Promise<unknown>;
  sendMessage(
    conversationId: string,
    text: string,
    language: string,
    intent?: string,
    selfCorrectedSpans?: SelfCorrectedSpan[],
  ): Promise<{ message: Message; agent_message?: Message; agent_error?: string }>;
  translateMessages(conversationId: string, languages: string[]): Promise<Message[]>;
  fetchMessageAudio(conversationId: string, messageId: string, lang: string): Promise<string>;
  getAgentConnectors(): Promise<AgentConnector[]>;
  createAgentConnector(body: AgentConnectorPayload): Promise<AgentConnector>;
  updateAgentConnector(
    connectorId: string,
    body: Partial<AgentConnectorPayload>,
  ): Promise<AgentConnector>;
  deleteAgentConnector(connectorId: string): Promise<{ ok: boolean }>;
  testAgentConnector(connectorId: string): Promise<AgentConnectorTestResult>;
  setConversationConnector(conversationId: string, agentConnectorId: string): Promise<Conversation>;
  getProfileLanguages(): Promise<ProfileLanguageSummary[]>;
  getLanguageStats(language: string): Promise<LanguageStatsResponse>;
  getDimensionItems(
    language: string,
    dimension: string,
    params?: Record<string, string>,
  ): Promise<DimensionItemsResponse>;
  getProfileItem(
    itemType: ItemType,
    itemId: string,
    language?: string,
  ): Promise<ProfileItemResponse>;
  getProfileItemReference(
    itemType: ItemType,
    itemId: string,
    language?: string,
  ): Promise<ItemReferenceResponse>;
  fetchProfileItemAudio(itemType: ItemType, itemId: string, language?: string): Promise<string>;
  lookupDictionary(
    term: string,
    language: string,
    options?: { recordSeen?: boolean },
  ): Promise<DictionaryLookupResponse>;
  translateDictionary(
    term: string,
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<DictionaryTranslationResponse>;
  fetchDictionaryAudio(term: string, language: string): Promise<string>;
  analyzeWorkbench(body: WorkbenchAnalyzeRequest): Promise<WorkbenchAnalyzeResponse>;
  fetchWorkbenchAudio(text: string, language?: string): Promise<WorkbenchAudioResponse>;
  recordWorkbenchInteraction(
    body: WorkbenchInteractionRequest,
  ): Promise<WorkbenchInteractionResponse>;
  getExerciseSession(language: string, limit?: number): Promise<ExerciseSessionResponse>;
  submitExerciseAttempt(
    attemptId: string,
    body: { answer: string },
  ): Promise<ExerciseSubmissionResponse>;
  getExerciseHistory(language: string, limit?: number): Promise<ExerciseHistoryResponse>;
  getDueReview(language: string): Promise<unknown>;
  getFSRSConfig(language: string): Promise<FSRSConfigResponse>;
  updateFSRSConfig(language: string, body: JsonObject): Promise<FSRSConfigResponse>;
  tuneFSRSConfig(language: string, body?: JsonObject): Promise<FSRSConfigResponse>;
  reviewVocabulary(vocabId: string, quality: number): Promise<unknown>;
  reviewGrammar(gapId: string, quality: number): Promise<unknown>;
  getLanguageResources(): Promise<LanguageResourcesCatalog>;
}
