import clsx from 'clsx';
import { useId, useState } from 'react';
import { TrendLine } from '../components/charts';
import { CheckinCard, CheckinDialog, CheckinForm } from '../components/Checkin';
import { useModals } from '../components/Modal';
import { SampleBanner } from '../components/SampleBanner';
import { Badge, Button, PageHead, SectionHead, Segmented, Switch, vars } from '../components/ui';
import { useData } from '../data/DataProvider';
import { useToday } from '../data/hooks';
import type { Data } from '../data/snapshot';
import type { BodyPart } from '../db/types';
import { painColor } from '../lib/colors';
import { addDays, daysBetween, fmtDate, fmtShort, relDay, type DateStr } from '../lib/dates';
import { fmtNum, plural } from '../lib/format';
import { checkinsOn } from '../lib/model';

export function CheckinPage() {
  const d = useData();
  const t = useToday();
  const formId = useId();
  // Changing the key resets the form after each save.
  const [formKey, setFormKey] = useState(0);
  const todays = checkinsOn(d, t).length;
  return (
    <>
      <PageHead title="Check-in" eyebrow="How your body feels" />
      <SampleBanner />
      <div className="checkin-grid">
        <section className="card">
          <SectionHead title="How are you feeling?">{todays > 0 && <span className="muted small">{plural(todays, 'check-in')} today</span>}</SectionHead>
          <CheckinForm key={formKey} formId={formId} onSaved={() => setFormKey((k) => k + 1)} />
          <div className="form-actions">
            <Button kind="primary" type="submit" form={formId}>
              Save check-in
            </Button>
          </div>
        </section>
        <div className="stack">
          <PainTrends />
          <History />
        </div>
      </div>
    </>
  );
}

function dailyMax(d: Data, bodyPartId: string, from: DateStr, to: DateStr): Map<DateStr, number> {
  const out = new Map<DateStr, number>();
  for (const c of d.raw.checkins) {
    if (c.date < from || c.date > to) continue;
    for (const p of c.pains) if (p.bodyPartId === bodyPartId) out.set(c.date, Math.max(out.get(c.date) ?? -1, p.score));
  }
  return out;
}

function avg(series: Map<DateStr, number>, from: DateStr, to: DateStr): number | null {
  const vals = [...series].filter(([date]) => date >= from && date <= to).map(([, v]) => v);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function PainTrends() {
  const d = useData();
  const [days, setDays] = useState(60);
  const [showInactive, setShowInactive] = useState(false);
  const inactiveCount = d.bodyPartsSorted.filter((b) => !b.active).length;
  const list = d.bodyPartsSorted.filter((b) => b.active || showInactive);
  return (
    <section className="card">
      <SectionHead title="Pain trends">
        <div className="row gap-sm wrap">
          <Segmented
            label="Range"
            options={[30, 60, 90, 365].map((n) => ({ value: n, label: n === 365 ? '1 yr' : `${n} d` }))}
            value={days}
            onChange={(v) => setDays(v ?? 60)}
          />
          {inactiveCount > 0 && <Switch id="trend-inactive" checked={showInactive} onChange={setShowInactive} label={`Inactive (${inactiveCount})`} />}
        </div>
      </SectionHead>
      {list.length ? (
        <div className="trend-grid">
          {list.map((bp) => (
            <Trend key={bp.id} bp={bp} days={days} />
          ))}
        </div>
      ) : (
        <p className="muted">{d.bodyPartsSorted.length ? 'All body parts are inactive. Turn on "Inactive" to see their history.' : 'Add a body part to track under Library → Body parts.'}</p>
      )}
    </section>
  );
}

function Trend({ bp, days }: { bp: BodyPart; days: number }) {
  const d = useData();
  const t = useToday();
  const from = addDays(t, -(days - 1));
  const series = dailyMax(d, bp.id, from, t);
  const points = [...series].map(([date, v]) => ({ x: daysBetween(from, date), y: v, color: painColor(v), title: `${fmtDate(date)}: ${v}/10` })).sort((a, b) => a.x - b.x);
  const lastDate = [...series.keys()].sort().pop();
  const latest = lastDate ? series.get(lastDate)! : null;
  const recent = avg(series, addDays(t, -6), t);
  const before = avg(series, addDays(t, -13), addDays(t, -7));
  let trend: { txt: string; cls: string } | null = null;
  if (recent != null && before != null) {
    const delta = recent - before;
    trend = Math.abs(delta) < 0.3 ? { txt: 'steady', cls: 'flat' } : delta < 0 ? { txt: `down ${fmtNum(-delta, 1)}`, cls: 'good' } : { txt: `up ${fmtNum(delta, 1)}`, cls: 'bad' };
  }
  return (
    <div className={clsx('trend', !bp.active && 'inactive')}>
      <div className="trend-head">
        <div>
          <div className="trend-name">
            {bp.name} {!bp.active && <Badge>inactive</Badge>}
          </div>
          <div className="muted small">
            {points.length ? `${plural(points.length, 'day')} rated · 7-day avg ${recent != null ? fmtNum(recent, 1) : '–'}` : 'No ratings in this range'}
            {lastDate && ` · last ${relDay(lastDate, t)}`}
          </div>
        </div>
        <div className="trend-now">
          {latest != null && (
            <span className="trend-score" style={vars({ '--c': painColor(latest) })}>
              {latest}
            </span>
          )}
          {trend && (
            <span className={clsx('trend-delta', trend.cls)}>
              {trend.txt}
              <small> vs prior week</small>
            </span>
          )}
        </div>
      </div>
      {points.length > 0 && <TrendLine points={points} n={days} yMax={10} xLabels={[fmtShort(from), 'Today']} unit="/10" />}
    </div>
  );
}

function History() {
  const d = useData();
  const t = useToday();
  const modals = useModals();
  const [limit, setLimit] = useState(14);
  const dates = [...d.checkinsByDate.keys()].sort().reverse();
  const shown = dates.slice(0, limit);
  return (
    <section className="card">
      <SectionHead title="History">
        <span className="muted small">{plural(d.raw.checkins.length, 'check-in')}</span>
      </SectionHead>
      {dates.length ? (
        <div className="history">
          {shown.map((date) => (
            <div className="history-day" key={date}>
              <div className="history-date">
                <b>{fmtDate(date)}</b>
                <span className="muted">{relDay(date, t)}</span>
              </div>
              <div className="stack-sm">
                {[...checkinsOn(d, date)].reverse().map((c) => (
                  <CheckinCard key={c.id} checkin={c} onEdit={() => modals.open((close) => <CheckinDialog checkin={c} onClose={close} />)} />
                ))}
              </div>
            </div>
          ))}
          {dates.length > shown.length && (
            <div className="center">
              <Button kind="ghost" onClick={() => setLimit((n) => n + 30)}>
                Show older ({dates.length - shown.length} more days)
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="muted">No check-ins yet.</p>
      )}
    </section>
  );
}
