import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { FUNCTION_NAMES } from '../src/core/formula/functions.js';
import { signatureFor } from '../src/core/formula/hints.js';

const calc = (formula, setup = () => {}) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  setup(wb, id);
  wb.setInput(id, 40, 10, `=${formula}`);
  const v = wb.getValue(id, 40, 10);
  return v && v.error ? v.error : v;
};

// Every expected value below was checked against desktop Excel for the same formula.
it.each([
  ['AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0.15,1)', 360],
  ['AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,0,0.15,1)', 131.803278688525],
  ['AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,6,0.15,1)', 168.196721311475],
  ['AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,7,0.15,0)', 0],
  ['AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0.15,1)', 776],
  ['AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,0,0.15,1)', 330],
  ['AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,6,0.15,0)', 0],
  ['AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0.4,1)', 937],
  ['AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,2,0.4,1)', 937],
  ['AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0.22,1)', 886],
  ['AMORDEGRC(10000,DATE(2020,3,1),DATE(2020,12,31),500,3,0.1,3)', 1112],
  ['AMORDEGRC(10000,DATE(2020,3,1),DATE(2020,12,31),500,8,0.1,3)', 528],
  ['AMORDEGRC(10000,DATE(2020,3,1),DATE(2020,12,31),500,10,0.1,3)', 0],
  ['AMORDEGRC(1000,DATE(2020,1,1),DATE(2020,7,1),600,2,0.1,0)', 164],
  ['AMORDEGRC(1000,DATE(2020,1,1),DATE(2020,7,1),600,3,0.1,0)', 0],
  ['AMORDEGRC(1000,DATE(2020,1,1),DATE(2020,7,1),0,5,0.15,0)', 62],
  ['AMORDEGRC(1000,DATE(2020,1,1),DATE(2020,7,1),0,0,0.35,0)', 263],
  ['ODDFPRICE(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0785,0.0625,100,2,1)', 113.597717474079],
  ['ODDFPRICE(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0785,0.0625,100,2,0)', 113.599205828238],
  ['ODDFPRICE(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,1,15),DATE(2009,3,1),0.0785,0.0625,100,2,1)', 113.48894083961],
  ['ODDFPRICE(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,1,15),DATE(2009,3,1),0.0785,0.0625,100,1,3)', 113.387897714873],
  ['ODDFYIELD(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0575,84.5,100,2,0)', 0.077245541597],
  ['ODDFYIELD(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,1,15),DATE(2009,3,1),0.0575,84.5,100,2,1)', 0.077108234586],
  ['ODDLPRICE(DATE(2008,2,7),DATE(2008,6,15),DATE(2007,10,15),0.0375,0.0405,100,2,0)', 99.878286014721],
  ['ODDLPRICE(DATE(2008,2,7),DATE(2009,6,15),DATE(2007,10,15),0.0375,0.0405,100,4,0)', 99.553780769109],
  ['ODDLYIELD(DATE(2008,4,20),DATE(2008,6,15),DATE(2007,12,24),0.0375,99.875,100,2,0)', 0.045192235629],
  ['ODDLYIELD(DATE(2008,4,20),DATE(2009,6,15),DATE(2007,12,24),0.0375,99.875,100,2,1)', 0.038170476059],
])('%s matches Excel', (formula, expected) => {
  expect(calc(formula)).toBeCloseTo(expected, 9);
});

it.each([
  ['AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,3,0.15,2)', '#NUM!'],
  ['AMORDEGRC(1000,DATE(2020,1,1),DATE(2020,7,1),0,0,0.5,0)', '#NUM!'],
  ['BAHTTEXT(1234.56)', 'หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบหกสตางค์'],
  ['BAHTTEXT(101)', 'หนึ่งร้อยเอ็ดบาทถ้วน'],
  ['BAHTTEXT(21)', 'ยี่สิบเอ็ดบาทถ้วน'],
  ['BAHTTEXT(11)', 'สิบเอ็ดบาทถ้วน'],
  ['BAHTTEXT(0.5)', 'ห้าสิบสตางค์'],
  ['BAHTTEXT(-5)', 'ลบห้าบาทถ้วน'],
  ['BAHTTEXT(0)', 'ศูนย์บาทถ้วน'],
  ['BAHTTEXT(1000001.01)', 'หนึ่งล้านเอ็ดบาทหนึ่งสตางค์'],
  ['BAHTTEXT(2111111111)', 'สองพันหนึ่งร้อยสิบเอ็ดล้านหนึ่งแสนหนึ่งหมื่นหนึ่งพันหนึ่งร้อยสิบเอ็ดบาทถ้วน'],
  ['ASC("ＡＢＣ１２３")', 'ＡＢＣ１２３'],
  ['DBCS("ABC")', 'ABC'],
  ['PHONETIC(A1)', '#N/A'],
  ['CUBEVALUE("x","y")', '#N/A'],
  ['RTD("a","b","c")', '#N/A'],
  ['STOCKHISTORY("MSFT",DATE(2024,1,2))', '#CONNECT!'],
])('%s gives %s', (formula, expected) => {
  expect(calc(formula, (wb, id) => wb.setInput(id, 0, 0, 'Item'))).toBe(expected);
});

