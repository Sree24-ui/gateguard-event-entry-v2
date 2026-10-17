/** Client-side mirror of the server's ticket format. See server/src/lib/tickets.ts. */
export type Parsed =
  | { kind: 'qr'; eventId: string; code: string; message: string; signature: string }
  | { kind: 'code'; code: string }
  | { kind: 'malformed' };

const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/;

export function normalizeCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  return CODE_RE.test(c) ? c : null;
}

export const formatCode = (c: string) => c.match(/.{1,4}/g)!.join('-');

export function parsePayload(raw: string): Parsed {
  const text = raw.trim();
  const m = /^(GG2\.([0-9a-f]{24})\.([0-9A-Z]{12}))\.([A-Za-z0-9_-]{86})$/.exec(text);
  if (m) return { kind: 'qr', message: m[1], eventId: m[2], code: m[3], signature: m[4] };
  if (text.startsWith('GG2.')) return { kind: 'malformed' };
  const code = normalizeCode(text);
  return code ? { kind: 'code', code } : { kind: 'malformed' };
}

const b64urlToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

let keyCache: { raw: string; key: Promise<CryptoKey> } | undefined;

/**
 * Verifies the Ed25519 signature with the server's *public* key (WebCrypto).
 * Returns null when this browser can't do Ed25519, so callers can say "unverified" honestly.
 */
export async function verifySignature(publicKeyB64url: string, parsed: Extract<Parsed, { kind: 'qr' }>): Promise<boolean | null> {
  try {
    if (keyCache?.raw !== publicKeyB64url) {
      keyCache = { raw: publicKeyB64url, key: crypto.subtle.importKey('raw', b64urlToBytes(publicKeyB64url), { name: 'Ed25519' }, false, ['verify']) };
    }
    const key = await keyCache.key;
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, b64urlToBytes(parsed.signature), new TextEncoder().encode(parsed.message));
  } catch {
    keyCache = undefined;
    return null;
  }
}
