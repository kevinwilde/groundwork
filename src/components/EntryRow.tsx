import clsx from 'clsx';
import { useData } from '../data/DataProvider';
import { del } from '../data/ops';
import type { Entry, Exercise } from '../db/types';
import { fmtDate, fmtShort } from '../lib/dates';
import { exerciseColor, summarizeEntry, tagsOf, typeOf } from '../lib/model';
import { EntryDialog } from './dialogs/EntryDialog';
import { useModals } from './Modal';
import { saveWithUndo } from './toast';
import { Badge, Dot, IconButton, TagChips, TypePill } from './ui';

export function ExerciseHeader({ exercise, compact }: { exercise: Exercise; compact?: boolean }) {
  const d = useData();
  return (
    <div className={clsx('ex-head', compact && 'compact')}>
      <div className="ex-head-name">
        <Dot color={exerciseColor(d, exercise)} />
        {exercise.name}
      </div>
      <div className="ex-head-meta">
        <TypePill type={typeOf(d, exercise)} />
        <TagChips tags={tagsOf(d, exercise)} />
      </div>
    </div>
  );
}

interface EntryRowProps {
  entry: Entry;
  color?: string;
  showTags?: boolean;
  showDate?: boolean;
  dim?: boolean;
  readonly?: boolean;
}

export function EntryRow({ entry, color, showTags, showDate, dim, readonly }: EntryRowProps) {
  const d = useData();
  const modals = useModals();
  const ex = d.exercises.get(entry.exerciseId);
  if (!ex) return null;
  const session = entry.sessionId ? d.sessions.get(entry.sessionId) : undefined;
  return (
    <div className={clsx('entry-row', dim && 'dim')}>
      <Dot color={color ?? exerciseColor(d, ex)} className="entry-dot" />
      <div className="entry-main">
        <div className="entry-title">
          <span className="entry-name">{ex.name}</span>
          {entry.source === 'snack' && <Badge>snack</Badge>}
          {session && <Badge>{session.name}</Badge>}
          {entry.sample && <Badge kind="sample">sample</Badge>}
          {showDate && <span className="muted entry-date">{fmtShort(entry.date)}</span>}
        </div>
        <div className="entry-sum">{summarizeEntry(d, entry)}</div>
        {entry.notes && <div className="entry-notes">{entry.notes}</div>}
        {showTags && <TagChips tags={tagsOf(d, ex)} />}
      </div>
      {!readonly && (
        <div className="entry-actions">
          <IconButton icon="edit" size={16} label={`Edit ${ex.name}`} onClick={() => modals.open((close) => <EntryDialog entry={entry} onClose={close} />)} />
          <IconButton icon="trash" size={16} label={`Delete ${ex.name}`} onClick={() => saveWithUndo([del('entries', entry.id)], `Deleted ${ex.name} on ${fmtDate(entry.date)}`)} />
        </div>
      )}
    </div>
  );
}
