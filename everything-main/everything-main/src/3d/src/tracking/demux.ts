// Minimal container demuxers for frame-accurate decoding with WebCodecs: ISO-BMFF (MP4/MOV,
// progressive "moov" sample tables) and Matroska/WebM (SimpleBlock/BlockGroup, known or unknown
// element sizes). Only the first video track is read. Pure functions, no DOM.

export interface Sample {
  offset: number;
  size: number;
  /** presentation time (microseconds) */
  pts: number;
  key: boolean;
}

export interface VideoTrackInfo {
  container: 'mp4' | 'webm';
  /** WebCodecs codec string */
  codec: string;
  description?: Uint8Array;
  width: number;
  height: number;
  /** samples in decode order */
  samples: Sample[];
  fps: number;
}

const STANDARD_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];

/** Frame rate from presentation timestamps (snapped to common rates when close). */
export function estimateFps(pts: number[]): number {
  if (pts.length < 2) return 24;
  const s = [...pts].sort((a, b) => a - b);
  const fps = ((s.length - 1) * 1e6) / Math.max(1, s[s.length - 1] - s[0]);
  return snapFps(fps);
}

function snapFps(fps: number): number {
  let best = fps,
    bd = Infinity;
  for (const f of STANDARD_FPS) {
    const d = Math.abs(fps - f) / f;
    if (d < 0.012 && d < bd) ((bd = d), (best = f));
  }
  return best === fps ? Math.round(fps * 1000) / 1000 : best;
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

// ---------------------------------------------------------------------------
// MP4

interface Box {
  type: string;
  start: number;
  /** payload start */
  data: number;
  end: number;
}

function boxes(dv: DataView, start: number, end: number): Box[] {
  const out: Box[] = [];
  let p = start;
  while (p + 8 <= end) {
    let size = dv.getUint32(p);
    const type = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
    let hdr = 8;
    if (size === 1) {
      size = Number(dv.getBigUint64(p + 8));
      hdr = 16;
    } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) break;
    out.push({ type, start: p, data: p + hdr, end: p + size });
    p += size;
  }
  return out;
}

const child = (dv: DataView, b: Box | undefined, type: string, skip = 0) => (b ? boxes(dv, b.data + skip, b.end).find((x) => x.type === type) : undefined);

function avcCodec(c: Uint8Array) {
  return `avc1.${hex2(c[1])}${hex2(c[2])}${hex2(c[3])}`;
}

function hevcCodec(type: string, c: Uint8Array) {
  const space = ['', 'A', 'B', 'C'][c[1] >> 6];
  const tier = (c[1] >> 5) & 1 ? 'H' : 'L';
  const profile = c[1] & 0x1f;
  let compat = (c[2] << 24) | (c[3] << 16) | (c[4] << 8) | c[5];
  // reverse bit order of the compatibility flags
  let rev = 0;
  for (let i = 0; i < 32; i++) {
    rev = (rev << 1) | (compat & 1);
    compat >>>= 1;
  }
  const cons: string[] = [];
  for (let i = 6; i < 12; i++) cons.push(c[i].toString(16).toUpperCase());
  while (cons.length > 1 && cons[cons.length - 1] === '0') cons.pop();
  return `${type}.${space}${profile}.${(rev >>> 0).toString(16).toUpperCase()}.${tier}${c[12]}.${cons.join('.')}`;
}

