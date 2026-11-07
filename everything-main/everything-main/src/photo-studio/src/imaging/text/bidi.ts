// Bidirectional text: the essentials of the Unicode Bidirectional Algorithm
// (UAX #9) for mixed left-to-right and right-to-left lines. Implemented:
// bidi classes for the scripts and punctuation that matter in practice,
// paragraph level (P2-P3 or an explicit direction), weak types (W1-W7),
// neutrals (N1-N2), implicit levels (I1-I2), trailing whitespace (L1) and
// line reordering (L2). Explicit embeddings, overrides and isolates are
// treated as boundary neutrals, and bracket pairs (N0) resolve as ordinary
// neutrals; mirrored glyphs come from `mirror`.
//
// Levels are per UTF-16 code unit (both halves of a surrogate pair share one).

export type BidiClass = 'L' | 'R' | 'AL' | 'EN' | 'ES' | 'ET' | 'AN' | 'CS' | 'NSM' | 'BN' | 'B' | 'S' | 'WS' | 'ON';
export type BaseDirection = 'ltr' | 'rtl' | 'auto';
export type VisualRun = { start: number; end: number; level: number };

const CLASSES: BidiClass[] = ['L', 'R', 'AL', 'EN', 'ES', 'ET', 'AN', 'CS', 'NSM', 'BN', 'B', 'S', 'WS', 'ON'];
const [L, R, AL, EN, ES, ET, AN, CS, NSM, BN, B, S, WS, ON] = CLASSES.map((_, i) => i);

