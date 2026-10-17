import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Alert, ErrorState, Field, LoadingBlock, Spinner, useToast } from '../components/ui';
import { api, ApiError } from '../lib/api';
import type { EventSummary } from '../lib/types';

// <input type="datetime-local"> wants local time without a zone.
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function blank() {
  const start = new Date();
  start.setDate(start.getDate() + 7);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start);
  end.setHours(17);
  return { name: '', description: '', venue: '', startsAt: toLocalInput(start), endsAt: toLocalInput(end), capacity: '', registrationOpen: true, gates: ['Main gate'] };
}

export default function EventForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const existing = useQuery({
    queryKey: ['event', id],
    queryFn: () => api<{ event: EventSummary }>(`/events/${id}`).then((r) => r.event),
    enabled: editing,
  });
  const [form, setForm] = useState(blank);
  const [newGate, setNewGate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    const e = existing.data;
    if (e) {
      setForm({
        name: e.name,
        description: e.description,
        venue: e.venue,
        startsAt: toLocalInput(new Date(e.startsAt)),
        endsAt: toLocalInput(new Date(e.endsAt)),
        capacity: e.capacity ? String(e.capacity) : '',
        registrationOpen: e.registrationOpen,
        gates: e.gates,
      });
    }
  }, [existing.data]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const fe = error?.fields ?? {};

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...form,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : '',
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : '',
        capacity: form.capacity ? Number(form.capacity) : null,
      };
      const { event } = await api<{ event: EventSummary }>(editing ? `/events/${id}` : '/events', { method: editing ? 'PATCH' : 'POST', body });
      qc.invalidateQueries({ queryKey: ['events'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.setQueryData(['event', event.id], event);
      toast(editing ? 'Event saved' : 'Event created — share the registration link next', 'admit');
      navigate(`/app/events/${event.id}`);
    } catch (err) {
      setError(err as ApiError);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  }

  if (editing && existing.isLoading) return <div className="container page"><LoadingBlock rows={8} /></div>;
  if (editing && existing.error) return <div className="container page"><ErrorState error={existing.error} onRetry={() => existing.refetch()} /></div>;

  const addGate = () => {
    const g = newGate.trim();
    if (g && !form.gates.includes(g)) set('gates', [...form.gates, g]);
    setNewGate('');
  };

  return (
    <div className="container page" style={{ maxWidth: 820 }}>
      <Link to={editing ? `/app/events/${id}` : '/app/events'} className="xs muted row" style={{ textDecoration: 'none', '--gap': '4px', marginBottom: 12 } as React.CSSProperties}>
        <ArrowLeft size={14} aria-hidden="true" /> Back
      </Link>
      <div className="page-head">
        <h1 className="h1">{editing ? 'Edit event' : 'New event'}</h1>
      </div>
      <form onSubmit={submit} noValidate className="stack" style={{ '--gap': '24px' } as React.CSSProperties}>
        {error && <Alert tone="deny">{error.message}</Alert>}
        <section className="panel panel-pad form-grid two">
          <div className="span-2">
            <Field label="Event name" error={fe.name}>
              {(p) => <input {...p} className="input" required maxLength={120} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. TechNova Fest 2026" />}
            </Field>
          </div>
          <div className="span-2">
            <Field label="Venue" error={fe.venue}>
              {(p) => <input {...p} className="input" required maxLength={160} value={form.venue} onChange={(e) => set('venue', e.target.value)} placeholder="Building, hall or ground" />}
            </Field>
          </div>
          <Field label="Starts" error={fe.startsAt}>
            {(p) => <input {...p} className="input" type="datetime-local" required value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} />}
          </Field>
          <Field label="Ends" error={fe.endsAt}>
            {(p) => <input {...p} className="input" type="datetime-local" required value={form.endsAt} onChange={(e) => set('endsAt', e.target.value)} />}
          </Field>
          <div className="span-2">
            <Field label="Description" error={fe.description} hint="Shown on the public registration page.">
              {(p) => <textarea {...p} className="textarea" maxLength={2000} value={form.description} onChange={(e) => set('description', e.target.value)} />}
            </Field>
          </div>
        </section>

        <section className="panel panel-pad form-grid two">
          <Field label="Registration limit" error={fe.capacity} hint="Leave empty for no limit.">
            {(p) => <input {...p} className="input num" type="number" min={1} inputMode="numeric" value={form.capacity} onChange={(e) => set('capacity', e.target.value)} />}
          </Field>
          <div className="field" style={{ justifyContent: 'center' }}>
            <label className="checkbox">
              <input type="checkbox" checked={form.registrationOpen} onChange={(e) => set('registrationOpen', e.target.checked)} />
              <span>
                <span className="label">Registration open</span>
                <span className="hint" style={{ display: 'block' }}>Attendees can sign up from the public link.</span>
              </span>
            </label>
          </div>
          <div className="span-2 field">
            <span className="label" id="gates-l">Entry gates</span>
            <div className="row" aria-labelledby="gates-l" style={{ '--gap': '8px' } as React.CSSProperties}>
              {form.gates.map((g) => (
                <span key={g} className="badge" style={{ padding: '6px 6px 6px 10px', fontSize: 14 }}>
                  {g}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ minHeight: 24, padding: 2 }}
                    aria-label={`Remove ${g}`}
                    disabled={form.gates.length === 1}
                    onClick={() => set('gates', form.gates.filter((x) => x !== g))}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
            <div className="row" style={{ flexWrap: 'nowrap', maxWidth: 420 }}>
              <label htmlFor="new-gate" className="sr-only">New gate name</label>
              <input
                id="new-gate"
                className="input"
                placeholder="Add a gate, e.g. North entrance"
                maxLength={40}
                value={newGate}
                onChange={(e) => setNewGate(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addGate();
                  }
                }}
              />
              <button type="button" className="btn btn-outline" onClick={addGate} disabled={!newGate.trim()}>
                <Plus aria-hidden="true" /> Add
              </button>
            </div>
            {fe.gates && <span className="error-text">{fe.gates}</span>}
          </div>
        </section>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Link to={editing ? `/app/events/${id}` : '/app/events'} className="btn btn-ghost">Cancel</Link>
          <button className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? <Spinner label="Saving" /> : editing ? 'Save changes' : 'Create event'}
          </button>
        </div>
      </form>
    </div>
  );
}
