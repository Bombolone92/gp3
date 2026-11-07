/** Bounded readers for HWP's MS-CFB container and raw DEFLATE streams. */
import { Inflate } from 'fflate';

// A 10 MB report with 147,000 paragraphs holds 640,000 records; the file and expansion limits bound memory before this does.
// `cells` bounds one table; `documentCells` the tables of a document together (a long report has hundreds of tables).
export const LIMITS = { file: 32 * 1024 * 1024, expanded: 96 * 1024 * 1024, output: 256 * 1024 * 1024, records: 2000000, depth: 64, cells: 20000, documentCells: 500000, attributes: 1000000 };
export const TOO_MANY_CELLS = 'This Hanword document has more table cells than can be imported.';
export class HwpError extends Error {
  constructor(message) { super(message); this.name = 'HwpError'; }
}
export function check(ok, message = 'This Hanword file is damaged or incomplete.') {
  if (!ok) throw new HwpError(message);
}
export class Reader {
  constructor(bytes) { this.bytes = bytes; this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.pos = 0; }
  take(n) { check(Number.isSafeInteger(n) && n >= 0 && this.pos + n <= this.bytes.length); const p = this.pos; this.pos += n; return p; }
  u8() { return this.view.getUint8(this.take(1)); }
  i8() { return this.view.getInt8(this.take(1)); }
  u16() { return this.view.getUint16(this.take(2), true); }
  u32() { return this.view.getUint32(this.take(4), true); }
  i32() { return this.view.getInt32(this.take(4), true); }
  skip(n) { this.take(n); }
  string() { const n = this.u16() * 2; return new TextDecoder('utf-16le').decode(this.bytes.subarray(this.take(n), this.pos)); }
  get remaining() { return this.bytes.length - this.pos; }
}
export function joinBytes(chunks) {
  const out = new Uint8Array(chunks.reduce((n, b) => n + b.length, 0));
  let p = 0; for (const chunk of chunks) { out.set(chunk, p); p += chunk.length; } return out;
}
export function budget() {
  let used = 0;
  return (n) => { used += n; check(used <= LIMITS.expanded, 'This Hanword file expands beyond the 96 MB import limit.'); };
}
export function inflate(bytes, consume) {
  const chunks = [];
  try {
    const stream = new Inflate((chunk) => { consume(chunk.length); chunks.push(chunk); });
    // Small input chunks bound allocation before the output budget is checked.
    for (let p = 0; p < bytes.length; p += 1024) stream.push(bytes.subarray(p, p + 1024), p + 1024 >= bytes.length);
    check(bytes.length > 0);
    return joinBytes(chunks);
  } catch (e) { if (e instanceof HwpError) throw e; throw new HwpError('The compressed Hanword document data is damaged.'); }
}

