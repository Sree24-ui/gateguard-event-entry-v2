import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Camera,
  CameraOff,
  CircleDashed,
  CloudOff,
  Download,
  Keyboard,
  RefreshCw,
  ScanLine,
  SwitchCamera,
  TriangleAlert,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { Alert, ErrorState, fmtTime, LoadingBlock, ResultBadge, timeAgo, useToast } from '../components/ui';
import { api, ApiError, cachedApi, errorMessage } from '../lib/api';
import { useQrCamera } from '../lib/camera';
import {
  decideOffline,
  getManifest,
  getPublicKey,
  listScans,
  newScanId,
  putScan,
  queueEvents,
  refreshManifest,
  retryScan,
  syncPending,
  type Manifest,
  type QueuedScan,
} from '../lib/offline';
import { formatCode, parsePayload } from '../lib/tickets';
import type { CheckinOutcome, EventStats, EventSummary } from '../lib/types';
import { useOnline } from '../lib/useOnline';
import { VERDICTS } from '../lib/verdicts';

type Shown =
  | { kind: 'idle' }
  | { kind: 'server'; outcome: CheckinOutcome; at: number }
  | { kind: 'local'; verdict: 'provisional' | 'reject'; reason: string; code: string | null; at: number };

// Short audible cue so operators don't have to look at the screen for every attendee.
let audio: AudioContext | undefined;
function beep(ok: boolean) {
  try {
    audio ??= new AudioContext();
    const tones = ok ? [880] : [220, 0, 220];
    tones.forEach((f, i) => {
      if (!f) return;
      const o = audio!.createOscillator();
      const g = audio!.createGain();
      o.frequency.value = f;
      o.type = ok ? 'sine' : 'square';
      g.gain.value = 0.08;
      o.connect(g).connect(audio!.destination);
      const t = audio!.currentTime + i * 0.12;
      o.start(t);
      o.stop(t + (ok ? 0.15 : 0.1));
    });
  } catch {
    /* audio unavailable */
  }
}

