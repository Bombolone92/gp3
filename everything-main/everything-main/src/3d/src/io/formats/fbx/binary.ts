// FBX binary container: node records with typed properties (versions 7.x; 64-bit offsets from 7500).
// Independent implementation from the publicly documented record layout. Also parses ASCII FBX
// into the same node tree.
import { unzlibSync, zlibSync } from 'three/examples/jsm/libs/fflate.module.js';

export type FbxValue = number | bigint | boolean | string | Uint8Array | Float64Array | Float32Array | Int32Array | BigInt64Array | number[];

export interface FbxNode {
  name: string;
  props: FbxValue[];
  children: FbxNode[];
}

const MAGIC = 'Kaydara FBX Binary  \0';

export function isBinaryFbx(bytes: Uint8Array) {
  if (bytes.length < 27) return false;
  for (let i = 0; i < 20; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) return false;
  return true;
}

export function parseFbx(bytes: Uint8Array): { version: number; nodes: FbxNode[] } {
  if (isBinaryFbx(bytes)) return parseBinary(bytes);
  const head = new TextDecoder().decode(bytes.subarray(0, 1024));
  if (/FBXHeaderExtension|; FBX/.test(head)) return parseAscii(new TextDecoder().decode(bytes));
  throw new Error('Not an FBX file');
}

function parseBinary(bytes: Uint8Array): { version: number; nodes: FbxNode[] } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint32(23, true);
  if (version < 7000) throw new Error(`FBX version ${version} is not supported (7.0 or newer required)`);
  const wide = version >= 7500;
  let pos = 27;
  const td = new TextDecoder();
  const readNode = (): FbxNode | null => {
    const end = wide ? Number(dv.getBigUint64(pos, true)) : dv.getUint32(pos, true);
    const numProps = wide ? Number(dv.getBigUint64(pos + 8, true)) : dv.getUint32(pos + 4, true);
    const propLen = wide ? Number(dv.getBigUint64(pos + 16, true)) : dv.getUint32(pos + 8, true);
    pos += wide ? 24 : 12;
    const nameLen = dv.getUint8(pos);
    pos += 1;
    if (end === 0) return null;
    if (end > bytes.length) throw new Error('The FBX file is truncated');
    const name = td.decode(bytes.subarray(pos, pos + nameLen));
    pos += nameLen;
    const props: FbxValue[] = [];
    const propEnd = pos + propLen;
    for (let i = 0; i < numProps; i++) props.push(readProp());
    pos = propEnd;
    const children: FbxNode[] = [];
    while (pos < end) {
      const child = readNode();
      if (!child) break;
      children.push(child);
    }
    pos = end;
    return { name, props, children };
  };
  const readArray = (kind: string): FbxValue => {
    const len = dv.getUint32(pos, true),
      enc = dv.getUint32(pos + 4, true),
      clen = dv.getUint32(pos + 8, true);
    pos += 12;
    let data = bytes.subarray(pos, pos + clen);
    pos += clen;
    if (enc === 1) data = unzlibSync(data);
    const copy = data.slice();
    const buf = copy.buffer;
    switch (kind) {
      case 'd':
        return new Float64Array(buf, 0, len);
      case 'f':
        return new Float32Array(buf, 0, len);
      case 'i':
        return new Int32Array(buf, 0, len);
      case 'l':
        return new BigInt64Array(buf, 0, len);
      case 'b':
        return Array.from(copy.subarray(0, len));
    }
    throw new Error(`Unknown FBX array type ${kind}`);
  };
  const readProp = (): FbxValue => {
    const t = String.fromCharCode(dv.getUint8(pos));
    pos += 1;
    switch (t) {
      case 'Y': {
        const v = dv.getInt16(pos, true);
        pos += 2;
        return v;
      }
      case 'C': {
        const v = dv.getUint8(pos) !== 0;
        pos += 1;
        return v;
      }
      case 'I': {
        const v = dv.getInt32(pos, true);
        pos += 4;
        return v;
      }
      case 'F': {
        const v = dv.getFloat32(pos, true);
        pos += 4;
        return v;
      }
      case 'D': {
        const v = dv.getFloat64(pos, true);
        pos += 8;
        return v;
      }
      case 'L': {
        const v = dv.getBigInt64(pos, true);
        pos += 8;
        return v;
      }
      case 'S': {
        const n = dv.getUint32(pos, true);
        const v = td.decode(bytes.subarray(pos + 4, pos + 4 + n));
        pos += 4 + n;
        return v;
      }
      case 'R': {
        const n = dv.getUint32(pos, true);
        const v = bytes.slice(pos + 4, pos + 4 + n);
        pos += 4 + n;
        return v;
      }
      case 'd':
      case 'f':
      case 'i':
      case 'l':
      case 'b':
        return readArray(t);
    }
    throw new Error(`Unknown FBX property type "${t}"`);
  };
  const nodes: FbxNode[] = [];
  while (pos < bytes.length - 13) {
    const n = readNode();
    if (!n) break;
    nodes.push(n);
  }
  return { version, nodes };
}

