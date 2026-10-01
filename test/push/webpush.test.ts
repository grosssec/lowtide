import { describe, expect, it } from 'vitest';
import { encryptPayload, fromBase64Url, generateVapidKeys, toBase64Url, vapidAuthorization } from '../../shared/push/webpush.ts';

const encoder = new TextEncoder();

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) {
  const prk = await hmac(salt, ikm);
  const block = new Uint8Array(info.length + 1);
  block.set(info);
  block[info.length] = 1;
  return (await hmac(prk, block)).slice(0, length);
}

/** What the browser does: decrypt with the device's private key (RFC 8291), written independently of the sender. */
async function decryptLikeTheBrowser(body: Uint8Array<ArrayBuffer>, device: CryptoKeyPair, devicePublic: Uint8Array<ArrayBuffer>, auth: Uint8Array<ArrayBuffer>) {
  const salt = body.slice(0, 16);
  const idLength = body[20];
  const senderPublic = body.slice(21, 21 + idLength);
  const ciphertext = body.slice(21 + idLength);
  const senderKey = await crypto.subtle.importKey('raw', senderPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: senderKey }, device.privateKey, 256));
  const info = new Uint8Array([...encoder.encode('WebPush: info\0'), ...devicePublic, ...senderPublic]);
  const ikm = await hkdf(auth, shared, info, 32);
  const key = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, ciphertext));
  expect(plain[plain.length - 1]).toBe(2); // last-record delimiter
  return new TextDecoder().decode(plain.slice(0, -1));
}

describe('web push', () => {
  it('round-trips base64url', () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });

  it('encrypts a message only the device can read', async () => {
    const device = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const devicePublic = new Uint8Array(await crypto.subtle.exportKey('raw', device.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const message = JSON.stringify({ title: 'Balance $1,234 · Available $56', body: 'Rent $300 on Oct 7' });
    const body = await encryptPayload({ endpoint: 'https://push.example/x', p256dh: toBase64Url(devicePublic), auth: toBase64Url(auth) }, message);
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(await decryptLikeTheBrowser(body, device, devicePublic, auth)).toBe(message);
  });

  it('signs a VAPID token the push service can verify', async () => {
    const keys = await generateVapidKeys();
    const header = await vapidAuthorization('https://web.push.apple.com/abc', keys, 'https://finance.example', 1_790_000_000_000);
    const [, token, publicKey] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(publicKey).toBe(keys.publicKey);
    const [h, p, s] = token.split('.');
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(p)))).toEqual({ aud: 'https://web.push.apple.com', exp: 1_790_043_200, sub: 'https://finance.example' });
    const verifyKey = await crypto.subtle.importKey('raw', fromBase64Url(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, fromBase64Url(s), encoder.encode(`${h}.${p}`));
    expect(valid).toBe(true);
  });
});
