import type { ByteOffset, ByteRange } from "./types";

const textEncoder = new TextEncoder();

export class Utf8TextIndex {
  readonly text: string;
  readonly byteLength: number;

  private readonly stringIndexToByte = new Map<number, ByteOffset>();
  private readonly byteToStringIndex = new Map<ByteOffset, number>();

  constructor(text: string) {
    this.text = text;
    let byteOffset = 0;
    this.stringIndexToByte.set(0, 0);
    this.byteToStringIndex.set(0, 0);

    for (let stringIndex = 0; stringIndex < text.length; ) {
      const codePoint = text.codePointAt(stringIndex);
      if (codePoint === undefined) break;
      const char = String.fromCodePoint(codePoint);
      stringIndex += char.length;
      byteOffset += textEncoder.encode(char).byteLength;
      this.stringIndexToByte.set(stringIndex, byteOffset);
      this.byteToStringIndex.set(byteOffset, stringIndex);
    }

    this.byteLength = byteOffset;
  }

  byteOffsetForStringIndex(stringIndex: number): ByteOffset {
    const byteOffset = this.stringIndexToByte.get(stringIndex);
    if (byteOffset === undefined) {
      throw new RangeError(`String index ${stringIndex} is not a UTF-8 scalar boundary`);
    }
    return byteOffset;
  }

  stringIndexForByteOffset(byteOffset: ByteOffset): number {
    const stringIndex = this.byteToStringIndex.get(byteOffset);
    if (stringIndex === undefined) {
      throw new RangeError(`Byte offset ${byteOffset} is not a UTF-8 scalar boundary`);
    }
    return stringIndex;
  }

  isByteBoundary(byteOffset: ByteOffset): boolean {
    return this.byteToStringIndex.has(byteOffset);
  }

  assertRange(range: ByteRange): void {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
      throw new RangeError(`Byte range must use integer offsets: ${range.start}-${range.end}`);
    }
    if (range.start < 0 || range.end < 0) {
      throw new RangeError(`Byte range cannot be negative: ${range.start}-${range.end}`);
    }
    if (range.start > range.end) {
      throw new RangeError(`Byte range start must be <= end: ${range.start}-${range.end}`);
    }
    if (range.end > this.byteLength) {
      throw new RangeError(`Byte range ${range.start}-${range.end} exceeds ${this.byteLength}`);
    }
    if (!this.isByteBoundary(range.start) || !this.isByteBoundary(range.end)) {
      throw new RangeError(`Byte range must align to UTF-8 boundaries: ${range.start}-${range.end}`);
    }
  }

  slice(range: ByteRange): string {
    this.assertRange(range);
    return this.text.slice(
      this.stringIndexForByteOffset(range.start),
      this.stringIndexForByteOffset(range.end),
    );
  }

  rangeForStringIndices(startStringIndex: number, endStringIndex: number): ByteRange {
    return {
      start: this.byteOffsetForStringIndex(startStringIndex),
      end: this.byteOffsetForStringIndex(endStringIndex),
    };
  }
}

export function rangesOverlap(left: ByteRange, right: ByteRange): boolean {
  return left.start < right.end && right.start < left.end;
}

export function rangeContains(container: ByteRange, contained: ByteRange): boolean {
  return container.start <= contained.start && contained.end <= container.end;
}

export function rangeEquals(left: ByteRange, right: ByteRange): boolean {
  return left.start === right.start && left.end === right.end;
}
