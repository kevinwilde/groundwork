import clsx from 'clsx';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ExerciseHeader } from '../../components/EntryRow';
import { Icon } from '../../components/Icon';
import { StatusChip } from '../../components/plans/PlanCard';
import { SetEditor } from '../../components/plans/SetEditor';
import { usePlanWriter } from '../../components/plans/usePlanWriter';
import { Button, Dot, Empty, Field, IconButton, PageHead } from '../../components/ui';
import { useData } from '../../data/DataProvider';
import { useToday } from '../../data/hooks';
import type { Exercise, ExerciseType, Plan, PlanItem, PlannedSet, SetValues } from '../../db/types';
import { fmtDate, fmtLong, fmtShort } from '../../lib/dates';
import { plural } from '../../lib/format';
import { exerciseColor, fieldText, hasValue, summarize, summarizeEntry, typeOf } from '../../lib/model';
import {
  bumpStep, changedFields, currentSet, diffFromTarget, isSetItem, itemComplete, lastDone, opsAddExercise, opsAddSet, opsFinish, opsMovePlan, opsRemoveSet, opsReopen, opsSetNotes,
  opsSetTargets, opsSkipExercise, opsSkipSet, opsTick, opsUntick, planExercises, planProgress, planShortfalls, planStatus, setLabel, setsSharingTarget, setsText, slotsOf, visiblePlan,
} from '../../lib/plans';

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** What a set or effort says: "5 × 190 lb" for a set, "25:00 · 3.1 mi · 8:04 /mi" for a run. */
const valuesText = (type: ExerciseType, item: PlanItem, v: SetValues) => (isSetItem(item) ? setLabel(type, v) : summarize(type, { values: v }));

/** "105 lb", "4 reps and 105 lb": the fields that changed, for the "Use it for sets 3–4 too?" prompt. */
function changedText(type: ExerciseType, patch: SetValues): string {
  return type.fields
    .filter((f) => hasValue(patch[f.key]))
    .map((f) => (f.key === 'reps' ? `${fieldText(f, patch.reps)} ${Number(patch.reps) === 1 ? 'rep' : 'reps'}` : fieldText(f, patch[f.key])))
    .join(' and ');
}

/** A logged set that differs from its target, and the later sets that shared the old target. */
interface Prompt {
  itemKey: string;
  fromIndex: number;
  patch: SetValues;
  later: number[];
}

const refKey = (itemKey: string, index: number) => `${itemKey}:${index}`;

/** A finished or skipped exercise in one line: "3 × 5 @ 190 lb", "Skipped", "2 × 5 @ 190 lb · 1 skipped". */
function summaryOf(type: ExerciseType, item: PlanItem): string {
  const slots = slotsOf(item);
  const done = slots.flatMap((s) => (s.done ? [s.done] : []));
  const skipped = slots.filter((s) => s.skipped).length;
  const text = done.length ? summarize(type, isSetItem(item) ? { sets: done } : { values: done[0] }) : '';
  if (!text) return 'Skipped';
  return skipped ? `${text} · ${skipped} skipped` : text;
}

/** `#/plan/<id>`: follow a plan at the gym, ticking off each set. Every tick is saved at once. */
export function WorkoutPage() {
  const { id = '' } = useParams();
  const d = useData();
  const navigate = useNavigate();
  const plan = d.plans.get(id);
  if (!plan) {
    return (
      <>
        <PageHead title="Workout" />
        <Empty title="Plan not found" action={<Button onClick={() => navigate('/plan')}>All plans</Button>}>
          It may have been deleted, here or on another device.
        </Empty>
      </>
    );
  }
  return <Workout key={plan.id} plan={plan} />;
}

