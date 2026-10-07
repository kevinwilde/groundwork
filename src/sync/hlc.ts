/**
 * Hybrid logical clock stamps. Each stamp is `max(wall clock, highest stamp seen)` plus a counter,
 * so a device's stamps only move forward, and any edit made after a sync beats everything that
 * sync brought, even when the two devices' clocks disagree.
 *
 * Format: `${wall base36, 9 chars}.${counter base36, 4 chars}.${node}`. The fields are fixed-width,
 * so comparing the strings gives chronological order; `node` (the device id) breaks exact ties the
 * same way everywhere.
 */

export interface ClockState {
  wall: number;
  counter: number;
}

const WALL_LEN = 9;
const COUNTER_LEN = 4;
const MAX_COUNTER = 36 ** COUNTER_LEN - 1;

export const HLC_PATTERN = /^[0-9a-z]{9}\.[0-9a-z]{4}\.[0-9a-z]+$/;

/** The starter library: identical on every device, and older than any edit. */
export const SEED_HLC = '000000000.0000.seed';
/** A starter record deleted before v3: beats an unchanged seed copy, loses to an edited one. */
export const SEED_GONE_HLC = '000000001.0000.seed';

export function encode(wall: number, counter: number, node: string): string {
  return `${Math.max(0, Math.floor(wall)).toString(36).padStart(WALL_LEN, '0')}.${counter.toString(36).padStart(COUNTER_LEN, '0')}.${node}`;
}

export function decode(hlc: string): { wall: number; counter: number; node: string } {
  const [wall, counter, ...node] = hlc.split('.');
  return { wall: parseInt(wall, 36) || 0, counter: parseInt(counter, 36) || 0, node: node.join('.') };
}

export const isHlc = (v: unknown): v is string => typeof v === 'string' && HLC_PATTERN.test(v);

/** Wall-clock milliseconds of a stamp. */
export const wallOf = (hlc: string | null | undefined): number => (hlc ? decode(hlc).wall : 0);

/** The highest of some stamps, or null when there are none. */
export function maxHlc(stamps: Iterable<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const h of stamps) if (h && (best === null || h > best)) best = h;
  return best;
}

/** Best-effort stamp for a record written before v3, from its own timestamps (settings get wall 0). */
export function legacyStamp(rec: { createdAt?: unknown; updatedAt?: unknown }): string {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return encode(Math.max(n(rec.updatedAt), n(rec.createdAt)), 0, 'legacy');
}

export class Clock {
  constructor(
    public wall = 0,
    public counter = 0,
  ) {}

  static from(state: ClockState | null | undefined): Clock {
    return new Clock(state?.wall ?? 0, state?.counter ?? 0);
  }

  get state(): ClockState {
    return { wall: this.wall, counter: this.counter };
  }

  /** A new stamp, newer than every stamp this clock has issued or observed. */
  next(now: number, node: string): string {
    if (now > this.wall) {
      this.wall = Math.floor(now);
      this.counter = 0;
    } else if (this.counter >= MAX_COUNTER) {
      this.wall += 1;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
    return encode(this.wall, this.counter, node);
  }

  /** Raise the clock to a stamp seen elsewhere, so later stamps are newer than it. */
  observe(hlc: string | null | undefined): this {
    if (!hlc) return this;
    const { wall, counter } = decode(hlc);
    if (wall > this.wall || (wall === this.wall && counter > this.counter)) {
      this.wall = wall;
      this.counter = counter;
    }
    return this;
  }

  /** Stamps for merge repairs, all newer than everything observed so far. */
  stamper(node: string, now: number): () => string {
    return () => this.next(now, node);
  }
}
