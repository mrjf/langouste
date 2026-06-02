import type { Database } from "../../lib/db/index.ts";
import type { LanguageCode } from "../../types/index.ts";
import {
  DEFAULT_FAILURE_REVIEW_DELAY_MINUTES,
  DEFAULT_FSRS_PARAMETERS,
  DEFAULT_MAXIMUM_INTERVAL_DAYS,
  DEFAULT_REQUEST_RETENTION,
  type FSRSSchedulerOptions,
  clampFSRSParameters,
} from "./fsrs.ts";
import type { EventType, InteractionSource, Outcome } from "./interactions.ts";

export type QualityWeights = Record<string, number | null>;

export interface FSRSConfig {
  config_id: string | null;
  user_id: string;
  language: LanguageCode;
  parameters: number[];
  request_retention: number;
  maximum_interval_days: number;
  failure_review_delay_minutes: number;
  quality_weights: QualityWeights;
  created_at: string | null;
  updated_at: string | null;
}

export interface FSRSConfigPatch {
  parameters?: unknown[];
  request_retention?: unknown;
  maximum_interval_days?: unknown;
  failure_review_delay_minutes?: unknown;
  quality_weights?: Record<string, unknown>;
}

export interface InteractionSignal {
  eventType: EventType;
  outcome?: Outcome;
  quality?: number;
  source: InteractionSource;
}

export const DEFAULT_QUALITY_WEIGHTS: QualityWeights = Object.freeze({
  "production:correct": 4,
  "production:partial": 3,
  "production:incorrect": 1,
  "chat_produce:production:correct": 4,
  "chat_correct:production:incorrect": 1,
  "chat_self_correct:production:incorrect": 1,
  "exercise:production:correct": 4,
  "exercise:production:partial": 3,
  "exercise:production:incorrect": 1,
  encounter: null,
});

export async function getFSRSConfig(
  db: Database,
  userId: string,
  language: LanguageCode,
): Promise<FSRSConfig> {
  const row = await db.selectOne<Record<string, unknown>>("fsrs_configs", {
    filters: [
      { op: "eq", column: "user_id", value: userId },
      { op: "eq", column: "language", value: language },
    ],
  });
  return row ? toFSRSConfig(row, userId, language) : defaultFSRSConfig(userId, language);
}

export async function upsertFSRSConfig(
  db: Database,
  userId: string,
  language: LanguageCode,
  patch: FSRSConfigPatch,
): Promise<FSRSConfig> {
  const current = await getFSRSConfig(db, userId, language);
  const next = normalizeConfigPatch(current, patch);
  const now = new Date().toISOString();

  const row = await db.upsert<Record<string, unknown>>(
    "fsrs_configs",
    {
      user_id: userId,
      language,
      parameters: next.parameters,
      request_retention: next.request_retention,
      maximum_interval_days: next.maximum_interval_days,
      failure_review_delay_minutes: next.failure_review_delay_minutes,
      quality_weights: next.quality_weights,
      updated_at: now,
    },
    ["user_id", "language"],
  );
  return toFSRSConfig(row, userId, language);
}

export function schedulerOptionsFromConfig(config: FSRSConfig): FSRSSchedulerOptions {
  return {
    parameters: config.parameters,
    requestRetention: config.request_retention,
    maximumIntervalDays: config.maximum_interval_days,
    failureReviewDelayMinutes: config.failure_review_delay_minutes,
  };
}

export function resolveInteractionQuality(
  signal: InteractionSignal,
  config: FSRSConfig,
): number | null {
  if (signal.eventType === "recall") {
    return typeof signal.quality === "number" ? validateQuality(signal.quality) : null;
  }

  const outcome = signal.outcome ?? "none";
  const keys = [
    `${signal.source}:${signal.eventType}:${outcome}`,
    `${signal.source}:${signal.eventType}`,
    `${signal.eventType}:${outcome}`,
    signal.eventType,
  ];

  for (const key of keys) {
    if (Object.hasOwn(config.quality_weights, key)) {
      const quality = config.quality_weights[key];
      return quality == null ? null : validateQuality(quality);
    }
  }
  for (const key of keys) {
    if (Object.hasOwn(DEFAULT_QUALITY_WEIGHTS, key)) {
      const quality = DEFAULT_QUALITY_WEIGHTS[key];
      return quality == null ? null : validateQuality(quality);
    }
  }
  return null;
}