// Ranges in increasing priority: later entries override earlier ones.
const RANGES: [number, number, number][] = [
  // Right-to-left script blocks.
  [0x0590, 0x05ff, R], [0x07c0, 0x085f, R], [0xfb1d, 0xfb4f, R],
  [0x0600, 0x07bf, AL], [0x0860, 0x08ff, AL], [0xfb50, 0xfdcf, AL], [0xfdf0, 0xfdff, AL], [0xfe70, 0xfefe, AL],
  // Other neutrals: ASCII and Latin-1 punctuation, general punctuation, symbols.
  [0x21, 0x2f, ON], [0x3a, 0x40, ON], [0x5b, 0x60, ON], [0x7b, 0x7e, ON],
  [0xa1, 0xbf, ON], [0xd7, 0xd7, ON], [0xf7, 0xf7, ON], [0x2b9, 0x2ba, ON], [0x2c2, 0x2cf, ON], [0x2d2, 0x2df, ON], [0x2e5, 0x2ed, ON], [0x2ef, 0x2ff, ON],
  [0x2010, 0x2027, ON], [0x2030, 0x205e, ON], [0x2100, 0x2101, ON], [0x2103, 0x2106, ON], [0x2108, 0x2109, ON],
  [0x2116, 0x2118, ON], [0x211e, 0x2123, ON], [0x2125, 0x2125, ON], [0x2127, 0x2127, ON], [0x2129, 0x2129, ON], [0x213a, 0x213b, ON],
  [0x2140, 0x2144, ON], [0x214a, 0x214d, ON], [0x2150, 0x215f, ON], [0x2189, 0x2335, ON], [0x237b, 0x2394, ON], [0x2396, 0x2487, ON],
  [0x24ea, 0x26ab, ON], [0x26ad, 0x27ff, ON], [0x2900, 0x2b73, ON], [0x2e00, 0x2e5d, ON], [0x3001, 0x3004, ON], [0x3008, 0x3020, ON],
  [0xfd3e, 0xfd3f, ON], [0xfe10, 0xfe19, ON], [0xfe30, 0xfe4f, ON], [0xfe51, 0xfe51, ON], [0xfe54, 0xfe54, ON], [0xfe56, 0xfe5e, ON],
  [0xfe60, 0xfe61, ON], [0xfe64, 0xfe68, ON], [0xfe6b, 0xfe6b, ON], [0xff01, 0xff02, ON], [0xff06, 0xff0a, ON], [0xff1b, 0xff20, ON],
  [0xff3b, 0xff40, ON], [0xff5b, 0xff65, ON], [0xffe2, 0xffe4, ON], [0xffe8, 0xffee, ON], [0xfff9, 0xfffd, ON],
  [0x0606, 0x0607, ON], [0x060e, 0x060f, ON], [0x06de, 0x06de, ON], [0x06e9, 0x06e9, ON], [0x07f6, 0x07f9, ON],
  // European numbers, separators and terminators.
  [0x30, 0x39, EN], [0xb2, 0xb3, EN], [0xb9, 0xb9, EN], [0x06f0, 0x06f9, EN], [0x2070, 0x2070, EN], [0x2074, 0x2079, EN],
  [0x2080, 0x2089, EN], [0x2488, 0x249b, EN], [0xff10, 0xff19, EN],
  [0x2b, 0x2b, ES], [0x2d, 0x2d, ES], [0x207a, 0x207b, ES], [0x208a, 0x208b, ES], [0x2212, 0x2212, ES], [0xfb29, 0xfb29, ES],
  [0xfe62, 0xfe63, ES], [0xff0b, 0xff0b, ES], [0xff0d, 0xff0d, ES],
  [0x23, 0x25, ET], [0xa2, 0xa5, ET], [0xb0, 0xb1, ET], [0x0609, 0x060a, ET], [0x066a, 0x066a, ET], [0x09f2, 0x09f3, ET],
  [0x20a0, 0x20cf, ET], [0x2030, 0x2034, ET], [0x212e, 0x212e, ET], [0x2213, 0x2213, ET], [0xfe5f, 0xfe5f, ET], [0xfe69, 0xfe6a, ET],
  [0xff03, 0xff05, ET], [0xffe0, 0xffe1, ET], [0xffe5, 0xffe6, ET],
  // Arabic numbers.
  [0x0600, 0x0605, AN], [0x0660, 0x0669, AN], [0x066b, 0x066c, AN], [0x06dd, 0x06dd, AN], [0x0890, 0x0891, AN], [0x08e2, 0x08e2, AN],
  // Common separators.
  [0x2c, 0x2c, CS], [0x2e, 0x2f, CS], [0x3a, 0x3a, CS], [0xa0, 0xa0, CS], [0x060c, 0x060c, CS], [0x202f, 0x202f, CS], [0x2044, 0x2044, CS],
  [0xfe50, 0xfe50, CS], [0xfe52, 0xfe52, CS], [0xfe55, 0xfe55, CS], [0xff0c, 0xff0c, CS], [0xff0e, 0xff0f, CS], [0xff1a, 0xff1a, CS],
  // Combining marks.
  [0x0300, 0x036f, NSM], [0x0483, 0x0489, NSM], [0x0591, 0x05bd, NSM], [0x05bf, 0x05bf, NSM], [0x05c1, 0x05c2, NSM], [0x05c4, 0x05c5, NSM],
  [0x05c7, 0x05c7, NSM], [0x0610, 0x061a, NSM], [0x064b, 0x065f, NSM], [0x0670, 0x0670, NSM], [0x06d6, 0x06dc, NSM], [0x06df, 0x06e4, NSM],
  [0x06e7, 0x06e8, NSM], [0x06ea, 0x06ed, NSM], [0x0711, 0x0711, NSM], [0x0730, 0x074a, NSM], [0x07a6, 0x07b0, NSM], [0x07eb, 0x07f3, NSM],
  [0x0816, 0x0819, NSM], [0x081b, 0x0823, NSM], [0x0825, 0x0827, NSM], [0x0829, 0x082d, NSM], [0x0859, 0x085b, NSM], [0x0898, 0x089f, NSM],
  [0x08ca, 0x08e1, NSM], [0x08e3, 0x08ff, NSM], [0x20d0, 0x20f0, NSM], [0xfb1e, 0xfb1e, NSM], [0xfe00, 0xfe0f, NSM], [0xfe20, 0xfe2f, NSM],
  // Whitespace, segment and paragraph separators.
  [0x20, 0x20, WS], [0x0c, 0x0c, WS], [0x1680, 0x1680, WS], [0x2000, 0x200a, WS], [0x2028, 0x2028, WS], [0x205f, 0x205f, WS], [0x3000, 0x3000, WS],
  [0x09, 0x09, S], [0x0b, 0x0b, S], [0x1f, 0x1f, S],
  [0x0a, 0x0a, B], [0x0d, 0x0d, B], [0x1c, 0x1e, B], [0x85, 0x85, B], [0x2029, 0x2029, B],
  // Formatting characters; embeddings and isolates are not modelled.
  [0x00, 0x08, BN], [0x0e, 0x1b, BN], [0x7f, 0x84, BN], [0x86, 0x9f, BN], [0xad, 0xad, BN], [0x180e, 0x180e, BN],
  [0x200b, 0x200d, BN], [0x202a, 0x202e, BN], [0x2060, 0x2069, BN], [0xfeff, 0xfeff, BN],
  // Marks with a strong direction.
  [0x200e, 0x200e, L], [0x200f, 0x200f, R], [0x061c, 0x061c, AL],
];
let table: Uint8Array | undefined;
function bmpTable() {
  if (table) return table;
  table = new Uint8Array(0x10000); // 0 = L
  for (const [a, b, c] of RANGES) table.fill(c, a, b + 1);
  return table;
}
function classIndex(cp: number): number {
  if (cp < 0x10000) return bmpTable()[cp];
  if (cp >= 0x10800 && cp <= 0x10fff) return cp >= 0x10d30 && cp <= 0x10d39 ? AN : R;
  if (cp >= 0x1e800 && cp <= 0x1ec6f) return R;
  if (cp >= 0x1ec70 && cp <= 0x1eeff) return AL;
  if (cp >= 0x1f000 && cp <= 0x1faff) return ON;
  if (cp >= 0xe0000 && cp <= 0xe0fff) return BN;
  return L;
}
/** Bidi class of a code point (a practical subset of the Unicode data). */
export function bidiClass(cp: number): BidiClass {
  return CLASSES[classIndex(cp)];
}

