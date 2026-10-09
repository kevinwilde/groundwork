import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../../data/DataProvider';
import { useToday } from '../../data/hooks';
import { fmtDate, fmtLong, type DateStr } from '../../lib/dates';
import { plural } from '../../lib/format';
import { entriesOn } from '../../lib/model';
import { daysToCopy } from '../../lib/plans';
import { describeSession, sessionExercises } from '../../lib/sessions';
import { Modal } from '../Modal';
import { Button, Field } from '../ui';

/** "+ Plan": where to start a plan for `date` from. Opens the plan editor. */
export function PlanSourceDialog({ date, onClose }: { date: DateStr; onClose: () => void }) {
  const d = useData();
  const t = useToday();
  const navigate = useNavigate();
  const id = useId();
  const days = daysToCopy(d, t);
  const [day, setDay] = useState(days[0] ?? '');

  const go = (from: string) => {
    onClose();
    navigate(`/plan/new?date=${date}&from=${encodeURIComponent(from)}`);
  };

  const dayText = (x: DateStr) => {
    const names = [...new Set(entriesOn(d, x).filter((e) => e.source !== 'snack').map((e) => d.exercises.get(e.exerciseId)?.name).filter(Boolean))];
    return `${fmtDate(x)} · ${names.join(', ')}`;
  };

  return (
    <Modal title="Plan a workout" subtitle={fmtLong(date)} onClose={onClose}>
      <div className="stack">
        <section className="stack-sm">
          <h3 className="section-title">From a saved session</h3>
          {d.sessionsSorted.length ? (
            <div className="session-grid">
              {d.sessionsSorted.map((s) => (
                <button type="button" key={s.id} className="session-btn" onClick={() => go(`session:${s.id}`)}>
                  <span className="session-btn-name">{s.name}</span>
                  <span className="session-btn-list">{describeSession(d, s)}</span>
                  <span className="session-btn-meta">{plural(sessionExercises(d, s).length, 'exercise')}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted small">No saved sessions yet. Create them under Library → Sessions.</p>
          )}
        </section>
        <section className="stack-sm">
          <h3 className="section-title">Copy a day</h3>
          {days.length ? (
            <div className="row gap-sm grow-first">
              <Field label="Day to copy" className="plan-copy-field">
                <select className="input" id={`${id}-day`} value={day} onChange={(e) => setDay(e.target.value)}>
                  {days.map((x) => (
                    <option key={x} value={x}>
                      {dayText(x)}
                    </option>
                  ))}
                </select>
              </Field>
              <Button className="plan-copy-btn" icon="copy" onClick={() => go(`day:${day}`)} disabled={!day}>
                Copy
              </Button>
            </div>
          ) : (
            <p className="muted small">Nothing logged yet to copy.</p>
          )}
        </section>
        <section className="stack-sm">
          <h3 className="section-title">Blank</h3>
          <div>
            <Button icon="plus" onClick={() => go('blank')}>
              Start from scratch
            </Button>
          </div>
        </section>
      </div>
    </Modal>
  );
}
