import type { TextFormat } from "./text-format.ts";

/** The runtime supplies locale data and the local time zone, the way native
 * apps use the host's regional settings. An explicit zone makes exports reproducible. */
export interface DateFieldOptions {
  locale?: string;
  timeZone?: string;
}

// DrawingML field names: [MS-OI29500] 21.1.2.2.2. The numbered choices inherit
// the locale-dependent format IDs documented in [MS-PPT] 2.9.50;
// date pictures and exceptions are specified in [MS-OSHARED] 2.4.4.
// https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/668ab84b-f0b2-4496-af11-b9d1b04e840a
// https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-oshared/8b810eea-93e2-4577-bc84-0d4f05e41faf
// Base date/time pictures come from Intl's host locale data. They can differ
// from Windows/macOS regional settings; we do not reproduce the native
// reference's lossy rewriting of some East Asian field languages to en-US.
const DEFAULT_IDS = [0, 1, 8, 2, 5, 9, 10, 11, 12, 15, 16, 13, 14];
const IDS: Record<string, ReadonlyArray<number | string>> = {
  "en-GB": [0, 1, "d MMMM, yyyy", 2, 5, 9, 10, 11, 12, 15, 16, 13, 14],
  ja: [4, 8, 7, 3, 0, 9, 5, 11, 12, "HH:mm", "HH:mm:ss", 15, 16],
  "zh-TW": [
    0,
    1,
    3,
    7,
    12,
    9,
    10,
    4,
    11,
    "HH:mm",
    "HH:mm:ss",
    "h:mm am/pm",
    "h:mm:ss am/pm",
  ],
  "zh-CN": [
    0,
    1,
    2,
    2,
    4,
    9,
    5,
    "yyyy年M月d日h时m分",
    "yyyy年M月d日星期Wh时m分s秒",
    "HH:mm",
    "HH:mm:ss",
    "AMPMh时m分",
    "AMPMh时m分s秒",
  ],
  zh: [
    0,
    1,
    3,
    2,
    4,
    9,
    5,
    "yyyy年M月d日h时m分",
    "yyyy年M月d日星期Wh时m分s秒",
    "HH:mm",
    "HH:mm:ss",
    "AMPMh时m分",
    "AMPMh时m分s秒",
  ],
  ko: [0, 1, 6, 3, 4, 10, 7, 12, 11, "HH:mm", "HH:mm:ss", 13, 14],
  ar: [0, 1, 2, 3, 4, 5, 8, 7, 8, 1, 10, 11, 5],
  he: [0, 1, 2, 6, 11, 5, 12, 7, 8, 9, 1, 11, 6],
  sv: [0, 1, 3, 2, 7, 9, 10, 11, 12, 15, 16, 13, 14],
  th: [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 13, 14],
  vi: [0, 1, 2, 3, 5, 6, 10, 11, 12, 13, 14, 15, 16],
  hi: [1, 2, 3, 5, 7, 11, 13, 0, 1, 5, 10, 11, 14],
  syr: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};
