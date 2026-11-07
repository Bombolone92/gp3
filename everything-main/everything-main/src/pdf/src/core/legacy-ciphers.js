/**
 * The block ciphers of older PKCS#12 files: DES, Triple DES (EDE) and RC2 (RFC 2268), in CBC
 * mode. OpenSSL 1.x, Windows and the macOS Keychain export digital IDs with them, and Web
 * Crypto implements neither, so they are here in plain JavaScript.
 */

/* ---------- DES (FIPS 46-3) ---------- */
// prettier-ignore
const IP = [58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7];
// prettier-ignore
const FP = [40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25];
// prettier-ignore
const E = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1];
// prettier-ignore
const P = [16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25];
// prettier-ignore
const PC1 = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4];
// prettier-ignore
const PC2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32];
const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
// prettier-ignore
const S = [
  [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
  [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
  [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
  [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
  [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
  [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
  [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
  [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11],
];

const toBits = (bytes, offset, count) => {
  const bits = new Uint8Array(count * 8);
  for (let i = 0; i < bits.length; i++) bits[i] = (bytes[offset + (i >> 3)] >> (7 - (i & 7))) & 1;
  return bits;
};
const permute = (bits, table) => Uint8Array.from(table, (position) => bits[position - 1]);

/** The sixteen 48-bit round keys of an 8-byte DES key. */
function desSchedule(key) {
  const cd = permute(toBits(key, 0, 8), PC1);
  let c = Array.from(cd.subarray(0, 28));
  let d = Array.from(cd.subarray(28));
  return SHIFTS.map((shift) => {
    c = c.slice(shift).concat(c.slice(0, shift));
    d = d.slice(shift).concat(d.slice(0, shift));
    return permute(Uint8Array.from([...c, ...d]), PC2);
  });
}

const blockBits = new Uint8Array(64);
const permuted = new Uint8Array(64);
const halves = new Uint8Array(64);
const expanded = new Uint8Array(48);
const sOut = new Uint8Array(32);
const fOut = new Uint8Array(32);
function desBlock(schedule, input, inOffset, output, outOffset, decrypt) {
  for (let i = 0; i < 64; i++) blockBits[i] = (input[inOffset + (i >> 3)] >> (7 - (i & 7))) & 1;
  for (let i = 0; i < 64; i++) permuted[i] = blockBits[IP[i] - 1];
  // permuted[0..31] is L, permuted[32..63] is R; rounds swap the halves in place.
  const left = permuted.subarray(0, 32);
  const right = permuted.subarray(32);
  for (let round = 0; round < 16; round++) {
    const k = schedule[decrypt ? 15 - round : round];
    for (let i = 0; i < 48; i++) expanded[i] = right[E[i] - 1] ^ k[i];
    for (let box = 0, b = 0; box < 8; box++, b += 6) {
      const row = (expanded[b] << 1) | expanded[b + 5];
      const col =
        (expanded[b + 1] << 3) | (expanded[b + 2] << 2) | (expanded[b + 3] << 1) | expanded[b + 4];
      const value = S[box][row * 16 + col];
      sOut[box * 4] = (value >> 3) & 1;
      sOut[box * 4 + 1] = (value >> 2) & 1;
      sOut[box * 4 + 2] = (value >> 1) & 1;
      sOut[box * 4 + 3] = value & 1;
    }
    for (let i = 0; i < 32; i++) fOut[i] = left[i] ^ sOut[P[i] - 1];
    left.set(right);
    right.set(fOut);
  }
  halves.set(right, 0);
  halves.set(left, 32);
  for (let i = 0; i < 8; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | halves[FP[i * 8 + j] - 1];
    output[outOffset + i] = byte;
  }
}

/** A DES or Triple-DES (8, 16 or 24 byte key, EDE) block cipher. */
function desCipher(key) {
  if (key.length === 8) {
    const k = desSchedule(key);
    return {
      encrypt: (i, io, o, oo) => desBlock(k, i, io, o, oo, false),
      decrypt: (i, io, o, oo) => desBlock(k, i, io, o, oo, true),
    };
  }
  if (key.length !== 16 && key.length !== 24)
    throw new Error('Triple DES keys are 16 or 24 bytes.');
  const k1 = desSchedule(key.subarray(0, 8));
  const k2 = desSchedule(key.subarray(8, 16));
  const k3 = key.length === 24 ? desSchedule(key.subarray(16, 24)) : k1;
  const tmp = new Uint8Array(8);
  const tmp2 = new Uint8Array(8);
  return {
    encrypt(input, io, output, oo) {
      desBlock(k1, input, io, tmp, 0, false);
      desBlock(k2, tmp, 0, tmp2, 0, true);
      desBlock(k3, tmp2, 0, output, oo, false);
    },
    decrypt(input, io, output, oo) {
      desBlock(k3, input, io, tmp, 0, true);
      desBlock(k2, tmp, 0, tmp2, 0, false);
      desBlock(k1, tmp2, 0, output, oo, true);
    },
  };
}

/* ---------- RC2 (RFC 2268) ---------- */
// prettier-ignore
const PITABLE = Uint8Array.from([
  0xd9,0x78,0xf9,0xc4,0x19,0xdd,0xb5,0xed,0x28,0xe9,0xfd,0x79,0x4a,0xa0,0xd8,0x9d,
  0xc6,0x7e,0x37,0x83,0x2b,0x76,0x53,0x8e,0x62,0x4c,0x64,0x88,0x44,0x8b,0xfb,0xa2,
  0x17,0x9a,0x59,0xf5,0x87,0xb3,0x4f,0x13,0x61,0x45,0x6d,0x8d,0x09,0x81,0x7d,0x32,
  0xbd,0x8f,0x40,0xeb,0x86,0xb7,0x7b,0x0b,0xf0,0x95,0x21,0x22,0x5c,0x6b,0x4e,0x82,
  0x54,0xd6,0x65,0x93,0xce,0x60,0xb2,0x1c,0x73,0x56,0xc0,0x14,0xa7,0x8c,0xf1,0xdc,
  0x12,0x75,0xca,0x1f,0x3b,0xbe,0xe4,0xd1,0x42,0x3d,0xd4,0x30,0xa3,0x3c,0xb6,0x26,
  0x6f,0xbf,0x0e,0xda,0x46,0x69,0x07,0x57,0x27,0xf2,0x1d,0x9b,0xbc,0x94,0x43,0x03,
  0xf8,0x11,0xc7,0xf6,0x90,0xef,0x3e,0xe7,0x06,0xc3,0xd5,0x2f,0xc8,0x66,0x1e,0xd7,
  0x08,0xe8,0xea,0xde,0x80,0x52,0xee,0xf7,0x84,0xaa,0x72,0xac,0x35,0x4d,0x6a,0x2a,
  0x96,0x1a,0xd2,0x71,0x5a,0x15,0x49,0x74,0x4b,0x9f,0xd0,0x5e,0x04,0x18,0xa4,0xec,
  0xc2,0xe0,0x41,0x6e,0x0f,0x51,0xcb,0xcc,0x24,0x91,0xaf,0x50,0xa1,0xf4,0x70,0x39,
  0x99,0x7c,0x3a,0x85,0x23,0xb8,0xb4,0x7a,0xfc,0x02,0x36,0x5b,0x25,0x55,0x97,0x31,
  0x2d,0x5d,0xfa,0x98,0xe3,0x8a,0x92,0xae,0x05,0xdf,0x29,0x10,0x67,0x6c,0xba,0xc9,
  0xd3,0x00,0xe6,0xcf,0xe1,0x9e,0xa8,0x2c,0x63,0x16,0x01,0x3f,0x58,0xe2,0x89,0xa9,
  0x0d,0x38,0x34,0x1b,0xab,0x33,0xff,0xb0,0xbb,0x48,0x0c,0x5f,0xb9,0xb1,0xcd,0x2e,
  0xc5,0xf3,0xdb,0x47,0xe5,0xa5,0x9c,0x77,0x0a,0xa6,0x20,0x68,0xfe,0x7f,0xc1,0xad,
]);

function rc2Schedule(key, effectiveBits) {
  const T = key.length;
  if (T < 1 || T > 128) throw new Error('RC2 keys are 1 to 128 bytes.');
  const L = new Uint8Array(128);
  L.set(key);
  for (let i = T; i < 128; i++) L[i] = PITABLE[(L[i - 1] + L[i - T]) & 0xff];
  const T8 = Math.ceil(effectiveBits / 8);
  const TM = 0xff >> (8 * T8 - effectiveBits);
  L[128 - T8] = PITABLE[L[128 - T8] & TM];
  for (let i = 127 - T8; i >= 0; i--) L[i] = PITABLE[L[i + 1] ^ L[i + T8]];
  const K = new Uint16Array(64);
  for (let i = 0; i < 64; i++) K[i] = L[2 * i] | (L[2 * i + 1] << 8);
  return K;
}

const ROTATIONS = [1, 2, 3, 5];
function rc2Cipher(key, effectiveBits) {
  const K = rc2Schedule(key, effectiveBits);
  const R = new Uint16Array(4);
  const load = (input, offset) => {
    for (let i = 0; i < 4; i++) R[i] = input[offset + 2 * i] | (input[offset + 2 * i + 1] << 8);
  };
  const store = (output, offset) => {
    for (let i = 0; i < 4; i++) {
      output[offset + 2 * i] = R[i] & 0xff;
      output[offset + 2 * i + 1] = R[i] >> 8;
    }
  };
  return {
    encrypt(input, io, output, oo) {
      load(input, io);
      let j = 0;
      const mix = () => {
        for (let i = 0; i < 4; i++) {
          let r =
            (R[i] +
              K[j++] +
              (R[(i + 3) & 3] & R[(i + 2) & 3]) +
              (~R[(i + 3) & 3] & R[(i + 1) & 3])) &
            0xffff;
          r = ((r << ROTATIONS[i]) | (r >> (16 - ROTATIONS[i]))) & 0xffff;
          R[i] = r;
        }
      };
      const mash = () => {
        for (let i = 0; i < 4; i++) R[i] = (R[i] + K[R[(i + 3) & 3] & 63]) & 0xffff;
      };
      for (let n = 0; n < 5; n++) mix();
      mash();
      for (let n = 0; n < 6; n++) mix();
      mash();
      for (let n = 0; n < 5; n++) mix();
      store(output, oo);
    },
    decrypt(input, io, output, oo) {
      load(input, io);
      let j = 63;
      const rmix = () => {
        for (let i = 3; i >= 0; i--) {
          let r = R[i];
          r = ((r >> ROTATIONS[i]) | (r << (16 - ROTATIONS[i]))) & 0xffff;
          R[i] =
            (r - K[j--] - (R[(i + 3) & 3] & R[(i + 2) & 3]) - (~R[(i + 3) & 3] & R[(i + 1) & 3])) &
            0xffff;
        }
      };
      const rmash = () => {
        for (let i = 3; i >= 0; i--) R[i] = (R[i] - K[R[(i + 3) & 3] & 63]) & 0xffff;
      };
      for (let n = 0; n < 5; n++) rmix();
      rmash();
      for (let n = 0; n < 6; n++) rmix();
      rmash();
      for (let n = 0; n < 5; n++) rmix();
      store(output, oo);
    },
  };
}

/* ---------- CBC with PKCS#7 padding ---------- */
export class PaddingError extends Error {
  constructor() {
    super('Decryption failed (bad padding).');
    this.code = 'padding';
  }
}

function cbcEncrypt(cipher, iv, data) {
  const pad = 8 - (data.length % 8);
  const input = new Uint8Array(data.length + pad);
  input.set(data);
  input.fill(pad, data.length);
  const out = new Uint8Array(input.length);
  const block = new Uint8Array(8);
  let previous = iv;
  for (let offset = 0; offset < input.length; offset += 8) {
    for (let i = 0; i < 8; i++) block[i] = input[offset + i] ^ previous[i];
    cipher.encrypt(block, 0, out, offset);
    previous = out.subarray(offset, offset + 8);
  }
  return out;
}
function cbcDecrypt(cipher, iv, data) {
  if (!data.length || data.length % 8) throw new PaddingError();
  const out = new Uint8Array(data.length);
  for (let offset = 0; offset < data.length; offset += 8) {
    cipher.decrypt(data, offset, out, offset);
    const previous = offset ? data.subarray(offset - 8, offset) : iv;
    for (let i = 0; i < 8; i++) out[offset + i] ^= previous[i];
  }
  const pad = out[out.length - 1];
  if (pad < 1 || pad > 8) throw new PaddingError();
  for (let i = out.length - pad; i < out.length; i++) if (out[i] !== pad) throw new PaddingError();
  return out.subarray(0, out.length - pad);
}

export const desCbcEncrypt = (key, iv, data) => cbcEncrypt(desCipher(key), iv, data);
export const desCbcDecrypt = (key, iv, data) => cbcDecrypt(desCipher(key), iv, data);
export const rc2CbcEncrypt = (key, iv, data, effectiveBits = key.length * 8) =>
  cbcEncrypt(rc2Cipher(key, effectiveBits), iv, data);
export const rc2CbcDecrypt = (key, iv, data, effectiveBits = key.length * 8) =>
  cbcDecrypt(rc2Cipher(key, effectiveBits), iv, data);
/** Raw single-block operations, for known-answer tests. */
export function desEncryptBlock(key, block) {
  const out = new Uint8Array(8);
  desCipher(key).encrypt(block, 0, out, 0);
  return out;
}
export function rc2EncryptBlock(key, block, effectiveBits = key.length * 8) {
  const out = new Uint8Array(8);
  rc2Cipher(key, effectiveBits).encrypt(block, 0, out, 0);
  return out;
}
