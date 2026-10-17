import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './state.tsx';
import { RaccoonAvatar } from './components/Raccoon.tsx';
import { Login } from './pages/Login.tsx';
import { HomeSetup } from './pages/HomeSetup.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Week } from './pages/Week.tsx';
import { Chores } from './pages/Chores.tsx';
import { Kids } from './pages/Kids.tsx';
import { Settings } from './pages/Settings.tsx';
import { Rewards } from './pages/Rewards.tsx';
import { Stats } from './pages/Stats.tsx';
import { KidPicker } from './pages/KidPicker.tsx';
import { KidBoard, ParentKidBoard } from './pages/KidBoard.tsx';

const NAV = [
  { to: '/', ico: '🏠', label: 'Home', end: true },
  { to: '/week', ico: '📅', label: 'Week' },
  { to: '/chores', ico: '🧹', label: 'Chores' },
  { to: '/kids', ico: '🦝', label: 'Kids' },
  { to: '/rewards', ico: '🎁', label: 'Rewards' },
  { to: '/stats', ico: '📊', label: 'Stats' },
  { to: '/settings', ico: '⚙️', label: 'Settings' },
];

function Nav({ className }: { className: string }) {
  const { who } = useApp();
  return (
    <nav className={className} aria-label="Main">
      {className === 'rail' && (
        <div className="brand" title="Daytime Ninja">
          <RaccoonAvatar variant={who?.user?.avatar} size={56} />
        </div>
      )}
      {NAV.map((n) => (
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

  // A family tablet with no parent signed in: kids pick their avatar. Parents can still sign in on top.
  if (!who?.user && who?.device) {
    if (loc.pathname === '/login') return <Login onTablet />;
    return who.kid ? <KidBoard /> : <KidPicker />;
  }
  if (!who?.user) return <Login />;
  if (!homeId) return <HomeSetup />;

  return (
    <div className="layout">
      <Nav className="rail" />
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/week" element={<Week />} />
          <Route path="/chores" element={<Chores />} />
          <Route path="/kids" element={<Kids />} />
          <Route path="/kids/:memberId" element={<ParentKidBoard />} />
          <Route path="/rewards" element={<Rewards />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/home/new" element={<HomeSetup inline />} />
          <Route path="*" element={<div className="card">That page wandered off. <NavLink to="/">Go home</NavLink></div>} />
        </Routes>
      </main>
      <Nav className="bottom-bar" />
    </div>
  );
}