function Workout({ plan }: { plan: Plan }) {
  const d = useData();
  const t = useToday();
  const navigate = useNavigate();
  const write = usePlanWriter(plan.id);
  const [said, setSaid] = useState({ n: 0, text: '' });
  const [editing, setEditing] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  /** Finished or skipped exercises collapse to one line; these were tapped open again. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [addId, setAddId] = useState('');
  const scrollNext = useRef(false);
  const summaryHead = useRef<HTMLHeadingElement>(null);
  const showSummary = useRef(false);
  const finished = !!plan.finishedAt;

  const vis = visiblePlan(d, plan);
  const progress = planProgress(vis);
  const status = planStatus(vis, t);
  const current = currentSet(vis);
  const currentKey = current ? `${current.itemKey}:${current.index}` : '';
  const exercises = planExercises(d, plan);
  const shortfalls = finished ? planShortfalls(d, vis) : [];
  const announce = (text: string) => setSaid((s) => ({ n: s.n + 1, text }));

  // After a tick, bring the next set into view (once the saved plan is back).
  useEffect(() => {
    if (!scrollNext.current) return;
    scrollNext.current = false;
    if (!currentKey) return;
    const row = document.querySelector<HTMLElement>(`[data-set="${CSS.escape(currentKey)}"]`);
    row?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    // The tick that had focus may have gone with a collapsed exercise: carry on from the next set.
    if (!document.activeElement || document.activeElement === document.body) row?.querySelector<HTMLElement>('.wk-tick')?.focus({ preventScroll: true });
  }, [currentKey, plan]);

  // After Finish, move to the summary that replaces the button.
  useEffect(() => {
    if (!finished || !showSummary.current) return;
    showSummary.current = false;
    summaryHead.current?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    summaryHead.current?.focus({ preventScroll: true });
  }, [finished]);

  const toggle = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** Return focus to a row once its editor closes. */
  const focusRow = (key: string) => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-set="${CSS.escape(key)}"] .wk-set-main`)?.focus({ preventScroll: true }));

  function closeEditor() {
    if (editing) focusRow(editing);
    setEditing(null);
  }

  function tick(item: PlanItem, ex: Exercise, index: number, values?: SetValues) {
    const type = typeOf(d, ex);
    const v = values ?? slotsOf(item)[index].target;
    if (prompt?.itemKey === item.key) setPrompt(null);
    scrollNext.current = true;
    void write((p, data) => opsTick(data, p, item.key, index, values)).then((ok) => {
      if (ok) announce(`${ex.name}${isSetItem(item) ? ` set ${index + 1}` : ''} logged, ${valuesText(type, item, v)}`);
    });
  }

  /** The editor's Log: tick with what was done, then offer the change to later sets that shared the target. */
  function logSet(item: PlanItem, ex: Exercise, index: number, values: SetValues) {
    closeEditor();
    tick(item, ex, index, values);
    if (!isSetItem(item)) return;
    const patch = changedFields(item.sets[index].target, values);
    const later = Object.keys(patch).length ? setsSharingTarget(item, index, patch) : [];
    if (later.length) setPrompt({ itemKey: item.key, fromIndex: index, patch, later });
  }

  function applyPrompt(p: Prompt, ex: Exercise) {
    setPrompt(null);
    void write((plan) => opsSetTargets(plan, p.itemKey, p.fromIndex, p.patch)).then((ok) => {
      if (ok) announce(`${ex.name}: ${setsText(p.later)} now ${changedText(typeOf(d, ex), p.patch)}`);
    });
  }

  function skipSet(item: PlanItem, ex: Exercise, index: number) {
    closeEditor();
    scrollNext.current = true;
    void write((p, data) => opsSkipSet(data, p, item.key, index)).then((ok) => {
      if (ok) announce(`${ex.name}${isSetItem(item) ? ` set ${index + 1}` : ''} skipped`);
    });
  }

  function removeSet(item: PlanItem, ex: Exercise, index: number) {
    setEditing(null);
    void write((p, data) => opsRemoveSet(data, p, item.key, index)).then((ok) => {
      if (ok) announce(`${ex.name} set ${index + 1} removed`);
    });
  }

  const addSet = (item: PlanItem, ex: Exercise) => void write((p) => opsAddSet(p, item.key)).then((ok) => ok && announce(`${ex.name}: set ${slotsOf(item).length + 1} added`));

  function skipExercise(item: PlanItem, ex: Exercise) {
    setEditing(null);
    scrollNext.current = true;
    void write((p, data) => opsSkipExercise(data, p, item.key)).then((ok) => ok && announce(`${ex.name} skipped`));
  }

  const saveNotes = (item: PlanItem, notes: string) => void write((p, data) => opsSetNotes(data, p, item.key, notes));

  function addExercise() {
    const ex = d.exercises.get(addId);
    if (!ex) return;
    setAddId('');
    void write((p, data) => opsAddExercise(data, p, ex.id)).then((ok) => ok && announce(`${ex.name} added`));
  }

  function finish() {
    setEditing(null);
    setPrompt(null);
    showSummary.current = true;
    void write((p) => opsFinish(p)).then((ok) => ok && announce('Workout finished'));
  }

  const reopen = () => void write((p) => opsReopen(p)).then((ok) => ok && announce('Workout reopened'));

  function untick(item: PlanItem, ex: Exercise, index: number) {
    if (prompt?.itemKey === item.key) setPrompt(null);
    void write((p, data) => opsUntick(data, p, item.key, index)).then((ok) => {
      if (ok) announce(`${ex.name}${isSetItem(item) ? ` set ${index + 1}` : ''} not done`);
    });
  }

  const moveToToday = () => void write((p, data) => opsMovePlan(data, p, t)).then((ok) => ok && announce(`Moved to today`));
  const pct = progress.total ? Math.round(((progress.done + progress.skipped) / progress.total) * 100) : 0;

  return (
    <>
      <PageHead
        title={plan.name}
        eyebrow={fmtLong(plan.date)}
        actions={
          <Button size="sm" kind="ghost" icon="edit" onClick={() => navigate(`/plan/${plan.id}/edit`)}>
            Edit plan
          </Button>
        }
      />
      <section className="card wk-status" aria-label="Progress">
        <div className="wk-progress">
          <span className="wk-progress-text">
            <b>{progress.done}</b> of {plural(progress.total, 'set')}
            {progress.skipped > 0 && ` · ${progress.skipped} skipped`}
          </span>
          <StatusChip status={status} />
        </div>
        <div className="wk-bar" role="progressbar" aria-label="Sets done or skipped" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done + progress.skipped}>
          <i style={{ width: `${pct}%` }} />
        </div>
        {plan.date !== t && (
          <p className="wk-when">
            {plan.date < t ? `Logging to ${fmtDate(plan.date)}.` : `This plan is for ${fmtDate(plan.date)}, so ticks log on that day.`}{' '}
            <button type="button" className="link-btn" onClick={moveToToday}>
              Move to today
            </button>
          </p>
        )}
        {plan.notes && <p className="session-notes">{plan.notes}</p>}
      </section>

      {exercises.map(({ item, ex }) => {
        const type = typeOf(d, ex);
        const last = lastDone(d, ex.id, plan.date, plan.id);
        const single = !isSetItem(item);
        const ask = prompt?.itemKey === item.key ? prompt : null;
        const complete = itemComplete(item);
        if (complete && !expanded.has(item.key)) {
          return (
            <section key={item.key} className="card wk-block collapsed" aria-label={ex.name}>
              <button type="button" className="wk-summary" aria-expanded={false} onClick={() => toggle(item.key)}>
                <Dot color={exerciseColor(d, ex)} />
                <span className="wk-summary-name">{ex.name}</span>
                <span className="wk-summary-text">{summaryOf(type, item)}</span>
                <Icon name="down" size={18} />
              </button>
            </section>
          );
        }
        return (
          <section key={item.key} className={clsx('card wk-block', complete && 'complete')} aria-label={ex.name}>
            <div className="wk-block-head">
              <ExerciseHeader exercise={ex} compact />
              {complete && <IconButton icon="up" label={`Collapse ${ex.name}`} aria-expanded onClick={() => toggle(item.key)} />}
            </div>
            <div className="plan-last">{last ? `Last: ${summarizeEntry(d, last) || 'no values'} · ${fmtShort(last.date)}` : 'First time'}</div>
            <NoteField key={item.notes} name={ex.name} notes={item.notes} onSave={(notes) => saveNotes(item, notes)} />
            <div className="wk-sets">
              {slotsOf(item).map((slot, i) => {
                const key = refKey(item.key, i);
                const open = editing === key;
                // The tick asks what was done instead of logging the target when there's nothing to log as
                // planned (a blank target), and for a single effort, whose time and distance are measured.
                const askFirst = single || !Object.values(slot.target).some(hasValue);
                return (
                  <Fragment key={i}>
                    <SetRow
                      type={type}
                      item={item}
                      slot={slot}
                      index={i}
                      current={currentKey === key}
                      open={open}
                      onOpen={() => (open ? closeEditor() : setEditing(key))}
                      onTick={() => (slot.done ? untick(item, ex, i) : askFirst ? setEditing(key) : tick(item, ex, i))}
                    />
                    {open && (
                      <SetEditor
                        type={type}
                        slot={slot}
                        name={single ? ex.name : `Set ${i + 1}`}
                        single={single}
                        weightStep={bumpStep(type)}
                        removable={!!slot.added}
                        onLog={(values) => logSet(item, ex, i, values)}
                        onSkip={() => skipSet(item, ex, i)}
                        onRemove={() => removeSet(item, ex, i)}
                        onCancel={closeEditor}
                      />
                    )}
                  </Fragment>
                );
              })}
            </div>
            {ask && (
              <div className="wk-prompt" role="group" aria-label="Use the change for later sets">
                <p>
                  Set {ask.fromIndex + 1} changed to {changedText(type, ask.patch)}. Use it for {setsText(ask.later).toLowerCase()} too?
                </p>
                <div className="wk-prompt-actions">
                  <Button onClick={() => setPrompt(null)}>Just this set</Button>
                  <Button kind="primary" onClick={() => applyPrompt(ask, ex)}>
                    {setsText(ask.later)}
                  </Button>
                </div>
              </div>
            )}
            <div className="wk-block-actions">
              {!single && (
                <Button kind="ghost" icon="plus" onClick={() => addSet(item, ex)}>
                  Add set
                </Button>
              )}
              {!complete && (
                <Button kind="ghost" onClick={() => skipExercise(item, ex)}>
                  Skip exercise
                </Button>
              )}
            </div>
          </section>
        );
      })}
      {!exercises.length && <Empty title="No exercises in this plan">Add one below, or use Edit plan.</Empty>}

      <section className="card wk-foot" aria-label="Finish">
        <div className="row gap-sm grow-first">
          <select className="input" id={`wk-add-${plan.id}`} aria-label="Add an exercise" value={addId} onChange={(e) => setAddId(e.target.value)}>
            <option value="">Add an exercise…</option>
            {d.exercisesSorted
              .filter((e) => !plan.items.some((i) => i.exerciseId === e.id))
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({typeOf(d, e).name})
                </option>
              ))}
          </select>
          <Button icon="plus" onClick={addExercise} disabled={!addId}>
            Add
          </Button>
        </div>
        {finished ? (
          <div className="wk-done" aria-labelledby={`wk-done-${plan.id}`}>
            <h2 className="wk-done-title" id={`wk-done-${plan.id}`} ref={summaryHead} tabIndex={-1}>
              Workout finished
            </h2>
            <p className="wk-done-count">
              <b>{progress.done}</b> of {plural(progress.total, 'set')} done
              {progress.skipped > 0 && ` · ${progress.skipped} skipped`}
            </p>
            {shortfalls.length ? (
              <>
                <p className="muted small">Short of the target:</p>
                <ul className="wk-misses">
                  {shortfalls.map((s) => (
                    <li key={s.ex.id}>
                      <b>{s.ex.name}</b>: {s.text}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>Every exercise hit its target.</p>
            )}
            <div className="wk-done-actions">
              <Button onClick={reopen}>Reopen</Button>
              <Button kind="primary" icon="check" onClick={() => navigate('/')}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <Button kind="primary" icon="check" className="wk-finish" onClick={finish}>
            Finish
          </Button>
        )}
      </section>

      <div className="visually-hidden" role="status" aria-live="polite">
        <span key={said.n}>{said.text}</span>
      </div>
    </>
  );
}

/** The exercise's note for today, saved when the field loses focus and copied into its entry. */
function NoteField({ name, notes, onSave }: { name: string; notes: string; onSave: (notes: string) => void }) {
  const [open, setOpen] = useState(!!notes);
  const [text, setText] = useState(notes);
  if (!open) {
    return (
      <div>
        <Button size="sm" kind="ghost" icon="plus" onClick={() => setOpen(true)}>
          Add note
        </Button>
      </div>
    );
  }
  return (
    <Field label="Note" optional>
      <textarea
        className="input"
        rows={2}
        aria-label={`Note for ${name}`}
        autoFocus={!notes}
        placeholder="How it felt, equipment, anything to remember"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text.trim() !== notes) onSave(text.trim());
          else if (!text.trim()) setOpen(false);
        }}
      />
    </Field>
  );
}

interface SetRowProps {
  type: ExerciseType;
  item: PlanItem;
  slot: PlannedSet;
  index: number;
  current: boolean;
  /** Its editor is open underneath. */
  open: boolean;
  onOpen: () => void;
  onTick: () => void;
}

/** One set: its number, the target (or what was done, with the target struck through), and the tick. */
function SetRow({ type, item, slot, index, current, open, onOpen, onTick }: SetRowProps) {
  const single = !isSetItem(item);
  const shown = slot.done ?? slot.target;
  const label = valuesText(type, item, shown);
  const planned = slot.done && diffFromTarget(slot).length && valuesText(type, item, slot.target);
  const state = slot.done ? `done${planned ? `, planned ${planned}` : ''}` : slot.skipped ? 'skipped' : 'not done';
  const name = single ? 'Effort' : `Set ${index + 1}`;
  return (
    <div className={clsx('wk-set', slot.done && 'done', slot.skipped && 'skipped', current && 'current', open && 'open')} data-set={refKey(item.key, index)}>
      <button type="button" className="wk-set-main" aria-expanded={open} aria-label={`${name}, ${label || 'no target'}, ${state}. ${slot.done ? 'Change what was done' : 'Adjust'}`} onClick={onOpen}>
        {!single && <span className="set-n">{index + 1}</span>}
        <span className="wk-set-text">
          <SetText type={type} item={item} slot={slot} />
        </span>
      </button>
      <button type="button" className="wk-tick" aria-label={`${name}, ${label || 'no target'}, ${state}`} onClick={onTick}>
        <Icon name={slot.skipped ? 'close' : 'check'} size={22} />
      </button>
    </div>
  );
}

function SetText({ type, item, slot }: { type: ExerciseType; item: PlanItem; slot: PlannedSet }) {
  const single = !isSetItem(item);
  const target = valuesText(type, item, slot.target);
  if (!slot.done) {
    const body = target ? (single ? `Target ${target}` : target) : <span className="muted">No target · tap to log</span>;
    return slot.skipped ? (
      <>
        <span className="wk-skipped-val">{body}</span> <span className="badge">Skipped</span>
      </>
    ) : (
      <>{body}</>
    );
  }
  const changed = diffFromTarget(slot);
  if (!changed.length) return <>{single ? `Done ${valuesText(type, item, slot.done)}` : valuesText(type, item, slot.done)}</>;
  if (single) {
    return (
      <>
        {target && (
          <s className="wk-was">
            <span className="visually-hidden">planned </span>
            {target}
          </s>
        )}{' '}
        Done {valuesText(type, item, slot.done)}
      </>
    );
  }
  return <>{diffNodes(type, slot.target, slot.done, changed)}</>;
}

/** "~~5~~ 4 × 115 lb": each changed field shows its target struck through, then what was done. */
function diffNodes(type: ExerciseType, target: SetValues, done: SetValues, changed: string[]): ReactNode {
  const fields = type.fields.filter((f) => f.kind !== 'text' && (hasValue(done[f.key]) || hasValue(target[f.key])));
  const one = (f: (typeof fields)[number]) =>
    changed.includes(f.key) ? (
      <span key={f.key}>
        {hasValue(target[f.key]) && (
          <s className="wk-was">
            <span className="visually-hidden">planned </span>
            {fieldText(f, target[f.key])}
          </s>
        )}{' '}
        {fieldText(f, done[f.key]) || '–'}
      </span>
    ) : (
      <span key={f.key}>{fieldText(f, done[f.key])}</span>
    );
  const joined = (fs: typeof fields) => fs.map((f, i) => <Fragment key={f.key}>{i > 0 && ' · '}{one(f)}</Fragment>);
  const [first, ...rest] = fields;
  if (!first) return null;
  if (first.key === 'reps') return <>{one(first)}{rest.length ? <> × {joined(rest)}</> : ` ${Number(done.reps) === 1 ? 'rep' : 'reps'}`}</>;
  return <>{joined(fields)}</>;
}
