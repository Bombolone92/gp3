import { afterEach, expect, it, vi } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
const src = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 13"><title>日本語</title><path fill="#348967" d="M0 0L21 0L5 13Z"/></svg>').toString('base64');
afterEach(() => vi.unstubAllGlobals());
async function packageFor() {
  const wb = new Workbook({ sheets: [{ name: 'Vectors', charts: [{ type: 'image', src, anchor: { r: 3, c: 2 }, w: 237, h: 93, rotation: 37, srcRect: { t: .2 } }] }] });
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return zip;
}
const load = zip => workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'vector.xlsx');
function patch(zip, path, edit) {
  const p = X.CFB.find(zip, path);
  p.content = new TextEncoder().encode(edit(new TextDecoder().decode(p.content)));
  p.size = p.content.length;
}

it('reopens directly embedded SVG pictures without private metadata or a DOM', async () => {
  const wb = await load(await packageFor());
  expect(wb.activeSheet.charts).toHaveLength(1);
  expect(wb.activeSheet.charts[0]).toMatchObject({ src, anchor: { r: 3, c: 2 }, w: 237, h: 93, rotation: 37, srcRect: { t: .2 } });
});

it('keeps the original SVG beside the browser-generated PNG fallback on native export', async () => {
  vi.stubGlobal('Image', class { set src(value) { this.onload(); } });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/png;base64,AQID' }) });
  const zip = await packageFor();
  const drawing = new TextDecoder().decode(X.CFB.find(zip, '/xl/drawings/drawing1.xml').content);
  expect(drawing).toContain('<asvg:svgBlip');
  expect(X.CFB.find(zip, '/xl/media/image1_1.png')).toBeTruthy();
  expect(X.CFB.find(zip, '/xl/media/image1_1.svg')).toBeTruthy();
  vi.unstubAllGlobals();
  const back = await load(zip);
  expect(back.activeSheet.charts[0].src).toBe(src);
});

it.each(['embedded', 'missing', 'external'])('uses the Office SVG extension with safe raster fallback: %s', async mode => {
  const zip = await packageFor();
  patch(zip, '/xl/drawings/drawing1.xml', xml => xml.replace('<a:blip r:embed="rId1"/>', '<a:blip r:embed="raster"><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rId1"/></a:ext></a:extLst></a:blip>'));
  patch(zip, '/xl/drawings/_rels/drawing1.xml.rels', xml => {
    if (mode === 'missing') xml = xml.replace('Target="../media/image1_1.svg"', 'Target="../media/absent.svg"');
    if (mode === 'external') xml = xml.replace('Target="../media/image1_1.svg"', 'Target="https://example.invalid/vector.svg" TargetMode="External"');
    return xml.replace('</Relationships>', '<Relationship Id="raster" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/fallback.png"/></Relationships>');
  });
  X.CFB.utils.cfb_add(zip, '/xl/media/fallback.png', new Uint8Array([1, 2, 3]));
  const wb = await load(zip);
  expect(wb.activeSheet.charts).toHaveLength(1);
  expect(wb.activeSheet.charts[0].src).toBe(mode === 'embedded' ? src : 'data:image/png;base64,AQID');
});
