import { useId, useState } from 'react';
import { useData } from '../../data/DataProvider';
import { del, put } from '../../data/ops';
import type { Snack } from '../../db/types';
import { uid } from '../../lib/ids';
import { typeOf } from '../../lib/model';
import { EntryEditor, type EntryEditorResult } from '../EntryEditor';
import { Modal, useModals } from '../Modal';
import { notify, save, saveWithUndo } from '../toast';
import { Button, Field, FormError, Switch } from '../ui';
import { ExerciseDialog } from './ExerciseDialog';

export function SnackDialog({ snack: existing, onClose }: { snack?: Snack; onClose: () => void }) {
  const d = useData();
  const modals = useModals();
  const formId = useId();
  const isNew = !existing;
  const [sn, setSn] = useState<Snack>(
    () => existing ?? { id: uid('sn'), exerciseId: '', instruction: '', perDay: 1, active: true, order: d.raw.snacks.length, createdAt: Date.now() },
  );
  const [error, setError] = useState<string | null>(null);
  const ex = d.exercises.get(sn.exerciseId);
  const set = (patch: Partial<Snack>) => setSn((s) => ({ ...s, ...patch }));

  async function submit({ perf }: EntryEditorResult) {
    const value: Snack = { ...sn, sets: undefined, values: undefined, ...perf, instruction: sn.instruction.trim() };
    if (!value.sets) delete value.sets;
    if (!value.values) delete value.values;
    if (await save([put('snacks', value)])) {
      notify(isNew ? 'Mini-exercise added' : 'Mini-exercise saved');
      onClose();
    }
  }

  return (
    <Modal
      title={isNew ? 'New mini-exercise' : 'Edit mini-exercise'}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <Button
              kind="danger-text"
              icon="trash"
              onClick={() => {
                onClose();
                void saveWithUndo([del('snacks', sn.id)], 'Mini-exercise deleted. Logged entries stay.');
              }}
            >
              Delete
            </Button>
          )}
          <span className="spacer" />
          <Button kind="ghost" onClick={onClose}>
            Cancel
          </Button>
          {ex ? (
            <Button kind="primary" type="submit" form={formId}>
              {isNew ? 'Add mini-exercise' : 'Save'}
            </Button>
          ) : (
            <Button kind="primary" onClick={() => setError('Choose an exercise first.')}>
              {isNew ? 'Add mini-exercise' : 'Save'}
            </Button>
          )}
        </>
      }
    >
      <div className="stack">
        <Field label="Exercise" group hint="Doing the snack logs this exercise from your library.">
          <div className="row gap-sm grow-first">
            <select className="input" id={`${formId}-ex`} value={sn.exerciseId} onChange={(e) => set({ exerciseId: e.target.value, sets: undefined, values: undefined })}>
              <option value="">Choose an exercise…</option>
              {d.exercisesSorted.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({typeOf(d, e).name})
                </option>
              ))}
            </select>
            <Button kind="ghost" size="sm" icon="plus" onClick={() => modals.open((close) => <ExerciseDialog onClose={close} onSaved={(created) => set({ exerciseId: created.id })} />)}>
              New
            </Button>
          </div>
        </Field>
        {ex && (
          <Field label="What to do" group>
            <EntryEditor key={ex.id} formId={formId} exercise={ex} mode="prescription" initial={sn} onSubmit={submit} />
          </Field>
        )}
        <Field label="Instruction" optional hint="Shown on the Today page. Leave blank to show the exercise name and amount.">
          <textarea className="input" id={`${formId}-instr`} rows={2} placeholder="e.g. Hold a plank for 60 seconds." value={sn.instruction} onChange={(e) => set({ instruction: e.target.value })} />
        </Field>
        <Field label="Times per day" hint="0 means no daily target. Snacks below their target come up first.">
          <input
            className="input sm narrow"
            id={`${formId}-perday`}
            type="number"
            min={0}
            max={20}
            inputMode="numeric"
            value={sn.perDay}
            onChange={(e) => set({ perDay: Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0)) })}
          />
        </Field>
        <Switch id={`${formId}-active`} checked={sn.active} onChange={(active) => set({ active })} label="Active (shows on the Today page)" />
        <FormError>{error}</FormError>
      </div>
    </Modal>
  );
}
