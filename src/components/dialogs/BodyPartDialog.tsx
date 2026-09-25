import { useId, useState, type FormEvent } from 'react';
import { useData } from '../../data/DataProvider';
import { put } from '../../data/ops';
import type { BodyPart } from '../../db/types';
import { plural } from '../../lib/format';
import { uid } from '../../lib/ids';
import { opsDeleteBodyPart, ratingsCount } from '../../lib/model';
import { Modal, useModals } from '../Modal';
import { notify, save, saveWithUndo } from '../toast';
import { Button, Field, FormError, Switch } from '../ui';

export function BodyPartDialog({ bodyPart: existing, onClose }: { bodyPart?: BodyPart; onClose: () => void }) {
  const d = useData();
  const modals = useModals();
  const formId = useId();
  const isNew = !existing;
  const [bp, setBp] = useState<BodyPart>(() => existing ?? { id: uid('bp'), name: '', active: true, notes: '', order: d.raw.bodyParts.length + 1, createdAt: Date.now() });
  const [error, setError] = useState<string | null>(null);
  const ratings = isNew ? 0 : ratingsCount(d, bp.id);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const name = bp.name.trim();
    if (!name) return setError('Give the body part a name.');
    if (await save([put('bodyParts', { ...bp, name, notes: bp.notes.trim() })])) {
      notify(isNew ? `Tracking ${name}` : `Saved ${name}`);
      onClose();
    }
  }

  async function remove() {
    const ok = await modals.confirm({
      title: `Delete ${bp.name}?`,
      message: ratings
        ? `This removes ${plural(ratings, 'pain rating')} from your check-ins. To stop being asked but keep the history, mark it inactive instead.`
        : 'It has no pain ratings yet.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    onClose();
    await saveWithUndo(opsDeleteBodyPart(d, bp.id), `Deleted ${bp.name}`);
  }

  return (
    <Modal
      title={isNew ? 'Track a body part' : 'Edit body part'}
      subtitle={ratings ? `${plural(ratings, 'rating')} so far` : undefined}
      size="sm"
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <Button kind="danger-text" icon="trash" onClick={remove}>
              Delete
            </Button>
          )}
          <span className="spacer" />
          <Button kind="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" form={formId}>
            {isNew ? 'Start tracking' : 'Save'}
          </Button>
        </>
      }
    >
      <form id={formId} className="stack" onSubmit={submit} noValidate>
        <Field label="Name">
          <input className="input" id={`${formId}-name`} autoFocus autoComplete="off" placeholder="e.g. Right knee" value={bp.name} onChange={(e) => setBp({ ...bp, name: e.target.value })} />
        </Field>
        <Field label="Notes" optional>
          <textarea className="input" id={`${formId}-notes`} rows={2} placeholder="What happened, what the physio said" value={bp.notes} onChange={(e) => setBp({ ...bp, notes: e.target.value })} />
        </Field>
        <Switch id={`${formId}-active`} checked={bp.active} onChange={(active) => setBp({ ...bp, active })} label="Active (ask for a rating at each check-in)" />
        <FormError>{error}</FormError>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
