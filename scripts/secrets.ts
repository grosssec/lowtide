/**
 * Generates the Worker secrets (none of them is a bank password):
 *   SETUP_TOKEN        one-time code to register the first passkey
 *   INGEST_TOKEN       what the Google Apps Script sends with bank alerts and hours
 *   CHALLENGE_KEY      signs the sign-in challenges, so asking for one writes nothing
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_JWK   key pair that signs the push notifications
 *
 * Run: node scripts/secrets.ts            → adds the missing ones to .dev.vars (local Worker)
 *      node scripts/secrets.ts --remote   → adds the missing ones to .env and stores them with `wrangler secret put`
 * Values are never printed. Both files are gitignored.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generateVapidKeys, toBase64Url } from '../shared/push/webpush.ts';

const remote = process.argv.includes('--remote');
const file = new URL(remote ? '../.env' : '../.dev.vars', import.meta.url).pathname;

const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()) : [];
const values = new Map(lines.filter((line) => !line.startsWith('#') && line.includes('=')).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));

const random = (bytes: number) => toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
const added: string[] = [];
const ensure = (name: string, make: () => string) => {
  if (values.get(name)) return;
  values.set(name, make());
  lines.push(`${name}=${values.get(name)}`);
  added.push(name);
};

ensure('SETUP_TOKEN', () => random(18));
ensure('INGEST_TOKEN', () => random(32));
ensure('CHALLENGE_KEY', () => random(32));
if (!values.get('VAPID_PUBLIC_KEY') || !values.get('VAPID_PRIVATE_JWK')) {
  const keys = await generateVapidKeys();
  for (const name of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_JWK']) {
    const index = lines.findIndex((line) => line.startsWith(`${name}=`));
    if (index >= 0) lines.splice(index, 1);
    values.delete(name);
  }
  ensure('VAPID_PUBLIC_KEY', () => keys.publicKey);
  ensure('VAPID_PRIVATE_JWK', () => JSON.stringify(keys.privateJwk));
}

writeFileSync(file, `${lines.join('\n')}\n`);
chmodSync(file, 0o600);
console.log(added.length ? `${remote ? '.env' : '.dev.vars'}: added ${added.join(', ')}` : `${remote ? '.env' : '.dev.vars'}: nothing to add`);

if (remote) {
  // --only NAME stores just that one (e.g. a new secret), leaving the others on Cloudflare as they are.
  const only = process.argv[process.argv.indexOf('--only') + 1];
  const names = process.argv.includes('--only') ? [only] : ['SETUP_TOKEN', 'INGEST_TOKEN', 'CHALLENGE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_JWK'];
  for (const name of names) {
    // The value goes through stdin, so it never shows up in the shell history or the process list.
    execFileSync('npx', ['wrangler', 'secret', 'put', name], { input: values.get(name), stdio: ['pipe', 'inherit', 'inherit'] });
  }
}
