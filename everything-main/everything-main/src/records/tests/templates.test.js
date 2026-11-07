import { describe, it, expect } from 'vitest';
import { TEMPLATES, buildTemplate } from '../src/data/templates.js';
import { Base } from '../src/data/base.js';
import { runView } from '../src/data/query.js';

describe('templates', () => {
  for (const tpl of TEMPLATES) {
    it(`${tpl.name} builds with working views and computed fields`, () => {
      const { doc, records } = buildTemplate(tpl);
      const base = new Base(structuredClone(doc), structuredClone(records));
      for (const t of base.tableList()) {
        expect(t.records.size).toBeGreaterThan(0);
        for (const v of t.views) expect(() => runView(base, t, v)).not.toThrow();
        for (const f of t.fields) {
          for (const r of t.records.values()) {
            const v = base.compute.value(t, r, f);
            expect(v?.error, `${t.name}.${f.name}`).toBeUndefined();
          }
        }
      }
    });
  }

  it('links templates both ways', () => {
    const { doc, records } = buildTemplate(TEMPLATES[0]);
    const base = new Base(doc, records);
    const projects = base.tableList()[0];
    const tasks = projects.fieldByName('Tasks');
    const web = projects.ordered()[0];
    expect(web.c[tasks.id].length).toBe(3);
    expect(base.compute.value(projects, web, projects.fieldByName('Progress'))).toBe('33%');
  });
});
