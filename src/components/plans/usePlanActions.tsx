import { useNavigate } from 'react-router-dom';
import { useData } from '../../data/DataProvider';
import { useToday } from '../../data/hooks';
import type { Plan } from '../../db/types';
import { daysBetween, fmtDate, fmtWeekday, type DateStr } from '../../lib/dates';
import { opsDeletePlan, opsDuplicatePlan, opsMovePlan } from '../../lib/plans';
import { DateDialog } from '../dialogs/DateDialog';
import { PlanSourceDialog } from '../dialogs/PlanSourceDialog';
import { useModals } from '../Modal';
import { save, saveWithUndo } from '../toast';

/** "tomorrow", "Sat", "Tue, Oct 20": the day in a sentence. */
export function onDay(date: DateStr, today: DateStr): string {
  const n = daysBetween(today, date);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return Math.abs(n) < 7 ? fmtWeekday(date) : fmtDate(date);
}

/** What a plan card, the Today card and the day dialog can do with a plan. */
export function usePlanActions() {
  const d = useData();
  const t = useToday();
  const navigate = useNavigate();
  const modals = useModals();

  /** Open the workout screen. A plan for a later day is moved to today first, if the user agrees. */
  async function start(plan: Plan) {
    if (plan.date > t) {
      const ok = await modals.confirm({
        title: `Start ${plan.name} today?`,
        message: `This plan is for ${onDay(plan.date, t)}. Move it to today and start?`,
        confirmLabel: 'Move and start',
      });
      if (!ok || !(await save(opsMovePlan(d, plan, t)))) return;
    }
    navigate(`/plan/${plan.id}`);
  }

  const moveTo = (plan: Plan, date: DateStr) => saveWithUndo(opsMovePlan(d, plan, date), `Moved ${plan.name} to ${onDay(date, t)}`);

  function pickMove(plan: Plan) {
    modals.open((close) => <DateDialog title={`Move ${plan.name}`} subtitle={`Planned for ${fmtDate(plan.date)}`} initial={plan.date} confirmLabel="Move" onPick={(date) => void moveTo(plan, date)} onClose={close} />);
  }

  function pickDuplicate(plan: Plan) {
    modals.open((close) => (
      <DateDialog
        title={`Duplicate ${plan.name}`}
        subtitle="The copy has the same exercises and targets, with nothing ticked."
        initial={plan.date < t ? t : plan.date}
        confirmLabel="Duplicate"
        onPick={(date) => void saveWithUndo(opsDuplicatePlan(d, plan, date), `Copied ${plan.name} to ${onDay(date, t)}`)}
        onClose={close}
      />
    ));
  }

  const remove = (plan: Plan) => saveWithUndo(opsDeletePlan(plan), `Deleted plan ${plan.name}. Logged sets stay in your history.`);

  const newPlan = (date: DateStr) => modals.open((close) => <PlanSourceDialog date={date} onClose={close} />);

  return { start, moveTo, pickMove, pickDuplicate, remove, newPlan, edit: (plan: Plan) => navigate(`/plan/${plan.id}/edit`) };
}
