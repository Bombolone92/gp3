import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {JSDOM} from 'jsdom';

it('binds the default text-scene observation to independent explicit-scene controls',()=>{
  const root='tests/fixtures/text-3d/', ref=JSON.parse(readFileSync(root+'scene-reference.json'));
  const bytes=readFileSync(root+'scene-control.docx');
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
  expect(createHash('sha256').update(readFileSync(root+'scene-native.pdf')).digest('hex')).toBe(ref.pdfSha256);
  const xml=new JSDOM(strFromU8(unzipSync(bytes)['word/document.xml']),{contentType:'text/xml'}).window.document;
  const ns='http://schemas.microsoft.com/office/word/2010/wordml';
  const scenes=[...xml.getElementsByTagNameNS(ns,'scene3d')];
  expect(scenes).toHaveLength(6);
  expect(scenes.map(s=>s.getElementsByTagNameNS(ns,'camera')[0].getAttributeNS(ns,'prst'))).toEqual(Array(6).fill('orthographicFront'));
  expect(scenes.map(s=>s.getElementsByTagNameNS(ns,'lightRig')[0].getAttributeNS(ns,'rig'))).toEqual(['threePt','balanced','twoPt','threePt','balanced','twoPt']);
  for(const start of [0,4]){
    expect(ref.records[start].rig).toBeNull();
    expect(ref.records[start].glyphRegionSha256).toBe(ref.records[start+1].glyphRegionSha256);
    expect(ref.records[start].glyphRegionSha256).not.toBe(ref.records[start+2].glyphRegionSha256);
    expect(ref.records[start].glyphRegionSha256).not.toBe(ref.records[start+3].glyphRegionSha256);
  }
});
