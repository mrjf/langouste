const pendingTasks = new Set<Promise<void>>();

/**
 * Keep server-owned work alive after an HTTP response while retaining enough
 * lifecycle visibility for graceful shutdowns and deterministic test resets.
 */
export function runBackgroundTask(task: Promise<unknown>, label: string): void {
  let pending: Promise<void>;
  pending = task
    .then(() => {})
    .catch((error) => {
      console.error(`${label} failed:`, error);
    })
    .finally(() => {
      pendingTasks.delete(pending);
    });
  pendingTasks.add(pending);
}

/** Wait until the current background queue, including work it spawns, is empty. */
export async function drainBackgroundTasks(): Promise<void> {
  while (pendingTasks.size > 0) {
    await Promise.allSettled([...pendingTasks]);
  }
}
