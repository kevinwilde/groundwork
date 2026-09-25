/** Tag and exercise colours start from calibrated bumper-plate colours, then extend. */
export const PALETTE = [
  { name: 'Plate red', hex: '#D7303E' },
  { name: 'Plate blue', hex: '#2459D1' },
  { name: 'Plate yellow', hex: '#E0A800' },
  { name: 'Plate green', hex: '#2E9A55' },
  { name: 'Orange', hex: '#EB7415' },
  { name: 'Violet', hex: '#7A52D1' },
  { name: 'Teal', hex: '#12958F' },
  { name: 'Magenta', hex: '#C93C87' },
  { name: 'Sky', hex: '#2F9BDF' },
  { name: 'Olive', hex: '#7F9127' },
  { name: 'Rust', hex: '#A5552B' },
  { name: 'Slate', hex: '#687686' },
] as const;

export const UNTAGGED_COLOR = '#8A96A3';

/** The palette colour used least often so far. */
export function nextColor(used: Iterable<string>): string {
  const counts = new Map<string, number>(PALETTE.map((p) => [p.hex, 0]));
  for (const c of used) if (counts.has(c)) counts.set(c, counts.get(c)! + 1);
  let best: string = PALETTE[0].hex;
  let bestN = Infinity;
  for (const [hex, n] of counts) {
    if (n < bestN) {
      best = hex;
      bestN = n;
    }
  }
  return best;
}

/** A colour mixed into the current surface, so tints work in light and dark themes. */
export function tint(color: string, pct = 24): string {
  return `color-mix(in srgb, ${color} ${pct}%, var(--surface))`;
}

/** Pain 0 (none) to 10 (worst): green through amber to red. */
export function painColor(score: number | null | undefined): string {
  if (score == null) return 'var(--ink-3)';
  const hue = 145 - Math.max(0, Math.min(10, score)) * 14.5;
  return `hsl(${hue.toFixed(0)} 68% 44%)`;
}

/** Overall feeling 1 (rough) to 5 (great). */
export function feelingColor(v: number | null | undefined): string {
  return ['', '#C8323F', '#E07B1F', '#B3A01A', '#4AA35A', '#1F8C5E'][v ?? 0] || 'var(--ink-3)';
}

/** Hard-stop gradient bands, one per colour. */
export function bands(colors: string[], pct: number): string | undefined {
  if (!colors.length) return undefined;
  const c = (x: string) => (pct >= 100 ? x : tint(x, pct));
  if (colors.length === 1) return c(colors[0]);
  const step = 100 / colors.length;
  const stops = colors.map((x, i) => `${c(x)} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
