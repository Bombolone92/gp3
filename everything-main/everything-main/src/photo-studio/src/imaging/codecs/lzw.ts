// Variable-width LZW as used by TIFF (TIFF 6.0 section 13) and GIF (GIF89a
// appendix F). The two differ only in bit order, the minimum code size and
// when the code width grows:
// - TIFF packs codes MSB-first, always starts at 9 bits and switches width one
//   code "early": the decoder widens when its next free code reaches 2^w - 1.
//   Encoders reset the table at 4094 entries like libtiff so every reader agrees.
// - GIF packs codes LSB-first, starts at minCodeSize + 1 bits and widens when
//   the next free code reaches 2^w.
// The encoder is one entry ahead of the decoder, which is why its width tests
// below are shifted by one relative to the decoder's.

export type LzwVariant = 'tiff' | 'gif';

let dict: Uint16Array | undefined;
let dictKeys: Int32Array | undefined;

export function lzwEncode(data: Uint8Array, variant: LzwVariant, minCodeSize = 8): Uint8Array {
  const tiff = variant === 'tiff';
  if (tiff) minCodeSize = 8;
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const first = clear + 2;
  const n = data.length;
  // (prefix << 8 | byte) -> code; 0 marks an empty slot because codes are >= first.
  // Reused across calls and cleared through the list of inserted keys, since
  // TIFF strips call this hundreds of times per image.
  if (!dict) {
    dict = new Uint16Array(4096 << 8);
    dictKeys = new Int32Array(4096);
  }
  const table = dict;
  const keys = dictKeys!;
  // At most one code of <= 12 bits per input byte, plus clears and EOI.
  const out = new Uint8Array(n + (n >> 1) + (n >> 9) + 64);
  let nk = 0;
  let op = 0;
  let acc = 0;
  let bits = 0;
  let width = minCodeSize + 1;
  let next = first;
  // Codes are packed inline (no helper closure) because this loop dominates
  // TIFF export time. Uint8Array stores keep only the low 8 bits, and bits
  // above the pending ones in `acc` are never read, so no masking is needed.
  let code = clear;
  let w = width;
  let pending = 1; // codes queued in code/w for the packer below
  let i = 1;
  let prefix = n > 0 ? data[0] & (clear - 1) : 0;
  const symMask = clear - 1;
  for (;;) {
    if (pending) {
      if (tiff) {
        acc = (acc << w) | code;
        bits += w;
        while (bits >= 8) {
          bits -= 8;
          out[op++] = acc >>> bits;
        }
      } else {
        acc |= code << bits;
        bits += w;
        while (bits >= 8) {
          out[op++] = acc;
          acc >>>= 8;
          bits -= 8;
        }
      }
      pending = 0;
    }
    if (n === 0 || i > n) break;
    if (i === n) {
      // Final prefix, then EOI. The decoder adds an entry after reading that
      // last code and may widen before it reads EOI.
      code = prefix;
      w = width;
      if (tiff) {
        acc = (acc << w) | code;
        bits += w;
        while (bits >= 8) {
          bits -= 8;
          out[op++] = acc >>> bits;
        }
      } else {
        acc |= code << bits;
        bits += w;
        while (bits >= 8) {
          out[op++] = acc;
          acc >>>= 8;
          bits -= 8;
        }
      }
      const virtual = next + 1;
      if (tiff ? virtual >= 1 << width : virtual > 1 << width) width = Math.min(12, width + 1);
      i++;
      break;
    }
    // Hot loop: extend the current string while it is in the table.
    let c = 0;
    let key = 0;
    let hit = 0;
    for (; i < n; i++) {
      c = data[i] & symMask;
      key = (prefix << 8) | c;
      hit = table[key];
      if (hit === 0) break;
      prefix = hit;
    }
    if (i === n) continue; // input exhausted inside a match: flush via the final branch
    // Emit the prefix and add prefix+c to the table.
    if (tiff) {
      acc = (acc << width) | prefix;
      bits += width;
      while (bits >= 8) {
        bits -= 8;
        out[op++] = acc >>> bits;
      }
    } else {
      acc |= prefix << bits;
      bits += width;
      while (bits >= 8) {
        out[op++] = acc;
        acc >>>= 8;
        bits -= 8;
      }
    }
    prefix = c;
    i++;
    let full: boolean;
    if (tiff) {
      table[key] = next;
      keys[nk++] = key;
      next++;
      full = next === 4094;
      if (!full && next >= 1 << width && width < 12) width++;
    } else if (next < 4096) {
      table[key] = next;
      keys[nk++] = key;
      next++;
      full = false;
      if (next > 1 << width && width < 12) width++;
    } else full = true;
    if (full) {
      code = clear;
      w = width;
      pending = 1;
      for (let k = 0; k < nk; k++) table[keys[k]] = 0;
      nk = 0;
      next = first;
      width = minCodeSize + 1;
    }
  }
  // EOI, then pad the last byte with zeros.
  if (tiff) {
    acc = (acc << width) | eoi;
    bits += width;
    while (bits >= 8) {
      bits -= 8;
      out[op++] = acc >>> bits;
    }
    if (bits > 0) out[op++] = acc << (8 - bits);
  } else {
    acc |= eoi << bits;
    bits += width;
    while (bits >= 8) {
      out[op++] = acc;
      acc >>>= 8;
      bits -= 8;
    }
    if (bits > 0) out[op++] = acc;
  }
  for (let k = 0; k < nk; k++) table[keys[k]] = 0;
  return out.subarray(0, op);
}

