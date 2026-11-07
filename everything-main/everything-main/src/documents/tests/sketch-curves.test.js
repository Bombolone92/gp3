import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { curvedSketchRectangle, curvedSketchEllipse } from '../src/engine/sketch-curves.js';
import { JSDOM } from 'jsdom';
import { unzipSync, strFromU8 } from 'fflate';

for (const fixture of ['sketch-regeneration', 'sketch-heldout', 'sketch-ellipse', 'sketch-syntax']) {
  const directory = `tests/fixtures/${fixture}/`;
  const cases = JSON.parse(readFileSync(directory + 'geometry.json'));
  it(`matches every native rectangle and ellipse coordinate in ${fixture}`, () => {
    for (const c of cases) {
      const expected = c.paths.map(path => ({ width: Number(path.attributes.w), height: Number(path.attributes.h), fill: path.attributes.fill !== 'none', stroke: path.attributes.stroke !== '0', points: path.commands.map(command => [{ moveTo: 'M', cubicBezTo: 'C', close: 'Z' }[command.type], ...command.points.flat()]) }));
      expect((c.shape === 'rect' ? curvedSketchRectangle : curvedSketchEllipse)(c.width, c.height, c.seed), JSON.stringify(c)).toEqual(expected);
    }
  });
}

for (const fixture of ['sketch-heldout', 'sketch-ellipse', 'sketch-syntax']) it(`binds ${fixture} controls and native outputs to the recording`, () => {
  const directory = `tests/fixtures/${fixture}/`;
  const recording = JSON.parse(readFileSync(directory + 'native-recording.json'));
  for (const [name, hash] of Object.entries(recording.sha256)) expect(createHash('sha256').update(readFileSync(directory + name)).digest('hex')).toBe(hash);
  const dom = new JSDOM(strFromU8(unzipSync(readFileSync(directory + 'native.docx'))['word/document.xml']), { contentType: 'text/xml' });
  try {
    const A = 'http://schemas.openxmlformats.org/drawingml/2006/main', PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
    const paths = [...dom.window.document.getElementsByTagNameNS(PIC, 'pic')].map(pic => [...pic.getElementsByTagNameNS(A, 'pathLst')[0].children].map(p => ({ attributes: Object.fromEntries([...p.attributes].map(a => [a.name, a.value])), commands: [...p.children].map(n => ({ type: n.localName, points: [...n.children].map(v => [Number(v.getAttribute('x')), Number(v.getAttribute('y'))]) })) })));
    expect(JSON.parse(readFileSync(directory + 'geometry.json')).map(c => c.paths)).toEqual(paths);
  } finally { dom.window.close(); }
});
