/**
 * Pure helpers for the customer and organization screens: CSV reading and
 * writing, guessing which CSV column holds which field, and per-customer
 * and per-organization ticket counts from the local copy.
 */
import { isUnsolved, normEmail, normTags, cleanLine } from '../shared/model.js';
import { localDay } from '../ui/format.js';

/**
 * The text of a CSV file. Excel saves "CSV" in the computer's legacy code
 * page (Windows-1252 in the West) and "Unicode Text" as UTF-16, so a file
 * that is not valid UTF-8 is read as one of those instead of turning every
 * accented letter into a replacement character.
 */
export function decodeCsv(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/**
 * Parse CSV text into rows of cells. Handles quoted fields with embedded
 * delimiters, quotes ("") and line breaks, CRLF or LF line ends, a leading
 * byte order mark, and comma, semicolon or tab delimiters (detected from the
 * first line). Blank lines are skipped.
 */
export function parseCsv(text) {
  let src = String(text ?? '');
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const delimiter = detectDelimiter(src);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += ch;
    i++;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

function detectDelimiter(src) {
  let firstLine = '';
  let quoted = false;
  for (const ch of src) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && (ch === '\n' || ch === '\r')) break;
    if (!quoted) firstLine += ch;
  }
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of firstLine) if (ch in counts) counts[ch]++;
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : ',';
}

/**
 * Turn rows into CSV text. Cells that a spreadsheet would run as a formula
 * (starting with = + - @) are prefixed with an apostrophe.
 */