function classesOf(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const c = classIndex(cp);
    out[i] = c;
    if (cp > 0xffff) out[i + 1] = c;
    i += cp > 0xffff ? 2 : 1;
  }
  return out;
}

/** Paragraph embedding level: 0 for left-to-right, 1 for right-to-left. With
 * 'auto' the first strong character decides (left-to-right when none). */
export function paragraphLevel(text: string, dir: BaseDirection = 'auto'): 0 | 1 {
  if (dir === 'ltr') return 0;
  if (dir === 'rtl') return 1;
  for (let i = 0; i < text.length; i++) {
    const c = classIndex(text.codePointAt(i)!);
    if (c === L) return 0;
    if (c === R || c === AL) return 1;
    if (c === B) break;
  }
  return 0;
}

const isNeutral = (c: number) => c === B || c === S || c === WS || c === ON;

/** Resolved embedding level per UTF-16 code unit. Each paragraph (split at
 * paragraph separators such as '\n') gets its own base level from `dir`. */
export function bidiLevels(text: string, dir: BaseDirection = 'auto'): Uint8Array {
  const levels = new Uint8Array(text.length);
  const cls = classesOf(text);
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && cls[i] !== B) continue;
    resolveParagraph(text, cls, levels, start, i, dir);
    if (i < text.length) levels[i] = paragraphLevel(text.slice(start, i), dir);
    start = i + 1;
  }
  return levels;
}

