import { describe, expect, it } from 'vitest';
import { layer, newDocument, type PhotoDocument } from '../src/model/document';
import { createArtboard } from '../src/model/artboard';
import { closedPath, ellipseKnots, liveKnots } from '../src/features/vector/geometry';
import { shapeLayer } from '../src/features/vector/state';
import type { VectorStroke } from '../src/model/vector-stroke';
import { textLayer } from '../src/imaging/text/model';
import { defaultDropShadow } from '../src/imaging/effects/types';
import { cssColor, formatCss, selectionCss, selectionSvg, slugger, type RasterLayer } from '../src/features/layout/code-export';

const red = { rgb: [1, 0, 0] as [number, number, number], space: 'srgb' as const };
const doc = () => newDocument(800, 600, 'page');
const stroke = (alignment: VectorStroke['alignment'], width = 4): VectorStroke => ({
  enabled: true,
  fillEnabled: true,
  lineWidth: { value: width, units: 'Pixels' },
  lineDashOffset: { value: 0, units: 'Pixels' },
  resolution: 72,
  cap: 'butt',
  join: 'miter',
  alignment,
  miterLimit: 4,
  opacity: 1,
  color: { rgb: [0, 0, 1], space: 'srgb' },
});
function roundRect(d: PhotoDocument, s?: VectorStroke) {
  const live = { kind: 'rect' as const, x: 40, y: 30, width: 120, height: 80, radii: [10, 10, 10, 10] as [number, number, number, number] };
  return shapeLayer(d, 'Hero Card', { paths: [closedPath(liveKnots(live))] }, red, s, live);
}
const decl = (css: string, name: string) => new RegExp(`\\b${name}: ([^;]+);`).exec(css)?.[1];
const noRaster: RasterLayer = async () => undefined;

describe('Copy CSS', () => {
  it('describes a rounded rectangle with an inside stroke', () => {
    const d = doc();
    const l = roundRect(d, stroke('inside'));
    l.opacity = 0.5;
    l.blend = 'multiply';
    const css = formatCss(selectionCss(d, [l]));
    expect(css.startsWith('.hero-card {')).toBe(true);
    expect(decl(css, 'position')).toBe('absolute');
    expect([decl(css, 'left'), decl(css, 'top'), decl(css, 'width'), decl(css, 'height')]).toEqual(['40px', '30px', '120px', '80px']);
    expect(decl(css, 'background-color')).toBe('#ff0000');
    expect(decl(css, 'border')).toBe('4px solid #0000ff');
    expect(decl(css, 'box-sizing')).toBe('border-box');
    expect(decl(css, 'border-radius')).toBe('10px 10px 10px 10px');
    expect(decl(css, 'opacity')).toBe('0.5');
    expect(decl(css, 'mix-blend-mode')).toBe('multiply');
  });
  it('grows the box for a centered stroke and scales radii with the layer', () => {
    const d = doc();
    const l = roundRect(d, stroke('center', 2));
    l.transform = { x: 40, y: 30, width: 240, height: 80, rotation: 0 };
    const css = formatCss(selectionCss(d, [l]));
    expect([decl(css, 'left'), decl(css, 'width')]).toEqual(['39px', '242px']);
    expect(decl(css, 'border-radius')).toBe('20px 20px 20px 20px / 10px 10px 10px 10px');
  });
  it('rounds an ellipse fully and adds shadows from the layer style', () => {
    const d = doc();
    const live = { kind: 'ellipse' as const, x: 0, y: 0, width: 100, height: 50 };
    const l = shapeLayer(d, 'Dot', { paths: [closedPath(ellipseKnots(0, 0, 100, 50))] }, red, undefined, live);
    l.style = { enabled: true, dropShadow: [{ ...defaultDropShadow(), angle: 90, useGlobalLight: false, distance: 4, size: 6 }] };
    const css = formatCss(selectionCss(d, [l]));
    expect(decl(css, 'border-radius')).toBe('50%');
    expect(decl(css, 'box-shadow')).toBe('0 4px 6px 0 rgba(0, 0, 0, 0.35)');
  });
  it('describes text typography', () => {
    const d = doc();
    const l = layer('text', 'Headline', 1, 1);
    l.textData = textLayer('Hello', { family: 'Inter', size: 36, weight: 700, tracking: 50, color: [255, 0, 0], underline: true });
    l.textData.content.paragraphs[0].style.align = 'center';
    l.transform = { x: 10, y: 20, width: 200, height: 50, rotation: 0 };
    const css = formatCss(selectionCss(d, [l]));
    expect(decl(css, 'font-family')).toBe('"Inter", sans-serif');
    expect(decl(css, 'font-size')).toBe('36px');
    expect(decl(css, 'font-weight')).toBe('700');
    expect(decl(css, 'color')).toBe('#ff0000');
    expect(decl(css, 'line-height')).toBe('normal');
    expect(decl(css, 'letter-spacing')).toBe('0.05em');
    expect(decl(css, 'text-align')).toBe('center');
    expect(decl(css, 'text-decoration')).toBe('underline');
  });
  it('describes solid fills and images', () => {
    const d = doc();
    const s = layer('solid', 'Backdrop', 800, 600);
    s.color = '#336699';
    s.fillOpacity = 0.5;
    const img = layer('image', 'Photo', 100, 100);
    const css = formatCss(selectionCss(d, [s, img]));
    expect(css).toContain('background-color: rgba(51, 102, 153, 0.5);');
    expect(css).toContain('/* image: photo.png */');
    expect(css).toContain('background-image: url("photo.png");');
  });
  it('positions layers relative to their artboard and lists the artboard box', () => {
    const d = doc();
    const a = createArtboard(d, { x: 100, y: 50, width: 400, height: 300 }, { background: 'custom', color: '#eeeeee' });
    const l = layer('solid', 'Badge', 10, 10);
    l.transform = { x: 120, y: 80, width: 40, height: 20, rotation: 30 };
    const hidden = layer('solid', 'Hidden', 10, 10);
    hidden.visible = false;
    a.children = [hidden, l];
    d.layers = [a];
    const rules = selectionCss(d, [a]);
    expect(rules.map((r) => r.selector)).toEqual(['.artboard-1', '.badge']);
    const css = formatCss(rules);
    expect(css).toContain('background-color: #eeeeee;');
    expect(css).toContain('overflow: hidden;');
    const badge = formatCss([rules[1]]);
    expect([decl(badge, 'left'), decl(badge, 'top')]).toEqual(['20px', '30px']);
    expect(decl(badge, 'transform')).toBe('rotate(30deg)');
    // Selected directly, a child still measures from its artboard.
    expect(formatCss(selectionCss(d, [l]))).toContain('left: 20px;');
  });
  it('makes unique class names from layer names', () => {
    const slug = slugger();
    expect(['Hero Title', 'Hero title', '3 Columns', '', 'Café — Menu'].map(slug)).toEqual(['hero-title', 'hero-title-2', 'layer-3-columns', 'layer', 'cafe-menu']);
    expect(cssColor([255, 128, 0])).toBe('#ff8000');
    expect(cssColor([255, 128, 0], 0.25)).toBe('rgba(255, 128, 0, 0.25)');
  });
});

