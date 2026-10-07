import { Button } from '../../components/ui';
import { plural } from '../../lib/format';
import type { DeviceInfo } from '../device';
import { describeError, type ErrorAction, type SyncError, type SyncErrorDetail } from '../errors';
import type { GitHubConfig } from '../local';
import { totalCount } from '../merge';
import { TOKENS_URL } from './text';

interface LinkProps {
  actions: ErrorAction[];
  /** owner/name */
  repo: string;
  branch?: string;
  detail?: SyncErrorDetail;
  onRetry?: () => void;
  onReplaceToken?: () => void;
}

/** The buttons under an error message. Links to GitHub open in a new tab. */
export function ErrorLinks({ actions, repo, branch = 'main', detail, onRetry, onReplaceToken }: LinkProps) {
  const link = (key: string, href: string, label: string) => (
    <a key={key} className="btn sm" href={href} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
  const items = actions.map((a) => {
    if (a === 'retry')
      return onRetry ? (
        <Button key={a} size="sm" icon="sync" onClick={onRetry}>
          Try again
        </Button>
      ) : null;
    if (a === 'replace-token')
      return onReplaceToken ? (
        <Button key={a} size="sm" onClick={onReplaceToken}>
          Replace token
        </Button>
      ) : null;
    if (a === 'open-tokens') return link(a, TOKENS_URL, 'Open GitHub tokens');
    if (a === 'open-repo-settings') return link(a, `https://github.com/${repo}/settings`, 'Open repository settings');
    return detail?.path ? link(a, `https://github.com/${repo}/blob/${encodeURIComponent(branch)}/${detail.path}#L${detail.line ?? 1}`, 'Open file') : null;
  });
  if (!items.some(Boolean)) return null;
  return <div className="row gap-sm wrap">{items}</div>;
}

interface PanelProps {
  error: SyncError;
  device: DeviceInfo;
  cfg: GitHubConfig;
  now: number;
  onRetry: () => void;
  onReplaceToken: () => void;
}

/** A failed sync: the message for its code, what already arrived (if anything), and what to do next. */
export function ErrorPanel({ error, device, cfg, now, onRetry, onReplaceToken }: PanelProps) {
  const repo = `${cfg.owner}/${cfg.repo}`;
  const { message, actions } = describeError(error.code, { device: device.name, repo, branch: cfg.branch, detail: error.detail, now });
  const arrived = error.partial ? totalCount(error.partial) : 0;
  return (
    <div className="sync-error" role="alert">
      <p>{arrived ? `Got ${plural(arrived, 'change')} from GitHub, but couldn't send this ${device.name}'s changes. ${message}` : message}</p>
      <ErrorLinks actions={actions} repo={repo} branch={cfg.branch} detail={error.detail} onRetry={onRetry} onReplaceToken={onReplaceToken} />
    </div>
  );
}
