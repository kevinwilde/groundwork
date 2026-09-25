import clsx from 'clsx';
import { useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { BodyPartDialog } from '../components/dialogs/BodyPartDialog';
import { ExerciseDialog } from '../components/dialogs/ExerciseDialog';
import { SessionDialog } from '../components/dialogs/SessionDialog';
import { SnackDialog } from '../components/dialogs/SnackDialog';
import { TagDialog } from '../components/dialogs/TagDialog';
import { TypeDialog } from '../components/dialogs/TypeDialog';
import { useModals } from '../components/Modal';
import { notify, save } from '../components/toast';
import { Badge, Button, Dot, Empty, IconButton, PageHead, SectionHead, Switch, TagChips, TypePill, vars } from '../components/ui';
import { useData } from '../data/DataProvider';
import { useToday } from '../data/hooks';
import { put } from '../data/ops';
import type { BodyPart } from '../db/types';
import { painColor } from '../lib/colors';
import { relDay } from '../lib/dates';
import { plural } from '../lib/format';
import { uid } from '../lib/ids';
import { entriesFor, exerciseColor, latestPain, ratingsCount, snackStats, summarize, tagsOf, typeOf } from '../lib/model';
import { describeSession, sessionExercises, sessionStats } from '../lib/sessions';

const TABS = [
  { id: 'exercises', label: 'Exercises' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'snacks', label: 'Mini-exercises' },
  { id: 'tags', label: 'Tags' },
  { id: 'types', label: 'Types' },
  { id: 'bodyparts', label: 'Body parts' },
] as const;

export function LibraryPage() {
  const { tab } = useParams();
  const current = TABS.find((x) => x.id === tab)?.id ?? 'exercises';
  return (
    <>
      <PageHead title="Library" eyebrow="What you track" />
      <nav className="tabs" aria-label="Library sections">
        {TABS.map((x) => (
          <NavLink key={x.id} to={`/library/${x.id}`} className={() => clsx('tab', x.id === current && 'on')} aria-current={x.id === current ? 'page' : undefined}>
            {x.label}
          </NavLink>
        ))}
      </nav>
      <div className="stack">
        {current === 'exercises' && <ExercisesTab />}
        {current === 'sessions' && <SessionsTab />}
        {current === 'snacks' && <SnacksTab />}
        {current === 'tags' && <TagsTab />}
        {current === 'types' && <TypesTab />}
        {current === 'bodyparts' && <BodyPartsTab />}
      </div>
    </>
  );
}

// Filters survive switching tabs.
const libFilters = { search: '', tagId: '', archived: false };

function ExercisesTab() {
  const d = useData();
  const t = useToday();
  const modals = useModals();
  const [f, setF] = useState(libFilters);
  const set = (patch: Partial<typeof f>) =>
    setF((x) => {
      const next = { ...x, ...patch };
      Object.assign(libFilters, next);
      return next;
    });
  const q = f.search.trim().toLowerCase();
  const list = [...d.raw.exercises]
    .filter((ex) => (f.archived || !ex.archived) && (!f.tagId || ex.tagIds.includes(f.tagId)))
    .filter((ex) => !q || ex.name.toLowerCase().includes(q) || tagsOf(d, ex).some((tg) => tg.name.includes(q)) || typeOf(d, ex).name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <div className="lib-toolbar">
        <div className="lib-filters">
          <input className="input" type="search" id="lib-search" aria-label="Search exercises" placeholder="Search" autoComplete="off" value={f.search} onChange={(e) => set({ search: e.target.value })} />
          <select className="input auto" id="lib-tag" aria-label="Filter by tag" value={f.tagId} onChange={(e) => set({ tagId: e.target.value })}>
            <option value="">All tags</option>
            {d.tagsSorted.map((tg) => (
              <option key={tg.id} value={tg.id}>
                {tg.name}
              </option>
            ))}
          </select>
          <Switch id="lib-archived" checked={f.archived} onChange={(archived) => set({ archived })} label="Archived" />
        </div>
        <Button kind="primary" icon="plus" onClick={() => modals.open((close) => <ExerciseDialog onClose={close} />)}>
          New exercise
        </Button>
      </div>
      {list.length ? (
        <div className="lib-rows">
          {list.map((ex) => {
            const entries = entriesFor(d, ex.id);
            return (
              <button type="button" key={ex.id} className={clsx('lib-row', ex.archived && 'archived')} onClick={() => modals.open((close) => <ExerciseDialog exercise={ex} onClose={close} />)}>
                <Dot color={exerciseColor(d, ex)} className="entry-dot" />
                <span className="lib-row-main">
                  <span className="lib-row-title">
                    {ex.name} {ex.archived && <Badge>archived</Badge>}
                  </span>
                  <span className="lib-row-meta">
                    <TypePill type={typeOf(d, ex)} />
                    <TagChips tags={tagsOf(d, ex)} />
                  </span>
                </span>
                <span className="lib-row-side">
                  <span className="lib-count">{plural(entries.length, 'entry', 'entries')}</span>
                  <span className="muted small">{entries[0] ? `last ${relDay(entries[0].date, t)}` : 'never logged'}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <Empty title="No exercises match">{f.search || f.tagId ? 'Try a different search or tag.' : 'Add your first exercise to start logging.'}</Empty>
      )}
    </>
  );
}

function SessionsTab() {
  const d = useData();
  const t = useToday();
  const modals = useModals();
  const navigate = useNavigate();
  const add = () => modals.open((close) => <SessionDialog onClose={close} />);
  return (
    <>
      <div className="lib-toolbar">
        <p className="muted lib-intro">
          Groups of exercises you do together, like "Upper A". Logging a session prefills every exercise with what you did last time, so a repeat
          week is one tap.
        </p>
        <Button kind="primary" icon="plus" onClick={add}>
          New session
        </Button>
      </div>
      {d.sessionsSorted.length ? (
        <div className="lib-rows">
          {d.sessionsSorted.map((s) => {
            const stats = sessionStats(d, s.id);
            return (
              <div key={s.id} className="lib-row static">
                <span className="session-glyph" aria-hidden="true">
                  {sessionExercises(d, s)
                    .slice(0, 4)
                    .map(({ ex }) => (
                      <Dot key={ex.id} color={exerciseColor(d, ex)} />
                    ))}
                </span>
                <span className="lib-row-main">
                  <span className="lib-row-title">{s.name}</span>
                  <span className="lib-row-desc">{describeSession(d, s)}</span>
                  <span className="muted small">{stats.count ? `Logged ${plural(stats.count, 'time')} · last ${relDay(stats.last!, t)}` : 'Not logged yet'}</span>
                </span>
                <span className="lib-row-side row gap-sm">
                  <Button size="sm" kind="primary" onClick={() => navigate(`/log?session=${s.id}`)}>
                    Log now
                  </Button>
                  <IconButton icon="edit" label={`Edit ${s.name}`} onClick={() => modals.open((close) => <SessionDialog session={s} onClose={close} />)} />
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty
          title="No sessions yet"
          action={
            <Button kind="primary" icon="plus" onClick={add}>
              New session
            </Button>
          }
        >
          Create one here, or log a workout and use Save as session on the Log page.
        </Empty>
      )}
    </>
  );
}

function SnacksTab() {
  const d = useData();
  const t = useToday();
  const modals = useModals();
  const add = () => modals.open((close) => <SnackDialog onClose={close} />);
  return (
    <>
      <div className="lib-toolbar">
        <p className="muted lib-intro">Short movements you can do any time. The Today page suggests the one you have done least recently, and one tap logs the linked exercise.</p>
        <Button kind="primary" icon="plus" onClick={add}>
          New mini-exercise
        </Button>
      </div>
      {d.snacksSorted.length ? (
        <div className="lib-rows">
          {d.snacksSorted.map((sn) => {
            const ex = d.exercises.get(sn.exerciseId);
            const stats = snackStats(d, sn, t);
            return (
              <div key={sn.id} className={clsx('lib-row', 'static', !sn.active && 'archived')}>
                <Dot color={ex ? exerciseColor(d, ex) : 'var(--ink-3)'} className="entry-dot" />
                <span className="lib-row-main">
                  <span className="lib-row-title">
                    {ex?.name ?? 'Missing exercise'} <span className="lib-rx">{ex ? summarize(typeOf(d, ex), sn) : ''}</span>
                  </span>
                  {sn.instruction && <span className="lib-row-desc">{sn.instruction}</span>}
                  <span className="muted small">
                    {sn.perDay ? `${sn.perDay}× a day target` : 'No daily target'} · done {plural(stats.total, 'time')}
                  </span>
                </span>
                <span className="lib-row-side row gap-sm">
                  <Switch id={`sn-act-${sn.id}`} checked={sn.active} onChange={(active) => save([put('snacks', { ...sn, active })])} label={sn.active ? 'Active' : 'Paused'} />
                  <IconButton icon="edit" label="Edit mini-exercise" onClick={() => modals.open((close) => <SnackDialog snack={sn} onClose={close} />)} />
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty
          title="No mini-exercises"
          action={
            <Button kind="primary" icon="plus" onClick={add}>
              New mini-exercise
            </Button>
          }
        >
          Add one, for example a 60 second plank.
        </Empty>
      )}
    </>
  );
}

function TagsTab() {
  const d = useData();
  const modals = useModals();
  const counts = new Map<string, number>();
  for (const ex of d.raw.exercises) for (const id of ex.tagIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return (
    <>
      <div className="lib-toolbar">
        <p className="muted lib-intro">Tags group exercises (lower body, glutes, core) so the calendar can show how often you train each one. The colour is what you see on the calendar.</p>
        <Button kind="primary" icon="plus" onClick={() => modals.open((close) => <TagDialog onClose={close} />)}>
          New tag
        </Button>
      </div>
      {d.tagsSorted.length ? (
        <div className="tag-grid">
          {d.tagsSorted.map((tg) => (
            <button type="button" key={tg.id} className="tag-card" style={vars({ '--c': tg.color })} onClick={() => modals.open((close) => <TagDialog tag={tg} onClose={close} />)}>
              <i className="tag-swatch" />
              <span className="tag-name">{tg.name}</span>
              <span className="muted small">{plural(counts.get(tg.id) ?? 0, 'exercise')}</span>
            </button>
          ))}
        </div>
      ) : (
        <Empty title="No tags yet">Create tags here or while editing an exercise.</Empty>
      )}
    </>
  );
}

function TypesTab() {
  const d = useData();
  const modals = useModals();
  const counts = new Map<string, number>();
  for (const ex of d.raw.exercises) counts.set(ex.typeId, (counts.get(ex.typeId) ?? 0) + 1);
  return (
    <>
      <div className="lib-toolbar">
        <p className="muted lib-intro">
          A type decides what gets recorded. Lifts record sets of reps and weight; runs record time, distance and heart rate. Edit these or add your own, such as Ride or Swim.
        </p>
        <Button kind="primary" icon="plus" onClick={() => modals.open((close) => <TypeDialog onClose={close} />)}>
          New type
        </Button>
      </div>
      <div className="lib-rows">
        {d.typesSorted.map((ty) => (
          <button type="button" key={ty.id} className="lib-row" onClick={() => modals.open((close) => <TypeDialog type={ty} onClose={close} />)}>
            <Dot color={ty.color} className="entry-dot" />
            <span className="lib-row-main">
              <span className="lib-row-title">
                {ty.name} <Badge>{ty.mode === 'sets' ? 'per set' : 'single effort'}</Badge>
              </span>
              <span className="lib-row-desc">{ty.fields.map((f) => f.label + (f.unit ? ` (${f.unit})` : f.kind === 'duration' ? ' (time)' : '')).join(' · ')}</span>
            </span>
            <span className="lib-row-side">
              <span className="lib-count">{plural(counts.get(ty.id) ?? 0, 'exercise')}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function BodyPartsTab() {
  const d = useData();
  const t = useToday();
  const modals = useModals();
  const [name, setName] = useState('');
  const active = d.bodyPartsSorted.filter((b) => b.active);
  const inactive = d.bodyPartsSorted.filter((b) => !b.active);

  async function add() {
    const n = name.trim();
    if (!n) return;
    const order = Math.max(0, ...d.raw.bodyParts.map((b) => b.order)) + 1;
    if (await save([put('bodyParts', { id: uid('bp'), name: n, active: true, notes: '', order, createdAt: Date.now() })])) {
      notify(`Tracking ${n}`);
      setName('');
    }
  }

  const row = (bp: BodyPart) => {
    const last = latestPain(d, bp.id);
    const n = ratingsCount(d, bp.id);
    return (
      <div key={bp.id} className={clsx('lib-row', 'static', !bp.active && 'archived')}>
        {last ? (
          <span className="pain-dot" style={vars({ '--c': painColor(last.score) })} title="Latest rating">
            {last.score}
          </span>
        ) : (
          <span className="pain-dot empty">–</span>
        )}
        <span className="lib-row-main">
          <span className="lib-row-title">{bp.name}</span>
          {bp.notes && <span className="lib-row-desc">{bp.notes}</span>}
          <span className="muted small">{n && last ? `${plural(n, 'rating')} · last ${relDay(last.date, t)}` : 'No ratings yet'}</span>
        </span>
        <span className="lib-row-side row gap-sm">
          <Switch
            id={`bp-act-${bp.id}`}
            checked={bp.active}
            onChange={async (on) => {
              if (await save([put('bodyParts', { ...bp, active: on })])) notify(on ? `Tracking ${bp.name} again` : `${bp.name} marked inactive. Its history is kept.`);
            }}
            label={bp.active ? 'Tracking' : 'Inactive'}
          />
          <IconButton icon="edit" label={`Edit ${bp.name}`} onClick={() => modals.open((close) => <BodyPartDialog bodyPart={bp} onClose={close} />)} />
        </span>
      </div>
    );
  };

  return (
    <>
      <p className="muted lib-intro">
        Body parts you want to rate at each check-in, such as a niggling knee. When it heals, mark it inactive: it stops asking for a rating and keeps its history.
      </p>
      <form
        className="row gap-sm grow-first bp-add"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input className="input" id="bp-add" aria-label="Body part name" placeholder="e.g. Left peroneal tendon" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        <Button kind="primary" icon="plus" type="submit" disabled={!name.trim()}>
          Start tracking
        </Button>
      </form>
      <SectionHead title="Tracking">
        <span className="muted small">{active.length}</span>
      </SectionHead>
      {active.length ? <div className="lib-rows">{active.map(row)}</div> : <p className="muted">Nothing is being tracked. Check-ins will only ask for overall feeling and notes.</p>}
      {inactive.length > 0 && (
        <>
          <SectionHead title="Inactive">
            <span className="muted small">{inactive.length}</span>
          </SectionHead>
          <div className="lib-rows">{inactive.map(row)}</div>
        </>
      )}
    </>
  );
}
