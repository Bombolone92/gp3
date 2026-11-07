import { describe, it, expect } from 'vitest';
import { VDocument } from '../src/model/document.js';
import { createText, createPath } from '../src/model/nodes.js';
import { rectangle } from '../src/model/shapes.js';
import { replaceIn } from '../src/features/type/type-ops.js';
import { addVariable, bind, captureDataSet, applyDataSet, importCSV, toCSV, parseCSV, removeVariables, boundTo, variablesOf, dataSetsOf } from '../src/features/variables/model.js';
import { bootAppWithFeatures } from './helpers.js';

const setText = (doc, node, text) => replaceIn(doc, node, 0, node.text.length, text, 'Apply');

function setup() {
  const doc = VDocument.create();
  const layer = doc.layers()[0].id;
  const t = createText('Hello', 10, 10, { runs: [{ len: 2, fontWeight: 700 }, { len: 3 }] });
  const r = createPath(rectangle(0, 0, 10, 10), true);
  doc.transact('add', () => {
    doc.insert(t, layer);
    doc.insert(r, layer);
  });
  return { doc, t, r };
}

describe('variables', () => {
  it('binds, captures and applies data sets', () => {
    const { doc, t, r } = setup();
    let name;
    let vis;
    doc.transact('vars', () => {
      name = addVariable(doc, 'text', 'Name');
      vis = addVariable(doc, 'visibility');
      bind(doc, t.id, 'text', name.id);
      bind(doc, r.id, 'visibility', vis.id);
      captureDataSet(doc, 'One');
    });
    expect(boundTo(doc, name.id)[0].node.id).toBe(t.id);
    doc.transact('edit', () => {
      setText(doc, doc.get(t.id), 'World and more');
      doc.update(r.id, { hidden: true });
      captureDataSet(doc, 'Two');
    });
    const [one, two] = dataSetsOf(doc);
    expect(two.values[name.id]).toBe('World and more');
    expect(two.values[vis.id]).toBe(false);
    doc.transact('apply', () => applyDataSet(doc, one.id, setText));
    expect(doc.get(t.id).text).toBe('Hello');
    expect(doc.get(r.id).hidden).toBe(false);
    // Runs stay consistent with the new text.
    expect(doc.get(t.id).runs.reduce((s, x) => s + x.len, 0)).toBe(5);
    doc.undo();
    expect(doc.get(t.id).text).toBe('World and more');
  });

  it('round-trips CSV with quoting and visibility columns', () => {
    const { doc, t } = setup();
    expect(parseCSV('a,"b, c","d ""q"""\r\n1,2,3\n')).toEqual([['a', 'b, c', 'd "q"'], ['1', '2', '3']]);
    let n;
    doc.transact('import', () => {
      n = importCSV(doc, 'Title,#Badge\n"Spring, 2027",yes\nSummer,no\n');
    });
    expect(n).toBe(2);
    const [title, badge] = variablesOf(doc);
    expect(badge.type).toBe('visibility');
    doc.transact('bind', () => bind(doc, t.id, 'text', title.id));
    doc.transact('apply', () => applyDataSet(doc, dataSetsOf(doc)[0].id, setText));
    expect(doc.get(t.id).text).toBe('Spring, 2027');
    expect(toCSV(doc)).toBe('Title,#Badge\r\n"Spring, 2027",true\r\nSummer,false\r\n');
    doc.transact('remove', () => removeVariables(doc, [title.id]));
    expect(doc.get(t.id).bindings).toBeUndefined();
    expect(Object.keys(dataSetsOf(doc)[0].values)).toEqual([badge.id]);
  });

  it('registers the Variables panel', async () => {
    const app = await bootAppWithFeatures();
    expect(app.commands.get('panel.variables')).toBeTruthy();
  });
});
