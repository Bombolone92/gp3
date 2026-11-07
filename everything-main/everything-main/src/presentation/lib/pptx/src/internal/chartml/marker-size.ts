// ECMA-376 ST_MarkerSize: integer points, inclusive range 2..72.
export const validateMarkerSizePt = (value: number): number => {
  if (!Number.isInteger(value) || value < 2 || value > 72)
    throw new RangeError(
      "markerSizePt: expected an integer from 2 to 72 points",
    );
  return value;
};

export const readMarkerSizePt = (raw: string | null): number | undefined => {
  // CT_MarkerSize defaults val to 5 only when the size element exists.
  if (raw === null) return 5;
  const token = raw.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
  if (!/^\+?\d+$/.test(token)) return undefined;
  try {
    return validateMarkerSizePt(Number(token));
  } catch {
    return undefined;
  }
};
