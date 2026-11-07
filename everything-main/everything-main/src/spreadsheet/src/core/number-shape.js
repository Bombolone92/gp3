// Numeral alphabets for number formats. Extended LCIDs store a numeral-system ID in their
// high byte; DBNum1–3 select one of these systems using the format's language.
const LATIN = '0123456789';
const FULLWIDTH = '０１２３４５６７８９';
const alphabets = [LATIN, LATIN, '٠١٢٣٤٥٦٧٨٩', '۰۱۲۳۴۵۶۷۸۹', '०१२३४५६७८९',
  '০১২৩৪৫৬৭৮৯', '੦੧੨੩੪੫੬੭੮੯', '૦૧૨૩૪૫૬૭૮૯', '୦୧୨୩୪୫୬୭୮୯',
  '0௧௨௩௪௫௬௭௮௯', '౦౧౨౩౪౫౬౭౮౯', '೦೧೨೩೪೫೬೭೮೯', '൦൧൨൩൪൫൬൭൮൯',
  '๐๑๒๓๔๕๖๗๘๙', '໐໑໒໓໔໕໖໗໘໙', '༠༡༢༣༤༥༦༧༨༩', '၀၁၂၃၄၅၆၇၈၉',
  '0፩፪፫፬፭፮፯፰፱', '០១២៣៤៥៦៧៨៩', '᠐᠑᠒᠓᠔᠕᠖᠗᠘᠙'];
// Numeric input reads these legacy numeral alphabets in numbers, dates and times,
// independently of the regional separators. It also reads Tamil zero, though
// its numeral format writes ASCII zero. Fullwidth digits, CJK number words and
// other Unicode digit sets are not numeric input in the native controls.
const inputDigits = new Map([['௦', '0']]);
for (const alphabet of alphabets.slice(2)) {
  for (let i = 0; i < alphabet.length; i++) if (alphabet[i] !== LATIN[i]) inputDigits.set(alphabet[i], LATIN[i]);
}
const inputDigitPattern = new RegExp(`[${[...inputDigits.keys()].join('')}]`, 'g');
const anyInputDigit = new RegExp(`[0-9${[...inputDigits.keys()].join('')}]`);

/** Whether text contains a numeral digit accepted in numeric input. */
export function hasNumberDigits(text) {
  return anyInputDigit.test(text);
}

/** Normalize only numeral digits for parsing. Keep the original text whenever
 * parsing fails; this is not a transformation of stored text or formulas. */
export function normalizeNumberDigits(text) {
  return text.replace(inputDigitPattern, digit => inputDigits.get(digit));
}

// digits, tens/hundreds/thousands, ten-thousands/hundred-millions/trillions,
// omit internal zeros, omit one before the small units, omit one in short
// calendar fields. Formal date numerals keep the one in ten; ordinary ones
// omit it, including Chinese/Korean systems whose General keeps that one.
const systems = [
  ['〇一二三四五六七八九', '十百千', '万億兆', true, true, true],
  ['〇壱弐参四伍六七八九', '拾百阡', '萬億兆', true, false, false],
  [FULLWIDTH, '十百千', '万億兆', true, true, false],
  ['○一二三四五六七八九', '十百千', '万亿兆', false, false, true],
  ['零壹贰叁肆伍陆柒捌玖', '拾佰仟', '万亿兆', false, false, false],
  [FULLWIDTH, '十百千', '万亿兆', false, false, false],
  ['○一二三四五六七八九', '十百千', '萬億兆', false, false, true],
  ['零壹貳參肆伍陸柒捌玖', '拾佰仟', '萬億兆', false, false, false],
  [FULLWIDTH, '十百千', '萬億兆', false, false, false],
  ['０一二三四五六七八九', '十百千', '万億兆', true, false, true],
  ['零壹貳參四伍六七八九', '拾百阡', '萬億兆', true, false, false],
  [FULLWIDTH, '十百千', '万億兆', true, true, false],
  ['영일이삼사오육칠팔구', '십백천', '만억조', true, false, true],
];

