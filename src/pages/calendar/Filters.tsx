import { useId, useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon';
import { Modal, useModals } from '../../components/Modal';
import { notify, save, saveWithUndo } from '../../components/toast';
import { Button, Chip, Field, IconButton, Segmented, Switch } from '../../components/ui';
import { useData } from '../../data/DataProvider';
import { del, put } from '../../data/ops';
import type { CalendarConfig, CalendarColorBy, CalendarShow, MetricId } from '../../db/types';
import { DEFAULT_CONFIG, describeConfig, sameConfig, UNTAGGED, type Collected, type LegendItem } from '../../lib/calendar';
import { tint } from '../../lib/colors';
import { uid } from '../../lib/ids';
import { exerciseColor, metricDef, METRICS } from '../../lib/model';
import type { CalView } from './CalendarPage';
import { MONTH_HEAT, YEAR_HEAT } from './Grids';

const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

interface FiltersProps {
  config: CalendarConfig;
  update: (patch: Partial<CalendarConfig>) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function Filters({ config: c, update, open, onOpenChange }: FiltersProps) {
  const d = useData();
  const id = useId();
  const { what, how } = describeConfig(d, c);
  return (
    <details className="card filters" open={open} onToggle={(e) => onOpenChange((e.target as HTMLDetailsElement).open)}>
      <summary className="filters-summary">
        <Icon name="filter" size={18} />
        <span className="filters-title">Filters</span>
        <span className="filters-desc">
          {what} · {how}
          {!c.snacks && ' · no snacks'}
        </span>
      </summary>
      <div className="filters-body">
        <div className="filter-row">
          <div className="filter-label">Show</div>
          <div className="filter-ctl">
            <Segmented
              label="Show"
              options={[
                { value: 'all', label: 'Everything' },
                { value: 'tags', label: 'Tags' },
                { value: 'exercises', label: 'Exercises' },
                { value: 'types', label: 'Types' },
                { value: 'sessions', label: 'Sessions' },
              ]}
              value={c.show}
              onChange={(v) => update({ show: (v ?? 'all') as CalendarShow })}
            />
            {c.show === 'tags' && (
              <div className="stack-sm">
                <div className="chips wrap">
                  {d.tagsSorted.map((t) => (
                    <Chip key={t.id} label={t.name} color={t.color} on={c.tagIds.includes(t.id)} onClick={() => update({ tagIds: toggleIn(c.tagIds, t.id) })} />
                  ))}
                </div>
                {c.tagIds.length > 1 && (
                  <div className="row gap-sm">
                    <span className="muted small">Match</span>
                    <Segmented
                      options={[
                        { value: 'any', label: 'Any tag' },
                        { value: 'all', label: 'All tags' },
                      ]}
                      value={c.tagMatch}
                      onChange={(v) => update({ tagMatch: (v ?? 'any') as 'any' | 'all' })}
                    />
                  </div>
                )}
                {!c.tagIds.length && <span className="muted small">Pick one or more tags. Until then everything shows.</span>}
              </div>
            )}
            {c.show === 'exercises' && (
              <div className="stack-sm">
                <div className="chips wrap">
                  {[...d.raw.exercises]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((ex) => (
                      <Chip
                        key={ex.id}
                        label={ex.name + (ex.archived ? ' (archived)' : '')}
                        color={exerciseColor(d, ex)}
                        on={c.exerciseIds.includes(ex.id)}
                        onClick={() => update({ exerciseIds: toggleIn(c.exerciseIds, ex.id) })}
                      />
                    ))}
                </div>
                {!c.exerciseIds.length && <span className="muted small">Pick one or more exercises. Pick exactly one to see its progress chart.</span>}
              </div>
            )}
            {c.show === 'sessions' && (
              <div className="stack-sm">
                {d.sessionsSorted.length ? (
                  <div className="chips wrap">
                    {d.sessionsSorted.map((s) => (
                      <Chip key={s.id} label={s.name} on={c.sessionIds.includes(s.id)} onClick={() => update({ sessionIds: toggleIn(c.sessionIds, s.id) })} />
                    ))}
                  </div>
                ) : (
                  <span className="muted small">No saved sessions yet. Create them in Library → Sessions.</span>
                )}
                {d.sessionsSorted.length > 0 && !c.sessionIds.length && <span className="muted small">Pick one or more sessions to see the days you logged them.</span>}
              </div>
            )}
            {c.show === 'types' && (
              <div className="chips wrap">
                {d.typesSorted.map((t) => (
                  <Chip key={t.id} label={t.name} color={t.color} on={c.typeIds.includes(t.id)} onClick={() => update({ typeIds: toggleIn(c.typeIds, t.id) })} />
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="filter-row">
          <div className="filter-label">Colour by</div>
          <div className="filter-ctl">
            <Segmented
              label="Colour by"
              options={[
                { value: 'tag', label: 'Tag' },
                { value: 'exercise', label: 'Exercise' },
                { value: 'type', label: 'Type' },
                { value: 'heat', label: 'Heat' },
              ]}
              value={c.colorBy}
              onChange={(v) => update({ colorBy: (v ?? 'tag') as CalendarColorBy })}
            />
          </div>
        </div>
        <div className="filter-row">
          <label className="filter-label" htmlFor={`${id}-metric`}>
            Measure
          </label>
          <div className="filter-ctl row gap-sm wrap">
            <select className="input auto" id={`${id}-metric`} value={c.metric} onChange={(e) => update({ metric: e.target.value as MetricId })}>
              {METRICS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <span className="muted small">Used for heat shading and the totals below.</span>
          </div>
        </div>
        <div className="filter-row">
          <div className="filter-label">Also show</div>
          <div className="filter-ctl row gap-md wrap">
            <Switch id={`${id}-snacks`} checked={c.snacks} onChange={(snacks) => update({ snacks })} label="Mini-exercises" />
            <Switch id={`${id}-checkins`} checked={c.checkins} onChange={(checkins) => update({ checkins })} label="Check-ins" />
            <select className="input auto" id={`${id}-pain`} aria-label="Pain overlay" value={c.painPartId} onChange={(e) => update({ painPartId: e.target.value })}>
              <option value="">No pain overlay</option>
              {d.bodyPartsSorted.map((b) => (
                <option key={b.id} value={b.id}>
                  Pain: {b.name}
                  {b.active ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </details>
  );
}

export function SavedViews({ config, onApply }: { config: CalendarConfig; onApply: (c: CalendarConfig) => void }) {
  const d = useData();
  const modals = useModals();
  const isDefault = sameConfig(config, DEFAULT_CONFIG);
  const matchesSaved = d.viewsSorted.some((v) => sameConfig(config, v.config));
  return (
    <div className="saved-views">
      <span className="saved-label">Views</span>
      <Chip label="Everything" on={isDefault} onClick={() => onApply({ ...DEFAULT_CONFIG })} />
      {d.viewsSorted.map((v) => {
        const on = sameConfig(config, v.config);
        return (
          <span className="saved-chip" key={v.id}>
            <Chip label={v.name} on={on} onClick={() => onApply({ ...DEFAULT_CONFIG, ...v.config })} />
            {on && <IconButton icon="close" size={14} className="saved-x" label={`Delete view ${v.name}`} onClick={() => saveWithUndo([del('views', v.id)], `Deleted view ${v.name}`)} />}
          </span>
        );
      })}
      {!isDefault && !matchesSaved && (
        <Button size="sm" kind="ghost" icon="plus" onClick={() => modals.open((close) => <SaveViewDialog config={config} onClose={close} />)}>
          Save this view
        </Button>
      )}
    </div>
  );
}

function SaveViewDialog({ config, onClose }: { config: CalendarConfig; onClose: () => void }) {
  const d = useData();
  const formId = useId();
  const [name, setName] = useState(() => describeConfig(d, config).what.slice(0, 40));
  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    if (await save([put('views', { id: uid('view'), name: n, config, createdAt: Date.now() })])) {
      notify(`Saved view ${n}`);
      onClose();
    }
  }
  return (
    <Modal
      title="Save view"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <Button kind="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" form={formId} disabled={!name.trim()}>
            Save view
          </Button>
        </>
      }
    >
      <form id={formId} className="stack" onSubmit={submit}>
        <p className="muted">Saves the filters, colouring and measure so you can get back to them in one tap.</p>
        <Field label="Name">
          <input className="input" id={`${formId}-name`} autoFocus autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

export function Legend({ data, config, view, update }: { data: Collected; config: CalendarConfig; view: CalView; update: (p: Partial<CalendarConfig>) => void }) {
  if (config.colorBy === 'heat') {
    const levels = view === 'year' ? YEAR_HEAT : MONTH_HEAT;
    return (
      <div className="legend">
        <span className="legend-note">Shaded by {metricDef(config.metric).short.toLowerCase()}</span>
        <span className="heat-scale">
          <span>Less</span>
          {levels.map((p, i) => (
            <i key={i} style={{ background: p ? tint('var(--accent)', p) : 'var(--surface-3)' }} />
          ))}
          <span>More</span>
        </span>
      </div>
    );
  }
  if (!data.legend.length) {
    return (
      <div className="legend">
        <span className="legend-note">Nothing matches in this range.</span>
      </div>
    );
  }
  const focus = (g: LegendItem) => {
    if (g.kind === 'tag') update({ show: 'tags', tagIds: [g.id], tagMatch: 'any' });
    else if (g.kind === 'exercise') update({ show: 'exercises', exerciseIds: [g.id] });
    else update({ show: 'types', typeIds: [g.id] });
  };
  return (
    <div className="legend">
      <span className="legend-note">Days per {config.colorBy}:</span>
      <div className="chips wrap">
        {data.legend.map((g) => (
          <Chip
            key={g.id}
            label={g.name}
            color={g.color}
            count={g.days}
            small
            title={g.id === UNTAGGED.id ? 'Entries whose exercise has no tags' : `Show only ${g.name}`}
            onClick={g.id === UNTAGGED.id ? undefined : () => focus(g)}
          />
        ))}
      </div>
      {config.show !== 'all' && (
        <Button size="sm" kind="ghost" onClick={() => update({ show: 'all' })}>
          Show everything
        </Button>
      )}
    </div>
  );
}
