// An internationalised domain name as its owner writes it. An address holds
// it in punycode ("xn--mnchen-3ya.de"), which no one wants to read on a
// link card. Decoding follows RFC 3492; a label that does not decode stays
// as it is.
const BASE = 36,
  T_MIN = 1,
  T_MAX = 26,
  SKEW = 38,
  DAMP = 700,
  INITIAL_BIAS = 72,
  INITIAL_N = 128;
function adapt(delta, points, first) {
  delta = first ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / points);
  let k = 0;
  while (delta > ((BASE - T_MIN) * T_MAX) >> 1) {
    delta = Math.floor(delta / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * delta) / (delta + SKEW));
}
function digit(code) {
  if (code >= 48 && code <= 57) return code - 22;
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97;
  return BASE;
}
function decodeLabel(input) {
  const output = [];
  const basic = Math.max(0, input.lastIndexOf("-"));
  for (let j = 0; j < basic; j++) {
    const code = input.charCodeAt(j);
    if (code >= 0x80) throw Error("not punycode");
    output.push(code);
  }
  let n = INITIAL_N,
    i = 0,
    bias = INITIAL_BIAS;
  for (let index = basic > 0 ? basic + 1 : 0; index < input.length;) {
    const start = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (index >= input.length) throw Error("not punycode");
      const d = digit(input.charCodeAt(index++));
      if (d >= BASE) throw Error("not punycode");
      i += d * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (d < t) break;
      w *= BASE - t;
    }
    const points = output.length + 1;
    bias = adapt(i - start, points, start === 0);
    n += Math.floor(i / points);
    i %= points;
    if (n > 0x10ffff) throw Error("not punycode");
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}
export function toUnicode(host) {
  return String(host)
    .split(".")
    .map((label) => {
      if (!/^xn--/i.test(label)) return label;
      try {
        return decodeLabel(label.slice(4).toLowerCase()) || label;
      } catch {
        return label;
      }
    })
    .join(".");
}
