import { useNavigate } from 'react-router-dom';
import { useData } from '../../data/DataProvider';
import type { Entry } from '../../db/types';
import { fmtLong, relDay, type DateStr } from '../../lib/dates';
import { checkinsOn, entriesOn } from '../../lib/model';
import { CheckinCard, CheckinDialog } from '../Checkin';
import { EntryRow } from '../EntryRow';
import { Modal, useModals } from '../Modal';
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
