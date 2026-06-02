/**
 * FSRS-6 concept scheduler.
 *
 * Based on the Open Spaced Repetition FSRS-6 D/S/R model:
 * - Difficulty: how hard the concept is for this learner.
 * - Stability: days until retrievability decays to 90%.
 * - Retrievability: probability of recall at review time.
 *
 * This module intentionally schedules atomic concepts, not UI cards. A
 * vocabulary item, grammar gap, cloze, listening prompt, and production
 * exercise can all point at the same concept_id and update one memory state.
 */

export type FSRSRating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy

export interface FSRSConceptState {
  difficulty: number;
  stability: number;
  last_reviewed_at: string | null;
  repetitions: number;
  lapses: number;
}

export interface FSRSResult {
  difficulty: number;
  stability: number;
  retrievability: number;
  interval_days: number;
  repetitions: number;
  lapses: number;
  next_review_at: Date;
}

export interface FSRSSchedulerOptions {
  parameters?: readonly number[];
  requestRetention?: number;
  maximumIntervalDays?: number;
  failureReviewDelayMinutes?: number;
}

export const DEFAULT_FSRS_PARAMETERS = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
  0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
]) satisfies readonly number[];

export const FSRS_PARAMETER_BOUNDS = Object.freeze([
  [0.001, 100],
  [0.001, 100],
  [0.001, 100],
  [0.001, 100],
  [1, 10],
  [0.001, 4],
  [0.001, 4],
  [0.001, 0.75],
  [0, 4.5],
  [0, 0.8],
  [0.001, 3.5],
  [0.001, 5],
  [0.001, 0.25],
  [0.001, 0.9],
  [0, 4],
  [0, 1],
  [1, 6],
  [0, 2],
  [0, 2],
  [0.01, 0.8],
  [0.1, 0.8],
]) satisfies readonly (readonly [number, number])[];

const MIN_STABILITY = 0.001;
const MAX_STABILITY = 36500;
const MIN_DIFFICULTY = 1;
const MAX_DIFFICULTY = 10;
export const DEFAULT_REQUEST_RETENTION = 0.9;
export const DEFAULT_MAXIMUM_INTERVAL_DAYS = 36500;
export const DEFAULT_FAILURE_REVIEW_DELAY_MINUTES = 10;

export function qualityToFSRSRating(quality: number): FSRSRating {
  if (!Number.isFinite(quality) || quality < 0 || quality > 5) {
    throw new Error(`Quality must be 0-5, got ${quality}`);
  }
  if (quality < 3) return 1;
  if (quality === 3) return 2;
  if (quality === 4) return 3;
  return 4;
}

export function fsrsSchedule(
  state: FSRSConceptState | null,
  quality: number,
  now = new Date(),
  schedulerOptions: readonly number[] | FSRSSchedulerOptions = DEFAULT_FSRS_PARAMETERS,
): FSRSResult {
  const options = normalizeSchedulerOptions(schedulerOptions);
  const { parameters } = options;
  if (parameters.length !== 21) {
    throw new Error(`FSRS-6 requires 21 parameters, got ${parameters.length}`);
  }

  const rating = qualityToFSRSRating(quality);
  const elapsedDays = elapsedDaysSince(state?.last_reviewed_at ?? null, now);
  const previous =
    state && state.stability > 0 && state.difficulty > 0
      ? {
          stability: clamp(state.stability, MIN_STABILITY, MAX_STABILITY),
          difficulty: clamp(state.difficulty, MIN_DIFFICULTY, MAX_DIFFICULTY),
        }
      : null;

  const retrievability = previous
    ? forgettingCurve(elapsedDays, previous.stability, parameters)
    : 1;
  const next = nextMemoryState(previous, elapsedDays, rating, retrievability, parameters);
  const intervalDays =
    rating === 1
      ? 0
      : Math.min(
          Math.max(
            1,
            Math.round(next.stability * intervalModifier(parameters, options.requestRetention)),
          ),
          options.maximumIntervalDays,
        );

  return {
    difficulty: next.difficulty,
    stability: next.stability,
    retrievability,
    interval_days: intervalDays,
    repetitions: rating === 1 ? 0 : (state?.repetitions ?? 0) + 1,
    lapses: (state?.lapses ?? 0) + (rating === 1 ? 1 : 0),
    next_review_at:
      rating === 1
        ? new Date(now.getTime() + options.failureReviewDelayMinutes * 60 * 1000)
        : new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000),
  };
}

export function validateFSRSParameters(parameters: readonly unknown[]): number[] {
  if (parameters.length !== 21) {
    throw new Error(`FSRS-6 requires 21 parameters, got ${parameters.length}`);
  }
  return parameters.map((value, index) => {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
      throw new Error(`FSRS parameter ${index} must be a finite number`);
    }
    return numberValue;
  });
}

export function clampFSRSParameters(parameters: readonly unknown[]): number[] {
  return validateFSRSParameters(parameters).map((value, index) => {
    const [min, max] = FSRS_PARAMETER_BOUNDS[index];
    return clamp(value, min, max);
  });
}

