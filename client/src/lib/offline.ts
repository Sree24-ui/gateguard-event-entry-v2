import { openDB, type DBSchema } from 'idb';
import { api, ApiError } from './api';
import { parsePayload, verifySignature } from './tickets';
import type { CheckinOutcome } from './types';

/**
 * Offline gate operation.
 *
 * Every scan gets a client-generated `scanId` and is written to IndexedDB *before* it is sent.
 * Online, the server answers immediately. Offline (or when the request fails to reach the server),
 * the scan stays `pending` with a *provisional* on-device verdict and is synced later; the server
 * treats `scanId` as an idempotency key, so retries never create a second record.
 *
 * Limitation (by design, not a bug): two disconnected gates cannot know about each other's scans.
 * Both may provisionally admit the same ticket. On sync the server keeps exactly one official
 * check-in and flags the other as an offline conflict for staff review.
 */

export type SyncState = 'pending' | 'synced' | 'failed';

export interface LocalVerdict {
  verdict: 'provisional' | 'reject';
  reason: string;
}

export interface QueuedScan {
  scanId: string;
  eventId: string;
  payload: string;
  code: string | null;
  gate: string;
  method: 'camera' | 'manual';
  scannedAt: string;
  state: SyncState;
  local?: LocalVerdict;
  result?: CheckinOutcome;
  attempts: number;
  lastError?: string;
}

/** Ticket statuses snapshot: code → v(alid) | c(hecked in) | x (cancelled). No personal data. */
export interface Manifest {
  eventId: string;
  generatedAt: string;
  tickets: Record<string, 'v' | 'c' | 'x'>;
}

interface GateDB extends DBSchema {
  scans: { key: string; value: QueuedScan; indexes: { byEvent: string } };
  manifests: { key: string; value: Manifest };
  meta: { key: string; value: string };
}

const dbPromise = () =>
  openDB<GateDB>('gateguard-v2', 1, {
    upgrade(db) {
      db.createObjectStore('scans', { keyPath: 'scanId' }).createIndex('byEvent', 'eventId');
      db.createObjectStore('manifests', { keyPath: 'eventId' });
      db.createObjectStore('meta');
    },
  });
let db: ReturnType<typeof dbPromise> | undefined;
const getDb = () => (db ??= dbPromise());

// Lightweight change notifications so React views re-read the queue.
export const queueEvents = new EventTarget();
const changed = () => queueEvents.dispatchEvent(new Event('change'));

export const newScanId = () => crypto.randomUUID();

export async function putScan(scan: QueuedScan) {
  await (await getDb()).put('scans', scan);
  changed();
}

export async function listScans(eventId: string): Promise<QueuedScan[]> {
  const all = await (await getDb()).getAllFromIndex('scans', 'byEvent', eventId);
  return all.sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
}

export async function pendingCount(): Promise<number> {
  const all = await (await getDb()).getAll('scans');
  return all.filter((s) => s.state === 'pending').length;
}

/** Drops synced scans older than a day so the device doesn't accumulate history forever. */
export async function pruneSynced(maxAgeMs = 86_400_000) {
  const d = await getDb();
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  for (const s of await d.getAll('scans')) if (s.state === 'synced' && s.scannedAt < cutoff) await d.delete('scans', s.scanId);
}

// ---- offline pack ----

export async function getPublicKey(): Promise<string | null> {
  const d = await getDb();
  try {
    const { publicKey } = await api<{ publicKey: string }>('/public/ticket-key');
    await d.put('meta', publicKey, 'ticketKey');
    return publicKey;
  } catch {
    return (await d.get('meta', 'ticketKey')) ?? null;
  }
}

export async function refreshManifest(eventId: string): Promise<Manifest> {
  const m = await api<{ eventId: string; generatedAt: string; tickets: [string, 'v' | 'c' | 'x'][] }>(`/events/${eventId}/manifest`);
  const manifest: Manifest = { eventId, generatedAt: m.generatedAt, tickets: Object.fromEntries(m.tickets) };
  await (await getDb()).put('manifests', manifest);
  changed();
  return manifest;
}

