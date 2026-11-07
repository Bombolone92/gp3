import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { duplicatePage, insertPdfPages } from '../src/core/document.js';
import { extractPages, inlineNamedDests } from '../src/core/pages.js';

const n = PDFName.of;
const hex = (text) => PDFHexString.of(Buffer.from(text, 'latin1').toString('hex'));

async function fixture(key, destination, { decoy, legacy = false } = {}) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([200 + i, 300]);
  const ctx = doc.context;
  const target = ctx.obj({ D: [doc.getPage(2).ref, 'XYZ', 12, 34, 2] });
  if (legacy) doc.catalog.set(n('Dests'), ctx.obj({ [key]: target }));
  else {
    const entries = [[key, target]];
    if (decoy) entries.push([decoy, ctx.obj([doc.getPage(1).ref, 'Fit'])]);
    entries.sort(([a], [b]) => Buffer.compare(a.asBytes(), b.asBytes()));
    const kids = entries.map(([entryKey, value]) =>
      ctx.register(ctx.obj({ Limits: [entryKey, entryKey], Names: [entryKey, value] })),
    );
    doc.catalog.set(n('Names'), ctx.obj({ Dests: { Kids: kids } }));
  }
  for (const action of [false, true]) {
    const link = ctx.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [10, action ? 60 : 20, 100, action ? 80 : 40],
      ...(action ? { A: { S: 'GoTo', D: destination } } : { Dest: destination }),
    });
    doc.getPage(0).node.addAnnot(ctx.register(link));
  }
  return doc;
}

async function expectReaderLinks(bytes, pageIndex, targetIndex) {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const pdf = await task.promise;
    const links = (await (await pdf.getPage(pageIndex + 1)).getAnnotations()).filter(
      (annot) => annot.subtype === 'Link',
    );
    expect(links).toHaveLength(2);
    for (const link of links) {
      const dest = typeof link.dest === 'string' ? await pdf.getDestination(link.dest) : link.dest;
      expect(dest).toBeTruthy();
      expect(await pdf.getPageIndex(dest[0])).toBe(targetIndex);
      expect(dest.slice(1)).toEqual([{ name: 'XYZ' }, 12, 34, 2]);
    }
  } finally {
    await task.destroy();
  }
}

