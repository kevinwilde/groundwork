import { useId, useState, type FormEvent } from 'react';
import { useData } from '../../data/DataProvider';
import { put } from '../../data/ops';
import type { Tag } from '../../db/types';
import { nextColor } from '../../lib/colors';
import { plural } from '../../lib/format';
import { uid } from '../../lib/ids';
import { opsDeleteTag } from '../../lib/model';
import { Modal, useModals } from '../Modal';
import { notify, save, saveWithUndo } from '../toast';
import { Button, Field, FormError, Swatches } from '../ui';

export function TagDialog({ tag: existing, onClose }: { tag?: Tag; onClose: () => void }) {
  const d = useData();
  const modals = useModals();
  const formId = useId();
  const isNew = !existing;
  const [tag, setTag] = useState<Tag>(() => existing ?? { id: uid('tag'), name: '', color: nextColor(d.raw.tags.map((t) => t.color)), createdAt: Date.now() });
  const [error, setError] = useState<string | null>(null);
  const used = d.raw.exercises.filter((e) => e.tagIds.includes(tag.id)).length;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const name = tag.name.trim().toLowerCase();
    if (!name) return setError('Give the tag a name.');
    if (d.raw.tags.some((t) => t.id !== tag.id && t.name.toLowerCase() === name)) return setError('That tag already exists.');
    if (await save([put('tags', { ...tag, name })])) {
      notify(isNew ? `Added tag ${name}` : `Saved tag ${name}`);
      onClose();
    }
  }

  async function remove() {
    const ok = await modals.confirm({
      title: `Delete tag ${tag.name}?`,
      message: used ? `It will be removed from ${plural(used, 'exercise')}. The exercises and their history stay.` : 'No exercises use this tag.',
      confirmLabel: 'Delete tag',
      danger: true,
    });
    if (!ok) return;
    onClose();
    await saveWithUndo(opsDeleteTag(d, tag.id), `Deleted tag ${tag.name}`);
  }

  return (
    <Modal
      title={isNew ? 'New tag' : 'Edit tag'}
      subtitle={used ? `Used by ${plural(used, 'exercise')}` : undefined}
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
            {isNew ? 'Add tag' : 'Save'}
          </Button>
        </>
      }
    >
      <form id={formId} className="stack" onSubmit={submit} noValidate>
        <Field label="Name">
          <input className="input" id={`${formId}-name`} autoFocus autoComplete="off" placeholder="e.g. posterior chain" value={tag.name} onChange={(e) => setTag({ ...tag, name: e.target.value })} />
        </Field>
        <Field label="Colour" group>
          <Swatches value={tag.color} onChange={(color) => setTag({ ...tag, color })} />
        </Field>
        <FormError>{error}</FormError>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
