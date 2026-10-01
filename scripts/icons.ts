/**
 * Draws the app icons (PNG) without image libraries: dark tile, three light bars and one blue bar,
 * the same mark as the in-app logo. 4×4 supersampling for smooth edges.
 * Run: node scripts/icons.ts
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BACKGROUND = [11, 11, 11];
const LIGHT = [249, 249, 247];
const BLUE = [42, 120, 214];
// [x, yTop, yBottom, color] in a 32×32 design space; bars are capsules 2.6 wide.
const BARS: [number, number, number, number[]][] = [
  [8, 17, 22.5, LIGHT],
  [13.4, 12, 22.5, LIGHT],
  [18.7, 15.5, 22.5, LIGHT],
  [24, 9.5, 22.5, BLUE],
];
const RADIUS = 1.3;

function colorAt(x: number, y: number): number[] {
  for (const [bx, top, bottom, color] of BARS) {
    const cy = Math.min(Math.max(y, top), bottom);
    if ((x - bx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2) return color;
  }
  return BACKGROUND;
}

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC = crcTable();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function png(size: number, scale = 1): Uint8Array {
  const raw = new Uint8Array(size * (size * 3 + 1));
  const samples = 4;
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          // Map pixel to the 32-unit design space; scale < 1 shrinks the mark toward the centre.
          const x = 16 + (((px + (sx + 0.5) / samples) / size) * 32 - 16) / scale;
          const y = 16 + (((py + (sy + 0.5) / samples) / size) * 32 - 16) / scale;
          const c = colorAt(x, y);
          for (let k = 0; k < 3; k++) sum[k] += c[k];
        }
      }
      for (let k = 0; k < 3; k++) raw[py * (size * 3 + 1) + 1 + px * 3 + k] = Math.round(sum[k] / samples ** 2);
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [signature, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const publicDir = new URL('../public/', import.meta.url).pathname;
writeFileSync(`${publicDir}icon-192.png`, png(192));
writeFileSync(`${publicDir}icon-512.png`, png(512));
writeFileSync(`${publicDir}apple-touch-icon.png`, png(180));
// Maskable: keep the mark inside the 80% safe zone.
writeFileSync(`${publicDir}icon-maskable-512.png`, png(512, 0.8));
console.log('icons written to public/');
