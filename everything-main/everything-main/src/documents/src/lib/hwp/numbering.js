/**
 * Hanword list number formats. ST_NumberFormat names the Korean ones (ganada, chosung,
 * koreanCounting, ideographTraditional, decimalEnclosedCircle) but the editor
 * paints only decimal, roman, letter and bullet markers, so every other format
 * is written as the number's text in front of the paragraph, counted here.
 */

/** Formats the editor paints natively; the rest become literal text. */
export const NATIVE_FORMATS = new Set(['decimal', 'upperRoman', 'lowerRoman', 'upperLetter', 'lowerLetter', 'bullet']);

/** The DOCX numFmt value for a format name, for formats DOCX knows by another or no name. */
export const docxNumberFormat = (format) => ({ circledUpperLetter: 'upperLetter', circledLowerLetter: 'lowerLetter', circledGanada: 'ganada', circledChosung: 'chosung', circledIdeograph: 'ideographEnclosedCircle', heavenlyStems: 'ganada', heavenlyStemsHanja: 'ideographTraditional' })[format] || format;

/** Letters repeat as they run out (A..Z, AA..ZZ, ...); a count no list reaches falls back to digits, as the other formats do. */
const cycle = (letters, n) => { const index = (n - 1) % letters.length, repeat = Math.floor((n - 1) / letters.length) + 1; return repeat > 20 ? String(n) : letters[index].repeat(repeat); };
const range = (first, count) => Array.from({ length: count }, (_, i) => String.fromCodePoint(first + i));
const GANADA = ['가나다라마바사아자차카타파하', '거너더러머버서어저처커터퍼허', '고노도로모보소오조초코토포호', '구누두루무부수우주추쿠투푸후', '그느드르므브스으즈츠크트프흐', '기니디리미비시이지치키티피히'].join('');
const CHOSUNG = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ';
const STEMS = '갑을병정무기경신임계', STEMS_HANJA = '甲乙丙丁戊己庚辛壬癸';
const CIRCLED_DIGITS = [...range(0x2460, 20), ...range(0x3251, 15), ...range(0x32b1, 15)];
/** Sino-Korean style counting: units then tens, up to 99; larger numbers stay decimal. */
function counting(digits, ten, n) {
  if (n < 1 || n > 99) return String(n);
  const tens = Math.floor(n / 10), units = n % 10;
  return (tens ? (tens > 1 ? digits[tens - 1] : '') + ten : '') + (units ? digits[units - 1] : '');
}
const roman = (n) => { if (n < 1 || n > 3999) return String(n); const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let out = ''; for (const [value, letters] of table) while (n >= value) { out += letters; n -= value; } return out; };
const letter = (n) => cycle([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'], n);

/** The text of number n in a Hanword format. */
export function formatNumber(format, n) {
  n = Math.max(1, Math.round(Number(n) || 1));
  switch (format) {
    case 'decimalEnclosedCircle': return CIRCLED_DIGITS[n - 1] || `(${n})`;
    case 'upperRoman': return roman(n); case 'lowerRoman': return roman(n).toLowerCase();
    case 'upperLetter': return letter(n); case 'lowerLetter': return letter(n).toLowerCase();
    case 'circledUpperLetter': return n <= 26 ? String.fromCodePoint(0x24b5 + n) : letter(n);
    case 'circledLowerLetter': return n <= 26 ? String.fromCodePoint(0x24cf + n) : letter(n).toLowerCase();
    case 'ganada': return cycle([...GANADA], n);
    case 'circledGanada': return n <= 14 ? String.fromCodePoint(0x326d + n) : cycle([...GANADA], n);
    case 'chosung': return cycle([...CHOSUNG], n);
    case 'circledChosung': return n <= 14 ? String.fromCodePoint(0x325f + n) : cycle([...CHOSUNG], n);
    case 'koreanCounting': return counting([...'일이삼사오육칠팔구'], '십', n);
    case 'ideographTraditional': return counting([...'一二三四五六七八九'], '十', n);
    case 'circledIdeograph': return n <= 10 ? String.fromCodePoint(0x327f + n) : counting([...'一二三四五六七八九'], '十', n);
    case 'heavenlyStems': return cycle([...STEMS], n);
    case 'heavenlyStemsHanja': return cycle([...STEMS_HANJA], n);
    default: return String(n);
  }
}

/**
 * The marker of a list paragraph: its level pattern (^1 to ^7 name the levels,
 * ^n every level so far) with the current counters filled in.
 */
export function levelLabel(levels, level, counters) {
  const definition = levels[level] || {}, pattern = definition.text || `^${level + 1}.`;
  const number = (index) => formatNumber(levels[index]?.format || 'decimal', counters[index] ?? levels[index]?.start ?? 1);
  return pattern
    .replace(/\^[nN]/g, (s) => Array.from({ length: level + 1 }, (_, i) => number(i)).join('.') + (s === '^N' ? '.' : ''))
    .replace(/\^([1-9])/g, (_, digit) => number(Number(digit) - 1));
}

/** List counting: the level advances, deeper levels restart, shallower ones keep their count. */
export function advanceCounters(counters, levels, level) {
  const start = (index) => Math.max(1, Number(levels[index]?.start) || 1);
  for (let i = 0; i < level; i++) counters[i] ??= start(i);
  counters[level] = counters[level] === undefined ? start(level) : counters[level] + 1;
  counters.length = level + 1;
  return counters;
}