export function demuxMp4(bytes: Uint8Array): VideoTrackInfo | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const top = boxes(dv, 0, bytes.length);
  const moov = top.find((b) => b.type === 'moov');
  if (!moov) return null;
  for (const trak of boxes(dv, moov.data, moov.end).filter((b) => b.type === 'trak')) {
    const mdia = child(dv, trak, 'mdia');
    const hdlr = child(dv, mdia, 'hdlr');
    if (!hdlr || String.fromCharCode(...bytes.subarray(hdlr.data + 8, hdlr.data + 12)) !== 'vide') continue;
    const mdhd = child(dv, mdia, 'mdhd')!;
    const v = dv.getUint8(mdhd.data);
    const timescale = v === 1 ? dv.getUint32(mdhd.data + 20) : dv.getUint32(mdhd.data + 12);
    const stbl = child(dv, child(dv, mdia, 'minf'), 'stbl');
    if (!stbl) continue;
    const stsd = child(dv, stbl, 'stsd')!;
    const entry = boxes(dv, stsd.data + 8, stsd.end)[0];
    if (!entry) continue;
    const width = dv.getUint16(entry.data + 24),
      height = dv.getUint16(entry.data + 26);
    const sub = boxes(dv, entry.data + 78, entry.end);
    let codec = '';
    let description: Uint8Array | undefined;
    const cfg = (t: string) => sub.find((b) => b.type === t);
    const type = entry.type;
    if (type === 'avc1' || type === 'avc3') {
      const b = cfg('avcC');
      if (!b) continue;
      description = bytes.slice(b.data, b.end);
      codec = avcCodec(description);
    } else if (type === 'hvc1' || type === 'hev1') {
      const b = cfg('hvcC');
      if (!b) continue;
      description = bytes.slice(b.data, b.end);
      codec = hevcCodec(type, description);
    } else if (type === 'vp09') {
      const b = cfg('vpcC');
      const c = b ? bytes.subarray(b.data + 4, b.end) : null;
      codec = c ? `vp09.${String(c[0]).padStart(2, '0')}.${String(c[1]).padStart(2, '0')}.${String(c[2] >> 4).padStart(2, '0')}` : 'vp09.00.10.08';
    } else if (type === 'av01') {
      const b = cfg('av1C');
      const c = b ? bytes.subarray(b.data, b.end) : null;
      if (c) {
        description = bytes.slice(b!.data, b!.end);
        const profile = c[1] >> 5,
          level = c[1] & 0x1f,
          tier = c[2] >> 7 ? 'H' : 'M',
          bits = (c[2] >> 6) & 1 ? ((c[2] >> 5) & 1 && profile === 2 ? 12 : 10) : 8;
        codec = `av01.${profile}.${String(level).padStart(2, '0')}${tier}.${String(bits).padStart(2, '0')}`;
      } else codec = 'av01.0.08M.08';
    } else continue;
    // sample tables
    const stsz = child(dv, stbl, 'stsz')!;
    const fixed = dv.getUint32(stsz.data + 4),
      count = dv.getUint32(stsz.data + 8);
    const sizes = new Array<number>(count);
    for (let i = 0; i < count; i++) sizes[i] = fixed || dv.getUint32(stsz.data + 12 + i * 4);
    const stco = child(dv, stbl, 'stco'),
      co64 = child(dv, stbl, 'co64');
    const chunkOffsets: number[] = [];
    if (stco) for (let i = 0, n = dv.getUint32(stco.data + 4); i < n; i++) chunkOffsets.push(dv.getUint32(stco.data + 8 + i * 4));
    else if (co64) for (let i = 0, n = dv.getUint32(co64.data + 4); i < n; i++) chunkOffsets.push(Number(dv.getBigUint64(co64.data + 8 + i * 8)));
    const stsc = child(dv, stbl, 'stsc')!;
    const stscN = dv.getUint32(stsc.data + 4);
    const runs: { first: number; per: number }[] = [];
    for (let i = 0; i < stscN; i++) runs.push({ first: dv.getUint32(stsc.data + 8 + i * 12), per: dv.getUint32(stsc.data + 12 + i * 12) });
    const offsets = new Array<number>(count);
    let s = 0;
    for (let c = 0; c < chunkOffsets.length && s < count; c++) {
      let r = runs.length - 1;
      while (r > 0 && runs[r].first > c + 1) r--;
      let off = chunkOffsets[c];
      for (let k = 0; k < runs[r].per && s < count; k++) {
        offsets[s] = off;
        off += sizes[s];
        s++;
      }
    }
    const stts = child(dv, stbl, 'stts')!;
    const dts = new Array<number>(count);
    let t = 0;
    s = 0;
    for (let i = 0, n = dv.getUint32(stts.data + 4); i < n; i++) {
      const cnt = dv.getUint32(stts.data + 8 + i * 8),
        delta = dv.getUint32(stts.data + 12 + i * 8);
      for (let k = 0; k < cnt && s < count; k++) {
        dts[s++] = t;
        t += delta;
      }
    }
    while (s < count) dts[s++] = t;
    const ctts = child(dv, stbl, 'ctts');
    const cto = new Array<number>(count).fill(0);
    if (ctts) {
      const ver = dv.getUint8(ctts.data);
      s = 0;
      for (let i = 0, n = dv.getUint32(ctts.data + 4); i < n; i++) {
        const cnt = dv.getUint32(ctts.data + 8 + i * 8);
        const off = ver === 1 ? dv.getInt32(ctts.data + 12 + i * 8) : dv.getUint32(ctts.data + 12 + i * 8);
        for (let k = 0; k < cnt && s < count; k++) cto[s++] = off;
      }
    }
    const stss = child(dv, stbl, 'stss');
    const keys = new Set<number>();
    if (stss) for (let i = 0, n = dv.getUint32(stss.data + 4); i < n; i++) keys.add(dv.getUint32(stss.data + 8 + i * 4) - 1);
    const samples: Sample[] = [];
    let minPts = Infinity;
    for (let i = 0; i < count; i++) minPts = Math.min(minPts, dts[i] + cto[i]);
    for (let i = 0; i < count; i++) samples.push({ offset: offsets[i], size: sizes[i], pts: Math.round(((dts[i] + cto[i] - minPts) * 1e6) / timescale), key: stss ? keys.has(i) : true });
    if (samples.some((x) => x.offset === undefined || x.offset + x.size > bytes.length)) return null;
    return { container: 'mp4', codec, description, width, height, samples, fps: estimateFps(samples.map((x) => x.pts)) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// WebM / Matroska

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  DefaultDuration: 0x23e383,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  ReferenceBlock: 0xfb,
};
const TOP_LEVEL = new Set([ID.Cluster, 0x1c53bb6b /* Cues */, 0x1254c367 /* Tags */, 0x1941a469 /* Attachments */, 0x1043a770 /* Chapters */, ID.Info, ID.Tracks, 0x114d9b74 /* SeekHead */]);

function readId(b: Uint8Array, p: number): [number, number] | null {
  const first = b[p];
  if (first === undefined) return null;
  let len = 1;
  while (len <= 4 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 4 || p + len > b.length) return null;
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + b[p + i];
  return [v, len];
}

function readSize(b: Uint8Array, p: number): [number, number] | null {
  const first = b[p];
  if (first === undefined) return null;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || p + len > b.length) return null;
  let v = first & (0xff >> len);
  let allOnes = v === 0xff >> len;
  for (let i = 1; i < len; i++) {
    v = v * 256 + b[p + i];
    if (b[p + i] !== 0xff) allOnes = false;
  }
  return [allOnes ? -1 : v, len];
}

