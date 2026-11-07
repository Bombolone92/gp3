/** Date, time and number formatting in the viewer's locale. */
const rtf = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' }) : null;
const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const dateYearFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function relTime(ts, now = Date.now()) {
  if (!ts) return '';
  const diff = (ts - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (!rtf) return shortDate(ts);
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return shortDate(ts, now);
}

export function shortDate(ts, now = Date.now()) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.getFullYear() === new Date(now).getFullYear() ? dateFmt.format(d) : dateYearFmt.format(d);
}

export function timeOnly(ts) {
  return ts ? timeFmt.format(new Date(ts)) : '';
}

export function fullDate(ts) {
  return ts ? fullFmt.format(new Date(ts)) : '';
}

export function isoDate(ts) {
  return new Date(ts).toISOString();
}

/** The local calendar day of a time, as YYYY-MM-DD (toISOString gives the UTC day). */
export function localDay(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fileSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

export function plural(n, one, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** The local time somewhere else, for a customer's time zone. */
export function localTimeIn(tz) {
  if (!tz) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date());
  } catch {
    return '';
  }
}

export function timeZones() {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
}
