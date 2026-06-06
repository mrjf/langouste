import { createId } from "./id";
import type {
  AnnotationKind,
  AnnotationQuery,
  ByteRange,
  FiloAnnotation,
  FiloAnnotationInput,
  FiloSource,
  FiloTierJson,
  FiloTierSpec,
  TierId,
} from "./types";
import { rangeContains, rangeEquals, rangesOverlap } from "./utf8";

export class FiloTier<Payload = Record<string, unknown>> {
  readonly id: TierId;
  readonly kind: AnnotationKind;
  readonly description?: string;
  readonly source: string;
  readonly sourceInfo?: FiloSource;
  readonly metadata: Record<string, unknown>;

  private readonly annotationList: Array<FiloAnnotation<Payload>> = [];

  constructor(spec: FiloTierSpec) {
    this.id = spec.id;
    this.kind = spec.kind;
    if (spec.description !== undefined) this.description = spec.description;
    this.source = spec.source ?? spec.sourceInfo?.id ?? "unknown";
    if (spec.sourceInfo !== undefined) this.sourceInfo = spec.sourceInfo;
    this.metadata = spec.metadata ?? {};
  }

  get annotations(): Array<FiloAnnotation<Payload>> {
    return [...this.annotationList].sort(compareAnnotations);
  }

  add(input: FiloAnnotationInput<Payload>): FiloAnnotation<Payload> {
    const annotation: FiloAnnotation<Payload> = {
      id: input.id ?? createId(`${this.id}-annotation`),
      tierId: this.id,
      kind: input.kind ?? this.kind,
      start: input.start,
      end: input.end,
      payload: input.payload,
    };
    if (input.confidence !== undefined) annotation.confidence = input.confidence;
    annotation.source = input.source ?? this.source;
    if (input.sourceInfo !== undefined) annotation.sourceInfo = input.sourceInfo;
    this.annotationList.push(annotation);
    return annotation;
  }

  overlapping(range: ByteRange, query: AnnotationQuery = {}): Array<FiloAnnotation<Payload>> {
    return this.annotations.filter(
      (annotation) => matchesQuery(annotation, query) && rangesOverlap(annotation, range),
    );
  }

  within(range: ByteRange, query: AnnotationQuery = {}): Array<FiloAnnotation<Payload>> {
    return this.annotations.filter(
      (annotation) => matchesQuery(annotation, query) && rangeContains(range, annotation),
    );
  }

  at(range: ByteRange, query: AnnotationQuery = {}): Array<FiloAnnotation<Payload>> {
    return this.annotations.filter(
      (annotation) => matchesQuery(annotation, query) && rangeEquals(annotation, range),
    );
  }

  containing(range: ByteRange, query: AnnotationQuery = {}): Array<FiloAnnotation<Payload>> {
    return this.annotations.filter(
      (annotation) => matchesQuery(annotation, query) && rangeContains(annotation, range),
    );
  }

  toJSON(): FiloTierJson<Payload> {
    return {
      id: this.id,
      kind: this.kind,
      metadata: this.metadata,
      annotations: this.annotations,
      source: this.source,
      ...(this.description !== undefined ? { description: this.description } : {}),
      ...(this.sourceInfo !== undefined ? { sourceInfo: this.sourceInfo } : {}),
    };
  }

  static fromJSON<Payload = Record<string, unknown>>(json: FiloTierJson<Payload>): FiloTier<Payload> {
    const tier = new FiloTier<Payload>(json);
    for (const annotation of json.annotations) {
      tier.add(annotation);
    }
    return tier;
  }
}

export function compareAnnotations(left: FiloAnnotation<unknown>, right: FiloAnnotation<unknown>) {
  return (
    left.start - right.start ||
    left.end - right.end ||
    left.tierId.localeCompare(right.tierId) ||
    left.id.localeCompare(right.id)
  );
}

export function matchesQuery(annotation: FiloAnnotation<unknown>, query: AnnotationQuery): boolean {
  if (query.tierIds && !query.tierIds.includes(annotation.tierId)) return false;
  if (query.kinds && !query.kinds.includes(annotation.kind)) return false;
  return true;
}