describe('Copy SVG', () => {
  it('writes a vector shape as a path in a view box at its bounds', async () => {
    const d = doc();
    const l = roundRect(d, stroke('inside'));
    l.opacity = 0.8;
    const svg = await selectionSvg(d, [l], noRaster);
    expect(svg).toContain('viewBox="40 30 120 80"');
    expect(svg).toContain('width="120" height="80"');
    expect(svg).toMatch(/<g id="Hero-Card" opacity="0.8"><g clip-path="url\(#ps-1\)"><path d="M[^"]+Z" fill="#ff0000" fill-rule="evenodd" stroke="#0000ff" stroke-width="8"/);
    expect(svg).toContain('<clipPath id="ps-1"><path d="M');
  });
  it('writes text and solid fills, and embeds other layers as images', async () => {
    const d = doc();
    const t = layer('text', 'Title', 1, 1);
    t.textData = textLayer('A & B', { family: 'Inter', size: 24, color: [0, 0, 0] });
    t.textData.origin = { x: 10, y: 40 };
    t.transform = { x: 10, y: 16, width: 60, height: 30, rotation: 0 };
    t.textFrame = { x: 10, y: 16, width: 60, height: 30 };
    const s = layer('solid', 'Fill', 10, 10);
    s.transform = { x: 0, y: 0, width: 50, height: 50, rotation: 0 };
    s.color = '#00ff00';
    const p = layer('pixel', 'Pixels', 10, 10);
    p.transform = { x: 100, y: 100, width: 10, height: 10, rotation: 0 };
    const seen: string[] = [];
    const raster: RasterLayer = async (l) => {
      seen.push(l.name);
      return { x: 100, y: 100, width: 10, height: 10, png: new Uint8Array([1, 2, 3]) };
    };
    const svg = await selectionSvg(d, [s, t, p], raster);
    expect(svg).toContain('viewBox="0 0 110 110"');
    expect(svg).toContain('<rect x="0" y="0" width="50" height="50" fill="#00ff00"/>');
    expect(svg).toContain('<tspan x="10" y="40"><tspan font-family="Inter" font-size="24" fill="#000000">A &amp; B</tspan></tspan>');
    expect(svg).toContain('href="data:image/png;base64,AQID"');
    expect(seen).toEqual(['Pixels']);
  });
  it('clips artboard groups and paints their background', async () => {
    const d = doc();
    const a = createArtboard(d, { x: 0, y: 0, width: 100, height: 100 }, { background: 'black' });
    a.children = [roundRect(d)];
    d.layers = [a];
    const svg = await selectionSvg(d, [a], noRaster);
    expect(svg).toContain('<clipPath id="ps-1"><rect x="0" y="0" width="100" height="100"/></clipPath>');
    expect(svg).toContain('clip-path="url(#ps-1)"><rect x="0" y="0" width="100" height="100" fill="#000000"/>');
  });
});
