import type { Database } from "../../lib/db/index.ts";
import type { LanguageCode } from "../../types/index.ts";
import { getFSRSConfig, type FSRSConfig, type QualityWeights, upsertFSRSConfig } from "./config.ts";

export interface TuningOptions {
  minEvidence?: number;
  limit?: number;
  dryRun?: boolean;
}

export interface SignalTuningRow {
  key: string;
  evidence: number;
  weighted_success_rate: number;
  current_quality: number | null;
  suggested_quality: number;
}

export interface TuningReport {
  applied: boolean;
  config: FSRSConfig;
  suggestions: SignalTuningRow[];
}

interface ReviewLogRow {
  concept_id: string | null;
  event_type: string;
  outcome: string | null;
  quality: number | null;
  source: string;
  observed_at: string;
}

interface PendingSignal {
  key: string;
  observedAt: number;
}

interface SignalStats {
  evidence: number;
  weightedSuccess: number;
  weightedTotal: number;
}

const DEFAULT_MIN_EVIDENCE = 6;
const DEFAULT_LIMIT = 5000;
const RECENCY_HALF_LIFE_DAYS = 60;

export async function tuneFSRSInteractionWeights(
  db: Database,
  userId: string,
  language: LanguageCode,
  options: TuningOptions = {},
): Promise<TuningReport> {
  const config = await getFSRSConfig(db, userId, language);
  const rows = await db.select<ReviewLogRow>("review_log", {
    columns: "concept_id,event_type,outcome,quality,source,observed_at",
    filters: [
      { op: "eq", column: "user_id", value: userId },
      { op: "eq", column: "language", value: language },
    ],
    order: [{ column: "observed_at", ascending: true }],
    limit: options.limit ?? DEFAULT_LIMIT,
  });

  const stats = collectSignalStats(rows);
  const suggestions = suggestQualityWeights(
    stats,
    config.quality_weights,
    options.minEvidence ?? DEFAULT_MIN_EVIDENCE,
  );

  if (options.dryRun || suggestions.length === 0) {
    return { applied: false, config, suggestions };
  }

  const qualityWeights = Object.fromEntries(
    suggestions.map((suggestion) => [suggestion.key, suggestion.suggested_quality]),
  );
  const updated = await upsertFSRSConfig(db, userId, language, { quality_weights: qualityWeights });
  return { applied: true, config: updated, suggestions };
}

function collectSignalStats(rows: ReviewLogRow[]): Map<string, SignalStats> {
  const pendingByConcept = new Map<string, PendingSignal[]>();
  const statsBySignal = new Map<string, SignalStats>();

  for (const row of rows) {
    if (!row.concept_id) continue;

    if (row.event_type === "recall" && typeof row.quality === "number") {
      const pending = pendingByConcept.get(row.concept_id) ?? [];
      if (pending.length === 0) continue;
      const success = row.quality >= 3 ? 1 : 0;
      const recallAt = Date.parse(row.observed_at);

      for (const signal of pending) {
        const ageDays = Number.isFinite(recallAt)
          ? Math.max(0, (recallAt - signal.observedAt) / (24 * 60 * 60 * 1000))
          : 0;
        const weight = 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS);
        const stats = statsBySignal.get(signal.key) ?? {
          evidence: 0,
          weightedSuccess: 0,
          weightedTotal: 0,
        };
        stats.evidence += 1;
        stats.weightedSuccess += success * weight;
        stats.weightedTotal += weight;
        statsBySignal.set(signal.key, stats);
      }
      pendingByConcept.delete(row.concept_id);
      continue;
    }

    if (row.event_type !== "production") continue;
    const key = signalKey(row);
    const pending = pendingByConcept.get(row.concept_id) ?? [];
    pending.push({ key, observedAt: Date.parse(row.observed_at) });
    pendingByConcept.set(row.concept_id, pending.slice(-5));
  }

  return statsBySignal;
}

function suggestQualityWeights(
  statsBySignal: Map<string, SignalStats>,
  current: QualityWeights,
  minEvidence: number,
): SignalTuningRow[] {
  return [...statsBySignal.entries()]
    .filter(([, stats]) => stats.evidence >= minEvidence && stats.weightedTotal > 0)
    .map(([key, stats]) => {
      const successRate = stats.weightedSuccess / stats.weightedTotal;
      return {
        key,
        evidence: stats.evidence,
        weighted_success_rate: round(successRate),
        current_quality: current[key] ?? null,
        suggested_quality: successRateToQuality(successRate),
      };
    })
    .filter((row) => row.current_quality !== row.suggested_quality)
    .sort((a, b) => b.evidence - a.evidence);
}

function signalKey(row: ReviewLogRow): string {
  return `${row.source}:${row.event_type}:${row.outcome ?? "none"}`;
}

function successRateToQuality(successRate: number): number {
  if (successRate < 0.35) return 1;
  if (successRate < 0.6) return 2;
  if (successRate < 0.78) return 3;
  if (successRate < 0.9) return 4;
  return 5;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
