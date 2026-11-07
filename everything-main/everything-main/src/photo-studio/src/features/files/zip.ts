// Minimal ZIP writer (STORE method only), from the PKWARE APPNOTE 6.3.x
// layout: local file headers, the stored bytes, then a central directory.
// Image files are already compressed, so deflating them again buys little.
import { crc32 } from '../../imaging/codecs/bytes';

export type ZipEntry = { name: string; data: Uint8Array; date?: Date };

// MS-DOS date/time fields (2-second resolution, local time, 1980 epoch).
function dosDateTime(d: Date): [number, number] {
  const year = Math.max(1980, Math.min(2107, d.getFullYear()));
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [time, date];
}

/** Unique archive names: "a.png", "a 2.png", ... (case-insensitive). */
export function uniqueName(name: string, used: Set<string>): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '_') || 'file';
  const dot = clean.lastIndexOf('.');
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : '';
  let out = clean;
  for (let i = 2; used.has(out.toLowerCase()); i++) out = `${stem} ${i}${ext}`;
  used.add(out.toLowerCase());
  return out;
}

export function zipStore(entries: ZipEntry[]): Uint8Array {
  if (entries.length > 0xffff) throw new Error('A ZIP archive without ZIP64 holds at most 65535 files.');
  const enc = new TextEncoder();
  const names = entries.map((e) => enc.encode(e.name));
  let size = 22;
  entries.forEach((e, i) => (size += 30 + 46 + 2 * names[i].length + e.data.length));
  if (size > 0xffffffff) throw new Error('The archive exceeds 4 GB.');
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  const central: { offset: number; crc: number; time: number; date: number }[] = [];
  let p = 0;
  entries.forEach((e, i) => {
    const crc = crc32(e.data);
    const [time, date] = dosDateTime(e.date ?? new Date());
    central.push({ offset: p, crc, time, date });
    dv.setUint32(p, 0x04034b50, true);
    dv.setUint16(p + 4, 20, true); // version needed: 2.0
    dv.setUint16(p + 6, 0x0800, true); // bit 11: names are UTF-8
    dv.setUint16(p + 8, 0, true); // method 0: stored
    dv.setUint16(p + 10, time, true);
    dv.setUint16(p + 12, date, true);
    dv.setUint32(p + 14, crc, true);
    dv.setUint32(p + 18, e.data.length, true);
    dv.setUint32(p + 22, e.data.length, true);
    dv.setUint16(p + 26, names[i].length, true);
    dv.setUint16(p + 28, 0, true);
    out.set(names[i], p + 30);
    p += 30 + names[i].length;
    out.set(e.data, p);
    p += e.data.length;
  });
  const cdStart = p;
  entries.forEach((e, i) => {
    const c = central[i];
    dv.setUint32(p, 0x02014b50, true);
    dv.setUint16(p + 4, 20, true); // made by: MS-DOS/FAT attributes, 2.0
    dv.setUint16(p + 6, 20, true);
    dv.setUint16(p + 8, 0x0800, true);
    dv.setUint16(p + 10, 0, true);
    dv.setUint16(p + 12, c.time, true);
    dv.setUint16(p + 14, c.date, true);
    dv.setUint32(p + 16, c.crc, true);
    dv.setUint32(p + 20, e.data.length, true);
    dv.setUint32(p + 24, e.data.length, true);
    dv.setUint16(p + 28, names[i].length, true);
    // Extra, comment, disk number, internal and external attributes stay 0.
    dv.setUint32(p + 42, c.offset, true);
    out.set(names[i], p + 46);
    p += 46 + names[i].length;
  });
  dv.setUint32(p, 0x06054b50, true);
  dv.setUint16(p + 8, entries.length, true);
  dv.setUint16(p + 10, entries.length, true);
  dv.setUint32(p + 12, p - cdStart, true);
  dv.setUint32(p + 16, cdStart, true);
  return out;
}
