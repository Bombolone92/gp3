/** Bounded OLE property-set reader for HWP's document summary streams. */
import { Reader, check } from './binary.js';

const summaryIds = new Set(['e0859ff2f94f6810ab9108002b27b3d9', '60b6a29f6110d411b4c6006097c09d8c']);
const names = { 2: 'title', 3: 'subject', 4: 'creator', 5: 'keywords', 6: 'description', 8: 'lastModifiedBy', 12: 'created', 13: 'modified' };
const codepages = { 1200: 'utf-16le', 1201: 'utf-16be', 65001: 'utf-8', 1252: 'windows-1252', 949: 'euc-kr', 932: 'shift_jis', 936: 'gbk', 950: 'big5' };

export function summaryMetadata(bytes) {
  const r = new Reader(bytes), result = {};
  check(r.u16() === 0xfffe && r.u16() <= 1); r.skip(20);
  const count = r.u32(); check(count > 0 && count <= 2);
  const sets = Array.from({ length: count }, () => {
    const guid = Array.from(bytes.subarray(r.take(16), r.pos), (n) => n.toString(16).padStart(2, '0')).join('');
    return { guid, offset: r.u32() };
  });
  for (const { guid, offset } of sets) {
    if (!summaryIds.has(guid)) continue;
    check(offset >= 28 + count * 20 && offset + 8 <= bytes.length);
    const header = new Reader(bytes.subarray(offset)), size = header.u32(), properties = header.u32();
    check(properties <= 4096 && size >= 8 + properties * 8 && offset + size <= bytes.length);
    const offsets = new Map();
    for (let i = 0; i < properties; i++) {
      const id = header.u32(), pos = header.u32();
      check(!offsets.has(id) && pos >= 8 + properties * 8 && pos + 4 <= size); offsets.set(id, pos);
    }
    const positions = [...new Set(offsets.values())].sort((a, b) => a - b);
    const ends = new Map(positions.map((pos, i) => [pos, positions[i + 1] ?? size]));
    const value = (id) => offsets.has(id) ? new Reader(bytes.subarray(offset + offsets.get(id), offset + ends.get(offsets.get(id)))) : null;
    const cp = value(1); let encoding = 'windows-1252';
    if (cp) { check(cp.u32() === 2); encoding = codepages[cp.u16()]; }
    for (const [id, key] of Object.entries(names)) {
      const v = value(Number(id)); if (!v) continue;
      const type = v.u32();
      if (type === 31 || type === 30) {
        const length = v.u32(); check(length <= 65536);
        const byteLength = length * (type === 31 ? 2 : 1);
        const decoder = type === 31 ? 'utf-16le' : encoding; check(decoder);
        const text = new TextDecoder(decoder, { fatal: true }).decode(v.bytes.subarray(v.take(byteLength), v.pos)).replace(/\0+$/, '');
        if (text) result[key] = text;
      } else if (type === 64 && (key === 'created' || key === 'modified')) {
        const low = v.u32(), ticks = BigInt(v.u32()) << 32n | BigInt(low);
        const ms = Number(ticks / 10000n - 11644473600000n);
        if (ticks && ms >= -62135596800000 && ms <= 253402300799999) result[key] = new Date(ms).toISOString();
      }
    }
  }
  return result;
}
