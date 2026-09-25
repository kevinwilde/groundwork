import clsx from 'clsx';
import { useEffect, useId, useState } from 'react';
import { useModals } from '../components/Modal';
import { notify, notifyError, save, saveWithUndo } from '../components/toast';
import { Button, Field, FormError, SectionHead, Segmented, PageHead } from '../components/ui';
import { useData } from '../data/DataProvider';
import { useMediaQuery, useToday } from '../data/hooks';
import { clear, put, setSetting } from '../data/ops';
import type { RawData } from '../data/snapshot';
import { buildBackup, importOps, parseBackup } from '../db/backup';
import { libraryOps, sampleOps } from '../db/seed';
import { TABLES, type TableName } from '../db/types';
import { daysBetween, toDateStr } from '../lib/dates';
import { saveTextFile, warmUpDownloads } from '../lib/files';
import { fmtNum, plural } from '../lib/format';
import { isIOS, isStandalone, promptInstall, useCanPromptInstall } from '../lib/install';
import { hasSample, opsRemoveSample } from '../lib/model';
import { setThemePref, useThemePref, type ThemePref } from '../lib/theme';

const LABELS: Record<TableName, string> = {
  types: 'Exercise types',
  tags: 'Tags',
  exercises: 'Exercises',
  entries: 'Logged entries',
  snacks: 'Mini-exercises',
  sessions: 'Saved sessions',
  bodyParts: 'Body parts',
  checkins: 'Check-ins',
  views: 'Saved calendar views',
  settings: 'Settings',
};

export function DataPage() {
  useEffect(warmUpDownloads, []);
  return (
    <>
      <PageHead title="Data" eyebrow="Backups and settings" />
      <div className="data-grid">
        <Backup />
        <Restore />
        <Install />
        <Sample />
        <Storage />
        <Settings />
        <Danger />
      </div>
    </>
  );
}

function Backup() {
  const d = useData();
  const t = useToday();
  const [fallback, setFallback] = useState<string | null>(null);
  const last = d.settings.get('lastExportAt') as number | undefined;
  const days = last ? daysBetween(toDateStr(new Date(last)), t) : null;

  async function exportFile() {
    const res = await saveTextFile(`groundwork-backup-${t}.json`, JSON.stringify(buildBackup(d.raw), null, 2));
    if (res === 'saved') {
      await setSetting('lastExportAt', Date.now());
      notify('Backup saved');
    } else if (res === 'unavailable') notifyError('Saving files is not available here. Use Copy JSON instead.');
  }

  async function copy() {
    const text = JSON.stringify(buildBackup(d.raw));
    try {
      await navigator.clipboard.writeText(text);
      await setSetting('lastExportAt', Date.now());
      setFallback(null);
      notify('Backup copied. Paste it into a file or note to keep it.');
    } catch {
      setFallback(text);
      notifyError('Could not reach the clipboard. Select the text below and copy it.');
    }
  }

  return (
    <section className="card">
      <SectionHead title="Back up" />
      <p>Everything lives in this browser only. Export a backup regularly, and use it to move your data to another device or browser.</p>
      <div className="row gap-sm wrap">
        {last ? (
          <span className={clsx('status-pill', days! > 14 ? 'warn' : 'ok')}>{days === 0 ? 'Backed up today' : `Last backup ${plural(days!, 'day')} ago`}</span>
        ) : (
          <span className="status-pill warn">Never backed up</span>
        )}
      </div>
      <div className="row gap-sm wrap">
        <Button kind="primary" icon="download" onClick={exportFile}>
          Export all data
        </Button>
        <Button icon="copy" onClick={copy}>
          Copy JSON
        </Button>
      </div>
      {fallback && <textarea className="input mono" id="copy-fallback" rows={6} readOnly value={fallback} onFocus={(e) => e.target.select()} />}
    </section>
  );
}

