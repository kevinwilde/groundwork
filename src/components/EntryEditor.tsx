import { useImperativeHandle, useState, type FormEvent, type Ref } from 'react';
import { useData } from '../data/DataProvider';
import type { Exercise, Performance, SetValues, TypeField } from '../db/types';
import { relDay, type DateStr } from '../lib/dates';
import { parseField, parseQuick, quickPlaceholder, toInput } from '../lib/fields';
import { lastEntry, pace, summarizeEntry, typeOf } from '../lib/model';
import { Button, Field, FormError, IconButton } from './ui';

export interface EntryEditorResult {
  perf: Performance;
  notes: string;
}

/** Lets a parent gather several editors with one button (session logging). */
export interface EntryEditorHandle {
  /** Validate and return the entry, or show the problem inline and return null. */
  collect: () => EntryEditorResult | null;
}

interface Props {
  /** Id of the <form>, so a submit button elsewhere (a dialog footer) can use form={formId}. */
  formId: string;
  exercise: Exercise;
  initial?: Performance & { notes?: string };
  /** Date being logged, used to find "last time". */
  date?: DateStr;
  /** Entry being edited, excluded from "last time". */
  excludeId?: string;
  /** 'prescription' is for mini-exercises: no notes, no history. */
  mode?: 'entry' | 'prescription';
  /** Hide the "Last time" row (when the parent explains where prefilled values came from). */
  hideLast?: boolean;
  /** Show notes behind an "Add note" button to keep the editor short. */
  collapseNotes?: boolean;
  onSubmit?: (res: EntryEditorResult) => void;
  ref?: Ref<EntryEditorHandle>;
}

const inputMode = (f: TypeField) => (f.kind === 'int' ? 'numeric' : f.kind === 'number' ? 'decimal' : 'text');
const durationHint = (f: TypeField) => (f.kind === 'duration' ? (f.plain === 'min' ? 'mm:ss' : 'sec') : '');

