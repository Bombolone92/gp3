/**
 * Synchronous SHA-1 and SHA-2 for key derivations that hash thousands of times in a row
 * (PKCS#12), where one asynchronous Web Crypto call per round would take seconds.
 */

function pad(bytes, blockSize, lengthBytes) {
  const length = bytes.length;
  const total = Math.ceil((length + 1 + lengthBytes) / blockSize) * blockSize;
  const out = new Uint8Array(total);
  out.set(bytes);
  out[length] = 0x80;
  const view = new DataView(out.buffer);
  view.setUint32(total - 4, (length * 8) >>> 0);
  view.setUint32(total - 8, Math.floor(length / 0x20000000));
  return out;
}

export function sha1(bytes) {
  const data = pad(bytes, 64, 8);
  const view = new DataView(data.buffer);
  let h0 = 0x67452301,
    h1 = 0xefcdab89,
    h2 = 0x98badcfe,
    h3 = 0x10325476,
    h4 = 0xc3d2e1f0;
  const w = new Int32Array(80);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => outView.setInt32(i * 4, h));
  return out;
}

// prettier-ignore
const K256 = new Int32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);

export function sha256(bytes) {
  const data = pad(bytes, 64, 8);
  const view = new DataView(data.buffer);
  const h = new Int32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Int32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setInt32(i * 4, h[i]);
  return out;
}

// prettier-ignore
const K512 = new Int32Array([
  0x428a2f98,0xd728ae22,0x71374491,0x23ef65cd,0xb5c0fbcf,0xec4d3b2f,0xe9b5dba5,0x8189dbbc,0x3956c25b,0xf348b538,0x59f111f1,0xb605d019,0x923f82a4,0xaf194f9b,0xab1c5ed5,0xda6d8118,
  0xd807aa98,0xa3030242,0x12835b01,0x45706fbe,0x243185be,0x4ee4b28c,0x550c7dc3,0xd5ffb4e2,0x72be5d74,0xf27b896f,0x80deb1fe,0x3b1696b1,0x9bdc06a7,0x25c71235,0xc19bf174,0xcf692694,
  0xe49b69c1,0x9ef14ad2,0xefbe4786,0x384f25e3,0x0fc19dc6,0x8b8cd5b5,0x240ca1cc,0x77ac9c65,0x2de92c6f,0x592b0275,0x4a7484aa,0x6ea6e483,0x5cb0a9dc,0xbd41fbd4,0x76f988da,0x831153b5,
  0x983e5152,0xee66dfab,0xa831c66d,0x2db43210,0xb00327c8,0x98fb213f,0xbf597fc7,0xbeef0ee4,0xc6e00bf3,0x3da88fc2,0xd5a79147,0x930aa725,0x06ca6351,0xe003826f,0x14292967,0x0a0e6e70,
  0x27b70a85,0x46d22ffc,0x2e1b2138,0x5c26c926,0x4d2c6dfc,0x5ac42aed,0x53380d13,0x9d95b3df,0x650a7354,0x8baf63de,0x766a0abb,0x3c77b2a8,0x81c2c92e,0x47edaee6,0x92722c85,0x1482353b,
  0xa2bfe8a1,0x4cf10364,0xa81a664b,0xbc423001,0xc24b8b70,0xd0f89791,0xc76c51a3,0x0654be30,0xd192e819,0xd6ef5218,0xd6990624,0x5565a910,0xf40e3585,0x5771202a,0x106aa070,0x32bbd1b8,
  0x19a4c116,0xb8d2d0c8,0x1e376c08,0x5141ab53,0x2748774c,0xdf8eeb99,0x34b0bcb5,0xe19b48a8,0x391c0cb3,0xc5c95a63,0x4ed8aa4a,0xe3418acb,0x5b9cca4f,0x7763e373,0x682e6ff3,0xd6b2b8a3,
  0x748f82ee,0x5defb2fc,0x78a5636f,0x43172f60,0x84c87814,0xa1f0ab72,0x8cc70208,0x1a6439ec,0x90befffa,0x23631e28,0xa4506ceb,0xde82bde9,0xbef9a3f7,0xb2c67915,0xc67178f2,0xe372532b,
  0xca273ece,0xea26619c,0xd186b8c7,0x21c0c207,0xeada7dd6,0xcde0eb1e,0xf57d4f7f,0xee6ed178,0x06f067aa,0x72176fba,0x0a637dc5,0xa2c898a6,0x113f9804,0xbef90dae,0x1b710b35,0x131c471b,
  0x28db77f5,0x23047d84,0x32caab7b,0x40c72493,0x3c9ebe0a,0x15c9bebc,0x431d67c4,0x9c100d4c,0x4cc5d4be,0xcb3e42b6,0x597f299c,0xfc657e2a,0x5fcb6fab,0x3ad6faec,0x6c44198c,0x4a475817,
]);
// prettier-ignore
const IV512 = [0x6a09e667,0xf3bcc908,0xbb67ae85,0x84caa73b,0x3c6ef372,0xfe94f82b,0xa54ff53a,0x5f1d36f1,0x510e527f,0xade682d1,0x9b05688c,0x2b3e6c1f,0x1f83d9ab,0xfb41bd6b,0x5be0cd19,0x137e2179];
// prettier-ignore
const IV384 = [0xcbbb9d5d,0xc1059ed8,0x629a292a,0x367cd507,0x9159015a,0x3070dd17,0x152fecd8,0xf70e5939,0x67332667,0xffc00b31,0x8eb44a87,0x68581511,0xdb0c2e0d,0x64f98fa7,0x47b5481d,0xbefa4fa4];

