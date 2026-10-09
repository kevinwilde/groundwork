import { PlanCard } from '../../components/plans/PlanCard';
import { usePlanActions } from '../../components/plans/usePlanActions';
import { Button, PageHead, SectionHead } from '../../components/ui';
import { useData } from '../../data/DataProvider';
import { useToday } from '../../data/hooks';
import { addDays, daysBetween, fmtDate, fmtShort, fmtWeekday, type DateStr } from '../../lib/dates';
import { missedPlans, planExercises, upcomingPlans } from '../../lib/plans';

const DAYS = 14;

/** Plans: missed ones from the last two weeks, the next 14 days one by one, then anything later. */
export function PlansPage() {
  const d = useData();
  const t = useToday();
  const actions = usePlanActions();
  const missed = missedPlans(d, t, DAYS);
  const days = Array.from({ length: DAYS }, (_, i) => addDays(t, i));
  // Plans after the 14 days: upcoming from the last day shown.
  const later = upcomingPlans(d, addDays(t, DAYS - 1));

  const dayName = (day: DateStr) => {
    const n = daysBetween(t, day);
    return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : fmtWeekday(day);
  };

  return (
    <>
      <PageHead
        title="Plans"
        eyebrow="Workouts planned ahead"
        actions={
          <Button kind="primary" icon="plus" onClick={() => actions.newPlan(t)}>
            Plan a workout
          </Button>
        }
      />

      {missed.length > 0 && (
        <section className="card" aria-labelledby="plans-missed">
          <SectionHead title={<span id="plans-missed">Missed</span>} />
          <div className="plan-missed-list">
            {missed.map((p) => (
              <div className="plan-missed" key={p.id}>
                <div className="plan-missed-text">
                  <span className="plan-card-name">{p.name}</span>
                  <span className="muted small">
                    Planned for {fmtDate(p.date)}
                    {planExercises(d, p).length > 0 && ` · ${planExercises(d, p).map((x) => x.ex.name).join(' · ')}`}
                  </span>
                </div>
                <div className="plan-missed-actions">
                  <Button size="sm" onClick={() => void actions.moveTo(p, t)}>
                    Move to today
                  </Button>
                  <Button size="sm" kind="danger-text" icon="trash" onClick={() => void actions.remove(p)}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card" aria-labelledby="plans-next">
        <SectionHead title={<span id="plans-next">Next 14 days</span>} />
        <ol className="plan-days">
          {days.map((day) => {
            const plans = d.plansByDate.get(day) ?? [];
            return (
              <li className={plans.length ? 'plan-day has' : 'plan-day'} key={day}>
                <div className="plan-day-head">
                  <h3 className="plan-day-name">
                    {dayName(day)} <span className="plan-day-date">{fmtShort(day)}</span>
                  </h3>
                  <Button size="sm" kind="ghost" icon="plus" aria-label={`Plan a workout for ${fmtDate(day)}`} onClick={() => actions.newPlan(day)}>
                    Plan
                  </Button>
                </div>
                {plans.length > 0 && (
                  <div className="plan-day-cards">
                    {plans.map((p) => (
                      <PlanCard key={p.id} plan={p} />
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {later.length > 0 && (
        <section className="card" aria-labelledby="plans-later">
          <SectionHead title={<span id="plans-later">Later</span>} />
          <div className="plan-day-cards">
            {later.map((p) => (
              <PlanCard key={p.id} plan={p} showDate />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
