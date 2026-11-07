import { expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { rotatePage, rotateAllPages } from '../src/core/document.js';
import { addNote, editNote, listNotes } from '../src/core/notes.js';
import { addLink, updateLink, listLinks } from '../src/core/links.js';
import { addHighlight, editHighlight, listHighlights, rectQuad } from '../src/core/highlight.js';

const actions = {
  note: {
    add: (doc) => addNote(doc, 0, { x: 30, y: 150, text: 'Original' }),
    list: listNotes,
    edit: (doc, index, id) => editNote(doc, index, id, { text: 'Changed', x: 60 }),
    value: (entry) => entry.text,
    before: 'Original',
    after: 'Changed',
  },
  link: {
    add: (doc) =>
      addLink(doc, 0, {
        rect: { x: 30, y: 100, width: 100, height: 30 },
        url: 'https://example.com/old',
      }),
    list: listLinks,
    edit: (doc, index, id) => updateLink(doc, index, id, { url: 'https://example.com/new' }),
    value: (entry) => entry.url,
    before: 'https://example.com/old',
    after: 'https://example.com/new',
  },
  highlight: {
    add: (doc) =>
      addHighlight(doc, 0, { quads: [rectQuad({ x: 30, y: 100, width: 100, height: 30 })] }),
    list: listHighlights,
    edit: (doc, index, id) => editHighlight(doc, index, id, { hex: '#1144cc' }),
    value: (entry) => entry.hex,
    before: '#f2c438',
    after: '#1144cc',
  },
};
for (const [kind, action] of Object.entries(actions))
  for (const sharedArray of [false, true])
    for (const index of [0, 1])
      it(`editing ${kind} on page ${index + 1} preserves its shared copy (shared array ${sharedArray})`, async () => {
        const doc = await PDFDocument.create();
        doc.addPage([200, 200]);
        doc.addPage([200, 200]);
        action.add(doc);
        const list = doc.getPage(0).node.Annots();
        const value = sharedArray ? doc.context.register(list) : list.clone();
        if (sharedArray) doc.getPage(0).node.set(PDFName.of('Annots'), value);
        doc.getPage(1).node.set(PDFName.of('Annots'), value);
        const loaded = await PDFDocument.load(await doc.save());
        action.edit(loaded, index, action.list(loaded, index)[0].id);
        const saved = await PDFDocument.load(await loaded.save());
        expect(action.value(action.list(saved, index)[0])).toBe(action.after);
        expect(action.value(action.list(saved, 1 - index)[0])).toBe(action.before);
      });

for (const listedPopup of [false, true])
  it(`moving a shared note keeps popup and reply ownership (listed popup ${listedPopup})`, async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.addPage([200, 200]);
    addNote(doc, 0, { x: 30, y: 150, text: 'Original' });
    const annots = doc.getPage(0).node.Annots();
    const original = annots.get(0);
    const popup = doc.context.lookup(original).lookup(PDFName.of('Popup'));
    const popupBefore = popup.lookup(PDFName.of('Rect')).toString();
    if (!listedPopup) annots.remove(1);
    const reply = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [20, 20, 40, 40],
        IRT: original,
      }),
    );
    annots.push(reply);
    actions.highlight.add(doc);
    const markup = annots.get(annots.size() - 1);
    const field = doc.getForm().createTextField('Unrelated field');
    field.addToPage(doc.getPage(0), { x: 10, y: 10, width: 20, height: 20 });
    const widget = annots.get(annots.size() - 1);
    doc.getPage(1).node.set(PDFName.of('Annots'), annots.clone());
    editNote(doc, 0, listNotes(doc, 0)[0].id, { x: 60, text: 'Changed' });
    const own = doc.getPage(0).node.Annots();
    const note = doc.context.lookup(own.get(0));
    expect(note.lookup(PDFName.of('Popup'))).not.toBe(popup);
    expect(note.lookup(PDFName.of('Popup')).get(PDFName.of('Parent'))).toBe(own.get(0));
    expect(note.lookup(PDFName.of('Popup')).get(PDFName.of('P'))).toBe(doc.getPage(0).ref);
    const copiedReply = doc.context.lookup(own.get(listedPopup ? 2 : 1));
    expect(copiedReply.get(PDFName.of('IRT'))).toBe(own.get(0));
    expect(doc.context.lookup(reply).get(PDFName.of('IRT'))).toBe(original);
    expect(popup.lookup(PDFName.of('Rect')).toString()).toBe(popupBefore);
    expect(own.get(own.size() - 1)).toBe(widget);
    expect(own.get(own.size() - 2)).toBe(markup);
    expect(field.acroField.getWidgets()[0].dict).toBe(doc.context.lookup(widget));
    // Unchanged resources are shared; a text-only edit does not copy large appearance streams.
    const resources = note.lookup(PDFName.of('AP'));
    editNote(doc, 0, listNotes(doc, 0)[0].id, { text: 'Changed again' });
    expect(note.lookup(PDFName.of('AP'))).toBe(resources);
  });

for (const index of [0, 1])
  it(`rotating page ${index + 1} preserves the other page's shared note appearances`, async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.addPage([200, 200]);
    for (const x of [30, 90]) addNote(doc, 0, { x, y: 150, text: `Note ${x}` });
    doc.getPage(1).node.set(PDFName.of('Annots'), doc.getPage(0).node.Annots().clone());
    const matrices = (pageIndex) =>
      listNotes(doc, pageIndex).map(({ id }) => {
        const ref = doc
          .getPage(pageIndex)
          .node.Annots()
          .asArray()
          .find((ref) => ref.toString() === id);
        return doc.context
          .lookup(ref)
          .lookup(PDFName.of('AP'))
          .lookup(PDFName.of('N'))
          .dict.lookup(PDFName.of('Matrix'))
          .toString();
      });
    const original = matrices(1 - index);
    rotatePage(doc, index);
    expect(matrices(index)).toEqual(['[ 0 1 -1 0 0 0 ]', '[ 0 1 -1 0 0 0 ]']);
    expect(matrices(1 - index)).toEqual(original);
    rotateAllPages(doc);
    expect(matrices(index)).toEqual(['[ -1 0 0 -1 0 0 ]', '[ -1 0 0 -1 0 0 ]']);
    expect(matrices(1 - index)).toEqual(['[ 0 1 -1 0 0 0 ]', '[ 0 1 -1 0 0 0 ]']);
  });
