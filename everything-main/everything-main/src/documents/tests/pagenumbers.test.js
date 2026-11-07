import { describe, it, expect } from 'vitest';
import { pageNumberText, headerFooterStory, insertPageNumbers, PAGE_NUMBER_STYLES } from '../src/lib/pagenumbers.js';

function fakeApi({ sections = ['s0'], refs = {}, blocks = {}, flags = {} } = {}) {
  const calls = [];
  let n = 0;
  return {
    calls,
    sections: { list: async () => ({ items: sections.map((id) => ({ id, address: { kind: 'section', sectionId: id }, ...(flags[id] || {}) })) }) },
    headerFooters: { list: async () => ({ items: Object.entries(refs).map(([k, refId]) => { const [sectionId, kind, variant = 'default'] = k.split(':'); return { section: { kind: 'section', sectionId }, kind, variant, refId }; }) }) },
    blocks: { list: async ({ in: story }) => ({ blocks: blocks[`${story.section.sectionId}:${story.headerFooterKind}`] || [{ nodeId: 'empty', isEmpty: true }] }) },
    insert: async (input) => { calls.push(['insert', input.value, input.target.start.blockId]); return { success: true }; },
    create: { paragraph: async (input) => { calls.push(['create', input.text]); return { success: true, paragraph: { nodeId: `p${++n}` } }; } },
    fields: { insert: async (input) => { calls.push(['field', input.instruction, input.at.segments[0].blockId, input.at.segments[0].range.start, input.at.story.variant]); return { success: true }; } },
    format: { paragraph: { setAlignment: async (input) => { calls.push(['align', input.alignment, input.target.nodeId]); return { success: true }; } } },
  };
}

