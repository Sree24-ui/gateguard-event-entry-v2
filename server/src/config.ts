import { generateKeyPairSync } from 'node:crypto';

const env = process.env;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test' || !!env.VITEST;

function required(name: string, devFallback: () => string): string {
  const value = env[name];
  if (value) return value;
  if (isProd) throw new Error(`Missing required environment variable ${name}`);
  return devFallback();
}

// Dev/test only: an ephemeral Ed25519 key. Tickets signed with it stop verifying after a restart,
// so `npm run keys` prints a persistent key for .env.
let ephemeralKey: string | undefined;
function devSigningKey() {
  if (!ephemeralKey) {
    if (!isTest) console.warn('[config] TICKET_SIGNING_KEY not set — using an ephemeral key. Run `npm run keys`.');
    ephemeralKey = generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  }
  return ephemeralKey;
}

export const config = {
  port: Number(env.PORT ?? 3002),
  mongoUri: required('MONGODB_URI', () => 'mongodb://127.0.0.1:27017/gateguard_v2_dev'),
  jwtSecret: required('JWT_SECRET', () => 'dev-only-insecure-jwt-secret-change-me'),
  ticketSigningKey: required('TICKET_SIGNING_KEY', devSigningKey),
  // Comma-separated list of origins allowed to call the API cross-origin. Same-origin deploys need none.
  corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5174').split(',').map((s) => s.trim()).filter(Boolean),
  sessionHours: 12,
};