it('knows every Excel function, apart from the ones Excel itself no longer accepts in a cell', () => {
  const excelOnly = ['CALL', 'REGISTER.ID', 'EUROCONVERT'];
  for (const name of ['AMORDEGRC', 'AMORLINC', 'ASC', 'BAHTTEXT', 'DBCS', 'JIS', 'PHONETIC', 'GETPIVOTDATA', 'ODDFPRICE', 'ODDFYIELD',
    'ODDLPRICE', 'ODDLYIELD', 'WEBSERVICE', 'STOCKHISTORY', 'RTD', 'CUBEVALUE', 'CUBEMEMBER', 'CUBESET', 'CUBESETCOUNT',
    'CUBERANKEDMEMBER', 'CUBEMEMBERPROPERTY', 'CUBEKPIMEMBER']) {
    expect(FUNCTION_NAMES).toContain(name);
    expect(signatureFor(name)).toBeTruthy();
  }
  for (const name of excelOnly) expect(FUNCTION_NAMES).not.toContain(name);
});

const grid = (wb, id, rows, r0 = 0, c0 = 0) => rows.forEach((row, r) => row.forEach((v, c) => { if (v !== null) wb.setInput(id, r0 + r, c0 + c, String(v)); }));

it('GETPIVOTDATA reads a pivot laid out as this app builds one', () => {
  const pivot = (wb, id) => grid(wb, id, [
    ['Region', 'Sum of Sales'],
    ['East', 120],
    ['West', 80],
    ['Total', 200],
  ], 2, 0);
  expect(calc('GETPIVOTDATA("Sales",A3)', pivot)).toBe(200);
  expect(calc('GETPIVOTDATA("Sales",A3,"Region","West")', pivot)).toBe(80);
  expect(calc('GETPIVOTDATA("Sum of Sales",$A$3,"Region","east")', pivot)).toBe(120);
  expect(calc('GETPIVOTDATA("Sales",A3,"Region","North")', pivot)).toBe('#REF!');
  expect(calc('GETPIVOTDATA("Cost",A3)', pivot)).toBe('#REF!');
});

it('GETPIVOTDATA reads Excel\'s compact layout with a column field', () => {
  const pivot = (wb, id) => grid(wb, id, [
    ['Sum of Sales', 'Column Labels', null, null],
    ['Row Labels', 'Q1', 'Q2', 'Grand Total'],
    ['East', 50, 70, 120],
    ['West', 30, 50, 80],
    ['Grand Total', 80, 120, 200],
  ], 0, 0);
  expect(calc('GETPIVOTDATA("Sales",A1)', pivot)).toBe(200);
  expect(calc('GETPIVOTDATA("Sales",A1,"Quarter","Q2")', pivot)).toBe(120);
  expect(calc('GETPIVOTDATA("Sales",A1,"Region","West")', pivot)).toBe(80);
  expect(calc('GETPIVOTDATA("Sales",A1,"Region","West","Quarter","Q1")', pivot)).toBe(30);
});

it('WEBSERVICE fetches through the workbook\'s provider and counts as reaching outside the file', async () => {
  const { formulaReachesOut } = await import('../src/core/reaches-out.js');
  expect(formulaReachesOut('=WEBSERVICE("https://example.com")')).toBe(true);
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setAsyncProvider('WEBSERVICE', async (url) => `got ${url}`);
  wb.setInput(id, 0, 0, '=WEBSERVICE("https://example.com/a")');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#BUSY!' });
  await new Promise((r) => setTimeout(r, 20));
  expect(wb.getValue(id, 0, 0)).toBe('got https://example.com/a');
  wb.setInput(id, 1, 0, '=WEBSERVICE("ftp://example.com")');
  expect(wb.getValue(id, 1, 0)).toEqual({ error: '#VALUE!' });
});