export function numberShape(mode, locale, numeral = 0) {
  let id = numeral;
  if (!id && mode >= 1 && mode <= 3) {
    const language = String(locale || '').toLowerCase();
    const base = /^ja(?:-|$)/.test(language) ? 0x1b : /^ko(?:-|$)/.test(language) ? 0x24
      : /^zh(?:-|$)/.test(language) ? (/hant|-(?:tw|hk|mo)(?:-|$)/.test(language) ? 0x21 : 0x1e) : 0;
    if (base) id = base + mode - 1;
  }
  if (!id && !(mode >= 1 && mode <= 3)) return null;
  const system = systems[id - 0x1b];
  return { digits: system?.[0] || alphabets[id] || LATIN, system,
    dateUnits: !!system && system[0] !== FULLWIDTH,
    // DBNum changes General's precision even when its language has no CJK
    // alphabet. An explicit numeral system alone keeps ordinary General.
    expanded: !numeral && mode >= 1 && mode <= 3 };
}

export function shapeDigits(text, shape) {
  return shape ? String(text).replace(/[0-9]/g, d => shape.digits[Number(d)]) : String(text);
}

/** Spell an unsigned integer in four-digit groups. Larger leading groups
 * retain their digits: the unit vocabulary ends at the trillion. */
function shapeInteger(text, shape, calendar = false) {
  if (!shape?.system || text.length < 2 || /^0/.test(text)) return shapeDigits(text, shape);
  const [digits, small, large, skipZeros, numberSkipOne, dateSkipOne] = shape.system;
  const skipOne = calendar ? dateSkipOne : numberSkipOne;
  let out = '', pendingZero = false;
  const groups = [];
  for (let end = text.length; end > 0;) {
    const start = groups.length === large.length ? 0 : Math.max(0, end - 4);
    groups.unshift(text.slice(start, end)); end = start;
  }
  groups.forEach((group, index) => {
    const power = groups.length - index - 1;
    if (!/[1-9]/.test(group)) return;
    if (group.length > 4) { out += shapeDigits(group, shape); }
    else {
      for (let i = 0; i < group.length; i++) {
        const digit = Number(group[i]), unit = group.length - i - 1;
        if (!digit) { pendingZero ||= !!out; continue; }
        if (pendingZero && !skipZeros) out += digits[0];
        pendingZero = false;
        if (!(digit === 1 && unit && skipOne)) out += digits[digit];
        if (unit) out += small[unit - 1];
      }
    }
    if (power) out += large[power - 1];
    // Trailing zeros inside a group do not introduce a zero before a full
    // next group. Its leading zero positions decide whether one is needed.
    pendingZero = false;
  });
  return out || digits[0];
}

/** Calendar fields use units except in the fullwidth systems. Full years and
 * fractional seconds are digit sequences, handled by shapeDigits instead. */
export function shapeDateField(text, shape) {
  return shape?.digits === FULLWIDTH ? shapeDigits(text, shape) : shapeInteger(text, shape, true);
}

/** DBNum's General uses up to fifteen significant digits in fixed notation,
 * within a 255-character numeric workspace. Return null to use normal
 * General unchanged when the expanded representation cannot fit. */
export function expandedGeneral(value) {
  const [mantissa, exponent] = Math.abs(value).toExponential(14).split('e');
  const digits = mantissa.replace('.', '').replace(/0+$/, '') || '0';
  const point = Number(exponent) + 1;
  const length = point <= 0 ? 2 - point + digits.length : Math.max(point, digits.length + (point < digits.length ? 1 : 0));
  if (length > 255) return null;
  const text = point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : point >= digits.length
    ? digits.padEnd(point, '0') : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return value < 0 ? `-${text}` : text;
}

export function shapeGeneral(text, shape, decimal = '.') {
  if (!shape) return text;
  // Scientific General maps the mantissa and exponent digit by digit. DBNum's
  // overlong expanded form falls back before reaching this function.
  if (/[eE][+-]\d+$/.test(text)) return shapeDigits(text, shape);
  const negative = text.startsWith('-'), magnitude = negative ? text.slice(1) : text;
  const [integer, fraction] = magnitude.split(decimal);
  if (!/^\d+$/.test(integer) || (fraction != null && !/^\d+$/.test(fraction))) return text;
  return (negative ? '-' : '') + shapeInteger(integer, shape)
    + (fraction == null ? '' : decimal + shapeDigits(fraction, shape));
}
