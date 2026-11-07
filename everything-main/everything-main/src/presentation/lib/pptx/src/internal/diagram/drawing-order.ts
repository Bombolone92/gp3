import { getAttrValue, qname, type XmlElement } from "../xml/index.ts";

/** CT_Shape.zOrderOff is an XML Schema int, with default zero. */
export const readDiagramZOrderOffset = (shape: XmlElement): number => {
  const raw = getAttrValue(shape, qname("", "zOrderOff", ""));
  if (raw === null) return 0;
  const value = /^[ \t\r\n]*([+-]?\d+)[ \t\r\n]*$/.exec(raw)?.[1];
  if (value === undefined)
    throw new Error("invalid diagram shape z-order offset");
  const offset = Number(value);
  if (offset < -2147483648 || offset > 2147483647)
    throw new Error("invalid diagram shape z-order offset");
  return offset || 0;
};

/**
 * ECMA-376 21.4.2.27 offsets each shape from its default XML drawing order.
 * Use immutable base positions, not successive moves in an already reordered
 * array. Shapes omitted from the drawing (none, exact points, absorbed hidden
 * TX) have no stack slot. Data associations, palettes and geometry retain their
 * original layout order; only the final display stack changes.
 *
 * At an equal destination rank a positive offset goes above the shape at that
 * rank, while a negative offset goes below it. The native timeline cache
 * corroborates +1 crossing the next emitted shape across non-drawing nodes.
 * Do not clamp ranks or coerce to 32-bit arithmetic: extreme offsets must retain
 * every shape and the relative order of equally offset shapes.
 */
export const orderDiagramDrawing = <T>(
  shapes: readonly T[],
  offsets: ReadonlyMap<T, number>,
): T[] =>
  shapes
    .map((shape, index) => {
      const offset = offsets.get(shape) ?? 0;
      return { shape, rank: index + offset, offset };
    })
    .sort((a, b) => a.rank - b.rank || a.offset - b.offset)
    .map(({ shape }) => shape);
