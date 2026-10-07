/**
 * Stable JSON: object keys sorted, `undefined` dropped, arrays in order. Two records with the same
 * content give the same string whatever order their keys were written in. Used for equality and ties.
 */
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : sortKeys(x)));
  if (v === null || typeof v !== 'object') return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v).sort()) {
    const x = (v as Record<string, unknown>)[k];
    if (x !== undefined) out[k] = sortKeys(x);
  }
  return out;
}

export const STAMP_KEYS = ['hlc', 'updatedAt'] as const;

/** The record without the given keys (stamps, by default), for comparing content. */
export function omit(rec: object, keys: readonly string[] = STAMP_KEYS): Record<string, unknown> {
  const out = { ...(rec as Record<string, unknown>) };
  for (const k of keys) delete out[k];
  return out;
}

/** Same content, ignoring sync stamps. */
export const sameContent = (a: object, b: object, ignore: readonly string[] = STAMP_KEYS) => canonical(omit(a, ignore)) === canonical(omit(b, ignore));
