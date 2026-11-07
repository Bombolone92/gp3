/**
 * Contact import and export. Pure functions: CSV rows (objects keyed by a
 * lower-cased header) become contact records, and contacts become rows.
 */
import { contactName, normalize, primaryEmail, primaryPhone } from './format.js';

// Includes the headers of Outlook and Google Contacts exports.
const ALIASES = {
  type: ['type', 'contact type', 'kind'],
  prefix: ['prefix', 'salutation', 'name prefix'],
  firstName: ['first name', 'firstname', 'first', 'given name'],
  middleName: ['middle name', 'middlename', 'middle'],
  lastName: ['last name', 'lastname', 'last', 'surname', 'family name'],
  name: ['name', 'full name', 'display name'],
  companyName: ['company', 'company name', 'organization', 'organisation', 'business', 'organization name', 'organization 1 - name'],
  jobTitle: ['job title', 'title', 'position', 'organization title', 'organization 1 - title'],
  email: ['email', 'email address', 'e-mail', 'primary email', 'e-mail address', 'e-mail 1 - value', 'email 1', 'home e-mail', 'work e-mail'],
  phone: ['phone', 'phone number', 'telephone', 'mobile', 'primary phone', 'business phone', 'mobile phone', 'home phone', 'phone 1 - value'],
  street: ['street', 'address', 'address 1', 'street address', 'address line 1', 'business street', 'home street', 'address 1 - street'],
  street2: ['address 2', 'address line 2', 'street 2', 'business street 2', 'home street 2', 'address 1 - extended address'],
  city: ['city', 'town', 'business city', 'home city', 'address 1 - city'],
  region: ['state', 'region', 'province', 'state or province', 'business state', 'home state', 'address 1 - region'],
  postal: ['zip', 'zip code', 'postal', 'postal code', 'postcode', 'business postal code', 'home postal code', 'address 1 - postal code'],
  country: ['country', 'business country/region', 'home country/region', 'address 1 - country'],
  website: ['website', 'web', 'url', 'web page', 'website 1 - value'],
  tags: ['tags', 'labels'],
  notes: ['notes', 'note', 'comments'],
};

// Our own exports guard formula-like text ("+1 555") with an apostrophe.
const clean = (v) =>
  String(v ?? '')
    .trim()
    .replace(/^'(?=[=+\-@])/, '');

function pickField(row, key) {
  for (const alias of ALIASES[key]) {
    const v = clean(row[alias]);
    if (v) return v;
  }
  return '';
}

/** Header names the importer recognizes, for help text. */
export const IMPORT_COLUMNS = ['First name', 'Last name', 'Company', 'Job title', 'Email', 'Phone', 'Street', 'City', 'State', 'Zip', 'Country', 'Website', 'Tags', 'Notes'];

/**
 * CSV objects -> contact records (without ids). Rows with no usable name are
 * skipped. A row with only a company name becomes a company contact.
 */
export function contactsFromRows(rows) {
  const out = [];
  for (const row of rows) {
    const f = Object.fromEntries(Object.keys(ALIASES).map((k) => [k, pickField(row, k)]));
    if ('title' in row && 'job title' in row) {
      // Outlook exports: Title is the salutation (Mr., Ms.) and Job Title the position.
      f.prefix ||= clean(row.title);
      f.jobTitle = clean(row['job title']);
    }
    let { firstName, lastName } = f;
    if (!firstName && !lastName && f.name) {
      const parts = f.name.split(/\s+/);
      lastName = parts.length > 1 ? parts.pop() : '';
      firstName = parts.join(' ');
    }
    const typeHint = normalize(f.type);
    const type = typeHint.startsWith('comp') || typeHint.startsWith('org') || (!firstName && !lastName && f.companyName) ? 'company' : 'person';
    if (type === 'person' && !firstName && !lastName) continue;
    if (type === 'company' && !f.companyName && !f.name) continue;
    const hasAddress = f.street || f.city || f.region || f.postal || f.country;
    out.push({
      type,
      prefix: type === 'person' ? f.prefix : '',
      firstName: type === 'person' ? firstName : '',
      middleName: type === 'person' ? f.middleName : '',
      lastName: type === 'person' ? lastName : '',
      companyName: type === 'company' ? f.companyName || f.name : f.companyName,
      jobTitle: type === 'person' ? f.jobTitle : '',
      emails: f.email ? [{ address: f.email, type: 'work', primary: true }] : [],
      phones: f.phone ? [{ number: f.phone, type: 'work', primary: true }] : [],
      addresses: hasAddress ? [{ street: f.street, street2: f.street2, city: f.city, region: f.region, postal: f.postal, country: f.country, type: 'work', primary: true }] : [],
      website: f.website,
      tags: f.tags
        ? [
            ...new Set(
              f.tags
                .split(/[;,|]|:::/)
                .map((t) => t.trim())
                .filter((t) => t && !t.startsWith('* ')), // Google's own labels, such as "* myContacts"
            ),
          ]
        : [],
      notes: f.notes,
    });
  }
  return out;
}

/** Key that identifies the same contact across an import: name plus email. */
export function contactKey(c) {
  return `${c.type}|${normalize(contactName(c)).replace(/\s+/g, ' ').trim()}|${normalize(primaryEmail(c))}`;
}

/** Split imported records into new ones and duplicates of existing contacts. */
export function splitDuplicates(incoming, existing) {
  const seen = new Set(existing.map(contactKey));
  const fresh = [];
  const dupes = [];
  for (const c of incoming) {
    const k = contactKey(c);
    if (seen.has(k)) dupes.push(c);
    else {
      seen.add(k);
      fresh.push(c);
    }
  }
  return { fresh, dupes };
}

/** Contacts -> CSV rows (header first). companyOf(id) resolves a person's company. */
export function contactsToRows(contacts, companyOf = () => '') {
  const head = ['Type', 'Name', 'Prefix', 'First name', 'Middle name', 'Last name', 'Company', 'Job title', 'Email', 'Phone', 'Street', 'Address 2', 'City', 'State', 'Zip', 'Country', 'Website', 'Tags', 'Notes'];
  const rows = contacts.map((c) => {
    const a = c.addresses?.find((x) => x.primary) || c.addresses?.[0] || {};
    return [
      c.type === 'company' ? 'Company' : 'Person',
      contactName(c),
      c.prefix || '',
      c.firstName || '',
      c.middleName || '',
      c.lastName || '',
      c.type === 'company' ? c.companyName || '' : companyOf(c.companyId) || c.companyName || '',
      c.jobTitle || '',
      primaryEmail(c),
      primaryPhone(c),
      a.street || '',
      a.street2 || '',
      a.city || '',
      a.region || '',
      a.postal || '',
      a.country || '',
      c.website || '',
      (c.tags || []).join('; '),
      c.notes || '',
    ];
  });
  return [head, ...rows];
}

/** Loose email check for form validation. */
export function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}
