import clsx from 'clsx';
import { useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useData } from '../data/DataProvider';
import { put } from '../data/ops';
import type { Entry, Exercise, Performance, SavedSession } from '../db/types';
import { fmtShort, relDay, type DateStr } from '../lib/dates';
import { plural } from '../lib/format';
import { uid } from '../lib/ids';
import { typeOf } from '../lib/model';
import { prefill, sessionExercises, sessionRuns, type PrefillSource } from '../lib/sessions';
import { SessionDialog } from './dialogs/SessionDialog';
import { EntryEditor, type EntryEditorHandle } from './EntryEditor';
import { ExerciseHeader } from './EntryRow';
import { useModals } from './Modal';
import { save } from './toast';
import { Button, FormError, IconButton, Switch } from './ui';

interface Block {
  key: string;
  exerciseId: string;
  include: boolean;
  initial?: Performance;
  source: PrefillSource;
  /** Added for this log only, not part of the saved session. */
  extra?: boolean;
}

interface Props {
  session: SavedSession;
  date: DateStr;
  onDone: () => void;
  onCancel: () => void;
}

function sourceText(source: PrefillSource, session: SavedSession, ex: Exercise): string {
  switch (source.kind) {
    case 'session':
      return `From ${session.name} on ${fmtShort(source.date)}`;
    case 'history':
      return `From your last ${ex.name}, ${fmtShort(source.date)}`;
    case 'plan':
      return 'From the session plan';
    default:
      return 'First time: nothing to prefill';
  }
}

/** Every exercise in a saved session, prefilled, logged with one button. */
export function SessionLogger({ session, date, onDone, onCancel }: Props) {
  const d = useData();
  const modals = useModals();
  const id = useId();
  const editors = useRef(new Map<string, EntryEditorHandle | null>());
  const blockEls = useRef(new Map<string, HTMLElement | null>());
  const [blocks, setBlocks] = useState<Block[]>(() =>
    sessionExercises(d, session).map(({ item }) => {
      const p = prefill(d, session, item, date);
      return { key: uid('blk'), exerciseId: item.exerciseId, include: true, initial: p.perf, source: p.source };
    }),
  );
  const [addId, setAddId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const runs = sessionRuns(d, session.id);
  const loggedToday = runs.some((r) => r.date === date);
  const missing = session.items.length - sessionExercises(d, session).length;
  const included = blocks.filter((b) => b.include && d.exercises.has(b.exerciseId));
  const present = new Set(blocks.map((b) => b.exerciseId));

  const update = (key: string, patch: Partial<Block>) => setBlocks((bs) => bs.map((b) => (b.key === key ? { ...b, ...patch } : b)));

  function addExercise() {
    if (!addId) return;
    const p = prefill(d, session, { exerciseId: addId }, date);
    setBlocks((bs) => [...bs, { key: uid('blk'), exerciseId: addId, include: true, initial: p.perf, source: p.source, extra: true }]);
    setAddId('');
  }

  async function logAll() {
    if (!included.length) return setError('Include at least one exercise.');
    const results: { exerciseId: string; perf: Performance; notes: string }[] = [];
    for (const b of included) {
      const res = editors.current.get(b.key)?.collect();
      if (!res) {
        setError(null);
        blockEls.current.get(b.key)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      results.push({ exerciseId: b.exerciseId, ...res });
    }
    setError(null);
    setSaving(true);
    const now = Date.now();
    const entries: Entry[] = results.map((r, i) => ({
      id: uid('en'), exerciseId: r.exerciseId, date, notes: r.notes, source: 'log', sessionId: session.id, createdAt: now + i, ...r.perf,
    }));
    const inverse = await save(entries.map((e) => put('entries', e)));
    setSaving(false);
    if (!inverse) return;
    toast(`Logged ${session.name} · ${plural(entries.length, 'exercise')}`, { action: { label: 'Undo', onClick: () => void save(inverse) }, duration: 6500 });
    onDone();
  }

  return (
    <section className="card editor-card session-logger" aria-label={`Log ${session.name}`}>
      <div className="row space-between wrap gap-sm">
        <div className="session-head">
          <div className="eyebrow">Session</div>
          <h2 className="session-title">{session.name}</h2>
          <div className="muted small">
            {runs.length ? `Logged ${plural(runs.length, 'time')} · last ${relDay(runs[0].date)}` : 'First time logging this session'}
          </div>
        </div>
        <Button size="sm" kind="ghost" icon="edit" onClick={() => modals.open((close) => <SessionDialog session={session} onClose={close} />)}>
          Edit session
        </Button>
      </div>
      {session.notes && <p className="session-notes">{session.notes}</p>}
      {loggedToday && <p className="session-warn">You already logged {session.name} on this day. Logging again adds a second set of entries.</p>}
      {missing > 0 && <p className="muted small">{plural(missing, 'exercise')} in this session no longer exist and were left out.</p>}

      <div className="session-blocks">
        {blocks.map((b, i) => {
          const ex = d.exercises.get(b.exerciseId);
          if (!ex) return null;
          return (
            <div
              key={b.key}
              ref={(el) => {
                blockEls.current.set(b.key, el);
              }}
              className={clsx('session-block', !b.include && 'skipped')}
            >
              <div className="session-block-head">
                <span className="set-n">{i + 1}</span>
                <ExerciseHeader exercise={ex} compact />
                <Switch id={`${id}-inc-${b.key}`} checked={b.include} onChange={(include) => update(b.key, { include })} label={b.include ? 'Include' : 'Skipped'} />
                {b.extra ? (
                  <IconButton icon="close" size={16} label={`Remove ${ex.name}`} onClick={() => setBlocks((bs) => bs.filter((x) => x.key !== b.key))} />
                ) : (
                  <span />
                )}
              </div>
              {b.include && <div className="session-source">{b.extra ? 'Added for today. ' : ''}{sourceText(b.source, session, ex)}</div>}
              <div hidden={!b.include}>
                <EntryEditor
                  ref={(h) => {
                    editors.current.set(b.key, h);
                  }}
                  formId={`${id}-${b.key}`}
                  exercise={ex}
                  initial={b.initial}
                  date={date}
                  hideLast
                  collapseNotes
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="row gap-sm grow-first">
        <select className="input" id={`${id}-add`} aria-label="Add an exercise for today" value={addId} onChange={(e) => setAddId(e.target.value)}>
          <option value="">Add an exercise for today…</option>
          {d.exercisesSorted
            .filter((e) => !present.has(e.id))
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({typeOf(d, e).name})
              </option>
            ))}
        </select>
        <Button icon="plus" onClick={addExercise} disabled={!addId}>
          Add
        </Button>
      </div>

      <FormError>{error}</FormError>
      <div className="form-actions">
        <Button kind="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button kind="primary" icon="check" onClick={logAll} disabled={saving || !included.length}>
          {included.length === blocks.length ? `Log all ${included.length}` : `Log ${included.length} of ${blocks.length}`}
        </Button>
      </div>
    </section>
  );
}
