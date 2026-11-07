// WebM (Matroska) reader for the first video track: track settings and the
// encoded frames with their timestamps, following the Matroska/EBML
// specifications (IETF RFC 8794 and draft-ietf-cellar-matroska). It accepts
// elements of unknown size (live recordings write the Segment and Clusters
// that way), SimpleBlocks and BlockGroups; laced blocks are skipped (video
// tracks do not use lacing).
import { CodecError } from './bytes';

export type WebmVideoTrack = {
  number: number;
  codec: string;
  width: number;
  height: number;
  // Nanoseconds per frame when the file states it.
  defaultDuration?: number;
  codecPrivate?: Uint8Array;
  // 1 when frames carry an alpha channel in block additions.
  alphaMode?: number;
};
export type WebmPacket = { timestampMs: number; key: boolean; data: Uint8Array };
export type WebmFile = { track: WebmVideoTrack; durationMs?: number; frames: WebmPacket[] };

const ID = {
  EBML: 0x1a45dfa3, Segment: 0x18538067, Info: 0x1549a966, TimestampScale: 0x2ad7b1, Duration: 0x4489,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83, CodecID: 0x86, CodecPrivate: 0x63a2,
  DefaultDuration: 0x23e383, Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba, AlphaMode: 0x53c0,
  Cluster: 0x1f43b675, Timestamp: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, ReferenceBlock: 0xfb,
} as const;
// Elements that end a Cluster of unknown size (siblings at Segment level).
const segmentLevel = new Set<number>([ID.Cluster, ID.Info, ID.Tracks, 0x1c53bb6b, 0x1254c367, 0x1941a469, 0x1043a770, 0x114d9b74, ID.EBML]);

class Reader {
  p = 0;
  constructor(readonly b: Uint8Array) {}
  vint(keepMarker: boolean): { value: number; unknown: boolean } {
    const first = this.b[this.p];
    if (first === undefined) throw new CodecError('Truncated WebM file.');
    let len = 1;
    while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
    if (len > 8) throw new CodecError('Invalid EBML number.');
    let v = keepMarker ? first : first & (0xff >> len);
    let ones = (first & (0xff >> len)) === 0xff >> len;
    for (let i = 1; i < len; i++) {
      const byte = this.b[this.p + i];
      if (byte === undefined) throw new CodecError('Truncated WebM file.');
      v = v * 256 + byte;
      if (byte !== 0xff) ones = false;
    }
    this.p += len;
    return { value: v, unknown: !keepMarker && ones };
  }
  header() {
    const id = this.vint(true).value;
    const size = this.vint(false);
    return { id, size: size.unknown ? Infinity : size.value, start: this.p };
  }
}
const uintOf = (d: Uint8Array) => d.reduce((v, x) => v * 256 + x, 0);
function floatOf(d: Uint8Array) {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return d.length === 4 ? v.getFloat32(0) : d.length === 8 ? v.getFloat64(0) : NaN;
}

