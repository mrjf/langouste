import type { Database } from "../../lib/db/index.ts";
import { ALL_DIMENSIONS, dimensionForCategory, type Dimension } from "./dimensions.ts";

export interface DimensionStat {
  dimension: Dimension;
  // Placeholder band + confidence until the Phase-1 estimator ships.
  band: string | null;
  confidence: number | null;
  evidence_count: number;
  ready: boolean; // false = "not enough data / pipeline not live yet"
}

export interface LanguageStats {
  language: string;
  messages_sent: number;
  vocab_total: number;
  vocab_by_cefr: Record<string, number>;
  vocab_mastered: number;         // repetitions >= 3 AND correct recent
  vocab_struggling: number;       // correct_productions / productions < 0.5, productions >= 2
  grammar_gap_total: number;
  grammar_gap_active: number;     // error_count > correct_productions
  corrections_count: number;
  activity_30d: Array<{ date: string; messages: number }>;
  dimensions: DimensionStat[];
}

export async function languageStats(
  db: Database,
  userId: string,
  language: string,
): Promise<LanguageStats> {
  const [
    messages,
    vocab,
    gaps,
    activity,
  ] = await Promise.all([
    db.select<{ message_id: string; corrections: unknown[] | null; created_at: string }>(
      "messages",
      {
        columns: "message_id, corrections, created_at",
        filters: [
          { op: "eq", column: "sender_id", value: userId },
          { op: "eq", column: "language", value: language },
        ],
      },
    ),
    db.select<VocabRow>("vocabulary", {
      filters: [
        { op: "eq", column: "user_id", value: userId },
        { op: "eq", column: "language", value: language },
      ],
    }),
    db.select<GapRow>("grammar_gaps", {
      filters: [
        { op: "eq", column: "user_id", value: userId },
        { op: "eq", column: "language", value: language },
      ],
    }),
    db.select<{ created_at: string }>("messages", {
      columns: "created_at",
      filters: [
        { op: "eq", column: "sender_id", value: userId },
        { op: "eq", column: "language", value: language },
        { op: "lte", column: "created_at", value: new Date().toISOString() },
      ],
    }),
  ]);

  const vocab_by_cefr: Record<string, number> = {};
  let vocab_mastered = 0;
  let vocab_struggling = 0;
  for (const v of vocab) {
    const band = v.cefr_level ?? "unknown";
    vocab_by_cefr[band] = (vocab_by_cefr[band] ?? 0) + 1;
    if (v.repetitions >= 3) vocab_mastered++;
    if (v.productions >= 2 && v.correct_productions / v.productions < 0.5) {
      vocab_struggling++;
    }
  }

  let corrections_count = 0;
  for (const m of messages) {
    if (Array.isArray(m.corrections)) corrections_count += m.corrections.length;
  }

  const gap_active = gaps.filter(
    (g) => g.error_count > (g.correct_productions ?? 0),
  ).length;

  const activity_30d = bucketBy30Days(activity.map((a) => a.created_at));

  const dimensions = buildDimensions(vocab, gaps);

  return {
    language,
    messages_sent: messages.length,
    vocab_total: vocab.length,
    vocab_by_cefr,
    vocab_mastered,
    vocab_struggling,
    grammar_gap_total: gaps.length,
    grammar_gap_active: gap_active,
    corrections_count,
    activity_30d,
    dimensions,
  };
}

interface VocabRow {
  vocab_id: string;
  term: string;
  cefr_level: string | null;
  repetitions: number;
  productions: number;
  correct_productions: number;
  encounters: number;
}

interface GapRow {
  gap_id: string;
  category: string;
  error_count: number;
  correct_productions: number;
  repetitions: number;
}

function bucketBy30Days(timestamps: string[]): Array<{ date: string; messages: number }> {
  const out: Record<string, number> = {};
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out[key] = 0;
  }
  for (const ts of timestamps) {
    const key = ts.slice(0, 10);
    if (key in out) out[key]++;
  }
  return Object.entries(out).map(([date, messages]) => ({ date, messages }));
}

function buildDimensions(vocab: VocabRow[], gaps: GapRow[]): DimensionStat[] {
  const evidence: Record<Dimension, number> = {
    phonology: 0,
    orthography: 0,
    morphology: 0,
    syntax: 0,
    lexis: vocab.length,
    pragmatics: 0,
    discourse: 0,
  };

  for (const g of gaps) {
    const d = dimensionForCategory(g.category);
    evidence[d] = (evidence[d] ?? 0) + 1;
  }

  // Today we have no band estimator. Emit counts + "not ready" for every
  // dimension; the UI surfaces this honestly.
  return ALL_DIMENSIONS.map((dimension) => ({
    dimension,
    band: null,
    confidence: null,
    evidence_count: evidence[dimension] ?? 0,
    ready: false,
  }));
}
