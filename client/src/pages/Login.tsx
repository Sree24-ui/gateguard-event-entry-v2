import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Info } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Alert, Brand, Field, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useMe } from '../lib/auth';
import type { User } from '../lib/types';

const DEMO = [
  { label: 'Organizer', email: 'organizer@demo.gateguard.dev', note: 'Events, attendees, analytics' },
  { label: 'Gate operator', email: 'gate@demo.gateguard.dev', note: 'Scanner and live counts only' },
];
const DEMO_PASSWORD = 'gateguard-demo';

export function Login() {
  const { data: me } = useMe();
  const [params] = useSearchParams();
  const next = params.get('next')?.startsWith('/app') ? params.get('next')! : '/app';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  if (me) return <Navigate to={next} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: User }>('/auth/login', { body: { email, password } });
      qc.setQueryData(['me'], user);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="public-shell">
      <div className="container" style={{ paddingBlock: 20 }}>
        <Brand />
      </div>
      <main id="main" className="container" style={{ display: 'grid', placeItems: 'center', paddingBlock: '24px 64px' }}>
        <div className="stack" style={{ '--gap': '24px', width: '100%', maxWidth: 420 } as React.CSSProperties}>
          <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            <div className="eyebrow">Staff sign-in</div>
            <h1 className="h1">Welcome back</h1>
            <p className="muted">Organizers and gate operators sign in here. Attendees don’t need an account.</p>
          </div>
          <form className="panel panel-pad stack" onSubmit={submit} noValidate>
            {error && <Alert tone="deny">{error.message}</Alert>}
            <Field label="Email" error={error?.fields.email}>
              {(p) => <input {...p} className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Field>
            <Field label="Password" error={error?.fields.password}>
              {(p) => <input {...p} className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            <button className="btn btn-dark btn-lg btn-block" disabled={busy}>
              {busy ? <Spinner label="Signing in" /> : <>Sign in <ArrowRight aria-hidden="true" /></>}
            </button>
          </form>
          <section className="wash stack" style={{ padding: 16, '--gap': '12px' } as React.CSSProperties} aria-labelledby="demo-h">
            <div className="row" style={{ '--gap': '8px' } as React.CSSProperties}>
              <Info size={16} aria-hidden="true" />
              <h2 id="demo-h" className="small" style={{ fontWeight: 500 }}>Try the shared demo workspace</h2>
            </div>
            <p className="xs muted">
              Demo accounts are public and see only the fictional demo event. Anyone can change its data; demo users can’t create
              accounts or change passwords.
            </p>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', '--gap': '8px' } as React.CSSProperties}>
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  className="btn btn-outline"
                  style={{ flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', height: 'auto', padding: '10px 12px', whiteSpace: 'normal', textAlign: 'left', gap: 2, background: 'var(--paper)' }}
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(DEMO_PASSWORD);
                  }}
                >
                  <span>{d.label}</span>
                  <span className="xs muted" style={{ fontWeight: 400 }}>{d.note}</span>
                </button>
              ))}
            </div>
            <p className="xs muted">Selecting one fills the form — then press Sign in.</p>
          </section>
        </div>
      </main>
    </div>
  );
}
