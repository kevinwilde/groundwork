import clsx from 'clsx';
import { format } from 'date-fns';
import { Icon } from '../../components/Icon';
import { EntryRow } from '../../components/EntryRow';
import { Button, Empty, vars } from '../../components/ui';
import { useData } from '../../data/DataProvider';
import { useToday } from '../../data/hooks';
import type { CalendarConfig } from '../../db/types';
import { feelingOn, heatLevel, painOn, type Collected } from '../../lib/calendar';
import { bands, feelingColor, painColor, tint } from '../../lib/colors';
import { addDays, dayOfMonth, dayOfWeek, daysInMonth, fmtDate, fmtLong, parseDate, weekStartOf, weekdayLabels, type DateStr } from '../../lib/dates';
import { plural } from '../../lib/format';

export const MONTH_HEAT = [0, 14, 28, 44, 60];
export const YEAR_HEAT = [0, 28, 50, 74, 100];

interface GridProps {
  data: Collected;
  config: CalendarConfig;
  onDay: (date: DateStr) => void;
}

export function MonthGrid({ data, config, from, to, onDay }: GridProps & { from: DateStr; to: DateStr }) {
  const d = useData();
  const t = useToday();
  const start = weekStartOf(from, d.weekStart);
  const end = addDays(weekStartOf(to, d.weekStart), 6);
  const cells: DateStr[] = [];
  for (let x = start; x <= end; x = addDays(x, 1)) cells.push(x);
  const heat = config.colorBy === 'heat';

  return (
    <div className={clsx('cal-month', heat && 'heat')}>
      {weekdayLabels(d.weekStart).map((l) => (
        <div className="cal-dow" key={l}>
          {l}
        </div>
      ))}
      {cells.map((date) => {
        const inMonth = date >= from && date <= to;
        const day = data.days.get(date);
        const colors = day?.groups.map((g) => g.color) ?? [];
        const fill = day ? (heat ? tint('var(--accent)', MONTH_HEAT[heatLevel(day.metric, data.max)]) : bands(colors, 22)) : undefined;
        const bar = day && !heat ? bands(colors, 100) : undefined;
        const pain = painOn(d, date, config.painPartId);
        const feel = config.checkins ? feelingOn(d, date) : null;
        const items = day?.entries ?? [];
        const shown = items.slice(0, 3);
        return (
          <button
            type="button"
            key={date}
            className={clsx('cal-day', !inMonth && 'out', date === t && 'today', day && 'has', date > t && 'future')}
            style={vars({ '--fill': fill ?? 'transparent', '--bar': bar ?? 'transparent' })}
            onClick={() => onDay(date)}
            aria-label={`${fmtLong(date)}: ${items.length ? plural(items.length, 'entry', 'entries') : 'nothing logged'}`}
          >
            <span className="cal-top">
              <span className="cal-num">{dayOfMonth(date)}</span>
              <span className="cal-marks">
                {feel && (
                  <span className="cal-feel" style={vars({ '--c': feel.avg ? feelingColor(feel.avg) : 'var(--ink-3)' })} title={plural(feel.n, 'check-in')}>
                    <Icon name="heart" size={12} />
                  </span>
                )}
                {pain != null && (
                  <span className="cal-pain" style={vars({ '--c': painColor(pain) })} title={`Pain ${pain}/10`}>
                    {pain}
                  </span>
                )}
              </span>
            </span>
            <span className="cal-items">
              {shown.map((e) => (
                <span className="cal-item" key={e.id} style={vars({ '--c': data.colorOf(e) })}>
                  <i />
                  <span className="cal-item-name">{d.exercises.get(e.exerciseId)?.name ?? '?'}</span>
                </span>
              ))}
              {items.length > shown.length && <span className="cal-more">+{items.length - shown.length} more</span>}
            </span>
            {items.length > 0 && <span className="cal-count">{items.length}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function YearGrid({ data, config, year, onDay }: GridProps & { year: number }) {
  const d = useData();
  const t = useToday();
  const heat = config.colorBy === 'heat';
  const narrow = weekdayLabels(d.weekStart, 'EEEEE');
  return (
    <div className="cal-year">
      {Array.from({ length: 12 }, (_, m) => {
        const first = `${year}-${String(m + 1).padStart(2, '0')}-01`;
        const n = daysInMonth(first);
        const lead = (dayOfWeek(first) - d.weekStart + 7) % 7;
        let active = 0;
        const cells = Array.from({ length: n }, (_, i) => {
          const date = addDays(first, i);
          const day = data.days.get(date);
          if (day) active++;
          const bg = day ? (heat ? tint('var(--accent)', YEAR_HEAT[heatLevel(day.metric, data.max)]) : bands(day.groups.map((g) => g.color), 100)) : undefined;
          const pain = painOn(d, date, config.painPartId);
          const names = day ? [...new Set(day.entries.map((e) => d.exercises.get(e.exerciseId)?.name))].join(', ') : 'nothing';
          return (
            <button
              type="button"
              key={date}
              className={clsx('yr-day', day && 'has', date === t && 'today', date > t && 'future')}
              style={vars({ '--fill': bg ?? 'var(--surface-3)', '--pain': pain != null ? painColor(pain) : undefined })}
              data-pain={pain != null ? '' : undefined}
              title={`${fmtDate(date)}: ${names}${pain != null ? ` · pain ${pain}` : ''}`}
              aria-label={`${fmtLong(date)}: ${names}`}
              onClick={() => onDay(date)}
            />
          );
        });
        return (
          <div className="yr-month" key={m}>
            <div className="yr-head">
              <span className="yr-name">{format(parseDate(first), 'MMM')}</span>
              <span className="yr-active">{active ? `${active} d` : ''}</span>
            </div>
            <div className="yr-dows" aria-hidden="true">
              {narrow.map((l, i) => (
                <span key={i}>{l}</span>
              ))}
            </div>
            <div className="yr-grid">
              {Array.from({ length: lead }, (_, i) => (
                <span className="yr-pad" key={`p${i}`} />
              ))}
              {cells}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ListView({ data, limit, onMore, onDay }: { data: Collected; limit: number; onMore: () => void; onDay: (d: DateStr) => void }) {
  const dates = [...data.days.keys()].sort().reverse();
  if (!dates.length) return <Empty title="Nothing matches">Change the filters above, or log something.</Empty>;
  const shown = dates.slice(0, limit);
  return (
    <div className="cal-list">
      {shown.map((date) => (
        <div className="cal-list-day" key={date}>
          <button type="button" className="cal-list-date" onClick={() => onDay(date)}>
            <span className="cal-list-dnum">{dayOfMonth(date)}</span>
            <span className="cal-list-dmeta">{fmtDate(date)}</span>
          </button>
          <div className="entry-list">
            {data.days.get(date)!.entries.map((e) => (
              <EntryRow key={e.id} entry={e} color={data.colorOf(e)} showTags />
            ))}
          </div>
        </div>
      ))}
      {dates.length > shown.length && (
        <div className="center">
          <Button kind="ghost" onClick={onMore}>
            Show more ({dates.length - shown.length} more days)
          </Button>
        </div>
      )}
    </div>
  );
}