export function EntryEditor({ formId, exercise, initial, date, excludeId, mode = 'entry', hideLast, collapseNotes, onSubmit, ref }: Props) {
  const d = useData();
  const type = typeOf(d, exercise);
  const fields = type.fields;
  const isSets = type.mode === 'sets';
  const last = mode === 'entry' ? lastEntry(d, exercise.id, date, excludeId) : null;
  const lastSets = last?.sets;
  const lastValues = last?.values;

  const rowsFrom = (sets: SetValues[]) => sets.map((s) => fields.map((f) => toInput(f, s[f.key])));
  const emptyRow = () => fields.map(() => '');

  const [rows, setRows] = useState<string[][]>(() => {
    if (initial?.sets?.length) return rowsFrom(initial.sets);
    const n = lastSets?.length || (fields.some((f) => f.key === 'weight') ? 3 : 1);
    return Array.from({ length: n }, emptyRow);
  });
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, toInput(f, initial?.values?.[f.key])])));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [notesOpen, setNotesOpen] = useState(!collapseNotes || !!initial?.notes);
  const [quick, setQuick] = useState('');
  const [error, setError] = useState<string | null>(null);

  const setCell = (i: number, j: number, v: string) => setRows((r) => r.map((row, ri) => (ri === i ? row.map((c, ci) => (ci === j ? v : c)) : row)));

  function applyQuick() {
    const sets = parseQuick(type, quick);
    if (!sets) {
      setError(`Couldn't read "${quick}". Try ${quickPlaceholder(type).replace('e.g. ', '')}.`);
      return;
    }
    setError(null);
    setRows(rowsFrom(sets));
    setQuick('');
  }

  function copyLast() {
    if (isSets && lastSets) setRows(rowsFrom(lastSets));
    if (!isSets && lastValues) setVals(Object.fromEntries(fields.map((f) => [f.key, toInput(f, lastValues[f.key])])));
  }

  function collect(): EntryEditorResult | null {
    const fail = (msg: string) => {
      setError(msg);
      return null;
    };
    if (isSets) {
      const sets: SetValues[] = [];
      for (let i = 0; i < rows.length; i++) {
        const s: SetValues = {};
        for (let j = 0; j < fields.length; j++) {
          const r = parseField(fields[j], rows[i][j]);
          if (r.error) return fail(`Set ${i + 1}: ${r.error}`);
          if (r.value != null) s[fields[j].key] = r.value;
        }
        if (Object.keys(s).length) sets.push(s);
      }
      if (!sets.length) return fail('Enter at least one set.');
      setError(null);
      return { perf: { sets }, notes: notes.trim() };
    }
    const values: SetValues = {};
    for (const f of fields) {
      const r = parseField(f, vals[f.key]);
      if (r.error) return fail(r.error);
      if (r.value != null) values[f.key] = r.value;
    }
    if (!Object.keys(values).length) return fail('Enter at least one value.');
    setError(null);
    return { perf: { values }, notes: notes.trim() };
  }

  useImperativeHandle(ref, () => ({ collect }));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const res = collect();
    if (res) onSubmit?.(res);
  }

  const livePace = (() => {
    if (isSets) return null;
    const tmp: SetValues = {};
    for (const k of ['duration', 'distance']) {
      const f = fields.find((x) => x.key === k);
      const r = f ? parseField(f, vals[k]) : null;
      if (r && r.value != null) tmp[k] = r.value;
    }
    return pace(type, tmp);
  })();

  return (
    <form id={formId} className="entry-editor" onSubmit={handleSubmit} noValidate>
      {last && !hideLast && (
        <div className="last-time">
          <span className="last-label">Last time</span>
          <span className="last-val">{summarizeEntry(d, last) || 'no values'}</span>
          <span className="muted">· {relDay(last.date)}</span>
          <Button size="sm" kind="ghost" onClick={copyLast}>
            Use
          </Button>
        </div>
      )}

      {!fields.length && <p className="muted">This type has no fields yet. Add some under Library → Types.</p>}

      {isSets && fields.length > 0 && (
        <>
          <div className="quick-row">
            <input
              className="input"
              id={`${formId}-quick`}
              aria-label="Quick entry"
              autoComplete="off"
              placeholder={quickPlaceholder(type)}
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyQuick();
                }
              }}
            />
            <Button size="sm" onClick={applyQuick} disabled={!quick.trim()}>
              Fill sets
            </Button>
          </div>
          <div className="sets" style={{ ['--cols' as string]: fields.length }}>
            <div className="sets-head" aria-hidden="true">
              <span>Set</span>
              {fields.map((f) => (
                <span key={f.key}>
                  {f.label}
                  {f.unit && <small> {f.unit}</small>}
                </span>
              ))}
              <span />
            </div>
            {rows.map((row, i) => {
              const ph = lastSets?.[Math.min(i, lastSets.length - 1)];
              return (
                <div className="sets-row" key={i}>
                  <span className="set-n">{i + 1}</span>
                  {fields.map((f, j) => (
                    <input
                      key={f.key}
                      className="input cell-input"
                      id={`${formId}-s${i}-${f.key}`}
                      aria-label={`Set ${i + 1} ${f.label}${f.unit ? ` (${f.unit})` : ''}`}
                      autoComplete="off"
                      inputMode={inputMode(f)}
                      placeholder={ph ? toInput(f, ph[f.key]) || durationHint(f) : durationHint(f)}
                      value={row[j] ?? ''}
                      onChange={(e) => setCell(i, j, e.target.value)}
                    />
                  ))}
                  {rows.length > 1 ? (
                    <IconButton icon="close" size={16} label={`Remove set ${i + 1}`} onClick={() => setRows((r) => r.filter((_, ri) => ri !== i))} />
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
          </div>
          <div>
            <Button size="sm" kind="ghost" icon="plus" onClick={() => setRows((r) => [...r, r.length ? [...r[r.length - 1]] : emptyRow()])}>
              Add set
            </Button>
          </div>
        </>
      )}

      {!isSets && fields.length > 0 && (
        <>
          <div className="values-grid">
            {fields.map((f) => (
              <Field key={f.key} label={f.label + (f.unit ? ` (${f.unit})` : '')} className={f.kind === 'text' ? 'span-2' : undefined}>
                <input
                  className="input"
                  id={`${formId}-v-${f.key}`}
                  autoComplete="off"
                  inputMode={inputMode(f)}
                  placeholder={toInput(f, lastValues?.[f.key]) || durationHint(f)}
                  value={vals[f.key] ?? ''}
                  onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              </Field>
            ))}
          </div>
          {livePace && <div className="ee-pace">Pace {livePace}</div>}
        </>
      )}

      {mode === 'entry' && !notesOpen && (
        <div>
          <Button size="sm" kind="ghost" icon="plus" onClick={() => setNotesOpen(true)}>
            Add note
          </Button>
        </div>
      )}
      {mode === 'entry' && notesOpen && (
        <Field label="Notes" optional>
          <textarea
            className="input"
            id={`${formId}-notes`}
            rows={2}
            placeholder="How did it feel? Cues, equipment, anything to remember."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      )}
      <FormError>{error}</FormError>
      <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
    </form>
  );
}
