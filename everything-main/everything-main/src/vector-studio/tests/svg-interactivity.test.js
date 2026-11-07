import { describe, it, expect } from 'vitest';
import { VDocument } from '../src/model/document.js';
import { createPath } from '../src/model/nodes.js';
import { rectangle } from '../src/model/shapes.js';
import { exportSVG } from '../src/features/io/svg-export.js';
import { install, svgEventAttrs } from '../src/features/svg-interactivity/index.js';

describe('SVG interactivity', () => {
  it('writes event handlers and document scripts into exported SVG', () => {
    install({ registerPanel() {} });
    const doc = VDocument.create({ width: 100, height: 100 });
    const r = createPath(rectangle(0, 0, 10, 10), true, { svgEvents: { onclick: 'alert("hi" & 1)' } });
    doc.transact('add', () => {
      doc.insert(r, doc.layers()[0].id);
      doc.updateRoot({ svgScripts: ['lib.js'], svgScript: 'var a = 1 ]]> 2;' });
    });
    const svg = exportSVG(doc, { rect: { x: 0, y: 0, w: 100, h: 100 } });
    expect(svg).toContain('onclick="alert(&quot;hi&quot; &amp; 1)"');
    expect(svg).toContain('<script href="lib.js"/>');
    expect(svg).toContain('<![CDATA[');
    expect(svg).not.toMatch(/var a = 1 \]\]> 2/);
    expect(svgEventAttrs({})).toBe('');
  });
});
