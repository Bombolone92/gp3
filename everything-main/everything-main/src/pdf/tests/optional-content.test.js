import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { extractPages } from '../src/core/pages.js';
import { splitPdf } from '../src/core/split.js';
import { flattenDocument } from '../src/core/flatten.js';
import { duplicatePage, insertPdfPages } from '../src/core/document.js';

const n = PDFName.of;

async function layeredPdf(baseState = 'ON') {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const hidden = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Hidden layer') }));
  const visible = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Visible layer') }));
  const membership = ctx.register(
    ctx.obj({ Type: 'OCMD', OCGs: [hidden, visible], P: 'AllOn', VE: ['And', hidden, visible] }),
  );
  doc.catalog.set(
    n('OCProperties'),
    ctx.obj({
      OCGs: [hidden, visible],
      D: {
        Name: PDFString.of('Default layers'),
        BaseState: baseState,
        ...(baseState === 'OFF' ? { ON: [visible] } : { OFF: [hidden] }),
        Order: [PDFString.of('Drawing'), hidden, [visible]],
        Locked: [hidden],
        RBGroups: [[hidden, visible]],
        AS: [{ Event: 'Print', Category: ['Print'], OCGs: [hidden] }],
      },
      Configs: [{ Name: PDFString.of('Review'), BaseState: 'OFF', ON: [hidden] }],
    }),
  );
  for (let i = 0; i < 2; i++) {
    const page = doc.addPage([200, 200]);
    const form = ctx.register(
      ctx.flateStream('0 0 1 rg 0 0 60 60 re f', {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 60, 60],
        OC: hidden,
      }),
    );
    page.node.set(
      n('Resources'),
      ctx.obj({
        Properties: { Hidden: hidden, Visible: visible, Both: membership },
        XObject: { Fm: form },
      }),
    );
    page.node.set(
      n('Contents'),
      ctx.register(
        ctx.flateStream(
          `/OC /Hidden BDC 1 0 0 rg 20 20 60 60 re f EMC
           /OC /Visible BDC 0 1 0 rg ${20 + i * 10} 120 30 30 re f EMC
           /OC /Both BDC 1 0 1 rg 100 20 60 60 re f EMC
           q 1 0 0 1 100 120 cm /Fm Do Q`,
        ),
      ),
    );
    page.node.addAnnot(
      ctx.register(
        ctx.obj({
          Type: 'Annot',
          Subtype: 'Square',
          Rect: [20, 90, 60, 110],
          P: page.ref,
          F: 4,
          OC: hidden,
          AP: {
            N: ctx.register(
              ctx.flateStream('1 0.5 0 rg 0 0 40 20 re f', {
                Type: 'XObject',
                Subtype: 'Form',
                BBox: [0, 0, 40, 20],
              }),
            ),
          },
        }),
      ),
    );
  }
  return doc.save();
}

async function pixels(bytes, pageNumber, { review = false, configuration } = {}) {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(pageNumber);
    const canvas = createCanvas(200, 200),
      context = canvas.getContext('2d');
    const config = await pdf.getOptionalContentConfig();
    if (review) {
      // PDF.js exposes group visibility changes even though it does not expose /Configs.
      const raw = await PDFDocument.load(bytes);
      const groups = raw.catalog.lookup(n('OCProperties')).lookup(n('OCGs')).asArray();
      for (let i = 0; i < groups.length; i++)
        config.setVisibility(`${groups[i].objectNumber}R`, i === 0, false);
    }
    if (configuration !== undefined) {
      const raw = await PDFDocument.load(bytes);
      const props = raw.catalog.lookup(n('OCProperties'));
      const selected = props.lookup(n('Configs')).lookup(configuration);
      const base = selected.lookup(n('BaseState'));
      if (base !== n('Unchanged'))
        for (const group of props.lookup(n('OCGs')).asArray())
          config.setVisibility(`${group.objectNumber}R`, base !== n('OFF'), false);
      for (const state of ['ON', 'OFF'])
        for (const group of selected.lookup(n(state))?.asArray() || [])
          config.setVisibility(`${group.objectNumber}R`, state === 'ON', false);
    }
    await page.render({
      canvasContext: context,
      viewport: page.getViewport({ scale: 1 }),
      optionalContentConfigPromise: Promise.resolve(config),
    }).promise;
    return context.getImageData(0, 0, 200, 200).data;
  } finally {
    await task.destroy();
  }
}

