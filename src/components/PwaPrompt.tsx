import { useEffect } from 'react';
import { toast } from 'sonner';
import { useRegisterSW } from 'virtual:pwa-register/react';

const HOUR = 60 * 60 * 1000;

/**
 * Registers the service worker and tells the user when the app is ready offline
 * or when a new version has been downloaded and is waiting for a reload.
 */
export function PwaPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Look for a new version every hour while the app stays open.
      if (registration) window.setInterval(() => navigator.onLine && void registration.update(), HOUR);
    },
    onRegisterError(error) {
      console.warn('Service worker registration failed', error);
    },
  });

  useEffect(() => {
    if (!offlineReady) return;
    toast('Groundwork is ready to work offline.');
    setOfflineReady(false);
  }, [offlineReady, setOfflineReady]);

  useEffect(() => {
    if (!needRefresh) return;
    const id = toast('A new version of Groundwork is ready.', {
      duration: Infinity,
      action: { label: 'Reload', onClick: () => void updateServiceWorker(true) },
      onDismiss: () => setNeedRefresh(false),
    });
    return () => void toast.dismiss(id);
  }, [needRefresh, setNeedRefresh, updateServiceWorker]);

  return null;
}