export async function getManifest(eventId: string) {
  return (await getDb()).get('manifests', eventId);
}

/**
 * On-device decision used only while the server is unreachable. Checks, in order: format,
 * signature (public key), event, cached ticket status, and this device's own earlier scans.
 */
export async function decideOffline(eventId: string, payload: string, publicKey: string | null): Promise<LocalVerdict & { code: string | null }> {
  const parsed = parsePayload(payload);
  if (parsed.kind === 'malformed') return { verdict: 'reject', reason: 'Not a GateGuard ticket — unreadable or unknown format', code: null };
  if (parsed.kind === 'qr') {
    if (parsed.eventId !== eventId) return { verdict: 'reject', reason: 'Wrong event — this ticket is for a different event', code: parsed.code };
    const ok = publicKey ? await verifySignature(publicKey, parsed) : null;
    if (ok === false) return { verdict: 'reject', reason: 'Invalid signature — QR is forged or altered', code: parsed.code };
    if (ok === null) return { verdict: 'provisional', reason: 'Signature could not be checked on this device — verify on sync', code: parsed.code };
  }
  const manifest = await getManifest(eventId);
  const status = manifest?.tickets[parsed.code];
  if (parsed.kind === 'code' && !status) {
    return { verdict: 'reject', reason: manifest ? 'Unknown code for this event (per offline pack)' : 'Manual codes need the offline pack — download it while online', code: parsed.code };
  }
  if (status === 'x') return { verdict: 'reject', reason: 'Cancelled ticket (per offline pack)', code: parsed.code };
  if (status === 'c') return { verdict: 'reject', reason: 'Already checked in before this device went offline', code: parsed.code };
  const seen = (await listScans(eventId)).some(
    (s) => s.code === parsed.code && (s.local?.verdict === 'provisional' || s.result?.result === 'accepted'),
  );
  if (seen) return { verdict: 'reject', reason: 'Already admitted at this gate while offline', code: parsed.code };
  return {
    verdict: 'provisional',
    reason: manifest
      ? 'Signature valid · not yet confirmed by server — other gates may have admitted it'
      : 'Signature valid · no offline pack, duplicate check pending sync',
    code: parsed.code,
  };
}

// ---- sync ----

let syncing: Promise<{ synced: number; failed: number }> | undefined;

/** Sends pending scans oldest-first. Safe to call often: concurrent calls share one run. */
export function syncPending() {
  return (syncing ??= (async () => {
    let synced = 0;
    let failed = 0;
    try {
      const d = await getDb();
      const pending = (await d.getAll('scans')).filter((s) => s.state === 'pending').sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
      for (const scan of pending) {
        try {
          const result = await api<CheckinOutcome>(`/events/${scan.eventId}/checkin`, {
            body: { scanId: scan.scanId, payload: scan.payload, gate: scan.gate, method: scan.method, scannedAt: scan.scannedAt, offline: true, provisional: scan.local?.verdict === 'provisional' },
          });
          await d.put('scans', { ...scan, state: 'synced', result, attempts: scan.attempts + 1, lastError: undefined });
          synced++;
        } catch (e) {
          const err = e as ApiError;
          if (err.isNetwork || err.status >= 500 || err.status === 429) {
            await d.put('scans', { ...scan, attempts: scan.attempts + 1, lastError: err.message });
            break; // server unreachable/overloaded: keep order, retry later
          }
          // Permanent rejection of the request itself (e.g. 401/403): needs a person, not a retry loop.
          await d.put('scans', { ...scan, state: 'failed', attempts: scan.attempts + 1, lastError: err.message });
          failed++;
        }
      }
    } finally {
      syncing = undefined;
      changed();
    }
    return { synced, failed };
  })());
}

/** Moves a failed scan back to pending (e.g. after signing in again). */
export async function retryScan(scanId: string) {
  const d = await getDb();
  const scan = await d.get('scans', scanId);
  if (scan) await d.put('scans', { ...scan, state: 'pending', lastError: undefined });
  changed();
  return syncPending();
}
