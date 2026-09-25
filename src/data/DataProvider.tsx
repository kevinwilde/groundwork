import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { bootstrap } from './bootstrap';
import { readAll } from './ops';
import { buildData, type Data } from './snapshot';

const DataContext = createContext<Data | null>(null);

/**
 * Loads every table with one live query. Any write (from this tab or another) re-runs it,
 * and the derived indexes are rebuilt once per change.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    bootstrap().then(
      () => setReady(true),
      (e) => setError(e),
    );
  }, []);

  const raw = useLiveQuery(() => (ready ? readAll() : undefined), [ready]);
  const data = useMemo(() => (raw ? buildData(raw) : null), [raw]);

  if (error) {
    return (
      <div className="boot-screen">
        <div className="boot-card">
          <h1 className="page-title">Storage unavailable</h1>
          <p>
            Groundwork keeps your data in this browser with IndexedDB, and the browser refused to open it. Private browsing windows and
            some privacy settings block it. Try a normal window, or allow site data for this page.
          </p>
          <p className="muted small">{String((error as Error)?.message ?? error)}</p>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="boot-screen" aria-busy="true">
        <span className="brand-mark big" aria-hidden="true" />
      </div>
    );
  }
  return <DataContext.Provider value={data}>{children}</DataContext.Provider>;
}

export function useData(): Data {
  const d = useContext(DataContext);
  if (!d) throw new Error('useData must be used inside <DataProvider>');
  return d;
}
