/**
 * In-process registry for test-mode stubs. Populated by /api/test/* routes,
 * consumed by the `stub` agent + the AI services when config.testMode is on.
 *
 * Not compiled in for production builds — import only from code paths gated
 * on `config.testMode`.
 */

export interface StubAgentResponse {
  /** The exact literal the stub should return for this input. */
  reply: string;
}

export interface StubExplainResponse {
  corrected_message: string;
  explanations: Array<{
    error_index: number;
    corrected: string;
    explanations: Record<string, string>;
  }>;
  additional_errors: Array<{
    start: number;
    end: number;
    text: string;
    corrected: string;
    kind: "grammar";
    explanations: Record<string, string>;
  }>;
}

export interface StubVocabResponse {
  new_vocabulary: Array<{
    term: string;
    translation: string;
    context_sentence: string | null;
    cefr_level: string | null;
  }>;
  grammar_gaps_detected: Array<{ category: string; description: string }>;
  next_challenge: string;
}

class TestRegistry {
  private agentReplies = new Map<string, string>();
  private defaultAgentReply: string | null = null;

  private explainResponses = new Map<string, StubExplainResponse>();
  private defaultExplainResponse: StubExplainResponse | null = null;

  private vocabResponses = new Map<string, StubVocabResponse>();
  private defaultVocabResponse: StubVocabResponse | null = null;

  private translations = new Map<string, string>();

  reset(): void {
    this.agentReplies.clear();
    this.defaultAgentReply = null;
    this.explainResponses.clear();
    this.defaultExplainResponse = null;
    this.vocabResponses.clear();
    this.defaultVocabResponse = null;
    this.translations.clear();
  }

  // --- Agent ---

  setAgentReply(prompt: string, reply: string): void {
    this.agentReplies.set(prompt.trim(), reply);
  }

  setDefaultAgentReply(reply: string): void {
    this.defaultAgentReply = reply;
  }

  getAgentReply(prompt: string): string {
    const exact = this.agentReplies.get(prompt.trim());
    if (exact !== undefined) return exact;
    if (this.defaultAgentReply !== null) return this.defaultAgentReply;
    return `[stub] ${prompt}`;
  }

  // --- Error explanation ---

  setExplainResponse(textKey: string, response: StubExplainResponse): void {
    this.explainResponses.set(textKey.trim(), response);
  }

  setDefaultExplainResponse(response: StubExplainResponse | null): void {
    this.defaultExplainResponse = response;
  }

  getExplainResponse(text: string): StubExplainResponse {
    const exact = this.explainResponses.get(text.trim());
    if (exact) return exact;
    if (this.defaultExplainResponse) return this.defaultExplainResponse;
    return {
      corrected_message: text,
      explanations: [],
      additional_errors: [],
    };
  }

  // --- Vocabulary extraction ---

  setVocabResponse(textKey: string, response: StubVocabResponse): void {
    this.vocabResponses.set(textKey.trim(), response);
  }

  setDefaultVocabResponse(response: StubVocabResponse | null): void {
    this.defaultVocabResponse = response;
  }

  getVocabResponse(text: string): StubVocabResponse {
    const exact = this.vocabResponses.get(text.trim());
    if (exact) return exact;
    if (this.defaultVocabResponse) return this.defaultVocabResponse;
    return { new_vocabulary: [], grammar_gaps_detected: [], next_challenge: "" };
  }

  // --- Translation ---

  setTranslation(text: string, targetLang: string, translation: string): void {
    this.translations.set(translationKey(text, targetLang), translation);
  }

  getTranslation(text: string, targetLang: string): string {
    const exact = this.translations.get(translationKey(text, targetLang));
    if (exact !== undefined) return exact;
    // Deterministic default: `[<lang>] <text>` so tests can tell translations
    // happened without demanding canned responses for every string.
    return `[${targetLang}] ${text}`;
  }
}

function translationKey(text: string, lang: string): string {
  return `${lang}::${text.trim()}`;
}

export const testRegistry = new TestRegistry();