/** Read the first video track of a WebM file. */
export function demuxWebm(bytes: Uint8Array): WebmFile {
  const r = new Reader(bytes);
  const end = bytes.length;
  let scale = 1_000_000;
  let duration: number | undefined;
  let track: WebmVideoTrack | undefined;
  const blocks: { cluster: number; rel: number; key: boolean; data: Uint8Array; track: number }[] = [];
  const children = (from: number, to: number, visit: (id: number, data: Uint8Array, start: number, size: number) => void) => {
    r.p = from;
    while (r.p < to) {
      const h = r.header();
      const size = Math.min(h.size, to - h.start);
      visit(h.id, bytes.subarray(h.start, h.start + size), h.start, size);
      r.p = h.start + size;
    }
  };
  const block = (data: Uint8Array, cluster: number, simple: boolean, referenced: boolean) => {
    const br = new Reader(data);
    const number = br.vint(false).value;
    if (br.p + 3 > data.length) return;
    const rel = new DataView(data.buffer, data.byteOffset + br.p, 2).getInt16(0);
    const flags = data[br.p + 2];
    if (flags & 0x06) return;
    blocks.push({ cluster, rel, key: simple ? !!(flags & 0x80) : !referenced, data: data.subarray(br.p + 3), track: number });
  };
  // EBML header, then the Segment.
  r.p = 0;
  const head = r.header();
  if (head.id !== ID.EBML) throw new CodecError('Not a WebM file.');
  r.p = head.start + head.size;
  const seg = r.header();
  if (seg.id !== ID.Segment) throw new CodecError('The WebM file has no segment.');
  const segEnd = Math.min(end, seg.start + seg.size);
  r.p = seg.start;
  while (r.p < segEnd) {
    const h = r.header();
    if (h.id === ID.Cluster) {
      // Unknown-size clusters run until the next segment-level element.
      let cluster = 0;
      const stop = Math.min(segEnd, h.start + h.size);
      r.p = h.start;
      while (r.p < stop) {
        const at = r.p;
        const c = r.header();
        if (h.size === Infinity && segmentLevel.has(c.id)) {
          r.p = at;
          break;
        }
        const size = Math.min(c.size, stop - c.start);
        const data = bytes.subarray(c.start, c.start + size);
        if (c.id === ID.Timestamp) cluster = uintOf(data);
        else if (c.id === ID.SimpleBlock) block(data, cluster, true, false);
        else if (c.id === ID.BlockGroup) {
          let raw: Uint8Array | undefined;
          let referenced = false;
          const back = r.p;
          children(c.start, c.start + size, (id, d) => {
            if (id === ID.Block) raw = d;
            else if (id === ID.ReferenceBlock) referenced = true;
          });
          r.p = back;
          if (raw) block(raw, cluster, false, referenced);
        }
        r.p = c.start + size;
      }
      continue;
    }
    const size = Math.min(h.size, segEnd - h.start);
    if (h.id === ID.Info)
      children(h.start, h.start + size, (id, d) => {
        if (id === ID.TimestampScale) scale = uintOf(d) || scale;
        else if (id === ID.Duration) duration = floatOf(d);
      });
    else if (h.id === ID.Tracks)
      children(h.start, h.start + size, (id, _d, start, len) => {
        if (id !== ID.TrackEntry || track) return;
        const t: Partial<WebmVideoTrack> & { type?: number } = {};
        children(start, start + len, (id2, d2, s2, l2) => {
          if (id2 === ID.TrackNumber) t.number = uintOf(d2);
          else if (id2 === ID.TrackType) t.type = uintOf(d2);
          else if (id2 === ID.CodecID) t.codec = new TextDecoder().decode(d2).replace(/\0+$/, '');
          else if (id2 === ID.CodecPrivate) t.codecPrivate = d2.slice();
          else if (id2 === ID.DefaultDuration) t.defaultDuration = uintOf(d2);
          else if (id2 === ID.Video)
            children(s2, s2 + l2, (id3, d3) => {
              if (id3 === ID.PixelWidth) t.width = uintOf(d3);
              else if (id3 === ID.PixelHeight) t.height = uintOf(d3);
              else if (id3 === ID.AlphaMode) t.alphaMode = uintOf(d3);
            });
        });
        if (t.type === 1 && t.number && t.codec && t.width && t.height) {
          delete t.type;
          track = t as WebmVideoTrack;
        }
      });
    r.p = h.start + size;
  }
  if (!track) throw new CodecError('The WebM file has no video track.');
  const ms = scale / 1e6;
  const frames = blocks
    .filter((b) => b.track === track!.number)
    .map((b) => ({ timestampMs: (b.cluster + b.rel) * ms, key: b.key, data: b.data }))
    .sort((a, b) => a.timestampMs - b.timestampMs);
  return { track, durationMs: duration !== undefined && Number.isFinite(duration) ? duration * ms : undefined, frames };
}

/** Frame rate of a demuxed file: from its default duration, else the median
 * spacing of its frames. */
export function webmFrameRate(file: WebmFile): number | undefined {
  if (file.track.defaultDuration) return 1e9 / file.track.defaultDuration;
  const t = file.frames.map((f) => f.timestampMs);
  const gaps = t.slice(1).map((v, i) => v - t[i]).filter((g) => g > 0).sort((a, b) => a - b);
  if (!gaps.length) return undefined;
  return 1000 / gaps[gaps.length >> 1];
}
/** WebCodecs codec string for a Matroska codec ID (undefined when unknown). */
export function webCodecsCodec(codec: string): string | undefined {
  if (codec === 'V_VP8') return 'vp8';
  if (codec === 'V_VP9') return 'vp09.00.10.08';
  if (codec === 'V_AV1') return 'av01.0.08M.08';
  return undefined;
}