function Restore() {
  const modals = useModals();
  const id = useId();
  const [paste, setPaste] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ exportedAt?: string; data: RawData } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');

  function accept(text: string) {
    const res = parseBackup(text);
    if (!res.ok) return setError(res.error);
    setError(null);
    setPending(res.backup);
  }

  function readFile(file: File | undefined) {
    if (!file) return;
    file.text().then(accept, () => setError('Could not read that file.'));
  }

  async function run() {
    if (!pending) return;
    if (mode === 'replace') {
      const ok = await modals.confirm({
        title: 'Replace all data?',
        message: 'Everything currently in this browser is deleted and replaced with the backup. Export first if you might need it.',
        confirmLabel: 'Replace everything',
        danger: true,
      });
      if (!ok) return;
    }
    const total = TABLES.reduce((n, tb) => n + (tb === 'settings' ? 0 : pending.data[tb].length), 0);
    if (await save(importOps(pending.data, mode))) {
      notify(`Imported ${plural(total, 'record')}`);
      setPending(null);
      setPaste('');
    }
  }

  return (
    <section className="card">
      <SectionHead title="Restore" />
      <p>Load a backup made with Export or Copy JSON.</p>
      {pending ? (
        <div className="import-preview">
          <div className="row space-between wrap gap-sm">
            <b>Ready to import</b>
            {pending.exportedAt && <span className="muted small">Exported {new Date(pending.exportedAt).toLocaleString()}</span>}
          </div>
          <ul className="count-list">
            {TABLES.filter((tb) => tb !== 'settings' && pending.data[tb].length).map((tb) => (
              <li key={tb}>
                <span>{LABELS[tb]}</span>
                <b>{fmtNum(pending.data[tb].length)}</b>
              </li>
            ))}
          </ul>
          <Field label="How to import" group>
            <Segmented
              options={[
                { value: 'merge', label: 'Merge with what is here' },
                { value: 'replace', label: 'Replace everything' },
              ]}
              value={mode}
              onChange={(v) => setMode((v ?? 'merge') as 'merge' | 'replace')}
            />
          </Field>
          <p className="muted small">
            {mode === 'merge'
              ? 'Adds everything from the backup. Records with the same id are overwritten by the backup copy; nothing here is deleted.'
              : 'Deletes all data in this browser first, then loads the backup.'}
          </p>
          <div className="row gap-sm">
            <Button kind="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button kind={mode === 'replace' ? 'danger' : 'primary'} icon="upload" onClick={run}>
              {mode === 'replace' ? 'Replace and import' : 'Import'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="stack-sm">
          <div>
            <input
              type="file"
              id={`${id}-file`}
              accept="application/json,.json"
              className="visually-hidden"
              onChange={(e) => {
                readFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <label className="btn" htmlFor={`${id}-file`}>
              Choose backup file
            </label>
          </div>
          <textarea className="input mono" id={`${id}-paste`} rows={4} placeholder="Or paste a backup here" aria-label="Paste a backup" value={paste} onChange={(e) => setPaste(e.target.value)} />
          <div>
            <Button size="sm" onClick={() => (paste.trim() ? accept(paste) : setError('Paste a backup first.'))}>
              Read pasted backup
            </Button>
          </div>
          <FormError>{error}</FormError>
        </div>
      )}
    </section>
  );
}

function Install() {
  const canPrompt = useCanPromptInstall();
  const standalone = useMediaQuery('(display-mode: standalone)') || isStandalone();
  const [cached, setCached] = useState<boolean | null>(null);
  const secure = window.isSecureContext;
  const ios = isIOS();

  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return setCached(false);
    let live = true;
    sw.getRegistration().then(
      (reg) => live && setCached(!!reg?.active),
      () => live && setCached(false),
    );
    const onChange = () => setCached(true);
    sw.addEventListener('controllerchange', onChange);
    return () => {
      live = false;
      sw.removeEventListener('controllerchange', onChange);
    };
  }, []);

  const status = cached == null ? 'Checking offline support…' : cached ? 'Available offline' : secure ? 'Not saved for offline yet' : 'Offline needs HTTPS';

  return (
    <section className="card">
      <SectionHead title="Install & offline" />
      <p>Install Groundwork to open it from your home screen or dock. After it has loaded once, it works with no connection.</p>
      <div className="row gap-sm wrap">
        <span className={clsx('status-pill', cached ? 'ok' : cached === false && 'warn')}>{status}</span>
        {standalone && <span className="status-pill ok">Running as an installed app</span>}
      </div>
      {!standalone && canPrompt && (
        <div>
          <Button
            kind="primary"
            icon="download"
            onClick={async () => {
              if ((await promptInstall()) === 'accepted') notify('Groundwork installed');
            }}
          >
            Install app
          </Button>
        </div>
      )}
      {!standalone && !canPrompt && (
        <p className="muted small">
          {ios
            ? 'On iPhone or iPad: open this page in Safari, tap Share, then Add to Home Screen.'
            : "Use your browser's Install or Add to Home Screen option. In Safari on a Mac, choose File → Add to Dock."}
        </p>
      )}
      {!secure && <p className="muted small">Offline use needs the app to be served over HTTPS (or from localhost).</p>}
      <p className="muted small">
        On iPhone and iPad the installed app keeps its own data, separate from Safari. To move your history across, export a backup in one and import it
        in the other.
      </p>
    </section>
  );
}