export default function Scanner() {
  const { id = '' } = useParams();
  const online = useOnline();
  const qc = useQueryClient();
  const toast = useToast();

  const eventQ = useQuery({
    queryKey: ['event', id],
    queryFn: () => cachedApi<{ event: EventSummary }>(`/events/${id}`, `gg2.event.${id}`).then((r) => r.event),
    retry: (n, e) => !(e instanceof ApiError && (e.status === 404 || e.isNetwork)) && n < 2,
  });
  const statsQ = useQuery({
    queryKey: ['stats', id],
    queryFn: () => api<EventStats>(`/events/${id}/stats`),
    refetchInterval: online ? 3000 : false,
    enabled: eventQ.isSuccess,
  });

  const event = eventQ.data;
  const gateKey = `gg2.gate.${id}`;
  const [gate, setGate] = useState(() => localStorage.getItem(gateKey) ?? '');
  useEffect(() => {
    if (event && !event.gates.includes(gate)) setGate(event.gates[0]);
  }, [event, gate]);
  useEffect(() => {
    if (gate) localStorage.setItem(gateKey, gate);
  }, [gate, gateKey]);

  const [sound, setSound] = useState(() => localStorage.getItem('gg2.sound') !== 'off');
  const [shown, setShown] = useState<Shown>({ kind: 'idle' });
  const [manual, setManual] = useState('');
  const [blocking, setBlocking] = useState<string | null>(null);

  // device queue + offline pack
  const [scans, setScans] = useState<QueuedScan[]>([]);
  const [manifest, setManifest] = useState<Manifest | undefined>();
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [packBusy, setPackBusy] = useState(false);
  useEffect(() => {
    const refresh = () => {
      listScans(id).then(setScans);
      getManifest(id).then(setManifest);
    };
    refresh();
    queueEvents.addEventListener('change', refresh);
    return () => queueEvents.removeEventListener('change', refresh);
  }, [id]);
  useEffect(() => {
    getPublicKey().then(setPublicKey);
  }, []);
  const downloadPack = useCallback(async () => {
    setPackBusy(true);
    try {
      const m = await refreshManifest(id);
      toast(`Offline pack ready · ${Object.keys(m.tickets).length} tickets`, 'admit');
    } catch (e) {
      toast(errorMessage(e), 'deny');
    } finally {
      setPackBusy(false);
    }
  }, [id, toast]);
  // Keep the offline pack fresh automatically while online so a sudden outage is covered.
  useEffect(() => {
    if (!online || !eventQ.isSuccess) return;
    refreshManifest(id).catch(() => {});
    const t = setInterval(() => refreshManifest(id).catch(() => {}), 60_000);
    return () => clearInterval(t);
  }, [online, id, eventQ.isSuccess]);

  const feedback = useCallback(
    (ok: boolean) => {
      if (sound) beep(ok);
      navigator.vibrate?.(ok ? 80 : [60, 60, 60]);
    },
    [sound],
  );

  const handleScan = useCallback(
    async (payload: string, method: 'camera' | 'manual') => {
      const parsed = parsePayload(payload);
      const code = parsed.kind === 'malformed' ? null : parsed.code;
      const base: QueuedScan = {
        scanId: newScanId(),
        eventId: id,
        payload: payload.slice(0, 400),
        code,
        gate,
        method,
        scannedAt: new Date().toISOString(),
        state: 'pending',
        attempts: 0,
      };
      // Persist first: if the tab dies mid-request, the scan is still on the device.
      await putScan(base);
      if (navigator.onLine) {
        try {
          const outcome = await api<CheckinOutcome>(`/events/${id}/checkin`, {
            body: { scanId: base.scanId, payload: base.payload, gate, method, scannedAt: base.scannedAt },
            signal: AbortSignal.timeout(6000),
          });
          await putScan({ ...base, state: 'synced', result: outcome, attempts: 1 });
          setShown({ kind: 'server', outcome, at: Date.now() });
          setBlocking(null);
          feedback(outcome.result === 'accepted');
          if (outcome.result === 'accepted') qc.invalidateQueries({ queryKey: ['stats', id] });
          return;
        } catch (e) {
          const err = e as ApiError;
          if (!err.isNetwork && err.status !== 503 && err.status !== 502 && err.status !== 504) {
            // Request reached the server and was refused (session, permission, validation). Not a ticket verdict.
            await putScan({ ...base, state: 'failed', attempts: 1, lastError: err.message });
            setBlocking(err.status === 401 ? 'Your session expired. Sign in again — this scan is saved and can be retried.' : err.message);
            feedback(false);
            return;
          }
        }
      }
      const local = await decideOffline(id, payload, publicKey);
      await putScan({ ...base, local: { verdict: local.verdict, reason: local.reason } });
      setShown({ kind: 'local', verdict: local.verdict, reason: local.reason, code: local.code, at: Date.now() });
      feedback(local.verdict === 'provisional');
    },
    [id, gate, publicKey, feedback, qc],
  );

  const cam = useQrCamera((value) => handleScan(value, 'camera'));

  const submitManual = async (e: FormEvent) => {
    e.preventDefault();
    if (!manual.trim()) return;
    await handleScan(manual, 'manual');
    setManual('');
  };

  if (eventQ.isLoading)
    return (
      <div className="container page">
        <LoadingBlock rows={6} />
      </div>
    );
  if (eventQ.error || !event) {
    const err = eventQ.error as ApiError | null;
    return (
      <div className="container page">
        {err?.isNetwork ? (
          <Alert tone="caution">You’re offline and this event hasn’t been opened on this device yet. Open the scanner once while online to prepare it.</Alert>
        ) : (
          <ErrorState error={eventQ.error ?? new Error('Event not found')} onRetry={() => eventQ.refetch()} />
        )}
      </div>
    );
  }

  const stats = statsQ.data;
  const pending = scans.filter((s) => s.state === 'pending').length;
  const failed = scans.filter((s) => s.state === 'failed').length;

  return (
    <div className="container page" style={{ paddingTop: 16 }}>
      <div className="spread" style={{ marginBottom: 16 }}>
        <div className="stack" style={{ '--gap': '4px', minWidth: 0 } as React.CSSProperties}>
          <Link to="/app/scan" className="xs muted row" style={{ textDecoration: 'none', '--gap': '4px' } as React.CSSProperties}>
            <ArrowLeft size={14} aria-hidden="true" /> All events
          </Link>
          <h1 className="h2">{event.name}</h1>
        </div>
        <div className="row" style={{ '--gap': '8px' } as React.CSSProperties}>
          <label className="sr-only" htmlFor="gate">
            Gate
          </label>
          <select id="gate" className="select" style={{ width: 'auto', minHeight: 40 }} value={gate} onChange={(e) => setGate(e.target.value)}>
            {event.gates.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="scanner-layout">
        <div className="stack">
          <div className="viewport">
            <video ref={cam.videoRef} playsInline muted aria-label="Camera preview" hidden={cam.status !== 'scanning'} />
            {cam.status === 'scanning' && (
              <div className="reticle" aria-hidden="true">
                <span />
              </div>
            )}
            {cam.status !== 'scanning' && (
              <div className="viewport-msg">
                {cam.status === 'starting' ? (
                  <>
                    <CircleDashed className="dot-pulse" aria-hidden="true" />
                    <p>Starting camera…</p>
                  </>
                ) : cam.status === 'error' ? (
                  <>
                    <CameraOff aria-hidden="true" />
                    <p style={{ maxWidth: 360 }}>{cam.error}</p>
                    <button className="btn btn-primary" onClick={() => cam.start()}>
                      <RefreshCw aria-hidden="true" /> Try again
                    </button>
                  </>
                ) : (
                  <>
                    <ScanLine aria-hidden="true" />
                    <p style={{ maxWidth: 320 }}>Point the camera at an attendee’s QR ticket. Results appear instantly below.</p>
                    <button className="btn btn-primary btn-lg" onClick={() => cam.start()}>
                      <Camera aria-hidden="true" /> Start camera
                    </button>
                  </>
                )}
              </div>
            )}
            {cam.status === 'scanning' && (
              <div className="viewport-bar">
                <span className="viewport-chip">
                  <span className="dot dot-pulse" style={{ color: 'var(--signal)' }} aria-hidden="true" /> Scanning · {gate}
                </span>
                <span className="row" style={{ '--gap': '6px' } as React.CSSProperties}>
                  <button className="btn btn-sm viewport-chip" onClick={cam.flip} aria-label="Switch camera">
                    <SwitchCamera aria-hidden="true" />
                  </button>
                  <button className="btn btn-sm viewport-chip" onClick={cam.stop}>
                    <CameraOff aria-hidden="true" /> Stop
                  </button>
                </span>
              </div>
            )}
          </div>

          {blocking && <Alert tone="deny">{blocking} {blocking.includes('Sign in') && <Link to={`/login?next=/app/scan/${id}`}>Sign in</Link>}</Alert>}

          <div aria-live="assertive" aria-atomic="true">
            <VerdictSlab shown={shown} />
          </div>

          <form className="panel panel-pad" onSubmit={submitManual} style={{ padding: 16 }}>
            <label htmlFor="manual" className="label row" style={{ '--gap': '6px', marginBottom: 8 } as React.CSSProperties}>
              <Keyboard size={16} aria-hidden="true" /> Manual ticket code
            </label>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input
                id="manual"
                className="input mono"
                placeholder="XXXX-XXXX-XXXX"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}
              />
              <button className="btn btn-dark" disabled={!manual.trim()}>
                Check in
              </button>
            </div>
            <p className="hint" style={{ marginTop: 6 }}>For damaged screens or printouts. The code is printed under the QR.</p>
          </form>
        </div>

        <div className="stack">
          <section className="metrics" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }} aria-label="Live attendance">
            <div className="metric metric-live">
              <div className="eyebrow">Checked in</div>
              <div className="metric-value num">{stats?.checkedIn ?? event.checkedIn}</div>
            </div>
            <div className="metric">
              <div className="eyebrow">Remaining</div>
              <div className="metric-value num">{stats?.remaining ?? event.remaining}</div>
            </div>
            <div className="metric" style={{ borderRight: 0 }}>
              <div className="eyebrow">Attendance</div>
              <div className="metric-value num">{stats?.attendancePct ?? event.attendancePct}%</div>
            </div>
          </section>
          <p className="xs muted" style={{ marginTop: -8 }}>
            {online
              ? stats
                ? `Server count · updated ${timeAgo(stats.generatedAt)} · ${stats.registered} registered`
                : 'Loading live count…'
              : 'Offline — counts are frozen at the last server update and exclude pending scans.'}
          </p>

          <section className="panel" aria-labelledby="queue-h">
            <div className="spread" style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
              <h2 id="queue-h" className="h3">
                This device
              </h2>
              <div className="row" style={{ '--gap': '6px' } as React.CSSProperties}>
                {pending > 0 && <span className="badge badge-caution">{pending} pending</span>}
                {failed > 0 && <span className="badge badge-deny">{failed} failed</span>}
                <button className="btn btn-ghost btn-sm" onClick={() => syncPending()} disabled={!online || pending === 0}>
                  <RefreshCw aria-hidden="true" /> Sync
                </button>
                <button
                  className="btn btn-ghost btn-sm icon-btn"
                  aria-pressed={sound}
                  aria-label={sound ? 'Mute scan sounds' : 'Enable scan sounds'}
                  onClick={() => {
                    localStorage.setItem('gg2.sound', sound ? 'off' : 'on');
                    setSound(!sound);
                  }}
                >
                  {sound ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
                </button>
              </div>
            </div>
            {scans.length === 0 ? (
              <p className="small muted" style={{ padding: 16 }}>
                Scans from this device appear here, with their sync status.
              </p>
            ) : (
              <ul className="list" style={{ padding: '0 16px', maxHeight: 420, overflowY: 'auto' }}>
                {scans.slice(0, 40).map((s) => (
                  <QueueRow key={s.scanId} s={s} />
                ))}
              </ul>
            )}
          </section>

          <section className="wash stack" style={{ padding: 16, '--gap': '10px' } as React.CSSProperties} aria-labelledby="pack-h">
            <div className="spread">
              <h2 id="pack-h" className="small row" style={{ fontWeight: 500, '--gap': '6px' } as React.CSSProperties}>
                <CloudOff size={16} aria-hidden="true" /> Offline pack
              </h2>
              <button className="btn btn-outline btn-sm" style={{ background: 'var(--paper)' }} onClick={downloadPack} disabled={!online || packBusy}>
                <Download aria-hidden="true" /> {manifest ? 'Refresh' : 'Download'}
              </button>
            </div>
            <p className="xs muted">
              {manifest
                ? `${Object.keys(manifest.tickets).length} ticket statuses cached ${timeAgo(manifest.generatedAt)}. `
                : 'Not downloaded yet. '}
              {publicKey ? 'Signature key cached — forged QRs are caught offline.' : 'Signature key not cached yet.'}
            </p>
            <p className="xs muted">
              Offline admits are <strong>provisional</strong>: another gate can’t know about them until both devices sync. The server
              keeps one official check-in and flags any conflict.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function VerdictSlab({ shown }: { shown: Shown }) {
  if (shown.kind === 'idle') {
    return (
      <div className="verdict verdict-idle">
        <div className="verdict-icon">
          <ScanLine aria-hidden="true" />
        </div>
        <div>
          <div className="h3">Ready to scan</div>
          <p className="small muted">The verdict for each ticket appears here.</p>
        </div>
      </div>
    );
  }
  if (shown.kind === 'local') {
    const provisional = shown.verdict === 'provisional';
    const Icon = provisional ? TriangleAlert : CloudOff;
    return (
      <div key={shown.at} className={`verdict verdict-enter ${provisional ? 'verdict-caution' : 'verdict-deny'}`}>
        <div className="verdict-icon">
          <Icon aria-hidden="true" />
        </div>
        <div>
          <div className="verdict-word">{provisional ? 'ADMIT*' : 'DENY'}</div>
          <div className="small" style={{ fontWeight: 500 }}>{provisional ? 'Provisional — offline check' : 'Rejected — offline check'}</div>
        </div>
        <p className="verdict-reason">{shown.reason}</p>
        <div className="verdict-meta mono">
          {shown.code && <span>{formatCode(shown.code)}</span>}
          <span>{fmtTime(shown.at)}</span>
          <span>Will sync when online</span>
        </div>
      </div>
    );
  }
  const { outcome } = shown;
  const v = VERDICTS[outcome.result];
  const Icon = v.icon;
  return (
    <div key={shown.at} className={`verdict verdict-enter verdict-${v.tone}`}>
      <div className="verdict-icon">
        <Icon aria-hidden="true" />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="verdict-word">{v.word}</div>
        {outcome.attendee && (
          <div style={{ fontWeight: 500, fontSize: 18, overflowWrap: 'anywhere' }}>
            {outcome.attendee.name}
            {outcome.attendee.affiliation && <span style={{ opacity: 0.85, fontWeight: 400 }}> · {outcome.attendee.affiliation}</span>}
          </div>
        )}
      </div>
      <p className="verdict-reason">{outcome.message}</p>
      <div className="verdict-meta mono">
        {outcome.attendee && <span>{outcome.attendee.code}</span>}
        {outcome.result === 'duplicate' && outcome.checkedInAt && (
          <span>
            First entry {fmtTime(outcome.checkedInAt)} · {outcome.checkedInGate}
          </span>
        )}
        <span>Verified by server</span>
      </div>
    </div>
  );
}

function QueueRow({ s }: { s: QueuedScan }) {
  return (
    <li className="spread" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
      <div className="stack" style={{ '--gap': '4px', minWidth: 0 } as React.CSSProperties}>
        {s.result ? (
          <ResultBadge result={s.result.result} conflict={s.result.conflict} />
        ) : s.local ? (
          <span className={`badge ${s.local.verdict === 'provisional' ? 'badge-caution' : 'badge-deny'}`}>
            {s.local.verdict === 'provisional' ? 'Provisional admit' : 'Rejected offline'}
          </span>
        ) : (
          <span className="badge">Sending…</span>
        )}
        <span className="xs muted" style={{ overflowWrap: 'anywhere' }}>
          {s.result?.attendee?.name ?? (s.code ? formatCode(s.code) : 'Unreadable code')} · {s.gate} · {s.method}
        </span>
        {s.lastError && <span className="xs" style={{ color: 'var(--deny)' }}>{s.lastError}</span>}
      </div>
      <div className="stack" style={{ '--gap': '4px', alignItems: 'flex-end', flex: 'none' } as React.CSSProperties}>
        <span className="xs muted mono">{fmtTime(s.scannedAt)}</span>
        {s.state === 'synced' && <span className="xs" style={{ color: 'var(--admit)' }}>Synced</span>}
        {s.state === 'pending' && <span className="xs" style={{ color: 'var(--caution)' }}>Pending sync</span>}
        {s.state === 'failed' && (
          <button className="btn btn-ghost btn-sm" style={{ minHeight: 28, color: 'var(--deny)' }} onClick={() => retryScan(s.scanId)}>
            <RefreshCw aria-hidden="true" /> Retry
          </button>
        )}
      </div>
    </li>
  );
}
