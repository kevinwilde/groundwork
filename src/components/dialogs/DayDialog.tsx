import { useNavigate } from 'react-router-dom';
import { useData } from '../../data/DataProvider';
import { useToday } from '../../data/hooks';
import type { Entry } from '../../db/types';
import { fmtLong, relDay, type DateStr } from '../../lib/dates';
import { plural } from '../../lib/format';
import { checkinsOn, entriesOn } from '../../lib/model';
import { planExercises, planProgress, planStatus, visiblePlan } from '../../lib/plans';
import { CheckinCard, CheckinDialog } from '../Checkin';
import { EntryRow } from '../EntryRow';
import { Modal, useModals } from '../Modal';
import { startLabel, StatusChip } from '../plans/PlanCard';
import { usePlanActions } from '../plans/usePlanActions';
import { Button } from '../ui';

interface Props {
  date: DateStr;
  /** Entries that don't match the current calendar filter are dimmed. */
  match?: (e: Entry) => boolean;
  colorOf?: (e: Entry) => string;
  onClose: () => void;
}

export function DayDialog({ date, match, colorOf, onClose }: Props) {
  const d = useData();
  const modals = useModals();
  const navigate = useNavigate();
  const t = useToday();
  const actions = usePlanActions();
  const plans = d.plansByDate.get(date) ?? [];
  const entries = entriesOn(d, date);
  const checkins = checkinsOn(d, date);
  const rel = relDay(date);
  return (
    <Modal
      title={fmtLong(date)}
      subtitle={rel === 'today' ? 'Today' : rel}
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" icon="checkin" onClick={() => modals.open((close) => <CheckinDialog date={date} onClose={close} />)}>
            Check in
          </Button>
          <span className="spacer" />
          <Button
            kind="primary"
            icon="plus"
            onClick={() => {
              onClose();
              navigate(`/log?date=${date}`);
            }}
          >
            Log exercise
          </Button>
        </>
      }
    >
      <div className="stack">
        <section className="stack-sm">
          <div className="section-head">
            <h3 className="section-title">Plans</h3>
            <Button
              size="sm"
              kind="ghost"
              icon="plus"
              onClick={() => {
                onClose();
                actions.newPlan(date);
              }}
            >
              Plan a workout
            </Button>
          </div>
          {plans.length ? (
            <div className="plan-day-list">
              {plans.map((p) => {
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
                    <StatusChip status={status} />
                    <span className="plan-day-actions">
                      <Button
                        size="sm"
                        kind={status === 'done' ? 'default' : 'primary'}
                        onClick={() => {
                          onClose();
                          void actions.start(p);
                        }}
                      >
                        {startLabel(status)}
                      </Button>
                      <Button
                        size="sm"
                        kind="ghost"
                        icon="edit"
                        onClick={() => {
                          onClose();
                          actions.edit(p);
                        }}
                      >
                        Edit
                      </Button>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted">Nothing planned.</p>
          )}
        </section>
        <section className="stack-sm">
          <h3 className="section-title">Exercise</h3>
          {entries.length ? (
            <div className="entry-list">
              {entries.map((e) => (
                <EntryRow key={e.id} entry={e} showTags dim={match ? !match(e) : false} color={colorOf?.(e)} />
              ))}
            </div>
          ) : (
            <p className="muted">Nothing logged.</p>
          )}
        </section>
        <section className="stack-sm">
          <h3 className="section-title">Check-ins</h3>
          {checkins.length ? (
            checkins.map((c) => <CheckinCard key={c.id} checkin={c} onEdit={() => modals.open((close) => <CheckinDialog checkin={c} onClose={close} />)} />)
          ) : (
            <p className="muted">No check-ins.</p>
          )}
        </section>
      </div>
    </Modal>
  );
}
