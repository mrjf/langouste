import { createId } from "./id";
import { FiloTier, matchesQuery } from "./tier";
import type {
  AnnotationQuery,
  ByteOffset,
  ByteRange,
  FiloAnnotation,
  FiloAnnotationInput,
  FiloDocumentJson,
  FiloTierJson,
  FiloTierSpec,
  RangeLike,
  TierId,
} from "./types";
import { Utf8TextIndex, rangeContains, rangesOverlap } from "./utf8";

export class FiloDocument<Metadata = Record<string, unknown>> {
  readonly id: string;
  readonly text: string;
  readonly metadata: Metadata;

  private readonly textIndex: Utf8TextIndex;
  private readonly tierMap = new Map<TierId, FiloTier<unknown>>();

  constructor(text: string, options: { id?: string; metadata?: Metadata } = {}) {
    this.id = options.id ?? createId("document");
    this.text = text;
    this.metadata = (options.metadata ?? {}) as Metadata;
    this.textIndex = new Utf8TextIndex(text);
  }

  static fromText<Metadata = Record<string, unknown>>(
    text: string,
    options: { id?: string; metadata?: Metadata } = {},
  ): FiloDocument<Metadata> {
    return new FiloDocument(text, options);
  }

  static fromJSON<Metadata = Record<string, unknown>>(
    json: FiloDocumentJson<Metadata>,
  ): FiloDocument<Metadata> {
    const document = new FiloDocument(json.text, { id: json.id, metadata: json.metadata });
    if (document.byteLength !== json.byteLength) {
      throw new Error(`Serialized byteLength ${json.byteLength} does not match document text`);
    }
    for (const tierJson of json.tiers) {
      const tier = FiloTier.fromJSON(tierJson as FiloTierJson<unknown>);
      document.tierMap.set(tier.id, tier);
      for (const annotation of tier.annotations) {
        document.assertRange(annotation);
      }
    }
    return document;
  }

  get byteLength(): number {
    return this.textIndex.byteLength;
  }

  byteOffsetForStringIndex(stringIndex: number): ByteOffset {
    return this.textIndex.byteOffsetForStringIndex(stringIndex);
  }

  stringIndexForByteOffset(byteOffset: ByteOffset): number {
    return this.textIndex.stringIndexForByteOffset(byteOffset);
  }

  isByteBoundary(byteOffset: ByteOffset): boolean {
    return this.textIndex.isByteBoundary(byteOffset);
  }

  assertRange(range: ByteRange): void {
    this.textIndex.assertRange(range);
  }

  textOf(range: RangeLike): string {
    return this.textIndex.slice(range);
  }

  byteRangeForStringIndices(startStringIndex: number, endStringIndex: number): ByteRange {
    return this.textIndex.rangeForStringIndices(startStringIndex, endStringIndex);
  }

  defineTier<Payload = Record<string, unknown>>(spec: FiloTierSpec): FiloTier<Payload> {
    if (this.tierMap.has(spec.id)) {
      throw new Error(`Tier already exists: ${spec.id}`);
    }
    const tier = new FiloTier<Payload>(spec);
    this.tierMap.set(spec.id, tier as FiloTier<unknown>);
    return tier;
  }

  ensureTier<Payload = Record<string, unknown>>(spec: FiloTierSpec): FiloTier<Payload> {
    const existing = this.tierMap.get(spec.id);
    if (existing) return existing as FiloTier<Payload>;
    return this.defineTier<Payload>(spec);
  }

  tier<Payload = Record<string, unknown>>(tierId: TierId): FiloTier<Payload> | null {
    return (this.tierMap.get(tierId) as FiloTier<Payload> | undefined) ?? null;
  }

  requireTier<Payload = Record<string, unknown>>(tierId: TierId): FiloTier<Payload> {
    const tier = this.tier<Payload>(tierId);
    if (!tier) throw new Error(`Unknown tier: ${tierId}`);
    return tier;
  }

  addAnnotation<Payload = Record<string, unknown>>(
    tierId: TierId,
    input: FiloAnnotationInput<Payload>,
  ): FiloAnnotation<Payload> {
    this.assertRange(input);
    const tier = this.requireTier<Payload>(tierId);
    return tier.add(input);
  }

  tiers(): FiloTier<unknown>[] {
    return [...this.tierMap.values()];
  }

  annotations(query: AnnotationQuery = {}): Array<FiloAnnotation<unknown>> {
    return this.tiers()
      .flatMap((tier) => tier.annotations)
      .filter((annotation) => matchesQuery(annotation, query));
  }

  annotationsAt(byteOffset: ByteOffset, query: AnnotationQuery = {}): Array<FiloAnnotation<unknown>> {
    if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset > this.byteLength) {
      throw new RangeError(`Byte offset ${byteOffset} is outside document`);
    }
    return this.annotations(query).filter(
      (annotation) =>
        annotation.start === annotation.end
          ? annotation.start === byteOffset
          : annotation.start <= byteOffset && byteOffset < annotation.end,
    );
  }

  annotationsOverlapping(
    range: ByteRange,
    query: AnnotationQuery = {},
  ): Array<FiloAnnotation<unknown>> {
    this.assertRange(range);
    return this.annotations(query).filter((annotation) => rangesOverlap(annotation, range));
  }

  annotationsWithin(range: ByteRange, query: AnnotationQuery = {}): Array<FiloAnnotation<unknown>> {
    this.assertRange(range);
    return this.annotations(query).filter((annotation) => rangeContains(range, annotation));
  }

  annotationsAtRange(range: ByteRange, query: AnnotationQuery = {}): Array<FiloAnnotation<unknown>> {
    this.assertRange(range);
    return this.annotations(query).filter(
      (annotation) => annotation.start === range.start && annotation.end === range.end,
    );
  }

  toJSON(): FiloDocumentJson<Metadata> {
    return {
      id: this.id,
      text: this.text,
      byteLength: this.byteLength,
      metadata: this.metadata,
      tiers: this.tiers().map((tier) => tier.toJSON() as FiloTierJson),
    };
  }
}
