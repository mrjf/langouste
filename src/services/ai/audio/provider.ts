/**
 * Abstract interface for text-to-speech audio providers.
 * Implementations synthesise speech audio for a given text + language.
 */

export interface AudioSynthesisResult {
  /** Raw audio bytes ready to stream to the client. */
  audio: Uint8Array;
  /** MIME content type, e.g. "audio/mpeg", "audio/ogg". */
  contentType: string;
}

export interface AudioSynthesisOptions {
  /** ISO 639-1 language code of the text (e.g. "fr"). Some providers use it to pick a voice/accent. */
  language?: string;
  /** Provider-agnostic voice hint. Implementations resolve to a concrete voice. */
  voice?: string;
  /**
   * Requesting user. Unused today (env-backed voice resolution), but plumbed
   * through so a future per-user voice resolver needs no signature changes.
   */
  userId?: string;
}

export interface AudioProvider {
  /** Provider identifier (used for logging + capability checks). */
  readonly name: string;
  /** True when the provider is fully configured and can synthesise. */
  isAvailable(): boolean;
  /** Synthesise speech for the given text. */
  synthesize(text: string, opts?: AudioSynthesisOptions): Promise<AudioSynthesisResult>;
}
