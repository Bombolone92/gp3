// The tabular Hijri calendar workbooks from Excel use: the Thursday epoch (622-07-18 Gregorian)
// and the 30-year leap cycle with year 15, rather than year 16, intercalated.
// This differs from Intl's islamic-tbla calendar, so use integer day arithmetic.
const DAY_MS = 86400000;
const EPOCH = Date.UTC(622, 6, 18);
const yearStart = y => 354 * (y - 1) + Math.floor((11 * y + 4) / 30);

export function hijriDate(gregorian) {
  const days = Math.round((Date.UTC(gregorian.y, gregorian.m - 1, Math.max(1, gregorian.d)) - EPOCH) / DAY_MS);
  let y = Math.floor(days * 30 / 10631) + 1;
  while (yearStart(y) > days) y--;
  while (yearStart(y + 1) <= days) y++;
  const dayOfYear = days - yearStart(y);
  let m = 1;
  while (m < 12 && dayOfYear >= Math.ceil(29.5 * m)) m++;
  return { ...gregorian, y, m, d: dayOfYear - Math.ceil(29.5 * (m - 1)) + 1 };
}

// Calendar vocabulary, including nonbreaking spaces in Arabic names.
const AR_MONTHS = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الثاني', 'جمادى الأولى', 'جمادى الثانية', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];
const AR_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const EN_DAYS = ['AlAhad', 'AlEthnien', 'AthThulatha', "AlArbia'a", 'AlKhamis', 'AlJumaa', 'AsSabt'];
const JA_MONTHS = ['ムハッラム', 'サフアル', 'ラビー・ウル・アウワル', 'ラビー・ウッ・サーニー', 'ジュマーダル・アウワル', 'ジュマーダッサーニー', 'ラジャブ', 'シャアバーン', 'ラマダーン', 'シャウワール', 'ズル・カイダ', 'ズル・ヒッジャ'];
const TH_SHORT_DAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
// Labels for languages where the expected Islamic names differ from Intl's.
const DEFAULT_SHORT_MONTHS = ['Mhrm.', 'Safr.', 'Rab. I', 'Rab. II', 'Jmd. I', 'Jmd. II', 'Rajb.', 'Shbn.', 'Rmdn.', 'Shwl.', 'Dhuʻl-Q.', 'Dhuʻl-H.'];
const DEFAULT_SHORT_LANGUAGES = new Set(['de', 'it', 'pt', 'da', 'ko', 'el', 'bg', 'ca', 'ro', 'sl', 'et', 'lv', 'lt', 'vi']);
const HI_MONTHS = ['मुहर्रम', 'सफ़र', 'रबी अलअव्वल', 'रबी अस्सानी', 'जुमादा अलअव्वल', 'जुमादा अस्सानी', 'रजब', 'शाबान', 'रमज़ान', 'शव्वाल', 'ज़ू अलक़ादा', 'ज़ू अलहिज्जा'];
const HI_SHORT_MONTHS = ['मुह॰', 'सफ़र', 'रबी १', 'रबी २', 'जुमा॰ १', 'जुमा॰ २', 'रजब', 'शाब॰', 'रमज़॰', 'शव्व॰', 'ज़ू क़॰', 'ज़ू हि॰'];
const CA_MONTHS = ['de muharram', 'de safar', 'de rabiʻ I', 'de rabiʻ II', 'de jumada I', 'de jumada II', 'de rajab', 'de shaʻban', 'de ramadan', 'de shawwal', 'de dhuʻl-qiʻdah', 'de dhuʻl-hijjah'];
const REGIONAL_AR_MONTHS = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخرة', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];
// Persian and Urdu have distinct names for the two Islamic
// calendars, including legacy spelling and whitespace in weekday names.
const FA_MONTHS = ['محرم', 'صفر', 'ربیع الاول', 'ربیع الثانی', 'جمادی الاول', 'جمادی الثانی', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذی القعده', 'ذی الحجه'];
const FA_DAYS = ['يكشنبه', 'دوشنبه', 'سه شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const UM_FA_DAYS = ['يکشنبه', 'دوشنبه', 'سه شنبه', 'چهار شنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const UR_MONTHS = ['محرّم', 'صفر', 'ربیع الأوّل', 'ربیع الثانی', 'جمادى الأول', 'جمادى الثانی', 'رجب', 'شعبان', 'رمضان', 'شوّال', 'ذو القعد', 'ذو الحجّ'];
const UR_DAYS = ['اتوار', 'پير', 'منگل', 'بدھ', 'جمعرات', 'جمعه', 'هفته'];
const UM_UR_MONTHS = ['محرم', 'صفر', 'ربیع الاول', 'ربیع الثانی', 'جمادی الاول', 'جمادی الثانی', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدہ', 'ذو الحجہ'];
const UM_UR_SHORT_MONTHS = ['محرم', 'صفر', 'ربیع ۱', 'ربیع ۲', 'جما ۱', 'جما ۲', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو ق', 'ذو ح'];
const UM_ID_DAYS = { short: ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'], long: ['Ahad', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'] };
const monthCache = new Map();

function monthNames(locale, umalqura) {
  const tag = (locale || '').toLowerCase();
  const key = `${umalqura ? 23 : 6}:${tag}`;
  if (monthCache.has(key)) return monthCache.get(key);
  const language = tag.split('-')[0];
  const traditionalChinese = /^zh-(?:hant|tw|hk|mo)(?:-|$)/.test(tag);
  let long, short;
  if (!locale || language === 'ar') {
    long = !umalqura && /^ar-(?:eg|ly|dz)(?:-|$)/.test(tag) ? REGIONAL_AR_MONTHS : AR_MONTHS;
    short = long;
  } else if (language === 'fa') short = long = umalqura ? AR_MONTHS : FA_MONTHS;
  else if (language === 'ur') { long = umalqura ? UM_UR_MONTHS : UR_MONTHS; short = umalqura ? UM_UR_SHORT_MONTHS : long; }
  else if (language === 'ja') short = long = JA_MONTHS;
  else if (language === 'hi') { long = HI_MONTHS; short = HI_SHORT_MONTHS; }
  else {
    const supported = Intl.DateTimeFormat.supportedLocalesOf([locale]).length ? locale : 'en-US';
    const labels = width => {
      const formatter = new Intl.DateTimeFormat(supported, { calendar: 'islamic-tbla', month: width, timeZone: 'UTC' });
      // Only labels come from Intl. Mid-month instants avoid its different
      // leap cycle; no Intl calendar arithmetic enters displayed date fields.
      return Array.from({ length: 12 }, (_, m) => formatter.formatToParts(new Date(EPOCH + (Math.ceil(29.5 * m) + 14) * DAY_MS)).find(p => p.type === 'month').value);
    };
    long = language === 'ca' ? CA_MONTHS : labels('long');
    if (traditionalChinese) long = long.map(name => name.replace(/ (I{1,2})$/, '$1'));
    if (language === 'bn') long = long.map((name, m) => m === 0 ? 'মহররম' : name);
    if (language === 'tr' && !umalqura) long = long.map((name, m) => m === 2 ? 'Rebiyülevvel' : m === 3 ? 'Rebiyülahir' : name);
    if (DEFAULT_SHORT_LANGUAGES.has(language) || traditionalChinese) short = DEFAULT_SHORT_MONTHS;
    else if (['sv', 'fi', 'bn'].includes(language) || (!umalqura && ['tr', 'id'].includes(language))) short = long;
    else {
      short = labels('short');
      if (language === 'pl') short = short.map((name, m) => [0, 1, 2, 3, 8].includes(m) ? DEFAULT_SHORT_MONTHS[m] : name);
      if (language === 'hu') short = short.map((name, m) => m === 2 ? 'Rébi I' : m === 3 ? 'Rébi II' : name);
    }
  }
  const months = { short, long, shortInDate: short, inDate: long };
  if (monthCache.size >= 128) monthCache.clear();
  monthCache.set(key, months);
  return months;
}

export function hijriNames(locale, legacyArabic, ordinaryNames, umalqura = false) {
  const arabic = !locale || /^ar(-|$)/i.test(locale);
  // B2's legacy month transition deliberately replaces both name widths.
  // Modern calendar fields select widths from the same immutable resource.
  // Umm al-Qura keeps ordinary English weekdays and has its own Arabic,
  // Persian, Urdu, Turkish and Indonesian resources.
  const months = monthNames(legacyArabic ? null : locale, umalqura);
  const days = arabic ? { short: AR_DAYS, long: AR_DAYS }
    : /^fa(-|$)/i.test(locale) ? { short: umalqura ? UM_FA_DAYS : FA_DAYS, long: umalqura ? UM_FA_DAYS : FA_DAYS }
    : !umalqura && /^ur(-|$)/i.test(locale) ? { short: UR_DAYS, long: UR_DAYS }
    : umalqura && /^id(-|$)/i.test(locale) ? UM_ID_DAYS
    : !umalqura && /^en(-|$)/i.test(locale) ? { short: ordinaryNames.days.short, long: EN_DAYS }
    : /^th(-|$)/i.test(locale) ? { short: TH_SHORT_DAYS, long: ordinaryNames.days.long } : ordinaryNames.days;
  return { months, days };
}
