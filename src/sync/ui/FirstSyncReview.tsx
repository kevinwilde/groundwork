import { exportBackupFile, useTombstones } from '../../components/backupFile';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/ui';
import { useData } from '../../data/DataProvider';
import { changesText } from '../../db/labels';
import { fmtNum, plural } from '../../lib/format';
import type { DeviceInfo } from '../device';
import type { Review } from '../status';

interface Props {
  review: Review;
  device: DeviceInfo;
  onClose: () => void;
  onSync: () => void;
}

/** Shown before the first sync on a device when both GitHub and this device have data. */
export function FirstSyncReview({ review, device, onClose, onSync }: Props) {
  const d = useData();
  const tombstones = useTombstones();
  return (
    <Modal
      title={`First sync on this ${device.name}`}
      onClose={onClose}
      footer={
        <>
          <Button icon="download" onClick={() => exportBackupFile(d.raw, tombstones)}>
            Export backup
          </Button>
          <span className="spacer" />
          <Button kind="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" icon="sync" onClick={onSync}>
            Sync now
          </Button>
        </>
      }
    >
      <div className="stack">
        <p>
          GitHub has {plural(review.remoteRecords, 'record')} and this {device.name} has {fmtNum(review.ownRecords)} of its own. Syncing combines them: where both have the same
          record, the most recently changed copy wins. Records you deleted on one device before this update may come back.
        </p>
        <ul className="review-list">
          <li>
            <b>This {device.name} gets:</b> {changesText(review.counts.local) || 'nothing new'}
          </li>
          <li>
            <b>GitHub gets:</b> {changesText(review.counts.remote) || 'nothing new'}
          </li>
        </ul>
        <p className="muted small">If you're not sure, export a backup first.</p>
      </div>
    </Modal>
  );
}
