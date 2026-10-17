import { useQuery } from '@tanstack/react-query';
import { Download, Printer, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { Alert, ErrorState, LoadingBlock, StatusBadge, fmtDate, fmtDateTime, fmtClock } from '../components/ui';
import { api, ApiError } from '../lib/api';
import type { PublicTicket } from '../lib/types';
import { PublicShell } from './Register';

const QR_OPTS = { errorCorrectionLevel: 'M' as const, margin: 2, color: { dark: '#0d0f0c', light: '#ffffff' } };

/** Renders a standalone PNG of the ticket (QR + essentials) for saving to the phone gallery. */
async function ticketPng(t: PublicTicket): Promise<Blob> {
  const W = 900;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  await document.fonts.ready;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#17191a';
  g.fillRect(0, 0, W, 300);
  g.fillStyle = '#dcf53c';
  g.font = '500 28px "Geist Mono Variable", monospace';
  g.fillText('GATEGUARD V2 · ADMIT ONE', 60, 80);
  g.fillStyle = '#ffffff';
  g.font = '500 54px "Geist Variable", sans-serif';
  wrap(g, t.event.name, 60, 160, W - 120, 62, 2);
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, t.qr, { ...QR_OPTS, width: 640 });
  g.drawImage(qr, (W - 640) / 2, 340);
  g.fillStyle = '#0d0f0c';
  g.textAlign = 'center';
  g.font = '600 46px "Geist Mono Variable", monospace';
  g.fillText(t.code, W / 2, 1040);
  g.textAlign = 'left';
  g.font = '500 40px "Geist Variable", sans-serif';
  g.fillText(t.name, 60, 1140);
  g.fillStyle = '#62645f';
  g.font = '400 30px "Geist Variable", sans-serif';
  g.fillText(`${fmtDate(t.event.startsAt)} · ${fmtClock(t.event.startsAt)}`, 60, 1200);
  g.fillText(t.event.venue, 60, 1250);
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number, lines: number) {
  const words = text.split(' ');
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > max && line) {
      g.fillText(line, x, y);
      y += lh;
      line = w;
      if (--lines === 1) break;
    } else line = test;
  }
  g.fillText(line, x, y);
}

export default function TicketPage() {
  const { code = '' } = useParams();
  const [params] = useSearchParams();
  const isNew = params.get('new') === '1';
  const q = useQuery({
    queryKey: ['ticket', code],
    queryFn: () => api<{ ticket: PublicTicket }>(`/public/tickets/${code}`).then((r) => r.ticket),
    retry: false,
    refetchInterval: (query) => (query.state.data?.status === 'valid' ? 15_000 : false),
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [saving, setSaving] = useState(false);
  const t = q.data;

  useEffect(() => {
    if (t && canvasRef.current) QRCode.toCanvas(canvasRef.current, t.qr, { ...QR_OPTS, width: 520 });
  }, [t]);

  if (q.isLoading) return <PublicShell><LoadingBlock rows={6} /></PublicShell>;
  if (q.error || !t) {
    return (
      <PublicShell>
        <ErrorState error={(q.error as ApiError)?.status === 404 ? new Error('No ticket matches this link. Check that you copied the full link.') : q.error} />
      </PublicShell>
    );
  }

  async function download() {
    setSaving(true);
    try {
      const url = URL.createObjectURL(await ticketPng(t!));
      const a = document.createElement('a');
      a.href = url;
      a.download = `ticket-${t!.code}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <PublicShell>
      <div className="split" style={{ alignItems: 'start', paddingTop: 16 }}>
        <div className="stack no-print" style={{ '--gap': '20px', order: 0 } as React.CSSProperties}>
          {isNew && (
            <Alert tone="admit">
              <strong>You’re registered.</strong> Save this ticket now — download the image or bookmark this page. You’ll show the QR at the gate.
            </Alert>
          )}
          <h1 className="h1">Your ticket</h1>
          <p className="muted">
            Show this QR code at the entrance. Each ticket admits one person, once — a screenshot works, but a second scan of the same ticket is
            rejected.
          </p>
          <div className="row">
            <button className="btn btn-primary" onClick={download} disabled={saving}>
              <Download aria-hidden="true" /> Download image
            </button>
            <button className="btn btn-outline" onClick={() => window.print()}>
              <Printer aria-hidden="true" /> Print
            </button>
          </div>
          <p className="xs muted row" style={{ '--gap': '6px', alignItems: 'flex-start', flexWrap: 'nowrap' } as React.CSSProperties}>
            <ShieldCheck size={16} aria-hidden="true" style={{ flex: 'none', marginTop: 1 }} />
            The QR holds a cryptographically signed ticket ID — no personal data. Altered or copied-and-edited codes are rejected.
          </p>
        </div>

        <article className="ticket" aria-label={`Ticket for ${t.event.name}`} style={{ justifySelf: 'center' }}>
          <div className="ticket-head stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            <div className="spread">
              <span className="eyebrow" style={{ color: 'var(--signal)' }}>Admit one</span>
              {t.event.isDemo && <span className="badge badge-caution">Demo</span>}
            </div>
            <h2 className="h2">{t.event.name}</h2>
          </div>
          <div className="ticket-qr">
            {t.status === 'checked_in' && (
              <Alert tone="admit">
                Checked in {t.checkedInAt ? fmtDateTime(t.checkedInAt) : ''}. Enjoy the event!
              </Alert>
            )}
            {t.status === 'cancelled' && <Alert tone="deny">This ticket was cancelled by the organizer and won’t be accepted.</Alert>}
            <canvas ref={canvasRef} role="img" aria-label={`QR code for ticket ${t.code}`} style={{ opacity: t.status === 'cancelled' ? 0.25 : 1 }} />
            <div className="code" aria-label="Ticket code">{t.code}</div>
          </div>
          <div className="ticket-perf" aria-hidden="true" />
          <div className="ticket-body">
            <dl className="ticket-dl">
              <div style={{ gridColumn: 'span 2' }}><dt>Attendee</dt><dd style={{ fontWeight: 500 }}>{t.name}</dd></div>
              <div><dt>Date</dt><dd>{fmtDate(t.event.startsAt)}</dd></div>
              <div><dt>Time</dt><dd>{fmtClock(t.event.startsAt)}</dd></div>
              <div style={{ gridColumn: 'span 2' }}><dt>Venue</dt><dd>{t.event.venue}</dd></div>
              <div><dt>Status</dt><dd><StatusBadge status={t.status} /></dd></div>
              <div><dt>Email</dt><dd className="small" style={{ overflowWrap: 'anywhere' }}>{t.email}</dd></div>
            </dl>
          </div>
        </article>
      </div>
    </PublicShell>
  );
}
