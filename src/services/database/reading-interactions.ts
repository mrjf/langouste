import type { Database } from "../../lib/db/index.ts";

export type ReadingInteractionEvent =
  | "article_opened"
  | "sentence_hovered"
  | "sentence_inspected"
  | "word_hovered"
  | "vocabulary_inspected"
  | "audio_played"
  | "workbench_opened";

export interface ReadingInteractionVocabulary {
  term: string;
  translation: string;
  contextSentence: string;
  cefrLevel?: string;
}

export interface ReadingInteractionRow {
  interaction_id: string;
  user_id: string;
  document_id: string;
  source_type: string;
  source_id: string;
  source_url: string;
  title: string;
  language: string | null;
  event_type: ReadingInteractionEvent;
  sentence_ordinal: number | null;
  token_ordinal: number | null;
  vocabulary_ordinal: number | null;
  text: string;
  source_text: string;
  vocabulary: ReadingInteractionVocabulary[];
  metadata: Record<string, unknown>;
  observed_at: string;
}

export async function findReadingInteraction(
  db: Database,
  interactionId: string,
): Promise<ReadingInteractionRow | null> {
  return db.selectOne<ReadingInteractionRow>("reading_interactions", {
    filters: [{ op: "eq", column: "interaction_id", value: interactionId }],
  });
}

export async function createReadingInteraction(
  db: Database,
  row: Omit<ReadingInteractionRow, "observed_at">,
): Promise<ReadingInteractionRow> {
  return db.insert<ReadingInteractionRow>("reading_interactions", row);
}

export async function listReadingInteractions(
  db: Database,
  userId: string,
  options: { language?: string; limit?: number } = {},
): Promise<ReadingInteractionRow[]> {
  return db.select<ReadingInteractionRow>("reading_interactions", {
    filters: [
      { op: "eq", column: "user_id", value: userId },
      ...(options.language
        ? [{ op: "eq" as const, column: "language", value: options.language }]
        : []),
    ],
    order: [{ column: "observed_at", ascending: false }],
    limit: Math.min(Math.max(options.limit ?? 50, 1), 10_000),
  });
}