describe('named destinations when copying pages', () => {
  it.each([
    ['literal string', PDFString.of('missing')],
    ['hex string', hex('missing')],
    ['name', n('missing')],
  ])('does not bind an unresolved %s to an unrelated document', async (_, destination) => {
    const source = await fixture(PDFString.of('other'), destination);
    const sourceBytes = await source.save();
    const task = pdfjs.getDocument({ data: sourceBytes.slice() });
    try {
      expect(await (await task.promise).getDestination('missing')).toBeNull();
    } finally {
      await task.destroy();
    }
    const ctx = source.context;
    const follow = ctx.obj({ S: 'URI', URI: PDFString.of('https://example.com/after') });
    const action = ctx.lookup(source.getPage(0).node.Annots().get(1)).lookup(n('A'));
    action.set(n('Next'), follow);
    source
      .getPage(0)
      .node.set(n('AA'), ctx.obj({ O: { S: 'GoTo', D: destination, Next: follow } }));
    source.getPage(0).node.addAnnot(
      ctx.register(
        ctx.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [10, 100, 100, 120],
          A: { S: 'GoToR', F: PDFString.of('other.pdf'), D: destination },
        }),
      ),
    );
    const target = await PDFDocument.create();
    target.addPage([100, 100]);
    target.catalog.set(n('Dests'), target.context.obj({ missing: [target.getPage(0).ref, 'Fit'] }));
    await insertPdfPages(target, await source.save(), { pages: [0] });
    const out = await PDFDocument.load(await target.save());
    const page = out.getPage(1).node;
    const links = page
      .Annots()
      .asArray()
      .map((ref) => out.context.lookup(ref));
    expect(links[0].has(n('Dest'))).toBe(false);
    expect(links[1].lookup(n('A')).lookup(n('S'))).toBe(n('URI'));
    expect(page.lookup(n('AA')).lookup(n('O')).lookup(n('URI')).decodeText()).toBe(
      'https://example.com/after',
    );
    expect(links[2].lookup(n('A')).lookup(n('S'))).toBe(n('GoToR'));
    expect(links[2].lookup(n('A')).get(n('D')).toString()).toBe(destination.toString());
    expect(out.catalog.lookup(n('Dests')).lookup(n('missing')).get(0)).toBe(out.getPage(0).ref);
  });

  it.each(['extract', 'duplicate'])('drops unresolved names from an %s copy', async (operation) => {
    const source = await fixture(PDFString.of('other'), PDFString.of('missing'));
    let bytes, index;
    if (operation === 'extract') {
      bytes = await extractPages(await source.save(), [0]);
      index = 0;
    } else {
      await duplicatePage(source, 0);
      bytes = await source.save();
      index = 1;
      expect(source.context.lookup(source.getPage(0).node.Annots().get(0)).has(n('Dest'))).toBe(
        true,
      );
    }
    const out = await PDFDocument.load(bytes);
    const links = out
      .getPage(index)
      .node.Annots()
      .asArray()
      .map((ref) => out.context.lookup(ref));
    expect(links[0].has(n('Dest'))).toBe(false);
    expect(links[1].has(n('A'))).toBe(false);
  });

  const encodings = [
    ['hex reference to a literal key', PDFString.of('target'), hex('target')],
    ['literal reference to a hex key', hex('target'), PDFString.of('target')],
    ['escaped literal reference', PDFString.of('target'), PDFString.of('targ\\145t')],
    ['escaped literal key', PDFString.of('targ\\145t'), PDFString.of('target')],
    [
      'a leading slash is part of a byte string',
      PDFString.of('/target'),
      PDFString.of('/target'),
      { decoy: PDFString.of('target') },
    ],
    ['hex reference to a legacy name', 'target', hex('target'), { legacy: true }],
    ['name reference to a hex key', hex('target'), n('target')],
  ];

  it.each(encodings)('preserves %s on extraction', async (_, key, destination, options) => {
    const source = await fixture(key, destination, options);
    const bytes = await source.save();
    // Confirm these destinations work in the reader before any editing.
    await expectReaderLinks(bytes, 0, 2);
    const extracted = await extractPages(bytes, [2, 0]);
    await expectReaderLinks(extracted, 1, 0);
    const reopened = await PDFDocument.load(extracted);
    expect(reopened.getPageCount()).toBe(2);
    expect(reopened.catalog.has(n('Names'))).toBe(false);
  });

  it('preserves encoded destinations when inserting and duplicating pages', async () => {
    const source = await fixture(PDFString.of('target'), hex('target'));
    const bytes = await source.save();
    const merged = await PDFDocument.create();
    merged.addPage([100, 100]);
    await insertPdfPages(merged, bytes, { pages: [2, 0], after: -1 });
    await expectReaderLinks(await merged.save(), 1, 0);
    await duplicatePage(source, 0);
    await expectReaderLinks(await source.save(), 0, 3);
    await expectReaderLinks(await source.save(), 1, 3);
  });

  it('compares raw destination bytes without conflating different text encodings', async () => {
    const source = await fixture(PDFHexString.fromText('target'), hex('target'), {
      decoy: PDFString.of('target'),
    });
    const out = await PDFDocument.load(await extractPages(await source.save(), [0, 1, 2]));
    const link = out.context.lookup(out.getPage(0).node.Annots().get(0));
    const dest = link.lookup(n('Dest'));
    expect(dest).toBeInstanceOf(PDFArray);
    expect(dest.get(0)).toBe(out.getPage(1).ref);
  });

  it('skips cyclic name-tree branches and keeps a reachable destination when extracting', async () => {
    const source = await fixture(PDFString.of('target'), PDFString.of('target'));
    const tree = source.catalog.lookup(n('Names')).lookup(n('Dests'));
    const cycle = source.context.obj({});
    const cycleRef = source.context.register(cycle);
    cycle.set(n('Kids'), source.context.obj([cycleRef]));
    tree.lookup(n('Kids')).insert(0, cycleRef);
    const extracted = await extractPages(await source.save(), [2, 0]);
    await expectReaderLinks(extracted, 1, 0);
  });

  it('terminates when a cyclic destination tree has no matching key', async () => {
    const source = await fixture(PDFString.of('other'), PDFString.of('missing'));
    const tree = source.catalog.lookup(n('Names')).lookup(n('Dests'));
    const ref = source.context.register(tree);
    tree.lookup(n('Kids')).push(ref);
    expect(() => inlineNamedDests(source, [0])).not.toThrow();
    const link = source.context.lookup(source.getPage(0).node.Annots().get(0));
    expect(link.lookup(n('Dest')).asString()).toBe('missing');
  });

  it('resolves deeply nested name trees without using the JavaScript call stack', async () => {
    const source = await fixture(PDFString.of('target'), PDFString.of('target'));
    const names = source.catalog.lookup(n('Names'));
    let tree = names.get(n('Dests'));
    for (let i = 0; i < 12000; i++)
      tree = source.context.register(source.context.obj({ Kids: [tree] }));
    names.set(n('Dests'), tree);
    const extracted = await extractPages(await source.save(), [2, 0]);
    await expectReaderLinks(extracted, 1, 0);
  });
});
