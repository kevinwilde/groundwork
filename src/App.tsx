import { useEffect } from 'react';
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Icon, type IconName } from './components/Icon';
import { ModalHost } from './components/Modal';
import { PwaPrompt } from './components/PwaPrompt';
import { DataProvider } from './data/DataProvider';
import { useOnline } from './data/hooks';
import { useThemePref } from './lib/theme';
import { CalendarPage } from './pages/calendar/CalendarPage';
import { CheckinPage } from './pages/CheckinPage';
import { DataPage } from './pages/DataPage';
import { LibraryPage } from './pages/LibraryPage';
import { LogPage } from './pages/LogPage';
import { TodayPage } from './pages/TodayPage';

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Today', icon: 'today' },
  { to: '/log', label: 'Log', icon: 'log' },
  { to: '/calendar', label: 'Calendar', icon: 'calendar' },
  { to: '/checkin', label: 'Check-in', icon: 'checkin' },
  { to: '/library', label: 'Library', icon: 'library' },
  { to: '/data', label: 'Data', icon: 'data' },
];

export function App() {
  const theme = useThemePref();
  return (
    <HashRouter>
      <DataProvider>
        <ModalHost>
          <Layout />
        </ModalHost>
      </DataProvider>
      {/* Offset clears the bottom tab bar on phones and tablets. */}
      <Toaster position="bottom-center" theme={theme} closeButton offset={{ bottom: 88 }} mobileOffset={{ bottom: 88 }} />
      <PwaPrompt />
    </HashRouter>
  );
}

function Layout() {
  const { pathname } = useLocation();
  const online = useOnline();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="app">
      <nav className="nav" aria-label="Main">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>Groundwork</span>
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'nav-link on' : 'nav-link')}>
            <Icon name={n.icon} size={22} />
            <span className="nav-label">{n.label}</span>
          </NavLink>
        ))}
        <div className="nav-foot">{online ? 'Saved on this device' : 'Offline · everything still works'}</div>
      </nav>
      <main className="main" id="main">
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/log" element={<LogPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/checkin" element={<CheckinPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/library/:tab" element={<LibraryPage />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
