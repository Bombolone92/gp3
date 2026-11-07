import { describe, it, expect } from 'vitest';
import { TEMPLATES, CATEGORIES, buildTemplate, templateInfo, searchTemplates } from '../src/model/templates/index.js';
import { single, long, page, buildTemplate as build } from '../src/model/templates/dsl.js';
import { normalizeSurvey, lintQuestion, allQuestions } from '../src/model/survey.js';
import { validateResponse } from '../src/shared/runtime.js';

const EM_DASH = /—/;

function strings(survey) {
  const out = [survey.title, survey.description, survey.options.thankYou.title, survey.options.thankYou.message];
  for (const p of survey.pages) {
    out.push(p.title, p.description);
    for (const q of p.questions) {
      out.push(q.title, q.description);
      for (const list of [q.choices, q.rows, q.columns, Array.isArray(q.fields) ? q.fields : []]) {
        for (const c of list || []) out.push(c.label);
      }
    }
  }
  return out.filter(Boolean);
}

describe('template gallery', () => {
  it('has at least 20 templates with unique ids in known categories', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    const cats = new Set(CATEGORIES.map((c) => c.id));
    for (const t of TEMPLATES) expect(cats.has(t.category), t.id).toBe(true);
    for (const c of CATEGORIES) expect(TEMPLATES.some((t) => t.category === c.id), c.id).toBe(true);
  });

  for (const def of TEMPLATES) {
    describe(def.name, () => {
      const s = buildTemplate(def);

      it('survives normalization unchanged', () => {
        expect(normalizeSurvey(s)).toEqual(s);
        expect(s.title).toBe(def.name);
        const defined = def.pages.reduce((n, p) => n + p.questions.length, 0);
        expect(allQuestions(s)).toHaveLength(defined);
      });

      it('has no lint issues', () => {
        for (const q of allQuestions(s)) expect(lintQuestion(q), `${def.id}: ${q.title}`).toEqual([]);
      });

      it('keeps its logic after normalization', () => {
        const withShowIf = def.pages.flatMap((p) => p.questions).filter((q) => q.showIf).length;
        const withSkip = def.pages.flatMap((p) => p.questions).filter((q) => q.skip).length;
        expect(allQuestions(s).filter((q) => q.display)).toHaveLength(withShowIf);
        expect(allQuestions(s).filter((q) => q.logic)).toHaveLength(withSkip);
      });

      it('uses no em dashes', () => {
        for (const str of strings(s)) expect(EM_DASH.test(str), str).toBe(false);
        expect(EM_DASH.test(def.summary)).toBe(false);
      });

      it('accepts an empty response unless something is required', () => {
        const r = validateResponse(s, {});
        const required = allQuestions(s).some((q) => q.required);
        expect(r.ok).toBe(!required);
      });
    });
  }

  it('builds fresh ids every time', () => {
    const a = buildTemplate(TEMPLATES[0]);
    const b = buildTemplate(TEMPLATES[0]);
    expect(a.id).not.toBe(b.id);
    expect(a.pages[0].questions[0].id).not.toBe(b.pages[0].questions[0].id);
  });

  it('reports listing info', () => {
    const info = templateInfo(TEMPLATES[0]);
    expect(info.questions).toBeGreaterThan(0);
    expect(info.minutes).toBeGreaterThanOrEqual(1);
  });

  it('searches names, summaries and questions', () => {
    expect(searchTemplates('exit').map((t) => t.id)).toContain('exit-interview');
    expect(searchTemplates('dietary').map((t) => t.id)).toContain('event-registration');
    expect(searchTemplates('', 'events').every((t) => t.category === 'events')).toBe(true);
    expect(searchTemplates('zzzz-nothing')).toEqual([]);
  });
});

describe('template DSL', () => {
  it('resolves showIf and skip labels to ids', () => {
    const s = build({
      name: 'T',
      pages: [
        page('A', [single('Go on?', ['Yes', 'No'], { key: 'go', skip: { No: 'end' } }), long('Why?', { showIf: ['go', 'is', 'Yes'] })]),
        page('B', [long('More')], { key: 'b' }),
      ],
    });
    const [q1, q2] = s.pages[0].questions;
    const no = q1.choices.find((c) => c.label === 'No').id;
    const yes = q1.choices.find((c) => c.label === 'Yes').id;
    expect(q1.logic).toEqual({ [no]: { type: 'end' } });
    expect(q2.display).toEqual({ qid: q1.id, op: 'is', value: yes });
    expect(q1.key).toBeUndefined();
  });

  it('throws on typos so broken templates fail tests', () => {
    expect(() => build({ name: 'T', pages: [page('', [long('x', { showIf: ['missing', 'is', 'Yes'] })])] })).toThrow(/Unknown question key/);
    expect(() => build({ name: 'T', pages: [page('', [single('x', ['A'], { skip: { B: 'end' } })])] })).toThrow(/no answer "B"/);
    expect(() => build({ name: 'T', pages: [page('', [single('x', 'nosuchpreset')])] })).toThrow(/Unknown answer preset/);
  });
});
