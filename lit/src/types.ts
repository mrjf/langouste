export type LitSystem =
  | "orthography"
  | "latin"
  | "roman"
  | "romanization"
  | "ascii"
  | "ipa"
  | (string & {});

export interface LitEndpoint {
  system: LitSystem;
  language?: string;
  script?: string;
  variant?: string;
}

export interface LitDictionaryLookupInput {
  text: string;
  from: LitEndpoint;
  to: LitEndpoint;
}

export interface LitDictionaryResult {
  text: string;
  source?: string;
  confidence?: number;
}

export interface LitDictionary {
  readonly id: string;
  lookup(input: LitDictionaryLookupInput): LitDictionaryResult | null | Promise<LitDictionaryResult | null>;
}

export interface LitRequest {
  from?: Partial<LitEndpoint>;
  to: LitEndpoint;
  dictionaries?: LitDictionary[];
}

export interface NormalizedLitRequest {
  from: LitEndpoint;
  to: LitEndpoint;
  dictionaries: LitDictionary[];
}

export interface LitResult {
  text: string;
  from: LitEndpoint;
  to: LitEndpoint;
  provider: string;
  deterministic: true;
  confidence?: number;
  warnings?: string[];
}

export interface LitProvider {
  readonly id: string;
  supports(request: NormalizedLitRequest): boolean;
  transliterate(texts: string[], request: NormalizedLitRequest): Promise<LitResult[]>;
}
