import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { duplicatePage, insertPdfPages } from '../src/core/document.js';
import { extractPages } from '../src/core/pages.js';

const n = PDFName.of;
const uri = (url) => ({ S: 'URI', URI: PDFString.of(url) });
async function fixture() {
  const doc = await PDFDocument.create(),
    ctx = doc.context;
  for (const width of [200, 210, 220]) doc.addPage([width, 300]);
  const dest = [doc.getPage(2).ref, 'FitH', 60];
  doc.catalog.set(n('Dests'), ctx.obj({ last: dest }));
  // Mix direct and indirect action names in the same graph. Both are read by PDF.js.
  const go = () => ({ S: ctx.register(n('GoTo')), D: dest });
  doc.getPage(0).node.set(
    n('AA'),
    ctx.obj({
      O: { ...go(), Next: [uri('https://example.com/one'), uri('https://example.com/two')] },
    }),
  );
  const actions = [
    {
      Subtype: 'Link',
      A: {
        ...uri('https://example.com/start'),
        Next: [
          { S: 'GoTo', D: PDFString.of('last') },
          { S: 'GoTo', D: [2, 'FitH', 60] },
          { S: 'GoToR', F: PDFString.of('other.pdf'), D: [2, 'Fit'] },
        ],
      },
    },
    { Subtype: 'Screen', A: go() },
    { Subtype: 'Link', AA: { U: go() } },
  ];
  for (const [i, extra] of actions.entries())
    doc.getPage(0).node.addAnnot(
      ctx.register(
        ctx.obj({
          Type: 'Annot',
          Rect: [10, 20 + 30 * i, 100, 40 + 30 * i],
          ...extra,
        }),
      ),
    );
  const first = ctx.register(ctx.obj({ Type: 'NavNode', NA: { S: 'GoTo', D: n('last') } }));
  const second = ctx.register(ctx.obj({ Type: 'NavNode', PA: go(), Prev: first }));
  ctx.lookup(first).set(n('Next'), second);
  doc.getPage(0).node.set(n('PresSteps'), first);
  return doc;
}

function actions(doc, index) {
  const page = doc.getPage(index).node;
  const annotations = page
    .Annots()
    .asArray()
    .map((ref) => doc.context.lookup(ref));
  const chain = annotations[0].lookup(n('A')).lookup(n('Next'));
  const steps = page.lookup(n('PresSteps'));
  return [
    page.lookup(n('AA')).lookup(n('O')),
    chain.lookup(0),
    chain.lookup(1),
    annotations[1].lookup(n('A')),
    annotations[2].lookup(n('AA')).lookup(n('U')),
    steps.lookup(n('NA')),
    steps.lookup(n('Next')).lookup(n('PA')),
  ];
}

async function expectTargets(bytes, pageIndex, targetIndex) {
  const doc = await PDFDocument.load(bytes);
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const pdf = await task.promise;
    for (const action of actions(doc, pageIndex)) {
      let dest = action.lookup(n('D'));
      if (!dest?.asArray) dest = await pdf.getDestination(dest.decodeText());
      else
        dest = dest
          .asArray()
          .map(
            (value) =>
              value.asNumber?.() ??
              (value.objectNumber
                ? { num: value.objectNumber, gen: value.generationNumber }
                : value),
          );
      const target = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0]);
      expect(target).toBe(targetIndex);
    }
  } finally {
    await task.destroy();
  }
  return doc;
}

