import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { TEMPLATES } from '../src/core/templates.js';

// Pressing OK in a dialog without changing anything sent the unchanged object back through update*,
// which pushed an undo step and dirtied the document for nothing; updateChart already compared first.
describe('updating a table, rule, validation or protected range with what it already holds', () => {
  const book = () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'Name');
    wb.setInput(id, 1, 0, 'a');
    const table = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { name: 'Sales' });
    const rule = wb.addRule(id, { type: 'gt', range: { r1: 0, c1: 2, r2: 5, c2: 2 }, value: 3, style: { bold: true } });
    const validation = wb.addValidation(id, { type: 'list', range: { r1: 0, c1: 3, r2: 5, c2: 3 }, source: 'a,b' });
    const protectedRange = wb.protectRange(id, { r1: 8, c1: 0, r2: 8, c2: 3 }, 'totals');
    wb.markClean();
    return { wb, id, table, rule, validation, protectedRange, steps: () => wb.undoLabels(50).length };
  };

  it('records no step and leaves the document clean', () => {
    const { wb, id, table, rule, validation, protectedRange, steps } = book();
    const before = steps();
    const { version } = wb;
    expect(wb.updateTable(id, table, { name: 'Sales', style: 'blue', banded: true, totalsRow: false })).toBe(true);
    expect(wb.updateRule(id, rule, { type: 'gt', value: 3, style: { bold: true }, range: { r1: 0, c1: 2, r2: 5, c2: 2 } })).toBe(true);
    expect(wb.updateValidation(id, validation, { type: 'list', source: 'a,b' })).toBe(true);
    wb.updateProtectedRange(id, protectedRange, { description: 'totals', range: { r1: 8, c1: 0, r2: 8, c2: 3 } });
    expect(steps()).toBe(before);
    expect(wb.version).toBe(version);
    expect(wb.dirty).toBe(false);
  });

  it('still records a step for a real change', () => {
    const { wb, id, table, rule, validation, protectedRange, steps } = book();
    const before = steps();
    wb.updateTable(id, table, { style: 'green' });
    wb.updateRule(id, rule, { value: 4 });
    wb.updateValidation(id, validation, { source: 'a,b,c' });
    wb.updateProtectedRange(id, protectedRange, { description: 'sums' });
    expect(steps()).toBe(before + 4);
    expect(wb.dirty).toBe(true);
    expect(wb.undoLabels(4)).toEqual(['Edit protected range', 'Edit validation', 'Edit rule', 'Edit table']);
  });
});

// The comparison was made on the serialised objects, so it could not see that the patch was the stored
// rule plus keys it simply lacked — which is what a dialog writing out every field of its form hands in.
// Keys are now read against the defaults the rule's own readers assume, so any caller gets the no-op right.
describe('a patch that spells out defaults the stored rule leaves out', () => {
  const validationForm = (v) => ({
    range: v.range, type: v.type, source: v.source,
    chips: v.chips || undefined, colors: v.colors,
    min: v.min ?? null, max: v.max ?? null,
    strict: v.strict !== false, allowBlank: v.allowBlank !== false,
    message: v.message || undefined, prompt: v.prompt || undefined,
  });

  const ruleForm = (r) => ({
    range: r.range, type: r.type, value: r.value, value2: r.value2, style: { ...(r.style || {}) },
    ...(r.type === 'icons' ? { set: r.set || 'arrows', lo: r.lo ?? 33, hi: r.hi ?? 67, iconOnly: !!r.iconOnly } : {}),
    ...(r.type === 'scale' ? { from: r.from || '#ffffff', to: r.to || '#4a8dff', mid: r.mid } : {}),
    ...(r.type === 'databar' ? { barColor: r.barColor || '#8fb8ff' } : {}),
    ...(r.type === 'bands' ? { color1: r.color1, color2: r.color2, headerColor: r.headerColor || r.color1 || '#e0ecff', header: r.header !== false } : {}),
  });

  it('records no step for a validation rule, and writes none of the keys in', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const vid = wb.addValidation(id, { range: { r1: 0, c1: 0, r2: 4, c2: 0 }, type: 'list', source: 'a, b', strict: false });
    const before = { ...wb.sheet(id).validations[0] };
    wb.markClean();
    const steps = wb.undoLabels(50).length;
    expect(wb.updateValidation(id, vid, validationForm(before))).toBe(true);
    expect({ dirty: wb.dirty, steps: wb.undoLabels(50).length }).toEqual({ dirty: false, steps });
    expect(wb.sheet(id).validations[0]).toEqual(before);
  });

  it('records no step for an alternating-colours rule whose header colour is its first band', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const rid = wb.addRule(id, { range: { r1: 0, c1: 0, r2: 9, c2: 7 }, type: 'bands', style: {}, header: false, color1: '#f7f7f5', color2: '#ffffff' });
    const before = { ...wb.sheet(id).rules[0] };
    wb.markClean();
    const steps = wb.undoLabels(50).length;
    expect(wb.updateRule(id, rid, ruleForm(before))).toBe(true);
    expect({ dirty: wb.dirty, steps: wb.undoLabels(50).length }).toEqual({ dirty: false, steps });
    expect(wb.sheet(id).rules[0]).toEqual(before);
  });

  it('leaves a rule that carries no style at all without one', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const rid = wb.addRule(id, { range: { r1: 0, c1: 1, r2: 2, c2: 1 }, type: 'gt', value: 5 });
    delete wb.sheet(id).rules[0].style; // as a rule handed in from outside the app may arrive
    wb.markClean();
    expect(wb.updateRule(id, rid, { range: { r1: 0, c1: 1, r2: 2, c2: 1 }, type: 'gt', value: 5, value2: undefined, style: {} })).toBe(true);
    expect({ dirty: wb.dirty, style: 'style' in wb.sheet(id).rules[0] }).toEqual({ dirty: false, style: false });
  });

  it('leaves every built-in template clean when each of its rules is opened and saved unchanged', () => {
    for (const template of TEMPLATES) {
      const wb = template.build();
      const before = JSON.stringify(wb.sheets.map((s) => [s.rules, s.validations]));
      for (const sheet of wb.sheets) {
        for (const rule of [...sheet.rules]) expect(wb.updateRule(sheet.id, rule.id, ruleForm(rule))).toBe(true);
        for (const v of [...sheet.validations]) expect(wb.updateValidation(sheet.id, v.id, validationForm(v))).toBe(true);
      }
      expect({ id: template.id, dirty: wb.dirty, canUndo: wb.canUndo() }).toEqual({ id: template.id, dirty: false, canUndo: false });
      expect(JSON.stringify(wb.sheets.map((s) => [s.rules, s.validations]))).toBe(before);
    }
  });
});
