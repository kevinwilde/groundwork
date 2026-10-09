import { useId, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { EntryEditor, type EntryEditorHandle } from '../../components/EntryEditor';
import { ExerciseHeader } from '../../components/EntryRow';
import { notify, save } from '../../components/toast';
import { Button, Empty, Field, FormError, IconButton, PageHead } from '../../components/ui';
import { useData } from '../../data/DataProvider';
import { useToday } from '../../data/hooks';
import type { Data } from '../../data/snapshot';
import type { Performance, Plan, PlanItem } from '../../db/types';
import { fmtDate, fmtLong, fmtShort, isDateStr, type DateStr } from '../../lib/dates';
import { plural } from '../../lib/format';
import { nextOrder, summarizeEntry, typeOf } from '../../lib/model';
import { blankPlan, bumpStep, bumpTargets, bumpText, isSetItem, itemFor, lastDone, opsSavePlan, planFromDay, planFromSession, planProgress, sameNamePlan, withTargets } from '../../lib/plans';

/** `#/plan/new?date=…&from=session:<id>|day:<date>|blank` and `#/plan/<id>/edit`. */
export function PlanEditorPage() {
  const { id } = useParams();
  const d = useData();
  const t = useToday();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  if (id) {
    const plan = d.plans.get(id);
    if (!plan) {
      return (
        <>
          <PageHead title="Edit plan" />
          <Empty title="Plan not found" action={<Button onClick={() => navigate('/plan')}>All plans</Button>}>
            It may have been deleted, here or on another device.
          </Empty>
        </>
      );
    }
    return <PlanEditor key={id} make={() => plan} existing />;
  }
  const date = params.get('date');
  const from = params.get('from') ?? 'blank';
  return <PlanEditor key={`${date}-${from}`} make={() => draft(d, isDateStr(date) ? date : t, from)} />;
}

/** A new plan for `date`, from a saved session, a logged day, or blank. */
function draft(d: Data, date: DateStr, from: string): Plan {
  const [kind, arg] = [from.split(':')[0], from.slice(from.indexOf(':') + 1)];
  const session = kind === 'session' ? d.sessions.get(arg) : undefined;
  if (session) return planFromSession(d, session, date);
  if (kind === 'day' && isDateStr(arg)) return planFromDay(d, arg, date);
  return blankPlan(d, date);
}

interface Block {
  item: PlanItem;
  /** Bumped to remount the editor with new targets (the +5 lb chip). */
  version: number;
}

const targetsOf = (item: PlanItem): Performance => (isSetItem(item) ? { sets: item.sets.map((s) => s.target) } : { values: item.target ?? {} });

/** `make` runs once: the plan as it was when the editor opened, or a new draft with its id. */
function PlanEditor({ make, existing = false }: { make: () => Plan; existing?: boolean }) {
  const [initial] = useState(make);
  const d = useData();
  const t = useToday();
  const navigate = useNavigate();
  const location = useLocation();
  const formId = useId();
  const editors = useRef(new Map<string, EntryEditorHandle | null>());
  const blockEls = useRef(new Map<string, HTMLElement | null>());
  const [date, setDate] = useState<DateStr>(initial.date);
  const [name, setName] = useState(initial.name);
  const [notes, setNotes] = useState(initial.notes);
  const [blocks, setBlocks] = useState<Block[]>(() => initial.items.filter((i) => d.exercises.has(i.exerciseId)).map((item) => ({ item, version: 0 })));
  const [addId, setAddId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const present = new Set(blocks.map((b) => b.item.exerciseId));
  const twin = sameNamePlan(d, date, name.trim() || 'Workout', initial.id);
  const started = existing && planProgress(initial).done > 0;

  const move = (i: number, dir: -1 | 1) =>
    setBlocks((bs) => {
      const j = i + dir;
      if (j < 0 || j >= bs.length) return bs;
      const next = [...bs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  function add() {
    if (!addId) return;
    setBlocks((bs) => [...bs, { item: itemFor(d, addId, date, lastDone(d, addId, date, initial.id) ?? undefined), version: 0 }]);
    setAddId('');
  }

  /** The +5 lb chip: read the rows, raise every weight, and show them again. */
  function bump(b: Block, step: number) {
    const res = editors.current.get(b.item.key)?.collect();
    if (!res?.perf.sets) return;
    const type = typeOf(d, d.exercises.get(b.item.exerciseId));
    const item = withTargets(b.item, { sets: bumpTargets(type, res.perf.sets, step) });
    setBlocks((bs) => bs.map((x) => (x.item.key === b.item.key ? { item, version: x.version + 1 } : x)));
  }

  function build(): Plan | null {
    if (!isDateStr(date)) {
      setError('Pick a date.');
      return null;
    }
    const kept = blocks.filter((b) => d.exercises.has(b.item.exerciseId));
    if (!kept.length) {
      setError('Add at least one exercise.');
      return null;
    }
    // Ticks made since the editor opened (another tab or device) are kept.
    const latest = d.plans.get(initial.id);
    const items: PlanItem[] = [];
    for (const b of kept) {
      const res = editors.current.get(b.item.key)?.collect();
      if (!res) {
        setError(null);
        blockEls.current.get(b.item.key)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return null;
      }
      items.push(withTargets(latest?.items.find((i) => i.key === b.item.key) ?? b.item, res.perf));
    }
    setError(null);
    const base = latest ?? initial;
    const order = existing && base.date === date ? base.order : nextOrder((d.plansByDate.get(date) ?? []).filter((p) => p.id !== initial.id));
    return { ...base, date, name: name.trim() || 'Workout', notes: notes.trim(), items, order };
  }

  async function submit(start: boolean) {
    const plan = build();
    if (!plan) return;
    setSaving(true);
    const ok = await save(opsSavePlan(d, plan, d.plans.get(initial.id)));
    setSaving(false);
    if (!ok) return;
    notify(`${existing ? 'Saved' : 'Planned'} ${plan.name} for ${fmtDate(plan.date)}`);
    navigate(start ? `/plan/${plan.id}` : '/plan');
  }

  const cancel = () => (location.key !== 'default' ? navigate(-1) : navigate('/plan'));

  return (
    <>
      <PageHead title={existing ? 'Edit plan' : 'New plan'} eyebrow={isDateStr(date) ? fmtLong(date) : 'Plan a workout'} />
      {/* Not a <form>: each exercise's EntryEditor is one. */}
      <div className="plan-editor">
        <section className="card">
          <div className="plan-editor-fields">
            <Field label="Date" className="date-field">
              <input type="date" className="input" id={`${formId}-date`} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Name">
              <input className="input" id={`${formId}-name`} autoComplete="off" placeholder="Workout" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          {twin && (
            <p className="session-warn">
              There's already a plan called {twin.name} on {fmtDate(date)}. Saving adds a second one.
            </p>
          )}
          {started && <p className="muted small">Some sets are already ticked. Changing a target doesn't change what was done.</p>}
          <Field label="Notes" optional>
            <textarea className="input" id={`${formId}-notes`} rows={2} placeholder="Warm-up, rest times, how it should feel" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </section>

        <div className="plan-blocks">
          {blocks.map((b, i) => {
            const ex = d.exercises.get(b.item.exerciseId);
            if (!ex) return null;
            const type = typeOf(d, ex);
            const step = bumpStep(type);
            const last = lastDone(d, ex.id, date, initial.id);
            const ticked = planProgress({ ...initial, items: [b.item] });
            return (
              <section
                key={b.item.key}
                ref={(el) => {
                  blockEls.current.set(b.item.key, el);
                }}
                className="card plan-block"
                aria-label={ex.name}
              >
                <div className="plan-block-head">
                  <span className="set-n">{i + 1}</span>
                  <ExerciseHeader exercise={ex} compact />
                  <span className="row gap-xs">
                    <IconButton icon="up" size={16} label={`Move ${ex.name} up`} onClick={() => move(i, -1)} disabled={i === 0} />
                    <IconButton icon="down" size={16} label={`Move ${ex.name} down`} onClick={() => move(i, 1)} disabled={i === blocks.length - 1} />
                    <IconButton icon="close" size={16} label={`Remove ${ex.name}`} onClick={() => setBlocks((bs) => bs.filter((x) => x.item.key !== b.item.key))} />
                  </span>
                </div>
                <div className="plan-last">
                  {last ? `Last: ${summarizeEntry(d, last) || 'no values'} · ${fmtShort(last.date)}` : 'Not done before'}
                  {ticked.done > 0 && ` · ${ticked.done} of ${plural(ticked.total, 'set')} done`}
                </div>
                <EntryEditor
                  key={`${b.item.key}-${b.version}`}
                  ref={(h) => {
                    editors.current.set(b.item.key, h);
                  }}
                  formId={`${formId}-${b.item.key}`}
                  exercise={ex}
                  initial={targetsOf(b.item)}
                  mode="prescription"
                  keepBlank
                />
                {step && (
                  <div>
                    <Button size="sm" kind="ghost" icon="plus" onClick={() => bump(b, step)} aria-label={bumpText(type, step).label} title={bumpText(type, step).label}>
                      {bumpText(type, step).amount}
                    </Button>
                  </div>
                )}
              </section>
            );
          })}
          {!blocks.length && <p className="muted">No exercises yet. Add one below.</p>}
        </div>

        <section className="card">
          <div className="row gap-sm grow-first">
            <select className="input" id={`${formId}-add`} aria-label="Exercise to add" value={addId} onChange={(e) => setAddId(e.target.value)}>
              <option value="">Add an exercise…</option>
              {d.exercisesSorted
                .filter((e) => !present.has(e.id))
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({typeOf(d, e).name})
                  </option>
                ))}
            </select>
            <Button icon="plus" onClick={add} disabled={!addId}>
              Add exercise
            </Button>
          </div>
          <p className="muted small">Targets are optional. A set without one asks what you did when you tick it.</p>
          <FormError>{error}</FormError>
          <div className="form-actions">
            <Button kind="ghost" onClick={cancel}>
              Cancel
            </Button>
            <Button kind={date === t ? 'default' : 'primary'} onClick={() => void submit(false)} disabled={saving}>
              Save
            </Button>
            {date === t && (
              <Button kind="primary" icon="right" onClick={() => void submit(true)} disabled={saving}>
                {started ? 'Save and resume' : 'Save and start'}
              </Button>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
