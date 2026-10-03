import { FiloDocument, type FiloDocumentJson } from "filo";
import type { LessonSegmentPayload, LessonTapeMetadata, RenderedAudioPayload } from "./types.ts";

export interface AudioDrillQualityReport {
  passed: boolean;
  generatedAt: string;
  metrics: {
    segmentCount: number;
    introducedItemCount: number;
    uniqueIntroducedItemCount: number;
    duplicateIntroductionCount: number;
    wordSourceSegmentCount: number;
    responsePauseCount: number;
    transitionPauseCount: number;
    reviewPromptCount: number;
    deferredReviewCount: number;
    plannedEarlyReviewCount: number;
    renderedEarlyReviewCount: number;
    dialogueSourceSegmentCount: number;
    distinctSourceTakeCount: number;
    renderedRecallIntervalsMs: number[];
    renderedTimelineDurationMs?: number;
    explicitSilenceMs: number;
    explicitSilenceRatio?: number;
    audioDurationMs?: number;
    sourceClipOverlapCount: number;
  };
  issues: string[];
  warnings: string[];
}

export async function auditRenderedLessonTape(
  lesson: FiloDocumentJson<LessonTapeMetadata>,
  audioPath?: string,
): Promise<AudioDrillQualityReport> {
  const audioDurationMs = audioPath ? await probeAudioDurationMs(audioPath) : undefined;
  return auditLessonTape(lesson, audioDurationMs);
}

