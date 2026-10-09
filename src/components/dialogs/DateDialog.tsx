import { useId, useState, type FormEvent } from 'react';
import { isDateStr, type DateStr } from '../../lib/dates';
import { Modal } from '../Modal';
import { Button, Field, FormError } from '../ui';

interface Props {
  title: string;
  subtitle?: string;
  initial: DateStr;
  confirmLabel: string;
  onPick: (date: DateStr) => void;
  onClose: () => void;
}

/** Pick a date: Duplicate to… and Move to… on a plan. */
export function DateDialog({ title, subtitle, initial, confirmLabel, onPick, onClose }: Props) {
  const id = useId();
  const [date, setDate] = useState<DateStr>(initial);
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!isDateStr(date)) return setError('Pick a date.');
    onClose();
    onPick(date);
  }

  return (
    <Modal
      title={title}
      subtitle={subtitle}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <Button kind="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" form={id}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id={id} className="stack" onSubmit={submit} noValidate>
        <Field label="Date" className="date-field">
          <input type="date" className="input" id={`${id}-date`} autoFocus value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <FormError>{error}</FormError>
      </form>
    </Modal>
  );
}
