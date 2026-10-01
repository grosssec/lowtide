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

const SESSION_COOKIE = 'fd_session';
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

/** Constant-time comparison for the one-time setup token. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function hasSession(c: Context<AppEnv>): Promise<boolean> {
  if (c.env.DEV_AUTH_BYPASS === '1' && isLocalhost(c)) return true;
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return false;
  const row = await c.env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND expires_at > datetime('now')")
    .bind(await sha256(token))
    .first();
  return Boolean(row);
}

async function startSession(c: Context<AppEnv>): Promise<void> {
  const token = randomToken();
  await c.env.DB.prepare(`INSERT INTO sessions (id, expires_at) VALUES (?, datetime('now', '+${SESSION_DAYS} days'))`)
    .bind(await sha256(token))
    .run();
  await c.env.DB.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

async function saveChallenge(c: Context<AppEnv>, challenge: string): Promise<string> {
  const id = randomToken();
  await c.env.DB.prepare(`INSERT INTO challenges (id, challenge, expires_at) VALUES (?, ?, datetime('now', '+${CHALLENGE_MINUTES} minutes'))`)
    .bind(id, challenge)
    .run();
  await c.env.DB.prepare("DELETE FROM challenges WHERE expires_at <= datetime('now')").run();
  return id;
}

/** Challenges are single use: read and delete in one go. */
async function takeChallenge(c: Context<AppEnv>, id: string): Promise<string | null> {
  const row = await c.env.DB.prepare("SELECT challenge FROM challenges WHERE id = ? AND expires_at > datetime('now')")
    .bind(id)
    .first<{ challenge: string }>();
  await c.env.DB.prepare('DELETE FROM challenges WHERE id = ?').bind(id).run();
  return row?.challenge ?? null;
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

/** The first passkey needs the one-time SETUP_TOKEN; more passkeys can only be added while signed in. */
async function mayRegister(c: Context<AppEnv>, setupToken: string | undefined): Promise<boolean> {
  if ((await credentials(c)).length > 0) return hasSession(c);
  return Boolean(c.env.SETUP_TOKEN) && Boolean(setupToken) && sameSecret(setupToken!, c.env.SETUP_TOKEN);
}

const registerOptionsBody = z.object({ setupToken: z.string().optional() });
const registerVerifyBody = z.object({
  challengeId: z.string(),
  setupToken: z.string().optional(),
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
    if (!(await mayRegister(c, body.setupToken))) return c.json({ error: 'Not allowed' }, 403);
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
    return c.json({ options, challengeId: await saveChallenge(c, options.challenge) });
  })
  .post('/register/verify', async (c) => {
    const body = registerVerifyBody.parse(await c.req.json());
    if (!(await mayRegister(c, body.setupToken))) return c.json({ error: 'Not allowed' }, 403);
    const challenge = await takeChallenge(c, body.challengeId);
    if (!challenge) return c.json({ error: 'Challenge expired, try again' }, 400);
    const { rpID, origin } = relyingParty(c);
    const verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) return c.json({ error: 'Passkey not verified' }, 400);
    const { credential } = verification.registrationInfo;
    await c.env.DB.prepare('INSERT INTO credentials (id, public_key, counter, transports, label) VALUES (?, ?, ?, ?, ?)')
      .bind(credential.id, isoBase64URL.fromBuffer(credential.publicKey), credential.counter, JSON.stringify(credential.transports ?? []), body.label ?? null)
      .run();
    await startSession(c);
    return c.json({ ok: true });
  })
  .post('/login/options', async (c) => {
    const { rpID } = relyingParty(c);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
      allowCredentials: (await credentials(c)).map((cred) => ({ id: cred.id })),
    });
    return c.json({ options, challengeId: await saveChallenge(c, options.challenge) });
  })
  .post('/login/verify', async (c) => {
    const body = loginVerifyBody.parse(await c.req.json());
    const challenge = await takeChallenge(c, body.challengeId);
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
    });
    if (!verification.verified) return c.json({ error: 'Passkey not verified' }, 400);
    await c.env.DB.prepare('UPDATE credentials SET counter = ? WHERE id = ?')
      .bind(verification.authenticationInfo.newCounter, stored.id)
      .run();
    await startSession(c);
    return c.json({ ok: true });
  })
  .post('/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run();
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });
