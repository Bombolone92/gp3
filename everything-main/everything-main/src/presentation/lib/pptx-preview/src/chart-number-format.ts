// The fixed-number subset of SpreadsheetML format codes used by chart labels.
// Keep literal text separate from operators: a quoted or escaped comma neither
// groups digits nor scales the value. Other format families use the caller's
// existing fallback; this does not rewrite the chart's stored format code.

// Round the decimal representation before applying digit placeholders. Binary
// multiplication/toFixed can round native decimal midpoints down (1.005 or a
// scaled 15). Shift the decimal point in the source representation and perform
// the carry on integer digits, without an absolute epsilon or precision loss.
const roundedDecimal = (
  value: number,
  shift: number,
  decimals: number,
): string => {
  const [coefficient, exponent = "0"] = value.toString().split("e");
  const point = coefficient!.indexOf(".");
  const digits = coefficient!.replace(".", "");
  const keep =
    (point < 0 ? coefficient!.length : point) +
    Number(exponent) +
    shift +
    decimals;
  let rounded = digits
    .slice(0, Math.max(0, keep))
    .padEnd(Math.max(0, keep), "0");
  if (keep >= 0 && (digits[keep] ?? "0") >= "5")
    rounded = (BigInt(rounded || "0") + 1n).toString();
  const padded = rounded.replace(/^0+/, "").padStart(decimals + 1, "0");
  return decimals
    ? `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`
    : padded;
};

export const formatFixedChartNumber = (
  value: number,
  format: string,
): string | undefined => {
  const tokens: { text: string; literal: boolean }[] = [];
  for (let i = 0; i < format.length; i++) {
    const char = format[i]!;
    if (char === '"') {
      let text = "";
      while (++i < format.length && format[i] !== '"') {
        if (format[i] === "\\") {
          if (++i === format.length) return undefined;
        }
        text += format[i];
      }
      if (i === format.length) return undefined;
      tokens.push({ text, literal: true });
    } else if (char === "\\") {
      if (++i === format.length) return undefined;
      tokens.push({ text: format[i]!, literal: true });
    } else tokens.push({ text: char, literal: false });
  }
  const placeholder = (t: (typeof tokens)[number]) =>
    !t.literal && (t.text === "0" || t.text === "#");
  let first = tokens.findIndex(placeholder);
  if (first < 0) return undefined;
  if (tokens[first - 1]?.text === "." && !tokens[first - 1]!.literal) first--;
  let last = tokens.length - 1;
  while (!placeholder(tokens[last]!)) last--;
  if (tokens[last + 1]?.text === "." && !tokens[last + 1]!.literal) last++;
  // Scaling commas may follow the last decimal placeholder as well as the
  // integer placeholders (e.g. 0.00, and #,##0,,.00).
  while (tokens[last + 1]?.text === "," && !tokens[last + 1]!.literal) last++;
  const body = tokens.slice(first, last + 1);
  if (body.some((t) => t.literal)) return undefined;
  const match = /^([#0]+(?:,[#0]+)*)?(,*)(?:\.([#0]*))?(,*)$/.exec(
    body.map((t) => t.text).join(""),
  );
  if (!match) return undefined;
  const affixes = [...tokens.slice(0, first), ...tokens.slice(last + 1)];
  if (affixes.some((t) => !t.literal && !/^[\s$¥£€%+()\-]$/.test(t.text)))
    return undefined;
  const decimals = match[3]?.length ?? 0;
  if (decimals > 100 || !Number.isFinite(value)) return undefined;
  const scale = match[2]!.length + match[4]!.length;
  const percent = affixes.filter((t) => !t.literal && t.text === "%").length;
  const magnitude = Math.abs(value) * 10 ** (2 * percent - 3 * scale);
  if (!Number.isFinite(magnitude)) return undefined;
  const rounded = roundedDecimal(
    Math.abs(value),
    2 * percent - 3 * scale,
    decimals,
  );
  const [integer, fraction = ""] = rounded.split(".");
  const integerPattern = (match[1] ?? "").replace(/,/g, "");
  const significantInteger = integer === "0" ? "" : integer!;
  const offset = significantInteger.length - integerPattern.length;
  // Placeholders consume digits in position. Outside the significant digits,
  // only 0 emits a zero: 0# formats 1 as 01 but zero as 0; #0#0 gives 010.
  const padded =
    significantInteger.slice(0, Math.max(0, offset)) +
    [...integerPattern]
      .map(
        (token, i) =>
          significantInteger[offset + i] ?? (token === "0" ? "0" : ""),
      )
      .join("");
  const significantFraction = fraction.replace(/0+$/, "").length;
  const fractionDigits = [...(match[3] ?? "")]
    .map((token, i) =>
      i < significantFraction ? fraction[i] : token === "0" ? "0" : "",
    )
    .join("");
  // Only commas between integer placeholders are grouping operators.
  const digits = match[1]?.includes(",")
    ? padded.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : padded;
  return (
    (value < 0 && Number(rounded) !== 0 ? "-" : "") +
    tokens
      .slice(0, first)
      .map((t) => t.text)
      .join("") +
    digits +
    // An authored decimal point remains even when every decimal # is empty.
    (match[3] === undefined ? "" : `.${fractionDigits}`) +
    tokens
      .slice(last + 1)
      .map((t) => t.text)
      .join("")
  );
};
