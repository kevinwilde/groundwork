import { Button } from '../../components/ui';
import { changesText } from '../../db/labels';
import { fmtAgo } from '../../lib/dates';
import type { DeviceInfo } from '../device';
import type { Finished } from '../status';
import { canUndo, warningText } from './text';

interface Props {
  outcome: Finished;
  device: DeviceInfo;
  now: number;
  onUndo: () => void;
}

/** What the last sync did, until the next write or sync. */
export function SyncResult({ outcome, device, now, onUndo }: Props) {
  const warnings = outcome.warnings.map((w) => (
    <p key={w.kind} className="sync-warn">
      {warningText(w)}
    </p>
  ));
  if (outcome.kind === 'up-to-date') {
    return (
      <div className="sync-result" role="status">
        <p>Already up to date.</p>
        {warnings}
      </div>
    );
  }
  const here = changesText(outcome.totals.local);
  const sent = changesText(outcome.totals.remote);
  return (
    <div className="sync-result" role="status">
      <p>
        <b>Synced {fmtAgo(outcome.at, now)}.</b>
      </p>
      <p>{here ? `On this ${device.name}: ${here}.` : `Nothing new for this ${device.name}.`}</p>
      {outcome.kind === 'synced' ? (
        <p>
          Sent to GitHub: {sent || 'an update to the deleted-records list'}.{' '}
          {outcome.commitUrl && (
            <a href={outcome.commitUrl} target="_blank" rel="noreferrer">
              View commit
            </a>
          )}
        </p>
      ) : (
        <p>Nothing to send.</p>
      )}
      {warnings}
      {canUndo(outcome) && (
        <div>
          <Button size="sm" onClick={onUndo}>
            Undo on this {device.name}
          </Button>
        </div>
      )}
    </div>
  );
}
