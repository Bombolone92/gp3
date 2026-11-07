// Ogawa container (Alembic's binary file layer): a tree of groups and data blocks.
//   header: "Ogawa" | frozen byte (0xff) | u16 version | u64 root group offset
//   group:  u64 child count | u64 child offsets (high bit set → data block)
//   data:   u64 byte size | bytes
// Independent implementation from the publicly described layout.

export type OgawaChild = { kind: 'group'; offset: number } | { kind: 'data'; offset: number };

const DATA_BIT = 0x8000000000000000n;

export class OgawaReader {
  readonly dv: DataView;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 16 || String.fromCharCode(...bytes.subarray(0, 5)) !== 'Ogawa') throw new Error('Not an Alembic (Ogawa) file. HDF5-based Alembic files are not supported.');
    if (bytes[5] !== 0xff) throw new Error('The Alembic file was not finalized (it may still be being written)');
  }
  get root(): number {
    return this.u64(8);
  }
  u64(o: number): number {
    const v = this.dv.getBigUint64(o, true);
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Alembic offset out of range');
    return Number(v);
  }
  /** Children of the group at `offset` (offset 0 = empty group). */
  children(offset: number): OgawaChild[] {
    if (offset === 0) return [];
    if (offset + 8 > this.bytes.length) throw new Error('Corrupt Alembic group offset');
    const n = this.u64(offset);
    if (n > (this.bytes.length - offset) / 8) throw new Error('Corrupt Alembic group');
    const out: OgawaChild[] = [];
    for (let i = 0; i < n; i++) {
      const raw = this.dv.getBigUint64(offset + 8 + i * 8, true);
      if (raw & DATA_BIT) out.push({ kind: 'data', offset: Number(raw & ~DATA_BIT) });
      else out.push({ kind: 'group', offset: Number(raw) });
    }
    return out;
  }
  /** Bytes of the data block at `offset` (offset 0 = empty). */
  data(offset: number): Uint8Array {
    if (offset === 0) return new Uint8Array(0);
    const size = this.u64(offset);
    if (offset + 8 + size > this.bytes.length) throw new Error('Corrupt Alembic data block');
    return this.bytes.subarray(offset + 8, offset + 8 + size);
  }
}
