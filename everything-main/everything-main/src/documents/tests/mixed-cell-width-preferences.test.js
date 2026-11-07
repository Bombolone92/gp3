import {it,expect} from 'vitest';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
for(const [folder,reference,count,columns] of [['mixed-cell-width-preferences','reference.json',16,3],['mixed-cell-width-preferences','nowrap-reference.json',16,3],['mixed-cell-width-four','reference.json',6,4],['mixed-cell-width-content','reference.json',16,4],['nowrap-cell-margins','reference.json',20,4]])
it(`binds ${folder}/${reference} geometry to original controls and native reference output`,()=>{
 const root=`tests/fixtures/${folder}/`,r=JSON.parse(readFileSync(root+reference));
 for(const [name,hash]of Object.entries(r.hashes))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex'),name).toBe(hash);
 expect(r.pages).toHaveLength(count);expect(r.cases).toEqual(JSON.parse(readFileSync(root+'cases.json')));
 for(const cells of r.pages){expect(cells).toHaveLength(columns);for(const c of cells){expect(Number.isFinite(c.x)).toBe(true);expect(c.width).toBeGreaterThan(0);}}
});

for(const name of ['bordered','thin','thick'])it(`binds ${name} noWrap text origins to the exact native source`,()=>{
 const root='tests/fixtures/nowrap-cell-margins/',r=JSON.parse(readFileSync(root+name+'-text-reference.json'));
 for(const [name,hash]of Object.entries(r.hashes))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex'),name).toBe(hash);
 expect(r.pages).toHaveLength(20);for(const row of r.pages){expect(row).toHaveLength(4);for(const c of row){expect(Number.isFinite(c.x)).toBe(true);expect(Number.isFinite(c.baseline)).toBe(true);}}
});

it('retains native mixed-width allocation independently of PDF paint quantization',()=>{
 const root='tests/fixtures/mixed-cell-width-content/',r=JSON.parse(readFileSync(root+'native-cell-widths.json'));
 const hash=name=>createHash('sha256').update(readFileSync(root+name)).digest('hex');
 expect(hash('control.docx')).toBe(r.sourceSha256);expect(hash('cases.json')).toBe(r.casesSha256);
 expect(r.sourceSavedAfterRead).toBe(true);expect(r.rows).toHaveLength(16);
 expect(r.rows[1].widthTwips).toEqual([3205,1923,436,436]);
 expect(r.rows[9].widthTwips).toEqual([3204,1923,437,437]);
 expect(r.rows[1].widthTwips.reduce((a,b)=>a+b,0)).toBe(6000);
 expect(r.rows[9].widthTwips.reduce((a,b)=>a+b,0)).toBe(6001);
});
