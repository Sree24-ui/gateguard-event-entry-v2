import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, MapPin, Ticket, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Alert, Brand, ErrorState, Field, LoadingBlock, Spinner, fmtDate, fmtClock } from '../components/ui';
import { api, ApiError } from '../lib/api';
import type { PublicEvent, PublicTicket } from '../lib/types';

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-shell">
      <header className="container no-print" style={{ paddingBlock: 20 }}>
        <Brand />
      </header>
      <main id="main" className="container" style={{ paddingBottom: 64 }}>
        {children}
      </main>
      <footer className="footer no-print">
        <div className="container spread">
          <span>Tickets by GateGuard V2</span>
          <Link to="/">About GateGuard</Link>
        </div>
      </footer>
    </div>
  );
}

export default function Register() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['public-event', slug], queryFn: () => api<{ event: PublicEvent }>(`/public/events/${slug}`).then((r) => r.event), retry: false });
  const [f, setF] = useState({ name: '', email: '', affiliation: '' });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { ticket } = await api<{ ticket: PublicTicket }>(`/public/events/${slug}/register`, { body: f });
      navigate(`/t/${ticket.code}?new=1`);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  if (q.isLoading) return <PublicShell><LoadingBlock rows={6} /></PublicShell>;
  if (q.error || !q.data) {
    return (
      <PublicShell>
        <ErrorState error={(q.error as ApiError)?.status === 404 ? new Error('This event link is invalid or the event was removed.') : q.error} />
      </PublicShell>
    );
  }
  const ev = q.data;
  const full = ev.spotsLeft === 0;

  return (
    <PublicShell>
      <div className="split" style={{ alignItems: 'start', paddingTop: 24 }}>
        <section className="stack" style={{ '--gap': '20px' } as React.CSSProperties}>
          <div className="row" style={{ '--gap': '8px' } as React.CSSProperties}>
            <span className="eyebrow">Event registration</span>
            {ev.isDemo && <span className="badge badge-caution">Demo event</span>}
          </div>
          <h1 className="display" style={{ fontSize: 'clamp(36px, 6vw, 60px)' }}>{ev.name}</h1>
          {ev.description && <p className="lead" style={{ whiteSpace: 'pre-line' }}>{ev.description}</p>}
          <dl className="stack" style={{ margin: 0, '--gap': '12px' } as React.CSSProperties}>
            <div className="row"><CalendarDays size={18} aria-hidden="true" /><dt className="sr-only">When</dt><dd style={{ margin: 0 }}>{fmtDate(ev.startsAt)} · {fmtClock(ev.startsAt)} – {fmtClock(ev.endsAt)}</dd></div>
            <div className="row"><MapPin size={18} aria-hidden="true" /><dt className="sr-only">Where</dt><dd style={{ margin: 0 }}>{ev.venue}</dd></div>
            {ev.spotsLeft != null && (
              <div className="row"><Users size={18} aria-hidden="true" /><dt className="sr-only">Availability</dt><dd style={{ margin: 0 }}>{ev.spotsLeft} spot{ev.spotsLeft === 1 ? '' : 's'} left</dd></div>
            )}
          </dl>
        </section>

        <section className="panel panel-pad stack" aria-labelledby="reg-h">
          <h2 id="reg-h" className="h2">Get your ticket</h2>
          {!ev.registrationOpen || full ? (
            <Alert tone="caution">{full ? 'This event is full.' : 'Registration for this event is closed.'} Contact the organizer if you think this is a mistake.</Alert>
          ) : (
            <form className="stack" onSubmit={submit} noValidate>
              {error && !Object.keys(error.fields).length && <Alert tone="deny">{error.message}</Alert>}
              <Field label="Full name" error={error?.fields.name} hint="As on your college ID.">
                {(p) => <input {...p} className="input" autoComplete="name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}
              </Field>
              <Field label="Email" error={error?.fields.email} hint="One ticket per email.">
                {(p) => <input {...p} className="input" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}
              </Field>
              <Field label="College / department (optional)" error={error?.fields.affiliation}>
                {(p) => <input {...p} className="input" autoComplete="organization" value={f.affiliation} onChange={(e) => setF({ ...f, affiliation: e.target.value })} />}
              </Field>
              <label className="checkbox small">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>I agree that the organizer stores my name, email and college to manage entry for this event.</span>
              </label>
              <button className="btn btn-primary btn-lg btn-block" disabled={busy || !consent}>
                {busy ? <Spinner label="Registering" /> : <><Ticket aria-hidden="true" /> Register &amp; get QR ticket <ArrowRight aria-hidden="true" /></>}
              </button>
              <p className="xs muted">Your QR code contains only a signed ticket ID — no personal details.</p>
            </form>
          )}
        </section>
      </div>
    </PublicShell>
  );
}
