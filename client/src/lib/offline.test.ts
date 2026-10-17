import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { decideOffline, listScans, newScanId, putScan, syncPending, type QueuedScan } from './offline';
import { normalizeCode, parsePayload, verifySignature } from './tickets';

const EVENT = 'a'.repeat(24);
const OTHER = 'b'.repeat(24);
const toB64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let publicKey: string;
let sign: (eventId: string, code: string) => Promise<string>;

beforeAll(async () => {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  publicKey = toB64url(await crypto.subtle.exportKey('raw', kp.publicKey));
  sign = async (eventId, code) => {
    const msg = `GG2.${eventId}.${code}`;
    return `${msg}.${toB64url(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(msg)))}`;
  };
});

afterEach(() => vi.unstubAllGlobals());

const queued = (over: Partial<QueuedScan>): QueuedScan => ({
  scanId: newScanId(),
  eventId: EVENT,
  payload: '',
  code: null,
  gate: 'Main gate',
  method: 'camera',
  scannedAt: new Date().toISOString(),
  state: 'pending',
  attempts: 0,
  ...over,
});

describe('ticket parsing', () => {
  it('normalizes typed codes', () => {
    expect(normalizeCode('7kq2-m9xd-4trb')).toBe('7KQ2M9XD4TRB');
    expect(normalizeCode('OOOO IIII LLLL')).toBe('000011111111');
    expect(normalizeCode('too-short')).toBeNull();
  });

  it('classifies payloads', async () => {
    const qr = await sign(EVENT, 'ABCDEFGHJKMN');
    expect(parsePayload(qr)).toMatchObject({ kind: 'qr', eventId: EVENT, code: 'ABCDEFGHJKMN' });
    expect(parsePayload('ABCD-EFGH-JKMN')).toMatchObject({ kind: 'code', code: 'ABCDEFGHJKMN' });
    expect(parsePayload('https://evil.example')).toEqual({ kind: 'malformed' });
    expect(parsePayload('GG2.garbage')).toEqual({ kind: 'malformed' });
  });

  it('verifies signatures with the public key only', async () => {
    const good = parsePayload(await sign(EVENT, 'ABCDEFGHJKMN'));
    if (good.kind !== 'qr') throw new Error('expected qr');
    expect(await verifySignature(publicKey, good)).toBe(true);
    const forged = parsePayload((await sign(EVENT, 'ABCDEFGHJKMN')).replace('ABCDEFGHJKMN', 'ZZZZZZZZZZZZ'));
    if (forged.kind !== 'qr') throw new Error('expected qr');
    expect(await verifySignature(publicKey, forged)).toBe(false);
  });
});

describe('offline decisions', () => {
  it('provisionally admits a correctly signed ticket, then rejects it on a second offline scan at this gate', async () => {
    const qr = await sign(EVENT, 'PROV1SNAL000');
    const first = await decideOffline(EVENT, qr, publicKey);
    expect(first.verdict).toBe('provisional');
    await putScan(queued({ payload: qr, code: first.code, local: first, state: 'synced' }));
    const second = await decideOffline(EVENT, qr, publicKey);
    expect(second).toMatchObject({ verdict: 'reject', reason: expect.stringMatching(/already admitted/i) });
  });

  it('rejects forged, wrong-event and unreadable codes offline', async () => {
    const forged = (await sign(EVENT, 'F0RGED000000')).replace('F0RGED000000', 'F0RGED000001');
    expect((await decideOffline(EVENT, forged, publicKey)).reason).toMatch(/signature/i);
    expect((await decideOffline(EVENT, await sign(OTHER, 'WR0NGEVENT00'), publicKey)).reason).toMatch(/wrong event/i);
    expect((await decideOffline(EVENT, 'hello', publicKey)).verdict).toBe('reject');
  });

  it('refuses manual codes it cannot check without an offline pack', async () => {
    expect((await decideOffline(EVENT, 'MANA-A100-0000', publicKey)).reason).toMatch(/offline pack/i);
  });

  it('is honest when the device cannot verify signatures', async () => {
    const res = await decideOffline(EVENT, await sign(EVENT, 'N0KEY0000000'), null);
    expect(res).toMatchObject({ verdict: 'provisional', reason: expect.stringMatching(/could not be checked/i) });
  });
});

describe('queue persistence and sync', () => {
  it('persists scans and syncs them oldest-first with idempotent scan ids', async () => {
    const ev = 'c'.repeat(24);
    const older = queued({ eventId: ev, scannedAt: '2026-01-01T10:00:00.000Z', payload: 'A', local: { verdict: 'provisional', reason: '' } });
    const newer = queued({ eventId: ev, scannedAt: '2026-01-01T10:05:00.000Z', payload: 'B' });
    await putScan(newer);
    await putScan(older);
    const bodies: { scanId: string; offline: boolean; provisional: boolean }[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      bodies.push(body);
      return new Response(JSON.stringify({ scanId: body.scanId, result: 'accepted', message: 'ok', conflict: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    expect(await syncPending()).toEqual({ synced: 2, failed: 0 });
    expect(bodies.map((b) => b.scanId)).toEqual([older.scanId, newer.scanId]);
    expect(bodies[0]).toMatchObject({ offline: true, provisional: true });
    expect(bodies[1]).toMatchObject({ provisional: false });
    expect((await listScans(ev)).every((s) => s.state === 'synced')).toBe(true);
  });

  it('keeps scans pending when the network is down and retries later', async () => {
    const ev = 'd'.repeat(24);
    await putScan(queued({ eventId: ev, payload: 'X' }));
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await syncPending()).toEqual({ synced: 0, failed: 0 });
    const [scan] = await listScans(ev);
    expect(scan).toMatchObject({ state: 'pending', attempts: 1 });
  });

  it('marks scans failed (not retried forever) when the server refuses the request', async () => {
    const ev = 'e'.repeat(24);
    await putScan(queued({ eventId: ev, payload: 'Y' }));
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: { code: 'not_assigned', message: 'You are not assigned' } }), { status: 403, headers: { 'content-type': 'application/json' } }),
    );
    // (the earlier network-down scan is still pending in this shared DB and fails here too)
    expect((await syncPending()).synced).toBe(0);
    expect((await listScans(ev))[0]).toMatchObject({ state: 'failed', lastError: 'You are not assigned' });
  });
});
