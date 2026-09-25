import type { ExerciseType, FieldValue, SetValues, TypeField } from '../db/types';
import { fmtDuration, parseDuration, parseNum } from './format';
import { hasValue } from './model';

export type ParseResult = { value: FieldValue | null; error?: undefined } | { value?: undefined; error: string };

/** Parse what was typed into a field. Empty input gives `{ value: null }`. */
export function parseField(field: TypeField, raw: unknown): ParseResult {
  const str = String(raw ?? '').trim();
  if (!str) return { value: null };
  if (field.kind === 'text') return { value: str };
  if (field.kind === 'duration') {
    const v = parseDuration(str, field.plain);
    return v == null || Number.isNaN(v) ? { error: `${field.label}: use 60, 1:30 or 45s` } : { value: v };
  }
  const n = parseNum(str.replace(/\s*(lb|lbs|kg|mi|km|m|ft|bpm)$/i, ''));
  if (n == null || Number.isNaN(n)) return { error: `${field.label}: enter a number` };
  return { value: field.kind === 'int' ? Math.round(n) : n };
}

/** How a stored value appears in an input. */
export function toInput(field: TypeField, v: unknown): string {
  if (!hasValue(v)) return '';
  return field.kind === 'duration' ? fmtDuration(Number(v)) : String(v);
}

/**
 * Quick entry for set-based types: "3x6@100", "3 × 60s", "5x5 225", "6@100".
 * The leading "N x" is the set count; remaining numbers fill the type's fields in order.
 */
export function parseQuick(type: ExerciseType, text: string): SetValues[] | null {
  let str = text.trim().toLowerCase().replace(/×/g, 'x');
  if (!str) return null;
  let sets = 1;
  const m = str.match(/^(\d+)\s*x\s*(.+)$/);
  if (m) {
    sets = Number(m[1]);
    str = m[2];
  }
  // "60 s" -> "60s" so a unit never becomes its own token
  str = str.replace(/(\d)\s+(s|sec|secs|min|m|h|lb|lbs|kg)\b/g, '$1$2');
  const tokens = str.split(/\s*(?:@|x|at|,|\s)\s*/).filter(Boolean);
  const fields = type.fields.filter((f) => f.kind !== 'text');
  if (!tokens.length || tokens.length > fields.length || sets < 1 || sets > 50) return null;
  const set: SetValues = {};
  for (let i = 0; i < tokens.length; i++) {
    const r = parseField(fields[i], tokens[i]);
    if (r.error || r.value == null) return null;
    set[fields[i].key] = r.value;
  }
  return Array.from({ length: sets }, () => ({ ...set }));
}

export function quickPlaceholder(type: ExerciseType): string {
  const f = type.fields.filter((x) => x.kind !== 'text');
  if (!f.length) return '';
  const sample = f.map((x) => (x.key === 'reps' ? '6' : x.key === 'weight' ? '100' : x.kind === 'duration' ? '60s' : '10'));
  return `e.g. 3 × ${sample.join(' @ ')}`;
}
