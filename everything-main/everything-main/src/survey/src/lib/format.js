const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const numFmt = new Intl.NumberFormat();

export const fmtDate = (t) => (t ? dateFmt.format(new Date(t)) : '');
export const fmtDateTime = (t) => (t ? dateTimeFmt.format(new Date(t)) : '');
export const fmtNum = (n) => numFmt.format(n || 0);

export function fmtPct(part, total, digits = 1) {
  if (!total) return '0%';
  const v = (part / total) * 100;
  return `${v.toFixed(v === 100 || v === 0 ? 0 : digits)}%`;
}

export function plural(n, one, many = `${one}s`) {
  return `${fmtNum(n)} ${n === 1 ? one : many}`;
}

/** "3 min", "1 h 5 min", "42 s". */
export function fmtDuration(ms) {
  if (!(ms > 0)) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

/** "just now", "5 minutes ago", or a date. */
export function fmtRelative(t, now = Date.now()) {
  if (!t) return '';
  const d = now - t;
  if (d < 45_000) return 'just now';
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  if (d < 7 * 86_400_000) return `${Math.round(d / 86_400_000)} d ago`;
  return fmtDate(t);
}

export function slugify(s, fallback = 'survey') {
  const out = String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return out || fallback;
}

/** Save text as a file through the browser. */
export function downloadText(filename, text, type = 'text/plain') {
  downloadBlob(filename, new Blob([text], { type }));
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
