import { CalendarDays, LayoutGrid, LogOut, ScanLine, ScrollText, Settings as SettingsIcon, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { Brand } from '../components/ui';
import { useMe, useSignOut } from '../lib/auth';
import { pendingCount, queueEvents, syncPending } from '../lib/offline';
import { useOnline } from '../lib/useOnline';

export function NetworkPill() {
  const online = useOnline();
  const [pending, setPending] = useState(0);
  useEffect(() => {
    const refresh = () => pendingCount().then(setPending).catch(() => {});
    refresh();
    queueEvents.addEventListener('change', refresh);
    return () => queueEvents.removeEventListener('change', refresh);
  }, []);
  // Background sync: whenever we come back online, and every 15s while scans are pending.
  useEffect(() => {
    if (!online || pending === 0) return;
    syncPending();
    const t = setInterval(syncPending, 15_000);
    return () => clearInterval(t);
  }, [online, pending]);
  const Icon = online ? Wifi : WifiOff;
  return (
    <span
      className={`net-pill ${online ? (pending ? 'badge-caution' : 'badge-admit') : 'badge-deny'}`}
      role="status"
      title={online ? 'Connected to the network' : 'No network — scans are queued on this device'}
    >
      <Icon size={14} aria-hidden="true" />
      {online ? 'Online' : 'Offline'}
      {pending > 0 && ` · ${pending} to sync`}
    </span>
  );
}

export function AppLayout() {
  const { data: me } = useMe();
  const signOut = useSignOut();
  const navigate = useNavigate();
  if (!me) return null;
  const manager = me.role !== 'operator';
  const items = [
    { to: '/app', label: 'Overview', icon: LayoutGrid, end: true },
    { to: '/app/events', label: 'Events', icon: CalendarDays },
    { to: '/app/scan', label: 'Scan', icon: ScanLine },
    ...(manager ? [{ to: '/app/audit', label: 'Audit', icon: ScrollText }] : []),
    { to: '/app/settings', label: 'Settings', icon: SettingsIcon },
  ];
  const doSignOut = async () => {
    await signOut();
    navigate('/login');
  };
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Primary">
        <Brand to="/app" />
        <nav className="nav">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <NetworkPill />
          <div className="wash" style={{ padding: 12 }}>
            <div className="small" style={{ fontWeight: 500 }}>{me.name}</div>
            <div className="xs muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={me.email}>{me.email}</div>
            <div className="row" style={{ marginTop: 8, '--gap': '6px' } as React.CSSProperties}>
              <span className="badge" style={{ background: 'var(--paper)' }}>{me.role}</span>
              {me.isDemo && <span className="badge badge-caution">Demo</span>}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={doSignOut} style={{ justifyContent: 'flex-start' }}>
            <LogOut aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <Brand to="/app" />
          <div className="row" style={{ '--gap': '8px' } as React.CSSProperties}>
            <NetworkPill />
            <button className="btn btn-ghost icon-btn" onClick={doSignOut} aria-label="Sign out">
              <LogOut aria-hidden="true" />
            </button>
          </div>
        </header>
        <main id="main">
          <Outlet />
        </main>
      </div>
      <nav className="tabbar" aria-label="Primary" style={{ '--n': items.length } as React.CSSProperties}>
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}>
            <Icon aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
