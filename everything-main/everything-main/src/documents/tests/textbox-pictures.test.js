import { assertPackageParts } from './helpers/assert-package-parts.js';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
import { canonicalXml } from './helpers/canonical-xml.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
it.each(['textbox-pictures','reflected-textboxes'])('retains inline pictures and drawing XML through edit/export/undo: %s',async folder=>{
 const root=`tests/fixtures/${folder}/`;
 const bytes=readFileSync(root+'control.docx'),ref=JSON.parse(readFileSync(root+'reference.json'));
 const hash=b=>createHash('sha256').update(b).digest('hex');expect(hash(bytes)).toBe(ref.sourceSha256);expect(hash(readFileSync(root+'native.pdf'))).toBe(ref.pdfSha256);
 const p=await DocxPackage.open(bytes),scenes=Object.values(p.assets).filter(a=>a.scene).map(a=>a.scene);
 const pictures=n=>[...(n.text?.paragraphs.flatMap(p=>p.runs.filter(r=>r.image).map(r=>r.image))||[]),...(n.children||[]).flatMap(pictures)];
 expect(scenes.flatMap(pictures)).toHaveLength(ref.pages.length);
 for(const image of scenes.flatMap(pictures))expect(p.assets[image.assetId]).toBeDefined();
 const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets),parts=unzipSync(bytes);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 assertPackageParts(unzipSync(await save()), parts);d.select(0);d.replace('Added ');const edited=await save(),out=unzipSync(edited);
 expectBodyEditParts(out,parts);
 // Paragraph IDs are session-local; retained drawing XML/formatting is not.
 // Drawing shells compare as XML: export may hoist their namespace declarations.
const stable=value=>JSON.parse(JSON.stringify(value,(key,value)=>key==='id'&&typeof value==='string'&&/^p\d+$/.test(value)?undefined:key==='shell'&&typeof value==='string'?canonicalXml(value):value));
 const reopened=await DocxPackage.open(edited);expect(stable(Object.values(reopened.assets).filter(a=>a.scene).map(a=>a.scene))).toEqual(stable(scenes));
 d.undo();assertPackageParts(unzipSync(await save()), parts);
});