describe('page numbers', () => {
  it('describes both styles with fields placed later-first so offsets stay valid', () => {
    expect(PAGE_NUMBER_STYLES.map((s) => s.id)).toEqual(['number', 'pageOfTotal']);
    expect(pageNumberText('number')).toEqual({ text: '', fields: [{ offset: 0, instruction: 'PAGE' }] });
    const t = pageNumberText('pageOfTotal');
    expect(t.text).toBe('Page  of ');
    expect(t.fields.map((f) => f.instruction)).toEqual(['NUMPAGES', 'PAGE']);
    expect(headerFooterStory({ kind: 'section', sectionId: 'x' }, 'footer')).toMatchObject({ storyType: 'headerFooterSlot', headerFooterKind: 'footer', variant: 'default', onWrite: 'materializeIfInherited' });
  });

  it('reuses an empty footer paragraph and aligns it', async () => {
    const api = fakeApi();
    expect(await insertPageNumbers(api, { position: 'footer', alignment: 'center', style: 'number' })).toBe(1);
    expect(api.calls).toEqual([['field', 'PAGE', 'empty', 0, 'default'], ['align', 'center', 'empty']]);
  });

  it('takes a footer paragraph that is already aligned the way it should be as done', async () => {
    const api = fakeApi();
    // A template's empty footer paragraph often carries its alignment already; the engine reports that write as a no-op.
    api.format.paragraph.setAlignment = async () => ({ success: false, failure: { code: 'NO_OP', message: 'format.paragraph.setAlignment produced no changes.' } });
    const changes = [];
    expect(await insertPageNumbers(api, { position: 'footer', alignment: 'center', style: 'number' }, { onChange: () => changes.push(1) })).toBe(1);
    expect(api.calls).toEqual([['field', 'PAGE', 'empty', 0, 'default']]);
    expect(changes).toHaveLength(1);
    const refused = fakeApi();
    refused.format.paragraph.setAlignment = async () => ({ success: false, failure: { code: 'INVALID_TARGET', message: 'No such paragraph' } });
    await expect(insertPageNumbers(refused, { position: 'footer', alignment: 'center', style: 'number' })).rejects.toThrow('No such paragraph');
  });

  it('numbers the even pages too when the document gives them their own footer', async () => {
    const api = fakeApi({ flags: { s0: { oddEvenHeadersFooters: true } } });
    expect(await insertPageNumbers(api, { position: 'footer', alignment: 'center', style: 'number' })).toBe(2);
    expect(api.calls.filter(([kind]) => kind === 'field').map((call) => call[4])).toEqual(['default', 'even']);
  });

  it('numbers a first page that has its own footer unless it is meant to stay unnumbered', async () => {
    const api = fakeApi({ flags: { s0: { titlePage: true } } });
    expect(await insertPageNumbers(api, { position: 'footer', alignment: 'center', style: 'number' })).toBe(2);
    expect(api.calls.filter(([kind]) => kind === 'field').map((call) => call[4])).toEqual(['default', 'first']);
    const skipped = fakeApi({ flags: { s0: { titlePage: true } } });
    expect(await insertPageNumbers(skipped, { position: 'footer', alignment: 'center', style: 'number', skipFirst: true })).toBe(1);
    expect(skipped.calls.filter(([kind]) => kind === 'field').map((call) => call[4])).toEqual(['default']);
  });

  it('writes a shared even footer once across sections', async () => {
    const api = fakeApi({ sections: ['s0', 's1'], flags: { s0: { oddEvenHeadersFooters: true } }, refs: { 's0:footer': 'rId1', 's1:footer': 'rId1', 's0:footer:even': 'rId2', 's1:footer:even': 'rId2' } });
    expect(await insertPageNumbers(api, { position: 'footer', alignment: 'center', style: 'number' })).toBe(2);
  });

  it('adds a paragraph when the header already has content, seeding "Page  of "', async () => {
    const api = fakeApi({ blocks: { 's0:header': [{ nodeId: 'h', isEmpty: false }] } });
    await insertPageNumbers(api, { position: 'header', alignment: 'right', style: 'pageOfTotal' });
    expect(api.calls).toEqual([['create', 'Page  of '], ['field', 'NUMPAGES', 'p1', 9, 'default'], ['field', 'PAGE', 'p1', 5, 'default'], ['align', 'right', 'p1']]);
  });

  it('writes once per shared header part across sections', async () => {
    const api = fakeApi({ sections: ['s0', 's1', 's2'], refs: { 's0:header': 'rId1', 's1:header': 'rId1', 's2:header': 'rId2' } });
    expect(await insertPageNumbers(api, { position: 'header', alignment: 'left', style: 'number' })).toBe(2);
  });

  it('writes once when a later section shows the previous section\'s header', async () => {
    // Linked to the previous section: the slot lists no part of its own, but resolves to the shared one.
    const api = fakeApi({ sections: ['s0', 's1', 's2'], refs: { 's0:header': 'rId1', 's1:header': null, 's2:header': 'rId2' } });
    api.headerFooters.resolve = async ({ target }) => (target.section.sectionId === 's1' && target.headerFooterKind === 'header'
      ? { status: 'inherited', refId: 'rId1', resolvedFromSection: { kind: 'section', sectionId: 's0' }, resolvedVariant: 'default' }
      : { status: 'none' });
    expect(await insertPageNumbers(api, { position: 'header', alignment: 'left', style: 'pageOfTotal' })).toBe(2);
    expect(api.calls.filter(([kind]) => kind === 'insert' || kind === 'create')).toHaveLength(2);
  });

  it('numbers a shared header once when the first write creates it for every section', async () => {
    // No header exists yet. The engine creates the part on the first write and
    // makes every section that showed the (absent) header reference it.
    const api = fakeApi({ sections: ['s0', 's1', 's2'], refs: { 's0:header': null, 's1:header': null, 's2:header': null } });
    let created = false;
    api.headerFooters.list = async () => ({ items: ['s0', 's1', 's2'].map((sectionId) => ({ section: { kind: 'section', sectionId }, kind: 'header', variant: 'default', refId: created ? 'rId1' : null, isExplicit: created })) });
    api.headerFooters.resolve = async () => ({ status: created ? 'explicit' : 'none', refId: created ? 'rId1' : undefined });
    const field = api.fields.insert;
    api.fields.insert = async (input) => { created = true; return field(input); };
    expect(await insertPageNumbers(api, { position: 'header', alignment: 'center', style: 'number' })).toBe(1);
    expect(api.calls.filter(([kind]) => kind === 'field')).toHaveLength(1);
  });

  it('surfaces engine failures', async () => {
    const api = fakeApi();
    api.fields.insert = async () => ({ success: false, failure: { message: 'nope' } });
    await expect(insertPageNumbers(api, {})).rejects.toThrow('nope');
  });
});

import { firstPageDifferent, setFirstPageDifferent } from '../src/lib/pagenumbers.js';

