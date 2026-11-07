import { describe, it, expect, vi } from 'vitest';
import { parseCSV, toCSV, downloadText } from '../src/core/csv.js';
import { importClientsCSV, exportClientsCSV } from '../src/core/clients-io.js';

describe('csv', () => {
  it('parses quoted fields, escaped quotes and newlines', () => {
    const rows = parseCSV('a,"b,c","say ""hi"""\r\n1,"line\nbreak",3\n');
    expect(rows).toEqual([
      ['a', 'b,c', 'say "hi"'],
      ['1', 'line\nbreak', '3'],
    ]);
  });

  it('keeps a quote inside an unquoted field as text', () => {
    expect(parseCSV('Bob Smith,6" hedge trimmer\nAlice Jones,ok\nCarl Lee,fine\n')).toEqual([
      ['Bob Smith', '6" hedge trimmer'],
      ['Alice Jones', 'ok'],
      ['Carl Lee', 'fine'],
    ]);
  });

  it('reads semicolon and tab separated files', () => {
    expect(parseCSV('First name;Last name;Notes\r\nJosé;García;"a; b, c"\r\n')).toEqual([
      ['First name', 'Last name', 'Notes'],
      ['José', 'García', 'a; b, c'],
    ]);
    expect(parseCSV('Name\tPhone\nAda\t555, ext 2\n')).toEqual([
      ['Name', 'Phone'],
      ['Ada', '555, ext 2'],
    ]);
    // A comma file with semicolons inside its fields stays comma separated.
    expect(parseCSV('Name,Tags\nAda,"a;b;c"\n')).toEqual([
      ['Name', 'Tags'],
      ['Ada', 'a;b;c'],
    ]);
  });

  it('round-trips through toCSV', () => {
    const data = [['x', 'y,z', 'q"q'], ['1', '', 'multi\nline']];
    expect(parseCSV(toCSV(data))).toEqual(data);
  });

  it('neutralizes formula injection on export', () => {
    expect(toCSV([['=SUM(A1)']])).toBe("'=SUM(A1)\r\n");
    expect(toCSV([['-50.00', '+1 555 0100', -3]])).toBe("-50.00,'+1 555 0100,-3\r\n");
  });

  it('starts CSV downloads with a byte order mark so Excel reads them as UTF-8', async () => {
    const blobs = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => (blobs.push(b), 'blob:x'));
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('document', { createElement: () => ({ click() {}, remove() {} }), body: { append() {} } });
    try {
      downloadText('clients.csv', 'Name\r\nJosé\r\n');
      downloadText('backup.json', '{}', 'application/json');
      const bytes = new Uint8Array(await blobs[0].arrayBuffer());
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(parseCSV(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes))).toEqual([['Name'], ['José']]);
      expect(new Uint8Array(await blobs[1].arrayBuffer())[0]).toBe(0x7b);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});

describe('client import', () => {
  it('maps common header names and splits full names', () => {
    const csv = 'Full Name,E-mail,Phone Number,Address,City,State,Zip Code,Tags\nAda Lovelace,ada@example.com,555-0100,1 Main St,Springfield,OR,97477,VIP; Recurring\n,,,,,,,\n';
    const { clients, skipped } = importClientsCSV(csv);
    expect(skipped).toBe(0);
    expect(clients).toHaveLength(1);
    const c = clients[0];
    expect(c.firstName).toBe('Ada');
    expect(c.lastName).toBe('Lovelace');
    expect(c.emails[0].address).toBe('ada@example.com');
    expect(c.properties[0]).toMatchObject({ street1: '1 Main St', city: 'Springfield', region: 'OR', postal: '97477' });
    expect(c.tags).toEqual(['VIP', 'Recurring']);
  });

  it('uses the company as the name when there is no person', () => {
    const { clients } = importClientsCSV('Company,Email\nAcme Co,a@acme.test\n');
    expect(clients[0].useCompanyName).toBe(true);
  });

  it('reads back values that export guarded against formulas', () => {
    const { clients } = importClientsCSV('First name,Phone,Notes\nAda,"\'+1 555 123 4567","\'- gate code 12"\n');
    expect(clients[0].phones[0].number).toBe('+1 555 123 4567');
    expect(clients[0].notes).toBe('- gate code 12');
  });

  it('exports what it imports', () => {
    const { clients } = importClientsCSV('First name,Last name,Email\nGrace,Hopper,g@example.com\n');
    const again = importClientsCSV(exportClientsCSV(clients)).clients[0];
    expect(again.firstName).toBe('Grace');
    expect(again.lastName).toBe('Hopper');
    expect(again.emails[0].address).toBe('g@example.com');
  });

  it('keeps archived clients archived on re-import', () => {
    const out = exportClientsCSV([{ firstName: 'Old', lastName: 'Client', archived: true }, { firstName: 'New', lastName: 'Client' }]);
    const [old, current] = importClientsCSV(out).clients;
    expect(old.archived).toBe(true);
    expect(current.archived).toBeUndefined();
  });

  it('keeps clients shown by their company name as companies on re-import', () => {
    const out = exportClientsCSV([
      { firstName: '', lastName: '', company: 'Acme Corp', useCompanyName: true },
      { firstName: 'Jo', lastName: 'Smith', company: 'Beta LLC', useCompanyName: true },
      { firstName: 'Ann', lastName: 'Lee', company: 'Gamma Inc', useCompanyName: false },
    ]);
    const [acme, beta, ann] = importClientsCSV(out).clients;
    expect([acme.firstName, acme.lastName, acme.company, acme.useCompanyName]).toEqual(['', '', 'Acme Corp', true]);
    expect([beta.firstName, beta.lastName, beta.company, beta.useCompanyName]).toEqual(['Jo', 'Smith', 'Beta LLC', true]);
    expect([ann.firstName, ann.lastName, ann.company, ann.useCompanyName]).toEqual(['Ann', 'Lee', 'Gamma Inc', false]);
  });
});