function defaultFSRSConfig(userId: string, language: LanguageCode): FSRSConfig {
  return {
    config_id: null,
    user_id: userId,
    language,
    parameters: [...DEFAULT_FSRS_PARAMETERS],
    request_retention: DEFAULT_REQUEST_RETENTION,
    maximum_interval_days: DEFAULT_MAXIMUM_INTERVAL_DAYS,
    failure_review_delay_minutes: DEFAULT_FAILURE_REVIEW_DELAY_MINUTES,
    quality_weights: { ...DEFAULT_QUALITY_WEIGHTS },
    created_at: null,
    updated_at: null,
  };
}

function normalizeConfigPatch(current: FSRSConfig, patch: FSRSConfigPatch): FSRSConfig {
  return {
    ...current,
    parameters:
      patch.parameters == null ? current.parameters : clampFSRSParameters(patch.parameters),
    request_retention:
      patch.request_retention == null
        ? current.request_retention
        : validateBoundedNumber("request_retention", patch.request_retention, 0, 1, false),
    maximum_interval_days:
      patch.maximum_interval_days == null
        ? current.maximum_interval_days
        : Math.round(
            validateMinimumNumber("maximum_interval_days", patch.maximum_interval_days, 1),
          ),
    failure_review_delay_minutes:
      patch.failure_review_delay_minutes == null
        ? current.failure_review_delay_minutes
        : Math.round(
            validateMinimumNumber(
              "failure_review_delay_minutes",
              patch.failure_review_delay_minutes,
              1,
            ),
          ),
    quality_weights:
      patch.quality_weights == null
        ? current.config_id
          ? current.quality_weights
          : {}
        : {
            ...(current.config_id ? current.quality_weights : {}),
            ...validateQualityWeights(patch.quality_weights),
          },
  };
}

function toFSRSConfig(
  row: Record<string, unknown>,
  userId: string,
  language: LanguageCode,
): FSRSConfig {
  return {
    config_id: (row.config_id as string | null | undefined) ?? null,
    user_id: (row.user_id as string | null | undefined) ?? userId,
    language: (row.language as string | null | undefined) ?? language,
    parameters: clampFSRSParameters(
      Array.isArray(row.parameters) ? row.parameters : DEFAULT_FSRS_PARAMETERS,
    ),
    request_retention: Number(row.request_retention ?? DEFAULT_REQUEST_RETENTION),
    maximum_interval_days: Number(row.maximum_interval_days ?? DEFAULT_MAXIMUM_INTERVAL_DAYS),
    failure_review_delay_minutes: Number(
      row.failure_review_delay_minutes ?? DEFAULT_FAILURE_REVIEW_DELAY_MINUTES,
    ),
    quality_weights: (row.quality_weights as QualityWeights | null | undefined) ?? {},
    created_at: (row.created_at as string | null | undefined) ?? null,
    updated_at: (row.updated_at as string | null | undefined) ?? null,
  };
}

function validateQualityWeights(input: Record<string, unknown>): QualityWeights {
  const out: QualityWeights = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isValidQualityWeightKey(key)) {
      throw new Error(`Invalid quality weight key: ${key}`);
    }
    out[key] = value == null ? null : validateQuality(value);
  }
  return out;
}

function isValidQualityWeightKey(key: string): boolean {
  const parts = key.split(":");
  return parts.length >= 1 && parts.length <= 3 && parts.every((part) => part.length > 0);
}

function validateQuality(value: unknown): number {
  return validateBoundedNumber("quality", value, 0, 5, true);
}

function validateMinimumNumber(name: string, value: unknown, min: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < min) {
    throw new Error(`${name} must be >= ${min}`);
  }
  return numberValue;
}

function validateBoundedNumber(
  name: string,
  value: unknown,
  min: number,
  max: number,
  inclusiveMax: boolean,
): number {
  const numberValue = Number(value);
  const maxOk = inclusiveMax ? numberValue <= max : numberValue < max;
  if (!Number.isFinite(numberValue) || numberValue < min || !maxOk) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return numberValue;
}
