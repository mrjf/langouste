import { test, expect } from "bun:test";
import { applyLocalAction } from "../../src/client/lib/local-course.ts";
import { emptyCourseProgress } from "../../src/services/course/state.ts";
import { loadCourseCatalog } from "../../src/services/course/catalog.ts";
const lessons = await loadCourseCatalog();
test("browser-local attempts preserve hints and retry identity without mutating prior records", () => {
  const l = lessons.find((l) => l.language === "hu" && l.day === 1)!;
  const e = l.exercises.find((e) => e.type === "recall")!;
  const empty = emptyCourseProgress(l);
  const hinted = applyLocalAction(l, empty, { type: "hint", exerciseId: e.id }).progress;
  const action = {
    type: "answer" as const,
    exerciseId: e.id,
    attemptId: "local-one",
    answer: e.acceptedAnswers[0],
  };
  const result = applyLocalAction(l, hinted, action);
  expect(empty.exercises).toEqual({});
  expect(result.progress.exercises[e.id].attempts[0].scored).toBe(false);
  expect(
    applyLocalAction(l, result.progress, action).progress.exercises[e.id].attempts,
  ).toHaveLength(1);
  expect(result.progress.sync_receipts).toBeUndefined();
});
test("browser-local Arabic matching and self-grading preserve evidence without mastery claims", () => {
  const l = lessons.find(
    (l) =>
      l.language === "ar-EG" &&
      l.exercises.some((e) => e.type === "matching") &&
      l.exercises.some((e) => e.type === "self-check"),
  )!;
  const e = l.exercises.find((e) => e.type === "matching")!;
  const r = applyLocalAction(l, emptyCourseProgress(l), {
    type: "answer",
    exerciseId: e.id,
    attemptId: "pair",
    answer: JSON.stringify(Object.fromEntries(e.matchingPairs!.map((p) => [p.id, p.answer]))),
  });
  expect(r.progress.exercises[e.id].attempts[0].pairResults?.every((p) => p.correct)).toBe(true);
  expect(r.progress.exercises[e.id].attempts[0].scored).toBe(false);
  const self = l.exercises.find((e) => e.type === "self-check")!;
  const a = applyLocalAction(l, r.progress, {
    type: "answer",
    exerciseId: self.id,
    attemptId: "self",
    answer: "My draft",
  });
  const assessed = applyLocalAction(l, a.progress, {
    type: "self-assess",
    exerciseId: self.id,
    assessment: "met",
  });
  expect(assessed.progress.exercises[self.id].attempts[0]).toMatchObject({
    correct: null,
    scored: false,
    selfAssessment: "met",
  });
});

test("workbook evidence preserves legacy history and excludes every supplied support", () => {
  const l=lessons.find(l=>l.language==="hu"&&l.day===1)!;
  const e=l.exercises.find(e=>e.type==="recall"&&!e.supportAtoms?.length&&e.trackInSrs!==false)!;
  const blank=emptyCourseProgress(l);
  const legacy=applyLocalAction(l,blank,{type:"answer",exerciseId:e.id,attemptId:"legacy",answer:e.acceptedAnswers[0]}).progress;
  const original=JSON.stringify(legacy);
  const next=applyLocalAction(l,legacy,{type:"answer",exerciseId:e.id,attemptId:"workbook-repeat",answer:e.acceptedAnswers[0],evidenceVersion:2});
  expect(JSON.stringify(legacy)).toBe(original);
  expect(next.progress.exercises[e.id].attempts[0]).toEqual(legacy.exercises[e.id].attempts[0]);
  expect(next.progress.exercises[e.id].attempts[1].scored).toBe(false);
  for(const support of [{supportUsed:true},{transliterationVisible:true}]){
    const result=applyLocalAction(l,blank,{type:"answer",exerciseId:e.id,attemptId:"supported",answer:e.acceptedAnswers[0],evidenceVersion:2,...support});
    expect(result.progress.exercises[e.id].attempts[0]).toMatchObject({scored:false,evidenceVersion:2});
  }
  const independent=applyLocalAction(l,blank,{type:"answer",exerciseId:e.id,attemptId:"new",answer:e.acceptedAnswers[0],evidenceVersion:2});
  expect(independent.progress.exercises[e.id].attempts[0]).toMatchObject({scored:true,evidenceVersion:2,support:{hint:false,answer:false,transliteration:false,reference:false,supplied:false}});
  expect(independent.progress.exercises[e.id].attempts[0].contentVersion).toMatch(/^course-v1-/);
  const supportedLesson=structuredClone(l);supportedLesson.exercises.find(x=>x.id===e.id)!.supportAtoms=[l.readings[0].sentences[0]];
  expect(applyLocalAction(supportedLesson,blank,{type:"answer",exerciseId:e.id,attemptId:"given",answer:e.acceptedAnswers[0],evidenceVersion:2}).progress.exercises[e.id].attempts[0].scored).toBe(false);
});