export function forgettingCurve(
  elapsedDays: number,
  stability: number,
  parameters: readonly number[] = DEFAULT_FSRS_PARAMETERS,
): number {
  if (stability <= 0) return 0;
  const decay = -parameters[20];
  const factor = Math.exp(Math.log(0.9) / decay) - 1;
  return round((1 + (factor * elapsedDays) / stability) ** decay);
}

function nextMemoryState(
  state: { difficulty: number; stability: number } | null,
  elapsedDays: number,
  rating: FSRSRating,
  retrievability: number,
  w: readonly number[],
): { difficulty: number; stability: number } {
  if (!state) {
    return {
      difficulty: clamp(initDifficulty(rating, w), MIN_DIFFICULTY, MAX_DIFFICULTY),
      stability: Math.max(w[rating - 1], 0.1),
    };
  }

  const stability =
    elapsedDays === 0
      ? shortTermStability(state.stability, rating, w)
      : rating === 1
        ? forgetStability(state.difficulty, state.stability, retrievability, w)
        : recallStability(state.difficulty, state.stability, retrievability, rating, w);

  return {
    difficulty: nextDifficulty(state.difficulty, rating, w),
    stability: clamp(stability, MIN_STABILITY, MAX_STABILITY),
  };
}

function intervalModifier(w: readonly number[], requestRetention: number): number {
  const decay = -w[20];
  const factor = Math.exp(Math.log(0.9) / decay) - 1;
  return round((requestRetention ** (1 / decay) - 1) / factor);
}

function initDifficulty(rating: FSRSRating, w: readonly number[]): number {
  return round(w[4] - Math.exp((rating - 1) * w[5]) + 1);
}

function nextDifficulty(difficulty: number, rating: FSRSRating, w: readonly number[]): number {
  const delta = -w[6] * (rating - 3);
  const damped = difficulty + (delta * (10 - difficulty)) / 9;
  const reverted = w[7] * initDifficulty(4, w) + (1 - w[7]) * damped;
  return clamp(round(reverted), MIN_DIFFICULTY, MAX_DIFFICULTY);
}

function recallStability(
  difficulty: number,
  stability: number,
  retrievability: number,
  rating: FSRSRating,
  w: readonly number[],
): number {
  const hardPenalty = rating === 2 ? w[15] : 1;
  const easyBonus = rating === 4 ? w[16] : 1;
  return round(
    stability *
      (1 +
        Math.exp(w[8]) *
          (11 - difficulty) *
          stability ** -w[9] *
          (Math.exp((1 - retrievability) * w[10]) - 1) *
          hardPenalty *
          easyBonus),
  );
}

function forgetStability(
  difficulty: number,
  stability: number,
  retrievability: number,
  w: readonly number[],
): number {
  const failed =
    w[11] *
    difficulty ** -w[12] *
    ((stability + 1) ** w[13] - 1) *
    Math.exp((1 - retrievability) * w[14]);
  const shortTermFloor = stability / Math.exp(w[17] * w[18]);
  return clamp(round(shortTermFloor), MIN_STABILITY, failed);
}

function shortTermStability(stability: number, rating: FSRSRating, w: readonly number[]): number {
  const increase = stability ** -w[19] * Math.exp(w[17] * (rating - 3 + w[18]));
  const maskedIncrease = rating >= 2 ? Math.max(increase, 1) : increase;
  return round(stability * maskedIncrease);
}

function elapsedDaysSince(iso: string | null, now: Date): number {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.round((now.getTime() - then) / (24 * 60 * 60 * 1000)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number): number {
  return Math.round(value * 100000000) / 100000000;
}

function normalizeSchedulerOptions(
  input: readonly number[] | FSRSSchedulerOptions,
): Required<FSRSSchedulerOptions> {
  if (Array.isArray(input)) {
    return {
      parameters: input,
      requestRetention: DEFAULT_REQUEST_RETENTION,
      maximumIntervalDays: DEFAULT_MAXIMUM_INTERVAL_DAYS,
      failureReviewDelayMinutes: DEFAULT_FAILURE_REVIEW_DELAY_MINUTES,
    };
  }

  const parameters = input.parameters ?? DEFAULT_FSRS_PARAMETERS;
  const requestRetention = input.requestRetention ?? DEFAULT_REQUEST_RETENTION;
  const maximumIntervalDays = input.maximumIntervalDays ?? DEFAULT_MAXIMUM_INTERVAL_DAYS;
  const failureReviewDelayMinutes =
    input.failureReviewDelayMinutes ?? DEFAULT_FAILURE_REVIEW_DELAY_MINUTES;

  if (!Number.isFinite(requestRetention) || requestRetention <= 0 || requestRetention >= 1) {
    throw new Error(`requestRetention must be between 0 and 1, got ${requestRetention}`);
  }
  if (!Number.isFinite(maximumIntervalDays) || maximumIntervalDays < 1) {
    throw new Error(`maximumIntervalDays must be >= 1, got ${maximumIntervalDays}`);
  }
  if (!Number.isFinite(failureReviewDelayMinutes) || failureReviewDelayMinutes < 1) {
    throw new Error(`failureReviewDelayMinutes must be >= 1, got ${failureReviewDelayMinutes}`);
  }

  return {
    parameters,
    requestRetention,
    maximumIntervalDays,
    failureReviewDelayMinutes,
  };
}
