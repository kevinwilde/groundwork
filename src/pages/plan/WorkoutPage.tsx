import clsx from 'clsx';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ExerciseHeader } from '../../components/EntryRow';
import { Icon } from '../../components/Icon';
import { StatusChip } from '../../components/plans/PlanCard';
import { usePlanWriter } from '../../components/plans/usePlanWriter';
import { Button, Empty, PageHead } from '../../components/ui';
import { useData } from '../../data/DataProvider';
import { useToday } from '../../data/hooks';
import type { Exercise, ExerciseType, Plan, PlanItem, PlannedSet, SetValues } from '../../db/types';
import { fmtDate, fmtLong, fmtShort } from '../../lib/dates';
import { plural } from '../../lib/format';
import { fieldText, hasValue, summarize, summarizeEntry, typeOf } from '../../lib/model';
import {
  currentSet, diffFromTarget, isSetItem, lastDone, opsMovePlan, opsTick, opsUntick, planExercises, planProgress, planStatus, setLabel, slotsOf, visiblePlan,
} from '../../lib/plans';

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** What a set or effort says: "5 × 190 lb" for a set, "25:00 · 3.1 mi · 8:04 /mi" for a run. */
const valuesText = (type: ExerciseType, item: PlanItem, v: SetValues) => (isSetItem(item) ? setLabel(type, v) : summarize(type, { values: v }));

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
  const scrollNext = useRef(false);

  const vis = visiblePlan(d, plan);
  const progress = planProgress(vis);
  const status = planStatus(vis, t);
  const current = currentSet(vis);
  const currentKey = current ? `${current.itemKey}:${current.index}` : '';
  const exercises = planExercises(d, plan);
  const announce = (text: string) => setSaid((s) => ({ n: s.n + 1, text }));

  // After a tick, bring the next set into view (once the saved plan is back).
  useEffect(() => {
    if (!scrollNext.current) return;
    scrollNext.current = false;
    if (!currentKey) return;
    document.querySelector(`[data-set="${CSS.escape(currentKey)}"]`)?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [currentKey, plan]);

  function tick(item: PlanItem, ex: Exercise, index: number, values?: SetValues) {
    const type = typeOf(d, ex);
    const v = values ?? slotsOf(item)[index].target;
    scrollNext.current = true;
    void write((p, data) => opsTick(data, p, item.key, index, values)).then((ok) => {
      if (ok) announce(`${ex.name}${isSetItem(item) ? ` set ${index + 1}` : ''} logged, ${valuesText(type, item, v)}`);
    });
  }

  function untick(item: PlanItem, ex: Exercise, index: number) {
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
        return (
          <section key={item.key} className="card wk-block" aria-label={ex.name}>
            <ExerciseHeader exercise={ex} compact />
            <div className="plan-last">{last ? `Last: ${summarizeEntry(d, last) || 'no values'} · ${fmtShort(last.date)}` : 'First time'}</div>
            <div className="wk-sets">
              {slotsOf(item).map((slot, i) => (
                <SetRow
                  key={i}
                  type={type}
                  item={item}
                  slot={slot}
                  index={i}
                  current={currentKey === `${item.key}:${i}`}
                  onTick={() => (slot.done ? untick(item, ex, i) : tick(item, ex, i))}
                />
              ))}
            </div>
          </section>
        );
      })}
      {!exercises.length && <Empty title="No exercises in this plan">Use Edit plan to add some.</Empty>}

      <div className="visually-hidden" role="status" aria-live="polite">
        <span key={said.n}>{said.text}</span>
      </div>
    </>
  );
}

interface SetRowProps {
  type: ExerciseType;
  item: PlanItem;
  slot: PlannedSet;
  index: number;
  current: boolean;
  onTick: () => void;
}

/** One set: its number, the target (or what was done, with the target struck through), and the tick. */
function SetRow({ type, item, slot, index, current, onTick }: SetRowProps) {
  const single = !isSetItem(item);
  const shown = slot.done ?? slot.target;
  const label = valuesText(type, item, shown);
  const state = slot.done ? 'done' : slot.skipped ? 'skipped' : 'not done';
  const name = single ? 'Effort' : `Set ${index + 1}`;
  return (
    <div className={clsx('wk-set', slot.done && 'done', slot.skipped && 'skipped', current && 'current')} data-set={`${item.key}:${index}`}>
      <div className="wk-set-main">
        {!single && <span className="set-n">{index + 1}</span>}
        <span className="wk-set-text">
          <SetText type={type} item={item} slot={slot} />
        </span>
      </div>
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
