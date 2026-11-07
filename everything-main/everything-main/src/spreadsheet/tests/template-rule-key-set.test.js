import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../src/core/templates.js';

// The templates built their validation and conditional-format rules with a smaller key set than the
// dialogs write: no allowBlank on a validation, no headerColor on an alternating-colours rule. Opening
// such a rule in its dialog and pressing Save with nothing changed then wrote those keys in, recording an
// undo step and marking a freshly opened template unsaved.
const built = TEMPLATES.map((t) => ({ id: t.id, wb: t.build() }));
const rulesOf = (wb) => wb.sheets.flatMap((s) => s.rules.map((r) => ({ sheet: s.name, r })));
const validationsOf = (wb) => wb.sheets.flatMap((s) => s.validations.map((v) => ({ sheet: s.name, v })));

describe('built-in templates write the keys their dialogs write', () => {
  it('gives every validation rule an explicit allowBlank', () => {
    const missing = built.flatMap(({ id, wb }) => validationsOf(wb)
      .filter(({ v }) => v.allowBlank === undefined)
      .map(({ sheet, v }) => `${id}/${sheet} ${v.type}`));
    expect(missing).toEqual([]);
  });

  it('gives every alternating-colours rule an explicit headerColor', () => {
    const missing = built.flatMap(({ id, wb }) => rulesOf(wb)
      .filter(({ r }) => r.type === 'bands' && r.headerColor === undefined)
      .map(({ sheet, r }) => `${id}/${sheet} ${r.type}`));
    expect(missing).toEqual([]);
  });

  it('leaves every template clean and with nothing to undo, rules and all', () => {
    for (const { id, wb } of built) {
      expect({ id, dirty: wb.dirty, canUndo: wb.canUndo() }).toEqual({ id, dirty: false, canUndo: false });
    }
  });

  it('still carries the rules the templates are built around', () => {
    const todo = built.find((t) => t.id === 'todo').wb;
    expect(validationsOf(todo).map(({ v }) => v.type)).toEqual(['checkbox', 'list', 'date']);
    expect(rulesOf(todo).map(({ r }) => r.type)).toEqual(['formula', 'formula', 'eq']);
    const schedule = built.find((t) => t.id === 'schedule').wb;
    expect(rulesOf(schedule).map(({ r }) => [r.type, r.header, r.color1, r.color2])).toEqual([['bands', false, '#f7f7f5', '#ffffff']]);
  });
});
