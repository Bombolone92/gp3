import { describe, it, expect } from 'vitest';
import { parseCSV, detectDelimiter, detectStatementColumns, rowsToStatementLines, csvEscape, toCSV } from '../src/lib/csv.js';

const CARD = `Transaction Date,Posted Date,Description,Amount
08/20/2026,08/21/2026,BLUE FERN CAFE NYC,14.60
08/19/2026,08/20/2026,"NORTHLINE RAIL, INC",86.50
08/18/2026,08/19/2026,PAYMENT RECEIVED - THANK YOU,-250.00
`;

const BANK_SEMI = `Datum;Beschreibung;Betrag
31.07.2026;"Miete ""August""";-1.500,00
02.08.2026;Rewe Markt;-42,17
`;

const DEBIT_CREDIT = `Date,Details,Debit,Credit
2026-08-03,Corner Deli,11.90,
2026-08-04,Refund Designly,,29.00
`;

describe('parseCSV', () => {
  it('handles quotes, embedded delimiters and escaped quotes', () => {
    const rows = parseCSV(CARD);
    expect(rows).toHaveLength(4);
    expect(rows[2][2]).toBe('NORTHLINE RAIL, INC');
    const de = parseCSV(BANK_SEMI);
    expect(de[1][1]).toBe('Miete "August"');
  });
  it('detects semicolon and tab delimiters', () => {
    expect(detectDelimiter(BANK_SEMI)).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter(CARD)).toBe(',');
  });
  it('strips a BOM and ignores blank lines', () => {
    const rows = parseCSV('﻿a,b\n\n1,2\n');
    expect(rows[0][0]).toBe('a');
    expect(rows).toHaveLength(2);
  });
});

describe('detectStatementColumns', () => {
  it('finds named columns in a card export and knows charges are positive', () => {
    const m = detectStatementColumns(parseCSV(CARD));
    expect(m.hasHeader).toBe(true);
    expect(m.dateCol).toBe(0);
    expect(m.descCol).toBe(2);
    expect(m.amountCol).toBe(3);
    expect(m.negate).toBe(true);
    expect(m.dayFirst).toBe(false);
  });
  it('reads a German bank export: day-first dates, negative charges', () => {
    const m = detectStatementColumns(parseCSV(BANK_SEMI));
    expect(m.dateCol).toBe(0);
    expect(m.amountCol).toBe(2);
    expect(m.dayFirst).toBe(true);
    expect(m.negate).toBe(false);
  });
  it('maps split debit and credit columns', () => {
    const m = detectStatementColumns(parseCSV(DEBIT_CREDIT));
    expect(m.amountCol).toBe(-1);
    expect(m.debitCol).toBe(2);
    expect(m.creditCol).toBe(3);
  });
  it('sniffs columns without a header row', () => {
    const m = detectStatementColumns(parseCSV('2026-08-01,Coffee place,4.50\n2026-08-02,Taxi,18.00\n'));
    expect(m.hasHeader).toBe(false);
    expect(m.dateCol).toBe(0);
    expect(m.amountCol).toBe(2);
    expect(m.descCol).toBe(1);
  });
});

describe('rowsToStatementLines', () => {
  it('normalises charges to positive and refunds to negative', () => {
    const rows = parseCSV(CARD);
    const { lines, skipped } = rowsToStatementLines(rows, detectStatementColumns(rows), { currency: 'USD' });
    expect(skipped).toHaveLength(0);
    expect(lines[0]).toMatchObject({ date: '2026-08-20', description: 'BLUE FERN CAFE NYC', amount: 14.6, currency: 'USD' });
    expect(lines[2].amount).toBe(-250);
  });
  it('flips the sign for bank exports and handles European decimals', () => {
    const rows = parseCSV(BANK_SEMI);
    const { lines } = rowsToStatementLines(rows, detectStatementColumns(rows), { currency: 'EUR' });
    expect(lines[0]).toMatchObject({ date: '2026-07-31', amount: 1500 });
    expect(lines[1].amount).toBe(42.17);
  });
  it('combines debit and credit columns', () => {
    const rows = parseCSV(DEBIT_CREDIT);
    const { lines } = rowsToStatementLines(rows, detectStatementColumns(rows));
    expect(lines[0].amount).toBe(11.9);
    expect(lines[1].amount).toBe(-29);
  });
  it('reports rows it cannot use', () => {
    const rows = parseCSV('Date,Description,Amount\nnot a date,Thing,5\n2026-08-01,Ok,\n2026-08-02,Fine,3\n');
    const { lines, skipped } = rowsToStatementLines(rows, detectStatementColumns(rows));
    expect(lines).toHaveLength(1);
    expect(skipped.map((s) => s.reason)).toEqual(['No date', 'No amount']);
  });
});

describe('csvEscape / toCSV', () => {
  it('quotes fields with commas, quotes or newlines', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('two\nlines')).toBe('"two\nlines"');
  });
  it('neutralises formula injection but leaves negative numbers alone', () => {
    expect(csvEscape('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvEscape('+1234')).toBe("'+1234");
    expect(csvEscape('-12.50')).toBe('-12.50');
  });
  it('joins rows with CRLF', () => {
    expect(toCSV([['a', 'b'], ['1', '2']])).toBe('a,b\r\n1,2');
  });
});
