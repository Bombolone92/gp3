import { describe, it, expect } from 'vitest';
import { parseCSVStatement, parseOFX, dedupe, parseStatementDate, guessMapping } from '../src/lib/bankimport.js';
import { parseCSV, toCSV } from '../src/lib/csv.js';

describe('csv', () => {
  it('parses quotes, escaped quotes and newlines', () => {
    expect(parseCSV('a,"b, c","d ""e"""\r\n1,"multi\nline",3\n')).toEqual([['a', 'b, c', 'd "e"'], ['1', 'multi\nline', '3']]);
  });
  it('allows spaces before a quoted field', () => {
    expect(parseCSV('Date, "Description", Amount\n03/01/2026, "Coffee, large", -4.50')).toEqual([
      ['Date', 'Description', 'Amount'],
      ['03/01/2026', 'Coffee, large', '-4.50'],
    ]);
  });
  it('detects semicolons', () => {
    expect(parseCSV('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('neutralizes formulas on export', () => {
    expect(toCSV([['=SUM(A1)', '-12.5', 'x,y']])).toBe("'=SUM(A1),-12.5,\"x,y\"");
  });
});

describe('statement dates', () => {
  it.each([
    ['2026-03-04', 'mdy', '2026-03-04'],
    ['03/04/2026', 'mdy', '2026-03-04'],
    ['03/04/2026', 'dmy', '2026-04-03'],
    ['25/12/2026', 'mdy', '2026-12-25'],
    ['20260304120000[-5:EST]', 'mdy', '2026-03-04'],
    ['Mar 4, 2026', 'mdy', '2026-03-04'],
    ['4 Mar 2026', 'mdy', '2026-03-04'],
    ['nonsense', 'mdy', null],
  ])('%s (%s)', (input, style, out) => {
    expect(parseStatementDate(input, style)).toBe(out);
  });
});

describe('CSV statements', () => {
  it('reads a single amount column', () => {
    const r = parseCSVStatement('Date,Description,Amount\n10/01/2026,COFFEE,-4.50\n10/02/2026,"CLIENT, INC",1200.00\n');
    expect(r.lines).toEqual([
      { date: '2026-10-01', amount: -450, desc: 'COFFEE', fitid: '' },
      { date: '2026-10-02', amount: 120000, desc: 'CLIENT, INC', fitid: '' },
    ]);
  });
  it('reads separate debit and credit columns', () => {
    const r = parseCSVStatement('Posted Date,Payee,Debit,Credit\n2026-10-01,Rent,1500.00,\n2026-10-03,Deposit,,250.00\n');
    expect(r.mapping.mode).toBe('split');
    expect(r.lines.map((l) => l.amount)).toEqual([-150000, 25000]);
  });
  it('skips rows without a date and reports them', () => {
    const r = parseCSVStatement('Date,Description,Amount\nTotal,,100\n10/01/2026,X,-1\n');
    expect(r.lines.length).toBe(1);
    expect(r.skipped).toEqual([{ row: 2, reason: 'No readable date' }]);
  });
  it('guesses mappings from common headers', () => {
    expect(guessMapping(['Transaction Date', 'Memo', 'Withdrawals', 'Deposits'])).toMatchObject({ date: 0, desc: 1, debit: 2, credit: 3, mode: 'split' });
  });
});

describe('OFX', () => {
  const sgml = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>12345678</BANKACCTFROM><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261001<TRNAMT>-12.34<FITID>A1<NAME>COFFEE &amp; CO<MEMO>CARD 1234</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261002120000<TRNAMT>500.00<FITID>A2<NAME>PAYROLL</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>1234.56<DTASOF>20261003</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  it('parses SGML statements', () => {
    const r = parseOFX(sgml);
    expect(r.lines).toEqual([
      { date: '2026-10-01', amount: -1234, desc: 'COFFEE & CO CARD 1234', fitid: 'A1', checkNum: '' },
      { date: '2026-10-02', amount: 50000, desc: 'PAYROLL', fitid: 'A2', checkNum: '' },
    ]);
    expect(r.balance).toBe(123456);
    expect(r.accountNumber).toBe('12345678');
  });
  it('keeps each account in a multi-account file apart', () => {
    const two = `OFXHEADER:100
<OFX><BANKMSGSRSV1>
<STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>CHK-1111<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST>
<STMTTRN><DTPOSTED>20261001<TRNAMT>-10.00<FITID>A1<NAME>COFFEE</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>500.00</LEDGERBAL></STMTRS></STMTTRNRS>
<STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>SAV-2222<ACCTTYPE>SAVINGS</BANKACCTFROM><BANKTRANLIST>
<STMTTRN><DTPOSTED>20261001<TRNAMT>2000.00<FITID>A1<NAME>INTEREST</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>90000.00</LEDGERBAL></STMTRS></STMTTRNRS>
</BANKMSGSRSV1><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CCACCTFROM><ACCTID>4111</CCACCTFROM><BANKTRANLIST>
<STMTTRN><DTPOSTED>20261002<TRNAMT>-5.00<FITID>C1<NAME>BOOKS</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>-5.00</LEDGERBAL></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
    const r = parseOFX(two);
    expect(r.statements.map((st) => [st.accountType, st.accountNumber, st.balance, st.lines.map((l) => l.desc)])).toEqual([
      ['CHECKING', 'CHK-1111', 50000, ['COFFEE']],
      ['SAVINGS', 'SAV-2222', 9000000, ['INTEREST']],
      ['CREDITCARD', '4111', -500, ['BOOKS']],
    ]);
    // The result itself is the first statement only.
    expect(r.lines.map((l) => l.desc)).toEqual(['COFFEE']);
    expect(r.balance).toBe(50000);
  });
  it('parses XML statements', () => {
    const xml = '<?xml version="1.0"?><OFX><STMTTRN><DTPOSTED>20261005</DTPOSTED><TRNAMT>-9.99</TRNAMT><FITID>X9</FITID><NAME>APP STORE</NAME></STMTTRN></OFX>';
    expect(parseOFX(xml).lines[0]).toMatchObject({ date: '2026-10-05', amount: -999, fitid: 'X9', desc: 'APP STORE' });
  });
});

describe('dedupe', () => {
  it('skips lines already imported, by FITID or by content', () => {
    const existing = [{ date: '2026-10-01', amount: -450, desc: 'COFFEE', fitid: '' }, { date: '2026-10-02', amount: -100, desc: 'X', fitid: 'F1' }];
    const incoming = [
      { date: '2026-10-01', amount: -450, desc: 'coffee', fitid: '' },
      { date: '2026-10-01', amount: -450, desc: 'COFFEE', fitid: '' },
      { date: '2026-10-09', amount: -100, desc: 'renamed', fitid: 'F1' },
      { date: '2026-10-03', amount: 5, desc: 'NEW', fitid: '' },
    ];
    const { fresh, duplicates } = dedupe(incoming, existing);
    expect(duplicates).toBe(2);
    expect(fresh.map((l) => l.desc)).toEqual(['COFFEE', 'NEW']);
  });
  it('recognizes a statement imported as CSV and then again as OFX, and the other way round', () => {
    const csv = [
      { date: '2026-10-01', amount: -450, desc: 'COFFEE SHOP PORTLAND OR', fitid: '' },
      { date: '2026-10-01', amount: -450, desc: 'COFFEE SHOP PORTLAND OR', fitid: '' },
      { date: '2026-10-02', amount: 50000, desc: 'PAYROLL ACME', fitid: '' },
    ];
    const ofx = [
      { date: '2026-10-01', amount: -450, desc: 'COFFEE SHOP', fitid: 'A1' },
      { date: '2026-10-01', amount: -450, desc: 'COFFEE SHOP', fitid: 'A2' },
      { date: '2026-10-01', amount: -450, desc: 'COFFEE SHOP', fitid: 'A3' }, // a third one the CSV did not have
      { date: '2026-10-02', amount: 50000, desc: 'PAYROLL', fitid: 'A4' },
    ];
    const a = dedupe(ofx, csv);
    expect(a.duplicates).toBe(3);
    expect(a.fresh.map((l) => l.fitid)).toEqual(['A3']);
    const b = dedupe(csv, ofx.slice(0, 2));
    expect(b.duplicates).toBe(2);
    expect(b.fresh.map((l) => l.desc)).toEqual(['PAYROLL ACME']);
  });
});