describe('different first page', () => {
  it('reads the flag from the first section', () => {
    expect(firstPageDifferent([{ titlePage: true }])).toBe(true);
    expect(firstPageDifferent([{}])).toBe(false);
    expect(firstPageDifferent([])).toBe(false);
    expect(firstPageDifferent(null)).toBe(false);
  });

  it('sets the title page on the first section and surfaces failures', async () => {
    const calls = [];
    const api = {
      sections: {
        list: async () => ({ items: [{ id: 's0', address: { kind: 'section', sectionId: 's0' } }, { id: 's1' }] }),
        setTitlePage: async (input) => { calls.push(input); return { success: true }; },
      },
    };
    expect(await setFirstPageDifferent(api, true)).toBe(true);
    expect(await setFirstPageDifferent(api, false)).toBe(false);
    expect(calls).toEqual([{ target: { kind: 'section', sectionId: 's0' }, enabled: true }, { target: { kind: 'section', sectionId: 's0' }, enabled: false }]);
    api.sections.setTitlePage = async () => ({ success: false, failure: { message: 'nope' } });
    await expect(setFirstPageDifferent(api, true)).rejects.toThrow('nope');
    api.sections.list = async () => ({ items: [] });
    await expect(setFirstPageDifferent(api, true)).rejects.toThrow('no sections');
  });
});

describe('number format and start', () => {
  it('reads the first section, falling back to decimal from 1', async () => {
    const { currentNumbering, parseStartAt, PAGE_NUMBER_FORMATS } = await import('../src/lib/pagenumbers.js');
    expect(PAGE_NUMBER_FORMATS.map((f) => f.id)).toEqual(['decimal', 'lowerRoman', 'upperRoman', 'lowerLetter', 'upperLetter']);
    expect(currentNumbering([])).toEqual({ start: 1, format: 'decimal' });
    expect(currentNumbering([{ pageNumbering: { start: 3, format: 'lowerRoman' } }])).toEqual({ start: 3, format: 'lowerRoman' });
    expect(currentNumbering([{ pageNumbering: { start: -2, format: 'hex' } }])).toEqual({ start: 1, format: 'decimal' });
    expect(parseStartAt('7')).toBe(7);
    // The engine refuses a start of 0, so the dialog does too instead of showing its raw error after the numbers went in.
    expect(parseStartAt(' 0 ')).toBeNull();
    expect(parseStartAt(' 1 ')).toBe(1);
    expect(parseStartAt('1.5')).toBeNull();
    expect(parseStartAt('')).toBeNull();
    expect(parseStartAt('99999')).toBeNull();
  });

  it('sets the numbering on the first section only', async () => {
    const { setPageNumbering } = await import('../src/lib/pagenumbers.js');
    const calls = [];
    const api = {
      sections: {
        list: async () => ({ items: [{ address: { kind: 'section', sectionId: 'a' } }, { address: { kind: 'section', sectionId: 'b' } }] }),
        setPageNumbering: async (i) => { calls.push(i); return { success: true }; },
      },
    };
    expect(await setPageNumbering(api, { start: 5, format: 'upperRoman' })).toEqual({ start: 5, format: 'upperRoman' });
    expect(calls).toEqual([{ target: { kind: 'section', sectionId: 'a' }, start: 5, format: 'upperRoman' }]);
    await expect(setPageNumbering(api, { format: 'binary' })).rejects.toThrow('Unknown number format');
    await expect(setPageNumbering({ sections: { list: async () => ({ items: [] }) } }, {})).rejects.toThrow('no sections');
  });
});

describe('odd and even pages', () => {
  it('reads the document setting and toggles it', async () => {
    const { oddEvenDifferent, setOddEvenDifferent } = await import('../src/lib/pagenumbers.js');
    expect(oddEvenDifferent([{ oddEvenHeadersFooters: true }])).toBe(true);
    expect(oddEvenDifferent([{ titlePage: true }])).toBe(false);
    expect(oddEvenDifferent(null)).toBe(false);
    const calls = [];
    const api = { sections: { setOddEvenHeadersFooters: async (i) => { calls.push(i); return { success: true }; } } };
    expect(await setOddEvenDifferent(api, true)).toBe(true);
    expect(await setOddEvenDifferent(api, 0)).toBe(false);
    expect(calls).toEqual([{ enabled: true }, { enabled: false }]);
    await expect(setOddEvenDifferent({ sections: { setOddEvenHeadersFooters: async () => ({ success: false, failure: { message: 'no' } }) } }, true)).rejects.toThrow('no');
  });
});
