import {beforeAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
beforeAll(()=>{const w=new JSDOM('').window;globalThis.DOMParser=w.DOMParser;globalThis.XMLSerializer=w.XMLSerializer;});
const names=['legacy-table-indent','legacy-table-indent-12','legacy-table-indent-15','legacy-table-origin','legacy-table-origin-no-styles','legacy-table-origin-custom-style','table-style-origin-properties','legacy-table-indent-no-styles','legacy-table-origin-asymmetric','legacy-table-origin-no-styles-asymmetric','legacy-table-origin-left-asymmetric'];
for(const name of names)it(name+' matches independent native reference picture origins without mutating the tables',async()=>{
 const pkg=await DocxPackage.open(readFileSync(`public/fixtures/${name}.docx`));
 const before=JSON.stringify(pkg.tables),ref=JSON.parse(readFileSync(`tests/fixtures/${name}/reference.json`));
 const layout=layoutDocument(pkg.paragraphs,(text,style)=>({width:text.length*style.fontSize*.6,ascent:style.fontSize,descent:style.fontSize*.25}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
 const images=layout.lines.flatMap(l=>l.fragments.filter(f=>f.image));expect(images).toHaveLength(ref.pictures.length);
 for(const [i,f]of images.entries()){expect(f.x*.75).toBeCloseTo(ref.pictures[i].x,1);expect(f.width*.75).toBeCloseTo(ref.pictures[i].width,1);}
 expect(JSON.stringify(pkg.tables)).toBe(before);
});
for(const type of ['auto','pct'])it('ignores '+type+' table indentation without changing its reference edge',async()=>{
 const parts=unzipSync(readFileSync('public/fixtures/legacy-table-origin-no-styles.docx'));
 parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('<w:tblLayout',`<w:tblInd w:w="360" w:type="${type}"/><w:tblLayout`));
 const p=await DocxPackage.open(zipSync(parts));
 const l=layoutDocument(p.paragraphs,(text,style)=>({width:text.length*style.fontSize*.6,ascent:style.fontSize,descent:style.fontSize*.25}),pageGeometry(p.pageSettings),p.numbering,p.tables);
 const image=l.lines.flatMap(l=>l.fragments).find(f=>f.image);
 expect(image.x*.75).toBeCloseTo(77.4,1);
});
