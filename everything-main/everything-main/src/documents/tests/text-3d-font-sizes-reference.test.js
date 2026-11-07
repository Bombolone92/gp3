import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {JSDOM} from 'jsdom';

it('isolates reference text bevel silhouettes from ordinary synthetic bold',()=>{
  const root='tests/fixtures/text-3d/', ref=JSON.parse(readFileSync(root+'font-sizes-reference.json'));
  for(const [name,hash] of Object.entries(ref.hashes))
    expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(hash);
  const plain=unzipSync(readFileSync(root+'font-sizes-plain.docx'));
  const effect=unzipSync(readFileSync(root+'font-sizes.docx'));
  expect(Object.keys(effect)).toEqual(Object.keys(plain));
  const parse=bytes=>new JSDOM(strFromU8(bytes),{contentType:'text/xml'}).window.document;
  const xml=parse(effect['word/document.xml']), ns='http://schemas.microsoft.com/office/word/2010/wordml';
  const effects=[...xml.getElementsByTagNameNS(ns,'props3d')];
  expect(effects).toHaveLength(8);
  for(const node of effects){
    expect(node.getAttributeNS(ns,'prstMaterial')).toBe('matte');
    const bevel=node.getElementsByTagNameNS(ns,'bevelT')[0];
    expect(bevel.getAttributeNS(ns,'w')).toBe('63500');
    expect(bevel.getAttributeNS(ns,'h')).toBe('12700');
    node.remove();
  }
  expect(xml.documentElement.outerHTML).toBe(parse(plain['word/document.xml']).documentElement.outerHTML);
  for(const name of Object.keys(plain).filter(n=>n!=='word/document.xml'))expect(effect[name]).toEqual(plain[name]);
  expect(ref.records).toHaveLength(8);
  for(const record of ref.records){
    expect(record.effect.samples.length).toBeGreaterThan(0);
    expect(record.effect.followingOriginPt).toEqual(record.plain.followingOriginPt);
  }
  const regular=ref.records.find(r=>r.font==='Franklin Gothic Book'&&r.size===144&&!r.bold);
  const bold=ref.records.find(r=>r.font==='Franklin Gothic Book'&&r.size===144&&r.bold);
  // Measured native behavior, not a production contour correction formula:
  // ordinary bold grows left/up/down; 3D bold does not reuse that silhouette.
  expect(regular.effect.inkBoundsPt[0]-bold.effect.inkBoundsPt[0]).toBeLessThan(.5);
  expect(regular.plain.inkBoundsPt[0]-bold.plain.inkBoundsPt[0]).toBeGreaterThan(2);
  expect(bold.effect.inkBoundsPt[1]-bold.plain.inkBoundsPt[1]).toBeGreaterThan(1);
});
