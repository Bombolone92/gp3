import {it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root='tests/fixtures/theme-channel-extrema/';
const cases=JSON.parse(readFileSync(root+'cases.json'));
const reference=JSON.parse(readFileSync(root+'reference.json'));
const saved=JSON.parse(readFileSync(root+'native-saved-colors.json'));

it('binds the independent extrema controls to their native PDF and source',()=>{
  for(const [name,key] of [['control.docx','sourceSha256'],['cases.json','casesSha256'],['native.pdf','pdfSha256']])
    expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(reference[key]);
  expect(cases).toHaveLength(128);expect(reference.pages).toBe(4);
  expect(reference.colors.map(c=>c.label)).toEqual(cases.map(c=>c.label));
});

it('preserves min/max channel results independently of the middle channel and tie count',()=>{
  const baseline=new Map(cases.slice(0,16).map((c,i)=>[`${c.mode}:${c.value}`,reference.colors[i].rgb]));
  // Six tied-channel bases cover both one-max and two-max cases in each sector.
  for(let i=16;i<112;i++){
    const c=cases[i], rgb=[...Buffer.from(c.base,'hex')], ordinary=baseline.get(`${c.mode}:${c.value}`);
    expect(new Set(rgb)).toEqual(new Set([79,189]));
    expect(reference.colors[i].rgb, c.label).toEqual(rgb.map(v=>ordinary[v===79?0:2]));
  }
});

it('confirms all saved native RGB fallbacks agree with the PDF colors',()=>{
  expect(saved.referenceBuild).toBe('16.0.20326');expect(saved.colors).toHaveLength(128);
  for(const [i,r] of saved.colors.entries()){
    expect(r.label).toBe(cases[i].label);
    expect([...Buffer.from(r.attributes.val,'hex')]).toEqual(reference.colors[i].rgb);
    expect(r.attributes.themeColor).toBe(cases[i].theme);
    const attr=cases[i].mode==='shade'?'themeShade':'themeTint';
    if(cases[i].value===255){
      expect(r.attributes.themeShade).toBeUndefined();expect(r.attributes.themeTint).toBeUndefined();
    }else expect(parseInt(r.attributes[attr],16)).toBe(cases[i].value);
  }
});