function Sample() {
  const d = useData();
  const t = useToday();
  const n = d.raw.entries.filter((e) => e.sample).length + d.raw.checkins.filter((c) => c.sample).length;
  return (
    <section className="card">
      <SectionHead title="Sample history" />
      <p>Ten weeks of made-up lifts, runs, snacks and check-ins for trying out the calendar and charts. Sample records are flagged, so removing them never touches your own entries.</p>
      {hasSample(d) ? (
        <div className="row gap-sm wrap">
          <span className="status-pill">{plural(n, 'sample record')} loaded</span>
          <Button kind="primary" onClick={() => saveWithUndo(opsRemoveSample(d), 'Sample data removed')}>
            Remove sample data
          </Button>
        </div>
      ) : (
        <div>
          <Button
            onClick={async () => {
              const ops = sampleOps({ today: t, exerciseIds: new Set(d.exercises.keys()), snackIds: new Set(d.snacks.keys()), sessionIds: new Set(d.sessions.keys()), bodyPartIds: new Set(d.bodyParts.keys()) });
              if (await save(ops)) notify(ops.length ? 'Sample history loaded' : 'Sample history needs the starter exercises, which are no longer in your library.');
            }}
          >
            Load sample history
          </Button>
        </div>
      )}
    </section>
  );
}

function Storage() {
  const d = useData();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const p = await navigator.storage?.persisted?.();
        const est = await navigator.storage?.estimate?.();
        if (!live) return;
        setPersisted(p ?? null);
        setUsage(est?.usage ?? null);
      } catch {
        /* unsupported */
      }
    })();
    return () => {
      live = false;
    };
  }, [d]);
  return (
    <section className="card">
      <SectionHead title="Storage" />
      <p>Saved in this browser with IndexedDB.</p>
      <div className="row gap-sm wrap">
        <span className={clsx('status-pill', persisted === true && 'ok', persisted === false && 'warn')}>
          {persisted == null ? 'Persistence status unknown' : persisted ? 'Protected from automatic cleanup' : 'The browser may clear this data under storage pressure'}
        </span>
        {usage != null && <span className="muted small">About {fmtNum(usage / 1024, 0)} KB used</span>}
      </div>
      <ul className="count-list">
        {TABLES.filter((tb) => tb !== 'settings').map((tb) => (
          <li key={tb}>
            <span>{LABELS[tb]}</span>
            <b>{fmtNum(d.raw[tb].length)}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Settings() {
  const d = useData();
  const theme = useThemePref();
  return (
    <section className="card">
      <SectionHead title="Settings" />
      <div className="settings-grid">
        <Field label="Week starts on" group>
          <Segmented
            options={[
              { value: 0, label: 'Sunday' },
              { value: 1, label: 'Monday' },
            ]}
            value={d.weekStart}
            onChange={(v) => v != null && setSetting('weekStart', v)}
          />
        </Field>
        <Field label="Appearance" group hint="Remembered on this device only.">
          <Segmented
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            value={theme}
            onChange={(v) => setThemePref((v ?? 'system') as ThemePref)}
          />
        </Field>
      </div>
    </section>
  );
}

function Danger() {
  const modals = useModals();
  async function erase() {
    const ok = await modals.confirm({
      title: 'Erase all data?',
      message: 'All data in this browser will be deleted. The starter library is loaded again afterwards.',
      confirmLabel: 'Erase everything',
      danger: true,
      requireText: 'ERASE',
    });
    if (!ok) return;
    if (await save([...TABLES.map((tb) => clear(tb)), ...libraryOps(), put('settings', { key: 'seeded', value: true })])) notify('All data erased');
  }
  return (
    <section className="card danger-card">
      <SectionHead title="Erase everything" />
      <p>Deletes every exercise, entry, check-in and setting in this browser, then reloads the starter library. This cannot be undone, so export a backup first.</p>
      <div>
        <Button kind="danger" icon="trash" onClick={erase}>
          Erase all data
        </Button>
      </div>
    </section>
  );
}
