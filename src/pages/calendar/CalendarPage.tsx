import { useMemo, useState } from 'react';
import { DayDialog } from '../../components/dialogs/DayDialog';
import { useModals } from '../../components/Modal';
import { SampleBanner } from '../../components/SampleBanner';
import { Button, IconButton, PageHead, Segmented } from '../../components/ui';
import { useData } from '../../data/DataProvider';
import { useLocalStorage, useMediaQuery, useToday } from '../../data/hooks';
import type { CalendarConfig } from '../../db/types';
import { collect, normalizeConfig } from '../../lib/calendar';
import { addMonths, fmtMonth, monthEnd, monthStart, type DateStr } from '../../lib/dates';
import { Filters, Legend, SavedViews } from './Filters';
import { ListView, MonthGrid, YearGrid } from './Grids';
import { Insights, Stats } from './Stats';

export type CalView = 'month' | 'year' | 'list';

interface Stored {
  config?: Partial<CalendarConfig>;
  view?: CalView;
  filtersOpen?: boolean;
}

export function CalendarPage() {
  const d = useData();
  const t = useToday();
  const modals = useModals();
  const wide = useMediaQuery('(min-width: 900px)');
  const [stored, setStored] = useLocalStorage<Stored>('gw.calendar', {});
  const [anchor, setAnchor] = useState<DateStr>(t);
  const [listLimit, setListLimit] = useState(30);

  const config = normalizeConfig(stored.config);
  const cfgKey = JSON.stringify(config);
  const view: CalView = stored.view ?? 'month';
  const filtersOpen = stored.filtersOpen ?? wide;

  const update = (patch: Partial<CalendarConfig>) => setStored((s) => ({ ...s, config: { ...normalizeConfig(s.config), ...patch } }));
  const replace = (c: CalendarConfig) => setStored((s) => ({ ...s, config: c }));

  const range = useMemo(() => {
    if (view === 'year') {
      const y = anchor.slice(0, 4);
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: y };
    }
    if (view === 'list') return { from: '0000-01-01', to: '9999-12-31', label: 'All matching entries' };
    return { from: monthStart(anchor), to: monthEnd(anchor), label: fmtMonth(anchor) };
  }, [view, anchor]);

  // cfgKey stands in for config, which is rebuilt on every render.
  const data = useMemo(() => collect(d, config, range.from, range.to), [d, cfgKey, range.from, range.to]);

  const openDay = (date: DateStr) => modals.open((close) => <DayDialog date={date} match={data.match} colorOf={data.colorOf} onClose={close} />);
  const shift = (n: number) => setAnchor((a) => (view === 'year' ? `${Number(a.slice(0, 4)) + n}-01-01` : addMonths(a, n)));

  return (
    <>
      <PageHead title="Calendar" eyebrow="See how often" />
      <SampleBanner />
      <SavedViews config={config} onApply={replace} />
      <Filters config={config} update={update} open={filtersOpen} onOpenChange={(open) => setStored((s) => ({ ...s, filtersOpen: open }))} />
      <section className="card cal-card">
        <div className="cal-toolbar">
          <Segmented
            label="Calendar view"
            options={[
              { value: 'month', label: 'Month' },
              { value: 'year', label: 'Year' },
              { value: 'list', label: 'List' },
            ]}
            value={view}
            onChange={(v) => v && setStored((s) => ({ ...s, view: v as CalView }))}
          />
          <div className="cal-nav">
            {view !== 'list' && <IconButton icon="left" label={view === 'year' ? 'Previous year' : 'Previous month'} onClick={() => shift(-1)} />}
            <h2 className="cal-range">{range.label}</h2>
            {view !== 'list' && <IconButton icon="right" label={view === 'year' ? 'Next year' : 'Next month'} onClick={() => shift(1)} />}
            {view !== 'list' && (
              <Button size="sm" kind="ghost" onClick={() => setAnchor(t)}>
                Today
              </Button>
            )}
          </div>
        </div>
        <Legend data={data} config={config} view={view} update={update} />
        {view === 'month' && <MonthGrid data={data} config={config} from={range.from} to={range.to} onDay={openDay} />}
        {view === 'year' && <YearGrid data={data} config={config} year={Number(anchor.slice(0, 4))} onDay={openDay} />}
        {view === 'list' && <ListView data={data} limit={listLimit} onMore={() => setListLimit((n) => n + 30)} onDay={openDay} />}
      </section>
      <Stats data={data} config={config} view={view} from={range.from} to={range.to} />
      <Insights data={data} config={config} />
    </>
  );
}
