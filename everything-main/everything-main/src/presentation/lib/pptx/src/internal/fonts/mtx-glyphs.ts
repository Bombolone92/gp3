import { FontFormatError, viewOf } from "./binary.ts";
import { MtxReader, checkMtxSize, mtxInteger } from "./mtx-reader.ts";
import { readMtxPushes, writeMtxPushes } from "./mtx-pushes.ts";

type Box = readonly [number, number, number, number];

function triplet(input: MtxReader, flag: number): readonly [number, number] {
  const code = flag & 127;
  let x = 0,
    y = 0;
  if (code < 10) y = (code >>> 1) * 256 + input.u8();
  else if (code < 20) x = ((code - 10) >>> 1) * 256 + input.u8();
  else if (code < 84) {
    const byte = input.u8(),
      index = code - 20;
    x = 1 + (index >>> 4) * 16 + (byte >>> 4);
    y = 1 + ((index & 15) >>> 2) * 16 + (byte & 15);
  } else if (code < 120) {
    const index = code - 84;
    x = 1 + Math.floor(index / 12) * 256 + input.u8();
    y = 1 + Math.floor((index % 12) / 4) * 256 + input.u8();
  } else if (code < 124) {
    const a = input.u8(),
      b = input.u8(),
      c = input.u8();
    x = a * 16 + (b >>> 4);
    y = (b & 15) * 256 + c;
  } else {
    x = input.u16();
    y = input.u16();
  }
  // The y-only and x-only ranges use bit 0 for the nonzero axis.
  if (code < 10) y *= code & 1 ? 1 : -1;
  else {
    x *= code & 1 ? 1 : -1;
    y *= code & 2 ? 1 : -1;
  }
  return [
    mtxInteger(x, -32768, 32767, "glyph x delta"),
    mtxInteger(y, -32768, 32767, "glyph y delta"),
  ];
}

function header(bytes: Uint8Array, contours: number, box: Box): DataView {
  const view = viewOf(bytes);
  view.setInt16(0, contours);
  box.forEach((value, i) =>
    view.setInt16(2 + i * 2, mtxInteger(value, -32768, 32767, "glyph bounds")),
  );
  return view;
}

function program(
  glyph: MtxReader,
  pushes: MtxReader,
  code: MtxReader,
): Uint8Array {
  const count = glyph.ushort(),
    length = glyph.ushort(),
    initial = writeMtxPushes(readMtxPushes(pushes, count));
  if (initial.length + length > 65535)
    throw new FontFormatError("MTX glyph instruction length exceeds uint16");
  const tail = code.take(length),
    output = new Uint8Array(initial.length + length);
  output.set(initial);
  output.set(tail, initial.length);
  return output;
}

function simple(
  input: MtxReader,
  pushes: MtxReader,
  code: MtxReader,
  contours: number,
  explicitBox: Box | null,
  limit: number,
): { bytes: Uint8Array; instructionLength: number; references: number[] } {
  const endpoints = new Uint16Array(contours);
  let end = 0;
  for (let i = 0; i < contours; i++) {
    const count = input.ushort();
    if (i && !count) throw new FontFormatError("MTX contour has no points");
    end = i ? end + count : count;
    endpoints[i] = mtxInteger(end, 0, 65535, "contour endpoint");
  }
  const points = contours ? end + 1 : 0;
  if (points || explicitBox)
    checkMtxSize(12 + 2 * contours + 5 * points, limit);
  const flags = input.take(points),
    xs = new Int16Array(points),
    ys = new Int16Array(points);
  let x = 0,
    y = 0,
    xmin = Infinity,
    ymin = Infinity,
    xmax = -Infinity,
    ymax = -Infinity;
  for (let i = 0; i < points; i++) {
    const [dx, dy] = triplet(input, flags[i]!);
    xs[i] = dx;
    ys[i] = dy;
    x += dx;
    y += dy;
    xmin = Math.min(xmin, x);
    ymin = Math.min(ymin, y);
    xmax = Math.max(xmax, x);
    ymax = Math.max(ymax, y);
  }
  const instructions = program(input, pushes, code);
  // Empty outlines without instructions have equal consecutive loca entries.
  // An explicit box or a zero-contour hint program still needs a glyph header.
  if (!points && !instructions.length && !explicitBox)
    return { bytes: new Uint8Array(), instructionLength: 0, references: [] };
  const length = 12 + 2 * contours + instructions.length + 5 * points;
  checkMtxSize(Math.ceil(length / 2) * 2, limit);
  const bytes = new Uint8Array(Math.ceil(length / 2) * 2),
    box: Box =
      explicitBox ?? (points ? [xmin, ymin, xmax, ymax] : [0, 0, 0, 0]),
    view = header(bytes, contours, box);
  let at = 10;
  for (const endpoint of endpoints) {
    view.setUint16(at, endpoint);
    at += 2;
  }
  view.setUint16(at, instructions.length);
  at += 2;
  bytes.set(instructions, at);
  at += instructions.length;
  // Long relative coordinates retain point numbering and all on/off-curve
  // semantics. No flag repetition is required by the native format.
  for (const flag of flags) bytes[at++] = flag & 128 ? 0 : 1;
  for (const dx of xs) {
    view.setInt16(at, dx);
    at += 2;
  }
  for (const dy of ys) {
    view.setInt16(at, dy);
    at += 2;
  }
  return { bytes, instructionLength: instructions.length, references: [] };
}

