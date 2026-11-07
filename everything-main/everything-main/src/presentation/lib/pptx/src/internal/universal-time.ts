// MS-PPTX §2.3.4.6 ST_UniversalTimeOffset. Unlike advTm's base unsignedInt,
// this time type admits decimals and units, with milliseconds when omitted.
// ABNF quoted units are case-insensitive. The native reference repairs uppercase
// units; read the standard's grammar but author canonical unitless decimals.
const UNIT_MS: Readonly<Record<string, readonly [bigint, number]>> = {
  "": [1n, 0],
  h: [3600000n, 0],
  min: [60000n, 0],
  s: [1000n, 0],
  ms: [1n, 0],
  µs: [1n, -3],
  ns: [1n, -6],
};

export const readUniversalTimeOffset = (
  value: string | null,
): number | undefined => {
  if (value === null) return undefined;
  const match = /^(\d+(?:\.\d+)?)([a-zA-Zµ]*)$/.exec(value);
  if (!match) return undefined;
  const unit = match[2]!.toLowerCase();
  if (!Object.hasOwn(UNIT_MS, unit)) return undefined;
  const [factor, exponent] = UNIT_MS[unit]!;
  const [whole, fraction = ""] = match[1]!.split(".");
  // Scale the decimal before converting to a float. Otherwise very large
  // nanosecond values overflow, or tiny hour values underflow, even when their
  // millisecond result is representable. Round just once at the API boundary.
  const digits = BigInt(whole! + fraction) * factor;
  const ms = Number(`${digits}e${exponent - fraction.length}`);
  return Number.isFinite(ms) ? ms : undefined;
};

export const writeUniversalTimeOffset = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0)
    throw new Error("transition: durationMs must be finite and nonnegative");
  const value = String(ms);
  if (!/[eE]/.test(value)) return value;
  // JavaScript's exponential notation is outside this XML type's grammar.
  const [mantissa, exponent] = value.split("e");
  const [whole, fraction = ""] = mantissa!.split(".");
  const digits = whole! + fraction;
  const point = whole!.length + Number(exponent);
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + "0".repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
};