function difference(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

describe('optional content when duplicating pages', () => {
  it.each([false, true])(
    'shares the original layer controls (form fields=%s)',
    async (withForm) => {
      const doc = await PDFDocument.load(await layeredPdf());
      if (withForm) {
        const field = doc.getForm().createCheckBox('optional');
        field.addToPage(doc.getPage(0), { x: 120, y: 85, width: 25, height: 25 });
        field.check();
        const hidden = doc.catalog.lookup(n('OCProperties')).lookup(n('OCGs')).get(0);
        field.acroField.getWidgets()[0].dict.set(n('OC'), hidden);
      }
      const original = await doc.save();
      expect(await duplicatePage(doc, 0)).toBe(1);
      const duplicated = await doc.save();
      for (const review of [false, true])
        for (const number of [1, 2])
          expect(
            difference(
              await pixels(original, 1, { review }),
              await pixels(duplicated, number, { review }),
            ),
          ).toBeLessThan(0.01);
      const groups = doc.catalog.lookup(n('OCProperties')).lookup(n('OCGs')).asArray();
      expect(groups).toHaveLength(2);
      const properties = doc.getPage(1).node.Resources().lookup(n('Properties'));
      expect(properties.get(n('Hidden'))).toBe(groups[0]);
      expect(properties.get(n('Visible'))).toBe(groups[1]);
      expect(properties.lookup(n('Both')).lookup(n('OCGs')).asArray()).toEqual(groups);
      expect(doc.context.lookup(doc.getPage(1).node.Annots().get(0)).get(n('OC'))).toBe(groups[0]);
    },
  );
});

describe('optional content when inserting pages', () => {
  it.each([
    ['none', 'ON'],
    ['ON', 'ON'],
    ['OFF', 'ON'],
    ['ON', 'OFF'],
    ['OFF', 'OFF'],
  ])(
    'keeps both documents visible as before (target=%s, source=%s)',
    async (targetBase, sourceBase) => {
      const target =
        targetBase === 'none'
          ? await PDFDocument.create()
          : await PDFDocument.load(await layeredPdf(targetBase));
      if (targetBase === 'none') target.addPage([200, 200]);
      const original = await target.save();
      const source = await layeredPdf(sourceBase);
      expect(await insertPdfPages(target, source, { pages: [1, 0, 1], after: 0 })).toEqual([
        1, 2, 3,
      ]);
      const merged = await target.save();
      expect(difference(await pixels(original, 1), await pixels(merged, 1))).toBe(0);
      for (const [position, number] of [2, 1, 2].entries())
        expect(difference(await pixels(source, number), await pixels(merged, position + 2))).toBe(
          0,
        );
      if (targetBase !== 'none') {
        expect(difference(await pixels(original, 2), await pixels(merged, 5))).toBe(0);
        // Choosing one document's alternate configuration preserves the other's defaults.
        expect(
          difference(
            await pixels(original, 1, { configuration: 0 }),
            await pixels(merged, 1, { configuration: 0 }),
          ),
        ).toBe(0);
        expect(
          difference(await pixels(source, 2), await pixels(merged, 2, { configuration: 0 })),
        ).toBe(0);
      }
      const configuration = targetBase === 'none' ? 0 : 1;
      expect(
        difference(
          await pixels(source, 2, { configuration: 0 }),
          await pixels(merged, 2, { configuration }),
        ),
      ).toBe(0);
      expect(
        difference(await pixels(original, 1), await pixels(merged, 1, { configuration })),
      ).toBe(0);
      const props = target.catalog.lookup(n('OCProperties'));
      const groups = props.lookup(n('OCGs')).asArray();
      const offset = targetBase === 'none' ? 0 : 2;
      expect(groups).toHaveLength(offset + 2);
      const properties = target.getPage(1).node.Resources().lookup(n('Properties'));
      expect(properties.get(n('Hidden'))).toBe(groups[offset]);
      expect(properties.get(n('Visible'))).toBe(groups[offset + 1]);
      expect(props.lookup(n('D')).lookup(n('Locked')).asArray()).toEqual(
        groups.filter((_, i) => i % 2 === 0),
      );
      expect(props.lookup(n('D')).lookup(n('RBGroups')).size()).toBe(groups.length / 2);
      expect(props.lookup(n('D')).lookup(n('AS')).size()).toBe(groups.length / 2);
    },
  );
  it('retains partial alternate settings and flattened form layers across repeated inserts', async () => {
    const target = await PDFDocument.load(await layeredPdf());
    const source = await PDFDocument.load(await layeredPdf());
    const props = source.catalog.lookup(n('OCProperties'));
    const groups = props.lookup(n('OCGs')).asArray();
    props.set(
      n('Configs'),
      source.context.obj([
        {
          Name: PDFString.of('Partial'),
          BaseState: 'Unchanged',
          ON: [groups[0]],
          Order: [],
        },
      ]),
    );
    const field = source.getForm().createCheckBox('hidden checkbox');
    field.addToPage(source.getPage(0), { x: 120, y: 85, width: 25, height: 25 });
    field.check();
    field.acroField.getWidgets()[0].dict.set(n('OC'), groups[0]);
    const original = await source.save();
    for (let i = 0; i < 2; i++) await insertPdfPages(target, original, { pages: [0] });
    const merged = await target.save();
    for (const number of [3, 4]) {
      expect(difference(await pixels(original, 1), await pixels(merged, number))).toBeLessThan(
        0.01,
      );
      expect(
        difference(
          await pixels(original, 1, { configuration: 0 }),
          await pixels(merged, number, { configuration: number - 2 }),
        ),
      ).toBeLessThan(0.01);
    }
    const combined = target.catalog.lookup(n('OCProperties'));
    expect(combined.lookup(n('OCGs')).size()).toBe(6);
    expect(combined.lookup(n('Configs')).size()).toBe(3);
    const partial = combined.lookup(n('Configs')).lookup(1);
    // Explicit empty /Order must not inherit the source's default layer tree.
    expect(partial.lookup(n('Order')).size()).toBe(6);
    expect(partial.lookup(n('RBGroups')).size()).toBe(3);
  });
});

describe('optional content when extracting pages', () => {
  it.each(['ON', 'OFF'])('preserves visible and hidden content with BaseState=%s', async (base) => {
    const original = await layeredPdf(base);
    const extracted = await extractPages(original, [1, 0]);
    for (let i = 0; i < 2; i++)
      expect(difference(await pixels(original, 2 - i), await pixels(extracted, i + 1))).toBe(0);
    // Retaining the layer itself allows its hidden content to be shown later by a reader.
    expect(
      difference(
        await pixels(original, 1, { review: true }),
        await pixels(extracted, 2, { review: true }),
      ),
    ).toBe(0);
    const doc = await PDFDocument.load(extracted);
    const props = doc.catalog.lookup(n('OCProperties'));
    const groups = props.lookup(n('OCGs')).asArray();
    expect(groups).toHaveLength(2);
    const first = doc.getPage(0).node.Resources().lookup(n('Properties'));
    expect(first.get(n('Hidden'))).toBe(groups[0]);
    expect(first.get(n('Visible'))).toBe(groups[1]);
    const defaults = props.lookup(n('D'));
    expect(defaults.lookup(n('BaseState'))).toBe(n(base));
    expect(defaults.lookup(n('Locked')).get(0)).toBe(groups[0]);
    expect(defaults.lookup(n('RBGroups')).lookup(0).asArray()).toEqual(groups);
    expect(defaults.lookup(n('AS')).lookup(0).lookup(n('OCGs')).get(0)).toBe(groups[0]);
    expect(props.lookup(n('Configs')).lookup(0).lookup(n('ON')).get(0)).toBe(groups[0]);
    expect(
      doc.getPage(0).node.Resources().lookup(n('XObject')).lookup(n('Fm')).dict.get(n('OC')),
    ).toBe(groups[0]);
    expect(doc.context.lookup(doc.getPage(0).node.Annots().get(0)).get(n('OC'))).toBe(groups[0]);
  });

  it('keeps optional content settings in every split part', async () => {
    const original = await layeredPdf();
    const parts = await splitPdf(original, [[0], [1]], 'Layers');
    for (let i = 0; i < parts.length; i++)
      expect(difference(await pixels(original, i + 1), await pixels(parts[i].bytes, 1))).toBe(0);
  });
});

describe('optional content when flattening', () => {
  it.each([false, true])(
    'preserves a comment layer and any nested appearance layer (nested OC=%s)',
    async (appearanceLayer) => {
      const doc = await PDFDocument.load(await layeredPdf());
      if (appearanceLayer) {
        const visible = doc.catalog.lookup(n('OCProperties')).lookup(n('OCGs')).get(1);
        for (const page of doc.getPages()) {
          const ap = doc.context.lookup(page.node.Annots().get(0)).lookup(n('AP'));
          const inner = ap.get(n('N'));
          doc.context.lookup(inner).dict.set(n('OC'), visible);
          ap.set(
            n('N'),
            doc.context.register(
              doc.context.flateStream('/Inner Do', {
                Type: 'XObject',
                Subtype: 'Form',
                BBox: [0, 0, 40, 20],
                Resources: { XObject: { Inner: inner } },
              }),
            ),
          );
        }
      }
      const original = await doc.save();
      expect(flattenDocument(doc)).toEqual({ fields: 0, annotations: 2 });
      const flattened = await doc.save();
      for (const review of [false, true])
        for (let number = 1; number <= 2; number++)
          expect(
            difference(
              await pixels(original, number, { review }),
              await pixels(flattened, number, { review }),
            ),
          ).toBe(0);
    },
  );

  it('preserves layer-controlled form widgets when their appearances become page content', async () => {
    const doc = await PDFDocument.load(await layeredPdf());
    const hidden = doc.catalog.lookup(n('OCProperties')).lookup(n('OCGs')).get(0);
    const field = doc.getForm().createCheckBox('optional');
    field.addToPage(doc.getPage(0), { x: 120, y: 85, width: 25, height: 25 });
    field.check();
    field.acroField.getWidgets()[0].dict.set(n('OC'), hidden);
    const original = await doc.save();
    expect(flattenDocument(doc, { annotations: false })).toEqual({ fields: 1, annotations: 0 });
    const flattened = await doc.save();
    for (const review of [false, true])
      expect(
        difference(await pixels(original, 1, { review }), await pixels(flattened, 1, { review })),
      ).toBeLessThan(0.01);
  });
});
