import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

for (const source of ['picker', 'desktop'])
  for (const metadata of ['missing', 'stale'])
    test(`an oversized ${source} PDF with ${metadata} size metadata is rejected before reading its bytes`, async ({
      page,
    }) => {
      const doc = await PDFDocument.create();
      doc.addPage([200, 200]);
      const bytes = Buffer.from(await doc.save()).toString('base64');
      await page.route('https://js.puter.com/**', (route) =>
        route.fulfill({
          contentType: 'application/javascript',
          body: `
        window.cloudItem = {path:'PDF Editor/large.pdf', name:'large.pdf', ${metadata === 'stale' ? 'size:1,' : ''}};
        window.cloudBuffers = 0;
        window.cloudMode = 'large';
        window.puter = {
          env:'app', auth:{getUser:async()=>({username:'test-user'})},
          fs:{readdir:async()=>[], read:async()=>window.cloudMode === 'large' ? {
            size:100*1024*1024+1,
            arrayBuffer:async()=>{window.cloudBuffers++;throw new Error('Oversized content materialized');}
          } : new Blob([Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0))])},
          ui:{onLaunchedWithItems:()=>{},onItemsOpened:handler=>{window.openItems=handler;},showOpenFilePicker:async()=>window.cloudItem}
        };`,
        }),
      );
      await page.goto('/#library');
      await expect.poll(() => page.evaluate(() => typeof window.openItems)).toBe('function');
      const open = async () => {
        if (source === 'picker')
          await page.getByRole('button', { name: 'Open from Puter', exact: true }).click();
        else await page.evaluate(() => window.openItems([window.cloudItem]));
      };
      await open();
      await expect(page.locator('#toast')).toHaveText('Choose a PDF smaller than 100 MB.');
      expect(await page.evaluate(() => window.cloudBuffers)).toBe(0);
      await expect(page.getByRole('button', { name: 'New blank PDF', exact: true })).toBeVisible();
      await page.evaluate(() => {
        window.cloudMode = 'small';
        window.cloudItem = { path: 'PDF Editor/small.pdf', name: 'small.pdf' };
      });
      await open();
      await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
      await expect(page).toHaveTitle('small.pdf · PDF Editor');
    });