/** SHA-512 (and SHA-384) on pairs of 32-bit words: high word at even, low word at odd index. */
export function sha512(bytes, variant = 512) {
  const data = pad(bytes, 128, 16);
  const view = new DataView(data.buffer);
  const h = Int32Array.from(variant === 384 ? IV384 : IV512);
  const w = new Int32Array(160);
  const v = new Int32Array(16);
  // 64-bit rotate right / shift right of (hi, lo), returning hi and lo separately.
  const rotrHi = (hi, lo, n) =>
    n < 32 ? (hi >>> n) | (lo << (32 - n)) : (lo >>> (n - 32)) | (hi << (64 - n));
  const rotrLo = (hi, lo, n) =>
    n < 32 ? (lo >>> n) | (hi << (32 - n)) : (hi >>> (n - 32)) | (lo << (64 - n));
  const shrHi = (hi, lo, n) => hi >>> n;
  const shrLo = (hi, lo, n) => (lo >>> n) | (hi << (32 - n));
  for (let offset = 0; offset < data.length; offset += 128) {
    for (let i = 0; i < 32; i++) w[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 80; i++) {
      const xh = w[(i - 15) * 2],
        xl = w[(i - 15) * 2 + 1];
      const yh = w[(i - 2) * 2],
        yl = w[(i - 2) * 2 + 1];
      const s0h = rotrHi(xh, xl, 1) ^ rotrHi(xh, xl, 8) ^ shrHi(xh, xl, 7);
      const s0l = rotrLo(xh, xl, 1) ^ rotrLo(xh, xl, 8) ^ shrLo(xh, xl, 7);
      const s1h = rotrHi(yh, yl, 19) ^ rotrHi(yh, yl, 61) ^ shrHi(yh, yl, 6);
      const s1l = rotrLo(yh, yl, 19) ^ rotrLo(yh, yl, 61) ^ shrLo(yh, yl, 6);
      let lo = (w[(i - 16) * 2 + 1] >>> 0) + (s0l >>> 0) + (w[(i - 7) * 2 + 1] >>> 0) + (s1l >>> 0);
      let hi = w[(i - 16) * 2] + s0h + w[(i - 7) * 2] + s1h + Math.floor(lo / 0x100000000);
      w[i * 2] = hi | 0;
      w[i * 2 + 1] = lo | 0;
    }
    v.set(h);
    for (let i = 0; i < 80; i++) {
      const ah = v[0],
        al = v[1],
        bh = v[2],
        bl = v[3],
        ch = v[4],
        cl = v[5],
        dh = v[6],
        dl = v[7];
      const eh = v[8],
        el = v[9],
        fh = v[10],
        fl = v[11],
        gh = v[12],
        gl = v[13],
        hh = v[14],
        hl = v[15];
      const S1h = rotrHi(eh, el, 14) ^ rotrHi(eh, el, 18) ^ rotrHi(eh, el, 41);
      const S1l = rotrLo(eh, el, 14) ^ rotrLo(eh, el, 18) ^ rotrLo(eh, el, 41);
      const chh = (eh & fh) ^ (~eh & gh);
      const chl = (el & fl) ^ (~el & gl);
      let t1l =
        (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + (K512[i * 2 + 1] >>> 0) + (w[i * 2 + 1] >>> 0);
      let t1h = hh + S1h + chh + K512[i * 2] + w[i * 2] + Math.floor(t1l / 0x100000000);
      t1l |= 0;
      t1h |= 0;
      const S0h = rotrHi(ah, al, 28) ^ rotrHi(ah, al, 34) ^ rotrHi(ah, al, 39);
      const S0l = rotrLo(ah, al, 28) ^ rotrLo(ah, al, 34) ^ rotrLo(ah, al, 39);
      const majh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
      const majl = (al & bl) ^ (al & cl) ^ (bl & cl);
      const t2l = (S0l >>> 0) + (majl >>> 0);
      const t2h = S0h + majh + Math.floor(t2l / 0x100000000);
      v[14] = gh;
      v[15] = gl;
      v[12] = fh;
      v[13] = fl;
      v[10] = eh;
      v[11] = el;
      const el2 = (dl >>> 0) + (t1l >>> 0);
      v[8] = dh + t1h + Math.floor(el2 / 0x100000000);
      v[9] = el2 | 0;
      v[6] = ch;
      v[7] = cl;
      v[4] = bh;
      v[5] = bl;
      v[2] = ah;
      v[3] = al;
      const al2 = (t1l >>> 0) + (t2l >>> 0);
      v[0] = t1h + t2h + Math.floor(al2 / 0x100000000);
      v[1] = al2 | 0;
    }
    for (let i = 0; i < 16; i += 2) {
      const lo = (h[i + 1] >>> 0) + (v[i + 1] >>> 0);
      h[i] = h[i] + v[i] + Math.floor(lo / 0x100000000);
      h[i + 1] = lo | 0;
    }
  }
  const out = new Uint8Array(64);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) outView.setInt32(i * 4, h[i]);
  return variant === 384 ? out.subarray(0, 48) : out;
}

/** Hash synchronously by Web Crypto name. */
export function hashSync(name, bytes) {
  switch (name) {
    case 'SHA-1':
      return sha1(bytes);
    case 'SHA-256':
      return sha256(bytes);
    case 'SHA-384':
      return sha512(bytes, 384);
    case 'SHA-512':
      return sha512(bytes, 512);
    default:
      throw new Error(`Unsupported hash ${name}.`);
  }
}
