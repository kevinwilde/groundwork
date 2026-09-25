import clsx from 'clsx';
import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../data/DataProvider';
import { del, put } from '../data/ops';
import type { Checkin } from '../db/types';
import { feelingColor, painColor } from '../lib/colors';
import { fmtShort, fmtTime, nowTime, relDay, today, type DateStr } from '../lib/dates';
import { uid } from '../lib/ids';
import { FEELINGS, latestPain, MOMENTS } from '../lib/model';
import { Modal } from './Modal';
import { notify, save, saveWithUndo } from './toast';
import { Badge, Button, Field, FormError, IconButton, Segmented, vars } from './ui';

function defaultMoment(hhmm: string): string {
  const hr = Number(hhmm.split(':')[0]);
  if (hr < 11) return 'Morning';
  if (hr >= 18) return 'Evening';
  return '';
}

export function PainScale({ id, value, onChange }: { id: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="pain-scale" role="radiogroup" aria-labelledby={id}>
      {Array.from({ length: 11 }, (_, n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} out of 10`}
          className={clsx('pain-btn', value === n && 'on')}
          style={vars({ '--c': painColor(n) })}
          onClick={() => onChange(value === n ? null : n)}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

interface FormProps {
  formId: string;
  checkin?: Checkin;
  date?: DateStr;
  onSaved?: () => void;
  /** Called before leaving to manage body parts (closes a surrounding dialog). */
  onLeave?: () => void;
}

export function CheckinForm({ formId, checkin: c, date, onSaved, onLeave }: FormProps) {
  const d = useData();
  const navigate = useNavigate();
  const time0 = c?.time ?? nowTime();
  const [s, setS] = useState(() => ({
    date: c?.date ?? date ?? today(),
    time: time0,
    moment: c?.moment ?? defaultMoment(time0),
    overall: c?.overall ?? null,
    notes: c?.notes ?? '',
    pains: new Map((c?.pains ?? []).map((p) => [p.bodyPartId, p.score] as const)),
  }));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof s>) => setS((x) => ({ ...x, ...patch }));

  // Active body parts, plus any inactive one that already has a score in this check-in.
  const parts = d.bodyPartsSorted.filter((b) => b.active || s.pains.has(b.id));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const rec: Checkin = {
      id: c?.id ?? uid('ci'),
      date: s.date,
      time: s.time,
      moment: s.moment,
      overall: s.overall,
      notes: s.notes.trim(),
      pains: [...s.pains].map(([bodyPartId, score]) => ({ bodyPartId, score })),
      createdAt: c?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      ...(c?.sample ? { sample: true } : {}),
    };
    if (!rec.notes && rec.overall == null && !rec.pains.length) return setError('Add a rating, a pain score or a note before saving.');
    setError(null);
    if (await save([put('checkins', rec)])) {
      notify(c ? 'Check-in updated' : 'Checked in');
      onSaved?.();
    }
  }

  return (
    <form id={formId} className="checkin-form" onSubmit={submit} noValidate>
      <div className="ci-when">
        <Field label="Date" className="date-field">
          <input type="date" className="input" id={`${formId}-date`} value={s.date} onChange={(e) => set({ date: e.target.value || today() })} />
        </Field>
        <Field label="Time" className="time-field">
          <input type="time" className="input" id={`${formId}-time`} value={s.time} onChange={(e) => set({ time: e.target.value || nowTime() })} />
        </Field>
      </div>
      <Field label="Moment" optional group>
        <Segmented className="wrap-seg" toggle options={MOMENTS.map((m) => ({ value: m as string, label: m }))} value={s.moment || null} onChange={(v) => set({ moment: v ?? '' })} />
      </Field>
      <Field label="Overall" optional group>
        <Segmented
          className="wrap-seg feel-seg"
          toggle
          options={FEELINGS.map((f) => ({ value: f.v as number, label: `${f.v} ${f.label}`, color: feelingColor(f.v) }))}
          value={s.overall}
          onChange={(v) => set({ overall: v })}
        />
      </Field>
      <div className="field" role="group" aria-label="Pain">
        <div className="row space-between">
          <span className="field-label">
            Pain <span className="field-opt">0 = none, 10 = worst. Tap again to clear.</span>
          </span>
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              onLeave?.();
              navigate('/library/bodyparts');
            }}
          >
            Body parts
          </Button>
        </div>
        {parts.length ? (
          <div className="pain-rows">
            {parts.map((bp) => {
              const prev = latestPain(d, bp.id, { date: s.date, time: s.time, excludeId: c?.id });
              const labelId = `${formId}-${bp.id}`;
              return (
                <div className="pain-row" key={bp.id}>
                  <div className="pain-row-head">
                    <span className="pain-name" id={labelId}>
                      {bp.name} {!bp.active && <Badge>inactive</Badge>}
                    </span>
                    <span className="pain-prev">
                      {prev ? (
                        <>
                          Last <b style={{ color: painColor(prev.score) }}>{prev.score}</b> · {relDay(prev.date)}
                        </>
                      ) : (
                        'First rating'
                      )}
                    </span>
                  </div>
                  <PainScale
                    id={labelId}
                    value={s.pains.get(bp.id) ?? null}
                    onChange={(v) =>
                      setS((x) => {
                        const pains = new Map(x.pains);
                        if (v == null) pains.delete(bp.id);
                        else pains.set(bp.id, v);
                        return { ...x, pains };
                      })
                    }
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">You are not tracking any body parts. Add one (for example "Right knee") to rate it at each check-in.</p>
        )}
      </div>
      <Field label="Notes" optional>
        <textarea className="input" id={`${formId}-notes`} rows={3} placeholder="Sleep, energy, soreness, mood, anything else." value={s.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
      <FormError>{error}</FormError>
    </form>
  );
}

export function CheckinDialog({ checkin, date, onClose }: { checkin?: Checkin; date?: DateStr; onClose: () => void }) {
  const formId = useId();
  return (
    <Modal
      title={checkin ? 'Edit check-in' : 'Check in'}
      onClose={onClose}
      footer={
        <>
          {checkin && (
            <Button
              kind="danger-text"
              icon="trash"
              onClick={() => {
                onClose();
                void saveWithUndo([del('checkins', checkin.id)], 'Check-in deleted');
              }}
            >
              Delete
            </Button>
          )}
          <span className="spacer" />
          <Button kind="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" form={formId}>
            {checkin ? 'Save changes' : 'Save check-in'}
          </Button>
        </>
      }
    >
      <CheckinForm formId={formId} checkin={checkin} date={date} onSaved={onClose} onLeave={onClose} />
    </Modal>
  );
}

export function CheckinCard({ checkin: c, showDate, onEdit }: { checkin: Checkin; showDate?: boolean; onEdit?: () => void }) {
  const d = useData();
  const feeling = FEELINGS.find((f) => f.v === c.overall);
  const pains = c.pains.map((p) => ({ ...p, bp: d.bodyParts.get(p.bodyPartId) })).filter((p) => p.bp);
  return (
    <div className="checkin-card">
      <div className="checkin-head">
        <span className="checkin-time">
          {showDate && `${fmtShort(c.date)} · `}
          {fmtTime(c.time)}
        </span>
        {c.moment && <Badge>{c.moment}</Badge>}
        {c.sample && <Badge kind="sample">sample</Badge>}
        {feeling && (
          <span className="feeling" style={vars({ '--c': feelingColor(c.overall) })}>
            <i />
            {feeling.label}
          </span>
        )}
        <span className="spacer" />
        {onEdit && <IconButton icon="edit" size={16} label="Edit check-in" onClick={onEdit} />}
        {onEdit && <IconButton icon="trash" size={16} label="Delete check-in" onClick={() => saveWithUndo([del('checkins', c.id)], 'Check-in deleted')} />}
      </div>
      {pains.length > 0 && (
        <div className="pain-chips">
          {pains.map((p) => (
            <span key={p.bodyPartId} className={clsx('pain-chip', !p.bp!.active && 'inactive')} style={vars({ '--c': painColor(p.score) })}>
              <b>{p.score}</b>
              {p.bp!.name}
            </span>
          ))}
        </div>
      )}
      {c.notes && <p className="checkin-notes">{c.notes}</p>}
    </div>
  );
}