function resolveParagraph(text: string, cls: Uint8Array, levels: Uint8Array, start: number, end: number, dir: BaseDirection) {
  const base = paragraphLevel(text.slice(start, end), dir);
  const e = base & 1 ? R : L; // embedding direction; also sos and eos
  // Boundary neutrals (BN) are removed for resolution (X9) and take the level
  // of the preceding character afterwards.
  const idx: number[] = [];
  for (let i = start; i < end; i++) if (cls[i] !== BN) idx.push(i);
  const t = idx.map((i) => cls[i]);
  const n = t.length;
  // W1: combining marks take the type of the preceding character.
  for (let k = 0; k < n; k++) if (t[k] === NSM) t[k] = k ? t[k - 1] : e;
  // W2: European numbers after Arabic letters are Arabic numbers. W3: AL -> R.
  let lastStrong = e;
  for (let k = 0; k < n; k++) {
    const c = t[k];
    if (c === L || c === R || c === AL) lastStrong = c;
    else if (c === EN && lastStrong === AL) t[k] = AN;
  }
  for (let k = 0; k < n; k++) if (t[k] === AL) t[k] = R;
  // W4: a single separator between two numbers of one kind joins them.
  for (let k = 1; k < n - 1; k++) {
    const p = t[k - 1], q = t[k + 1];
    if (t[k] === ES && p === EN && q === EN) t[k] = EN;
    else if (t[k] === CS && p === q && (p === EN || p === AN)) t[k] = p;
  }
  // W5: terminators next to European numbers become European numbers.
  for (let k = 0; k < n; k++) {
    if (t[k] !== ET) continue;
    let j = k;
    while (j < n && t[j] === ET) j++;
    if ((k > 0 && t[k - 1] === EN) || (j < n && t[j] === EN)) for (let m = k; m < j; m++) t[m] = EN;
    k = j - 1;
  }
  // W6: remaining separators and terminators are neutral.
  for (let k = 0; k < n; k++) if (t[k] === ES || t[k] === ET || t[k] === CS) t[k] = ON;
  // W7: European numbers after left-to-right text are treated as L.
  lastStrong = e;
  for (let k = 0; k < n; k++) {
    const c = t[k];
    if (c === L || c === R) lastStrong = c;
    else if (c === EN && lastStrong === L) t[k] = L;
  }
  // N1-N2: neutral sequences take the surrounding direction when both sides
  // agree (numbers count as R), otherwise the embedding direction.
  const dirOf = (c: number) => (c === L ? L : c === R || c === EN || c === AN ? R : -1);
  for (let k = 0; k < n; k++) {
    if (!isNeutral(t[k])) continue;
    let j = k;
    while (j < n && isNeutral(t[j])) j++;
    const before = k > 0 ? dirOf(t[k - 1]) : e;
    const after = j < n ? dirOf(t[j]) : e;
    const d = before === after && before >= 0 ? before : e;
    for (let m = k; m < j; m++) t[m] = d;
    k = j - 1;
  }
  // I1-I2: implicit levels.
  for (let k = 0; k < n; k++) {
    const c = t[k];
    let lv = base;
    if (!(base & 1)) lv += c === R ? 1 : c === AN || c === EN ? 2 : 0;
    else lv += c === L || c === EN || c === AN ? 1 : 0;
    levels[idx[k]] = lv;
  }
  // Boundary neutrals follow the preceding character (or the base level).
  for (let i = start; i < end; i++) if (cls[i] === BN) levels[i] = i > start ? levels[i - 1] : base;
  // L1: segment separators, and whitespace before them or the paragraph end,
  // return to the base level.
  let trailing = true;
  for (let i = end - 1; i >= start; i--) {
    const c = cls[i];
    if (c === S) {
      levels[i] = base;
      trailing = true;
    } else if (trailing && (c === WS || c === BN)) levels[i] = base;
    else trailing = false;
  }
}

/** Levels for one line: L1 resets whitespace at the line end to the base level. */
export function lineLevels(levels: Uint8Array, text: string, start: number, end: number, base: number): Uint8Array {
  const out = levels.slice(start, end);
  for (let i = end - 1; i >= start; i--) {
    const c = classIndex(text.charCodeAt(i));
    if (c === WS || c === BN || c === S || c === B) out[i - start] = base;
    else break;
  }
  return out;
}

