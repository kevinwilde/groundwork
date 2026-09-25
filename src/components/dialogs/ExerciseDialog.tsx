import { useId, useState, type FormEvent } from 'react';
import { useData } from '../../data/DataProvider';
import { put } from '../../data/ops';
import type { Exercise, Tag } from '../../db/types';
import { nextColor } from '../../lib/colors';
import { plural } from '../../lib/format';
import { uid } from '../../lib/ids';
import { entriesFor, opsDeleteExercise } from '../../lib/model';
import { Modal, useModals } from '../Modal';
import { notify, save, saveWithUndo } from '../toast';
import { Button, Chip, Field, FormError, Swatches, Switch } from '../ui';

interface Props {
  exercise?: Exercise;
  /** Prefill the name for a new exercise. */
  name?: string;
  onSaved?: (ex: Exercise) => void;
  onClose: () => void;
}

export function ExerciseDialog({ exercise, name = '', onSaved, onClose }: Props) {
  const d = useData();
  const modals = useModals();
  const formId = useId();
  const isNew = !exercise;
  const [ex, setEx] = useState<Exercise>(
    () =>
      exercise ?? {
        id: uid('ex'),
        name,
        typeId: d.typesSorted[0]?.id ?? '',
        tagIds: [],
        color: nextColor(d.raw.exercises.map((e) => e.color)),
        notes: '',
        archived: false,
        createdAt: Date.now(),
      },
  );
  const [error, setError] = useState<string | null>(null);
  const count = isNew ? 0 : entriesFor(d, ex.id).length;
  const set = (patch: Partial<Exercise>) => setEx((e) => ({ ...e, ...patch }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = ex.name.trim();
    if (!trimmed) return setError('Give the exercise a name.');
    const dupe = d.raw.exercises.find((o) => o.id !== ex.id && o.name.toLowerCase() === trimmed.toLowerCase());
    if (dupe) return setError(`You already have an exercise called ${dupe.name}.`);
    if (!ex.typeId) return setError('Choose a type.');
    const value = { ...ex, name: trimmed, updatedAt: Date.now() };
    if (await save([put('exercises', value)])) {
      notify(isNew ? `Added ${value.name}` : `Saved ${value.name}`);
      onSaved?.(value);
      onClose();
    }
  }

  async function remove() {
    const ok = await modals.confirm({
      title: `Delete ${ex.name}?`,
      message: count
        ? `This also deletes ${plural(count, 'logged entry', 'logged entries')} and any mini-exercises that use it. Archive it instead to keep the history.`
        : 'This exercise has no logged entries.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    onClose();
    await saveWithUndo(opsDeleteExercise(d, ex.id), `Deleted ${ex.name}`);
  }

  return (
    <Modal
      title={isNew ? 'New exercise' : 'Edit exercise'}
      subtitle={count ? `${plural(count, 'entry', 'entries')} logged` : undefined}
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
            {isNew ? 'Add exercise' : 'Save'}
          </Button>
        </>
      }
    >
      <form id={formId} className="stack" onSubmit={submit} noValidate>
        <Field label="Name">
          <input className="input" id={`${formId}-name`} autoFocus autoComplete="off" placeholder="e.g. Romanian Deadlift" value={ex.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Type" hint="The type decides what you record: sets of reps and weight, or time, distance and heart rate.">
          <select className="input" id={`${formId}-type`} value={ex.typeId} onChange={(e) => set({ typeId: e.target.value })}>
            {d.typesSorted.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.mode === 'sets' ? 'sets of ' : ''}
                {t.fields
                  .slice(0, 3)
                  .map((f) => f.label.toLowerCase())
                  .join(', ')}
                )
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tags" optional group>
          <TagPicker selected={ex.tagIds} onChange={(tagIds) => set({ tagIds })} />
        </Field>
        <Field label="Colour on the calendar" group>
          <Swatches value={ex.color} onChange={(color) => set({ color })} />
        </Field>
        <Field label="Notes" optional>
          <textarea className="input" id={`${formId}-notes`} rows={2} placeholder="Setup, cues, links" value={ex.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
        {!isNew && <Switch id={`${formId}-archived`} checked={ex.archived} onChange={(archived) => set({ archived })} label="Archived (hidden from pickers, history kept)" />}
        <FormError>{error}</FormError>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

/** Toggle existing tags, or type a new one and press Enter. */
export function TagPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const d = useData();
  const [name, setName] = useState('');
  const id = useId();

  async function add() {
    const n = name.trim().toLowerCase();
    if (!n) return;
    let tag = d.tagsSorted.find((t) => t.name.toLowerCase() === n);
    if (!tag) {
      tag = { id: uid('tag'), name: n, color: nextColor(d.raw.tags.map((t) => t.color)), createdAt: Date.now() } satisfies Tag;
      if (!(await save([put('tags', tag)]))) return;
    }
    if (!selected.includes(tag.id)) onChange([...selected, tag.id]);
    setName('');
  }

  return (
    <div className="tag-picker">
      <div className="chips wrap">
        {d.tagsSorted.map((t) => (
          <Chip
            key={t.id}
            label={t.name}
            color={t.color}
            on={selected.includes(t.id)}
            onClick={() => onChange(selected.includes(t.id) ? selected.filter((x) => x !== t.id) : [...selected, t.id])}
          />
        ))}
      </div>
      <div className="row gap-sm">
        <input
          className="input sm"
          id={`${id}-new-tag`}
          aria-label="New tag name"
          placeholder="New tag"
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            }
          }}
        />
        <Button size="sm" icon="plus" onClick={add} disabled={!name.trim()}>
          Add tag
        </Button>
      </div>
    </div>
  );
}
