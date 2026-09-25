import clsx from 'clsx';
import { format } from 'date-fns';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckinCard, CheckinDialog } from '../components/Checkin';
import { DayDialog } from '../components/dialogs/DayDialog';
import { EntryDialog } from '../components/dialogs/EntryDialog';
import { SnackDialog } from '../components/dialogs/SnackDialog';
import { EntryRow } from '../components/EntryRow';
import { Icon } from '../components/Icon';
import { useModals } from '../components/Modal';
import { SampleBanner } from '../components/SampleBanner';
import { save } from '../components/toast';
import { Button, Chip, Dot, PageHead, SectionHead, TagChips, vars } from '../components/ui';
import { useData } from '../data/DataProvider';
import { useToday } from '../data/hooks';
import { put } from '../data/ops';
import type { Entry, Exercise, Snack } from '../db/types';
import { painColor } from '../lib/colors';
import { addDays, dayOfMonth, fmtLong, parseDate, relDay, toDateStr, weekStartOf, type DateStr } from '../lib/dates';
import { fmtDuration } from '../lib/format';
import { uid } from '../lib/ids';
import { checkinsOn, entriesOn, exerciseColor, latestPain, snackDuration, snackQueue, summarize, tagsOf, typeOf } from '../lib/model';

export function TodayPage() {
  const t = useToday();
  return (
    <>
      <PageHead title="Today" eyebrow={fmtLong(t)} />
      <SampleBanner />
      <SnackCard />
      <div className="today-grid">
        <div className="stack">
          <TodayTraining />
          <SnackList />
        </div>
        <div className="stack">
          <FeelingCard />
          <WeekStrip />
        </div>
      </div>
    </>
  );
}

// ---------- logging a snack ----------
function useLogSnack() {
  const d = useData();
  return async (snack: Snack, ex: Exercise, date: DateStr) => {
    const entry: Entry = { id: uid('en'), exerciseId: ex.id, date, notes: '', source: 'snack', snackId: snack.id, createdAt: Date.now() };
    if (Array.isArray(snack.sets)) entry.sets = snack.sets.map((s) => ({ ...s }));
    else entry.values = { ...(snack.values ?? {}) };
    const inverse = await save([put('entries', entry)]);
    if (inverse) toast(`Logged ${ex.name} · ${summarize(typeOf(d, ex), entry)}`, { action: { label: 'Undo', onClick: () => void save(inverse) } });
  };
}

// ---------- timer chime ----------
let audioCtx: AudioContext | null = null;
function primeAudio() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx && !audioCtx) audioCtx = new Ctx();
    if (audioCtx?.state === 'suspended') void audioCtx.resume();
  } catch {
    /* audio unavailable */
  }
}
function chime() {
  try {
    if (audioCtx) {
      const t0 = audioCtx.currentTime;
      [0, 0.22, 0.44].forEach((t, i) => {
        const o = audioCtx!.createOscillator();
        const g = audioCtx!.createGain();
        o.frequency.value = i === 2 ? 1318.5 : 880;
        o.connect(g);
        g.connect(audioCtx!.destination);
        g.gain.setValueAtTime(0.0001, t0 + t);
        g.gain.exponentialRampToValueAtTime(0.28, t0 + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + t + (i === 2 ? 0.5 : 0.18));
        o.start(t0 + t);
        o.stop(t0 + t + 0.55);
      });
    }
    navigator.vibrate?.([120, 80, 120]);
  } catch {
    /* ignore */
  }
}

const R = 46;
const CIRC = 2 * Math.PI * R;

