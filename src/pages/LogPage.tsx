import clsx from 'clsx';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DayDialog } from '../components/dialogs/DayDialog';
import { ExerciseDialog } from '../components/dialogs/ExerciseDialog';
import { SessionDialog } from '../components/dialogs/SessionDialog';
import { EntryEditor, type EntryEditorResult } from '../components/EntryEditor';
import { EntryRow, ExerciseHeader } from '../components/EntryRow';
import { useModals } from '../components/Modal';
import { SessionLogger } from '../components/SessionLogger';
import { notify, save } from '../components/toast';
import { Button, Dot, Field, PageHead, SectionHead, Segmented } from '../components/ui';
import { useData } from '../data/DataProvider';
import { useToday } from '../data/hooks';
import { put } from '../data/ops';
import type { Data } from '../data/snapshot';
import type { Entry, Exercise } from '../db/types';
import { addDays, fmtDate, isDateStr, relDay, type DateStr } from '../lib/dates';
import { uid } from '../lib/ids';
import { plural } from '../lib/format';
import { entriesFor, entriesOn, exerciseColor, summarize, tagsOf, typeOf } from '../lib/model';
import { describeSession, itemsFromDay, sessionExercises, sessionStats } from '../lib/sessions';

/** Remember a non-today date while moving between pages. */
let rememberedDate: DateStr | null = null;

function recentExercises(d: Data, limit: number): Exercise[] {
  const out: Exercise[] = [];
  const seen = new Set<string>();
  const entries = d.raw.entries.filter((e) => e.source !== 'snack').sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
  for (const e of entries) {
    if (seen.has(e.exerciseId)) continue;
    seen.add(e.exerciseId);
    const ex = d.exercises.get(e.exerciseId);
    if (ex && !ex.archived) out.push(ex);
    if (out.length >= limit) break;
  }
  return out;
}

