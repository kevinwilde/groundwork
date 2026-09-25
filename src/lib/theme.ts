import { useSyncExternalStore } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'gw.theme';
const EVENT = 'gw-theme';

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Page ground per theme; keep in sync with --bg in app.css. */
const GROUND = { light: '#edf0f4', dark: '#0d1116' } as const;

/** "system" leaves data-theme alone so a host page (or the OS) decides. */
export function applyTheme(pref = getThemePref()) {
  const root = document.documentElement;
  if (pref === 'system') {
    if (root.dataset.gwTheme) root.removeAttribute('data-theme');
    delete root.dataset.gwTheme;
  } else {
    root.setAttribute('data-theme', pref);
    root.dataset.gwTheme = pref;
  }
  syncThemeColor(pref);
}

/** Browser and installed-app chrome (status bar, title bar) follows the chosen theme. */
function syncThemeColor(pref: ThemePref) {
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const scheme = meta.media.includes('dark') ? 'dark' : 'light';
    meta.content = pref === 'system' ? GROUND[scheme] : GROUND[pref];
  });
}

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* storage unavailable */
  }
  applyTheme(pref);
  window.dispatchEvent(new Event(EVENT));
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb);
      return () => window.removeEventListener(EVENT, cb);
    },
    getThemePref,
    () => 'system',
  );
}
