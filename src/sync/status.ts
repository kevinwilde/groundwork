import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { db } from '../db/db';
import { hasOwnRecords, openContext, runSync, undoSync, type Progress, type SyncContext, type SyncOutcome } from './engine';
import { asSyncError, syncError, type SyncError } from './errors';
import { getMeta } from './local';

/**
 * What the Sync card shows: whether a sync is running and how far it got, the last result (with its
 * Undo), the last error, and the first-sync review when one is needed. Kept outside React so a sync
 * carries on, and its result stays, when the user leaves the Data page.
 */

export type Finished = Extract<SyncOutcome, { kind: 'up-to-date' | 'pulled' | 'synced' }> & { at: number };
export type Review = Extract<SyncOutcome, { kind: 'preview' }>;

export interface SyncStatus {
  syncing: boolean;
  progress: Progress | null;
  outcome: Finished | null;
  error: { error: SyncError; at: number } | null;
  review: Review | null;
}

let state: SyncStatus = { syncing: false, progress: null, outcome: null, error: null, review: null };
const listeners = new Set<() => void>();

function set(patch: Partial<SyncStatus>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export const useSyncStatus = () => useSyncExternalStore(subscribe, () => state, () => state);
export const getSyncStatus = () => state;

async function context(): Promise<SyncContext> {
  const ctx = await openContext(db, {
    onProgress: (progress) => set({ progress }),
    // Any open Undo toast was computed before the sync changed the data under it.
    beforeApply: () => toast.dismiss(),
  });
  if (!ctx) throw syncError('auth');
  return ctx;
}

const finished = (outcome: SyncOutcome): Partial<SyncStatus> =>
  outcome.kind === 'preview' ? { syncing: false, progress: null, review: outcome } : { syncing: false, progress: null, outcome: { ...outcome, at: Date.now() } };

/**
 * Sync now. On this device's first sync, when GitHub has data and this device has records of its own,
 * stops at the review instead; `reviewed` runs the real sync from there.
 */
export async function syncNow({ reviewed = false } = {}): Promise<void> {
  if (state.syncing) return;
  set({ syncing: true, progress: { step: 'checking' }, error: null, review: null });
  try {
    const ctx = await context();
    if (!reviewed && !(await getMeta(db, 'syncState')) && (await hasOwnRecords(db))) {
      const preview = await runSync(ctx, { preview: true });
      if (preview.kind === 'preview' && preview.remoteHasData) return set(finished(preview));
    }
    set(finished(await runSync(ctx)));
  } catch (e) {
    set({ syncing: false, progress: null, outcome: null, error: { error: asSyncError(e), at: Date.now() } });
  }
}

/** Undo the last sync's changes on this device as new edits, then sync so other devices follow. */
export async function undoLastSync(): Promise<SyncError | null> {
  const last = state.outcome;
  if (state.syncing || !last || last.kind === 'up-to-date') return null;
  set({ syncing: true, progress: { step: 'saving' }, error: null });
  try {
    const ctx = await context();
    toast.dismiss();
    set(finished(await undoSync(last, ctx)));
    return null;
  } catch (e) {
    const error = asSyncError(e);
    if (error.code === 'undo-stale') {
      set({ syncing: false, progress: null, outcome: null });
      return error;
    }
    set({ syncing: false, progress: null, outcome: null, error: { error, at: Date.now() } });
    return null;
  }
}

export const closeReview = () => set({ review: null });

/** Forget results and errors, e.g. after disconnecting or replacing the token. */
export const resetSyncStatus = () => set({ outcome: null, error: null, review: null, progress: null });
