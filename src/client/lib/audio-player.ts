/**
 * App-wide single-track audio controller. Only one HTMLAudioElement plays at
 * a time across the whole UI; starting a new track or calling stop() pauses
 * whatever was playing and notifies its owner via the registered onStop.
 */

type Entry = { audio: HTMLAudioElement; onStop: () => void };

let current: Entry | null = null;

/** Stop whatever is currently playing (no-op if nothing is). */
export function stopCurrent(): void {
  if (!current) return;
  const { audio, onStop } = current;
  current = null;
  audio.pause();
  try {
    onStop();
  } catch {
    // ignore — listener errors shouldn't break audio control
  }
}

/**
 * Start playing `audio`. Stops any other track first. `onStop` is invoked
 * when this track is replaced, manually stopped, or finishes naturally.
 * Call site should not also wire its own `ended`/`error` handlers if it
 * wants the stop callback as the single source of truth.
 */
export async function playExclusive(audio: HTMLAudioElement, onStop: () => void): Promise<void> {
  stopCurrent();
  current = { audio, onStop };

  const handleEnd = () => {
    if (current?.audio !== audio) return;
    current = null;
    cleanup();
    try {
      onStop();
    } catch {
      // ignore
    }
  };
  const cleanup = () => {
    audio.removeEventListener("ended", handleEnd);
    audio.removeEventListener("error", handleEnd);
    audio.removeEventListener("pause", handlePause);
  };
  const handlePause = () => {
    // Only treat as stop when we're at the end OR explicitly cleared. The
    // controller calls audio.pause() in stopCurrent(), which fires this.
    if (current?.audio !== audio) {
      cleanup();
      try {
        onStop();
      } catch {
        /* ignore */
      }
    }
  };

  audio.addEventListener("ended", handleEnd);
  audio.addEventListener("error", handleEnd);
  audio.addEventListener("pause", handlePause);

  try {
    await audio.play();
  } catch (err) {
    if (current?.audio === audio) current = null;
    cleanup();
    throw err;
  }
}

/** True when `audio` is the currently-playing track. */
export function isCurrent(audio: HTMLAudioElement): boolean {
  return current?.audio === audio;
}
