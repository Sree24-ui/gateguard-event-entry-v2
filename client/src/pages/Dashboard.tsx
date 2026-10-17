import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarPlus, ScanLine, TriangleAlert, Info } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState, ErrorState, LoadingBlock, Metric, PhaseBadge, ResultBadge, fmtDateTime, timeAgo } from '../components/ui';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import type { EventSummary, ScanResult, ScanRow } from '../lib/types';
import { useOnline } from '../lib/useOnline';
import { RESULT_ORDER, VERDICTS } from '../lib/verdicts';

interface DashboardData {
  events: EventSummary[];
  totals: { registered: number; checkedIn: number };
  lastHour: Record<ScanResult, number>;
  recentScans: ScanRow[];
  alerts: { level: 'warning' | 'info'; eventId: string; message: string }[];
}

export default function Dashboard() {
  const { data: me } = useMe();
  const online = useOnline();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardData>('/dashboard'), refetchInterval: online ? 5000 : false });
  const manager = me?.role !== 'operator';

  return (
    <div className="container page">
      <div className="page-head">
        <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
          <div className="eyebrow">Overview</div>
          <h1 className="h1">Hello, {me?.name.split(' ')[0]}</h1>
        </div>
        <div className="row">
          <Link to="/app/scan" className="btn btn-outline">
            <ScanLine aria-hidden="true" /> Open scanner
          </Link>
          {manager && (
            <Link to="/app/events/new" className="btn btn-primary">
              <CalendarPlus aria-hidden="true" /> New event
            </Link>
          )}
        </div>
      </div>

      {q.isLoading ? (
        <LoadingBlock rows={6} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Body data={q.data!} manager={manager} />
      )}
    </div>
  );
}

function Body({ data, manager }: { data: DashboardData; manager: boolean }) {
  const { totals, events } = data;
  const live = events.filter((e) => new Date(e.startsAt) <= new Date() && new Date(e.endsAt) > new Date());
  const upcoming = events.filter((e) => new Date(e.startsAt) > new Date());
  const rejectedLastHour = RESULT_ORDER.filter((r) => r !== 'accepted').reduce((n, r) => n + data.lastHour[r], 0);

  if (events.length === 0) {
    return (
      <EmptyState
        icon={CalendarPlus}
        title={manager ? 'Create your first event' : 'No events assigned yet'}
        action={manager ? <Link className="btn btn-primary" to="/app/events/new">Create event</Link> : undefined}
      >
        {manager
          ? 'Set the venue, time, capacity and gates. You’ll get a public registration link to share with attendees.'
          : 'An organizer needs to add you as gate staff before events show up here.'}
      </EmptyState>
    );
  }

  return (
    <div className="stack" style={{ '--gap': '32px' } as React.CSSProperties}>
      {data.alerts.length > 0 && (
        <section className="stack" style={{ '--gap': '8px' } as React.CSSProperties} aria-label="Operational alerts">
          {data.alerts.map((a, i) => (
            <Link key={i} to={`/app/events/${a.eventId}`} className={`alert ${a.level === 'warning' ? 'alert-caution' : 'alert-info'}`} style={{ textDecoration: 'none' }}>
              {a.level === 'warning' ? <TriangleAlert aria-hidden="true" /> : <Info aria-hidden="true" />}
              <span style={{ flex: 1 }}>{a.message}</span>
              <ArrowRight aria-hidden="true" />
            </Link>
          ))}
        </section>
      )}

      <section className="metrics" aria-label="Totals across your events">
        <Metric label="Registrations" value={totals.registered} sub={`${events.length} event${events.length === 1 ? '' : 's'}`} />
        <Metric live label="Checked in" value={totals.checkedIn} sub={`${totals.registered - totals.checkedIn} not yet arrived`} />
        <Metric
          label="Attendance"
          value={`${totals.registered ? Math.round((totals.checkedIn / totals.registered) * 100) : 0}%`}
          sub="Across all your events"
        />
        <Metric label="Rejected · last hour" value={rejectedLastHour} sub={`${data.lastHour.duplicate} duplicate · ${data.lastHour.tampered} forged`} />
      </section>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', '--gap': '24px' } as React.CSSProperties}>
        <section className="stack" aria-labelledby="ev-h">
          <div className="spread">
            <h2 id="ev-h" className="h3">
              {live.length ? 'Live now' : 'Upcoming'}
            </h2>
            <Link to="/app/events" className="small">
              All events
            </Link>
          </div>
          <ul className="list panel" style={{ padding: '0 20px' }}>
            {(live.length ? live : upcoming.length ? upcoming : events).slice(0, 5).map((e) => (
              <li key={e.id}>
                <Link to={`/app/events/${e.id}`} style={{ textDecoration: 'none' }} className="stack">
                  <div className="spread">
                    <span style={{ fontWeight: 500 }}>{e.name}</span>
                    <PhaseBadge e={e} />
                  </div>
                  <div className="progress" role="progressbar" aria-label={`${e.name} attendance`} aria-valuenow={e.attendancePct} aria-valuemin={0} aria-valuemax={100}>
                    <span style={{ width: `${e.attendancePct}%` }} />
                  </div>
                  <span className="xs muted num">
                    {e.checkedIn} of {e.registered} checked in · {e.attendancePct}% · {fmtDateTime(e.startsAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="stack" aria-labelledby="scans-h">
          <div className="spread">
            <h2 id="scans-h" className="h3">
              Recent gate activity
            </h2>
            <span className="xs muted">Updates every 5s</span>
          </div>
          {data.recentScans.length === 0 ? (
            <EmptyState icon={ScanLine} title="No scans yet">
              Scans from every gate appear here as they happen.
            </EmptyState>
          ) : (
            <ul className="list panel" style={{ padding: '0 20px' }}>
              {data.recentScans.map((s) => (
                <li key={s.scanId} className="spread" style={{ flexWrap: 'nowrap' }}>
                  <div className="stack" style={{ '--gap': '4px', minWidth: 0 } as React.CSSProperties}>
                    <ResultBadge result={s.result} conflict={s.conflict} />
                    <span className="xs muted" style={{ overflowWrap: 'anywhere' }}>
                      {s.event} · {s.gate} · {s.operator}
                    </span>
                  </div>
                  <span className="xs muted" style={{ flex: 'none' }} title={VERDICTS[s.result].help}>
                    {timeAgo(s.receivedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
