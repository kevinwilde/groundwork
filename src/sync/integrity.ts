import type { Key, SyncSet, Version } from './merge';

type Live = Extract<Version, { live: true }>;

/**
 * Repair references the merge broke. The cascades in lib/model.ts only reach children the deleting
 * device knew about; a child created on another device in the meantime has no tombstone. Rather than
 * let it vanish (EntryRow hides entries whose exercise is gone), the merge keeps the data:
 *
 * - an entry or mini-exercise whose exercise is deleted brings the exercise back;
 * - an exercise whose type is deleted brings the type back;
 * - a check-in with a pain score for a deleted body part brings the body part back;
 * - an exercise loses the ids of deleted tags (tags are only labels, as in opsDeleteTag).
 *
 * A parent comes back only if one side had it live, with a new stamp newer than both sides. Soft
 * links (entry.sessionId, entry.snackId, entry.planId, session items, plan items and their entryId,
 * plan.sessionId, saved-view ids) are left alone: a plan item whose exercise is gone is hidden, as
 * sessionExercises() hides a session's.
 * Repeats until nothing changes. Replaces entries in `merged` and returns their keys. Pure.
 */
export function repair(merged: SyncSet, lv: SyncSet, rv: SyncSet, stamp: () => string): Set<Key> {
  const repaired = new Set<Key>();
  const dead = (key: Key) => merged.get(key)?.live === false;

  const restamp = (v: Live, rec: Record<string, unknown>) => {
    const hlc = stamp();
    merged.set(v.key, { ...v, hlc, rec: { ...rec, hlc } });
    repaired.add(v.key);
  };

  /** Bring a deleted parent back from the newest live copy on either side. */
  const restore = (key: Key): boolean => {
    if (!dead(key)) return false;
    const copies = [lv.get(key), rv.get(key)].filter((v): v is Live => !!v?.live);
    if (!copies.length) return false;
    const best = copies.reduce((a, b) => (b.hlc > a.hlc ? b : a));
    restamp(best, best.rec);
    return true;
  };

  for (let changed = true; changed; ) {
    changed = false;
    for (const key of [...merged.keys()]) {
      const v = merged.get(key)!;
      if (!v.live) continue;
      const r = v.rec;
      if (v.table === 'entries' || v.table === 'snacks') changed = restore(`exercises:${r.exerciseId}`) || changed;
      if (v.table === 'checkins') for (const p of (r.pains as { bodyPartId: string }[] | undefined) ?? []) changed = restore(`bodyParts:${p.bodyPartId}`) || changed;
      if (v.table === 'exercises') {
        changed = restore(`types:${r.typeId}`) || changed;
        const tagIds = (r.tagIds as string[] | undefined) ?? [];
        const kept = tagIds.filter((id) => !dead(`tags:${id}`));
        if (kept.length !== tagIds.length) {
          restamp(v, { ...r, tagIds: kept });
          changed = true;
        }
      }
    }
  }
  return repaired;
}
