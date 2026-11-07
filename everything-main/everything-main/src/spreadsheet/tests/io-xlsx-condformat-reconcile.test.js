import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { conditionalFormatSignature, reconcileConditionalFormats } from '../src/core/xlsx-condformat-reconcile.js';
import * as X from '../src/vendor/xlsx.mjs';

const range = { r1: 2, c1: 1, r2: 6, c2: 1 };
const make = () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [1, 2, 3, 4, 5].map((v, i) => ({ r: i + 2, c: 1, cell: { v } })));
  wb.addRule(id, { type: 'gt', range, value: 2, style: { bg: '#ff0000' }, stopIfTrue: false });
  return wb;
};
async function exportZip(wb) { return X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' }); }
const xml = (zip, path = 'xl/worksheets/sheet1.xml') => new TextDecoder().decode(X.CFB.find(zip, '/' + path).content);
const edit = (zip, change, path = 'xl/worksheets/sheet1.xml') => {
  const part = X.CFB.find(zip, '/' + path); part.content = new TextEncoder().encode(change(xml(zip, path))); part.size = part.content.length;
};
const reopen = zip => workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'edited.xlsx');
const look = (wb, r, c = 1) => wb.conditionalStyle(wb.activeSheetId, r, c, wb.getValue(wb.activeSheetId, r, c));

it('keeps unchanged editable app rules, ids and priorities after harmless native serialization changes', async () => {
  const wb = make();
  wb.addRule(wb.activeSheetId, { type: 'lt', range, value: 5, style: { bold: true } });
  const zip = await exportZip(wb);
  edit(zip, text => text.replace('priority="1"', 'priority="10"').replace('priority="2"', 'priority="20"'));
  const back = await reopen(zip);
  expect(back.activeSheet.rules).toEqual(wb.activeSheet.rules);
});

it('adopts native formula, range, stop and differential-style edits and keeps them through the next save', async () => {
  const wb = make(), zip = await exportZip(wb);
  edit(zip, text => text.replace('sqref="B3:B7"', 'sqref="B4:B6"').replace(/<formula>[^]*?<\/formula>/, '<formula>B4&gt;3</formula>').replace('stopIfTrue="0"', 'stopIfTrue="1"'));
  edit(zip, text => text.replace('FFFF0000', 'FF00AA00'), 'xl/styles.xml');
  let back = await reopen(zip);
  expect(back.activeSheet.rules[0]).toMatchObject({ type: 'formula', value: 'B4>3', range: { r1: 3, c1: 1, r2: 5, c2: 1 }, stopIfTrue: true, style: { bg: '#00aa00' } });
  expect(look(back, 4)).toBeNull(); expect(look(back, 5)).toEqual({ bg: '#00aa00' }); expect(look(back, 6)).toBeNull();
  back = await reopen(await exportZip(back)); expect(look(back, 5)).toEqual({ bg: '#00aa00' });
});

it('honors native deletion and addition even when a stale sidecar has rules', async () => {
  const zip = await exportZip(make());
  edit(zip, text => text.replace(/<conditionalFormatting\b[^]*?<\/conditionalFormatting>/g, ''));
  expect((await reopen(zip)).activeSheet.rules).toEqual([]);
  edit(zip, text => text.replace('</worksheet>', '<conditionalFormatting sqref="B3:B7"><cfRule type="expression" priority="1" dxfId="0"><formula>B3=1</formula></cfRule></conditionalFormatting></worksheet>'));
  const back = await reopen(zip); expect(back.activeSheet.rules).toHaveLength(1);
  expect(look(back, 2)).toEqual({ bg: '#ff0000' }); expect(look(back, 3)).toBeNull();
});

it('follows externally reordered rules while preserving private-only rules by their surviving neighbors', async () => {
  const wb = make(), id = wb.activeSheetId;
  wb.addRule(id, { type: 'bands', range, color1: '#123456', style: {} });
  wb.addRule(id, { type: 'lt', range, value: 5, style: { bg: '#0000ff' } });
  wb.addRule(id, { type: 'bands', range, style: {} });
  const zip = await exportZip(wb);
  edit(zip, text => text.replace('priority="1"', 'priority="4"').replace('priority="3"', 'priority="1"'));
  const back = await reopen(zip);
  expect(back.activeSheet.rules.map(r => r.id)).toEqual([wb.activeSheet.rules[1].id, wb.activeSheet.rules[2].id, wb.activeSheet.rules[3].id, wb.activeSheet.rules[0].id]);
  expect(look(back, 4)).toMatchObject({ bg: '#0000ff' });
});

it('keeps private-only rules after every native rule was deleted, without resurrecting deleted rules', async () => {
  const wb = make(); wb.addRule(wb.activeSheetId, { type: 'bands', range, color1: '#123456', color2: '#abcdef', style: {} });
  const zip = await exportZip(wb); edit(zip, text => text.replace(/<conditionalFormatting\b[^]*?<\/conditionalFormatting>/g, ''));
  const back = await reopen(zip); expect(back.activeSheet.rules).toEqual([wb.activeSheet.rules[1]]);
  expect((await reopen(await exportZip(back))).activeSheet.rules).toEqual(back.activeSheet.rules);
});

it('reconciles extended data bars from the native extension, ignoring regenerated GUIDs', async () => {
  const wb = make(), id = wb.activeSheetId;
  wb.addRule(id, { type: 'databar', barMode: 'extended', range, style: {}, barMinLength: 0, barMaxLength: 100 });
  const zip = await exportZip(wb);
  edit(zip, text => text.replace(/\{[A-F0-9]{8}-(?:[A-F0-9]{4}-){3}[A-F0-9]{12}\}/g, '{12345678-1234-1234-1234-123456789ABC}'));
  expect((await reopen(zip)).activeSheet.rules).toEqual(wb.activeSheet.rules);
  edit(zip, text => text.replace('axisPosition="automatic"', 'axisPosition="middle"').replace('gradient="1"', 'gradient="0"'));
  const back = await reopen(zip);
  expect(back.activeSheet.rules[1]).toMatchObject({ barMode: 'extended', barAxisPosition: 'middle', barGradient: false });
});

