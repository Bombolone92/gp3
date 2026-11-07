// Generates the app's PNG icons from the master artwork at ./icon.png.
//
//   node scripts/generate-icons.js
//
// Pure Node (zlib only, no native deps): decode the master PNG, downsample with
// an area-average filter on premultiplied alpha, re-encode.
import { deflateSync, inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SOURCE = fileURLToPath(new URL('../icon.png', import.meta.url))
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url))

// --- PNG decode -------------------------------------------------------------
function decodePng(buf) {
  let p = 8
  let w, h, depth, ctype, interlace
  const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    const type = buf.toString('ascii', p + 4, p + 8)
    const data = buf.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      depth = data[8]
      ctype = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    p += 12 + len
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype]
  if (depth !== 8 || !ch || interlace) {
    throw new Error('icon.png must be a non-interlaced 8-bit gray/RGB/RGBA PNG')
  }
  const stride = w * ch
  const raw = inflateSync(Buffer.concat(idat))
  const out = new Uint8ClampedArray(w * h * 4)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride))
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0
      const b = prev[i]
      const c = i >= ch ? prev[i - ch] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const pa = Math.abs(b - c)
        const pb = Math.abs(a - c)
        const pc = Math.abs(a + b - 2 * c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[i] = v & 0xff
    }
    prev = line
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const i = x * ch
      out[o] = line[i]
      out[o + 1] = ch >= 3 ? line[i + 1] : line[i]
      out[o + 2] = ch >= 3 ? line[i + 2] : line[i]
      out[o + 3] = ch === 4 ? line[i + 3] : ch === 2 ? line[i + 1] : 255
    }
  }
  return { w, h, data: out }
}

// --- resize (area average over premultiplied alpha) -------------------------
function resize(src, size) {
  const out = { w: size, h: size, data: new Uint8ClampedArray(size * size * 4) }
  const sx = src.w / size
  const sy = src.h / size
  for (let y = 0; y < size; y++) {
    const y0 = y * sy
    const y1 = y0 + sy
    for (let x = 0; x < size; x++) {
      const x0 = x * sx
      const x1 = x0 + sx
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        total = 0
      for (let py = Math.floor(y0); py < Math.ceil(y1); py++) {
        const fy = Math.min(y1, py + 1) - Math.max(y0, py)
        for (let px = Math.floor(x0); px < Math.ceil(x1); px++) {
          const f = fy * (Math.min(x1, px + 1) - Math.max(x0, px))
          const i = (py * src.w + px) * 4
          const alpha = src.data[i + 3] / 255
          r += src.data[i] * alpha * f
          g += src.data[i + 1] * alpha * f
          b += src.data[i + 2] * alpha * f
          a += src.data[i + 3] * f
          total += f
        }
      }
      const alpha = a / total / 255
      const o = (y * size + x) * 4
      if (alpha > 0) {
        out.data[o] = r / total / alpha
        out.data[o + 1] = g / total / alpha
        out.data[o + 2] = b / total / alpha
      }
      out.data[o + 3] = a / total
    }
  }
  return out
}

// --- PNG encode -------------------------------------------------------------
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}
function encodePng({ w, h, data }) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    const off = y * (w * 4 + 1)
    raw[off] = 0 // filter: none
    for (let i = 0; i < w * 4; i++) raw[off + 1 + i] = data[y * w * 4 + i]
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const master = decodePng(readFileSync(SOURCE))
for (const [name, size] of [
  ['icon-48.png', 48],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(PUBLIC + name, encodePng(resize(master, size)))
  console.log(`wrote public/${name} (${size}x${size})`)
}
