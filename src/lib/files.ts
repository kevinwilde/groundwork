/**
 * Saving a generated file. In a normal browser tab this is a Blob download. When the app runs
 * inside a sandboxed viewer that blocks page-initiated downloads but offers a `downloads`
 * capability (window.claude.use), that is used instead.
 */

interface DownloadsApi {
  save(req: { filename: string; data: string | Blob }): Promise<{ status: 'saved' | 'delivered' }>;
}

interface HostBridge {
  use(name: 'downloads'): Promise<DownloadsApi | null>;
}

declare global {
  interface Window {
    claude?: HostBridge;
  }
}

let hostDownloads: Promise<DownloadsApi | null> | null = null;

const inHost = () => typeof window !== 'undefined' && typeof window.claude?.use === 'function';

function getHostDownloads() {
  hostDownloads ??= inHost() ? Promise.resolve(window.claude!.use('downloads')).catch(() => null) : Promise.resolve(null);
  return hostDownloads;
}

/** Start resolving the host capability early so a click doesn't wait on it. */
export function warmUpDownloads() {
  void getHostDownloads();
}

export type SaveOutcome = 'saved' | 'declined' | 'unavailable';

export async function saveTextFile(filename: string, text: string, mime = 'application/json'): Promise<SaveOutcome> {
  if (inHost()) {
    const dl = await getHostDownloads();
    if (!dl) return 'unavailable';
    try {
      await dl.save({ filename, data: text });
      return 'saved';
    } catch (e) {
      return (e as { code?: string })?.code === 'declined' ? 'declined' : 'unavailable';
    }
  }
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return 'saved';
  } catch {
    return 'unavailable';
  }
}
