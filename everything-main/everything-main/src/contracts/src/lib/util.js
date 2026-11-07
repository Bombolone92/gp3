/** Random id, short enough to read in a URL hash, unique enough for one account. */
export function uid() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-6);
}

/* 32 characters, no look-alikes: a byte masked to 5 bits picks one with no
   modulo bias, and the result survives being read aloud or retyped. */
const TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/**
 * A token for something that becomes a public URL, where guessing it is the
 * whole attack. `uid()` is not that: half of it is the clock, and the other
 * half is Math.random(), whose state a handful of outputs gives away. This
 * goes through the platform CSPRNG — 5 bits a character, so the default is 120.
 */
export function randomToken(length = 24) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += TOKEN_ALPHABET[b & 31];
  return out;
}

/*
 * The separator between two facts on one line: "Northwind Cloud · Renews
 * Sep 7, 2026".
 *
 * The spaces either side are non-breaking, so a line can never end on the
 * dot. With ordinary spaces every context line that is allowed to wrap could
 * leave "Northwind Cloud ·" hanging at the end of one line with the thing it
 * was separating on the next — a stray mark pointing at nothing, on the list
 * the app opens with. Bound to the words either side, the break moves to the
 * nearest ordinary space instead.
 */
export const DOT = '\u00A0·\u00A0';

/** The parts that exist, separated by DOT. */
export function joinDot(parts) {
  return parts.filter(Boolean).join(DOT);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** "1.2 MB" style file sizes. */
export function formatBytes(n) {
  const num = Number(n) || 0;
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(num < 10240 ? 1 : 0)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

/** Money with currency code: formatMoney(12500, 'USD') → "$12,500". */
export function formatMoney(amount, currency = 'USD') {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency, maximumFractionDigits: n % 1 === 0 ? 0 : 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString()}`;
  }
}

/** Trigger a browser download of a Blob. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Debounce that fires on the trailing edge. */
export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
