// Native-layout diagnostic; the source/row/margin controls also have CI tests.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {DocxPackage} from '../src/engine/docx.js';
import {fixedColumnWidths,rowGrid,spanWidth} from '../src/engine/tables.js';
const folder=new URL('../tests/fixtures/fixed-table-reduction/',import.meta.url);
const source=readFileSync(new URL('source.docx',folder));
const ref=JSON.parse(readFileSync(new URL('native-reference.json',folder),'utf8').replace(/^\uFEFF/,''));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if(hash(source)!==ref.sourceSha256||hash(readFileSync(new URL('native.pdf',folder)))!==ref.pdfSha256)throw Error('Stale native reference');
const dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;
try {
 const pkg=await DocxPackage.open(source);let failures=0;
 for(let i=0;i<pkg.tables.length;i++){
  const table=pkg.tables[i],widths=fixedColumnWidths(table,10800);
  const cells=table.rows.flatMap(row=>rowGrid(row).map(({column,span})=>spanWidth(widths,column,span)/20));
  const expected=ref.tables[i].cells.map(c=>c.widthPt);
  if(cells.length!==expected.length)throw Error('Cell count mismatch');
  const error=Math.max(...cells.map((w,j)=>Math.abs(w-expected[j])));
  const pass=error<.2;if(!pass)failures++;
  console.log(`${pass?'PASS':'FAIL'} ${ref.tables[i].name}: max width error ${error.toFixed(4)} pt; app ${cells.map(w=>w.toFixed(3))}; reference ${expected}`);
 }
 process.exitCode=failures?1:0;
} finally {dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;}
