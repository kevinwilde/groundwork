import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import type { DeviceInfo } from '../device';
import type { GitHubConfig, SyncState } from '../local';

/** The sync rows of `meta` the Data page shows, live. Never the token. */
export function useSyncMeta() {
  return useLiveQuery(async () => {
    const [github, syncState, device, seq] = await db.meta.bulkGet(['github', 'syncState', 'device', 'seq']);
    return {
      github: github?.value as GitHubConfig | undefined,
      syncState: syncState?.value as SyncState | undefined,
      device: device?.value as DeviceInfo | undefined,
      seq: (seq?.value as number | undefined) ?? 0,
    };
  }, []);
}
