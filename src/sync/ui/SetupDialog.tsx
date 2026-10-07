import clsx from 'clsx';
import { useId, useState, type FormEvent } from 'react';
import { Modal } from '../../components/Modal';
import { Button, Field, FormError } from '../../components/ui';
import { addDays, fmtWhen, parseDate, today } from '../../lib/dates';
import type { DeviceInfo } from '../device';
import { parseRepo, testConnection, type TestResult } from '../engine';
import { describeError, syncError } from '../errors';
import type { GitHubConfig } from '../local';
import { resetSyncStatus } from '../status';
import { ErrorLinks } from './ErrorPanel';
import { NEW_REPO_URL, tokenUrl } from './text';

interface Props {
  device: DeviceInfo;
  /** Replace token: the repository is fixed and only the Connect section shows. */
  replace?: GitHubConfig;
  onClose: () => void;
  /** After a successful test, the user chose Sync now. */
  onSync: () => void;
}

type Test = { phase: 'idle' } | { phase: 'testing'; repo: string } | { phase: 'done'; repo: string; result: TestResult };

export function SetupDialog({ device, replace, onClose, onSync }: Props) {
  const id = useId();
  const [repo, setRepo] = useState(replace ? `${replace.owner}/${replace.repo}` : '');
  // Held only while typing; cleared as soon as it has been saved.
  const [token, setToken] = useState('');
  const [show, setShow] = useState(false);
  const [expires, setExpires] = useState(() => addDays(today(), 366));
  const [name, setName] = useState(device.name);
  const [test, setTest] = useState<Test>({ phase: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const parsed = parseRepo(repo);
  const shown = parsed ? `${parsed.owner}/${parsed.repo}` : repo.trim();
  const ok = test.phase === 'done' && test.result.ok;

  async function paste() {
    try {
      setToken((await navigator.clipboard.readText()).trim());
      setError(null);
    } catch {
      setError("Couldn't read the clipboard. Press and hold in the field, then choose Paste.");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!parsed) return setTest({ phase: 'done', repo: shown, result: { ok: false, error: syncError('bad-repo') } });
    if (!token.trim()) return setError('Paste the token first.');
    if (!name.trim()) return setError('Give this device a name.');
    setError(null);
    setTest({ phase: 'testing', repo: shown });
    const expiresAt = expires ? parseDate(expires).getTime() : undefined;
    const result = await testConnection({ repo, token, expiresAt: Number.isNaN(expiresAt) ? undefined : expiresAt, deviceName: name });
    if (result.ok) {
      setToken('');
      resetSyncStatus();
    }
    setTest({ phase: 'done', repo: result.ok ? result.fullName : shown, result });
  }

  const footer = ok ? (
    <>
      <span className="spacer" />
      <Button kind="ghost" onClick={onClose}>
        {replace ? 'Done' : 'Later'}
      </Button>
      <Button kind="primary" icon="sync" onClick={onSync}>
        Sync now
      </Button>
    </>
  ) : (
    <>
      <span className="spacer" />
      <Button kind="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button kind="primary" type="submit" form={id} disabled={test.phase === 'testing'}>
        Test connection
      </Button>
    </>
  );

  return (
    <Modal title={replace ? 'Replace token' : 'Set up sync'} subtitle={replace ? `${replace.owner}/${replace.repo}` : 'Sync through a private GitHub repository'} onClose={onClose} footer={footer}>
      <form id={id} className="setup" onSubmit={submit} noValidate>
        {!replace && (
          <section className="setup-step">
            <h3 className="setup-title">
              <span className="setup-n">1</span> Create a private repository
            </h3>
            <p>Create a new repository just for Groundwork data and make it Private. Don't use the Groundwork app's repository or any repository with code in it.</p>
            <div>
              <a className="btn sm" href={NEW_REPO_URL} target="_blank" rel="noreferrer">
                Open GitHub
              </a>
            </div>
            <Field label="Repository" hint="Or paste its address.">
              <input
                className="input"
                id={`${id}-repo`}
                placeholder="kevinwilde/groundwork-data"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={repo}
                disabled={ok}
                onChange={(e) => setRepo(e.target.value)}
              />
            </Field>
            <p className="muted small">Skip this step on the second device: enter the same repository.</p>
          </section>
        )}

        <section className="setup-step">
          <h3 className="setup-title">
            <span className="setup-n">{replace ? 1 : 2}</span> Create a token for this device
          </h3>
          <div>
            <a className="btn sm" href={tokenUrl(name, parsed)} target="_blank" rel="noreferrer">
              Open GitHub
            </a>
          </div>
          <ol className="setup-list">
            <li>Sign in to GitHub if asked. The form opens with the name, expiry and permission filled in.</li>
            <li>
              <b>Resource owner:</b> your account{parsed ? ` (${parsed.owner})` : ''}.
            </li>
            <li>
              <b>Expiration:</b> 366 days (filled in).
            </li>
            <li>
              <b>Repository access:</b> choose <b>Only select repositories</b>, then pick <b>{parsed?.repo ?? 'your Groundwork repository'}</b>. This can't be filled in for you.
            </li>
            <li>
              <b>Permissions → Repository permissions → Contents: Read and write</b> (filled in). <b>Metadata: Read-only</b> is added automatically. Leave everything else at No access.
            </li>
            <li>
              Click <b>Generate token</b> and copy it. It starts with <code>github_pat_</code>, and GitHub shows it only once.
            </li>
          </ol>
          <p className="muted small">If the form isn't filled in: github.com → your picture → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.</p>
          <p className="muted small">
            On iPhone, the easiest way is to do this in Safari on the phone (use Request Desktop Website if the page is cramped), copy the token, and paste it here. Or create it on
            your Mac and copy it there: with Handoff on, it reaches the iPhone's clipboard for a couple of minutes.
          </p>
        </section>

        <section className="setup-step">
          <h3 className="setup-title">
            <span className="setup-n">{replace ? 2 : 3}</span> Connect
          </h3>
          <Field label="Token" htmlFor={`${id}-token`}>
            <div className="row gap-sm">
              {/* A text field drawn as dots, so password managers don't offer to save it. */}
              <input
                className={clsx('input mono token-input', !show && 'masked')}
                id={`${id}-token`}
                placeholder="github_pat_…"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={token}
                disabled={ok}
                onChange={(e) => setToken(e.target.value)}
              />
              <Button size="sm" onClick={paste} disabled={ok}>
                Paste
              </Button>
              <Button size="sm" kind="ghost" onClick={() => setShow((s) => !s)} aria-pressed={show} disabled={ok}>
                {show ? 'Hide' : 'Show'}
              </Button>
            </div>
          </Field>
          <div className="setup-row">
            <Field label="Token expires on" hint="Groundwork reminds you two weeks before." className="date-field">
              <input className="input" type="date" id={`${id}-expires`} value={expires} disabled={ok} onChange={(e) => setExpires(e.target.value)} />
            </Field>
            <Field label="This device's name" hint={`Shown in your GitHub history, like "${name.trim() || 'iPhone'}: added 3 entries".`}>
              <input className="input" id={`${id}-name`} maxLength={40} autoComplete="off" value={name} disabled={ok} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <FormError>{error}</FormError>
          <TestState test={test} device={name.trim() || device.name} />
        </section>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

function TestState({ test, device }: { test: Test; device: string }) {
  if (test.phase === 'idle') return null;
  if (test.phase === 'testing') {
    return (
      <div className="sync-line" role="status">
        <span className="spinner" aria-hidden="true" /> Checking {test.repo}…
      </div>
    );
  }
  const r = test.result;
  if (!r.ok) {
    const { message, actions } = describeError(r.error.code, { device, repo: test.repo, detail: r.error.detail });
    return (
      <div className="sync-error" role="alert">
        <p>{message}</p>
        <ErrorLinks actions={actions} repo={test.repo} />
      </div>
    );
  }
  const from = r.remote?.device ? ` by ${r.remote.device}` : '';
  return (
    <div className="sync-ok" role="status">
      {r.empty
        ? `Connected to ${r.fullName} (private). It's empty, so the first sync sets it up and uploads this device's data.`
        : `Connected to ${r.fullName} (private). It has Groundwork data, last changed${from} ${r.remote ? fmtWhen(r.remote.at) : 'recently'}.`}
    </div>
  );
}
