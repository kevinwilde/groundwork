import { useNavigate } from 'react-router-dom';
import { useData } from '../../data/DataProvider';
import { useToday } from '../../data/hooks';
import type { Data } from '../../data/snapshot';
import { addDays, type DateStr } from '../../lib/dates';
import { plural } from '../../lib/format';
import { dayLabel, missedPlans, planExercises, planProgress, planStatus, upcomingPlans, visiblePlan } from '../../lib/plans';
import { Button, SectionHead } from '../ui';
import { startLabel, StatusChip } from './PlanCard';
import { onDay, usePlanActions } from './usePlanActions';

/** What the Planned card shows: today's plans, the next three in the coming week, and the latest missed one. */
function planned(d: Data, today: DateStr) {
  return {
    todays: d.plansByDate.get(today) ?? [],
    coming: upcomingPlans(d, today, addDays(today, 7)).slice(0, 3),
    missed: missedPlans(d, today)[0],
  };
}

/** Whether Today shows the Planned card: a plan today, one in the next 7 days, or a missed one. */
export function hasPlannedCard(d: Data, today: DateStr): boolean {
  const p = planned(d, today);
  return p.todays.length > 0 || p.coming.length > 0 || !!p.missed;
}

/** Today's "Planned" card, at the top of the left column. */
export function PlannedCard() {
  const d = useData();
  const t = useToday();
  const navigate = useNavigate();
  const actions = usePlanActions();
  const { todays, coming, missed } = planned(d, t);
  if (!todays.length && !coming.length && !missed) return null;
  return (
    <section className="card plan-today" aria-labelledby="planned-title">
      <SectionHead title={<span id="planned-title">Planned</span>} />
      {todays.length > 0 && (
        <div className="plan-today-list">
          {todays.map((p) => {
            const vis = visiblePlan(d, p);
            const status = planStatus(vis, t);
            const progress = planProgress(vis);
            return (
              <div className="plan-today-row" key={p.id}>
                <div className="plan-today-text">
                  <span className="plan-card-name">{p.name}</span>
                  <span className="muted small">
                    {progress.done ? `${progress.done} of ${plural(progress.total, 'set')}` : plural(progress.total, 'set')}
                    {planExercises(d, p).length > 0 && ` · ${planExercises(d, p).map((x) => x.ex.name).join(' · ')}`}
                  </span>
                </div>
                {status === 'done' && <StatusChip status={status} />}
                <Button kind={status === 'done' ? 'default' : 'primary'} onClick={() => void actions.start(p)}>
                  {startLabel(status)}
                </Button>
              </div>
            );
          })}
        </div>
      )}
      {coming.length > 0 && (
        <div className="plan-coming">
          <div className="picker-label">Coming up</div>
          {coming.map((p) => (
            <button type="button" className="plan-coming-row" key={p.id} onClick={() => actions.edit(p)} aria-label={`${dayLabel(p.date, t)}, ${p.name}. Edit plan`}>
              <span className="plan-coming-day">{dayLabel(p.date, t)}</span>
              <span>· {p.name}</span>
            </button>
          ))}
        </div>
      )}
      {missed && (
        <div className="plan-today-missed">
          <span>
            {missed.name} was planned for {onDay(missed.date, t)}.
          </span>
          <Button size="sm" onClick={() => void actions.moveTo(missed, t)}>
            Move to today
          </Button>
        </div>
      )}
      <div className="plan-today-foot">
        <Button size="sm" kind="ghost" icon="plus" onClick={() => actions.newPlan(t)}>
          Plan a workout
        </Button>
        <Button size="sm" kind="ghost" onClick={() => navigate('/plan')}>
          All plans
        </Button>
      </div>
    </section>
  );
}
