import { createPrivateKey, createPublicKey, randomBytes, sign, verify, type KeyObject } from 'node:crypto';
import { config } from '../config.js';

/**
 * Ticket codes: 12 Crockford base32 chars (60 random bits), shown as XXXX-XXXX-XXXX.
 * QR payload: `GG2.<eventId>.<code>.<ed25519 signature, base64url>` — no personal data.
 * The signature lets a scanner verify authenticity offline with only the public key;
 * the server stays authoritative for check-in state.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/;

export function newTicketCode(): string {
  const bytes = randomBytes(12);
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

/** Accepts user-typed codes: case-insensitive, dashes/spaces ignored, I/L→1, O→0. */
export function normalizeCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  return CODE_RE.test(c) ? c : null;
}

export const formatCode = (c: string) => c.match(/.{4}/g)!.join('-');

let keys: { priv: KeyObject; pub: KeyObject } | undefined;
function getKeys() {
  if (!keys) {
    const priv = createPrivateKey({ key: Buffer.from(config.ticketSigningKey, 'base64'), format: 'der', type: 'pkcs8' });
    keys = { priv, pub: createPublicKey(priv) };
  }
  return keys;
}

/** Raw 32-byte Ed25519 public key, base64url — safe to publish. */
export function publicKeyRaw(): string {
  const jwk = getKeys().pub.export({ format: 'jwk' });
  return jwk.x!;
}

export function signTicket(eventId: string, code: string): string {
  const msg = `GG2.${eventId}.${code}`;
  return `${msg}.${sign(null, Buffer.from(msg), getKeys().priv).toString('base64url')}`;
}

export type ParsedPayload =
  | { kind: 'qr'; eventId: string; code: string; signatureValid: boolean }
  | { kind: 'code'; code: string }
  | { kind: 'malformed' };

export function parsePayload(raw: string): ParsedPayload {
  const text = raw.trim();
  const m = /^GG2\.([0-9a-f]{24})\.([0-9A-Z]{12})\.([A-Za-z0-9_-]{86})$/.exec(text);
  if (m) {
    const [, eventId, code, sig] = m;
    let signatureValid = false;
    try {
      signatureValid = verify(null, Buffer.from(`GG2.${eventId}.${code}`), getKeys().pub, Buffer.from(sig, 'base64url'));
    } catch {
      signatureValid = false;
    }
    return { kind: 'qr', eventId, code, signatureValid };
  }
  if (text.startsWith('GG2.')) return { kind: 'malformed' };
  const code = normalizeCode(text);
  return code ? { kind: 'code', code } : { kind: 'malformed' };
}
