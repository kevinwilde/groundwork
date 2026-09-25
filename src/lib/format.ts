/** Durations are stored as whole seconds. */

/**
 * Parse "60", "1:30", "1:02:03", "45s", "5m", "1h20m".
 * A bare number is read as seconds, or minutes when `plain` is 'min'.
 * Returns null for empty input and NaN when it can't be read.
 */
export function parseDuration(input: unknown, plain: 's' | 'min' = 's'): number | null {
  if (input == null) return null;
  const str = String(input).trim().toLowerCase();
  if (!str) return null;
  if (/^\d+(\.\d+)?$/.test(str)) {
    const n = Number(str);
    return Math.round(plain === 'min' ? n * 60 : n);
  }
  const parts = str.split(':');
  if (parts.length > 1 && parts.length <= 3 && parts.every((p) => /^\d+(\.\d+)?$/.test(p))) {
    return Math.round(parts.reduce((acc, p) => acc * 60 + Number(p), 0));
  }
  const re = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])/g;
  let total = 0;
  let matched = false;
  let consumed = '';
  for (const m of str.matchAll(re)) {
    matched = true;
    consumed += m[0];
    const n = Number(m[1]);
    const u = m[2][0];
    total += u === 'h' ? n * 3600 : u === 'm' ? n * 60 : n;
  }
  if (!matched || consumed.replace(/\s/g, '').length !== str.replace(/\s/g, '').length) return NaN;
  return Math.round(total);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 45 → "45 s", 150 → "2:30", 3725 → "1:02:05" */
export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || Number.isNaN(sec)) return '';
  const s = Math.round(sec);
  if (s < 100) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** 5400 → "1 h 30 min" */
export function fmtDurationLong(sec: number): string {
  if (!sec) return '0 min';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h) return m ? `${h} h ${m} min` : `${h} h`;
  if (sec < 120) return `${Math.round(sec)} s`;
  return `${m} min`;
}

/** Seconds per unit → "8:57" */
export function fmtPace(secPerUnit: number): string {
  let m = Math.floor(secPerUnit / 60);
  let s = Math.round(secPerUnit % 60);
  if (s === 60) {
    m += 1;
    s = 0;
  }
  return `${m}:${pad(s)}`;
}

export function fmtNum(n: number | null | undefined, maxDigits = 2): string {
  if (n == null || Number.isNaN(n)) return '';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: maxDigits });
}

/** Returns null for empty input and NaN when it isn't a number. */
export function parseNum(v: unknown): number | null {
  if (v == null) return null;
  const str = String(v).trim().replace(/,/g, '');
  if (!str) return null;
  const n = Number(str);
  return Number.isNaN(n) ? NaN : n;
}

export function plural(n: number, word: string, pluralWord = word + 's'): string {
  return `${fmtNum(n)} ${n === 1 ? word : pluralWord}`;
}

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Round up to a "nice" axis maximum. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v * 1.05) return m * p;
  return 10 * p;
}

export function slugKey(label: string): string {
  const words = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (!words.length) return 'field';
  return words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');
}