// ---------- snack card ----------
function SnackCard() {
  const d = useData();
  const t = useToday();
  const modals = useModals();
  const logSnack = useLogSnack();
  const queue = useMemo(() => snackQueue(d, t), [d, t]);
  const [offset, setOffset] = useState(0);
  const [timer, setTimer] = useState<{ snackId: string; total: number; end: number; key: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [thunk, setThunk] = useState(0);
  const chimed = useRef<number | null>(null);

  const item = queue.length ? queue[offset % queue.length] : null;
  const running = !!(timer && item && timer.snackId === item.snack.id);
  const left = running ? Math.max(0, (timer!.end - now) / 1000) : 0;
  const ready = running && left <= 0;

  useEffect(() => {
    if (!timer || ready) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [timer, ready]);

  useEffect(() => {
    if (ready && timer && chimed.current !== timer.key) {
      chimed.current = timer.key;
      chime();
    }
  }, [ready, timer]);

  if (!item) {
    return (
      <section className="snack-card is-empty" aria-label="Movement snack">
        <div className="snack-eyebrow">Movement snack</div>
        <h2 className="snack-name">No mini-exercises yet</h2>
        <p className="snack-instr">Mini-exercises are short things you can do any time, like a 60 second plank. Add one and it shows up here with a button to record it.</p>
        <div className="snack-buttons">
          <Button kind="on-plate" icon="plus" onClick={() => modals.open((close) => <SnackDialog onClose={close} />)}>
            Add a mini-exercise
          </Button>
        </div>
      </section>
    );
  }

  const { snack, ex, stats } = item;
  const rx = summarize(typeOf(d, ex), snack);
  const seconds = snackDuration(snack);
  const countText = snack.perDay ? `${stats.doneToday} of ${snack.perDay} today` : stats.doneToday ? `Done ${stats.doneToday}× today` : 'Not done yet today';
  const frac = running && timer!.total ? left / timer!.total : 1;

  async function done() {
    setTimer(null);
    setOffset(0);
    setThunk((k) => k + 1);
    await logSnack(snack, ex, t);
  }

  return (
    <section className={clsx('snack-card', thunk > 0 && 'thunk')} key={thunk} aria-label="Movement snack">
      <div className="snack-top">
        <span className="snack-eyebrow">Movement snack</span>
        {queue.length > 1 && (
          <span className="snack-count">
            {(offset % queue.length) + 1} of {queue.length}
          </span>
        )}
      </div>
      <div className="snack-main">
        <div className="snack-text">
          <h2 className="snack-name">{ex.name}</h2>
          <div className="snack-rx">{rx}</div>
          {snack.instruction && <p className="snack-instr">{snack.instruction}</p>}
          <div className="snack-meta">
            <span className={clsx('snack-status', stats.need ? 'todo' : 'met')}>
              {!stats.need && <Icon name="check" size={14} />}
              {countText}
            </span>
            {stats.last > 0 && <span className="snack-last">last done {relDay(toDateStr(new Date(stats.last)), t)}</span>}
          </div>
          <TagChips tags={tagsOf(d, ex)} className="on-plate" />
        </div>
        <div className="snack-action">
          <button type="button" className={clsx('plate', running && 'running', ready && 'ready')} aria-label={`Log ${ex.name}, ${rx}`} onClick={done}>
            <svg viewBox="0 0 100 100" className="plate-svg" aria-hidden="true">
              <circle cx="50" cy="50" r={R} className="plate-track" />
              <circle cx="50" cy="50" r={R} className="plate-ring" strokeDasharray={CIRC.toFixed(2)} strokeDashoffset={running ? CIRC * (1 - frac) : CIRC} />
            </svg>
            <span className="plate-face">
              <span className="plate-main">{running && !ready ? fmtDuration(Math.ceil(left)).replace(' s', '') : 'Done'}</span>
              <span className="plate-sub">{ready ? 'Time! Tap to log' : running ? 'tap to log early' : 'tap to log'}</span>
            </span>
          </button>
          <div className="snack-buttons">
            {seconds && !running && (
              <Button
                kind="on-plate"
                size="sm"
                icon="timer"
                onClick={() => {
                  primeAudio();
                  setNow(Date.now());
                  setTimer({ snackId: snack.id, total: seconds, end: Date.now() + seconds * 1000, key: Date.now() });
                }}
              >
                Start {fmtDuration(seconds)} timer
              </Button>
            )}
            {running && !ready && (
              <Button kind="on-plate" size="sm" onClick={() => setTimer(null)}>
                Stop timer
              </Button>
            )}
            {queue.length > 1 && (
              <Button
                kind="on-plate"
                size="sm"
                icon="shuffle"
                onClick={() => {
                  setTimer(null);
                  setOffset((o) => o + 1);
                }}
              >
                Another
              </Button>
            )}
            <Button
              kind="on-plate"
              size="sm"
              icon="edit"
              title="Log a different amount"
              onClick={() => modals.open((close) => <EntryDialog exerciseId={ex.id} date={t} initial={snack} source="snack" snackId={snack.id} onClose={close} />)}
            >
              Adjust
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function SnackList() {
  const d = useData();
  const t = useToday();
  const navigate = useNavigate();
  const logSnack = useLogSnack();
  const queue = snackQueue(d, t);
  return (
    <section className="card">
      <SectionHead title="Mini-exercises">
        <Button size="sm" kind="ghost" onClick={() => navigate('/library/snacks')}>
          Manage
        </Button>
      </SectionHead>
      {queue.length ? (
        <div className="snack-list">
          {queue.map(({ snack, ex, stats }) => (
            <div className="snack-row" key={snack.id}>
              <Dot color={exerciseColor(d, ex)} className="entry-dot" />
              <div className="snack-row-main">
                <div className="entry-name">{ex.name}</div>
                <div className="entry-sum">{summarize(typeOf(d, ex), snack)}</div>
              </div>
              <span className={clsx('snack-tally', !stats.need && 'met')} title="Done today">
                {snack.perDay ? `${stats.doneToday}/${snack.perDay}` : stats.doneToday ? `${stats.doneToday}×` : '–'}
              </span>
              <Button size="sm" icon="check" onClick={() => logSnack(snack, ex, t)}>
                Done
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">None active.</p>
      )}
    </section>
  );
}

function TodayTraining() {
  const d = useData();
  const t = useToday();
  const navigate = useNavigate();
  const entries = entriesOn(d, t);
  return (
    <section className="card">
      <SectionHead title="Today's training">
        <Button size="sm" kind="primary" icon="plus" onClick={() => navigate('/log')}>
          Log exercise
        </Button>
      </SectionHead>
      {entries.length ? (
        <div className="entry-list">
          {entries.map((e) => (
            <EntryRow key={e.id} entry={e} />
          ))}
        </div>
      ) : (
        <p className="muted">Nothing logged yet today.</p>
      )}
    </section>
  );
}

function FeelingCard() {
  const d = useData();
  const t = useToday();
  const navigate = useNavigate();
  const modals = useModals();
  const list = checkinsOn(d, t);
  const latest = list[list.length - 1];
  const parts = d.bodyPartsSorted.filter((b) => b.active);
  return (
    <section className="card">
      <SectionHead title="How you feel">
        <Button size="sm" kind={list.length ? 'ghost' : 'primary'} icon="checkin" onClick={() => navigate('/checkin')}>
          {list.length ? 'Check in again' : 'Check in'}
        </Button>
      </SectionHead>
      {latest ? <CheckinCard checkin={latest} onEdit={() => modals.open((close) => <CheckinDialog checkin={latest} onClose={close} />)} /> : <p className="muted">No check-in yet today.</p>}
      {parts.length > 0 && (
        <div className="bp-status">
          {parts.map((bp) => {
            const last = latestPain(d, bp.id);
            return (
              <div className="bp-status-row" key={bp.id}>
                <span className="bp-status-name">{bp.name}</span>
                {last ? (
                  <span className="pain-chip" style={vars({ '--c': painColor(last.score) })}>
                    <b>{last.score}</b>
                    {relDay(last.date, t)}
                  </span>
                ) : (
                  <span className="muted small">not rated</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function WeekStrip() {
  const d = useData();
  const t = useToday();
  const navigate = useNavigate();
  const modals = useModals();
  const start = weekStartOf(t, d.weekStart);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  let active = 0;
  const seenTypes = new Map<string, { name: string; color: string }>();
  const cols = days.map((day) => {
    const all = entriesOn(d, day);
    const training = all.filter((e) => e.source !== 'snack');
    const snacks = all.length - training.length;
    const checks = checkinsOn(d, day).length;
    if (training.length) active++;
    const types = new Map<string, { name: string; color: string }>();
    for (const e of training) {
      const ty = typeOf(d, d.exercises.get(e.exerciseId));
      types.set(ty.id, ty);
      seenTypes.set(ty.id, ty);
    }
    return (
      <button
        type="button"
        key={day}
        className={clsx('week-day', day === t && 'today', day > t && 'future')}
        aria-label={fmtLong(day)}
        onClick={() => modals.open((close) => <DayDialog date={day} onClose={close} />)}
      >
        <span className="week-dow">{format(parseDate(day), 'EEEEE')}</span>
        <span className="week-num">{dayOfMonth(day)}</span>
        <span className="week-dots">
          {[...types.values()].map((ty) => (
            <i key={ty.name} style={vars({ '--c': ty.color })} title={ty.name} />
          ))}
        </span>
        <span className="week-extra">
          {snacks > 0 && <span title={`${snacks} snacks`}>+{snacks}</span>}
          {checks > 0 && (
            <span className="week-heart" title={`${checks} check-ins`}>
              <Icon name="heart" size={12} />
            </span>
          )}
        </span>
      </button>
    );
  });
  return (
    <section className="card">
      <SectionHead title="This week">
        <Button size="sm" kind="ghost" onClick={() => navigate('/calendar')}>
          Calendar
        </Button>
      </SectionHead>
      <div className="week-strip">{cols}</div>
      <div className="week-foot">
        <span>
          <b>{active}</b> training {active === 1 ? 'day' : 'days'} so far
        </span>
        <span className="chips">
          {[...seenTypes.values()].map((ty) => (
            <Chip key={ty.name} label={ty.name} color={ty.color} small />
          ))}
        </span>
      </div>
    </section>
  );
}