// ---------------------------------------------------------------------------- ASCII

function parseAscii(text: string): { version: number; nodes: FbxNode[] } {
  let i = 0;
  const n = text.length;
  const root: FbxNode = { name: '', props: [], children: [] };
  const stack: FbxNode[] = [root];
  let version = 7400;
  const skipWs = () => {
    while (i < n) {
      const c = text[i];
      if (c === ';') {
        while (i < n && text[i] !== '\n') i++;
      } else if (c === ' ' || c === '\t' || c === '\r' || c === '\n') i++;
      else break;
    }
  };
  const readValue = (): FbxValue => {
    skipWs();
    if (text[i] === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j++;
      const s = text.slice(i + 1, j);
      i = j + 1;
      return s.replace(/&quot;/g, '"');
    }
    if (text[i] === '*') {
      // array: *N { a: v,v,v }
      i++;
      while (i < n && /\d/.test(text[i])) i++;
      skipWs();
      if (text[i] === '{') i++;
      skipWs();
      if (text.startsWith('a:', i)) i += 2;
      let j = i;
      while (j < n && text[j] !== '}') j++;
      const vals = text
        .slice(i, j)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number);
      i = j + 1;
      return vals;
    }
    let j = i;
    while (j < n && !/[,\s{}]/.test(text[j])) j++;
    const tok = text.slice(i, j);
    i = j;
    if (tok === 'T' || tok === 'Y') return tok;
    const v = Number(tok);
    return Number.isFinite(v) ? v : tok;
  };
  while (i < n) {
    skipWs();
    if (i >= n) break;
    if (text[i] === '}') {
      i++;
      stack.pop();
      continue;
    }
    // Name:
    let j = i;
    while (j < n && text[j] !== ':' && text[j] !== '\n') j++;
    if (text[j] !== ':') {
      i = j + 1;
      continue;
    }
    const name = text.slice(i, j).trim();
    i = j + 1;
    const node: FbxNode = { name, props: [], children: [] };
    stack[stack.length - 1].children.push(node);
    // props until '{' or newline
    for (;;) {
      while (i < n && (text[i] === ' ' || text[i] === '\t')) i++;
      if (i >= n || text[i] === '\n' || text[i] === '\r' || text[i] === ';') break;
      if (text[i] === '{') {
        i++;
        stack.push(node);
        break;
      }
      if (text[i] === '}') break;
      const v = readValue();
      node.props.push(v);
      // arrays carry their own braces; an array-only node has no children block
      while (i < n && (text[i] === ' ' || text[i] === '\t')) i++;
      if (text[i] === ',') i++;
    }
    if (name === 'FBXVersion' && typeof node.props[0] === 'number') version = node.props[0];
  }
  return { version, nodes: root.children };
}

// ---------------------------------------------------------------------------- writer

/** Typed property wrappers for the writer (JS numbers are ambiguous). */
export class P {
  type: string;
  value: unknown;
  constructor(type: string, value: unknown) {
    this.type = type;
    this.value = value;
  }
  static i16 = (v: number) => new P('Y', v);
  static bool = (v: boolean) => new P('C', v);
  static i32 = (v: number) => new P('I', v);
  static f32 = (v: number) => new P('F', v);
  static f64 = (v: number) => new P('D', v);
  static i64 = (v: number | bigint) => new P('L', BigInt(v));
  static str = (v: string) => new P('S', v);
  static raw = (v: Uint8Array) => new P('R', v);
  static f64s = (v: ArrayLike<number>) => new P('d', Float64Array.from(v));
  static f32s = (v: ArrayLike<number>) => new P('f', Float32Array.from(v));
  static i32s = (v: ArrayLike<number>) => new P('i', Int32Array.from(v));
  static i64s = (v: ArrayLike<number | bigint>) => new P('l', BigInt64Array.from(Array.from(v as ArrayLike<number>, (x) => BigInt(x))));
}

export interface WNode {
  name: string;
  props: P[];
  children: WNode[];
}

export const N = (name: string, props: P[] = [], children: WNode[] = []): WNode => ({ name, props, children });

class ByteSink {
  buf = new Uint8Array(1 << 16);
  len = 0;
  private dv = new DataView(this.buf.buffer);
  ensure(n: number) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
    this.dv = new DataView(nb.buffer);
  }
  u8(v: number) {
    this.ensure(1);
    this.buf[this.len++] = v;
  }
  bytes(b: Uint8Array) {
    this.ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }
  u32(v: number) {
    this.ensure(4);
    this.dv.setUint32(this.len, v, true);
    this.len += 4;
  }
  u64(v: number) {
    this.ensure(8);
    this.dv.setBigUint64(this.len, BigInt(v), true);
    this.len += 8;
  }
  setU32(at: number, v: number) {
    this.dv.setUint32(at, v, true);
  }
  setU64(at: number, v: number) {
    this.dv.setBigUint64(at, BigInt(v), true);
  }
  i16(v: number) {
    this.ensure(2);
    this.dv.setInt16(this.len, v, true);
    this.len += 2;
  }
  i32(v: number) {
    this.ensure(4);
    this.dv.setInt32(this.len, v, true);
    this.len += 4;
  }
  f32(v: number) {
    this.ensure(4);
    this.dv.setFloat32(this.len, v, true);
    this.len += 4;
  }
  f64(v: number) {
    this.ensure(8);
    this.dv.setFloat64(this.len, v, true);
    this.len += 8;
  }
  i64(v: bigint) {
    this.ensure(8);
    this.dv.setBigInt64(this.len, v, true);
    this.len += 8;
  }
}