it('does not restore missing areas from a partially deleted grouped native duplicate rule', async () => {
  const wb = make(), id = wb.activeSheetId;
  wb.deleteRule(id, wb.activeSheet.rules[0].id);
  for (const g of [{ r1: 2, c1: 1, r2: 3, c2: 1 }, { r1: 5, c1: 1, r2: 6, c2: 1 }]) {
    wb.addRule(id, { type: 'dup', range: g, duplicateRange: '($B$3:$B$4,$B$6:$B$7)', style: { bold: true }, stopIfTrue: false });
  }
  const zip = await exportZip(wb); expect(xml(zip)).toContain('type="duplicateValues"');
  expect((await reopen(zip)).activeSheet.rules).toEqual(wb.activeSheet.rules);
  edit(zip, text => text.replace('sqref="B3:B4 B6:B7"', 'sqref="B3:B4"'));
  const back = await reopen(zip); expect(back.activeSheet.rules).toHaveLength(1);
  expect(back.activeSheet.rules[0].range).toEqual({ r1: 2, c1: 1, r2: 3, c2: 1 });
  expect(back.activeSheet.rules[0].duplicateRange).not.toContain('B6');
});

it('retains theme color identities when calculating the native baseline', async () => {
  const wb = make(), id = wb.activeSheetId;
  wb.updateRule(id, wb.activeSheet.rules[0].id, { style: { color: { theme: 4, base: '#4f81bd', rgb: '#4f81bd' } } });
  expect((await reopen(await exportZip(wb))).activeSheet.rules).toEqual(wb.activeSheet.rules);
});

it.each([
  [{ type: 'scale', from: '#000000', to: '#ffffff' }, text => text.replace('rgb="FFFFFFFF"', 'rgb="FF00FF00"'), { type: 'scale', to: '#00ff00' }],
  [{ type: 'databar', barMode: 'legacy', barColor: '#123456' }, text => text.replace('showValue="1"', 'showValue="0"'), { type: 'databar', barMode: 'legacy', barOnly: true }],
])('adopts supported native visual-rule edits for $0.type', async (rule, change, expected) => {
  const wb = make(), id = wb.activeSheetId;
  wb.deleteRule(id, wb.activeSheet.rules[0].id); wb.addRule(id, { ...rule, range, style: {} });
  const zip = await exportZip(wb); edit(zip, change);
  expect((await reopen(zip)).activeSheet.rules[0]).toMatchObject(expected);
});

it('preserves legacy sidecars without native baselines and additions to newly saved empty sheets', async () => {
  const wb = make(), zip = await exportZip(wb);
  // An unrecognized property is ignored, just as a missing old baseline is.
  edit(zip, text => text.replaceAll('nativeConditionalFormats', 'unrecognizedBaseline'), 'xl/worksheets/sheet2.xml');
  expect(xml(zip, 'xl/worksheets/sheet2.xml')).not.toContain('nativeConditionalFormats');
  edit(zip, text => text.replace(/<conditionalFormatting\b[^]*?<\/conditionalFormatting>/g, ''));
  expect((await reopen(zip)).activeSheet.rules).toEqual(wb.activeSheet.rules);
  const empty = await exportZip(new Workbook());
  edit(empty, text => text.replace('</worksheet>', '<conditionalFormatting sqref="C3"><cfRule type="expression" priority="1"><formula>TRUE</formula></cfRule></conditionalFormatting></worksheet>'));
  expect((await reopen(empty)).activeSheet.rules[0]).toMatchObject({ type: 'formula', value: 'TRUE' });
});

it('keeps chunked Unicode metadata and validation helper columns when writing the baseline', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data 😀 _x0041_', rules: Array.from({ length: 500 }, (_, i) => ({
    id: `rule-${i}-😀`, type: 'icons', range: { r1: i, c1: 2, r2: i, c2: 2 }, set: 'stars', style: {},
  })), validations: [{ type: 'list', source: ['Comma, inside', 'Résumé 😀', '_x0041_'], range, strict: true }] }] });
  const zip = await exportZip(wb);
  expect(xml(zip, 'xl/worksheets/sheet2.xml')).toContain('r="A2"');
  const back = await reopen(zip);
  expect(back.activeSheet.name).toBe(wb.activeSheet.name);
  expect(back.activeSheet.rules).toEqual(wb.activeSheet.rules);
  expect(back.listOptionsFor(back.activeSheetId, back.activeSheet.validations[0], { typed: true })).toEqual(['Comma, inside', 'Résumé 😀', '_x0041_']);
});

it('matches duplicate native projections one-to-one and rejects malformed baselines', async () => {
  const nativeRule = { type: 'formula', value: 'TRUE', range, style: {} };
  const saved = [{ ...nativeRule, id: 'first' }, { ...nativeRule, id: 'second' }];
  const signature = await conditionalFormatSignature(nativeRule);
  const entries = saved.map((_, start) => ({ start, end: start, signatures: [signature] }));
  expect(await reconcileConditionalFormats(saved, { version: 1, entries }, [nativeRule])).toEqual([saved[0]]);
  for (const bad of [null, {}, { version: 99, entries }, { version: 1, entries: [entries[0], entries[0]] }, { version: 1, entries: [{ ...entries[0], end: 5 }] }]) {
    expect(await reconcileConditionalFormats(saved, bad, [])).toBe(saved);
  }
});