const prefixT = new Uint16Array(4096);
const suffixT = new Uint8Array(4096);
const firstT = new Uint8Array(4096);
const lenT = new Uint16Array(4096);

// Decodes into `out` (whose length is the expected decoded size) and returns
// the number of bytes produced. Truncated or corrupt streams stop early.
export function lzwDecode(src: Uint8Array, out: Uint8Array, variant: LzwVariant, minCodeSize = 8, start = 0, end = src.length): number {
  const tiff = variant === 'tiff';
  if (tiff) minCodeSize = 8;
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const first = clear + 2;
  for (let i = 0; i < clear; i++) {
    prefixT[i] = 0;
    suffixT[i] = i;
    firstT[i] = i;
    lenT[i] = 1;
  }
  const outLen = out.length;
  let pos = 0;
  let sp = start;
  let acc = 0;
  let bits = 0;
  let width = minCodeSize + 1;
  let next = first;
  let old = -1;
  const bump = tiff ? 1 : 0;
  while (pos < outLen) {
    while (bits < width) {
      if (sp >= end) return pos;
      if (tiff) acc = ((acc << 8) | src[sp++]) >>> 0;
      else acc |= src[sp++] << bits;
      bits += 8;
    }
    let code: number;
    if (tiff) {
      bits -= width;
      code = (acc >>> bits) & ((1 << width) - 1);
      acc &= (1 << bits) - 1;
    } else {
      code = acc & ((1 << width) - 1);
      acc >>>= width;
      bits -= width;
    }
    if (code === clear) {
      next = first;
      width = minCodeSize + 1;
      old = -1;
      continue;
    }
    if (code === eoi) break;
    if (old === -1) {
      if (code >= clear) break; // corrupt: first code after a clear must be a literal
      out[pos++] = code;
      old = code;
      continue;
    }
    if (code > next || (code === next && next >= 4096)) break;
    if (next < 4096) {
      prefixT[next] = old;
      suffixT[next] = code < next ? firstT[code] : firstT[old];
      firstT[next] = firstT[old];
      lenT[next] = lenT[old] + 1;
      next++;
      if (next >= (1 << width) - bump && width < 12) width++;
    }
    const len = lenT[code];
    let c = code;
    if (pos + len <= outLen) {
      for (let k = pos + len - 1; k > pos; k--) {
        out[k] = suffixT[c];
        c = prefixT[c];
      }
      out[pos] = suffixT[c];
      pos += len;
    } else {
      for (let k = len - 1; k >= 0; k--) {
        if (pos + k < outLen) out[pos + k] = suffixT[c];
        c = prefixT[c];
      }
      pos = outLen;
    }
    old = code;
  }
  return pos;
}
