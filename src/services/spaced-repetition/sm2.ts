/**
 * SM-2 spaced repetition algorithm.
 * Pure function — no side effects, no database access.
 *
 * Quality scale:
 *   0 = complete blackout
 *   1 = incorrect, but remembered upon seeing the answer
 *   2 = incorrect, but the answer felt easy to recall
 *   3 = correct, but with serious difficulty
 *   4 = correct, after some hesitation
 *   5 = perfect, instant recall
 */

export interface SM2Item {
  ease_factor: number;
  interval_days: number;
  repetitions: number;
}

export interface SM2Result extends SM2Item {
  next_review_at: Date;
}

export function sm2(item: SM2Item, quality: number): SM2Result {
  if (quality < 0 || quality > 5) {
    throw new Error(`Quality must be 0-5, got ${quality}`);
  }

  const now = new Date();

  // Failed recall: reset repetitions and interval
  if (quality < 3) {
    return {
      ease_factor: Math.max(1.3, item.ease_factor - 0.2),
      interval_days: 0,
      repetitions: 0,
      next_review_at: now, // review again immediately
    };
  }

  // Successful recall
  const repetitions = item.repetitions + 1;
  let interval_days: number;

  if (repetitions === 1) {
    interval_days = 1;
  } else if (repetitions === 2) {
    interval_days = 6;
  } else {
    interval_days = Math.round(item.interval_days * item.ease_factor);
  }

  // Update ease factor using SM-2 formula
  const ease_factor = Math.max(
    1.3,
    item.ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  );

  const next_review_at = new Date(now.getTime() + interval_days * 24 * 60 * 60 * 1000);

  return { ease_factor, interval_days, repetitions, next_review_at };
}
