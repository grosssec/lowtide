/**
 * Web Push without libraries (WebCrypto only, so it runs in Workers and Node):
 * VAPID authorization (RFC 8292) and aes128gcm payload encryption (RFC 8291 / RFC 8188).
 * The message is encrypted for the device; the push service only relays bytes.
 */

const encoder = new TextEncoder();
/** Typed for both the DOM lib (Node, browser, tests) and the Workers runtime types, whose WebCrypto signatures differ slightly. */
const utf8 = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(encoder.encode(text));
type DeriveBitsAlgorithm = Parameters<typeof crypto.subtle.deriveBits>[0];

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/** HKDF (RFC 5869) with one expand block: enough for keys up to 32 bytes. */
async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url (the browser's applicationServerKey). */
  publicKey: string;
  privateJwk: JsonWebKey;
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  return { publicKey: toBase64Url(raw), privateJwk: (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey };
}

/** Authorization header for one push service (the JWT audience is the endpoint's origin). */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): Promise<string> {
  const header = toBase64Url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject };
  const payload = toBase64Url(utf8(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto returns r||s (IEEE P1363), which is exactly what JWS ES256 expects.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${header}.${payload}`)));
  return `vapid t=${header}.${payload}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}

export interface PushSubscriptionKeys {
  endpoint: string;
  /** Device public key (base64url). */
  p256dh: string;
  /** Device auth secret (base64url). */
  auth: string;
}

/** Encrypts a payload for one device: returns the aes128gcm body (header + ciphertext). */
export async function encryptPayload(subscription: PushSubscriptionKeys, plaintext: string): Promise<Uint8Array<ArrayBuffer>> {
  const devicePublic = fromBase64Url(subscription.p256dh);
  const authSecret = fromBase64Url(subscription.auth);
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const localPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer);
  const deviceKey = await crypto.subtle.importKey('raw', devicePublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = { name: 'ECDH', public: deviceKey } as unknown as DeriveBitsAlgorithm;
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, local.privateKey, 256));

  const keyInfo = concat(utf8('WebPush: info\0'), devicePublic, localPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const contentKey = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt']);
  // One record: the plaintext followed by the 0x02 "last record" delimiter.
  const record = concat(utf8(plaintext), new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record));

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = localPublic.length;
  return concat(header, localPublic, ciphertext);
}

/** Sends one encrypted message. Returns the push service status (404/410 = subscription gone). */
export async function sendPush(subscription: PushSubscriptionKeys, message: unknown, keys: VapidKeys, subject: string): Promise<number> {
  const body = await encryptPayload(subscription, JSON.stringify(message));
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(subscription.endpoint, keys, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
  });
  return response.status;
}
