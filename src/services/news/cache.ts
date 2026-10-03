import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface CacheEnvelope<T> {
  createdAt: string;
  value: T;
}

export interface StoredCacheEntry<T> extends CacheEnvelope<T> {
  key: string;
}

export class JsonFileCache {
  constructor(
    private readonly directory: string,
    private readonly ttlMs = 6 * 60 * 60 * 1000,
  ) {}

  keyFor(value: unknown): string {
    return createHash("sha256").update(stableStringify(value)).digest("hex");
  }

  async get<T>(key: string): Promise<T | null> {
    const envelope = await this.read<T>(key);
    if (!envelope) return null;
    const age = Date.now() - Date.parse(envelope.createdAt);
    return Number.isFinite(age) && age >= 0 && age <= this.ttlMs ? envelope.value : null;
  }

  async getStored<T>(key: string): Promise<T | null> {
    return (await this.read<T>(key))?.value ?? null;
  }

  async listStored<T>(): Promise<Array<StoredCacheEntry<T>>> {
    try {
      const files = await readdir(this.directory);
      const entries = await Promise.all(
        files
          .filter((file) => /^[a-f0-9]{64}\.json$/u.test(file))
          .map(async (file): Promise<StoredCacheEntry<T> | null> => {
            const key = file.slice(0, -5);
            const envelope = await this.read<T>(key);
            return envelope ? { key, ...envelope } : null;
          }),
      );
      return entries.filter((entry): entry is StoredCacheEntry<T> => entry !== null);
    } catch {
      return [];
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.pathFor(key);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(
      temporary,
      JSON.stringify({ createdAt: new Date().toISOString(), value }),
      "utf8",
    );
    await rename(temporary, target);
  }

  private pathFor(key: string): string {
    if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error("Invalid cache key");
    return join(this.directory, `${key}.json`);
  }

  private async read<T>(key: string): Promise<CacheEnvelope<T> | null> {
    try {
      const envelope = JSON.parse(await readFile(this.pathFor(key), "utf8")) as CacheEnvelope<T>;
      if (typeof envelope.createdAt !== "string" || !("value" in envelope)) return null;
      return envelope;
    } catch {
      return null;
    }
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
