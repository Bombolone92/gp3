// Shared color parsing for the authoring APIs.
//
// Accepts three forms: srgb hex (`#RRGGBB`,
// `RRGGBB`), scheme tokens (`tx1`, `accent1`... — bare or `scheme:`-prefixed),
// and an explicit `null` to indicate "clear / no fill". Anything else throws so
// callers don't silently emit `<a:srgbClr val="undefined"/>`.

import { type XmlElement, NS, attr, elem, qname } from "../xml/index.ts";

const NAME_SRGB_CLR = qname("a", "srgbClr", NS.dml);
const NAME_SCHEME_CLR = qname("a", "schemeClr", NS.dml);
const ATTR_VAL = qname("", "val", "");

const SCHEME_TOKENS = new Set([
  "bg1",
  "tx1",
  "bg2",
  "tx2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",
  "folHlink",
  "phClr",
  "lt1",
  "dk1",
  "lt2",
  "dk2",
]);

/** A tint or shade of a theme colour, as theme-colour palettes write them:
 * `scheme:accent1/lumMod=75000` or `scheme:bg1/lumMod=85000`, or
 * `scheme:accent2/lumMod=60000/lumOff=40000` for the lighter rows. */
export interface ColorModifier {
  readonly name: "lumMod" | "lumOff" | "tint" | "shade" | "alpha";
  readonly val: number;
}
const MODIFIERS = new Set(["lumMod", "lumOff", "tint", "shade", "alpha"]);
const parseModifiers = (parts: readonly string[]): ColorModifier[] | null => {
  const mods: ColorModifier[] = [];
  for (const part of parts) {
    const match = /^(\w+)=(\d{1,6})$/.exec(part);
    if (!match || !MODIFIERS.has(match[1]!)) return null;
    mods.push({
      name: match[1] as ColorModifier["name"],
      val: Number(match[2]),
    });
  }
  return mods;
};

export type ParsedColor =
  | { kind: "srgb"; hex: string; mods?: readonly ColorModifier[] }
  | { kind: "scheme"; token: string; mods?: readonly ColorModifier[] };

/**
 * Normalizes an sRGB hex string to the canonical uppercase 6-digit form
 * (no `#`), or returns `null` if it isn't a 3- or 6-digit hex. The CSS-style
 * 3-digit shorthand (`#f00` → `FF0000`) is accepted because LLM authors reach
 * for it constantly; 4-/8-digit (alpha) forms are rejected rather than
 * silently dropping the alpha channel, which OOXML encodes separately.
 */
const normalizeSrgbHex = (value: string): string | null => {
  const hex = value.startsWith("#") ? value.slice(1) : value;
  if (/^[0-9A-Fa-f]{6}$/.test(hex)) return hex.toUpperCase();
  if (/^[0-9A-Fa-f]{3}$/.test(hex)) {
    return Array.from(hex, (ch) => ch + ch)
      .join("")
      .toUpperCase();
  }
  return null;
};

/**
 * Parses a user-supplied color string. Returns null on unrecognized input
 * so callers can decide whether to throw with a specific message.
 *
 * Scheme tokens are accepted both bare (`accent1`) and with the explicit
 * `scheme:` prefix (`scheme:accent1`). The prefixed form is what the getters
 * (`getShapeFillColor`, `getSlideBackground`, …) return, so accepting it here
 * is what makes `setX(getX(...))` round-trip instead of throwing.
 */
export const parseColor = (value: string): ParsedColor | null => {
  // An sRGB colour may carry modifiers too: "#FFFF00/alpha=50000" is the
  // half-transparent yellow of a highlighter.
  if (!value.startsWith("scheme:") && value.includes("/")) {
    const [head, ...parts] = value.split("/");
    const hex = normalizeSrgbHex(head!);
    const mods = parseModifiers(parts);
    return hex === null || mods === null ? null : { kind: "srgb", hex, mods };
  }
  if (value.startsWith("scheme:") && value.includes("/")) {
    const [head, ...parts] = value.slice("scheme:".length).split("/");
    if (!SCHEME_TOKENS.has(head!)) return null;
    const mods = parseModifiers(parts);
    return mods === null ? null : { kind: "scheme", token: head!, mods };
  }

  const token = value.startsWith("scheme:")
    ? value.slice("scheme:".length)
    : value;
  if (SCHEME_TOKENS.has(token)) return { kind: "scheme", token };
  // A `scheme:`-prefixed value is unambiguously a scheme reference; an unknown
  // token there is an error, not a hex fallthrough.
  if (value !== token) return null;
  const hex = normalizeSrgbHex(value);
  return hex === null ? null : { kind: "srgb", hex };
};

/**
 * Parses an sRGB hex color (`#RRGGBB`, `RRGGBB`, or the 3-digit `#RGB`
 * shorthand), returning the normalized uppercase 6-digit hex (no `#`).
 * Returns `null` for anything else — including scheme tokens, which sRGB-only
 * contexts (e.g. chart series fills) must reject rather than silently
 * emit as an invalid `<a:srgbClr val="accent1"/>`.
 */
export const parseSrgbHex = (value: string): string | null =>
  normalizeSrgbHex(value);

/**
 * Returns the `<a:srgbClr>` or `<a:schemeClr>` element for `value`.
 * Throws on unrecognized colors.
 */
export const buildColorElement = (value: string): XmlElement => {
  const parsed = parseColor(value);
  if (parsed === null) throw new Error(`unrecognized color: ${value}`);
  const children = (parsed.mods ?? []).map((mod) =>
    elem(qname("a", mod.name, NS.dml), {
      attrs: [attr(ATTR_VAL, String(mod.val))],
    }),
  );
  return parsed.kind === "srgb"
    ? elem(NAME_SRGB_CLR, { attrs: [attr(ATTR_VAL, parsed.hex)], children })
    : elem(NAME_SCHEME_CLR, {
        attrs: [attr(ATTR_VAL, parsed.token)],
        children,
      });
};
