import {test,expect} from '@playwright/test';
for(const variant of ['probe','first','center','autofit','deep','paging'])test(`renders the independently authored ${variant} nested table probe`,async({page},info)=>{
  await page.setViewportSize({width:1280,height:1500});
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(`tests/fixtures/nested-tables/nested-table-${variant}.docx`);
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect.poll(()=>input.inputValue()).toContain('Inner A1');
  await expect(page.locator('canvas.canvas-page')).toHaveCount(variant==='paging'?2:1);
  for(let i=0;i<(variant==='paging'?2:1);i++)await page.locator('canvas.canvas-page').nth(i).screenshot({path:info.outputPath(`nested-table-${variant}-${i}.png`)});
});