export function toCsv(rows) {
  return rows
    .map((r) =>
      r
        .map((v) => {
          let s = v === null || v === undefined ? '' : String(v);
          if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
          return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n');
}

/** The customer fields an import can fill, with header names that map to them. */
export const IMPORT_FIELDS = [
  { id: 'name', label: 'Name', aliases: ['name', 'full name', 'fullname', 'customer', 'contact', 'contact name', 'display name'] },
  { id: 'first', label: 'First name', aliases: ['first name', 'firstname', 'given name', 'first'] },
  { id: 'last', label: 'Last name', aliases: ['last name', 'lastname', 'surname', 'family name', 'last'] },
  { id: 'email', label: 'Email', aliases: ['email', 'e-mail', 'email address', 'mail', 'e-mail address'] },
  { id: 'phone', label: 'Phone', aliases: ['phone', 'phone number', 'telephone', 'mobile', 'tel', 'cell'] },
  { id: 'organization', label: 'Organization', aliases: ['organization', 'organisation', 'company', 'account', 'org', 'company name'] },
  { id: 'tags', label: 'Tags', aliases: ['tags', 'tag', 'labels', 'segments'] },
  { id: 'tz', label: 'Time zone', aliases: ['time zone', 'timezone', 'tz'] },
  { id: 'locale', label: 'Language', aliases: ['language', 'locale', 'lang'] },
  { id: 'notes', label: 'Notes', aliases: ['notes', 'note', 'details', 'comments', 'description'] },
];

/** Guess a column index for each import field from the header row (-1 when none). */
export function guessMapping(header) {
  const norm = header.map((x) => String(x || '').toLowerCase().replace(/[_\s]+/g, ' ').trim());
  const used = new Set();
  const mapping = Object.fromEntries(IMPORT_FIELDS.map((f) => [f.id, -1]));
  // Exact header names first, for every field, then looser matches for the
  // fields still open: otherwise "Company Name" would be taken as the
  // customer's name before the organization had a chance to claim it.
  for (const f of IMPORT_FIELDS) {
    for (const alias of f.aliases) {
      const idx = norm.findIndex((x, i) => !used.has(i) && x === alias);
      if (idx !== -1) {
        mapping[f.id] = idx;
        used.add(idx);
        break;
      }
    }
  }
  // The name goes last, and not at all when first and last names were found:
  // its aliases ("name", "customer", "contact") are part of so many other
  // headers ("Account Name", "Customer Email"). A header that ends in an
  // alias ("Customer Email") wins over one that only contains it.
  const loose = (f) => {
    const free = (i) => !used.has(i);
    const ends = norm.findIndex((x, i) => free(i) && f.aliases.some((a) => a.length > 3 && x.endsWith(a)));
    return ends !== -1 ? ends : norm.findIndex((x, i) => free(i) && f.aliases.some((a) => a.length > 3 && x.includes(a)));
  };
  for (const f of [...IMPORT_FIELDS.filter((x) => x.id !== 'name'), IMPORT_FIELDS.find((x) => x.id === 'name')]) {
    if (mapping[f.id] !== -1 || f.id === 'first' || f.id === 'last') continue;
    if (f.id === 'name' && mapping.first !== -1 && mapping.last !== -1) continue;
    const idx = loose(f);
    if (idx !== -1) {
      mapping[f.id] = idx;
      used.add(idx);
    }
  }
  return mapping;
}

/**
 * How an organization name is matched on import: the way the server stores
 * names (spacing collapsed, so Excel's non-breaking spaces match), any case.
 */
export const orgKey = (name) => cleanLine(name, 120).toLowerCase();

/**
 * Build customer rows for the import endpoint. `orgIdByName` maps an
 * organization's `orgKey` to its id. Returns { rows, skipped, orgNames }
 * where orgNames lists organization names with no match.
 */
export function buildImportRows(dataRows, mapping, orgIdByName = new Map()) {
  // Exports guard cells that look like formulas with a leading apostrophe
  // (see toCsv); take it off again so an export imports back unchanged.
  const at = (r, f) => (mapping[f] >= 0 ? String(r[mapping[f]] ?? '').trim().replace(/^'(?=[=+\-@])/, '') : '');
  const rows = [];
  let skipped = 0;
  const missingOrgs = new Map();
  for (const r of dataRows) {
    let name = at(r, 'name');
    if (!name) name = [at(r, 'first'), at(r, 'last')].filter(Boolean).join(' ');
    const rawEmail = at(r, 'email');
    const email = normEmail(rawEmail);
    if ((!name && !email) || (rawEmail && !email)) {
      skipped++;
      continue;
    }
    const row = { name: cleanLine(name, 120) || email.split('@')[0], email: email || undefined };
    const phone = at(r, 'phone');
    if (phone) row.phone = phone;
    const tags = normTags(at(r, 'tags'));
    if (tags.length) row.tags = tags;
    const notes = at(r, 'notes');
    if (notes) row.notes = notes;
    // Only values the browser knows, so the profile can show local time.
    const tz = at(r, 'tz');
    if (tz) {
      try {
        row.tz = new Intl.DateTimeFormat('en', { timeZone: tz }).resolvedOptions().timeZone;
      } catch {
        /* not a time zone */
      }
    }
    const locale = at(r, 'locale');
    if (locale) {
      try {
        row.locale = Intl.getCanonicalLocales(locale)[0];
      } catch {
        /* not a language tag */
      }
    }
    const orgName = at(r, 'organization');
    if (orgName) {
      const id = orgIdByName.get(orgKey(orgName));
      if (id) row.org = id;
      else {
        row.orgName = orgName;
        if (!missingOrgs.has(orgKey(orgName))) missingOrgs.set(orgKey(orgName), cleanLine(orgName, 120));
      }
    }
    rows.push(row);
  }
  return { rows, skipped, orgNames: [...missingOrgs.values()] };
}

/** Open and total ticket counts per requester and per organization. */
export function ticketCounts(tickets) {
  const byUser = new Map();
  const byOrg = new Map();
  const bump = (map, key, open) => {
    if (key === null || key === undefined) return;
    let c = map.get(key);
    if (!c) map.set(key, (c = { open: 0, total: 0 }));
    c.total++;
    if (open) c.open++;
  };
  for (const t of tickets) {
    if (t.deleted || t.spam) continue;
    const open = isUnsolved(t.status);
    bump(byUser, t.requester, open);
    bump(byOrg, t.org, open);
  }
  return { byUser, byOrg };
}

/** Customers per organization. */
export function memberCounts(users) {
  const out = new Map();
  for (const u of users) if (u.org) out.set(u.org, (out.get(u.org) || 0) + 1);
  return out;
}

/** Satisfaction summary for a list of tickets: { good, bad, rated, percent }. */
export function satisfaction(tickets) {
  let good = 0;
  let bad = 0;
  for (const t of tickets) {
    if (t.csat?.score === 'good') good++;
    else if (t.csat?.score === 'bad') bad++;
  }
  const rated = good + bad;
  return { good, bad, rated, percent: rated ? Math.round((good / rated) * 100) : null };
}

/** Rows for a customer CSV export. */
export function customersToCsv(users, orgs) {
  const header = ['Name', 'Email', 'Phone', 'Organization', 'Tags', 'Time zone', 'Language', 'Notes', 'Created'];
  const rows = users.map((u) => [
    u.name,
    u.email || '',
    u.phone || '',
    (u.org && orgs.get(u.org)?.name) || '',
    (u.tags || []).join(' '),
    u.tz || '',
    u.locale || '',
    u.notes || '',
    u.createdAt ? localDay(u.createdAt) : '',
  ]);
  return toCsv([header, ...rows]);
}

/** Compare helper for locale-aware, case-insensitive text sorting. */
export const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
