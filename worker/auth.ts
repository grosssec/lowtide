import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';

export type AppEnv = { Bindings: Env };

/** On https the cookie gets the __Host- prefix: Secure, path /, no Domain, so no subdomain can set or read it. */
const sessionCookie = (c: Context<AppEnv>) => (new URL(c.req.url).protocol === 'https:' ? '__Host-fd_session' : 'fd_session');
const SESSION_DAYS = 30;
const CHALLENGE_MINUTES = 5;
// Single-user app: one fixed WebAuthn user handle.
const USER_ID = new Uint8Array(new TextEncoder().encode('finance-dashboard-owner'));

const isLocalhost = (c: Context<AppEnv>) => ['localhost', '127.0.0.1'].includes(new URL(c.req.url).hostname);
const relyingParty = (c: Context<AppEnv>) => {
  const url = new URL(c.req.url);
  return { rpID: url.hostname, origin: url.origin };
};

function randomToken(): string {
  return isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(32)));
}

/** Session tokens are stored hashed, so a database leak does not hand out valid sessions. */
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return isoBase64URL.fromBuffer(new Uint8Array(digest));
}

/** Constant-time comparison for secrets (ingest token, MACs). An empty secret never matches anything. */
export function sameSecret(a: string, b: string): boolean {
  if (!a || !b) return false;
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** "iPhone · Safari", "Mac · Chrome": enough to recognize a device, nothing more. */
export function deviceOf(c: Context<AppEnv>): string {
  const ua = c.req.header('User-Agent') ?? '';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Mobile\//.test(ua) ? 'Home Screen app' : '';
  return browser ? `${os} · ${browser}` : os;
}

/** City and country from Cloudflare's request data (no IP is stored). */
function placeOf(c: Context<AppEnv>): string | null {
  const cf = (c.req.raw as Request & { cf?: { city?: string; country?: string } }).cf;
  return [cf?.city, cf?.country].filter(Boolean).join(', ') || null;
}

/** Only called after a passkey verified or with a valid session, so it can't be used to flood the database. */
export async function logEvent(c: Context<AppEnv>, type: string, detail?: string): Promise<void> {
  await c.env.DB.prepare('INSERT INTO security_events (type, device, place, detail) VALUES (?, ?, ?, ?)')
    .bind(type, deviceOf(c), placeOf(c), detail ?? null)
    .run();
}

/** The current session's id (the hash of its token), or null. */
export async function sessionId(c: Context<AppEnv>): Promise<string | null> {
  if (c.env.DEV_AUTH_BYPASS === '1' && isLocalhost(c)) return 'dev';
  const token = getCookie(c, sessionCookie(c));
  if (!token) return null;
  const id = await sha256(token);
  const row = await c.env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND expires_at > datetime('now')").bind(id).first();
  if (!row) return null;
  // "Last seen" moves at most once an hour, so normal use costs almost no writes.
  await c.env.DB.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now', '-1 hour'))")
    .bind(id)
    .run();
  return id;
}

export async function hasSession(c: Context<AppEnv>): Promise<boolean> {
  return (await sessionId(c)) !== null;
}

async function startSession(c: Context<AppEnv>): Promise<void> {
  const token = randomToken();
  await c.env.DB.prepare(
    `INSERT INTO sessions (id, expires_at, device, place, last_seen_at) VALUES (?, datetime('now', '+${SESSION_DAYS} days'), ?, ?, datetime('now'))`,
  )
    .bind(await sha256(token), deviceOf(c), placeOf(c))
    .run();
  await c.env.DB.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  setCookie(c, sessionCookie(c), token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

/**
 * Challenges are signed, not stored: asking for one writes nothing, so nobody without a passkey can make the app write.
 * id = challenge.expires.hmac(challenge.expires) with CHALLENGE_KEY. Single use is recorded only after a passkey verified.
 */
async function challengeMac(c: Context<AppEnv>, payload: string): Promise<string> {
  if (!c.env.CHALLENGE_KEY) throw new Error('CHALLENGE_KEY is not set');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(c.env.CHALLENGE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return isoBase64URL.fromBuffer(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))));
}

/** A challenge is signed for one purpose: a sign-in challenge can't be spent on adding a passkey, and back. */
type Purpose = 'login' | 'register';

async function saveChallenge(c: Context<AppEnv>, challenge: string, purpose: Purpose): Promise<string> {
  const expires = Date.now() + CHALLENGE_MINUTES * 60_000;
  return `${challenge}.${expires}.${await challengeMac(c, `${purpose}.${challenge}.${expires}`)}`;
}

/** The challenge inside a valid, unexpired, unused id for this purpose; null otherwise. */
async function takeChallenge(c: Context<AppEnv>, id: string, purpose: Purpose): Promise<string | null> {
  const [challenge, expires, mac, extra] = id.split('.');
  const deadline = Number(expires);
  if (!challenge || !mac || extra !== undefined || !Number.isFinite(deadline) || deadline < Date.now()) return null;
  if (!sameSecret(mac, await challengeMac(c, `${purpose}.${challenge}.${expires}`))) return null;
  const used = await c.env.DB.prepare('SELECT 1 FROM challenges WHERE id = ?').bind(mac).first();
  return used ? null : challenge;
}

/** After a passkey verified: the same challenge can never sign anyone in again. */
async function spendChallenge(c: Context<AppEnv>, id: string): Promise<void> {
  const mac = id.split('.')[2];
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT OR IGNORE INTO challenges (id, challenge, expires_at) VALUES (?, 'used', datetime('now', '+${CHALLENGE_MINUTES} minutes'))`).bind(mac),
    c.env.DB.prepare("DELETE FROM challenges WHERE expires_at <= datetime('now')"),
  ]);
}

interface CredentialRow {
  id: string;
  public_key: string;
  counter: number;
  transports: string | null;
}

async function credentials(c: Context<AppEnv>): Promise<CredentialRow[]> {
  const { results } = await c.env.DB.prepare('SELECT id, public_key, counter, transports FROM credentials').all<CredentialRow>();
  return results;
}

/** "abcd-2345" → "ABCD2345": codes are typed by hand, so case and dashes don't matter. */
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const hashCode = (code: string) => sha256(normalizeCode(code));

/** A one-time device code that exists and hasn't expired (a read only: guessing writes nothing). */
async function validCode(c: Context<AppEnv>, code: string | undefined): Promise<boolean> {
  if (!code || normalizeCode(code).length !== 8) return false;
  const row = await c.env.DB.prepare("SELECT 1 FROM device_codes WHERE code_hash = ? AND expires_at > datetime('now')").bind(await hashCode(code)).first();
  return Boolean(row);
}

/** A passkey can be added while signed in, or on a new device with a one-time code from Settings or `npm run setup-code`. */
async function mayRegister(c: Context<AppEnv>, deviceCode: string | undefined): Promise<boolean> {
  return (await hasSession(c)) || (await validCode(c, deviceCode));
}

const registerOptionsBody = z.object({ deviceCode: z.string().max(20).optional() });
const registerVerifyBody = z.object({
  challengeId: z.string(),
  deviceCode: z.string().max(20).optional(),
  label: z.string().max(60).optional(),
  response: z.custom<RegistrationResponseJSON>((value) => typeof value === 'object' && value !== null),
});
const loginVerifyBody = z.object({
  challengeId: z.string(),
  response: z.custom<AuthenticationResponseJSON>((value) => typeof value === 'object' && value !== null),
});

export const auth = new Hono<AppEnv>()
  .get('/status', async (c) => {
    const bypass = c.env.DEV_AUTH_BYPASS === '1' && isLocalhost(c);
    return c.json({ signedIn: await hasSession(c), hasPasskey: (await credentials(c)).length > 0, bypass });
  })
  .post('/register/options', async (c) => {
    const body = registerOptionsBody.parse(await c.req.json());
    if (!(await mayRegister(c, body.deviceCode))) return c.json({ error: 'That code is wrong or expired' }, 403);
    const { rpID } = relyingParty(c);
    const options = await generateRegistrationOptions({
      rpName: c.env.APP_NAME,
      rpID,
      userName: 'owner',
      userDisplayName: 'Owner',
      userID: USER_ID,
      attestationType: 'none',
      excludeCredentials: (await credentials(c)).map((cred) => ({ id: cred.id })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    return c.json({ options, challengeId: await saveChallenge(c, options.challenge, 'register') });
  })
  .post('/register/verify', async (c) => {
    const body = registerVerifyBody.parse(await c.req.json());
    if (!(await mayRegister(c, body.deviceCode))) return c.json({ error: 'That code is wrong or expired' }, 403);
    const challenge = await takeChallenge(c, body.challengeId, 'register');
    if (!challenge) return c.json({ error: 'Challenge expired, try again' }, 400);
    const { rpID, origin } = relyingParty(c);
    const verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    }).catch((error: Error) => {
      console.warn('passkey registration rejected', error.message);
      return null;
    });
    if (!verification?.verified || !verification.registrationInfo) return c.json({ error: 'Passkey not verified' }, 400);
    await spendChallenge(c, body.challengeId);
    // A device code works once.
    if (body.deviceCode) await c.env.DB.prepare('DELETE FROM device_codes WHERE code_hash = ?').bind(await hashCode(body.deviceCode)).run();
    const { credential } = verification.registrationInfo;
    await c.env.DB.prepare('INSERT INTO credentials (id, public_key, counter, transports, label) VALUES (?, ?, ?, ?, ?)')
      .bind(credential.id, isoBase64URL.fromBuffer(credential.publicKey), credential.counter, JSON.stringify(credential.transports ?? []), body.label ?? deviceOf(c))
      .run();
    await logEvent(c, 'passkey_added', body.label ?? deviceOf(c));
    await startSession(c);
    await logEvent(c, 'sign_in');
    return c.json({ ok: true });
  })
  .post('/login/options', async (c) => {
    const { rpID } = relyingParty(c);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
      allowCredentials: (await credentials(c)).map((cred) => ({ id: cred.id })),
    });
    return c.json({ options, challengeId: await saveChallenge(c, options.challenge, 'login') });
  })
  .post('/login/verify', async (c) => {
    const body = loginVerifyBody.parse(await c.req.json());
    const challenge = await takeChallenge(c, body.challengeId, 'login');
    if (!challenge) return c.json({ error: 'Challenge expired, try again' }, 400);
    const stored = (await credentials(c)).find((cred) => cred.id === body.response.id);
    if (!stored) return c.json({ error: 'Unknown passkey' }, 400);
    const { rpID, origin } = relyingParty(c);
    const verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: stored.id,
        publicKey: isoBase64URL.toBuffer(stored.public_key),
        counter: stored.counter,
        transports: stored.transports ? JSON.parse(stored.transports) : undefined,
      },
    }).catch((error: Error) => {
      // Failed attempts go to the Worker logs only: writing them would let anyone fill the database.
      console.warn('sign-in rejected', error.message);
      return null;
    });
    if (!verification?.verified) return c.json({ error: 'Passkey not verified' }, 400);
    await spendChallenge(c, body.challengeId);
    await c.env.DB.prepare("UPDATE credentials SET counter = ?, last_used_at = datetime('now') WHERE id = ?")
      .bind(verification.authenticationInfo.newCounter, stored.id)
      .run();
    await startSession(c);
    await logEvent(c, 'sign_in');
    return c.json({ ok: true });
  })
  .post('/logout', async (c) => {
    const token = getCookie(c, sessionCookie(c));
    if (token) {
      const id = await sha256(token);
      const known = await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
      if (known.meta.changes) await logEvent(c, 'sign_out');
    }
    deleteCookie(c, sessionCookie(c), { path: '/', secure: new URL(c.req.url).protocol === 'https:' });
    return c.json({ ok: true });
  });
