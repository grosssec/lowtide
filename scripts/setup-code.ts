/**
 * A one-time code to add a passkey when no device is signed in: the very first one, a new domain, or recovery
 * after losing every device. Type it on the sign-in page ("Use a code"). It works once, for 15 minutes.
 * Only its SHA-256 goes into the database; the code itself is shown here and nowhere else.
 *
 * Run: npm run setup-code               → local dev database
 *      npm run setup-code -- --remote   → the live app (run it yourself; don't paste the code anywhere)
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MINUTES = 15;

const raw = [...randomBytes(8)].map((b) => ALPHABET[b % 32]).join('');
const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
// Same hash as the Worker: SHA-256 of the code without the dash, base64url.
const hash = createHash('sha256').update(raw).digest('base64url');

const target = process.argv.includes('--remote') ? '--remote' : '--local';
execFileSync(
  'npx',
  ['wrangler', 'd1', 'execute', 'finance', target, '--command', `INSERT INTO device_codes (code_hash, expires_at) VALUES ('${hash}', datetime('now', '+${MINUTES} minutes'))`],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);
console.log(`\n  Device code: ${code}   (works once, for ${MINUTES} minutes${target === '--local' ? ', local app' : ''})\n`);
