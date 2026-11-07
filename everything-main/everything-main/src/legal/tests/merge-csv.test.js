import { describe, it, expect } from 'vitest';
import { mergeValues, fillTemplate, missingFields, templateToHtml, MERGE_FIELDS } from '../src/core/merge.js';
import { toCsv, parseCsv, csvObjects, csvCell } from '../src/core/csv.js';
import { defaultSettings } from '../src/core/settings.js';
import { parseMoney, centsToInput, formatMoney, formatMoneyShort, percentOf } from '../src/core/money.js';
import { namedRange, addMonths, startOfWeek, relativeDue } from '../src/core/dates.js';

const settings = { ...defaultSettings(), firm: { ...defaultSettings().firm, name: 'Okafor Law', phone: '555-0100' } };
const client = { type: 'person', firstName: 'Amara', lastName: 'Lopez', addresses: [{ street: '1 Main St', city: 'Riverton', region: 'OR', postal: '97301' }] };
const matter = { displayNumber: '00012-Lopez', description: 'Estate plan', practiceAreaId: 'pa-estate', openDate: '2026-10-01' };

describe('document merge fields', () => {
  const values = mergeValues({ matter, client, settings, user: { name: 'Eleanor Hartley' }, today: '2026-10-12' });

  it('fills fields from the matter, client, firm, and user', () => {
    const out = fillTemplate('Dear {{client.first_name}}, re {{ matter.number }} for {{firm.name}}. {{user.name}}', values);
    expect(out).toBe('Dear Amara, re 00012-Lopez for Okafor Law. Eleanor Hartley');
    expect(values['matter.practice_area']).toBe('Estate planning');
    expect(values['client.address']).toBe('1 Main St, Riverton, OR 97301');
  });

  it('flags unknown and empty fields visibly', () => {
    expect(fillTemplate('{{nope}} {{matter.location}}', values)).toBe('[[nope]] [[matter.location]]');
    expect(missingFields('{{client.name}} {{matter.location}} {{nope}}', values)).toEqual(['matter.location', 'nope']);
  });

  it('treats built-in object names as unknown fields', () => {
    expect(fillTemplate('{{constructor}} {{toString}} {{__proto__}}', values)).toBe('[[constructor]] [[toString]] [[__proto__]]');
    expect(missingFields('{{constructor}} {{hasOwnProperty}}', values)).toEqual(['constructor', 'hasownproperty']);
  });

  it('every documented field has a value key', () => {
    for (const g of MERGE_FIELDS) for (const [k] of g.fields) expect(k in values).toBe(true);
  });

  it('escapes HTML when turning text into a document', () => {
    const html = templateToHtml('A <b>', 'Line 1\nLine 2\n\n<script>x</script>');
    expect(html).toContain('<title>A &lt;b&gt;</title>');
    expect(html).toContain('<p>Line 1<br>Line 2</p>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});

describe('csv', () => {
  it('round-trips quotes, commas, and newlines', () => {
    const rows = [
      ['Name', 'Note'],
      ['Lopez, Amara', 'Said "hi"\nthen left'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('neutralizes spreadsheet formulas but keeps negative numbers', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('-12.50')).toBe('-12.50');
    expect(csvCell('+1 555')).toBe("'+1 555");
  });

  it('reads quoted fields that follow a space after the comma', () => {
    expect(csvObjects('Name, Email\n"Lopez, Amara", "a@x.com"\n')).toEqual([{ name: 'Lopez, Amara', email: 'a@x.com' }]);
  });

  it('reads objects keyed by header', () => {
    expect(csvObjects('﻿First Name,Email\r\nAmara,a@x.com\r\n\r\n')).toEqual([{ 'first name': 'Amara', email: 'a@x.com' }]);
  });
});

describe('money and dates', () => {
  it('parses and formats money as integer cents', () => {
    expect(parseMoney('$1,234.56')).toBe(123456);
    expect(parseMoney('(4.005)')).toBe(-401);
    expect(parseMoney('abc')).toBeNull();
    expect(centsToInput(-1050)).toBe('-10.50');
    expect(formatMoney(123456, 'USD', 'en-US')).toBe('$1,234.56');
    expect(percentOf(10001, 10)).toBe(1000);
  });

  it('reads a minus sign typed after the currency symbol', () => {
    expect(parseMoney('$-5')).toBe(-500);
    expect(parseMoney('€ -12,50')).toBe(-1250);
    expect(parseMoney('-$5')).toBe(-500);
    expect(parseMoney('$5')).toBe(500);
  });

  it('still formats amounts when the saved currency code is malformed', () => {
    expect(() => formatMoney(12345, 'EURO', 'en-US')).not.toThrow();
    expect(formatMoney(12345, 'EURO', 'en-US')).toContain('123.45');
    expect(formatMoneyShort(1234500, 'US$', 'en-US')).toContain('12.3K');
  });

  it('computes named ranges', () => {
    expect(namedRange('month', '2026-10-12')).toEqual(['2026-10-01', '2026-10-31']);
    expect(namedRange('quarter', '2026-11-03')).toEqual(['2026-10-01', '2026-12-31']);
    expect(namedRange('last-month', '2026-03-31')).toEqual(['2026-02-01', '2026-02-28']);
    expect(namedRange('week', '2026-10-14', 1)).toEqual(['2026-10-12', '2026-10-18']);
    expect(namedRange('all', '2026-10-12')).toBeNull();
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(startOfWeek('2026-10-14', 0)).toBe('2026-10-11');
  });

  it('describes due dates relative to today', () => {
    expect(relativeDue('2026-10-12', '2026-10-12')).toBe('Today');
    expect(relativeDue('2026-10-10', '2026-10-12')).toBe('2 days overdue');
    expect(relativeDue('2026-10-15', '2026-10-12')).toBe('In 3 days');
  });
});
