import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './state.tsx';
import { RaccoonAvatar } from './components/Raccoon.tsx';
import type { KidPage } from '../../shared/pages.ts';
import { Login } from './pages/Login.tsx';
import { HomeSetup } from './pages/HomeSetup.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Week } from './pages/Week.tsx';
import { Chores } from './pages/Chores.tsx';
import { Kids } from './pages/Kids.tsx';
import { Settings } from './pages/Settings.tsx';
import { Rewards } from './pages/Rewards.tsx';
import { Stats } from './pages/Stats.tsx';
import { Doctors } from './pages/Doctors.tsx';
import { ParentDuty } from './pages/ParentDuty.tsx';
import { KidPicker } from './pages/KidPicker.tsx';
import { FamilyWall } from './pages/FamilyWall.tsx';
import { Reminders } from './pages/Reminders.tsx';
import { KidBoard, ParentKidBoard } from './pages/KidBoard.tsx';
import { ApiDocs } from './pages/ApiDocs.tsx';
import { DownloadsPage } from './pages/Downloads.tsx';

const NAV = [
  { to: '/', ico: '🏠', label: 'Home', end: true },
  { to: '/calendar', ico: '📅', label: 'Calendar' },
  { to: '/chores', ico: '🧹', label: 'Chores' },
  { to: '/kids', ico: '🦝', label: 'Kids' },
  { to: '/rewards', ico: '🎁', label: 'Rewards' },
  { to: '/stats', ico: '📊', label: 'Stats' },
  { to: '/doctors', ico: '🩺', label: 'Doctors' },
  { to: '/parent-duty', ico: '📝', label: 'Parent Duty' },
  { to: '/reminders', ico: '🔔', label: 'Reminders' },
  { to: '/settings', ico: '⚙️', label: 'Settings' },
];

/** Which per-kid page each nav entry belongs to (see shared/pages.ts). */
const NAV_PAGE: Record<string, KidPage> = { '/chores': 'chores', '/parent-duty': 'parentduty', '/rewards': 'goals', '/stats': 'stats', '/doctors': 'doctors' };

function Nav({ className }: { className: string }) {
  const { who, home } = useApp();
  const kids = home?.kids ?? [];
  const shown = NAV.filter((n) => !NAV_PAGE[n.to] || !kids.length || kids.some((k) => !k.pagesOff?.includes(NAV_PAGE[n.to])));
  return (
    <nav className={className} aria-label="Main">
      {className === 'rail' && (
        <div className="brand" title="Den Duty">
          <RaccoonAvatar variant={who?.user?.avatar} size={56} />
        </div>
      )}
      {shown.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          <span className="ico" aria-hidden>{n.ico}</span>
          {n.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function App() {
  const { who, loading, homeId } = useApp();
  const loc = useLocation();

  if (loading) {
    return <div className="center-screen"><RaccoonAvatar variant="ninja" size={96} title="Loading" /></div>;
  }
  // The API reference is open to anyone (it describes the API, it doesn't use it).
  if (loc.pathname === '/api-docs') return <ApiDocs />;
  // The app download page is open to anyone, signed in or not.
  if (loc.pathname === '/download') return <DownloadsPage />;

  // A family tablet with no parent signed in: kids pick their avatar. Parents can still sign in on top.
  if (!who?.user && who?.device) {
    if (loc.pathname === '/login') return <Login onTablet />;
    if (who.kid) return <KidBoard />;
    // The family wall is the tablet's home page (a parent can switch it back to the picker); the picker stays at /picker.
    return loc.pathname === '/picker' ? <KidPicker wallLink /> : <FamilyWall />;
  }
  if (!who?.user) return <Login />;
  if (!homeId) return <HomeSetup />;

  return (
    <div className="layout">
      <Nav className="rail" />
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/calendar" element={<Week />} />
          <Route path="/reminders" element={<Reminders />} />
          <Route path="/week" element={<Navigate to="/calendar" replace />} />
          <Route path="/chores" element={<Chores />} />
          <Route path="/kids" element={<Kids />} />
          <Route path="/kids/:memberId" element={<ParentKidBoard />} />
          <Route path="/rewards" element={<Rewards />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/doctors" element={<Doctors />} />
          <Route path="/therapy" element={<Navigate to="/doctors" replace />} />
          <Route path="/parent-duty" element={<ParentDuty />} />
          <Route path="/den" element={<Navigate to="/parent-duty" replace />} />
          <Route path="/honeydo" element={<Navigate to="/parent-duty" replace />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/home/new" element={<HomeSetup inline />} />
          <Route path="*" element={<div className="card">That page wandered off. <NavLink to="/">Go home</NavLink></div>} />
        </Routes>
      </main>
      <Nav className="bottom-bar" />
    </div>
  );
}
