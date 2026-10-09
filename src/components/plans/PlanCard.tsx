import clsx from 'clsx';
import { useData } from '../../data/DataProvider';
import { useToday } from '../../data/hooks';
import type { Plan } from '../../db/types';
import { plural } from '../../lib/format';
import { dayLabel, planExercises, planProgress, planStatus, STATUS_LABEL, visiblePlan, type PlanStatus } from '../../lib/plans';
import { Button, IconButton } from '../ui';
import { usePlanActions } from './usePlanActions';

export function StatusChip({ status }: { status: PlanStatus }) {
  return <span className={clsx('plan-status', status)}>{STATUS_LABEL[status]}</span>;
}

/** The button that opens the workout screen: Start, Resume, or Open once done. */
export const startLabel = (status: PlanStatus) => (status === 'in-progress' ? 'Resume' : status === 'done' ? 'Open' : 'Start');

/** A plan on the Plans page: name, exercises, set count and status, with its actions. */
export function PlanCard({ plan, showDate }: { plan: Plan; showDate?: boolean }) {
  const d = useData();
  const t = useToday();
  const actions = usePlanActions();
  const vis = visiblePlan(d, plan);
  const status = planStatus(vis, t);
  const progress = planProgress(vis);
  const names = planExercises(d, plan).map((x) => x.ex.name);
  return (
    <article className={clsx('plan-card', status)} aria-label={`${plan.name}, ${STATUS_LABEL[status]}`}>
      <div className="plan-card-head">
        <h3 className="plan-card-name">{plan.name}</h3>
        <StatusChip status={status} />
      </div>
      <div className="plan-card-list">{names.length ? names.join(' · ') : 'No exercises yet'}</div>
      <div className="plan-card-meta">
        {showDate && <span>{dayLabel(plan.date, t)} · </span>}
        {plural(progress.total, 'set')}
        {progress.done > 0 && ` · ${progress.done} done`}
      </div>
      <div className="plan-card-actions">
        {plan.date <= t && (
          <Button size="sm" kind={status === 'done' ? 'default' : 'primary'} onClick={() => void actions.start(plan)}>
            {startLabel(status)}
          </Button>
        )}
        <Button size="sm" kind="ghost" icon="edit" onClick={() => actions.edit(plan)}>
          Edit
        </Button>
        <Button size="sm" kind="ghost" icon="copy" onClick={() => actions.pickDuplicate(plan)}>
          Duplicate to…
        </Button>
        <Button size="sm" kind="ghost" icon="calendar" onClick={() => actions.pickMove(plan)}>
          Move to…
        </Button>
        <IconButton icon="trash" size={16} label={`Delete ${plan.name}`} className="plan-card-del" onClick={() => void actions.remove(plan)} />
      </div>
    </article>
  );
}
