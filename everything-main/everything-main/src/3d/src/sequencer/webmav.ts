// WebM writer with an Opus audio track (WebCodecs VideoEncoder + AudioEncoder), used for
// animation renders of the sequencer when the timeline has sound. Muxing reuses the EBML element
// helper of render/final/webm.ts; tracks are interleaved by time in clusters.
import { element, type EncodedFrame, type VideoWriter } from '../render/final/webm';

const uintBytes = (v: number) => {
  if (v === 0) return new Uint8Array([0]);
  const out: number[] = [];
  while (v > 0) {
    out.unshift(v % 256);
    v = Math.floor(v / 256);
  }
  return new Uint8Array(out);
};
const uintEl = (id: number, v: number) => element(id, uintBytes(v));
const strEl = (id: number, s: string) => element(id, new TextEncoder().encode(s));
const floatEl = (id: number, v: number) => {
  const b = new DataView(new ArrayBuffer(8));
  b.setFloat64(0, v);
  return element(id, new Uint8Array(b.buffer));
};

const OPUS_PRESKIP = 312;

function opusHead(channels: number, rate: number) {
  const b = new Uint8Array(19);
  b.set(new TextEncoder().encode('OpusHead'));
  const dv = new DataView(b.buffer);
  b[8] = 1;
  b[9] = channels;
  dv.setUint16(10, OPUS_PRESKIP, true);
  dv.setUint32(12, rate, true);
  dv.setInt16(16, 0, true);
  b[18] = 0;
  return b;
}

interface Block extends EncodedFrame {
  track: 1 | 2;
}

/** Build a WebM file with video (track 1) and Opus audio (track 2). */
export function muxWebMAV(video: EncodedFrame[], audio: EncodedFrame[], o: { width: number; height: number; codec: 'V_VP8' | 'V_VP9'; duration: number; channels: number; rate: number }): Uint8Array[] {
  const header = element(0x1a45dfa3, [...uintEl(0x4286, 1), ...uintEl(0x42f7, 1), ...uintEl(0x42f2, 4), ...uintEl(0x42f3, 8), ...strEl(0x4282, 'webm'), ...uintEl(0x4287, 4), ...uintEl(0x4285, 2)]);
  const info = element(0x1549a966, [...uintEl(0x2ad7b1, 1000000), ...strEl(0x4d80, 'puter-3d'), ...strEl(0x5741, 'puter-3d'), ...floatEl(0x4489, o.duration)]);
  const vtrack = element(0xae, [...uintEl(0xd7, 1), ...uintEl(0x73c5, 1), ...uintEl(0x9c, 0), ...strEl(0x86, o.codec), ...uintEl(0x83, 1), ...element(0xe0, [...uintEl(0xb0, o.width), ...uintEl(0xba, o.height)])]);
  const atrack = element(0xae, [
    ...uintEl(0xd7, 2),
    ...uintEl(0x73c5, 2),
    ...uintEl(0x9c, 0),
    ...strEl(0x86, 'A_OPUS'),
    ...uintEl(0x83, 2),
    ...element(0x63a2, opusHead(o.channels, o.rate)),
    ...uintEl(0x56aa, Math.round((OPUS_PRESKIP / o.rate) * 1e9)),
    ...uintEl(0x56bb, 80000000),
    ...element(0xe1, [...floatEl(0xb5, o.rate), ...uintEl(0x9f, o.channels)]),
  ]);
  const tracks = element(0x1654ae6b, [...vtrack, ...(audio.length ? atrack : [])]);
  const blocks: Block[] = [...video.map((f) => ({ ...f, track: 1 as const })), ...audio.map((f) => ({ ...f, track: 2 as const }))].sort((a, b) => a.time - b.time || a.track - b.track);
  const clusters: Uint8Array[] = [];
  let cluster: Uint8Array[] = [];
  let clusterTime = 0;
  const flush = () => {
    if (!cluster.length) return;
    clusters.push(...element(0x1f43b675, [...uintEl(0xe7, clusterTime), ...cluster]));
    cluster = [];
  };
  for (const f of blocks) {
    const t = Math.max(0, Math.round(f.time));
    if (!cluster.length || (f.track === 1 && f.key) || t - clusterTime > 30000) {
      flush();
      clusterTime = t;
    }
    const rel = t - clusterTime;
    const head = new Uint8Array(4);
    head[0] = 0x80 | f.track;
    head[1] = (rel >> 8) & 0xff;
    head[2] = rel & 0xff;
    head[3] = f.key || f.track === 2 ? 0x80 : 0;
    cluster.push(...element(0xa3, [head, f.data]));
  }
  flush();
  return [...header, ...element(0x18538067, [...info, ...tracks, ...clusters])];
}

