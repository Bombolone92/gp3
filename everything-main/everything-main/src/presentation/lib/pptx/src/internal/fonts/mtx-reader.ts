import { FontFormatError, requireBytes, viewOf } from "./binary.ts";

/** Byte-aligned CTF values. Counts never advance a cursor before checking. */
export class MtxReader {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  at = 0;
  readonly context: string;
  constructor(bytes: Uint8Array, context: string) {
    this.bytes = bytes;
    this.view = viewOf(bytes);
    this.context = context;
  }
  private position(count: number): number {
    requireBytes(this.bytes, this.at, count, this.context);
    const at = this.at;
    this.at += count;
    return at;
  }
  take(count: number): Uint8Array {
    const at = this.position(count);
    return this.bytes.subarray(at, at + count);
  }
  u8(): number {
    return this.bytes[this.position(1)]!;
  }
  u16(): number {
    return this.view.getUint16(this.position(2));
  }
  s16(): number {
    return this.view.getInt16(this.position(2));
  }
  u32(): number {
    return this.view.getUint32(this.position(4));
  }
  ushort(): number {
    const code = this.u8();
    return code === 253
      ? this.u16()
      : code === 255
        ? 253 + this.u8()
        : code === 254
          ? 506 + this.u8()
          : code;
  }
  short(code = this.u8()): number {
    if (code === 253) return this.s16();
    let sign = 1;
    if (code === 250) {
      sign = -1;
      code = this.u8();
    }
    if (code === 255) return sign * (250 + this.u8());
    if (code === 254) return sign * (500 + this.u8());
    // Match Read255Short: after the sign prefix, or inside a hop operand,
    // reserved hop bytes are ordinary magnitudes, not recursive commands.
    return sign * code;
  }
  finish(): void {
    if (this.at !== this.bytes.length)
      throw new FontFormatError(`unexpected trailing ${this.context} data`);
  }
}

export function checkMtxSize(size: number, limit: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > limit)
    throw new FontFormatError(
      "MTX reconstructed font exceeds the output limit",
    );
}

export function mtxInteger(
  value: number,
  low: number,
  high: number,
  context: string,
): number {
  if (!Number.isInteger(value) || value < low || value > high)
    throw new FontFormatError(`MTX ${context} is out of range`);
  return value;
}
