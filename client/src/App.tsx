import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { LoadingBlock } from './components/ui';
import { RequireAuth } from './lib/auth';
import { AppLayout } from './pages/AppLayout';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { NotFound } from './pages/NotFound';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Events = lazy(() => import('./pages/Events'));
const EventForm = lazy(() => import('./pages/EventForm'));
const EventDetail = lazy(() => import('./pages/EventDetail'));
const ScanSelect = lazy(() => import('./pages/ScanSelect'));
const Scanner = lazy(() => import('./pages/Scanner'));
const Audit = lazy(() => import('./pages/Audit'));
const Settings = lazy(() => import('./pages/Settings'));
const Register = lazy(() => import('./pages/Register'));
const TicketPage = lazy(() => import('./pages/TicketPage'));

const TITLES: [RegExp, string][] = [
  [/^\/$/, 'GateGuard V2 — Event entry without the queue chaos'],
  [/^\/login/, 'Sign in · GateGuard V2'],
  [/^\/app\/events\/new/, 'New event · GateGuard V2'],
  [/^\/app\/events/, 'Events · GateGuard V2'],
  [/^\/app\/scan/, 'Gate scanner · GateGuard V2'],
  [/^\/app\/audit/, 'Audit log · GateGuard V2'],
  [/^\/app\/settings/, 'Settings · GateGuard V2'],
  [/^\/app/, 'Overview · GateGuard V2'],
  [/^\/e\//, 'Register · GateGuard V2'],
  [/^\/t\//, 'Your ticket · GateGuard V2'],
];

function useTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? 'GateGuard V2';
    window.scrollTo(0, 0);
  }, [pathname]);
}

const fallback = (
  <div className="container page">
    <LoadingBlock />
  </div>
);

export function App() {
  useTitle();
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Suspense fallback={fallback}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/e/:slug" element={<Register />} />
          <Route path="/t/:code" element={<TicketPage />} />
          <Route
            path="/app"
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="events" element={<Events />} />
            <Route path="events/new" element={<RequireAuth roles={['admin', 'organizer']}><EventForm /></RequireAuth>} />
            <Route path="events/:id/edit" element={<RequireAuth roles={['admin', 'organizer']}><EventForm /></RequireAuth>} />
            <Route path="events/:id" element={<EventDetail />} />
            <Route path="scan" element={<ScanSelect />} />
            <Route path="scan/:id" element={<Scanner />} />
            <Route path="audit" element={<RequireAuth roles={['admin', 'organizer']}><Audit /></RequireAuth>} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  );
}
