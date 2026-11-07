import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

// Delay only the picker's initial checks, not browser permissions or font files.
const availability=readFileSync('src/engine/font-availability.js','utf8');
const signature='export async function checkFontAvailability(name) {';
const delayed=availability.replace(signature,'async function originalPickerCheck(name) {')+`
export async function checkFontAvailability(name) {
 const held=window.holdPickerChecks;
 if(held)await new Promise(resolve=>window.pickerChecks.push(resolve));
 try{return await originalPickerCheck(name);}
 finally{if(held)window.pickerChecksSettled++;}
}`;

for(const mode of ['enumerated','empty','denied','refresh-failed'])
test(`late initial font checks retain the ${mode} browsing result`,async({page})=>{
 await page.route('**/src/engine/font-availability.js*',route=>route.fulfill({contentType:'text/javascript',body:delayed}));
 await page.goto('/playground.html');
 await page.evaluate(async mode=>{
  const {checkFontAvailability}=await import('/src/engine/font-availability.js');
  const {openFontPicker}=await import('/src/views/font-picker.js');
  await checkFontAvailability('Missing Picker Status Fixture 20261004');
  window.pickerChecks=[];window.pickerChecksSettled=0;window.holdPickerChecks=true;window.pickerApplied=0;window.pickerRefreshed=0;window.pickerFileReads=0;
  window.queryLocalFonts=async()=>{
   if(mode==='denied')throw new DOMException('Denied','NotAllowedError');
   return mode==='empty'?[]:[{family:'Picker Metadata Fixture',blob(){window.pickerFileReads++;throw Error('No font-file access');}}];
  };
  const anchor=document.createElement('button');anchor.textContent='Status fixture';document.body.append(anchor);
  openFontPicker({anchor,value:'Missing Picker Status Fixture 20261004',apply:()=>window.pickerApplied++,onFontsAvailable:()=>{
   window.pickerRefreshed++;if(mode==='refresh-failed')throw Error('Independent refresh failure');
  }});
 },mode);
 const popup=page.getByRole('dialog',{name:'Font',exact:true}),status=popup.getByRole('status');
 await expect.poll(()=>page.evaluate(()=>window.pickerChecks.length)).toBeGreaterThan(0);
 await popup.getByRole('button',{name:'Browse installed fonts',exact:true}).click();
 const expected={enumerated:'1 installed font families available.',empty:'No installed fonts were returned. You can still enter a font name.',denied:'Installed fonts could not be listed. You can still enter a font name.','refresh-failed':'Installed fonts are available, but the document could not refresh. Reopen it to try again.'}[mode];
 await expect(status).toHaveText(expected);
 const checks=await page.evaluate(()=>{window.holdPickerChecks=false;const checks=window.pickerChecks.splice(0);checks.forEach(resolve=>resolve());return checks.length;});
 await expect.poll(()=>page.evaluate(()=>window.pickerChecksSettled)).toBe(checks);
 await expect(status).toHaveText(expected);
 expect(await page.evaluate(()=>({applied:window.pickerApplied,reads:window.pickerFileReads,refresh:window.pickerRefreshed}))).toEqual({applied:0,reads:0,refresh:mode==='denied'?0:1});
 await expect(popup.getByRole('button',{name:'Browse installed fonts',exact:true})).toBeEnabled();
});

test('initial checks still explain unavailable fonts without a later action',async({page})=>{
 await page.goto('/playground.html');
 await page.evaluate(async()=>{
  const {openFontPicker}=await import('/src/views/font-picker.js');
  const anchor=document.createElement('button');document.body.append(anchor);
  openFontPicker({anchor,value:'Missing Picker Status Fixture 20261004',apply:()=>{throw Error('Unexpected formatting edit');}});
 });
 await expect(page.getByRole('dialog',{name:'Font',exact:true}).getByRole('status')).toHaveText('Missing Picker Status Fixture 20261004 is unavailable. Displaying Noto Sans; its original name stays in the file until you choose a font.');
});
