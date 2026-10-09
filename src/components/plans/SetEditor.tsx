import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { ExerciseType, PlannedSet, SetValues, TypeField } from '../../db/types';
import { parseField, toInput } from '../../lib/fields';
import { summarize } from '../../lib/model';
import { setLabel } from '../../lib/plans';
import { Button, FormError } from '../ui';

interface Props {
  type: ExerciseType;
  slot: PlannedSet;
  /** "Set 2", or the exercise name for a single effort. */
  name: string;
  /** Single efforts (runs) get plain inputs, no steppers. */
  single: boolean;
  /** The weight stepper's step: 5 lb or 2.5 kg. */
  weightStep: number | null;
  /** Only sets added during the workout can be removed. */
  removable: boolean;
  onLog: (values: SetValues) => void;
  onSkip: () => void;
  onRemove: () => void;
  onCancel: () => void;
}

const inputMode = (f: TypeField) => (f.kind === 'int' ? 'numeric' : f.kind === 'number' ? 'decimal' : 'text');

/**
 * Opens under a set row: what was actually done. Steppers for reps (±1), weight (± the bump step),
 * time (±5 s) and distance (±0.1); every value can also be typed. On a ticked set it changes what was done.
 */
export function SetEditor({ type, slot, name, single, weightStep, removable, onLog, onSkip, onRemove, onCancel }: Props) {
  const id = useId();
  const box = useRef<HTMLFormElement>(null);
  const start = slot.done ?? slot.target;
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(type.fields.map((f) => [f.key, toInput(f, start[f.key])])));
  const [error, setError] = useState<string | null>(null);

  // Land here for keyboard and screen reader users, without opening the phone keyboard.
  useEffect(() => box.current?.focus({ preventScroll: true }), []);

  const stepOf = (f: TypeField): number | null => {
    if (single || f.kind === 'text') return null;
    if (f.key === 'reps') return 1;
    if (f.key === 'weight') return weightStep ?? 5;
    if (f.key === 'duration') return 5;
    if (f.key === 'distance') return 0.1;
    return null;
  };

  function read(): { values: SetValues } | { error: string } {
    const values: SetValues = {};
    for (const f of type.fields) {
      const r = parseField(f, vals[f.key]);
      if (r.error) return { error: r.error };
      if (r.value != null) values[f.key] = r.value;
    }
    return { values };
  }

  function nudge(f: TypeField, step: number) {
    const r = parseField(f, vals[f.key]);
    const base = typeof r.value === 'number' ? r.value : 0;
    const next = Math.max(0, Math.round((base + step) * 100) / 100);
    setVals((v) => ({ ...v, [f.key]: toInput(f, f.kind === 'int' ? Math.round(next) : next) }));
  }

  const res = read();
  const ready = 'values' in res && Object.keys(res.values).length > 0;
  const label = 'values' in res ? (single ? summarize(type, { values: res.values }) : setLabel(type, res.values)) : '';

  function submit(e: FormEvent) {
    e.preventDefault();
    if ('error' in res) return setError(res.error);
    if (!ready) return setError('Enter what you did.');
    onLog(res.values);
  }

  return (
    <form
      ref={box}
      className="wk-editor"
      aria-label={`${name}: what you did`}
      tabIndex={-1}
      noValidate
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="wk-fields">
        {type.fields.map((f) => {
          const step = stepOf(f);
          return (
            <div className="wk-field" key={f.key}>
              <label className="field-label" htmlFor={`${id}-${f.key}`}>
                {f.label}
                {f.unit && <small> {f.unit}</small>}
              </label>
              <div className="wk-stepper">
                {step && (
                  <button type="button" className="wk-step" aria-label={`${f.label} minus ${step}`} onClick={() => nudge(f, -step)}>
                    −
                  </button>
                )}
                <input
                  className="input wk-input"
                  id={`${id}-${f.key}`}
                  autoComplete="off"
                  inputMode={inputMode(f)}
                  value={vals[f.key] ?? ''}
                  onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                />
                {step && (
                  <button type="button" className="wk-step" aria-label={`${f.label} plus ${step}`} onClick={() => nudge(f, step)}>
                    +
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <FormError>{error}</FormError>
      <div className="wk-editor-actions">
        <Button type="submit" kind="primary" icon="check" disabled={!ready}>
          {`${slot.done ? 'Save' : 'Log'}${label ? ` ${label}` : ''}`}
        </Button>
        {!slot.skipped && <Button onClick={onSkip}>{single ? 'Skip' : 'Skip set'}</Button>}
        {removable && (
          <Button kind="danger-text" icon="trash" onClick={onRemove}>
            Remove set
          </Button>
        )}
        <Button kind="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
