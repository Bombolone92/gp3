import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const source='public/fixtures/exact-line-ink.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/exact-line-ink/reference.json','utf8'));
test.use({deviceScaleFactor:3});
test('matches native overflowing exact-line glyphs while clipping highlights and pictures',async({page},info)=>{
  test.setTimeout(90000);
  expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
  expect(createHash('sha256').update(readFileSync('tests/fixtures/exact-line-ink/native.pdf')).digest('hex')).toBe(reference.pdfSha256);
  await page.goto('/playground.html');
  const native=await page.evaluate(async()=>{const {checkFontAvailability,fontAvailable}=await import('/src/engine/font-availability.js');await checkFontAvailability('Arial');return fontAvailable('Arial');});
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^TALL GLYPHS/);await expect(input).toHaveJSProperty('readOnly',false);
  const check=async()=>{
    await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
    const bounds=await page.locator('canvas.canvas-page').evaluate((canvas,cases)=>{
      const ctx=canvas.getContext('2d'),scale=canvas.width/612;
      return cases.map(c=>{
        const x=Math.round(c.x*scale),y=Math.round(c.y*scale),w=Math.round(c.width*scale),h=Math.round(c.height*scale),data=ctx.getImageData(x,y,w,h).data,rows=[];
        for(let py=0;py<h;py++)for(let px=0;px<w;px++){
          const k=(py*w+px)*4,r=data[k],g=data[k+1],b=data[k+2];
          const matches=c.color==='black'?Math.max(r,g,b)<80:c.color==='red'?r>120&&g<80&&b<80:c.color==='yellow'?r>180&&g>150&&b<80:r<80&&g>100&&b>100;
          if(matches){rows.push(py);break;}
        }
        return rows.length?[(y+rows[0])/scale,(y+rows.at(-1)+1)/scale]:null;
      });
    },reference.cases);
    await info.attach('ink-bounds',{body:JSON.stringify(bounds),contentType:'application/json'});
    for(const [i,c] of reference.cases.entries()) {
      if(!native&&['black','red'].includes(c.color))continue;
      expect(bounds[i],c.name).not.toBeNull();
      for(let j=0;j<2;j++)expect(Math.abs(bounds[i][j]-c.bounds[j]),`${c.name}: ${JSON.stringify(bounds[i])}`).toBeLessThan(1);
    }
    await expect(page.locator('#playground-error')).toBeEmpty();
  };
  await check();writeFileSync(info.outputPath('rendered.png'),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
  const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');await check();const edited=await save('edited');
  const changed=unzipSync(readFileSync(edited));for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(changed[name],name).toEqual(parts[name]);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,'EDIT '+original);await check();
});