// Entries 0 and 1 use the host's short and long date pictures.
const PICTURES: Record<string, readonly string[]> = {
  zh: [
    "",
    "",
    "yyyy年M月d日星期W",
    "yyyy年M月d日",
    "yyyy/M/d",
    "yy.M.d",
    "yyyy年M月d日星期W",
    "yyyy年M月d日",
    "yyyy年M月d日星期W",
    "yyyy年M月",
    "yyyy年M月",
    "h时m分s秒",
    "h时m分",
    "H时m分",
    "h时m分",
    "AMPMh时m分",
    "AMPMh时m分",
    "EEEE年O月A日",
    "EEEE年O月A日星期W",
    "EEEE年O月",
  ],
  "zh-TW": [
    "",
    "",
    "E年O月A日",
    "e年M月d日",
    "EEEE年O月A日",
    "yyyy年M月d日",
    "E年O月A日星期W",
    "e年M月d日星期W",
    "E年O月A日星期W",
    "EE年O月A日星期W",
    "EEE年O月A日星期W",
    "EEEE年O月A日星期W",
    "yyyy年M月d日星期W",
    "yyyy年M月d日星期W",
    "yyyy年M月d日星期W",
    "EE年O月A日",
    "EEE年O月A日",
  ],
  ja: [
    "",
    "",
    "ggge年M月d日(aaa)",
    "yyyy年M月d日",
    "yyyy/M/d",
    "gggE年O月A日",
    "EE年O月A日(aaa)",
    "ggge年M月d日",
    "yyyy年M月d日(aaa)",
    "ggge年M月",
    "yyyy年M月",
    "yy/M/d H時m分",
    "yy/M/d H時m分s秒",
    "AMPMh時m分",
    "AMPMh時m分s秒",
    "H時m分",
    "H時m分s秒",
    "ggge年M月d日 aaa曜日",
  ],
  ko: [
    "",
    "",
    "yyyy년 M월 d일 aaa요일",
    "yyyy년 M월 d일",
    "yyyy/M/d",
    "yyMMdd",
    "gg yyyy년 M월 d일",
    "gg yyyy년 M월",
    "gg yyyy년 M월 d일",
    "gg yyyy년",
    "yyyy년 M월",
    "yyyy년 M월 d일 AMPM h시 m분",
    "yy년 M월 d일 H시 m분 s초",
    "AMPM h시 m분",
    "AMPM h시 m분 s초",
    "H시 m분",
    "H시 m분 s초",
  ],
  hi: [
    "aa/o/g",
    "dddd, d MMMM yyyy",
    "dd MMMM yyyy",
    "aa/o/gg",
    "gg-o-aa",
    "d-MMMM-yyyy",
    "aa.o.g",
    "aa MMMM. gg",
    "aa MMMM gg",
    "MMMM yy",
    "MMMM-g",
    "aa/o/g r:i",
    "aa/o/g r:i:c",
    "r:i am/pm",
    "r:i:c am/pm",
    "r:i",
    "r:i:c",
  ],
  th: [
    "dd/MM/bb",
    '"วัน"วววว"ที่" d ดดดด "พ.ศ." bbbb',
    "d ดดดด bbbb",
    "dd ดดด bb",
    "dd/MM/bbbb",
    "ดดดด bb",
    'dd/MM/bb HH:mm "น."',
    'dd/MM/bb HH:mm:ss "น."',
    "วว/ดด/ปป",
    '"วัน"วววว"ที่" ว ดดดด "พ.ศ." ปปปป',
    "ว ดดดด ปปปป",
    "ดดด ปป",
    "ดดดด ปป",
    'วว/ดด/ปป มม:นน "น."',
    'วว/ดด/ปปปป มม:นน:ทท "น."',
    'มม:นน "น."',
    'มม:นน:ทท "น."',
  ],
  ii: [
    "",
    "yyyyꈎMꆪdꑍ, w",
    "yyyyꈎMꆪdꑍ",
    "yyyy.MM.dd",
    "yyyy/M/d",
    "yy.M.d",
    "yyyy/MM/dd",
    "yyyy-MM-dd",
    "yyyyꈎMꆪdꑍ",
    "yyyyꈎMꆪ",
    "yyyyꈎMꆪ",
    "yyyy/M/d HH:mm",
    "yyyy/M/d HH:mm:ss",
    "h:mm AMPM",
    "h:mm:ss AMPM",
    "HH:mm",
    "HH:mm:ss",
  ],
};
const EXCEPTIONS: Record<string, Readonly<Record<number, string>>> = {
  nb: {
    5: "d. MMM. yyyy",
    6: "d/M yyyy",
    7: "MMM. yy",
    8: "yyyy.MM.dd",
    10: "d. MMM.",
  },
  da: {
    1: "d. MMMM yyyy",
    2: "yy-MM-dd",
    3: "yyyy.MM.dd",
    5: "MMMM yyyy",
    6: "d.M.yy",
    7: "d/M yyyy",
    8: "dd.MM.yyyy",
    9: "d.M.yyyy",
    10: "dd/MM yyyy",
  },
  "fr-CA": { 3: "yy MM dd" },
  de: { 5: "yy-MM-dd", 7: "dd. MMM. yyyy" },
  hu: { 7: "yy. MMM. dd.", 8: '"’"yy MMM.' },
  it: { 8: 'MMM. "’"yy' },
  pl: { 7: "dd MM yy" },
  sv: {
    1: 'dddd "den "d MMMM yyyy',
    4: "yyMMdd",
    5: "d MMM yy",
    6: "d/M yyyy",
    7: "d MMM –yy",
    8: "M/d/yy",
    9: "MMMM yyyy",
    10: '"den" d MMMM yyyy',
    12: "yy-MM-dd hh:mm",
    13: "h.mm AMPM",
    14: "h.mm",
  },
  bo: { 5: "yy-M-d", 7: "yyyy.MM.dd", 10: "yyyy.M" },
  dz: { 5: "yy-M-d", 7: "yyyy.MM.dd", 10: "yyyy.M" },
  vi: { 6: "d-MMMM-yy" },
};

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = JSON.stringify([locale, options]);
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    // Untrusted decks can contain arbitrarily many tags; keep this bounded.
    if (formatters.size >= 128)
      formatters.delete(formatters.keys().next().value!);
    formatters.set(key, f);
  }
  return f;
}
function supportedLocale(...candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (Intl.DateTimeFormat.supportedLocalesOf([candidate]).length)
        return new Intl.Locale(candidate).baseName;
    } catch {
      /* Malformed imported tags do not make a slide unrenderable. */
    }
  }
  return new Intl.DateTimeFormat().resolvedOptions().locale;
}
const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
// Single-digit reference components expose padding in the host's picture.
// This date is used only to discover patterns; field values always use `date`.
const reference = new Date(2006, 0, 2, 13, 4, 5);
const alternateReference = new Date(2006, 6, 21, 1, 4, 5);
function basePicture(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const f = formatter(locale, { ...options, numberingSystem: "latn" });
  const hour = f.resolvedOptions().hourCycle;
  const alternate = f.formatToParts(alternateReference);
  const width = (p: Intl.DateTimeFormatPart) =>
    Math.min(
      p.value.length,
      alternate.find((x) => x.type === p.type)?.value.length ?? p.value.length,
    );
  return pictureOf(
    f.formatToParts(reference).map((p): Token => {
      let code: string;
      switch (p.type as string) {
        case "year":
        case "relatedYear":
          code = p.value.length <= 2 ? "yy" : "yyyy";
          break;
        case "month":
          code = /^\d+$/.test(p.value) ? (width(p) === 2 ? "MM" : "M") : "MMMM";
          break;
        case "day":
          code = width(p) === 2 ? "dd" : "d";
          break;
        case "weekday":
          code = "dddd";
          break;
        case "hour":
          code = (hour === "h11" || hour === "h12" ? "h" : "H").repeat(
            width(p) === 2 ? 2 : 1,
          );
          break;
        case "minute":
          code = "mm";
          break;
        case "second":
          code = "ss";
          break;
        case "dayPeriod":
          code = "AMPM";
          break;
        // Era labels in a base picture are locale literals, not Japanese g/e.
        default:
          return { literal: p.value.replace(/[\u00a0\u202f]/g, " ") };
      }
      return { code };
    }),
  );
}
// Lexing keeps locale punctuation and quoted words separate from picture
// tokens, so transformations never modify a letter inside a literal.
type Token = { code: string } | { literal: string };
const tokenPattern = /^(am\/pm|AM\/PM|AMPM|[yMdHhmsgebEaOoricwWAวดปมนท]+)/;
function tokens(picture: string): Token[] {
  const result: Token[] = [];
  for (let i = 0; i < picture.length;) {
    const ch = picture[i]!;
    if (ch === '"' || ch === "'") {
      let value = "";
      i++;
      while (i < picture.length) {
        if (picture[i] === ch) {
          i++;
          if (picture[i] === ch) {
            value += ch;
            i++;
            continue;
          }
          break;
        }
        value += picture[i++];
      }
      result.push({ literal: value });
    } else {
      const match = picture.slice(i).match(tokenPattern)?.[0];
      if (match) {
        if (/^(?:am\/pm|AM\/PM|AMPM)$/.test(match))
          result.push({ code: match });
        else
          for (const run of match.match(/(.)\1*/gu)!)
            result.push({ code: run });
        i += match.length;
      } else {
        result.push({ literal: ch });
        i++;
      }
    }
  }
  return result;
}
function pictureOf(items: Token[]): string {
  const merged: Token[] = [];
  for (const t of items) {
    const last = merged[merged.length - 1];
    if ("literal" in t && last && "literal" in last) last.literal += t.literal;
    else merged.push({ ...t });
  }
  return merged.map((t) => ("code" in t ? t.code : quote(t.literal))).join("");
}
function lastTokenIndex(items: Token[], test: (t: Token) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (test(items[i]!)) return i;
  return -1;
}
const replaceTokens = (p: string, f: (code: string) => string) =>
  pictureOf(tokens(p).map((t) => ("code" in t ? { code: f(t.code) } : t)));
