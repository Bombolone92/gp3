// @vitest-environment jsdom
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const base of ['svg-mask-opacity','svg-mask-opacity-expanded','svg-mask-opaque'])it(`${base} has an independent identity-filter reference`,()=>{
 const name=base+'-intermediate',folder=`tests/fixtures/${name}/`;
 const source=readFileSync(`public/fixtures/${name}.docx`);
 const ref=JSON.parse(readFileSync(folder+'metafile-reference.json'));
 expect(hash(source)).toBe(ref.sourceSha256);
 expect(hash(readFileSync(folder+'native.emf'))).toBe(ref.nativeSha256);
 expect(ref.referenceBuild).toBe('16.0.20326');
 expect(ref.images).toHaveLength(6);
 for(const image of ref.images)expect(hash(readFileSync(folder+image.path))).toBe(image.sha256);
 const xml=new TextDecoder().decode(unzipSync(source)['word/media/vector.svg']);
 const svg=new DOMParser().parseFromString(xml,'image/svg+xml');
 expect(svg.querySelector('parsererror')).toBeNull();
 expect(svg.querySelectorAll('mask')).toHaveLength(0);
 expect(svg.querySelectorAll('ellipse')).toHaveLength(base==='svg-mask-opaque'?5:6);
 expect(svg.querySelectorAll('g[filter]')).toHaveLength(6);
 expect(svg.querySelector('feColorMatrix').getAttribute('values')).toBe('1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0');
 expect(JSON.parse(readFileSync(folder+'cases.json'))).toEqual(JSON.parse(readFileSync(`tests/fixtures/${base}/cases.json`)));
});