/** Logical indices of [start, end) in visual (left-to-right) order (L2). */
export function visualOrder(levels: ArrayLike<number>, start: number, end: number): number[] {
  const order: number[] = [];
  for (let i = start; i < end; i++) order.push(i);
  if (end <= start) return order;
  let hi = 0, lowOdd = 255;
  for (let i = start; i < end; i++) {
    const lv = levels[i];
    if (lv > hi) hi = lv;
    if (lv & 1 && lv < lowOdd) lowOdd = lv;
  }
  for (let lv = hi; lv >= lowOdd && lv > 0; lv--) {
    for (let k = 0; k < order.length; k++) {
      if (levels[order[k]] < lv) continue;
      let j = k;
      while (j < order.length && levels[order[j]] >= lv) j++;
      order.splice(k, j - k, ...order.slice(k, j).reverse());
      k = j;
    }
  }
  return order;
}

/** Level runs of [start, end) in visual order. Each run covers logical
 * indices [start, end); odd-level runs read right to left inside. Pass `text`
 * and `base` to apply L1 to whitespace at the end of the line. */
export function visualRuns(levels: ArrayLike<number>, start: number, end: number, text?: string, base?: number): VisualRun[] {
  let lv: ArrayLike<number> = levels;
  if (text !== undefined && base !== undefined) {
    const line = lineLevels(levels instanceof Uint8Array ? levels : Uint8Array.from(levels), text, start, end, base);
    const copy = new Uint8Array(end);
    copy.set(line, start);
    lv = copy;
  }
  // Logical level runs, then reorder the runs as units (equivalent to L2).
  const runs: VisualRun[] = [];
  for (let i = start; i < end; ) {
    let j = i + 1;
    while (j < end && lv[j] === lv[i]) j++;
    runs.push({ start: i, end: j, level: lv[i] });
    i = j;
  }
  if (!runs.length) return runs;
  let hi = 0, lowOdd = 255;
  for (const r of runs) {
    hi = Math.max(hi, r.level);
    if (r.level & 1) lowOdd = Math.min(lowOdd, r.level);
  }
  for (let level = hi; level >= lowOdd && level > 0; level--) {
    for (let k = 0; k < runs.length; k++) {
      if (runs[k].level < level) continue;
      let j = k;
      while (j < runs.length && runs[j].level >= level) j++;
      runs.splice(k, j - k, ...runs.slice(k, j).reverse());
      k = j;
    }
  }
  return runs;
}

/** True when the text holds any right-to-left character. */
export function hasRtl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = classIndex(text.codePointAt(i)!);
    if (c === R || c === AL || c === AN) return true;
  }
  return false;
}

// Paired characters drawn mirrored in right-to-left runs.
const PAIRS = '()[]{}<>«»‹›⁅⁆⁽⁾₍₎≤≥⟨⟩⟪⟫⦃⦄⦅⦆〈〉《》「」『』【】〔〕〖〗';
const MIRRORS = new Map<string, string>();
for (let i = 0; i < PAIRS.length; i += 2) {
  MIRRORS.set(PAIRS[i], PAIRS[i + 1]);
  MIRRORS.set(PAIRS[i + 1], PAIRS[i]);
}
/** The mirrored form of a paired bracket or comparison sign, else `ch`. */
export function mirror(ch: string): string {
  return MIRRORS.get(ch) ?? ch;
}

export type DigitShape = 'none' | 'arabic' | 'persian';
/** Replace ASCII digits with Arabic-Indic or Extended Arabic-Indic digits. */
export function shapeDigits(text: string, shape: DigitShape): string {
  if (shape === 'none') return text;
  const zero = shape === 'arabic' ? 0x0660 : 0x06f0;
  return text.replace(/[0-9]/g, (d) => String.fromCharCode(zero + d.charCodeAt(0) - 48));
}