const FOOTER_ID = [0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e];
const FOOTER_MAGIC = [0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b];

export function writeFbxBinary(nodes: WNode[], version = 7400): Uint8Array {
  const wide = version >= 7500;
  const s = new ByteSink();
  s.bytes(new TextEncoder().encode(MAGIC));
  s.u8(0x1a);
  s.u8(0x00);
  s.u32(version);
  const enc = new TextEncoder();
  const writeProp = (p: P) => {
    s.u8(p.type.charCodeAt(0));
    switch (p.type) {
      case 'Y':
        s.i16(p.value as number);
        break;
      case 'C':
        s.u8(p.value ? 1 : 0);
        break;
      case 'I':
        s.i32(p.value as number);
        break;
      case 'F':
        s.f32(p.value as number);
        break;
      case 'D':
        s.f64(p.value as number);
        break;
      case 'L':
        s.i64(p.value as bigint);
        break;
      case 'S': {
        const b = enc.encode(p.value as string);
        s.u32(b.length);
        s.bytes(b);
        break;
      }
      case 'R': {
        const b = p.value as Uint8Array;
        s.u32(b.length);
        s.bytes(b);
        break;
      }
      default: {
        const arr = p.value as Float64Array | Float32Array | Int32Array | BigInt64Array;
        const raw = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
        const compress = raw.length > 128;
        const data = compress ? zlibSync(raw, { level: 6 }) : raw;
        s.u32(arr.length);
        s.u32(compress ? 1 : 0);
        s.u32(data.length);
        s.bytes(data);
      }
    }
  };
  const writeNode = (n: WNode) => {
    const start = s.len;
    if (wide) {
      s.u64(0);
      s.u64(n.props.length);
      s.u64(0);
    } else {
      s.u32(0);
      s.u32(n.props.length);
      s.u32(0);
    }
    const nameBytes = enc.encode(n.name);
    s.u8(nameBytes.length);
    s.bytes(nameBytes);
    const ps = s.len;
    for (const p of n.props) writeProp(p);
    const propLen = s.len - ps;
    if (n.children.length || n.props.length === 0) {
      for (const c of n.children) writeNode(c);
      for (let k = 0; k < (wide ? 25 : 13); k++) s.u8(0);
    }
    if (wide) {
      s.setU64(start, s.len);
      s.setU64(start + 16, propLen);
    } else {
      s.setU32(start, s.len);
      s.setU32(start + 8, propLen);
    }
  };
  for (const n of nodes) writeNode(n);
  for (let k = 0; k < (wide ? 25 : 13); k++) s.u8(0);
  // footer
  s.bytes(Uint8Array.from(FOOTER_ID));
  const pad = (16 - (s.len % 16)) % 16;
  for (let k = 0; k < (pad || 16); k++) s.u8(0);
  s.u32(0);
  s.u32(version);
  for (let k = 0; k < 120; k++) s.u8(0);
  s.bytes(Uint8Array.from(FOOTER_MAGIC));
  return s.buf.slice(0, s.len);
}

// ---------------------------------------------------------------------------- helpers for reading

export function child(n: FbxNode | undefined, name: string): FbxNode | undefined {
  return n?.children.find((c) => c.name === name);
}
export function childrenNamed(n: FbxNode | undefined, name: string): FbxNode[] {
  return n ? n.children.filter((c) => c.name === name) : [];
}
export function numArray(v: FbxValue | undefined): number[] {
  if (v === undefined) return [];
  if (Array.isArray(v)) return v.map(Number);
  if (v instanceof BigInt64Array) return Array.from(v, (x) => Number(x));
  if (ArrayBuffer.isView(v)) return Array.from(v as Float64Array);
  return [Number(v)];
}
export function toNum(v: FbxValue | undefined, d = 0): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const x = Number(v);
    return Number.isFinite(x) ? x : d;
  }
  return d;
}
export function idOf(v: FbxValue | undefined): string {
  return typeof v === 'bigint' ? v.toString() : String(v);
}

/** Properties70 → map name → values (after the 4 header fields). */
export function props70(n: FbxNode | undefined): Map<string, FbxValue[]> {
  const out = new Map<string, FbxValue[]>();
  const p = child(n, 'Properties70') ?? child(n, 'Properties60');
  for (const c of p?.children ?? []) if (c.name === 'P' || c.name === 'Property') out.set(String(c.props[0]), c.props.slice(c.name === 'P' ? 4 : 3));
  return out;
}
