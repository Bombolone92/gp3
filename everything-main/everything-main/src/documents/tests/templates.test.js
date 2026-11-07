import { describe, it, expect } from 'vitest';
import { TEMPLATES, templateById, applyTemplate, today } from '../src/lib/templates.js';

function fakeApi({ blocks = [{ nodeId: 'p0', isEmpty: true }] } = {}) {
  const calls = [];
  let n = 0;
  const ok = (name, extra = () => ({})) => async (input) => { calls.push([name, input]); return { success: true, ...extra(input) }; };
  return {
    calls,
    blocks: { list: async () => ({ blocks }), delete: ok('delete') },
    create: {
      paragraph: ok('paragraph', () => ({ paragraph: { kind: 'block', nodeType: 'paragraph', nodeId: `p${++n}` } })),
      heading: ok('heading', () => ({ heading: { kind: 'block', nodeType: 'heading', nodeId: `h${++n}` } })),
      table: ok('table', () => ({ table: { kind: 'block', nodeType: 'table', nodeId: 'tbl:1' } })),
    },
    styles: { paragraph: { setStyle: ok('style') } },
    lists: { apply: ok('list') },
    tables: { setCellText: ok('cell') },
  };
}

describe('templates', () => {
  it('has distinct ids, names, and block lists', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const t of TEMPLATES) {
      expect(t.name).toBeTruthy();
      expect(t.blocks().length).toBeGreaterThan(3);
    }
    expect(templateById('letter').name).toBe('Letter');
    expect(templateById('nope')).toBeNull();
    expect(today(new Date(2026, 7, 27))).toMatch(/2026/);
  });

  it('creates every block kind at the end and drops the blank first paragraph', async () => {
    const api = fakeApi();
    const template = { id: 't', name: 'T', blocks: () => [
      { kind: 'title', text: 'T' }, { kind: 'subtitle', text: 'S' }, { kind: 'heading', level: 2, text: 'H' },
      { kind: 'paragraph', text: 'P' }, { kind: 'bullets', items: ['a', 'b'] }, { kind: 'numbers', items: ['1'] },
      { kind: 'table', rows: [['A', 'B'], ['', 'D']] },
    ] };
    expect(await applyTemplate(api, template)).toBe(7);
    const kinds = api.calls.map((c) => c[0]);
    expect(kinds).toEqual(['paragraph', 'style', 'paragraph', 'style', 'heading', 'paragraph', 'paragraph', 'list', 'paragraph', 'list', 'paragraph', 'list', 'table', 'cell', 'cell', 'cell', 'delete']);
    expect(api.calls[1][1]).toMatchObject({ styleId: 'Title' });
    expect(api.calls[3][1]).toMatchObject({ styleId: 'Subtitle' });
    expect(api.calls[4][1]).toEqual({ level: 2, text: 'H', at: { kind: 'documentEnd' } });
    expect(api.calls[7][1].seed).toBe('bullet');
    expect(api.calls[11][1].seed).toBe('ordered');
    expect(api.calls[12][1]).toEqual({ rows: 2, columns: 2, at: { kind: 'documentEnd' } });
    expect(api.calls[13][1]).toEqual({ nodeId: 'tbl:1', rowIndex: 0, columnIndex: 0, text: 'A' });
    expect(api.calls.at(-1)[1]).toEqual({ target: { kind: 'block', nodeType: 'paragraph', nodeId: 'p0' } });
  });

  it('keeps existing content and stops on a failure', async () => {
    const api = fakeApi({ blocks: [{ nodeId: 'p0', isEmpty: false }] });
    await applyTemplate(api, { blocks: [{ kind: 'paragraph', text: 'x' }] });
    expect(api.calls.map((c) => c[0])).toEqual(['paragraph']);
    api.create.heading = async () => ({ success: false, failure: { message: 'denied' } });
    await expect(applyTemplate(api, { blocks: [{ kind: 'heading', level: 1, text: 'x' }] })).rejects.toThrow('denied');
  });
});
