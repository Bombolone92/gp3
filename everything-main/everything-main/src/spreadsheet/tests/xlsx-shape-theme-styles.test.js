import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { shapeXlsx } from './helpers/xlsx-shape-fixture.js';

function edit(zip, path, fn) {
  const part = X.CFB.find(zip, path);
  part.content = new TextEncoder().encode(fn(new TextDecoder().decode(part.content))); part.size = part.content.length;
}
const bytes = zip => X.CFB.write(zip, { type: 'array', fileType: 'zip' });
const svg = c => Buffer.from(c.src.split(',')[1], 'base64').toString();
function themed({ inherited = false, width = 97, height = 43 } = {}) {
  const zip = X.CFB.read(new Uint8Array(shapeXlsx({ preset: 'ellipse', text: 'Editable caption', width, height })), { type: 'array' });
  edit(zip, '/xl/theme/theme1.xml', xml => xml
    .replace(/<a:fillStyleLst>[\s\S]*?<\/a:fillStyleLst>/, '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"><a:shade val="75000"/></a:schemeClr></a:solidFill><a:noFill/><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="000000"/></a:gs><a:gs pos="100000"><a:srgbClr val="ffffff"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill></a:fillStyleLst>')
    .replace(/<a:lnStyleLst>[\s\S]*?<\/a:lnStyleLst>/, '<a:lnStyleLst><a:ln w="12700"><a:noFill/></a:ln><a:ln w="38100" cap="rnd"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst>')
    .replace(/<a:effectStyleLst>[\s\S]*?<\/a:effectStyleLst>/, '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'));
  edit(zip, '/xl/drawings/shapes.xml', xml => {
    if (inherited) xml = xml.replace('<a:solidFill><a:srgbClr val="FFF254"/></a:solidFill>', '').replace('<a:ln><a:noFill/></a:ln>', '<a:ln cap="flat"/>');
    return xml.replace('<xdr:txBody>', `<xdr:style><a:lnRef idx="2"><a:srgbClr val="123456"/></a:lnRef><a:fillRef idx="${inherited ? 1 : 3}"><a:srgbClr val="804020"/></a:fillRef><a:effectRef idx="1"><a:srgbClr val="000000"/></a:effectRef><a:fontRef idx="minor"><a:srgbClr val="000000"/></a:fontRef></xdr:style><xdr:txBody>`);
  });
  return bytes(zip);
}
async function external(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  edit(zip, '/xl/workbook.xml', xml => xml.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return { back: await workbookFromFile(bytes(zip), 'native.xlsx'), xml: new TextDecoder().decode(X.CFB.find(zip, '/xl/drawings/drawing1.xml').content) };
}

it.each([{ width: 73, height: 29 }, { width: 231, height: 184 }])('keeps explicitly formatted themed shapes editable at %j', async options => {
  let wb = await workbookFromFile(themed(options), 'themed.xlsx');
  const original = wb.activeSheet.charts[0];
  expect(original.nativeDrawing).toBeTruthy();
  expect(svg(original)).toContain('fill="#fff254"');
  expect(svg(original)).not.toContain('stroke=');
  for (let pass = 0; pass < 2; pass++) {
    const { back, xml } = await external(wb); wb = back;
    expect(xml).toContain('<a:prstGeom prst="ellipse">');
    expect(xml).toContain('<a:effectLst/>');
    expect(xml).toContain('w="38100"');
    expect(xml).toContain('Editable caption');
    expect(xml).not.toMatch(/<xdr:pic>|<a:fillRef|<a:lnRef|<a:schemeClr/);
    expect(svg(wb.activeSheet.charts[0])).toContain('fill="#fff254"');
    for (const k of ['w', 'h', 'dx', 'dy']) expect(wb.activeSheet.charts[0][k]).toBeCloseTo(original[k], 4);
  }
});

it('uses inherited paint, transforms and line width both on screen and in native export', async () => {
  const wb = await workbookFromFile(themed({ inherited: true, width: 63, height: 117 }), 'inherited.xlsx');
  const original = wb.activeSheet.charts[0];
  expect(original.nativeDrawing).toBeTruthy();
  expect(svg(original)).toContain('fill="#603018"');
  expect(svg(original)).toContain('stroke="#123456" stroke-width="38100"');
  expect(original.w).toBeCloseTo(63 + 38100 / 9525);
  const { back, xml } = await external(wb);
  expect(xml).toContain('val="603018"');
  expect(xml).toContain('val="123456"');
  expect(xml).not.toContain('<xdr:pic>');
  expect(svg(back.activeSheet.charts[0])).toContain('fill="#603018"');
  expect(svg(back.activeSheet.charts[0])).toContain('stroke="#123456" stroke-width="38100"');
});

it('keeps native themed shape records through copies, resizing and undo', async () => {
  const wb = await workbookFromFile(themed(), 'copy.xlsx'), id = wb.activeSheetId;
  const original = wb.activeSheet.charts[0];
  const copy = wb.duplicateChart(id, original.id);
  expect(wb.activeSheet.charts.find(c => c.id === copy).nativeDrawing).toEqual(original.nativeDrawing);
  wb.updateChart(id, copy, { w: 211, h: 79, rotation: 37 });
  const { xml, back } = await external(wb);
  expect(xml.match(/<a:prstGeom prst="ellipse">/g)).toHaveLength(2);
  expect(back.activeSheet.charts[1].w).toBeCloseTo(211);
  expect(back.activeSheet.charts[1].rotation).toBe(37);
  wb.undo();
  expect(wb.activeSheet.charts.find(c => c.id === copy).w).toBe(original.w);
});
