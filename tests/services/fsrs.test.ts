import { describe, expect, test } from "bun:test";
import {
  forgettingCurve,
  fsrsSchedule,
  qualityToFSRSRating,
} from "../../src/services/spaced-repetition/fsrs.ts";

describe("FSRS", () => {
  test("maps 0-5 review quality to FSRS ratings", () => {
    expect(qualityToFSRSRating(0)).toBe(1);
    expect(qualityToFSRSRating(2)).toBe(1);
    expect(qualityToFSRSRating(3)).toBe(2);
    expect(qualityToFSRSRating(4)).toBe(3);
    expect(qualityToFSRSRating(5)).toBe(4);
  });

  test("first successful review initializes concept memory", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const result = fsrsSchedule(null, 4, now);

    expect(result.difficulty).toBeGreaterThan(0);
    expect(result.stability).toBeGreaterThan(0);
    expect(result.retrievability).toBe(1);
    expect(result.repetitions).toBe(1);
    expect(result.lapses).toBe(0);
    expect(result.interval_days).toBeGreaterThanOrEqual(1);
    expect(result.next_review_at.getTime()).toBeGreaterThan(now.getTime());
  });

  test("failed recall is a lapse and schedules a near-term retry", () => {
    const firstReviewAt = new Date("2026-01-01T00:00:00.000Z");
    const first = fsrsSchedule(null, 4, firstReviewAt);
    const failedAt = new Date("2026-01-02T00:00:00.000Z");
    const failed = fsrsSchedule(
      { ...first, last_reviewed_at: firstReviewAt.toISOString() },
      1,
      failedAt,
    );

    expect(failed.repetitions).toBe(0);
    expect(failed.lapses).toBe(1);
    expect(failed.interval_days).toBe(0);
    expect(failed.next_review_at.getTime() - failedAt.getTime()).toBe(10 * 60 * 1000);
  });

  test("retrievability decays as elapsed time grows", () => {
    const sameDay = forgettingCurve(0, 5);
    const later = forgettingCurve(7, 5);

    expect(sameDay).toBe(1);
    expect(later).toBeLessThan(sameDay);
    expect(later).toBeGreaterThan(0);
  });
});