/** MS-CFB v3/v4: FAT, DIFAT, directory trees, and mini streams. No filesystem access. */
export function compoundFile(bytes) {
  check(bytes.length >= 512);
  check([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((v, i) => bytes[i] === v), 'This is not an HWP 5 document.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (p) => view.getUint16(p, true), u32 = (p) => view.getUint32(p, true);
  const version = u16(26), shift = u16(30), sectorSize = 2 ** shift;
  check(u16(28) === 0xfffe && ((version === 3 && shift === 9) || (version === 4 && shift === 12)) && u16(32) === 6 && u32(56) === 4096);
  check(bytes.length % sectorSize === 0);
  const sectorCount = bytes.length / sectorSize - 1;
  const FREE = 0xffffffff, END = 0xfffffffe;
  const sector = (id) => { check(id < sectorCount); return bytes.subarray((id + 1) * sectorSize, (id + 2) * sectorSize); };
  const words = (b) => { const r = new Reader(b), out = []; while (r.remaining) out.push(r.u32()); return out; };
  const fatCount = u32(44), difCount = u32(72);
  check(fatCount > 0 && fatCount <= sectorCount && difCount <= sectorCount);
  const fatIds = [];
  for (let p = 76; p < 512; p += 4) if (u32(p) !== FREE) fatIds.push(u32(p));
  let dif = u32(68); const seenDif = new Set();
  for (let i = 0; i < difCount; i++) {
    check(!seenDif.has(dif)); seenDif.add(dif);
    const ids = words(sector(dif)); dif = ids.pop();
    fatIds.push(...ids.filter((id) => id !== FREE));
  }
  check(fatIds.length === fatCount && new Set(fatIds).size === fatCount);
  const fat = fatIds.flatMap((id) => words(sector(id)));
  function chain(start, table, getSector, expected, size = sectorSize) {
    if (expected === 0) return new Uint8Array();
    const ids = new Set(), chunks = []; let id = start;
    while (id !== END) {
      check(id < table.length && !ids.has(id) && ids.size < sectorCount * (sectorSize / size));
      ids.add(id); chunks.push(getSector(id)); id = table[id];
      if (expected !== undefined) check(chunks.length <= Math.ceil(expected / size));
    }
    if (expected !== undefined) check(chunks.length === Math.ceil(expected / size));
    const out = joinBytes(chunks); return expected === undefined ? out : out.subarray(0, expected);
  }
  const directory = chain(u32(48), fat, sector);
  const entries = [];
  for (let p = 0; p + 128 <= directory.length; p += 128) {
    const r = new Reader(directory.subarray(p, p + 128));
    r.pos = 64; const n = r.u16(), type = r.u8(); r.skip(1);
    const left = r.u32(), right = r.u32(), child = r.u32(); r.pos = 116;
    const start = r.u32(), size = r.u32(), high = r.u32();
    if (type) check(n >= 2 && n <= 64 && n % 2 === 0 && (!high || version === 3) && size <= LIMITS.file);
    entries.push({ name: new TextDecoder('utf-16le').decode(r.bytes.subarray(0, Math.max(0, n - 2))), type, left, right, child, start, size });
  }
  check(entries[0]?.type === 5);
  const miniCount = u32(64); check(miniCount <= sectorCount);
  const miniFat = words(chain(u32(60), fat, sector, miniCount * sectorSize));
  const root = entries[0], mini = chain(root.start, fat, sector, root.size);
  const files = new Map(), visited = new Set([0]), stack = [[root.child, '', 0]];
  while (stack.length) {
    const [id, path, depth] = stack.pop(); if (id === FREE) continue;
    check(id < entries.length && !visited.has(id) && depth <= LIMITS.depth); visited.add(id);
    const e = entries[id]; check(e.type === 1 || e.type === 2);
    check(e.name && !/[\\/]/.test(e.name));
    stack.push([e.left, path, depth], [e.right, path, depth]);
    const name = path + e.name;
    if (e.type === 1) stack.push([e.child, name + '/', depth + 1]);
    else { check(!files.has(name)); files.set(name, e); }
  }
  return {
    names: [...files.keys()],
    read(name) {
      const e = files.get(name); check(e, `The Hanword document is missing ${name}.`);
      if (e.size >= 4096) return chain(e.start, fat, sector, e.size);
      return chain(e.start, miniFat, (id) => { check((id + 1) * 64 <= mini.length); return mini.subarray(id * 64, (id + 1) * 64); }, e.size, 64);
    },
  };
}

/** HWP records use a 10-bit tag, 10-bit level, and 12-bit (or extended) size. */
export function records(bytes, countRecord = () => {}) {
  const r = new Reader(bytes), root = { children: [], level: -1 }, stack = [root]; let count = 0;
  while (r.remaining) {
    check(++count <= LIMITS.records);
    countRecord();
    const h = r.u32(), tag = h & 1023, level = (h >>> 10) & 1023;
    const size = (h >>> 20) === 4095 ? r.u32() : h >>> 20;
    check(level <= LIMITS.depth);
    const data = bytes.subarray(r.take(size), r.pos);
    while (stack.at(-1).level >= level) stack.pop();
    check(level <= stack.at(-1).level + 1);
    const node = { tag, level, data, children: [] };
    stack.at(-1).children.push(node); stack.push(node);
  }
  return root.children;
}
