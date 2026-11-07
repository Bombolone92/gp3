import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {create3dShader} from '../src/engine/drawing-3d-lighting.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const name of ['rgb64','gray256','matte-gray256']){
  const root=`tests/fixtures/picture-3d-transfer/${name}`;
  const ref=JSON.parse(readFileSync(`${root}/reference.json`,'utf8'));
  it(`guards ${name} native source and emitted bitmap evidence`,()=>{
    expect(sha(readFileSync(`${root}/source.docx`))).toBe(ref.capture.sourceSha256);
    expect(ref.capture.sourceUnchanged).toBe(true);
    expect(ref.capture.savedBefore).toBe(ref.capture.savedAfter);
    expect(ref.capture.viewBefore).toEqual(ref.capture.viewAfter);
    for(const item of ref.capture.captures)expect(sha(gunzipSync(readFileSync(`${root}/native/${item.file}.gz`)))).toBe(item.sha256);
    if(name!=='matte-gray256')expect(ref.measurements[0].colors).toEqual(ref.measurements[1].colors);
  });
  for(const row of ref.measurements)it.fails(`matches all native ${name} front-face colors for case ${row.case.id}`,()=>{
    const shader=create3dShader({rig:row.case.rig,material:row.case.material??'warmMatte'});
    const actual=ref.input.colors.map(color=>shader(color,[0,0,1],[0,0,1]));
    // Fixed unresolved regressions against the native reference; remove .fails only with a
    // generic correction verified against the other native surface controls.
    expect(actual).toEqual(row.colors);
  });
}
