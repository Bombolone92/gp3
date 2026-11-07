// Alembic archive layer on top of Ogawa: objects, compound/scalar/array properties, indexed
// metadata and time samplings. Independent implementation from the publicly described layout.
import { OgawaReader } from './ogawa';

export type Pod = 'bool' | 'uint8' | 'int8' | 'uint16' | 'int16' | 'uint32' | 'int32' | 'uint64' | 'int64' | 'float16' | 'float32' | 'float64' | 'string' | 'wstring';
const PODS: Pod[] = ['bool', 'uint8', 'int8', 'uint16', 'int16', 'uint32', 'int32', 'uint64', 'int64', 'float16', 'float32', 'float64', 'string', 'wstring'];
const POD_SIZE: Record<Pod, number> = { bool: 1, uint8: 1, int8: 1, uint16: 2, int16: 2, uint32: 4, int32: 4, uint64: 8, int64: 8, float16: 2, float32: 4, float64: 8, string: 1, wstring: 4 };

export interface TimeSampling {
  timePerCycle: number;
  times: number[];
  maxSamples: number;
}

export interface AbcProperty {
  name: string;
  kind: 'compound' | 'scalar' | 'array';
  metadata: Record<string, string>;
  pod: Pod;
  extent: number;
  numSamples: number;
  firstChanged: number;
  lastChanged: number;
  timeSampling: number;
  /** compound children */
  children: AbcProperty[];
  /** Ogawa group holding the samples / sub-properties */
  group: number;
}

export interface AbcObject {
  name: string;
  path: string;
  metadata: Record<string, string>;
  properties: AbcProperty;
  children: AbcObject[];
}

const ACYCLIC = Number.MAX_VALUE / 32;

