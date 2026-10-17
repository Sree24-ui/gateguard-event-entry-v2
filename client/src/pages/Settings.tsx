import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MonitorSmartphone, ShieldCheck, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Alert, ErrorState, Field, LoadingBlock, Spinner, useToast } from '../components/ui';
import { api, ApiError, errorMessage } from '../lib/api';
import { useMe } from '../lib/auth';
import type { Role, User } from '../lib/types';

export default function Settings() {
  const { data: me } = useMe();
  if (!me) return null;
  return (
    <div className="container page" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
          <div className="eyebrow">Settings</div>
          <h1 className="h1">Account &amp; team</h1>
        </div>
      </div>
      <div className="stack" style={{ '--gap': '32px' } as React.CSSProperties}>
        <section className="panel panel-pad stack" aria-labelledby="acct-h">
          <h2 id="acct-h" className="h3">Your account</h2>
          <dl className="ticket-dl">
            <div><dt>Name</dt><dd>{me.name}</dd></div>
            <div><dt>Role</dt><dd style={{ textTransform: 'capitalize' }}>{me.role}</dd></div>
            <div style={{ gridColumn: 'span 2' }}><dt>Email</dt><dd style={{ overflowWrap: 'anywhere' }}>{me.email}</dd></div>
          </dl>
          {me.isDemo ? <Alert tone="info">This is a shared demo account, so its password can’t be changed.</Alert> : <PasswordForm />}
        </section>
        {me.role !== 'operator' && <Team me={me} />}
        <section className="panel panel-pad stack" aria-labelledby="dev-h">
          <h2 id="dev-h" className="h3 row" style={{ '--gap': '8px' } as React.CSSProperties}><MonitorSmartphone size={18} aria-hidden="true" /> Using GateGuard at the gate</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            <li>Install the app: in Chrome or Edge use <em>Install app</em> from the address bar; on iPhone use Safari’s <em>Share → Add to Home Screen</em>.</li>
            <li>Open the event’s scanner once while online — it caches the signature key and an offline pack of ticket statuses.</li>
            <li>If the network drops, keep scanning. Admits are marked provisional and sync automatically when the connection returns.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

function PasswordForm() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password', { body: { current, next } });
      setCurrent('');
      setNext('');
      toast('Password changed', 'admit');
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-grid two" onSubmit={submit} noValidate>
      {error && !Object.keys(error.fields).length && <div className="span-2"><Alert tone="deny">{error.message}</Alert></div>}
      <Field label="Current password" error={error?.fields.current}>
        {(p) => <input {...p} className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
      </Field>
      <Field label="New password" error={error?.fields.next} hint="At least 10 characters.">
        {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
      </Field>
      <div className="span-2 row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-dark" disabled={busy || !current || !next}>{busy ? <Spinner /> : 'Change password'}</button>
      </div>
    </form>
  );
}

function Team({ me }: { me: User }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api<{ users: User[] }>('/users').then((r) => r.users) });
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'operator' as Role });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/users', { body: f });
      toast(`Account created for ${f.email}. Share the password with them securely.`, 'admit');
      setF({ name: '', email: '', password: '', role: 'operator' });
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(u: User) {
    try {
      await api(`/users/${u.id}`, { method: 'PATCH', body: { disabled: !u.disabled } });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast(u.disabled ? `${u.name} re-enabled` : `${u.name} disabled — signed out on their next request`, 'admit');
    } catch (err) {
      toast(errorMessage(err), 'deny');
    }
  }

  return (
    <section className="panel panel-pad stack" aria-labelledby="team-h" style={{ '--gap': '20px' } as React.CSSProperties}>
      <div className="stack" style={{ '--gap': '4px' } as React.CSSProperties}>
        <h2 id="team-h" className="h3 row" style={{ '--gap': '8px' } as React.CSSProperties}><ShieldCheck size={18} aria-hidden="true" /> Team accounts</h2>
        <p className="small muted">
          {me.role === 'admin'
            ? 'Admins can create organizers and operators. There is no public sign-up.'
            : 'Create gate operator accounts, then assign them to events under Gate staff.'}
        </p>
      </div>
      {me.isDemo ? (
        <Alert tone="info">Demo accounts can’t create users. Sign in with a real organizer account to manage a team.</Alert>
      ) : (
        <form className="form-grid two wash" style={{ padding: 16 }} onSubmit={create} noValidate>
          {error && !Object.keys(error.fields).length && <div className="span-2"><Alert tone="deny">{error.message}</Alert></div>}
          <Field label="Name" error={error?.fields.name}>{(p) => <input {...p} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Email" error={error?.fields.email}>{(p) => <input {...p} className="input" type="email" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
          <Field label="Temporary password" error={error?.fields.password} hint="At least 10 characters.">
            {(p) => <input {...p} className="input" type="text" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}
          </Field>
          <Field label="Role">
            {(p) => (
              <select {...p} className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })} disabled={me.role !== 'admin'}>
                <option value="operator">Gate operator</option>
                {me.role === 'admin' && <option value="organizer">Organizer</option>}
                {me.role === 'admin' && <option value="admin">Admin</option>}
              </select>
            )}
          </Field>
          <div className="span-2 row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-dark" disabled={busy}>{busy ? <Spinner /> : <><UserPlus aria-hidden="true" /> Create account</>}</button>
          </div>
        </form>
      )}
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <ul className="list">
          {q.data!.map((u) => (
            <li key={u.id} className="spread">
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ '--gap': '6px' } as React.CSSProperties}>
                  <span style={{ fontWeight: 500 }}>{u.name}</span>
                  <span className="badge">{u.role}</span>
                  {u.isDemo && <span className="badge badge-caution">Demo</span>}
                  {u.disabled && <span className="badge badge-deny">Disabled</span>}
                </div>
                <div className="xs muted" style={{ overflowWrap: 'anywhere' }}>{u.email}</div>
              </div>
              {!me.isDemo && u.id !== me.id && (
                <button className={`btn btn-sm ${u.disabled ? 'btn-outline' : 'btn-danger'}`} onClick={() => toggle(u)}>
                  {u.disabled ? 'Re-enable' : 'Disable'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
