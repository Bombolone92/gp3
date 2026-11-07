import { expect, it } from 'vitest';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { addNote, editNote, listNotes } from '../src/core/notes.js';
import { addHighlight, editHighlight, listHighlights, rectQuad } from '../src/core/highlight.js';

/** Add a reply, with its own popup, to the annotation `parent` on the first page. */
function reply(doc, parent, text) {
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  const ref = doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [100, 680, 120, 700],
      F: 28,
      IRT: parent,
      RT: 'R',
      Contents: PDFHexString.fromText(text),
    }),
  );
  const popup = doc.context.register(
    doc.context.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [130, 600, 300, 700], Parent: ref }),
  );
  doc.context.lookup(ref).set(PDFName.of('Popup'), popup);
  annots.push(ref);
  annots.push(popup);
  return ref;
}
const subtypes = (doc) =>
  doc
    .getPage(0)
    .node.lookup(PDFName.of('Annots'))
    .asArray()
    .map((ref) => doc.context.lookup(ref).lookup(PDFName.of('Subtype')).decodeText());

const refOf = (doc, id) =>
  doc
    .getPage(0)
    .node.lookup(PDFName.of('Annots'))
    .asArray()
    .find((ref) => ref.toString() === id);

it('removes a note together with its replies and their popups', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  addNote(doc, 0, { x: 100, y: 700, text: 'Please fix', author: 'A' });
  addNote(doc, 0, { x: 300, y: 300, text: 'Unrelated', author: 'A' });
  const [note] = listNotes(doc, 0);
  const answer = reply(doc, refOf(doc, note.id), 'Done');
  reply(doc, answer, 'Thanks');
  expect(subtypes(doc)).toHaveLength(8);
  editNote(doc, 0, note.id, { remove: true });
  // Only the unrelated note and its popup remain.
  expect(subtypes(doc)).toEqual(['Text', 'Popup']);
  expect(listNotes(doc, 0).map((entry) => entry.text)).toEqual(['Unrelated']);
});

it('removes a markup together with its replies', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  addHighlight(doc, 0, {
    quads: [rectQuad({ x: 40, y: 600, width: 120, height: 20 })],
    hex: '#ffff00',
  });
  const [markup] = listHighlights(doc, 0);
  reply(doc, refOf(doc, markup.id), 'Agreed');
  editHighlight(doc, 0, markup.id, { remove: true });
  expect(subtypes(doc)).toEqual([]);
});
