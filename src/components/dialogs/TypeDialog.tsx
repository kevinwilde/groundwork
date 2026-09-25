import { useId, useState, type FormEvent } from 'react';
import { useData } from '../../data/DataProvider';
import { del, put } from '../../data/ops';
import type { ExerciseType, FieldKind, TypeField } from '../../db/types';
import { nextColor } from '../../lib/colors';
import { plural, slugKey } from '../../lib/format';
import { uid } from '../../lib/ids';
import { Modal } from '../Modal';
import { notify, save, saveWithUndo } from '../toast';
import { Button, Field, FormError, IconButton, Segmented, Swatches } from '../ui';

const KINDS: { value: FieldKind; label: string }[] = [
  { value: 'int', label: 'Whole number' },
  { value: 'number', label: 'Decimal number' },
  { value: 'duration', label: 'Time (duration)' },
  { value: 'text', label: 'Text' },
];

/** Draft field: `key` stays empty until first save, then never changes. */
type Draft = TypeField & { draftId: string };

export function TypeDialog({ type: existing, onClose }: { type?: ExerciseType; onClose: () => void }) {
  const d = useData();
  const formId = useId();
  const isNew = !existing;
  const [t, setT] = useState<ExerciseType>(
    () => existing ?? { id: uid('type'), name: '', mode: 'sets', color: nextColor(d.raw.types.map((x) => x.color)), fields: [], order: 50, createdAt: Date.now() },
  );
  const [fields, setFields] = useState<Draft[]>(() =>
    (existing?.fields ?? [{ key: 'reps', label: 'Reps', kind: 'int' as const }]).map((f) => ({ ...f, draftId: uid('f') })),
  );
  const [error, setError] = useState<string | null>(null);
  const inUse = isNew ? 0 : d.raw.exercises.filter((e) => e.typeId === t.id).length;

  const setField = (i: number, patch: Partial<Draft>) => setFields((fs) => fs.map((f, fi) => (fi === i ? { ...f, ...patch } : f)));
  const move = (i: number, dir: -1 | 1) =>
    setFields((fs) => {
      const j = i + dir;
      if (j < 0 || j >= fs.length) return fs;
      const next = [...fs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const name = t.name.trim();
    if (!name) return setError('Give the type a name.');
    const kept = fields.filter((f) => f.label.trim());
    if (!kept.length) return setError('Add at least one field.');
    const used = new Set(kept.map((f) => f.key).filter(Boolean));
    const out: TypeField[] = kept.map(({ draftId: _draftId, ...f }) => {
      let key = f.key;
      if (!key) {
        const base = slugKey(f.label);
        key = base;
        for (let n = 2; used.has(key); n++) key = base + n;
        used.add(key);
      }
      const field: TypeField = { key, label: f.label.trim(), kind: f.kind };
      if (f.kind === 'duration') field.plain = f.plain ?? 's';
      else if (f.kind !== 'text' && f.unit?.trim()) field.unit = f.unit.trim();
      return field;
    });
    if (await save([put('types', { ...t, name, fields: out })])) {
      notify(isNew ? `Added type ${name}` : `Saved type ${name}`);
      onClose();
    }
  }

  function remove() {
    if (inUse) return setError(`${plural(inUse, 'exercise')} use this type. Move them to another type before deleting it.`);
    onClose();
    void saveWithUndo([del('types', t.id)], `Deleted type ${t.name}`);
  }

  return (
    <Modal
      title={isNew ? 'New exercise type' : 'Edit exercise type'}
      subtitle={inUse ? `Used by ${plural(inUse, 'exercise')}` : undefined}
      size="lg"
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
            {isNew ? 'Add type' : 'Save'}
          </Button>
        </>
      }
    >
      <form id={formId} className="stack" onSubmit={submit} noValidate>
        <Field label="Name">
          <input className="input" id={`${formId}-name`} autoFocus autoComplete="off" placeholder="e.g. Ride, Swim, Carry" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
        </Field>
        <Field label="How it is recorded" group hint={inUse ? 'Changing this affects how existing entries of this type can be edited.' : undefined}>
          <Segmented
            options={[
              { value: 'sets', label: 'Sets (fields repeat per set)' },
              { value: 'single', label: 'Single effort' },
            ]}
            value={t.mode}
            onChange={(mode) => mode && setT({ ...t, mode })}
          />
        </Field>
        <Field
          label="Fields"
          group
          hint="Fields named Reps, Weight, Time and Distance feed calendar measures like volume and total distance. Time plus Distance shows pace."
        >
          <div className="type-fields">
            {fields.map((f, i) => (
              <div className="type-field" key={f.draftId}>
                <input className="input" id={`${formId}-label-${i}`} aria-label="Field label" placeholder="Label" value={f.label} onChange={(e) => setField(i, { label: e.target.value })} />
                <select className="input" id={`${formId}-kind-${i}`} aria-label="Field kind" value={f.kind} onChange={(e) => setField(i, { kind: e.target.value as FieldKind })}>
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
                {f.kind === 'duration' ? (
                  <select className="input" id={`${formId}-plain-${i}`} aria-label="Plain number means" value={f.plain ?? 's'} onChange={(e) => setField(i, { plain: e.target.value as 's' | 'min' })}>
                    <option value="s">A plain number means seconds</option>
                    <option value="min">A plain number means minutes</option>
                  </select>
                ) : (
                  <input
                    className="input"
                    id={`${formId}-unit-${i}`}
                    aria-label="Unit"
                    placeholder="Unit (lb, mi, bpm)"
                    disabled={f.kind === 'text'}
                    value={f.unit ?? ''}
                    onChange={(e) => setField(i, { unit: e.target.value })}
                  />
                )}
                <div className="row gap-xs">
                  <IconButton icon="up" size={16} label="Move up" onClick={() => move(i, -1)} disabled={i === 0} />
                  <IconButton icon="down" size={16} label="Move down" onClick={() => move(i, 1)} disabled={i === fields.length - 1} />
                  <IconButton icon="close" size={16} label="Remove field" onClick={() => setFields((fs) => fs.filter((_, fi) => fi !== i))} />
                </div>
              </div>
            ))}
            <div>
              <Button size="sm" kind="ghost" icon="plus" onClick={() => setFields((fs) => [...fs, { key: '', label: '', kind: 'number', draftId: uid('f') }])}>
                Add field
              </Button>
            </div>
          </div>
        </Field>
        <Field label="Colour" group>
          <Swatches value={t.color} onChange={(color) => setT({ ...t, color })} />
        </Field>
        <FormError>{error}</FormError>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
