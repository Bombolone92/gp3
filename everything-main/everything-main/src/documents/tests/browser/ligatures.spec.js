import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const root='tests/fixtures/latin-ligature-defaults/';
async function requireCalibri(page) {
 const available=await page.evaluate(async()=>{const {prepareCanvasFont,fontAvailable}=await import('/src/engine/font-availability.js');await prepareCanvasFont('Calibri');return fontAvailable('Calibri');});
 test.skip(!available,'The recorded native widths require installed Calibri.');
}
for(const enabled of [0,1])test(`matches native ligature defaults with OpenType ${enabled}`,async({page})=>{
 test.setTimeout(120000);await page.goto('/playground.html');await requireCalibri(page);
 const rows=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const {validateCanvasLayout,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await validateCanvasLayout(p);
  const c=document.createElement('canvas').getContext('2d');const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(c,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories,{styles:p.styles});
  return l.lines.filter(l=>l.fragments.some(f=>f.text)).map(l=>({text:l.fragments.map(f=>f.text||'').join(''),xPt:l.fragments[0].x*.75}));
 },readFileSync(root+`control-${enabled}.docx`).toString('base64'));
 const native=JSON.parse(readFileSync(root+'reference.json'))[enabled].rows;
 expect(rows).toHaveLength(native.length);rows.forEach((r,i)=>{expect(r.text).toBe(native[i].text);expect(Math.abs(r.xPt-native[i].xPt),JSON.stringify({actual:r,native:native[i]})).toBeLessThan(.22);});
});
test('turns optional ligatures off while retaining explicit kerning and required Arabic shaping',async({page})=>{
 await page.goto('/playground.html');await requireCalibri(page);const rows=await page.evaluate(async()=>{
  const {prepareCanvasFont}=await import('/src/engine/font-availability.js');await prepareCanvasFont('Calibri');
  const {setCanvasTextStyle}=await import('/src/engine/canvas-text.js');const c=document.createElement('canvas').getContext('2d');const rows=[];
  for(const ligatures of ['none','standardContextual'])for(const kerning of [0,1]){setCanvasTextStyle(c,{fontFamily:'Calibri',fontSize:1536,ligatures,kerning});rows.push({ti:c.measureText('ti').width,av:c.measureText('AV').width,arabic:c.measureText('سلام').width,mode:c.textRendering});}return rows;
 });
 expect(rows[0].ti).toBe(1156);expect(rows[2].ti).toBe(1141);
 expect(rows[0].av).toBe(rows[2].av);expect(rows[1].av).toBe(rows[3].av);expect(rows[1].av).toBeLessThan(rows[0].av);
 expect(rows[0].arabic).toBe(rows[2].arabic);expect(rows[1].arabic).toBe(rows[3].arabic);
 expect(rows.map(r=>r.mode)).toEqual(['optimizeSpeed','optimizeSpeed','auto','auto']);
});

test('exports an explicit ligature edit with retained compatibility settings',async({page},info)=>{
 await page.goto('/playground.html');
 const result=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const {TextDocument}=await import('/src/engine/model.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
  d.select(0,d.paragraphs[0].runs[0].text.length);d.setRunFormat({ligatures:'standardContextual'});
  d.select(d.paragraphs[0].runs[0].text.length+1);d.createParagraphStyle('Ligature inheritance');d.editParagraphStyle(d.paragraphs[1].styleId,{run:{ligatures:'standardContextual'}});
  const buffer=await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer();
  const reopened=await DocxPackage.open(new Uint8Array(buffer));return {bytes:Array.from(new Uint8Array(buffer)),mode:reopened.paragraphs[0].runs[0].ligatures,styleMode:reopened.paragraphs[1].runs[0].ligatures};
 },readFileSync(root+'control-1.docx').toString('base64'));
 expect(result.mode).toBe('standardContextual');expect(result.styleMode).toBe('standardContextual');
 const {writeFileSync}=await import('node:fs');writeFileSync(info.outputPath('edited.docx'),Buffer.from(result.bytes));
});