export function auditLessonTape(
  lesson: FiloDocumentJson<LessonTapeMetadata>,
  audioDurationMs?: number,
): AudioDrillQualityReport {
  const document = FiloDocument.fromJSON(lesson);
  const segments = document
    .requireTier<LessonSegmentPayload>("lesson.segment")
    .annotations.toSorted((left, right) => left.payload.order - right.payload.order);
  const issues: string[] = [];
  const warnings: string[] = [];
  const introductions = segments.filter(
    (segment) => segment.payload.type === "meaning" && segment.payload.itemLevel === "sentence",
  );
  const introducedIds = introductions
    .map((segment) => segment.payload.itemId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const uniqueIntroducedIds = new Set(introducedIds);
  const duplicateIntroductionCount = introducedIds.length - uniqueIntroducedIds.size;
  if (introductions.length === 0) issues.push("The lesson introduces no sentence-level items.");
  if (duplicateIntroductionCount > 0) {
    issues.push(`${duplicateIntroductionCount} sentence item(s) are introduced more than once.`);
  }

  const targetsByItem = new Map<string, string>();
  for (const segment of segments) {
    if (segment.payload.audioSource !== "source" || !segment.payload.itemId) continue;
    targetsByItem.set(segment.payload.itemId, document.textOf(segment));
  }
  for (const introduction of introductions) {
    const cue = document.textOf(introduction).trim();
    const target = introduction.payload.itemId
      ? targetsByItem.get(introduction.payload.itemId)?.trim()
      : undefined;
    if (!cue) issues.push(`Item ${introduction.payload.itemId ?? "unknown"} has an empty cue.`);
    if (target && normalizedText(cue) === normalizedText(target)) {
      issues.push(`Item ${introduction.payload.itemId ?? "unknown"} speaks the target as its cue.`);
    }
    if (/\s(?:\/|\|)\s/u.test(cue)) {
      issues.push(
        `Item ${introduction.payload.itemId ?? "unknown"} has alternative cues joined by a slash.`,
      );
    }
    if (/\([^()]*(?:formal|informal|polite|literally|lit\.)[^()]*\)\s*$/iu.test(cue)) {
      issues.push(
        `Item ${introduction.payload.itemId ?? "unknown"} ends in spoken meta-commentary.`,
      );
    }
  }
  const plannedItemIds = stringArrayMetadata(document.metadata, "lessonPlanItemIds");
  if (plannedItemIds.length > 0 && !sameStrings(plannedItemIds, introducedIds)) {
    issues.push("Lesson introductions do not match the authoritative lesson-plan item order.");
  }
  const reviewPrompts = segments.filter((segment) => segment.payload.type === "recall_prompt");
  for (const prompt of reviewPrompts) {
    if (
      document.metadata.lessonKind !== "topic" &&
      prompt.payload.promptMode !== "situation" &&
      prompt.payload.promptMode !== "translation"
    ) {
      issues.push(`Review prompt ${prompt.payload.segmentId} has no valid prompt mode.`);
      continue;
    }
    const promptText = document.textOf(prompt).trim();
    const promptWords = promptText.match(/[\p{Letter}\p{Mark}\p{Number}]+/gu)?.length ?? 0;
    if (!promptText) issues.push(`Review prompt ${prompt.payload.segmentId} is empty.`);
    if (
      prompt.payload.promptMode === "situation" &&
      (promptText.length > 160 || promptWords > 24)
    ) {
      issues.push(`Situation prompt ${prompt.payload.segmentId} is not concise.`);
    }
  }
  const expectedDialogueIds = stringArrayMetadata(document.metadata, "lessonPlanDialogueItemIds");
  const dialogueSources = segments.filter(
    (segment) =>
      segment.payload.activity === "dialogue" && segment.payload.audioSource === "source",
  );
  if (expectedDialogueIds.length > 0) {
    for (const pass of ["opening", "closing"] as const) {
      const actual = dialogueSources
        .filter((segment) => segment.payload.dialoguePass === pass)
        .toSorted(
          (left, right) =>
            (left.payload.dialogueIndex ?? Number.POSITIVE_INFINITY) -
            (right.payload.dialogueIndex ?? Number.POSITIVE_INFINITY),
        )
        .map((segment) => segment.payload.itemId)
        .filter((itemId): itemId is string => typeof itemId === "string");
      if (!sameStrings(expectedDialogueIds, actual)) {
        issues.push(`The ${pass} dialogue pass does not match the curated dialogue order.`);
      }
    }
    if (
      segments.some(
        (segment) =>
          segment.payload.activity === "dialogue" && segment.payload.pauseRole === "response",
      )
    ) {
      issues.push("Passive dialogue contains a learner response pause.");
    }
  }

  let explicitSilenceMs = 0;
  let responsePauseCount = 0;
  let transitionPauseCount = 0;
  for (const [index, segment] of segments.entries()) {
    if (segment.payload.audioSource !== "silence") continue;
    explicitSilenceMs += segment.payload.durationMs ?? 0;
    if (segment.payload.pauseRole === "response") {
      responsePauseCount += 1;
      validateResponsePause(segment.payload, segments, index, issues);
    }
    if (segment.payload.pauseRole === "transition") {
      transitionPauseCount += 1;
      if ((segment.payload.durationMs ?? 0) > 1000) {
        issues.push(`Transition ${segment.payload.segmentId} exceeds one second.`);
      }
    }
    const next = segments[index + 1];
    if (next?.payload.audioSource === "silence") {
      issues.push(
        `Consecutive silence segments ${segment.payload.segmentId} and ${next.payload.segmentId}.`,
      );
    }
  }

  const sourceClipOverlapCount = countSourceClipOverlaps(lesson);
  if (sourceClipOverlapCount > 0) {
    issues.push(`${sourceClipOverlapCount} distinct source clip range(s) overlap after padding.`);
  }
  const explicitSilenceRatio =
    audioDurationMs && audioDurationMs > 0 ? explicitSilenceMs / audioDurationMs : undefined;
  if (explicitSilenceRatio !== undefined && explicitSilenceRatio > 0.65) {
    warnings.push(
      `Designed silence is ${(explicitSilenceRatio * 100).toFixed(1)}% of runtime; verify learner pacing.`,
    );
  }
  const wordSourceSegmentCount = segments.filter(
    (segment) => segment.payload.audioSource === "source" && segment.payload.itemLevel === "word",
  ).length;
  if (wordSourceSegmentCount > 0) {
    warnings.push(
      `${wordSourceSegmentCount} isolated word source segment(s) are enabled; verify contextual glosses and clean boundaries.`,
    );
  }
  const plannedEarlyReviewCount = reviewPrompts.filter(
    (segment) =>
      segment.payload.dueAtMs !== undefined &&
      segment.payload.plannedStartMs !== undefined &&
      segment.payload.plannedStartMs + 1 < segment.payload.dueAtMs,
  ).length;
  if (plannedEarlyReviewCount > 0) {
    issues.push(`${plannedEarlyReviewCount} elapsed-time review(s) were emitted before due.`);
  }
  const deferredReviewCount = numericMetadata(document.metadata, "deferredReviewCount") ?? 0;
  if (deferredReviewCount > 0) {
    warnings.push(`${deferredReviewCount} review event(s) were deferred past the end of the tape.`);
  }
  const renderedTimeline = renderedTimelineMetrics(lesson, segments);
  if (renderedTimeline.earlyRecallCount > 0) {
    issues.push(
      `${renderedTimeline.earlyRecallCount} rendered elapsed-time review(s) arrived materially before their scheduled interval.`,
    );
  }
  if (renderedTimeline.partialTimeline) {
    issues.push("Rendered segment timeline is incomplete.");
  }
  if (renderedTimeline.discontinuityCount > 0) {
    issues.push(
      `${renderedTimeline.discontinuityCount} rendered segment timeline discontinuity/discontinuities found.`,
    );
  }
  if (
    audioDurationMs !== undefined &&
    renderedTimeline.durationMs !== undefined &&
    Math.abs(audioDurationMs - renderedTimeline.durationMs) > 1000
  ) {
    warnings.push(
      `Rendered segment timeline differs from final audio duration by ${Math.round(Math.abs(audioDurationMs - renderedTimeline.durationMs))}ms.`,
    );
  }
  const distinctSourceTakeCount = new Set(
    segments
      .filter(
        (segment) =>
          segment.payload.audioSource === "source" &&
          segment.payload.itemId &&
          segment.payload.sourceStartMs !== undefined &&
          segment.payload.sourceEndMs !== undefined,
      )
      .map(
        (segment) =>
          `${segment.payload.itemId}:${segment.payload.sourceStartMs}:${segment.payload.sourceEndMs}`,
      ),
  ).size;

  return {
    passed: issues.length === 0,
    generatedAt: new Date().toISOString(),
    metrics: {
      segmentCount: segments.length,
      introducedItemCount: introductions.length,
      uniqueIntroducedItemCount: uniqueIntroducedIds.size,
      duplicateIntroductionCount,
      wordSourceSegmentCount,
      responsePauseCount,
      transitionPauseCount,
      reviewPromptCount: reviewPrompts.length,
      deferredReviewCount,
      plannedEarlyReviewCount,
      renderedEarlyReviewCount: renderedTimeline.earlyRecallCount,
      dialogueSourceSegmentCount: dialogueSources.length,
      distinctSourceTakeCount,
      renderedRecallIntervalsMs: renderedTimeline.recallIntervalsMs,
      ...(renderedTimeline.durationMs !== undefined
        ? { renderedTimelineDurationMs: renderedTimeline.durationMs }
        : {}),
      explicitSilenceMs,
      ...(explicitSilenceRatio !== undefined ? { explicitSilenceRatio } : {}),
      ...(audioDurationMs !== undefined ? { audioDurationMs } : {}),
      sourceClipOverlapCount,
    },
    issues,
    warnings,
  };
}

function numericMetadata(metadata: LessonTapeMetadata, key: string): number | undefined {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayMetadata(metadata: LessonTapeMetadata, key: string): string[] {
  const value = metadata[key];
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : [];
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function renderedTimelineMetrics(
  lesson: FiloDocumentJson<LessonTapeMetadata>,
  segments: Array<{ payload: LessonSegmentPayload }>,
): {
  durationMs?: number;
  recallIntervalsMs: number[];
  earlyRecallCount: number;
  partialTimeline: boolean;
  discontinuityCount: number;
} {
  const tier = lesson.tiers.find((candidate) => candidate.id === "audio:generated");
  if (!tier) {
    return {
      recallIntervalsMs: [],
      earlyRecallCount: 0,
      partialTimeline: false,
      discontinuityCount: 0,
    };
  }
  const payloads = tier.annotations.map((annotation) => annotation.payload as RenderedAudioPayload);
  const hasAnyTimeline = payloads.some(
    (payload) => payload.timelineStartMs !== undefined || payload.timelineEndMs !== undefined,
  );
  const timed = payloads
    .filter(
      (payload) =>
        typeof payload.timelineStartMs === "number" &&
        Number.isFinite(payload.timelineStartMs) &&
        typeof payload.timelineEndMs === "number" &&
        Number.isFinite(payload.timelineEndMs) &&
        payload.timelineEndMs >= payload.timelineStartMs,
    )
    .toSorted((left, right) => left.order - right.order);
  const partialTimeline = hasAnyTimeline && timed.length !== payloads.length;
  let discontinuityCount = 0;
  for (let index = 1; index < timed.length; index += 1) {
    const previous = timed[index - 1];
    const current = timed[index];
    if (!previous || !current) continue;
    if (Math.abs((current.timelineStartMs ?? 0) - (previous.timelineEndMs ?? 0)) > 1) {
      discontinuityCount += 1;
    }
  }
  const generatedBySegmentId = new Map(timed.map((payload) => [payload.segmentId, payload]));
  const initialAnswerEndByItem = new Map<string, number>();
  for (const segment of segments) {
    const payload = segment.payload;
    if (payload.type !== "answer" || (payload.repetitionIndex ?? 0) !== 0 || !payload.itemId) {
      continue;
    }
    const endMs = generatedBySegmentId.get(payload.segmentId)?.timelineEndMs;
    if (endMs !== undefined) initialAnswerEndByItem.set(payload.itemId, endMs);
  }
  const recallIntervalsMs: number[] = [];
  let earlyRecallCount = 0;
  for (const segment of segments) {
    if (segment.payload.type !== "recall_prompt" || !segment.payload.itemId) continue;
    const startMs = generatedBySegmentId.get(segment.payload.segmentId)?.timelineStartMs;
    const anchorMs = initialAnswerEndByItem.get(segment.payload.itemId);
    if (startMs === undefined || anchorMs === undefined || startMs < anchorMs) continue;
    const intervalMs = Math.round(startMs - anchorMs);
    recallIntervalsMs.push(intervalMs);
    const scheduledIntervalMs = segment.payload.scheduledIntervalMs;
    // MP3 probing and edge trimming introduce sub-second rounding drift. A
    // review more than 1.5s early is scheduling drift, not codec noise.
    if (scheduledIntervalMs !== undefined && intervalMs + 1500 < scheduledIntervalMs) {
      earlyRecallCount += 1;
    }
  }
  const durationMs = timed.at(-1)?.timelineEndMs;
  return {
    ...(durationMs !== undefined ? { durationMs } : {}),
    recallIntervalsMs,
    earlyRecallCount,
    partialTimeline,
    discontinuityCount,
  };
}

function validateResponsePause(
  pause: LessonSegmentPayload,
  segments: Array<{ payload: LessonSegmentPayload }>,
  pauseIndex: number,
  issues: string[],
): void {
  if (!pause.itemId || pause.durationMs === undefined) {
    issues.push(`Response pause ${pause.segmentId} has no item or duration.`);
    return;
  }
  const answer = segments[pauseIndex + 1]?.payload;
  if (!answer || answer.sourceStartMs === undefined || answer.sourceEndMs === undefined) {
    issues.push(`Response pause ${pause.segmentId} is not immediately followed by a timed answer.`);
    return;
  }
  if (
    answer.type !== "answer" ||
    answer.audioSource !== "source" ||
    answer.itemId !== pause.itemId
  ) {
    issues.push(`Response pause ${pause.segmentId} is not immediately followed by its answer.`);
    return;
  }
  const answerDurationMs = answer.sourceEndMs - answer.sourceStartMs;
  if (pause.durationMs < answerDurationMs + 500) {
    issues.push(`Response pause ${pause.segmentId} is shorter than its answer plus planning time.`);
  }
  if (pause.durationMs > 10_000) {
    issues.push(`Response pause ${pause.segmentId} exceeds ten seconds.`);
  }
}

function countSourceClipOverlaps(lesson: FiloDocumentJson<LessonTapeMetadata>): number {
  const generatedTier = lesson.tiers.find((tier) => tier.id === "audio:generated");
  if (!generatedTier) return 0;
  const ranges = new Map<
    string,
    { clipStartMs: number; clipEndMs: number; sourceStartMs: number; sourceEndMs: number }
  >();
  for (const annotation of generatedTier.annotations) {
    const payload = annotation.payload as RenderedAudioPayload;
    if (
      payload.audioSource !== "source" ||
      typeof payload.clipStartMs !== "number" ||
      typeof payload.clipEndMs !== "number" ||
      typeof payload.sourceStartMs !== "number" ||
      typeof payload.sourceEndMs !== "number"
    ) {
      continue;
    }
    ranges.set(`${payload.sourceStartMs}:${payload.sourceEndMs}`, {
      clipStartMs: payload.clipStartMs,
      clipEndMs: payload.clipEndMs,
      sourceStartMs: payload.sourceStartMs,
      sourceEndMs: payload.sourceEndMs,
    });
  }
  const ordered = [...ranges.values()].toSorted(
    (left, right) => left.clipStartMs - right.clipStartMs || left.clipEndMs - right.clipEndMs,
  );
  let overlaps = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (!previous || !current) continue;
    const originalRangesOverlap =
      previous.sourceEndMs > current.sourceStartMs && current.sourceEndMs > previous.sourceStartMs;
    if (!originalRangesOverlap && previous.clipEndMs > current.clipStartMs + 1) overlaps += 1;
  }
  return overlaps;
}

async function probeAudioDurationMs(path: string): Promise<number | undefined> {
  const process = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      path,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    process.exited,
  ]);
  if (exitCode !== 0) return undefined;
  const seconds = Number.parseFloat(stdout.trim());
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : undefined;
}

function normalizedText(text: string): string {
  return text
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Mark}\p{Number}]+/gu, "")
    .trim();
}