export function LogPage() {
  const d = useData();
  const t = useToday();
  const modals = useModals();
  const id = useId();
  const [params, setParams] = useSearchParams();
  const paramDate = params.get('date');
  const [date, setDateState] = useState<DateStr>(() => (isDateStr(paramDate) ? paramDate : rememberedDate ?? t));
  const paramSession = params.get('session');
  const paramExercise = params.get('exercise');
  const [selected, setSelected] = useState<string | null>(paramSession ? null : paramExercise);
  const [selectedSession, setSelectedSession] = useState<string | null>(paramSession);
  const [search, setSearch] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);

  // Links from other pages (?date=, ?session=, ?exercise=) are applied, then cleared from the URL.
  useEffect(() => {
    if (!paramDate && !paramSession && !paramExercise) return;
    if (isDateStr(paramDate)) {
      setDateState(paramDate);
      rememberedDate = paramDate === t ? null : paramDate;
    }
    if (paramSession) {
      setSelectedSession(paramSession);
      setSelected(null);
      scrollToEditor();
    } else if (paramExercise) {
      setSelected(paramExercise);
      setSelectedSession(null);
      scrollToEditor();
    }
    setParams({}, { replace: true });
  }, [paramDate, paramSession, paramExercise, t, setParams]);

  const setDate = (v: DateStr) => {
    setDateState(v);
    rememberedDate = v === t ? null : v;
  };

  const ex = selected ? d.exercises.get(selected) : undefined;
  const session = selectedSession ? d.sessions.get(selectedSession) : undefined;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return d.exercisesSorted;
    return d.exercisesSorted.filter(
      (e) => e.name.toLowerCase().includes(q) || tagsOf(d, e).some((tg) => tg.name.includes(q)) || typeOf(d, e).name.toLowerCase().includes(q),
    );
  }, [d, search]);

  const groups = useMemo(() => {
    const m = new Map<string, { typeName: string; order: number; items: Exercise[] }>();
    for (const e of filtered) {
      const ty = typeOf(d, e);
      if (!m.has(ty.id)) m.set(ty.id, { typeName: ty.name, order: ty.order, items: [] });
      m.get(ty.id)!.items.push(e);
    }
    return [...m.values()].sort((a, b) => a.order - b.order);
  }, [d, filtered]);

  const recent = search ? [] : recentExercises(d, 6);

  const sessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return d.sessionsSorted;
    return d.sessionsSorted.filter((s) => s.name.toLowerCase().includes(q) || sessionExercises(d, s).some((x) => x.ex.name.toLowerCase().includes(q)));
  }, [d, search]);

  function scrollToEditor(focus = true) {
    requestAnimationFrame(() => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      editorRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      if (focus) editorRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    });
  }

  function pick(exId: string) {
    setSelected(exId);
    setSelectedSession(null);
    scrollToEditor();
  }

  function pickSession(sessionId: string) {
    setSelectedSession(sessionId);
    setSelected(null);
    scrollToEditor(false);
  }

  const newSession = (items?: ReturnType<typeof itemsFromDay>) =>
    modals.open((close) => <SessionDialog items={items} onClose={close} onSaved={(s) => (items ? undefined : pickSession(s.id))} />);

  async function submit({ perf, notes }: EntryEditorResult) {
    if (!ex) return;
    const entry: Entry = { id: uid('en'), exerciseId: ex.id, date, notes, source: 'log', createdAt: Date.now(), ...perf };
    if (await save([put('entries', entry)])) {
      notify(`Logged ${ex.name} · ${summarize(typeOf(d, ex), entry)}`);
      setSelected(null);
      setSearch('');
    }
  }

  const exButton = (e: Exercise) => {
    const last = entriesFor(d, e.id)[0];
    return (
      <button type="button" key={e.id} className={clsx('ex-btn', selected === e.id && 'on')} onClick={() => pick(e.id)}>
        <Dot color={exerciseColor(d, e)} className="entry-dot" />
        <span className="ex-btn-name">{e.name}</span>
        <span className="ex-btn-last">{last ? relDay(last.date, t) : ''}</span>
      </button>
    );
  };

  const dayEntries = entriesOn(d, date);
  const dayItems = itemsFromDay(d, date);
  const yesterday = addDays(t, -1);

  return (
    <>
      <PageHead title="Log" eyebrow="Record an exercise or a session" />
      <section className="card log-top">
        <div className="log-date-row">
          <Field label="Date" className="date-field">
            <input type="date" className="input" id={`${id}-date`} value={date} onChange={(e) => setDate(e.target.value || t)} />
          </Field>
          <Segmented
            options={[
              { value: t, label: 'Today' },
              { value: yesterday, label: 'Yesterday' },
            ]}
            value={date === t || date === yesterday ? date : null}
            onChange={(v) => v && setDate(v)}
          />
        </div>
        <div className="picker">
          <div className="row gap-sm grow-first">
            <input
              className="input"
              id={`${id}-search`}
              type="search"
              placeholder="Search exercises or tags"
              autoComplete="off"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filtered[0]) {
                  e.preventDefault();
                  pick(filtered[0].id);
                }
              }}
            />
            <Button icon="plus" onClick={() => modals.open((close) => <ExerciseDialog name={search.trim()} onClose={close} onSaved={(created) => { setSearch(''); pick(created.id); }} />)}>
              New exercise
            </Button>
          </div>
          {(sessions.length > 0 || !search) && (
            <div className="picker-group">
              <div className="picker-label-row">
                <span className="picker-label">Sessions</span>
                <Button size="sm" kind="ghost" icon="plus" onClick={() => newSession()}>
                  New session
                </Button>
              </div>
              {sessions.length ? (
                <div className="session-grid">
                  {sessions.map((s) => {
                    const stats = sessionStats(d, s.id);
                    const n = sessionExercises(d, s).length;
                    return (
                      <button type="button" key={s.id} className={clsx('session-btn', selectedSession === s.id && 'on')} onClick={() => pickSession(s.id)}>
                        <span className="session-btn-name">{s.name}</span>
                        <span className="session-btn-list">{describeSession(d, s)}</span>
                        <span className="session-btn-meta">
                          {plural(n, 'exercise')} · {stats.last ? `last ${relDay(stats.last, t)}` : 'not logged yet'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="muted small">Save a group of exercises you do together, like "Upper A", to log them all at once.</p>
              )}
            </div>
          )}
          {recent.length > 0 && (
            <div className="picker-group">
              <div className="picker-label">Recent</div>
              <div className="ex-grid">{recent.map(exButton)}</div>
            </div>
          )}
          {groups.length ? (
            groups.map((g) => (
              <div className="picker-group" key={g.typeName}>
                <div className="picker-label">{g.typeName}</div>
                <div className="ex-grid">{g.items.map(exButton)}</div>
              </div>
            ))
          ) : (
            <p className="muted">{search ? `No exercise matches "${search}". Use New exercise to add it.` : 'Your library is empty. Add an exercise to start logging.'}</p>
          )}
        </div>
      </section>

      <div ref={editorRef} className="log-editor">
        {ex && (
          <section className="card editor-card">
            <div className="row space-between wrap gap-sm">
              <ExerciseHeader exercise={ex} />
              <Button size="sm" kind="ghost" icon="edit" onClick={() => modals.open((close) => <ExerciseDialog exercise={ex} onClose={close} />)}>
                Edit exercise
              </Button>
            </div>
            <EntryEditor key={`${ex.id}-${ex.typeId}`} formId={`${id}-entry`} exercise={ex} date={date} onSubmit={submit} />
            <div className="form-actions">
              <Button kind="ghost" onClick={() => setSelected(null)}>
                Cancel
              </Button>
              <Button kind="primary" type="submit" form={`${id}-entry`}>
                Log {ex.name}
              </Button>
            </div>
          </section>
        )}
        {session && (
          <SessionLogger
            key={session.id}
            session={session}
            date={date}
            onDone={() => {
              setSelectedSession(null);
              setSearch('');
            }}
            onCancel={() => setSelectedSession(null)}
          />
        )}
      </div>

      <section className="card">
        <SectionHead title={date === t ? 'Logged today' : `Logged on ${fmtDate(date)}`}>
          {dayItems.length > 0 && (
            <Button size="sm" kind="ghost" icon="plus" title="Save these exercises as a session you can log again" onClick={() => newSession(dayItems)}>
              Save as session
            </Button>
          )}
          <Button size="sm" kind="ghost" onClick={() => modals.open((close) => <DayDialog date={date} onClose={close} />)}>
            Day details
          </Button>
        </SectionHead>
        {dayEntries.length ? (
          <div className="entry-list">
            {dayEntries.map((e) => (
              <EntryRow key={e.id} entry={e} showTags />
            ))}
          </div>
        ) : (
          <p className="muted">Nothing yet. Pick an exercise above.</p>
        )}
      </section>
    </>
  );
}