function readUint(b: Uint8Array, p: number, n: number) {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + b[p + i];
  return v;
}

function readFloat(b: Uint8Array, p: number, n: number) {
  const dv = new DataView(b.buffer, b.byteOffset + p, n);
  return n === 4 ? dv.getFloat32(0) : dv.getFloat64(0);
}

interface El {
  id: number;
  data: number;
  end: number;
  unknown: boolean;
}

function readEl(b: Uint8Array, p: number, limit: number): El | null {
  const id = readId(b, p);
  if (!id) return null;
  const sz = readSize(b, p + id[1]);
  if (!sz) return null;
  const data = p + id[1] + sz[1];
  const unknown = sz[0] < 0;
  return { id: id[0], data, end: unknown ? limit : Math.min(limit, data + sz[0]), unknown };
}

export function demuxWebM(bytes: Uint8Array): VideoTrackInfo | null {
  const b = bytes;
  let p = 0;
  const head = readEl(b, p, b.length);
  if (!head || head.id !== ID.EBML) return null;
  p = head.end;
  const seg = readEl(b, p, b.length);
  if (!seg || seg.id !== ID.Segment) return null;
  let timecodeScale = 1e6;
  let track: { num: number; codec: string; priv?: Uint8Array; w: number; h: number; dur?: number } | null = null;
  const blocks: { pos: number; size: number; time: number; key: boolean }[] = [];
  const parseBlock = (data: number, end: number, clusterTime: number, simple: boolean, hasRef: boolean) => {
    const tn = readSize(b, data);
    if (!tn || !track || tn[0] !== track.num) return;
    const q = data + tn[1];
    const rel = (b[q] << 8) | b[q + 1];
    const relS = rel & 0x8000 ? rel - 0x10000 : rel;
    const flags = b[q + 2];
    if (flags & 0x06) return; // laced blocks are not used for video
    const key = simple ? !!(flags & 0x80) : !hasRef;
    blocks.push({ pos: q + 3, size: end - q - 3, time: ((clusterTime + relS) * timecodeScale) / 1000, key });
  };
  p = seg.data;
  const segEnd = seg.end;
  while (p < segEnd) {
    const el = readEl(b, p, segEnd);
    if (!el) break;
    if (el.id === ID.Info) {
      for (let q = el.data; q < el.end; ) {
        const c = readEl(b, q, el.end);
        if (!c) break;
        if (c.id === ID.TimecodeScale) timecodeScale = readUint(b, c.data, c.end - c.data);
        q = c.end;
      }
    } else if (el.id === ID.Tracks) {
      for (let q = el.data; q < el.end; ) {
        const te = readEl(b, q, el.end);
        if (!te) break;
        if (te.id === ID.TrackEntry && !track) {
          let num = 0,
            type = 0,
            codec = '',
            priv: Uint8Array | undefined,
            w = 0,
            h = 0,
            dur: number | undefined;
          for (let r = te.data; r < te.end; ) {
            const c = readEl(b, r, te.end);
            if (!c) break;
            const n = c.end - c.data;
            if (c.id === ID.TrackNumber) num = readUint(b, c.data, n);
            else if (c.id === ID.TrackType) type = readUint(b, c.data, n);
            else if (c.id === ID.CodecID) codec = new TextDecoder().decode(b.subarray(c.data, c.end)).replace(/\0+$/, '');
            else if (c.id === ID.CodecPrivate) priv = b.slice(c.data, c.end);
            else if (c.id === ID.DefaultDuration) dur = readUint(b, c.data, n);
            else if (c.id === ID.Video)
              for (let s = c.data; s < c.end; ) {
                const v = readEl(b, s, c.end);
                if (!v) break;
                if (v.id === ID.PixelWidth) w = readUint(b, v.data, v.end - v.data);
                else if (v.id === ID.PixelHeight) h = readUint(b, v.data, v.end - v.data);
                s = v.end;
              }
            r = c.end;
          }
          if (type === 1) track = { num, codec, priv, w, h, dur };
        }
        q = te.end;
      }
    } else if (el.id === ID.Cluster) {
      let clusterTime = 0;
      let q = el.data;
      while (q < el.end) {
        const c = readEl(b, q, el.end);
        if (!c) break;
        if (el.unknown && TOP_LEVEL.has(c.id)) break; // next top-level element ends an unknown-size cluster
        if (c.id === ID.Timecode) clusterTime = readUint(b, c.data, c.end - c.data);
        else if (c.id === ID.SimpleBlock) parseBlock(c.data, c.end, clusterTime, true, false);
        else if (c.id === ID.BlockGroup) {
          let blk: El | null = null,
            hasRef = false;
          for (let r = c.data; r < c.end; ) {
            const g = readEl(b, r, c.end);
            if (!g) break;
            if (g.id === ID.Block) blk = g;
            else if (g.id === ID.ReferenceBlock) hasRef = true;
            r = g.end;
          }
          if (blk) parseBlock(blk.data, blk.end, clusterTime, false, hasRef);
        }
        q = c.end;
      }
      p = q;
      continue;
    }
    p = el.end;
  }
  if (!track || !blocks.length) return null;
  const codecMap: Record<string, string> = { V_VP8: 'vp8', V_VP9: 'vp09.00.10.08', V_AV1: 'av01.0.08M.08' };
  let codec = codecMap[track.codec];
  let description: Uint8Array | undefined;
  if (track.codec === 'V_MPEG4/ISO/AVC' && track.priv) {
    description = track.priv;
    codec = avcCodec(track.priv);
  } else if (track.codec === 'V_MPEGH/ISO/HEVC' && track.priv) {
    description = track.priv;
    codec = hevcCodec('hvc1', track.priv);
  } else if (track.codec === 'V_AV1' && track.priv) description = track.priv;
  if (!codec) return null;
  const t0 = Math.min(...blocks.map((x) => x.time));
  const samples: Sample[] = blocks.map((x) => ({ offset: x.pos, size: x.size, pts: Math.round(x.time - t0), key: x.key }));
  const fps = track.dur ? Math.round(1e11 / track.dur) / 100 : estimateFps(samples.map((x) => x.pts));
  return { container: 'webm', codec, description, width: track.w, height: track.h, samples, fps: snapFps(fps) };
}

export function demux(bytes: Uint8Array): VideoTrackInfo | null {
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return demuxWebM(bytes);
  try {
    return demuxMp4(bytes);
  } catch {
    return null;
  }
}

/** Presentation-ordered view of samples: index → decode-order sample index. */
export function presentationOrder(info: VideoTrackInfo): number[] {
  return info.samples.map((_, i) => i).sort((a, b) => info.samples[a].pts - info.samples[b].pts);
}
