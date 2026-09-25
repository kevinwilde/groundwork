import { useId, useState, type FormEvent } from 'react';
import { useData } from '../../data/DataProvider';
import { del, put } from '../../data/ops';
import type { SavedSession, SessionItem, SetValues } from '../../db/types';
import { fmtShort } from '../../lib/dates';
import { quickPlaceholder } from '../../lib/fields';
import { plural } from '../../lib/format';
import { uid } from '../../lib/ids';
import { exerciseColor, typeOf } from '../../lib/model';
import { parsePlan, planText, sessionStats } from '../../lib/sessions';
import { Modal, useModals } from '../Modal';
import { notify, save, saveWithUndo } from '../toast';
import { Button, Dot, Field, FormError, IconButton, TypePill } from '../ui';

interface Row {
  key: string;
  exerciseId: string;
  plan: string;
  /** Kept as-is for single-effort types, which have no plan text. */
  values?: SetValues;
}

interface Props {
  session?: SavedSession;
  /** Starting exercises for a new session (e.g. from a logged day). */
  items?: SessionItem[];
  onSaved?: (s: SavedSession) => void;
  onClose: () => void;
}

export function SessionDialog({ session, items, onSaved, onClose }: Props) {
  const d = useData();
  const modals = useModals();
  const formId = useId();
  const isNew = !session;
  const [name, setName] = useState(session?.name ?? '');
  const [notes, setNotes] = useState(session?.notes ?? '');
  const [rows, setRows] = useState<Row[]>(() =>
    (session?.items ?? items ?? []).map((it) => ({
      key: uid('r'),
      exerciseId: it.exerciseId,
      plan: planText(typeOf(d, d.exercises.get(it.exerciseId)), it),
      values: it.values,
    })),
  );
  const [addId, setAddId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const stats = session ? sessionStats(d, session.id) : null;

  const present = new Set(rows.map((r) => r.exerciseId));
  const addable = d.exercisesSorted.filter((e) => !present.has(e.id));

  const setRow = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, dir: -1 | 1) =>
    setRows((rs) => {
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  function add() {
    if (!addId) return;
    setRows((rs) => [...rs, { key: uid('r'), exerciseId: addId, plan: '' }]);
    setAddId('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Give the session a name, like "Upper A".');
    const dupe = d.raw.sessions.find((s) => s.id !== session?.id && s.name.toLowerCase() === trimmed.toLowerCase());
    if (dupe) return setError(`You already have a session called ${dupe.name}.`);
    const kept = rows.filter((r) => d.exercises.has(r.exerciseId));
    if (!kept.length) return setError('Add at least one exercise.');
    const out: SessionItem[] = [];
    for (const r of kept) {
      const ex = d.exercises.get(r.exerciseId)!;
      const type = typeOf(d, ex);
      if (type.mode !== 'sets') {
        out.push(r.values ? { exerciseId: r.exerciseId, values: r.values } : { exerciseId: r.exerciseId });
        continue;
      }
      const parsed = parsePlan(type, r.plan);
      if (parsed.error) return setError(`${ex.name}: ${parsed.error}`);
      out.push(parsed.sets?.length ? { exerciseId: r.exerciseId, sets: parsed.sets } : { exerciseId: r.exerciseId });
    }
    const value: SavedSession = {
      id: session?.id ?? uid('ses'),
      name: trimmed,
      items: out,
      notes: notes.trim(),
      order: session?.order ?? d.raw.sessions.length,
      createdAt: session?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    if (await save([put('sessions', value)])) {
      notify(isNew ? `Saved session ${value.name}` : `Updated ${value.name}`);
      onSaved?.(value);
      onClose();
    }
  }

  async function remove() {
    if (!session) return;
    const ok = await modals.confirm({
      title: `Delete ${session.name}?`,
      message: stats?.count
        ? `Your ${plural(stats.count, 'logged session')} stay in your history; only the saved list of exercises is removed.`
        : 'It has not been logged yet.',
      confirmLabel: 'Delete session',
      danger: true,
    });
    if (!ok) return;
    onClose();
    await saveWithUndo([del('sessions', session.id)], `Deleted session ${session.name}`);
  }

  return (
    <Modal
      title={isNew ? 'New session' : 'Edit session'}
      subtitle={stats?.count ? `Logged ${plural(stats.count, 'time')} · last ${fmtShort(stats.last!)}` : undefined}
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
            {isNew ? 'Save session' : 'Save'}
          </Button>
        </>
      }
    >
      <form id={formId} className="stack" onSubmit={submit} noValidate>
        <Field label="Name">
          <input className="input" id={`${formId}-name`} autoFocus autoComplete="off" placeholder="e.g. Upper A" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label="Exercises"
          group
          hint="The plan is only used the first time. After that, logging the session starts from what you did last time."
        >
          <div className="session-rows">
            {rows.map((r, i) => {
              const ex = d.exercises.get(r.exerciseId);
              if (!ex) return null;
              const type = typeOf(d, ex);
              return (
                <div className="session-row" key={r.key}>
                  <span className="set-n">{i + 1}</span>
                  <span className="session-row-name">
                    <Dot color={exerciseColor(d, ex)} />
                    <span className="session-row-title">{ex.name}</span>
                    <TypePill type={type} />
                  </span>
                  {type.mode === 'sets' ? (
                    <input
                      className="input"
                      id={`${formId}-plan-${r.key}`}
                      aria-label={`Plan for ${ex.name}`}
                      autoComplete="off"
                      placeholder={`Plan, ${quickPlaceholder(type)}`}
                      value={r.plan}
                      onChange={(e) => setRow(r.key, { plan: e.target.value })}
                    />
                  ) : (
                    <span className="muted small session-row-noplan">Logged from last time</span>
                  )}
                  <span className="row gap-xs">
                    <IconButton icon="up" size={16} label="Move up" onClick={() => move(i, -1)} disabled={i === 0} />
                    <IconButton icon="down" size={16} label="Move down" onClick={() => move(i, 1)} disabled={i === rows.length - 1} />
                    <IconButton icon="close" size={16} label={`Remove ${ex.name}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} />
                  </span>
                </div>
              );
            })}
            {!rows.length && <p className="muted small">No exercises yet.</p>}
          </div>
        </Field>
        <div className="row gap-sm grow-first">
          <select className="input" id={`${formId}-add`} aria-label="Exercise to add" value={addId} onChange={(e) => setAddId(e.target.value)}>
            <option value="">Add an exercise…</option>
            {addable.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({typeOf(d, e).name})
              </option>
            ))}
          </select>
          <Button icon="plus" onClick={add} disabled={!addId}>
            Add
          </Button>
        </div>
        <Field label="Notes" optional>
          <textarea className="input" id={`${formId}-notes`} rows={2} placeholder="Warm-up, rest times, supersets" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <FormError>{error}</FormError>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