function withoutWeekday(picture: string) {
  const t = tokens(picture),
    result: Token[] = [];
  for (let i = 0; i < t.length; i++) {
    const item = t[i]!;
    if ("code" in item && item.code === "dddd") {
      const next = t[i + 1];
      if (next && "literal" in next) {
        const rest = next.literal.replace(/^[,،]?\s*/, "");
        if (rest) result.push({ literal: rest });
        i++;
      }
    } else result.push(item);
  }
  return pictureOf(result).trim();
}
function buildDatePicture(
  locale: string,
  calendar: string,
  id: number,
): string {
  const tag = new Intl.Locale(locale).maximize(),
    lang = tag.language,
    region = tag.region;
  const key = lang === "zh" && region === "TW" ? "zh-TW" : lang;
  const exception = (EXCEPTIONS[`${lang}-${region}`] ?? EXCEPTIONS[lang])?.[id];
  if (exception) return exception;
  const specific = PICTURES[key]?.[id];
  if (specific) return specific;
  const short = basePicture(locale, { dateStyle: "short", calendar });
  const long = basePicture(locale, { dateStyle: "full", calendar });
  const time = basePicture(locale, { timeStyle: "medium" });
  const separator =
    formatter(locale, {
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
      numberingSystem: "latn",
    })
      .formatToParts(reference)
      .find((x) => x.type === "literal")?.value ?? ":";
  const alternateSlashes = () => {
    const fields = tokens(short).filter(
      (t): t is { code: string } => "code" in t && /^[yMd]+$/.test(t.code),
    );
    return fields
      .slice(0, 3)
      .map((t) => t.code)
      .join(short.includes("/") ? "." : "/");
  };
  let picture: string;
  switch (id) {
    case 0:
      picture = short;
      break;
    case 1:
      picture = long;
      break;
    case 2:
      picture = replaceTokens(withoutWeekday(long), (c) =>
        c === "dd" ? "d" : c,
      );
      break;
    case 3:
      picture = replaceTokens(short, (c) =>
        c === "yyyy" ? "yy" : c === "yy" ? "yyyy" : c,
      );
      break;
    case 4:
      picture = "yyyy-MM-dd";
      break;
    case 5:
      picture = tokens(short)
        .find((t): t is { code: string } => "code" in t && /^[yM]/.test(t.code))
        ?.code.startsWith("y")
        ? "yy-MMM-d"
        : "d-MMM-yy";
      break;
    case 6:
      picture = alternateSlashes();
      break;
    case 7:
      picture = replaceTokens(withoutWeekday(long), (c) =>
        /^M+$/.test(c) ? "MMM" : c === "dd" ? "d" : c === "yyyy" ? "yy" : c,
      );
      break;
    case 8:
      picture =
        lang === "ar" || (lang === "en" && region === "US")
          ? "d MMMM yyyy"
          : lang === "he"
            ? "d MMMM, yyyy"
            : replaceTokens(alternateSlashes(), (c) =>
                c === "yyyy" ? "yy" : c,
              );
      break;
    case 9: {
      const t = tokens(long);
      const start = t.findIndex((x) => "code" in x && /^[yM]/.test(x.code));
      picture = pictureOf(
        t.slice(Math.max(start, 0)).flatMap((x): Token[] =>
          "code" in x
            ? /^d+$/.test(x.code)
              ? []
              : [{ code: x.code === "yyyy" ? "yy" : x.code }]
            : [
                {
                  literal: x.literal.replace(
                    lang === "lt" ? /,/g : /[.,]/g,
                    "",
                  ),
                },
              ],
        ),
      );
      break;
    }
    case 10:
      picture = "MMM-yy";
      break;
    case 11: {
      const t = tokens(time);
      const at = t.findIndex((x) => "code" in x && /^s+$/.test(x.code));
      if (at >= 0)
        t.splice(
          at > 0 && "literal" in t[at - 1]! ? at - 1 : at,
          at > 0 && "literal" in t[at - 1]! ? 2 : 1,
        );
      picture = pictureOf([...tokens(short), { literal: " " }, ...t]);
      break;
    }
    case 12:
      picture = pictureOf([
        ...tokens(short),
        { literal: " " },
        ...tokens(time),
      ]);
      break;
    case 13:
    case 14:
      picture =
        (lang === "hu" ? "AMPM h:mm" : "h:mm") +
        (id === 14 ? ":ss" : "") +
        (lang === "hu" ? "" : " AMPM");
      picture = picture.replaceAll(":", quote(separator));
      break;
    case 15:
    case 16:
      picture =
        "HH" +
        quote(separator) +
        "mm" +
        (id === 16 ? quote(separator) + "ss" : "");
      break;
    default:
      throw new RangeError("unknown date format index");
  }
  // [MS-OSHARED] 2.4.4.4: token transformations apply only to actual picture
  // items. Names/literals (e.g. Spanish 'de') cannot become day/era tokens.
  if (id === 9 && ["cs", "nl", "hu", "it"].includes(lang)) {
    const t = tokens(picture);
    const at = lastTokenIndex(t, (x) => "code" in x && /^y/.test(x.code));
    if (at >= 0) t.splice(at, 0, { literal: "’" });
    picture = pictureOf(t);
  }
  if (id === 7 && ["es", "pt"].includes(lang))
    picture = pictureOf(
      tokens(picture).map((t) =>
        "literal" in t ? { literal: t.literal.replace(/\s*de\s*/g, " ") } : t,
      ),
    );
  if (id === 9 && ["lt", "ru"].includes(lang)) {
    const t = tokens(picture);
    const at = lastTokenIndex(
      t,
      (x) => "code" in x && (lang === "lt" ? /^M/ : /^y/).test(x.code),
    );
    if (at >= 0) picture = pictureOf(t.slice(0, at + 1));
  }
  if (id === 9 && lang === "es")
    picture = replaceTokens(picture, (c) => (c === "yy" ? "yyyy" : c));
  if ([5, 7].includes(id) && lang === "it") {
    const t = tokens(picture),
      at = t.findIndex((x) => "code" in x && /^M/.test(x.code));
    const next = t[at + 1];
    if (at >= 0 && !(next && "literal" in next && next.literal.startsWith(".")))
      t.splice(at + 1, 0, { literal: "." });
    picture = pictureOf(t);
  }
  if ([5, 7, 10].includes(id) && lang === "fi") {
    const t = tokens(picture).map((x) =>
      "literal" in x ? { literal: x.literal.replaceAll("ta", "") } : x,
    );
    const at = lastTokenIndex(t, (x) => "code" in x && /^M/.test(x.code));
    if (at >= 0) t.splice(at + 1, 0, { literal: "k" });
    picture = pictureOf(t);
  }
  if (id === 7 && lang === "uz") picture = picture.replace(/\."$/, '"');
  return picture;
}

const pictures = new Map<string, string>();
function datePicture(locale: string, calendar: string, id: number): string {
  const key = `${locale}/${calendar}/${id}`;
  let picture = pictures.get(key);
  if (picture === undefined) {
    picture = buildDatePicture(locale, calendar, id);
    if (pictures.size >= 256) pictures.delete(pictures.keys().next().value!);
    pictures.set(key, picture);
  }
  return picture;
}

function chineseNumber(n: number, digits = false): string {
  const chars = "〇一二三四五六七八九";
  if (digits) return String(n).replace(/\d/g, (x) => chars[Number(x)]!);
  if (n < 10) return chars[n]!;
  let result = "",
    zero = false;
  for (const [value, unit] of [
    [1000, "千"],
    [100, "百"],
    [10, "十"],
    [1, ""],
  ] as const) {
    const d = Math.floor(n / value);
    n %= value;
    if (d) {
      if (zero) result += "〇";
      result += (value === 10 && d === 1 && !result ? "" : chars[d]) + unit;
      zero = false;
    } else if (result && n) zero = true;
  }
  return result;
}
function hebrewNumber(n: number): string {
  n %= 1000;
  let result = "";
  for (const [value, letter] of [
    [400, "ת"],
    [300, "ש"],
    [200, "ר"],
    [100, "ק"],
    [90, "צ"],
    [80, "פ"],
    [70, "ע"],
    [60, "ס"],
    [50, "נ"],
    [40, "מ"],
    [30, "ל"],
    [20, "כ"],
    [10, "י"],
    [9, "ט"],
    [8, "ח"],
    [7, "ז"],
    [6, "ו"],
    [5, "ה"],
    [4, "ד"],
    [3, "ג"],
    [2, "ב"],
    [1, "א"],
  ] as const) {
    // 15/16 traditionally avoid spelling a divine name.
    if (n === 15 || n === 16) {
      result += n === 15 ? "טו" : "טז";
      break;
    }
    while (n >= value) {
      result += letter;
      n -= value;
    }
  }
  return result.length > 1
    ? result.slice(0, -1) + '"' + result.slice(-1)
    : result + "'";
}

function renderPicture(
  picture: string,
  locale: string,
  calendar: string,
  date: Date,
  timeZone?: string,
): string {
  const lang = new Intl.Locale(locale).language;
  const options = { calendar, numberingSystem: "latn", timeZone };
  const parts = formatter("en-US", {
    ...options,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const number = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const year = number("year"),
    month = number("month"),
    day = number("day"),
    hour = number("hour"),
    minute = number("minute"),
    second = number("second");
  const part = (
    type: Intl.DateTimeFormatPartTypes,
    opts: Intl.DateTimeFormatOptions,
  ) =>
    formatter(locale, { ...options, ...opts })
      .formatToParts(date)
      .find((p) => p.type === type)?.value ?? "";
  const numeric = (n: number, width = 1, native?: "thai" | "deva") => {
    const s = String(n).padStart(width, "0");
    return native
      ? s.replace(/\d/g, (x) =>
          String.fromCodePoint(
            (native === "thai" ? 0x0e50 : 0x0966) + Number(x),
          ),
        )
      : s;
  };
  const jp = () =>
    formatter("ja-JP", {
      calendar: "japanese",
      year: "numeric",
      era: "long",
      timeZone,
    }).formatToParts(date);
  const eraYear = () =>
    Number(
      jp()
        .find((p) => p.type === "year")
        ?.value.replace("元", "1"),
    );
  const native = lang === "th" ? "thai" : "deva";
  const items = tokens(picture);
  const hasDay = items.some(
    (t) => "code" in t && /^(d{1,2}|ว{1,2}|a{1,2}|A)$/.test(t.code),
  );
  const dangi =
    lang === "ko" && items.some((t) => "code" in t && /^g/.test(t.code));
  return items
    .map((t) => {
      if ("literal" in t) return t.literal;
      const c = t.code,
        n = c.length,
        initial = c[0];
      if (["AMPM", "am/pm", "AM/PM"].includes(c))
        return part("dayPeriod", { hour: "numeric", hour12: true });
      if (initial === "y" || initial === "b" || initial === "ป") {
        if (calendar === "hebrew") return hebrewNumber(year);
        const y = dangi ? year + 2333 : year;
        return numeric(
          n <= 2 ? y % 100 : y,
          n === 2 ? 2 : 1,
          initial === "ป" ? "thai" : undefined,
        );
      }
      if (initial === "M" || initial === "ด") {
        if (n >= 3)
          return part("month", {
            month: n === 3 ? "short" : "long",
            ...(hasDay ? { day: "numeric" } : {}),
          });
        // Hebrew calendar month numbers are represented by names.
        if (calendar === "hebrew") return part("month", { month: "long" });
        return numeric(month, n, initial === "ด" ? "thai" : undefined);
      }
      if (initial === "d" || initial === "ว") {
        if (n >= 3) {
          const name = part("weekday", { weekday: n === 3 ? "short" : "long" });
          return initial === "ว" ? name.replace(/^วัน/, "") : name;
        }
        if (calendar === "hebrew") return hebrewNumber(day);
        return numeric(day, n, initial === "ว" ? "thai" : undefined);
      }
      if (initial === "H" || initial === "h" || initial === "ม")
        return numeric(
          initial === "h" ? hour % 12 || 12 : hour,
          n,
          initial === "ม" ? "thai" : undefined,
        );
      if (initial === "m" || initial === "น")
        return numeric(minute, n, initial === "น" ? "thai" : undefined);
      if (initial === "s" || initial === "ท")
        return numeric(second, n, initial === "ท" ? "thai" : undefined);
      if (initial === "g") {
        if (lang === "hi")
          return numeric(n === 1 ? year % 100 : year, n === 1 ? 2 : 1, "deva");
        return lang === "ko"
          ? "단기"
          : (jp().find((p) => p.type === "era")?.value ?? "");
      }
      if (initial === "e") return numeric(lang === "ja" ? eraYear() : year, n);
      if (initial === "E")
        return chineseNumber(
          lang === "ja" && n === 1 ? eraYear() : year,
          n > 1 || lang !== "ja",
        );
      if (initial === "O") return chineseNumber(month);
      if (initial === "A") return chineseNumber(day);
      if (initial === "W")
        return part("weekday", { weekday: "long" }).replace(
          /^(星期|週|周)/,
          "",
        );
      if (initial === "w") return part("weekday", { weekday: "short" });
      if (initial === "a") {
        if (lang === "hi") return numeric(day, n, native);
        return part("weekday", { weekday: "short" }).replace(/曜日$|요일$/, "");
      }
      if (initial === "o") return numeric(month, 2, "deva");
      if (initial === "r") return numeric(hour, 2, "deva");
      if (initial === "i") return numeric(minute, 2, "deva");
      if (initial === "c") return numeric(second, 2, "deva");
      return c;
    })
    .join("")
    .trim()
    .replace(/ {2,}/g, " ");
}

/** Evaluates reserved DrawingML date fields. Unknown field types return null.
 * Reading never replaces the field, its ID, language or authored cached text. */
export function formatDateTimeField(
  type: string | null | undefined,
  date: Date,
  format: Pick<TextFormat, "language" | "alternateLanguage"> = {},
  options: DateFieldOptions = {},
): string | null {
  const match = /^(uaqdatetime([1-7])|datetime([1-9]|1[0-3]))$/.exec(
    type ?? "",
  );
  if (!match && type !== "datetime" && type !== "datetimeFigureOut")
    return null;
  if (!Number.isFinite(date.getTime()))
    throw new RangeError("date field requires a valid date");
  const index = match ? Number(match[2] ?? match[3]) - 1 : 0;
  const locale = supportedLocale(
    format.language,
    format.alternateLanguage,
    options.locale,
  );
  const tag = new Intl.Locale(locale).maximize(),
    lang = tag.language,
    region = tag.region;
  const key =
    lang === "en" && (region === "GB" || region === "AU")
      ? "en-GB"
      : lang === "zh" && (region === "TW" || region === "CN")
        ? `zh-${region}`
        : lang === "fa"
          ? "ar"
          : lang;
  const id = (IDS[key] ?? DEFAULT_IDS)[index]!;
  const calendar =
    lang === "th"
      ? "buddhist"
      : index < 7 && ["ar", "fa"].includes(lang)
        ? type?.startsWith("uaq")
          ? "islamic-umalqura"
          : "islamic-tbla"
        : lang === "he" && index < 7
          ? "hebrew"
          : lang === "hi" && index < 7
            ? "indian"
            : "gregory";
  const picture =
    typeof id === "string" ? id : datePicture(locale, calendar, id);
  return renderPicture(picture, locale, calendar, date, options.timeZone);
}
