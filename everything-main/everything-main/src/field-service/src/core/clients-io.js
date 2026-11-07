/** Client CSV import and export. */
import { parseCSV, toCSV, findColumn, unguard } from './csv.js';
import { newId } from './ids.js';
import { clientName, formatAddress, primaryEmail, primaryPhone } from './format.js';

const COLUMNS = {
  firstName: ['first name', 'firstname', 'first', 'given name'],
  lastName: ['last name', 'lastname', 'last', 'surname', 'family name'],
  name: ['name', 'full name', 'client name', 'client', 'contact name'],
  company: ['company', 'company name', 'business', 'organization'],
  email: ['email', 'e-mail', 'email address'],
  phone: ['phone', 'phone number', 'mobile', 'cell', 'telephone'],
  street1: ['street', 'street 1', 'address', 'address 1', 'address line 1', 'street address'],
  street2: ['street 2', 'address 2', 'address line 2', 'unit', 'suite'],
  city: ['city', 'town'],
  region: ['state', 'province', 'region', 'state/province'],
  postal: ['zip', 'zip code', 'postal code', 'postcode', 'postal'],
  country: ['country'],
  tags: ['tags', 'tag', 'labels'],
  notes: ['notes', 'note', 'comments'],
  leadSource: ['lead source', 'source'],
  archived: ['archived'],
};

/** Returns { clients, skipped } from CSV text. */
export function importClientsCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { clients: [], skipped: 0 };
  const [headers, ...data] = rows;
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, aliases]) => [k, findColumn(headers, aliases)]));
  const get = (r, k) => (col[k] >= 0 ? unguard(String(r[col[k]] ?? '').trim()) : '');
  const clients = [];
  let skipped = 0;
  for (const r of data) {
    let first = get(r, 'firstName');
    let last = get(r, 'lastName');
    const name = get(r, 'name');
    const company = get(r, 'company');
    // Our export names a client shown by its company after the company,
    // which is not a person's name to split.
    const named = !!company && name === company;
    if (!first && !last && name && !named) {
      const parts = name.split(/\s+/);
      last = parts.length > 1 ? parts.pop() : '';
      first = parts.join(' ');
    }
    if (!first && !last && !company) {
      skipped++;
      continue;
    }
    const hasAddress = ['street1', 'city', 'postal'].some((k) => get(r, k));
    clients.push({
      id: newId(),
      firstName: first,
      lastName: last,
      company,
      useCompanyName: !!company && ((!first && !last) || named),
      emails: get(r, 'email') ? [{ label: 'Main', address: get(r, 'email') }] : [],
      phones: get(r, 'phone') ? [{ label: 'Main', number: get(r, 'phone') }] : [],
      properties: hasAddress
        ? [{ id: newId(), street1: get(r, 'street1'), street2: get(r, 'street2'), city: get(r, 'city'), region: get(r, 'region'), postal: get(r, 'postal'), country: get(r, 'country') }]
        : [],
      billingSame: true,
      tags: get(r, 'tags') ? get(r, 'tags').split(/[;,|]/).map((t) => t.trim()).filter(Boolean) : [],
      notes: get(r, 'notes'),
      leadSource: get(r, 'leadSource'),
      // As our export marks them, so archived clients stay archived.
      ...(/^(yes|y|true|1)$/i.test(get(r, 'archived')) ? { archived: true } : {}),
    });
  }
  return { clients, skipped };
}

export function exportClientsCSV(clients) {
  const rows = [['Name', 'First name', 'Last name', 'Company', 'Email', 'Phone', 'Street 1', 'Street 2', 'City', 'State', 'Zip code', 'Country', 'Tags', 'Lead source', 'Notes', 'Archived']];
  for (const c of clients) {
    const p = c.properties?.[0] || {};
    rows.push([clientName(c), c.firstName, c.lastName, c.company, primaryEmail(c), primaryPhone(c), p.street1, p.street2, p.city, p.region, p.postal, p.country, (c.tags || []).join('; '), c.leadSource, c.notes, c.archived ? 'yes' : '']);
  }
  return toCSV(rows);
}

export { formatAddress };
