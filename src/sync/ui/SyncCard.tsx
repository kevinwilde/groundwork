import clsx from 'clsx';
import { format } from 'date-fns';
import { useId, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Modal, useModals } from '../../components/Modal';
import { notify, notifyError } from '../../components/toast';
import { Button, Field, SectionHead } from '../../components/ui';
import { useNow, useOnline } from '../../data/hooks';
import { db } from '../../db/db';
import { fmtAgo, fmtWhen } from '../../lib/dates';
import { plural } from '../../lib/format';
import { isIOS, isStandalone } from '../../lib/install';
import type { DeviceInfo } from '../device';
import { disconnect } from '../engine';
import { describeError } from '../errors';
import { setMeta, type GitHubConfig } from '../local';
import { closeReview, resetSyncStatus, syncNow, undoLastSync, useSyncStatus } from '../status';
import { ErrorPanel } from './ErrorPanel';
import { FirstSyncReview } from './FirstSyncReview';
import { SetupDialog } from './SetupDialog';
import { SyncResult } from './SyncResult';
import { progressText, TOKENS_URL, undoText } from './text';
import { useSyncMeta } from './useSyncMeta';

const DAY = 86_400_000;

export function SyncCard() {
  const meta = useSyncMeta();
  const status = useSyncStatus();
  const modals = useModals();
  const online = useOnline();
  const now = useNow();
  const device = meta?.device;
  if (!meta || !device) return null;
  const cfg = meta.github;

  const openSetup = (replace?: GitHubConfig) =>
    modals.open((close) => (
      <SetupDialog
        device={device}
        replace={replace}
        onClose={close}
        onSync={() => {
          close();
          void syncNow();
        }}
      />
    ));

  if (!cfg) {
    return (
      <section className="card sync-card">
        <SectionHead title="Sync with GitHub" />
        <p>Keep your devices in step through a private GitHub repository that only you can see. Every sync is saved there as a commit, so you also get a history of your data.</p>
        {isIOS() && !isStandalone() && (
          <p className="muted small">You're using Groundwork in Safari. If you've added it to your Home Screen, set up sync there instead: the two keep separate data.</p>
        )}
        <div>
          <Button kind="primary" icon="sync" onClick={() => openSetup()}>
            Set up sync
          </Button>
        </div>
      </section>
    );
  }

  const state = meta.syncState;
  const repo = `${cfg.owner}/${cfg.repo}`;
  const from = state ? (state.remote.deviceId === device.id ? `this ${device.name}` : (state.remote.device ?? 'another device')) : null;
  const daysLeft = cfg.tokenExpiresAt ? Math.ceil((cfg.tokenExpiresAt - now) / DAY) : null;
  // A result stays until the next write or sync.
  const outcome = status.outcome && status.outcome.seq === meta.seq ? status.outcome : null;

  let pill: [string, string | false];
  if (status.syncing) pill = ['Syncing…', false];
  else if (!online) pill = ["Offline · sync when you're back online", false];
  else if (status.error) pill = ['Sync failed', 'warn'];
  else if (state) pill = [`Synced ${fmtAgo(state.at, now)}`, 'ok'];
  else pill = ['Not synced yet', 'warn'];

  const undo = async () => {
    if (!outcome || outcome.kind === 'up-to-date') return;
    const ok = await modals.confirm({
      title: `Undo the sync on this ${device.name}?`,
      message: `This puts this ${device.name} back the way it was before the sync: ${undoText(outcome.totals.local)}. Groundwork then syncs, so your other devices change too. The earlier versions stay in your GitHub history.`,
      confirmLabel: 'Undo sync',
    });
    if (!ok) return;
    const stale = await undoLastSync();
    if (stale) notifyError(describeError(stale.code, { device: device.name, repo }).message);
  };

  const leave = async () => {
    const ok = await modals.confirm({
      title: `Disconnect this ${device.name} from GitHub?`,
      message: `Your data stays on this ${device.name} and on GitHub. To revoke access completely, also delete this device's token on GitHub.`,
      confirmLabel: 'Disconnect',
      danger: true,
    });
    if (!ok) return;
    await disconnect(db);
    resetSyncStatus();
    toast('Disconnected from GitHub', { action: { label: 'Open GitHub tokens', onClick: () => void window.open(TOKENS_URL, '_blank', 'noopener') }, duration: 8000 });
  };

  return (
    <section className="card sync-card">
      <SectionHead title="Sync with GitHub" />
      <div className="row gap-sm wrap">
        <span className={clsx('status-pill', pill[1])}>{pill[0]}</span>
        {daysLeft !== null && daysLeft <= 14 && <span className="status-pill warn">{daysLeft <= 0 ? 'Token expired' : `Token expires in ${plural(daysLeft, 'day')}`}</span>}
      </div>
      <p className="sync-where small">
        <span className="sync-repo">{repo}</span>
        {state && from && ` · latest change from ${from}, ${fmtWhen(state.remote.at, now)}`}
      </p>
      <div className="row gap-sm wrap">
        <Button kind="primary" icon="sync" disabled={status.syncing} onClick={() => syncNow()}>
          Sync now
        </Button>
        <a className="btn" href={`https://github.com/${repo}/commits/${encodeURIComponent(cfg.branch)}`} target="_blank" rel="noreferrer">
          View history
        </a>
      </div>
      {status.syncing && status.progress ? (
        <div className="sync-line" role="status">
          <span className="spinner" aria-hidden="true" /> {progressText(status.progress, device.name)}
        </div>
      ) : status.error ? (
        <ErrorPanel error={status.error.error} device={device} cfg={cfg} now={now} onRetry={() => syncNow()} onReplaceToken={() => openSetup(cfg)} />
      ) : (
        outcome && <SyncResult outcome={outcome} device={device} now={now} onUndo={undo} />
      )}
      <details className="sync-settings">
        <summary>Settings</summary>
        <div className="stack-sm">
          <p className="small">
            This device: {device.name} · token github_pat_{cfg.tokenHint}
            {cfg.tokenExpiresAt ? `, expires ${format(cfg.tokenExpiresAt, 'd MMM yyyy')}` : ''}
          </p>
          <div className="row gap-sm wrap">
            <Button size="sm" icon="edit" onClick={() => modals.open((close) => <RenameDialog device={device} onClose={close} />)}>
              Rename device
            </Button>
            <Button size="sm" onClick={() => openSetup(cfg)}>
              Replace token
            </Button>
            <Button size="sm" kind="danger-text" onClick={leave}>
              Disconnect
            </Button>
          </div>
          <p className="muted small">
            To rotate a token, open it on GitHub and choose Regenerate token, then use Replace token on this device only. Other devices have their own tokens and aren't affected.
          </p>
        </div>
      </details>
      {status.review && (
        <FirstSyncReview
          review={status.review}
          device={device}
          onClose={closeReview}
          onSync={() => {
            closeReview();
            void syncNow({ reviewed: true });
          }}
        />
      )}
    </section>
  );
}

function RenameDialog({ device, onClose }: { device: DeviceInfo; onClose: () => void }) {
  const id = useId();
  const [name, setName] = useState(device.name);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    await setMeta(db, 'device', { ...device, name: n });
    notify(`This device is now called ${n}`);
    onClose();
  }

  return (
    <Modal
      title="Rename device"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <Button kind="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" form={id} disabled={!name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <form id={id} onSubmit={submit} noValidate>
        <Field label="This device's name" hint={`Shown in your GitHub history, like "${name.trim() || device.name}: added 3 entries".`}>
          <input className="input" id={`${id}-name`} autoFocus autoComplete="off" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
