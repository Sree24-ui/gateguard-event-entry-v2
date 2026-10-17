import { AlertCircle, CheckCircle2, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { VERDICTS } from '../lib/verdicts';
import type { ScanResult } from '../lib/types';

export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="brand" aria-label="GateGuard V2 home">
      <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill="#16181a" />
        <path d="M18 14h28v6H24v24h16V34h-8v-6h14v22H18z" fill="#dcf53c" />
      </svg>
      GateGuard <span className="brand-tag">V2</span>
    </Link>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: ReactNode;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = useId();
  const describedBy = [error && `${id}-err`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && !error && (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className="error-text" id={`${id}-err`}>
          <AlertCircle aria-hidden="true" />
          {error}
        </span>
      )}
    </div>
  );
}

const ALERT_ICONS: Record<string, LucideIcon> = { deny: AlertCircle, caution: TriangleAlert, info: Info, admit: CheckCircle2 };

export function Alert({ tone = 'info', children }: { tone?: 'deny' | 'caution' | 'info' | 'admit'; children: ReactNode }) {
  const Icon = ALERT_ICONS[tone];
  return (
    <div className={`alert alert-${tone}`} role={tone === 'deny' ? 'alert' : 'status'}>
      <Icon aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state">
      <Icon className="state-icon" aria-hidden="true" />
      <h3 className="h3">{title}</h3>
      {children && <p className="muted small">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="state" role="alert">
      <AlertCircle className="state-icon" aria-hidden="true" style={{ color: 'var(--deny)' }} />
      <h3 className="h3">Couldn’t load this</h3>
      <p className="muted small">{error instanceof Error ? error.message : 'Unexpected error'}</p>
      {onRetry && (
        <button className="btn btn-outline btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Skeleton({ h = 20, w = '100%' }: { h?: number; w?: number | string }) {
  return <div className="skeleton" style={{ height: h, width: w }} aria-hidden="true" />;
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={i === 0 ? 32 : 18} w={i === 0 ? '40%' : `${90 - i * 10}%`} />
      ))}
    </div>
  );
}

export function ResultBadge({ result, conflict }: { result: ScanResult; conflict?: boolean }) {
  const v = VERDICTS[result];
  const Icon = v.icon;
  return (
    <span className="row" style={{ '--gap': '4px' } as React.CSSProperties}>
      <span className={`badge badge-${v.tone}`}>
        <Icon aria-hidden="true" />
        {v.label}
      </span>
      {conflict && (
        <span className="badge badge-caution" title="Admitted provisionally offline, rejected on sync">
          <TriangleAlert aria-hidden="true" />
          Offline conflict
        </span>
      )}
    </span>
  );
}

export function StatusBadge({ status }: { status: 'valid' | 'checked_in' | 'cancelled' }) {
  if (status === 'checked_in') return <span className="badge badge-admit">Checked in</span>;
  if (status === 'cancelled') return <span className="badge badge-deny">Cancelled</span>;
  return <span className="badge">Not arrived</span>;
}

export function Metric({ label, value, sub, live }: { label: string; value: ReactNode; sub?: ReactNode; live?: boolean }) {
  return (
    <div className={`metric${live ? ' metric-live' : ''}`}>
      <div className="eyebrow">{label}</div>
      <div className="metric-value">{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const titleId = useId();
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby={titleId}>
      <div className="dialog-body">
        <h2 className="h3" id={titleId}>
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}

// ---- toasts ----
type Toast = { id: number; text: string; tone: 'admit' | 'deny' | 'info' };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => {
          const Icon = t.tone === 'deny' ? AlertCircle : t.tone === 'admit' ? CheckCircle2 : Info;
          return (
            <div className="toast" key={t.id}>
              <Icon aria-hidden="true" style={{ color: t.tone === 'deny' ? '#ff9b93' : 'var(--signal)' }} />
              {t.text}
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---- formatting ----
export const fmtDateTime = (d: string | Date) =>
  new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const fmtClock = (d: string | Date) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export const fmtTime = (d: string | number | Date) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
export function timeAgo(d: string | Date) {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return fmtDateTime(d);
}
export function eventPhase(e: { startsAt: string; endsAt: string }): { label: string; tone: 'live' | 'upcoming' | 'ended' } {
  const now = Date.now();
  if (new Date(e.endsAt).getTime() < now) return { label: 'Ended', tone: 'ended' };
  if (new Date(e.startsAt).getTime() <= now) return { label: 'Live', tone: 'live' };
  return { label: 'Upcoming', tone: 'upcoming' };
}
export function PhaseBadge({ e }: { e: { startsAt: string; endsAt: string } }) {
  const p = eventPhase(e);
  if (p.tone === 'live')
    return (
      <span className="badge badge-live">
        <span className="dot dot-pulse" aria-hidden="true" /> Live
      </span>
    );
  return <span className={`badge${p.tone === 'upcoming' ? ' badge-info' : ''}`}>{p.label}</span>;
}
