import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, CalendarSearch, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { EmptyState, ErrorState, LoadingBlock, PhaseBadge, eventPhase, fmtDateTime } from '../components/ui';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import type { EventSummary } from '../lib/types';

const FILTERS = ['all', 'live', 'upcoming', 'ended'] as const;

export default function Events() {
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ['events'], queryFn: () => api<{ events: EventSummary[] }>('/events').then((r) => r.events), refetchInterval: 10_000 });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const term = search.trim().toLowerCase();
  const events = (q.data ?? []).filter(
    (e) => (filter === 'all' || eventPhase(e).tone === filter) && (!term || `${e.name} ${e.venue}`.toLowerCase().includes(term)),
  );

  return (
    <div className="container page">
      <div className="page-head">
        <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
          <div className="eyebrow">Events</div>
          <h1 className="h1">Your events</h1>
        </div>
        {me?.role !== 'operator' && (
          <Link to="/app/events/new" className="btn btn-primary">
            <CalendarPlus aria-hidden="true" /> New event
          </Link>
        )}
      </div>

      <div className="spread" style={{ marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 380 }}>
          <Search size={16} aria-hidden="true" style={{ position: 'absolute', left: 14, top: 14, color: 'var(--ash)' }} />
          <label htmlFor="ev-search" className="sr-only">Search events</label>
          <input id="ev-search" className="input" style={{ paddingLeft: 38 }} placeholder="Search by name or venue" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="segmented" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <LoadingBlock rows={6} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : events.length === 0 ? (
        <EmptyState icon={CalendarSearch} title={q.data!.length ? 'No events match' : 'No events yet'}>
          {q.data!.length ? 'Try a different search or filter.' : me?.role === 'operator' ? 'You haven’t been assigned to any event yet.' : 'Create an event to start taking registrations.'}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table stackable">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Status</th>
                <th scope="col">Starts</th>
                <th scope="col" style={{ textAlign: 'right' }}>Registered</th>
                <th scope="col" style={{ textAlign: 'right' }}>Checked in</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link to={`/app/events/${e.id}`} style={{ fontWeight: 500 }}>{e.name}</Link>
                    <div className="xs muted">{e.venue}</div>
                  </td>
                  <td><PhaseBadge e={e} /></td>
                  <td data-hide-sm className="small">{fmtDateTime(e.startsAt)}</td>
                  <td data-hide-sm className="num" style={{ textAlign: 'right' }}>
                    {e.registered}{e.capacity ? <span className="muted"> / {e.capacity}</span> : null}
                  </td>
                  <td className="num xs" style={{ textAlign: 'right' }}>
                    {e.checkedIn} · {e.attendancePct}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
