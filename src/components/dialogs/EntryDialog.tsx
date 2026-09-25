import { useId, useState } from 'react';
import { useData } from '../../data/DataProvider';
import { del, put } from '../../data/ops';
import type { Entry, Performance } from '../../db/types';
import { fmtDate, today, type DateStr } from '../../lib/dates';
import { uid } from '../../lib/ids';
import { summarize, typeOf } from '../../lib/model';
import { EntryEditor, type EntryEditorResult } from '../EntryEditor';
import { ExerciseHeader } from '../EntryRow';
import { Modal } from '../Modal';
import { notify, save, saveWithUndo } from '../toast';
import { Button, Field } from '../ui';

interface Props {
  /** Edit this entry… */
  entry?: Entry;
  /** …or create one. */
  exerciseId?: string;
  date?: DateStr;
  initial?: Performance;
  source?: Entry['source'];
  snackId?: string;
  onClose: () => void;
}

export function EntryDialog({ entry, exerciseId, date: date0, initial, source = 'log', snackId, onClose }: Props) {
  const d = useData();
  const formId = useId();
  const ex = d.exercises.get(entry?.exerciseId ?? exerciseId ?? '');
  const [date, setDate] = useState<DateStr>(entry?.date ?? date0 ?? today());

  if (!ex) {
    return (
      <Modal title="Exercise not found" size="sm" onClose={onClose}>
        <p>That exercise no longer exists.</p>
      </Modal>
    );
  }

  async function submit({ perf, notes }: EntryEditorResult) {
    const now = Date.now();
    const value: Entry = entry
      ? { ...entry, sets: undefined, values: undefined, ...perf, notes, date, updatedAt: now }
      : { id: uid('en'), exerciseId: ex!.id, date, notes, source, snackId: snackId ?? null, createdAt: now, ...perf };
    if (!value.sets) delete value.sets;
    if (!value.values) delete value.values;
    if (await save([put('entries', value)])) {
      notify(entry ? 'Entry updated' : `Logged ${ex!.name} · ${summarize(typeOf(d, ex), value)}`);
      onClose();
    }
  }

  return (
    <Modal
      title={entry ? 'Edit entry' : 'Log exercise'}
      onClose={onClose}
      footer={
        <>
          {entry && (
            <Button
              kind="danger-text"
              icon="trash"
              onClick={() => {
                onClose();
                void saveWithUndo([del('entries', entry.id)], `Deleted ${ex.name} on ${fmtDate(entry.date)}`);
              }}
            >
              Delete
            </Button>
          )}
          <span className="spacer" />
          <Button kind="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" form={formId}>
            {entry ? 'Save changes' : 'Log it'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <ExerciseHeader exercise={ex} />
        <Field label="Date" className="date-field">
          <input type="date" className="input" id={`${formId}-date`} value={date} onChange={(e) => setDate(e.target.value || today())} />
        </Field>
        <EntryEditor formId={formId} exercise={ex} initial={entry ?? initial} date={date} excludeId={entry?.id} onSubmit={submit} />
      </div>
    </Modal>
  );
}