describe('destinations in copied page actions', () => {
  it('handles cyclic omitted actions without losing surviving successors', async () => {
    const doc = await fixture(),
      ctx = doc.context;
    const bad = ctx.register(ctx.obj({ S: 'GoTo', D: [doc.getPage(1).ref, 'Fit'] }));
    const keep = ctx.register(ctx.obj(uri('https://example.com/after-cycle')));
    ctx.lookup(bad).set(n('Next'), ctx.obj([bad, keep]));
    doc.getPage(0).node.set(n('AA'), ctx.obj({ O: bad, C: bad }));
    const result = await PDFDocument.load(await extractPages(await doc.save(), [0, 2]));
    const aa = result.getPage(0).node.lookup(n('AA'));
    expect(aa.get(n('O'))).toBe(aa.get(n('C')));
    expect(aa.lookup(n('O')).lookup(n('URI')).decodeText()).toBe('https://example.com/after-cycle');
  });

  it('keeps the execution order and sharing of surviving chains', async () => {
    const doc = await fixture(),
      ctx = doc.context;
    const last = ctx.register(ctx.obj(uri('https://example.com/last')));
    const nested = ctx.register(ctx.obj({ ...uri('https://example.com/nested'), Next: last }));
    const first = ctx.register(ctx.obj({ ...uri('https://example.com/first'), Next: nested }));
    const tail = ctx.register(ctx.obj(uri('https://example.com/tail')));
    const bad = ctx.register(
      ctx.obj({ S: 'GoTo', D: [doc.getPage(1).ref, 'Fit'], Next: [first, tail] }),
    );
    doc.getPage(0).node.set(n('AA'), ctx.obj({ O: bad, C: first }));
    const out = await PDFDocument.load(await extractPages(await doc.save(), [0, 2]));
    const aa = out.getPage(0).node.lookup(n('AA'));
    const sequence = (raw) => {
      const result = [],
        pending = [raw];
      while (pending.length) {
        const value = out.context.lookup(pending.pop());
        if (!value) continue;
        if (value.asArray) {
          for (const child of value.asArray().reverse()) pending.push(child);
        } else {
          result.push(value.lookup(n('URI')).decodeText());
          pending.push(value.get(n('Next')));
        }
      }
      return result.map((url) => url.split('/').at(-1));
    };
    expect(sequence(aa.get(n('O')))).toEqual(['first', 'nested', 'last', 'tail']);
    expect(sequence(aa.get(n('C')))).toEqual(['first', 'nested', 'last']);
  });

  it.each([false, true])(
    'bounds expansion of shared omitted action graphs (surviving=%s)',
    async (surviving) => {
      const doc = await PDFDocument.create(),
        ctx = doc.context;
      doc.addPage([200, 200]);
      let next = surviving ? ctx.register(ctx.obj(uri('https://example.com/end'))) : undefined;
      for (let i = 0; i < 25; i++)
        next = ctx.register(
          ctx.obj({
            S: 'GoTo',
            D: [999, 'Fit'],
            ...(next ? { Next: [next, next] } : {}),
          }),
        );
      doc.getPage(0).node.set(n('AA'), ctx.obj({ O: next }));
      await expect(extractPages(await doc.save(), [0])).rejects.toThrow(
        'action sequence is too complex',
      );
    },
  );
  it.each(['extract', 'insert', 'duplicate'])(
    'relinks every local action after %s',
    async (operation) => {
      const source = await fixture(),
        original = await source.save();
      await expectTargets(original, 0, 2);
      let bytes, pageIndex, targetIndex;
      if (operation === 'extract') {
        bytes = await extractPages(original, [0, 2]);
        pageIndex = 0;
        targetIndex = 1;
      } else if (operation === 'insert') {
        const doc = await PDFDocument.create();
        doc.addPage([100, 100]);
        await insertPdfPages(doc, original, { pages: [0, 2] });
        bytes = await doc.save();
        pageIndex = 1;
        targetIndex = 2;
      } else {
        await duplicatePage(source, 0);
        bytes = await source.save();
        pageIndex = 1;
        targetIndex = 3;
        await expectTargets(bytes, 0, 3);
      }
      const doc = await expectTargets(bytes, pageIndex, targetIndex);
      for (const action of actions(doc, pageIndex))
        expect(action.lookup(n('D')).get(0)).toBe(doc.getPage(targetIndex).ref);
      const annotation = doc.context.lookup(doc.getPage(pageIndex).node.Annots().get(0));
      const remote = annotation.lookup(n('A')).lookup(n('Next')).lookup(2);
      expect(remote.lookup(n('S'))).toBe(n('GoToR'));
      expect(remote.lookup(n('D')).get(0).asNumber()).toBe(2);
      expect(
        doc.context
          .enumerateIndirectObjects()
          .filter(([, value]) => value instanceof PDFDict && value.get(n('Type')) === n('Page')),
      ).toHaveLength(doc.getPageCount());
    },
  );

  it('drops omitted jumps while retaining the remaining action sequence', async () => {
    const original = await (await fixture()).save();
    const doc = await PDFDocument.load(await extractPages(original, [0]));
    const page = doc.getPage(0).node;
    const open = page.lookup(n('AA')).lookup(n('O'));
    expect(open.lookup(n('S'))).toBe(n('URI'));
    expect(open.lookup(n('URI')).decodeText()).toBe('https://example.com/one');
    expect(open.lookup(n('Next')).lookup(n('URI')).decodeText()).toBe('https://example.com/two');
    const annotations = page
      .Annots()
      .asArray()
      .map((ref) => doc.context.lookup(ref));
    const remaining = annotations[0].lookup(n('A')).lookup(n('Next'));
    expect(remaining.lookup(n('S'))).toBe(n('GoToR'));
    expect(annotations[1].has(n('A'))).toBe(false);
    expect(annotations[2].lookup(n('AA')).has(n('U'))).toBe(false);
    const steps = page.lookup(n('PresSteps'));
    expect(steps.has(n('NA'))).toBe(false);
    expect(steps.lookup(n('Next')).has(n('PA'))).toBe(false);
    expect(
      doc.context
        .enumerateIndirectObjects()
        .filter(([, value]) => value instanceof PDFDict && value.get(n('Type')) === n('Page')),
    ).toHaveLength(1);
  });
});
