// Prints fresh secrets for .env. Never commit the output.
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { privateKey } = generateKeyPairSync('ed25519');
console.log(`JWT_SECRET=${randomBytes(48).toString('base64url')}`);
console.log(`TICKET_SIGNING_KEY=${privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')}`);
