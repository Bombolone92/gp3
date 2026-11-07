/**
 * Document automation: templates contain {{merge.fields}} that are filled in
 * from a matter, its client, the firm, and the current user. Unknown fields
 * are left visible as [[field]] so a missing value is obvious in the draft.
 */
import { contactName, formatAddress, primaryEmail, primaryPhone } from './format.js';
import { formatDate } from './dates.js';
import { practiceAreaName } from './settings.js';
import { formatMoney } from './money.js';

export const MERGE_FIELDS = [
  {
    group: 'Matter',
    fields: [
      ['matter.number', 'Matter number'],
      ['matter.description', 'Description'],
      ['matter.practice_area', 'Practice area'],
      ['matter.open_date', 'Open date'],
      ['matter.client_reference', 'Client reference'],
      ['matter.location', 'Location'],
      ['matter.statute_of_limitations', 'Statute of limitations'],
      ['matter.responsible_lawyer', 'Responsible lawyer'],
      ['matter.flat_fee', 'Flat fee'],
      ['matter.hourly_rate', 'Hourly rate'],
    ],
  },
  {
    group: 'Client',
    fields: [
      ['client.name', 'Full name'],
      ['client.first_name', 'First name'],
      ['client.last_name', 'Last name'],
      ['client.email', 'Email'],
      ['client.phone', 'Phone'],
      ['client.address', 'Address'],
    ],
  },
  {
    group: 'Firm',
    fields: [
      ['firm.name', 'Firm name'],
      ['firm.address', 'Address'],
      ['firm.phone', 'Phone'],
      ['firm.email', 'Email'],
    ],
  },
  {
    group: 'Other',
    fields: [
      ['user.name', 'Your name'],
      ['today', 'Today’s date'],
    ],
  },
];

/** Values for every merge field, as plain strings. */
export function mergeValues({ matter = null, client = null, settings, user = null, responsible = null, today }) {
  const f = settings.firm || {};
  const addr = client?.addresses?.find((a) => a.primary) || client?.addresses?.[0];
  const b = matter?.billing || {};
  return {
    'matter.number': matter?.displayNumber || '',
    'matter.description': matter?.description || '',
    'matter.practice_area': matter ? practiceAreaName(settings, matter.practiceAreaId) : '',
    'matter.open_date': matter?.openDate ? formatDate(matter.openDate, { year: 'numeric', month: 'long', day: 'numeric' }) : '',
    'matter.client_reference': matter?.clientRef || '',
    'matter.location': matter?.location || '',
    'matter.statute_of_limitations': matter?.solDate ? formatDate(matter.solDate, { year: 'numeric', month: 'long', day: 'numeric' }) : '',
    'matter.responsible_lawyer': responsible?.name || '',
    'matter.flat_fee': b.flatFeeCents ? formatMoney(b.flatFeeCents) : '',
    'matter.hourly_rate': b.rateCents ? formatMoney(b.rateCents) : '',
    'client.name': client ? contactName(client) : '',
    'client.first_name': client?.type === 'company' ? client.companyName || '' : client?.firstName || '',
    'client.last_name': client?.type === 'company' ? '' : client?.lastName || '',
    'client.email': primaryEmail(client),
    'client.phone': primaryPhone(client),
    'client.address': formatAddress(addr),
    'firm.name': f.name || '',
    'firm.address': formatAddress({ street: f.street, city: f.city, region: f.region, postal: f.postal, country: f.country }),
    'firm.phone': f.phone || '',
    'firm.email': f.email || '',
    'user.name': user?.name || '',
    today: formatDate(today, { year: 'numeric', month: 'long', day: 'numeric' }),
  };
}

const FIELD_RE = /\{\{\s*([a-z_.]+)\s*\}\}/gi;

/** Fill a plain-text template. */
export function fillTemplate(text, values) {
  return String(text || '').replace(FIELD_RE, (_, key) => {
    const k = key.toLowerCase();
    return (Object.hasOwn(values, k) && values[k]) || `[[${key}]]`;
  });
}

/** Fields a template uses that have no value for this matter. */
export function missingFields(text, values) {
  const out = new Set();
  for (const m of String(text || '').matchAll(FIELD_RE)) {
    const k = m[1].toLowerCase();
    if (!Object.hasOwn(values, k) || !values[k]) out.add(k);
  }
  return [...out];
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * A filled template as a standalone, printable HTML document. The template
 * is plain text: blank lines separate paragraphs, and every value is escaped.
 */
export function templateToHtml(title, text) {
  const paras = String(text || '')
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font:12pt/1.55 Georgia,'Times New Roman',serif;color:#111;max-width:7in;margin:1in auto;padding:0 16px}p{margin:0 0 1em}@media print{body{margin:0 auto}}</style>
</head><body>
${paras}
</body></html>`;
}