export function parseMetadata(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

export class AlembicArchive {
  readonly ogawa: OgawaReader;
  readonly metadata: Record<string, string>;
  readonly timeSamplings: TimeSampling[] = [];
  readonly top: AbcObject;
  private indexed: string[] = [''];
  private td = new TextDecoder();

  constructor(bytes: Uint8Array) {
    this.ogawa = new OgawaReader(bytes);
    const root = this.ogawa.children(this.ogawa.root);
    if (root.length < 6) throw new Error('Unsupported Alembic archive layout');
    this.metadata = parseMetadata(this.td.decode(this.ogawa.data(root[3].offset)));
    this.readTimeSamplings(this.ogawa.data(root[4].offset));
    this.readIndexedMetadata(this.ogawa.data(root[5].offset));
    this.top = this.readObject(root[2].offset, 'ABC', '', {});
  }

  private readTimeSamplings(b: Uint8Array) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let p = 0;
    while (p + 16 <= b.length) {
      const maxSamples = dv.getUint32(p, true);
      const tpc = dv.getFloat64(p + 4, true);
      const n = dv.getUint32(p + 12, true);
      p += 16;
      const times: number[] = [];
      for (let i = 0; i < n && p + 8 <= b.length; i++, p += 8) times.push(dv.getFloat64(p, true));
      this.timeSamplings.push({ timePerCycle: tpc, times, maxSamples });
    }
    if (!this.timeSamplings.length) this.timeSamplings.push({ timePerCycle: 1, times: [0], maxSamples: 1 });
  }

  private readIndexedMetadata(b: Uint8Array) {
    let p = 0;
    while (p < b.length) {
      const n = b[p];
      this.indexed.push(this.td.decode(b.subarray(p + 1, p + 1 + n)));
      p += 1 + n;
    }
  }

  /** Time (seconds) of sample `i` of a property using time sampling `ts`. */
  sampleTime(ts: number, i: number): number {
    const s = this.timeSamplings[ts] ?? this.timeSamplings[0];
    const n = s.times.length || 1;
    if (s.timePerCycle >= ACYCLIC * 0.5) return s.times[Math.min(i, n - 1)] ?? i;
    if (n === 1) return (s.times[0] ?? 0) + i * s.timePerCycle;
    return s.times[i % n] + Math.floor(i / n) * s.timePerCycle;
  }

  private readObject(group: number, name: string, parentPath: string, metadata: Record<string, string>): AbcObject {
    const kids = this.ogawa.children(group);
    const path = parentPath ? `${parentPath === '/' ? '' : parentPath}/${name}` : '';
    const obj: AbcObject = {
      name,
      path,
      metadata,
      properties: { name: '', kind: 'compound', metadata: {}, pod: 'uint8', extent: 0, numSamples: 0, firstChanged: 0, lastChanged: 0, timeSampling: 0, children: [], group: 0 },
      children: [],
    };
    if (!kids.length) return obj;
    if (kids[0].kind === 'group') obj.properties = this.readCompound(kids[0].offset, '', {});
    // child object headers live in the last data block (followed by 32 bytes of hashes)
    const last = kids[kids.length - 1];
    if (last.kind !== 'data') return obj;
    const b = this.ogawa.data(last.offset);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const headers: { name: string; metadata: Record<string, string> }[] = [];
    let p = 0;
    const end = b.length - 32;
    while (p + 4 <= end) {
      const n = dv.getUint32(p, true);
      p += 4;
      const nm = this.td.decode(b.subarray(p, p + n));
      p += n;
      const mi = b[p++];
      let md = '';
      if (mi === 0xff) {
        const ms = dv.getUint32(p, true);
        p += 4;
        md = this.td.decode(b.subarray(p, p + ms));
        p += ms;
      } else md = this.indexed[mi] ?? '';
      headers.push({ name: nm, metadata: parseMetadata(md) });
    }
    headers.forEach((h, i) => {
      const c = kids[i + 1];
      if (c?.kind === 'group') obj.children.push(this.readObject(c.offset, h.name, path || '/', h.metadata));
    });
    return obj;
  }

  private readCompound(group: number, name: string, metadata: Record<string, string>): AbcProperty {
    const prop: AbcProperty = { name, kind: 'compound', metadata, pod: 'uint8', extent: 0, numSamples: 0, firstChanged: 0, lastChanged: 0, timeSampling: 0, children: [], group };
    const kids = this.ogawa.children(group);
    if (!kids.length) return prop;
    const last = kids[kids.length - 1];
    if (last.kind !== 'data') return prop;
    const headers = this.readPropertyHeaders(this.ogawa.data(last.offset));
    headers.forEach((h, i) => {
      const c = kids[i];
      if (!c || c.kind !== 'group') return;
      if (h.kind === 'compound') prop.children.push(this.readCompound(c.offset, h.name, h.metadata));
      else prop.children.push({ ...h, group: c.offset, children: [] });
    });
    return prop;
  }

  private readPropertyHeaders(b: Uint8Array): Omit<AbcProperty, 'children' | 'group'>[] {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const out: Omit<AbcProperty, 'children' | 'group'>[] = [];
    let p = 0;
    while (p + 4 <= b.length) {
      const info = dv.getUint32(p, true);
      p += 4;
      // 0 compound, 1 scalar, 2 array, 3 array whose samples are scalar-like
      const kind = (['compound', 'scalar', 'array', 'array'] as const)[info & 3];
      const hint = (info >> 2) & 3;
      const read = () => {
        let v: number;
        if (hint === 0) v = b[p];
        else if (hint === 1) v = dv.getUint16(p, true);
        else v = dv.getUint32(p, true);
        p += hint === 0 ? 1 : hint === 1 ? 2 : 4;
        return v;
      };
      let pod: Pod = 'uint8',
        extent = 0,
        numSamples = 0,
        first = 0,
        last = 0,
        ts = 0;
      if (kind !== 'compound') {
        pod = PODS[(info >> 4) & 0xf] ?? 'uint8';
        extent = (info >> 12) & 0xff;
        numSamples = read();
        if (info & 0x200) {
          first = read();
          last = read();
        } else if (info & 0x800) {
          first = 0;
          last = 0;
        } else {
          first = 1;
          last = Math.max(0, numSamples - 1);
        }
        if (info & 0x100) ts = read();
      }
      const mi = (info >> 20) & 0xff;
      const nameLen = read();
      const name = this.td.decode(b.subarray(p, p + nameLen));
      p += nameLen;
      let md = '';
      if (mi === 0xff) {
        const ms = read();
        md = this.td.decode(b.subarray(p, p + ms));
        p += ms;
      } else md = this.indexed[mi] ?? '';
      out.push({ name, kind, metadata: parseMetadata(md), pod, extent: extent || 1, numSamples, firstChanged: first, lastChanged: last, timeSampling: ts });
    }
    return out;
  }

  /** True when every sample holds the same data (deduplicated blocks or unchanged indices). */
  isConstant(p: AbcProperty): boolean {
    if (p.kind === 'compound' || p.numSamples <= 1) return true;
    if (p.firstChanged === 0 && p.lastChanged === 0) return true;
    const kids = this.ogawa.children(p.group);
    const step = p.kind === 'array' ? 2 : 1;
    const first = kids[0]?.offset;
    for (let i = step; i < kids.length; i += step) if (kids[i].offset !== first) return false;
    return true;
  }

  /** Raw payload of sample `i` (after the 16-byte digest) and its dimensions. */
  sampleBytes(p: AbcProperty, i: number): { bytes: Uint8Array; dims: number[] } | null {
    if (p.kind === 'compound' || !p.numSamples) return null;
    let idx = i;
    if (p.firstChanged === 0 && p.lastChanged === 0) idx = 0;
    else if (idx < p.firstChanged) idx = 0;
    else if (idx > p.lastChanged) idx = p.lastChanged;
    const kids = this.ogawa.children(p.group);
    if (p.kind === 'scalar') {
      const c = kids[idx];
      if (!c || c.kind !== 'data') return null;
      const d = this.ogawa.data(c.offset);
      return { bytes: d.length >= 16 ? d.subarray(16) : new Uint8Array(0), dims: [] };
    }
    const c = kids[idx * 2],
      dimsChild = kids[idx * 2 + 1];
    if (!c || c.kind !== 'data') return null;
    const d = this.ogawa.data(c.offset);
    const bytes = d.length >= 16 ? d.subarray(16) : new Uint8Array(0);
    let dims: number[] = [];
    if (dimsChild?.kind === 'data') {
      const db = this.ogawa.data(dimsChild.offset);
      const ddv = new DataView(db.buffer, db.byteOffset, db.byteLength);
      for (let k = 0; k + 8 <= db.length; k += 8) dims.push(Number(ddv.getBigUint64(k, true)));
    }
    if (!dims.length) dims = [bytes.length / (POD_SIZE[p.pod] * p.extent)];
    return { bytes, dims };
  }

  /** Sample `i` decoded as numbers (strings for string PODs). */
  sample(p: AbcProperty, i = 0): number[] | string[] | null {
    const s = this.sampleBytes(p, i);
    if (!s) return null;
    const { bytes } = s;
    if (p.pod === 'string')
      return this.td
        .decode(bytes)
        .split('\0')
        .filter((x, k, a) => k < a.length - 1 || x);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sz = POD_SIZE[p.pod];
    const n = Math.floor(bytes.length / sz);
    const out = new Array<number>(n);
    for (let k = 0; k < n; k++) {
      const o = k * sz;
      switch (p.pod) {
        case 'bool':
        case 'uint8':
          out[k] = bytes[o];
          break;
        case 'int8':
          out[k] = dv.getInt8(o);
          break;
        case 'uint16':
          out[k] = dv.getUint16(o, true);
          break;
        case 'int16':
          out[k] = dv.getInt16(o, true);
          break;
        case 'uint32':
          out[k] = dv.getUint32(o, true);
          break;
        case 'int32':
          out[k] = dv.getInt32(o, true);
          break;
        case 'uint64':
          out[k] = Number(dv.getBigUint64(o, true));
          break;
        case 'int64':
          out[k] = Number(dv.getBigInt64(o, true));
          break;
        case 'float16':
          out[k] = half(dv.getUint16(o, true));
          break;
        case 'float32':
          out[k] = dv.getFloat32(o, true);
          break;
        case 'float64':
          out[k] = dv.getFloat64(o, true);
          break;
        default:
          out[k] = 0;
      }
    }
    return out;
  }
}

function half(h: number) {
  const s = h & 0x8000 ? -1 : 1,
    e = (h >> 10) & 0x1f,
    f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

export function findProp(p: AbcProperty | undefined, name: string): AbcProperty | undefined {
  return p?.children.find((c) => c.name === name);
}
