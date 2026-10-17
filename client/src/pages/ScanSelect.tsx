import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarX2, ScanLine } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState, ErrorState, fmtDateTime, LoadingBlock, PhaseBadge, eventPhase } from '../components/ui';
import { api } from '../lib/api';
import type { EventSummary } from '../lib/types';

export default function ScanSelect() {
  const q = useQuery({ queryKey: ['events'], queryFn: () => api<{ events: EventSummary[] }>('/events').then((r) => r.events) });
  const events = (q.data ?? [])
    .filter((e) => eventPhase(e).tone !== 'ended')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return (
    <div className="container page">
      <div className="page-head">
        <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
          <div className="eyebrow">Gate scanner</div>
          <h1 className="h1">Choose an event to scan</h1>
          <p className="muted">You’ll only see events you’re assigned to. Pick your gate on the next screen.</p>
        </div>
      </div>
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : events.length === 0 ? (
        <EmptyState icon={CalendarX2} title="No live or upcoming events">
          Ask the organizer to add you as gate staff for their event.
        </EmptyState>
      ) : (
        <ul className="list panel" style={{ padding: '0 20px' }}>
          {events.map((e) => (
            <li key={e.id} className="spread" style={{ padding: '16px 0' }}>
              <div className="stack" style={{ '--gap': '4px', minWidth: 0 } as React.CSSProperties}>
                <div className="row" style={{ '--gap': '8px' } as React.CSSProperties}>
                  <PhaseBadge e={e} />
                  <span className="xs muted">{fmtDateTime(e.startsAt)} · {e.venue}</span>
                </div>
                <h2 className="h3">{e.name}</h2>
                <span className="xs muted num">
                  {e.checkedIn} / {e.registered} checked in · {e.gates.length} gate{e.gates.length > 1 ? 's' : ''}
                </span>
              </div>
              <Link to={`/app/scan/${e.id}`} className="btn btn-primary">
                <ScanLine aria-hidden="true" /> Open scanner <ArrowRight aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
