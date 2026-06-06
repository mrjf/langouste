declare module "@piper-plus/g2p" {
  export type Language = "ja" | "en" | "zh" | "ko" | "es" | "fr" | "pt" | "sv";

  export interface PhonemizeResult {
    tokens: string[];
    prosody: unknown[];
    language: Language;
  }

  export interface G2POptions {
    languages?: Language[];
    openjtalkModule?: unknown;
    jaDict?: unknown;
    customDicts?: unknown[];
  }

  export class G2P {
    static create(options?: G2POptions): Promise<G2P>;
    phonemize(text: string, options?: { language?: Language }): PhonemizeResult;
    dispose(): void;
  }
}
