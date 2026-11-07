import type { VectorContent } from "ag-psd";
import { infoHandlersMap, type InfoHandler } from "ag-psd/dist/additionalInfo";
import { readSignature, readBytes } from "ag-psd/dist/psdReader";
import {
  writeSignature,
  writeUint32,
  writeUint8,
  writeAsciiString,
  writeFloat64,
  writeUnicodeStringWithPadding,
  type PsdWriter,
} from "ag-psd/dist/psdWriter";
import {
  parseVectorContent,
  readVersionAndDescriptor,
  writeDescriptorStructure,
} from "ag-psd/dist/descriptor";
import {
  parsePsdGradientFill,
  writePsdGradientFill,
} from "./psd-gradient-fill";

// ag-psd 31 retains pattern identity/link/phase, but drops Scl , Angl and
// Algn. Keep the PSD percentage itself, avoiding an unnecessary /100 *100
// round trip through a scale factor. Absence remains distinct from a default.
export type PsdPatternFill = Extract<VectorContent, { type: "pattern" }> & {
  scalePercent?: number;
  angle?: number;
  align?: boolean;
};
type FillKey = "PtFl" | "GdFl" | "vscg";
const keys: FillKey[] = ["PtFl", "GdFl", "vscg"];
const originalWrites = new Map(
  keys.map((key) => [key, infoHandlersMap[key].write]),
);

function finite(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Invalid PSD pattern-fill number.");
  return value;
}
function boolean(value: unknown) {
  if (typeof value !== "boolean")
    throw new Error("Invalid PSD pattern-fill boolean.");
  return value;
}
function unit(value: unknown, units: "Percent" | "Angle") {
  if (
    !value ||
    typeof value !== "object" ||
    !("units" in value) ||
    value.units !== units ||
    !("value" in value)
  )
    throw new Error("Invalid PSD pattern-fill units.");
  return finite(value.value);
}
function validate(fill: PsdPatternFill) {
  if (typeof fill.id !== "string" || typeof fill.name !== "string")
    throw new Error("Invalid PSD pattern identity.");
  if (fill.scalePercent !== undefined) finite(fill.scalePercent);
  if (fill.angle !== undefined) finite(fill.angle);
  if (fill.align !== undefined) boolean(fill.align);
  if (fill.linked !== undefined) boolean(fill.linked);
  if (fill.phase !== undefined) {
    if (!fill.phase || typeof fill.phase !== "object")
      throw new Error("Invalid PSD pattern phase.");
    finite(fill.phase.x);
    finite(fill.phase.y);
  }
}

function readFill(key: FillKey): InfoHandler["read"] {
  return (reader, target, left) => {
    // A descriptor has nested lengths. Limit its view to this tagged block,
    // so a short length cannot borrow bytes from the following layer record.
    const bytes = readBytes(reader, left()),
      local = {
        ...reader,
        view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        offset: 0,
      };
    if (key === "vscg") readSignature(local);
    const descriptor = readVersionAndDescriptor(local),
      fill =
        descriptor.Grad !== undefined
          ? parsePsdGradientFill(descriptor)
          : parseVectorContent(descriptor);
    if (fill.type === "pattern") {
      const pattern = fill as PsdPatternFill;
      if (descriptor["Scl "] !== undefined)
        pattern.scalePercent = unit(descriptor["Scl "], "Percent");
      if (descriptor.Angl !== undefined)
        pattern.angle = unit(descriptor.Angl, "Angle");
      if (descriptor.Algn !== undefined)
        pattern.align = boolean(descriptor.Algn);
      validate(pattern);
    }
    target.vectorFill = fill as VectorContent;
  };
}

/** Scoped readers share the dependency's pinned CommonJS dispatch graph. */
export function withPsdFillReaders<T>(read: () => T): T {
  const previous = keys.map((key) => infoHandlersMap[key].read);
  let failure: unknown;
  keys.forEach((key) => {
    const parse = readFill(key);
    infoHandlersMap[key].read = (...args) => {
      try {
        parse(...args);
      } catch (error) {
        // The dependency can suppress malformed additional-info blocks. Do
        // not silently discard a fill parameter and substitute its default.
        failure ??= error;
        throw error;
      }
    };
  });
  try {
    const result = read();
    if (failure) throw failure;
    return result;
  } finally {
    keys.forEach((key, i) => (infoHandlersMap[key].read = previous[i]));
  }
}

/** Encode standalone fills and the fill of a stroked shape (vscg). */
export function writePsdFill(
  key: FillKey,
  ...args: Parameters<InfoHandler["write"]>
) {
  const [writer, target] = args,
    fill = target.vectorFill;
  if (fill?.type === "solid" && key !== "PtFl") {
    writePsdGradientFill(writer, key, fill);
    return;
  }
  if (fill?.type !== "pattern") {
    originalWrites.get(key)!(...args);
    return;
  }
  const pattern = fill as PsdPatternFill;
  validate(pattern);
  // The dependency also lacks Lnkd in its descriptor type table and writes
  // it as a long, rejecting boolean values. Specify this descriptor's
  // field types directly. Nested identity/point descriptors reuse its codec.
  const fields: [string, string, () => void][] = [
    [
      "Ptrn",
      "Objc",
      () =>
        writeDescriptorStructure(
          writer,
          "",
          "Ptrn",
          {
            "Nm  ": pattern.name,
            Idnt: pattern.id,
          },
          "",
        ),
    ],
  ];
  if (pattern.scalePercent !== undefined)
    fields.push([
      "Scl ",
      "UntF",
      () => {
        writeSignature(writer, "#Prc");
        writeFloat64(writer, pattern.scalePercent!);
      },
    ]);
  if (pattern.angle !== undefined)
    fields.push([
      "Angl",
      "UntF",
      () => {
        writeSignature(writer, "#Ang");
        writeFloat64(writer, pattern.angle!);
      },
    ]);
  if (pattern.align !== undefined)
    fields.push(["Algn", "bool", () => writeUint8(writer, +pattern.align!)]);
  if (pattern.linked !== undefined)
    fields.push(["Lnkd", "bool", () => writeUint8(writer, +pattern.linked!)]);
  if (pattern.phase !== undefined)
    fields.push([
      "phase",
      "Objc",
      () =>
        writeDescriptorStructure(
          writer,
          "",
          "Pnt ",
          {
            Hrzn: pattern.phase!.x,
            Vrtc: pattern.phase!.y,
          },
          "",
        ),
    ]);
  if (key === "vscg") writeSignature(writer, "PtFl");
  writeUint32(writer, 16);
  writeUnicodeStringWithPadding(writer, "");
  identifier(writer, "null");
  writeUint32(writer, fields.length);
  for (const [name, type, write] of fields) {
    identifier(writer, name);
    writeSignature(writer, type);
    write();
  }
}

function identifier(writer: PsdWriter, text: string) {
  writeUint32(writer, text.length === 4 ? 0 : text.length);
  writeAsciiString(writer, text);
}

export function withPsdFillWriters<T>(write: () => T): T {
  const previous = keys.map((key) => infoHandlersMap[key].write);
  keys.forEach((key) => {
    infoHandlersMap[key].write = (...args) => writePsdFill(key, ...args);
  });
  try {
    return write();
  } finally {
    keys.forEach((key, i) => (infoHandlersMap[key].write = previous[i]));
  }
}
