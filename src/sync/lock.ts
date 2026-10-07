let tail: Promise<unknown> = Promise.resolve();

/**
 * One sync at a time across this origin's tabs, through Web Locks. Where they're missing (Node, old
 * browsers), an in-memory queue keeps this tab to one sync at a time; expectSeq and the ref
 * compare-and-swap still keep other writers safe.
 */
export function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : (navigator as { locks?: LockManager }).locks;
  if (locks?.request) return locks.request('groundwork-sync', () => fn()) as Promise<T>;
  const run = tail.then(fn, fn);
  tail = run.catch(() => undefined);
  return run;
}