/** WebM (VP9/VP8 + Opus) writer, or null when WebCodecs audio encoding is unavailable. */
export async function createAVWriter(width: number, height: number, fps: number, audio: AudioBuffer): Promise<VideoWriter | null> {
  const VE = (globalThis as unknown as { VideoEncoder?: typeof VideoEncoder }).VideoEncoder;
  const AE = (globalThis as unknown as { AudioEncoder?: typeof AudioEncoder }).AudioEncoder;
  if (!VE || !AE) return null;
  const w = Math.max(2, width & ~1),
    h = Math.max(2, height & ~1);
  const channels = Math.min(2, audio.numberOfChannels);
  const rate = audio.sampleRate;
  const aconf: AudioEncoderConfig = { codec: 'opus', sampleRate: rate, numberOfChannels: channels, bitrate: 160000 };
  try {
    if (!(await AE.isConfigSupported(aconf)).supported) return null;
  } catch {
    return null;
  }
  let vconf: VideoEncoderConfig | null = null;
  let codec: 'V_VP8' | 'V_VP9' = 'V_VP9';
  const bitrate = Math.min(40e6, Math.max(2e6, w * h * fps * 0.12));
  for (const [c, id] of [
    ['vp09.00.10.08', 'V_VP9'],
    ['vp8', 'V_VP8'],
  ] as const) {
    const cfg: VideoEncoderConfig = { codec: c, width: w, height: h, bitrate, framerate: fps };
    try {
      if ((await VE.isConfigSupported(cfg)).supported) {
        vconf = cfg;
        codec = id;
        break;
      }
    } catch {
      /* try the next codec */
    }
  }
  if (!vconf) return null;
  const vframes: EncodedFrame[] = [];
  const aframes: EncodedFrame[] = [];
  let error: unknown = null;
  const venc = new VE({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      vframes.push({ data, time: chunk.timestamp / 1000, key: chunk.type === 'key' });
    },
    error: (e) => (error = e),
  });
  venc.configure(vconf);
  const aenc = new AE({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      aframes.push({ data, time: chunk.timestamp / 1000, key: true });
    },
    error: (e) => (error = e),
  });
  aenc.configure(aconf);
  // audio is known up front: encode it in 20 ms frames
  const FR = Math.round(rate * 0.02);
  const planes = Array.from({ length: channels }, (_, c) => audio.getChannelData(c));
  for (let i = 0; i < audio.length; i += FR) {
    const n = Math.min(FR, audio.length - i);
    const buf = new Float32Array(n * channels);
    for (let c = 0; c < channels; c++) buf.set(planes[c].subarray(i, i + n), c * n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round((i / rate) * 1e6), data: buf });
    aenc.encode(ad);
    ad.close();
  }
  const scratch = document.createElement('canvas');
  scratch.width = w;
  scratch.height = h;
  const sctx = scratch.getContext('2d')!;
  let count = 0;
  return {
    async addFrame(canvas, index) {
      if (error) throw error;
      sctx.clearRect(0, 0, w, h);
      sctx.drawImage(canvas as CanvasImageSource, 0, 0);
      const frame = new VideoFrame(scratch, { timestamp: Math.round((index * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: count % Math.max(1, Math.round(fps * 2)) === 0 });
      frame.close();
      count++;
      while (venc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
    },
    async finish() {
      await Promise.all([venc.flush(), aenc.flush()]);
      venc.close();
      aenc.close();
      if (error) throw error;
      vframes.sort((a, b) => a.time - b.time);
      const dur = (count * 1000) / fps;
      const audioFrames = aframes.filter((f) => f.time < dur);
      const parts = muxWebMAV(vframes, audioFrames, { width: w, height: h, codec, duration: dur, channels, rate });
      return new Blob(parts as BlobPart[], { type: 'video/webm' });
    },
  };
}