function composite(
  input: MtxReader,
  pushes: MtxReader,
  code: MtxReader,
  contours: number,
  box: Box,
  numGlyphs: number,
  limit: number,
): { bytes: Uint8Array; instructionLength: number; references: number[] } {
  const start = input.at,
    references: number[] = [];
  let flags: number,
    anyInstructions = false;
  do {
    flags = input.u16();
    references.push(
      mtxInteger(input.u16(), 0, numGlyphs - 1, "composite glyph reference"),
    );
    const transforms =
      Number(!!(flags & 8)) + Number(!!(flags & 64)) + Number(!!(flags & 128));
    if (transforms > 1)
      throw new FontFormatError("MTX composite has conflicting transforms");
    input.take(flags & 1 ? 4 : 2);
    input.take(flags & 8 ? 2 : flags & 64 ? 4 : flags & 128 ? 8 : 0);
    anyInstructions ||= !!(flags & 256);
  } while (flags & 32);
  const components = input.bytes.subarray(start, input.at),
    instructions =
      flags & 256 ? program(input, pushes, code) : new Uint8Array(),
    length =
      10 + components.length + (anyInstructions ? 2 + instructions.length : 0);
  checkMtxSize(Math.ceil(length / 2) * 2, limit);
  const bytes = new Uint8Array(Math.ceil(length / 2) * 2),
    view = header(bytes, contours, box);
  bytes.set(components, 10);
  // CTF counts follow the last component flag (MTX 5.10). Native glyf
  // requires the instruction length if ANY component sets that flag.
  if (anyInstructions) {
    view.setUint16(10 + components.length, instructions.length);
    bytes.set(instructions, 12 + components.length);
  }
  return { bytes, instructionLength: instructions.length, references };
}

function checkCycles(references: readonly number[][]): void {
  const states = new Uint8Array(references.length);
  for (let root = 0; root < references.length; root++) {
    if (states[root]) continue;
    const stack: Array<{ id: number; next: number }> = [{ id: root, next: 0 }];
    states[root] = 1;
    while (stack.length) {
      const frame = stack[stack.length - 1]!,
        list = references[frame.id]!;
      if (frame.next === list.length) {
        states[frame.id] = 2;
        stack.pop();
        continue;
      }
      const child = list[frame.next++]!;
      if (states[child] === 1)
        throw new FontFormatError("cyclic MTX composite glyphs");
      if (!states[child]) {
        states[child] = 1;
        stack.push({ id: child, next: 0 });
      }
    }
  }
}

export function reconstructMtxGlyphs(
  encoded: Uint8Array,
  pushData: Uint8Array,
  codeData: Uint8Array,
  numGlyphs: number,
  limit: number,
): { glyf: Uint8Array; offsets: Uint32Array; maxInstructions: number } {
  mtxInteger(numGlyphs, 0, 65535, "glyph count");
  const input = new MtxReader(encoded, "MTX glyph stream"),
    pushes = new MtxReader(pushData, "MTX push stream"),
    code = new MtxReader(codeData, "MTX instruction stream"),
    offsets = new Uint32Array(numGlyphs + 1),
    glyphs: Uint8Array[] = [],
    references: number[][] = [];
  let total = 0,
    maxInstructions = 0;
  for (let id = 0; id < numGlyphs; id++) {
    let contours = input.s16();
    const explicit = contours < 0 || contours === 0x7fff;
    if (contours === 0x7fff)
      contours = mtxInteger(input.s16(), 0, 32767, "simple contour count");
    const box: Box | null = explicit
      ? [input.s16(), input.s16(), input.s16(), input.s16()]
      : null;
    const glyph =
      contours < 0
        ? composite(
            input,
            pushes,
            code,
            contours,
            box!,
            numGlyphs,
            limit - total,
          )
        : simple(input, pushes, code, contours, box, limit - total);
    references.push(glyph.references);
    glyphs.push(glyph.bytes);
    total += glyph.bytes.length;
    maxInstructions = Math.max(maxInstructions, glyph.instructionLength);
    offsets[id + 1] = total;
  }
  input.finish();
  pushes.finish();
  code.finish();
  checkCycles(references);
  const glyf = new Uint8Array(total);
  glyphs.forEach((bytes, id) => glyf.set(bytes, offsets[id]!));
  return { glyf, offsets, maxInstructions };
}
