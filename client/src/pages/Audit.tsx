import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState, LoadingBlock, fmtDateTime } from '../components/ui';
import { api } from '../lib/api';
import type { PageOf } from '../lib/types';

interface Entry {
  id: string;
  action: string;
  at: string;
  actor: string | null;
  event: string | null;
  target: string | null;
  details: unknown;
}

const LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in',
  'auth.password_changed': 'Changed password',
  'user.created': 'Created user',
  'user.disabled': 'Disabled user',
  'user.enabled': 'Re-enabled user',
  'event.created': 'Created event',
  'event.updated': 'Edited event',
  'event.staff_updated': 'Changed gate staff',
  'attendee.added': 'Added attendee',
  'attendee.imported': 'Imported attendees',
  'ticket.cancelled': 'Cancelled ticket',
  'ticket.reinstated': 'Reinstated ticket',
  'export.downloaded': 'Exported data',
};

function describe(details: unknown) {
  if (!details || typeof details !== 'object') return '';
  if (Array.isArray(details)) return `fields: ${details.join(', ')}`;
  return Object.entries(details as Record<string, unknown>).map(([k, v]) => `${k}: ${v}`).join(' · ');
}

export default function Audit() {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['audit', page], queryFn: () => api<PageOf<'entries', Entry>>(`/audit?page=${page}`), placeholderData: (p) => p });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  return (
    <div className="container page">
      <div className="page-head">
        <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
          <div className="eyebrow">Audit log</div>
          <h1 className="h1">Administrative history</h1>
          <p className="muted">Sign-ins, event and ticket changes, staff assignments and data exports. Gate scans are in each event’s scan log.</p>
        </div>
      </div>
      {q.isLoading ? (
        <LoadingBlock rows={8} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data!.entries.length === 0 ? (
        <EmptyState icon={ScrollText} title="Nothing recorded yet" />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table stackable">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">By</th>
                  <th scope="col">Subject</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.entries.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <span style={{ fontWeight: 500, color: e.action === 'auth.login_failed' ? 'var(--deny)' : undefined }}>{LABELS[e.action] ?? e.action}</span>
                      {describe(e.details) && <div className="xs muted">{describe(e.details)}</div>}
                    </td>
                    <td className="small">{e.actor ?? <span className="muted">—</span>}</td>
                    <td data-hide-sm className="small" style={{ overflowWrap: 'anywhere' }}>
                      {[e.event, e.target].filter(Boolean).join(' · ') || <span className="muted">—</span>}
                    </td>
                    <td className="xs muted mono">{fmtDateTime(e.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <span className="small muted num">Page {page} of {pages}</span>
              <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
