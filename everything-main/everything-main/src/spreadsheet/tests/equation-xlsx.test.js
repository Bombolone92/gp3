import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import { builtinEquation, equationText, equationOmml } from '../src/core/equation.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

const decode = bytes => new TextDecoder().decode(bytes);
async function exported(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const path = zip.FullPaths.find(p => /drawings\/drawing\d+\.xml$/.test(p));
  const get = () => decode(X.CFB.find(zip, path).content);
  const set = xml => { const f = X.CFB.find(zip, path); f.content = new TextEncoder().encode(xml); f.size = f.content.length; };
  const open = () => workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'equation.xlsx');
  return { get, set, open };
}
const quadratic = builtinEquation('quadratic').source;
function withEquation(source = quadratic, style = {}) {
  const wb = new Workbook(); const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Roots');
  wb.addChart(id, { type: 'text', equation: source, text: equationText(source), anchor: { r: 2, c: 1 }, w: 180, h: 60, style: { size: 44 / 3, align: 'center', valign: 'middle', border: false, ...style } });
  return { wb, id };
}

it('exports an equation as a14 Office Math in a text box, linear text as the fallback', async () => {
  const { wb } = withEquation();
  const xml = (await exported(wb)).get();
  expect(xml).toMatch(/<mc:AlternateContent xmlns:mc="http:\/\/schemas.openxmlformats.org\/markup-compatibility\/2006"><mc:Choice xmlns:a14="http:\/\/schemas.microsoft.com\/office\/drawing\/2010\/main" Requires="a14"><xdr:oneCellAnchor>/);
  const [choice, fallback] = xml.split('<mc:Fallback>');
  expect(choice).toContain('<xdr:cNvSpPr txBox="1"/>');
  expect(choice).toContain(`<a14:m>${equationOmml(quadratic, { size: 11 })}</a14:m>`);
  expect(fallback).not.toContain('a14:m');
  expect(fallback).toContain(`<a:t>${equationText(quadratic)}</a:t>`);
  expect(fallback).toContain('<a:latin typeface="Cambria Math"');
  expect(fallback).toMatch(/<\/xdr:oneCellAnchor><\/mc:Fallback><\/mc:AlternateContent>/);
});

it('reads its own equation back editable, and takes an equation edited in another program', async () => {
  const { wb } = withEquation();
  const file = await exported(wb);
  let back = await file.open();
  let box = back.activeSheet.charts[0];
  expect(box).toMatchObject({ type: 'text', equation: quadratic, text: 'x=(−b±√(b^2−4ac))/(2a)' });
  // Excel edits the math: the 4 becomes a 5.
  file.set(file.get().replace(/<m:t>−4ac<\/m:t>/, '<m:t>−5ac</m:t>').replace(/<m:t>-4ac<\/m:t>/, '<m:t>−5ac</m:t>'));
  back = await file.open();
  box = back.activeSheet.charts[0];
  expect(box.type).toBe('text');
  expect(equationText(box.equation)).toBe('x=(−b±√(b^2−5ac))/(2a)');
});

it('opens an equation as Excel saves it, with no app metadata', async () => {
  const omml = '<m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:oMathParaPr><m:jc m:val="centerGroup"/></m:oMathParaPr><m:oMath>'
    + '<m:sSup><m:sSupPr><m:ctrlPr><a:rPr lang="en-US" sz="1400" i="1"><a:latin typeface="Cambria Math"/></a:rPr></m:ctrlPr></m:sSupPr><m:e><m:r><a:rPr lang="en-US" sz="1400" b="0" i="1"><a:latin typeface="Cambria Math"/></a:rPr><m:t>𝑎</m:t></m:r></m:e><m:sup><m:r><a:rPr lang="en-US" sz="1400" i="1"><a:latin typeface="Cambria Math"/></a:rPr><m:t>2</m:t></m:r></m:sup></m:sSup>'
    + '<m:r><a:rPr lang="en-US" sz="1400" i="1"><a:latin typeface="Cambria Math"/></a:rPr><m:t>+</m:t></m:r><m:sSup><m:e><m:r><m:t>b</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>'
    + '<m:r><m:t>=</m:t></m:r><m:sSup><m:e><m:r><m:t>c</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath></m:oMathPara>';
  const anchor = body => `<xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`
    + `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="2" name="TextBox 1"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1524000" cy="381000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="9525" cmpd="sng"><a:noFill/></a:ln></xdr:spPr>`
    + `<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip" wrap="none" rtlCol="0" anchor="t"><a:spAutoFit/></a:bodyPr><a:lstStyle/><a:p>${body}<a:endParaRPr lang="en-US" sz="1400"/></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`;
  const drawing = '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    + '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14">'
    + anchor(`<a14:m>${omml}</a14:m>`) + '</mc:Choice><mc:Fallback>' + anchor('<a:r><a:rPr lang="en-US" sz="1400" i="0"><a:latin typeface="Cambria Math"/></a:rPr><a:t>𝑎^2+𝑏^2=𝑐^2</a:t></a:r>')
    + '</mc:Fallback></mc:AlternateContent></xdr:wsDr>';
  const bytes = otherProgramsXlsx({ sheetNames: ['Math'], sheetXml: { Math: { rows: '<row r="1"><c r="A1" t="str"><v>Sides</v></c></row>', tail: '<drawing r:id="d1"/>' } } });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const add = (path, xml) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(xml));
  const types = X.CFB.find(zip, '/[Content_Types].xml');
  types.content = new TextEncoder().encode(decode(types.content).replace('</Types>', '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>'));
  types.size = types.content.length;
  add('xl/worksheets/_rels/sheet1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="d1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>');
  add('xl/drawings/drawing1.xml', drawing);
  const wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'excel.xlsx');
  const objects = wb.activeSheet.charts;
  expect(objects).toHaveLength(1);
  expect(objects[0]).toMatchObject({ type: 'text', text: 'a^2+b^2=c^2', style: { size: expect.closeTo(18.67, 1), align: 'center', valign: 'top' } });
  // Office's math italic letters read back as the letters typed.
  expect(objects[0].equation).toBe('a^2+b^2=c^2');
});

it('keeps an equation and its size through a save and a second save', async () => {
  const { wb } = withEquation('\\sum_{k=0}^{n}{\\binom{n}{k}x^k}', { size: 20, color: '#1f4e79' });
  let back = await (await exported(wb)).open();
  back = await (await exported(back)).open();
  const box = back.activeSheet.charts[0];
  expect(box.equation).toBe('\\sum_{k=0}^{n}{\\binom{n}{k}x^k}');
  expect(box.style).toMatchObject({ size: 20, color: '#1f4e79', align: 'center' });
});
