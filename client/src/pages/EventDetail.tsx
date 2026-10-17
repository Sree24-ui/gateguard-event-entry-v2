import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  Copy,
  Download,
  ExternalLink,
  Pencil,
  RotateCcw,
  ScanLine,
  Search,
  Ticket,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  Alert,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  Metric,
  PhaseBadge,
  ResultBadge,
  Spinner,
  StatusBadge,
  fmtClock,
  fmtDate,
  fmtDateTime,
  fmtTime,
  timeAgo,
  useToast,
} from '../components/ui';
import { api, ApiError, errorMessage } from '../lib/api';
import type { Attendee, EventStats, EventSummary, PageOf, ScanResult, ScanRow, User } from '../lib/types';
import { useOnline } from '../lib/useOnline';
import { RESULT_ORDER, VERDICTS } from '../lib/verdicts';

type Tab = 'live' | 'attendees' | 'scans' | 'team';

export default function EventDetail() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const q = useQuery({ queryKey: ['event', id], queryFn: () => api<{ event: EventSummary }>(`/events/${id}`).then((r) => r.event) });
  if (q.isLoading) return <div className="container page"><LoadingBlock rows={8} /></div>;
  if (q.error || !q.data) return <div className="container page"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const e = q.data;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'live', label: 'Live attendance' },
    ...(e.canManage ? [{ id: 'attendees' as Tab, label: 'Attendees' }] : []),
    { id: 'scans', label: 'Scan log' },
    ...(e.canManage ? [{ id: 'team' as Tab, label: 'Gate staff' }] : []),
  ];
  const tab = (tabs.find((t) => t.id === params.get('tab'))?.id ?? 'live') as Tab;
  const regLink = `${location.origin}/e/${e.slug}`;

  return (
    <div className="container page">
      <Link to="/app/events" className="xs muted row" style={{ textDecoration: 'none', '--gap': '4px', marginBottom: 12 } as React.CSSProperties}>
        <ArrowLeft size={14} aria-hidden="true" /> Events
      </Link>
      <div className="page-head" style={{ marginBottom: 16 }}>
        <div className="stack" style={{ '--gap': '8px', minWidth: 0 } as React.CSSProperties}>
          <div className="row" style={{ '--gap': '8px' } as React.CSSProperties}>
            <PhaseBadge e={e} />
            {e.isDemo && <span className="badge badge-caution">Demo data</span>}
            {!e.registrationOpen && <span className="badge">Registration closed</span>}
          </div>
          <h1 className="h1">{e.name}</h1>
          <p className="muted small">
            {fmtDate(e.startsAt)} · {fmtClock(e.startsAt)}–{fmtClock(e.endsAt)} · {e.venue}
          </p>
        </div>
        <div className="row">
          {e.canManage && (
            <Link to={`/app/events/${id}/edit`} className="btn btn-outline">
              <Pencil aria-hidden="true" /> Edit
            </Link>
          )}
          <Link to={`/app/scan/${id}`} className="btn btn-primary">
            <ScanLine aria-hidden="true" /> Open scanner
          </Link>
        </div>
      </div>

      {e.canManage && (
        <div className="wash row" style={{ padding: '10px 12px', marginBottom: 24, '--gap': '8px' } as React.CSSProperties}>
          <span className="xs muted">Registration link</span>
          <code className="mono xs" style={{ overflowWrap: 'anywhere', flex: '1 1 200px' }}>{regLink}</code>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => navigator.clipboard.writeText(regLink).then(() => toast('Link copied', 'admit'), () => toast('Copy failed — select the link manually', 'deny'))}
          >
            <Copy aria-hidden="true" /> Copy
          </button>
          <a className="btn btn-ghost btn-sm" href={`/e/${e.slug}`} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden="true" /> Open
          </a>
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="Event sections" style={{ marginBottom: 24 }}>
        {tabs.map((t) => (
          <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setParams({ tab: t.id }, { replace: true })}>
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'live' && <LiveTab id={id} />}
        {tab === 'attendees' && <AttendeesTab event={e} />}
        {tab === 'scans' && <ScansTab event={e} />}
        {tab === 'team' && <TeamTab event={e} />}
      </div>
    </div>
  );
}

// ---------------- live ----------------

function LiveTab({ id }: { id: string }) {
  const online = useOnline();
  const q = useQuery({ queryKey: ['stats', id], queryFn: () => api<EventStats>(`/events/${id}/stats`), refetchInterval: online ? 3000 : false });
  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const rejected = RESULT_ORDER.filter((r) => r !== 'accepted').reduce((n, r) => n + s.scansByResult[r], 0);
  const maxGate = Math.max(1, ...s.byGate.map((g) => g.checkedIn));

  return (
    <div className="stack" style={{ '--gap': '24px' } as React.CSSProperties}>
      <div className="spread">
        <span className="xs muted row" style={{ '--gap': '6px' } as React.CSSProperties}>
          <span className="dot dot-pulse" style={{ color: online ? 'var(--admit)' : 'var(--deny)' }} aria-hidden="true" />
          {online ? `Live · refreshed ${timeAgo(s.generatedAt)}` : 'Offline — showing last known numbers'}
        </span>
      </div>
      <section className="metrics" aria-label="Attendance">
        <Metric label="Registered" value={s.registered} sub={s.cancelled ? `${s.cancelled} cancelled (excluded)` : 'Active tickets'} />
        <Metric live label="Checked in" value={s.checkedIn} sub="Official, server-verified" />
        <Metric label="Remaining" value={s.remaining} sub="Registered, not yet arrived" />
        <Metric label="Attendance" value={`${s.attendancePct}%`} sub={<div className="progress" style={{ marginTop: 8 }}><span style={{ width: `${s.attendancePct}%` }} /></div>} />
      </section>

      {s.offlineConflicts > 0 && (
        <Alert tone="caution">
          {s.offlineConflicts} offline scan{s.offlineConflicts > 1 ? 's were' : ' was'} provisionally admitted at a gate but rejected on sync (usually the same
          ticket used at two offline gates). Review them in the scan log.
        </Alert>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', '--gap': '24px' } as React.CSSProperties}>
        <section className="panel panel-pad stack" aria-labelledby="tl-h">
          <div>
            <h2 id="tl-h" className="h3">Check-ins over time</h2>
            <p className="xs muted">Official check-ins per 15 minutes</p>
          </div>
          <Timeline data={s.timeline} />
        </section>

        <section className="panel panel-pad stack" aria-labelledby="gate-h">
          <h2 id="gate-h" className="h3">By gate</h2>
          {s.byGate.length === 0 ? (
            <p className="small muted">No check-ins yet.</p>
          ) : (
            <ul className="list">
              {s.byGate.map((g) => (
                <li key={g.gate} className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
                  <div className="spread small">
                    <span>{g.gate}</span>
                    <span className="num" style={{ fontWeight: 500 }}>{g.checkedIn}</span>
                  </div>
                  <div className="progress" aria-hidden="true"><span style={{ width: `${(g.checkedIn / maxGate) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel panel-pad stack" aria-labelledby="res-h">
          <div className="spread">
            <h2 id="res-h" className="h3">Scan outcomes</h2>
            <span className="xs muted num">{rejected} rejected</span>
          </div>
          <ul className="list">
            {RESULT_ORDER.map((r) => (
              <li key={r} className="spread" title={VERDICTS[r].help}>
                <ResultBadge result={r} />
                <span className="num small" style={{ fontWeight: 500 }}>{s.scansByResult[r]}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel panel-pad stack" aria-labelledby="rc-h">
          <h2 id="rc-h" className="h3">Latest arrivals</h2>
          {s.recentCheckins.length === 0 ? (
            <p className="small muted">Nobody has checked in yet.</p>
          ) : (
            <ul className="list">
              {s.recentCheckins.map((c) => (
                <li key={c.code} className="spread" style={{ flexWrap: 'nowrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="small" style={{ fontWeight: 500 }}>{c.name}</div>
                    <div className="xs muted">{c.affiliation} · {c.gate}</div>
                  </div>
                  <span className="xs muted mono" style={{ flex: 'none' }}>{fmtTime(c.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Timeline({ data }: { data: { at: string; checkedIn: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return <p className="small muted">The chart fills in as people arrive.</p>;
  // Fill gaps so time reads linearly.
  const step = 15 * 60_000;
  const start = new Date(data[0].at).getTime();
  const end = new Date(data[data.length - 1].at).getTime();
  const byTime = new Map(data.map((d) => [new Date(d.at).getTime(), d.checkedIn]));
  const bins: { t: number; n: number }[] = [];
  for (let t = start; t <= end && bins.length < 96; t += step) bins.push({ t, n: byTime.get(t) ?? 0 });
  const max = Math.max(...bins.map((b) => b.n));
  const H = 140;
  const label = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (
    <div>
      <div style={{ position: 'relative', height: H + 24 }}>
        <div className="xs muted mono" style={{ position: 'absolute', right: 0, top: -4 }}>peak {max}</div>
        <div style={{ position: 'absolute', inset: '12px 0 24px', display: 'flex', alignItems: 'flex-end', gap: 2, borderBottom: '1px solid var(--line)' }}>
          {bins.map((b, i) => (
            <div
              key={b.t}
              tabIndex={0}
              aria-label={`${label(b.t)}: ${b.n} check-ins`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', position: 'relative', cursor: 'default', maxWidth: 40 }}
            >
              <div style={{ width: '100%', height: `${(b.n / max) * 100}%`, minHeight: b.n ? 2 : 0, background: hover === i ? 'var(--ink-2)' : 'var(--ink)', borderRadius: '4px 4px 0 0' }} />
              {hover === i && (
                <div className="toast" style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6, whiteSpace: 'nowrap', padding: '6px 10px', fontSize: 12, zIndex: 2, animation: 'none' }}>
                  {label(b.t)} · {b.n}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="xs muted mono" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'space-between' }}>
          <span>{label(bins[0].t)}</span>
          {bins.length > 1 && <span>{label(bins[bins.length - 1].t)}</span>}
        </div>
      </div>
      <table className="sr-only">
        <caption>Check-ins per 15 minutes</caption>
        <tbody>
          {bins.map((b) => (
            <tr key={b.t}><th scope="row">{label(b.t)}</th><td>{b.n}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- attendees ----------------

function AttendeesTab({ event }: { event: EventSummary }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | Attendee['status']>('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirm, setConfirm] = useState<Attendee | null>(null);
  const qs = new URLSearchParams({ page: String(page), ...(search.trim() && { q: search.trim() }), ...(status && { status }) });
  const q = useQuery({
    queryKey: ['attendees', event.id, qs.toString()],
    queryFn: () => api<PageOf<'attendees', Attendee>>(`/events/${event.id}/attendees?${qs}`),
    placeholderData: (prev) => prev,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['attendees', event.id] });
    qc.invalidateQueries({ queryKey: ['event', event.id] });
    qc.invalidateQueries({ queryKey: ['stats', event.id] });
  };

  async function toggleCancel(a: Attendee) {
    try {
      await api(`/events/${event.id}/attendees/${a.code}`, { method: 'PATCH', body: { status: a.status === 'cancelled' ? 'valid' : 'cancelled' } });
      toast(a.status === 'cancelled' ? 'Ticket reinstated' : 'Ticket cancelled — it will be rejected at the gate', 'admit');
      refresh();
    } catch (e) {
      toast(errorMessage(e), 'deny');
    } finally {
      setConfirm(null);
    }
  }

  const data = q.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="stack">
      <div className="spread">
        <div className="row" style={{ flex: '1 1 320px' }}>
          <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 340 }}>
            <Search size={16} aria-hidden="true" style={{ position: 'absolute', left: 14, top: 14, color: 'var(--ash)' }} />
            <label htmlFor="att-search" className="sr-only">Search attendees</label>
            <input id="att-search" className="input" style={{ paddingLeft: 38 }} placeholder="Name, email, college or code" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <label htmlFor="att-status" className="sr-only">Filter by status</label>
          <select id="att-status" className="select" style={{ width: 'auto' }} value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }}>
            <option value="">All statuses</option>
            <option value="valid">Not arrived</option>
            <option value="checked_in">Checked in</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="row" style={{ '--gap': '8px' } as React.CSSProperties}>
          <a className="btn btn-ghost btn-sm" href={`/api/events/${event.id}/export/attendees.csv`} download>
            <Download aria-hidden="true" /> Export CSV
          </a>
          <button className="btn btn-outline btn-sm" onClick={() => setImporting(true)}>
            <Upload aria-hidden="true" /> Import CSV
          </button>
          <button className="btn btn-dark btn-sm" onClick={() => setAdding(true)}>
            <UserPlus aria-hidden="true" /> Add attendee
          </button>
        </div>
      </div>

      {q.isLoading ? (
        <LoadingBlock rows={6} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : data!.attendees.length === 0 ? (
        <EmptyState icon={Users} title={search || status ? 'No matching attendees' : 'No registrations yet'}>
          {search || status ? 'Try a different search or filter.' : 'Share the registration link, add people manually, or import a CSV.'}
        </EmptyState>
      ) : (
        <>
          <div className="table-wrap" aria-busy={q.isFetching}>
            <table className="table stackable">
              <thead>
                <tr>
                  <th scope="col">Attendee</th>
                  <th scope="col">Ticket code</th>
                  <th scope="col">Status</th>
                  <th scope="col">Checked in</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data!.attendees.map((a) => (
                  <tr key={a.code}>
                    <td style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>{a.name}</div>
                      <div className="xs muted" style={{ overflowWrap: 'anywhere' }}>{a.email}{a.affiliation && ` · ${a.affiliation}`}</div>
                    </td>
                    <td data-hide-sm className="mono xs">{a.code}</td>
                    <td><StatusBadge status={a.status} /></td>
                    <td data-hide-sm className="xs muted">{a.checkedInAt ? `${fmtDateTime(a.checkedInAt)} · ${a.checkedInGate}` : '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="row" style={{ justifyContent: 'flex-end', '--gap': '2px', flexWrap: 'nowrap' } as React.CSSProperties}>
                        <a className="btn btn-ghost btn-sm icon-btn" href={`/t/${a.code}`} target="_blank" rel="noreferrer" aria-label={`Open ticket for ${a.name}`} title="Open ticket">
                          <Ticket aria-hidden="true" />
                        </a>
                        {a.status !== 'checked_in' && (
                          <button className="btn btn-ghost btn-sm icon-btn" onClick={() => setConfirm(a)} aria-label={a.status === 'cancelled' ? `Reinstate ${a.name}` : `Cancel ticket for ${a.name}`} title={a.status === 'cancelled' ? 'Reinstate' : 'Cancel ticket'}>
                            {a.status === 'cancelled' ? <RotateCcw aria-hidden="true" /> : <Ban aria-hidden="true" />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pages={pages} total={data!.total} onPage={setPage} />
        </>
      )}

      <Dialog open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.status === 'cancelled' ? 'Reinstate this ticket?' : 'Cancel this ticket?'}>
        {confirm && (
          <>
            <p className="small">
              {confirm.status === 'cancelled'
                ? `${confirm.name}’s ticket ${confirm.code} becomes valid again and can be used once at the gate.`
                : `${confirm.name}’s ticket ${confirm.code} will be rejected at every gate. You can reinstate it later.`}
            </p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setConfirm(null)}>Keep as is</button>
              <button className={`btn ${confirm.status === 'cancelled' ? 'btn-dark' : 'btn-danger'}`} onClick={() => toggleCancel(confirm)}>
                {confirm.status === 'cancelled' ? 'Reinstate ticket' : 'Cancel ticket'}
              </button>
            </div>
          </>
        )}
      </Dialog>
      <AddAttendeeDialog open={adding} onClose={() => setAdding(false)} eventId={event.id} onDone={refresh} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} eventId={event.id} onDone={refresh} />
    </div>
  );
}

function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  return (
    <div className="spread small muted">
      <span className="num">{total} total</span>
      {pages > 1 && (
        <div className="row" style={{ '--gap': '8px' } as React.CSSProperties}>
          <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
          <span className="num">Page {page} of {pages}</span>
          <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

function AddAttendeeDialog({ open, onClose, eventId, onDone }: { open: boolean; onClose: () => void; eventId: string; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', email: '', affiliation: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { attendee } = await api<{ attendee: Attendee }>(`/events/${eventId}/attendees`, { body: f });
      toast(`Ticket ${attendee.code} issued`, 'admit');
      setF({ name: '', email: '', affiliation: '' });
      onDone();
      onClose();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Add attendee">
      <form className="stack" onSubmit={submit} noValidate>
        {error && !Object.keys(error.fields).length && <Alert tone="deny">{error.message}</Alert>}
        <Field label="Full name" error={error?.fields.name}>{(p) => <input {...p} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Email" error={error?.fields.email}>{(p) => <input {...p} className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label="College / department (optional)" error={error?.fields.affiliation}>{(p) => <input {...p} className="input" value={f.affiliation} onChange={(e) => setF({ ...f, affiliation: e.target.value })} />}</Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-dark" disabled={busy}>{busy ? <Spinner /> : 'Issue ticket'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function ImportDialog({ open, onClose, eventId, onDone }: { open: boolean; onClose: () => void; eventId: string; onDone: () => void }) {
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; failed: number; errors: { row: number; message: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ created: number; failed: number; errors: { row: number; message: string }[] }>(`/events/${eventId}/attendees/import`, { body: { csv } });
      setResult(r);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const close = () => {
    setResult(null);
    setCsv('');
    setError(null);
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title="Import attendees from CSV">
      {result ? (
        <div className="stack">
          <Alert tone={result.failed ? 'caution' : 'admit'}>
            {result.created} ticket{result.created === 1 ? '' : 's'} issued{result.failed ? `, ${result.failed} row${result.failed === 1 ? '' : 's'} skipped` : ''}.
          </Alert>
          {result.errors.length > 0 && (
            <ul className="list xs" style={{ maxHeight: 200, overflowY: 'auto' }}>
              {result.errors.map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}
            </ul>
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-dark" onClick={close}>Done</button></div>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <p className="small muted">First row must be a header with <code className="mono">name</code> and <code className="mono">email</code>; <code className="mono">affiliation</code> is optional. Up to 2000 rows. Duplicate emails are skipped.</p>
          <div className="field">
            <label className="label" htmlFor="csv-file">Choose a file</label>
            <input id="csv-file" type="file" accept=".csv,text/csv" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setCsv(await file.text()); }} />
          </div>
          <Field label="…or paste CSV">
            {(p) => <textarea {...p} className="textarea mono xs" rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'name,email,affiliation\nAsha Rao,asha@college.edu,CSE'} />}
          </Field>
          {error && <Alert tone="deny">{error}</Alert>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
            <button className="btn btn-dark" disabled={busy || !csv.trim()}>{busy ? <Spinner /> : 'Import'}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

// ---------------- scans ----------------

function ScansTab({ event }: { event: EventSummary }) {
  const [result, setResult] = useState<ScanResult | 'conflict' | ''>('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), ...(result === 'conflict' ? { conflict: '1' } : result ? { result } : {}) });
  const online = useOnline();
  const q = useQuery({
    queryKey: ['scans', event.id, qs.toString()],
    queryFn: () => api<PageOf<'scans', ScanRow>>(`/events/${event.id}/scans?${qs}`),
    refetchInterval: online && page === 1 ? 5000 : false,
    placeholderData: (prev) => prev,
  });
  const filters: { v: typeof result; label: string }[] = [
    { v: '', label: 'All' },
    { v: 'accepted', label: 'Admitted' },
    { v: 'duplicate', label: 'Duplicates' },
    { v: 'tampered', label: 'Forged' },
    { v: 'wrong_event', label: 'Wrong event' },
    { v: 'unknown', label: 'Unknown' },
    { v: 'conflict', label: 'Offline conflicts' },
  ];
  return (
    <div className="stack">
      <div className="spread">
        <div className="segmented" role="group" aria-label="Filter scans">
          {filters.map((f) => (
            <button key={f.v} aria-pressed={result === f.v} onClick={() => { setResult(f.v); setPage(1); }}>{f.label}</button>
          ))}
        </div>
        {event.canManage && (
          <a className="btn btn-ghost btn-sm" href={`/api/events/${event.id}/export/scans.csv`} download>
            <Download aria-hidden="true" /> Export CSV
          </a>
        )}
      </div>
      {q.isLoading ? (
        <LoadingBlock rows={6} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data!.scans.length === 0 ? (
        <EmptyState icon={ScanLine} title="No scans here yet">Every scan attempt — admitted or rejected — is recorded with gate, operator and time.</EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table stackable">
              <thead>
                <tr>
                  <th scope="col">Outcome</th>
                  <th scope="col">Ticket</th>
                  <th scope="col">Gate · operator</th>
                  <th scope="col">Scanned</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.scans.map((s) => (
                  <tr key={s.scanId}>
                    <td><ResultBadge result={s.result} conflict={s.conflict} /></td>
                    <td className="mono xs">{s.code ?? '—'}{s.method === 'manual' && <span className="muted"> · typed</span>}</td>
                    <td data-hide-sm className="xs">{s.gate} · {s.operator}{s.offline && <span className="badge badge-info" style={{ marginLeft: 6 }}>synced offline</span>}</td>
                    <td className="xs muted mono">{fmtDateTime(s.scannedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pages={Math.max(1, Math.ceil(q.data!.total / q.data!.pageSize))} total={q.data!.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

// ---------------- team ----------------

function TeamTab({ event }: { event: EventSummary }) {
  const qc = useQueryClient();
  const toast = useToast();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ users: User[] }>('/users').then((r) => r.users) });
  const [selected, setSelected] = useState<Set<string>>(new Set(event.staff));
  const [busy, setBusy] = useState(false);
  const candidates = (users.data ?? []).filter((u) => (u.role === 'operator' || u.role === 'organizer') && !u.disabled);
  const dirty = selected.size !== event.staff.length || event.staff.some((s) => !selected.has(s));

  async function save() {
    setBusy(true);
    try {
      await api(`/events/${event.id}/staff`, { method: 'PUT', body: { userIds: [...selected] } });
      qc.invalidateQueries({ queryKey: ['event', event.id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast('Gate staff updated', 'admit');
    } catch (e) {
      toast(errorMessage(e), 'deny');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <p className="muted small">
        Assigned operators can open this event’s scanner and see live counts. They can’t see attendee contact details or change the event.
        You (the organizer) can always scan your own events.
      </p>
      {users.isLoading ? (
        <LoadingBlock />
      ) : users.error ? (
        <ErrorState error={users.error} onRetry={() => users.refetch()} />
      ) : candidates.length === 0 ? (
        <EmptyState icon={Users} title="No gate operators yet" action={<Link to="/app/settings" className="btn btn-dark btn-sm">Create an operator account</Link>}>
          Create operator accounts in Settings, then assign them here.
        </EmptyState>
      ) : (
        <>
          <ul className="list panel" style={{ padding: '0 20px' }}>
            {candidates.map((u) => (
              <li key={u.id}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={selected.has(u.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(u.id);
                      else next.delete(u.id);
                      setSelected(next);
                    }}
                  />
                  <span>
                    <span style={{ fontWeight: 500 }}>{u.name}</span> <span className="badge">{u.role}</span>
                    <span className="xs muted" style={{ display: 'block' }}>{u.email}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <Link to="/app/settings" className="small">Create another operator</Link>
            <button className="btn btn-dark" disabled={!dirty || busy} onClick={save}>{busy ? <Spinner /> : 'Save staff'}</button>
          </div>
        </>
      )}
    </div>
  );
}
