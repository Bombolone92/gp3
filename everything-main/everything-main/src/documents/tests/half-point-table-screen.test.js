import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {JSDOM} from 'jsdom';
const folder='tests/fixtures/half-point-table-screen/';
const source=readFileSync(folder+'control.docx'),cases=JSON.parse(readFileSync(folder+'cases.json'));
const reference=JSON.parse(readFileSync(folder+'native-screen-reference.json'));
const hash=b=>createHash('sha256').update(b).digest('hex');

it('binds neutral and colored live reference rule strips to original source and crops',()=>{
  expect(hash(source)).toBe(reference.sourceSha256);
  expect(reference.observations.map(o=>o.zoom)).toEqual([100,200]);
  for(const observation of reference.observations){
    expect(hash(readFileSync(folder+observation.crop))).toBe(observation.cropSha256);
    expect(observation.profiles).toHaveLength(56);
    for(const profile of observation.profiles){
      expect(profile.nativeBounds[1]-profile.nativeBounds[0]).toBe(1);
      expect(profile.rgb).toHaveLength(9);
      if(profile.color==='auto')expect(Math.max(...profile.nativeStrongest)).toBeLessThanOrEqual(1);
    }
  }
});

it('independently declares connected half-point tables, themes, exact row heights and four phases',()=>{
  const parts=unzipSync(source),dom=new JSDOM(),parser=new dom.window.DOMParser();
  try {
    const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const xml=parser.parseFromString(new TextDecoder().decode(parts['word/document.xml']),'application/xml');
    const tables=[...xml.getElementsByTagNameNS(W,'tbl')];expect(tables).toHaveLength(12);
    for(const [i,table] of tables.entries()){
      const c=cases[i],position=table.getElementsByTagNameNS(W,'tblpPr')[0];
      expect(Number(position.getAttributeNS(W,'tblpX'))).toBe(c.xTwips);
      expect(Number(position.getAttributeNS(W,'tblpY'))).toBe(c.yTwips);
      for(const border of table.getElementsByTagNameNS(W,'tblBorders')[0].children){
        expect(border.getAttributeNS(W,'sz')).toBe('4');expect(border.getAttributeNS(W,'val')).toBe('single');
        expect(border.getAttributeNS(W,'color')).toBe(c.color);
        expect(border.getAttributeNS(W,'themeColor')).toBe(c.theme);
      }
      for(const height of table.getElementsByTagNameNS(W,'trHeight')){
        expect(height.getAttributeNS(W,'val')).toBe('360');expect(height.getAttributeNS(W,'hRule')).toBe('exact');
      }
      expect(table.getElementsByTagNameNS(W,'tc')).toHaveLength(4);
    }
    expect(xml.getElementsByTagNameNS(W,'t')).toHaveLength(0);
    expect(Object.keys(parts).some(n=>/font|media/i.test(n))).toBe(false);
  } finally {dom.window.close();}
});
