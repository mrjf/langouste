import { expect, test, describe } from "bun:test";
import { sm2 } from "../../src/services/spaced-repetition/sm2.ts";
import type { SM2Item } from "../../src/services/spaced-repetition/sm2.ts";

const fresh: SM2Item = { ease_factor: 2.5, interval_days: 0, repetitions: 0 };

describe("SM2", () => {
  test("first successful review gives 1-day interval", () => {
    const result = sm2(fresh, 4);
    expect(result.repetitions).toBe(1);
    expect(result.interval_days).toBe(1);
  });

  test("second successful review gives 6-day interval", () => {
    const after1 = sm2(fresh, 4);
    const result = sm2(after1, 4);
    expect(result.repetitions).toBe(2);
    expect(result.interval_days).toBe(6);
  });

  test("third review uses ease factor", () => {
    const after1 = sm2(fresh, 5);
    const after2 = sm2(after1, 5);
    const result = sm2(after2, 5);
    expect(result.repetitions).toBe(3);
    expect(result.interval_days).toBe(Math.round(6 * after2.ease_factor));
  });

  test("failed recall (quality < 3) resets repetitions", () => {
    const after2 = sm2(sm2(fresh, 4), 4);
    const result = sm2(after2, 2);
    expect(result.repetitions).toBe(0);
    expect(result.interval_days).toBe(0);
  });

  test("ease factor never goes below 1.3", () => {
    let item: SM2Item = fresh;
    for (let i = 0; i < 10; i++) {
      item = sm2(item, 0);
    }
    expect(item.ease_factor).toBeGreaterThanOrEqual(1.3);
  });

  test("perfect quality increases ease factor", () => {
    const result = sm2(fresh, 5);
    expect(result.ease_factor).toBeGreaterThan(2.5);
  });

  test("quality 3 (barely correct) decreases ease factor", () => {
    const result = sm2(fresh, 3);
    expect(result.ease_factor).toBeLessThan(2.5);
  });

  test("throws on invalid quality", () => {
    expect(() => sm2(fresh, -1)).toThrow();
    expect(() => sm2(fresh, 6)).toThrow();
  });

  test("next_review_at is in the future for successful review", () => {
    const now = Date.now();
    const result = sm2(fresh, 4);
    expect(result.next_review_at.getTime()).toBeGreaterThan(now);
  });
});
