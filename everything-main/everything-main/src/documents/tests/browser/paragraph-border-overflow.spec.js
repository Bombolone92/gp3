import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
test('clips overflowing paragraph borders at cell edges while keeping the document editable',async({page},info)=>{
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/paragraph-border-overflow.docx');
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Inset0/);await expect(input).toBeEditable();
 const canvas=page.locator('canvas.canvas-page');await expect(canvas).toHaveCount(1);
 const ink=await canvas.evaluate(c=>{const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data,scale=c.width/816;let inside=0,outside=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;if(data[i]<10&&data[i+1]<10&&data[i+2]>245){if(x<48*scale||x>=240*scale)outside++;else inside++;}}return {inside,outside};});
 expect(ink.inside).toBeGreaterThan(500);expect(ink.outside).toBe(0);
 writeFileSync(info.outputPath('border-overflow.png'),Buffer.from(await canvas.evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();await(await event).saveAs(info.outputPath('unchanged.docx'));
});
