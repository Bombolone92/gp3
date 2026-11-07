import { test, expect } from '@playwright/test';

async function setup(page, { holdListing = false } = {}) {
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        window.listReads=0;
        window.files=[{name:'report.pdf',size:10},{name:'report-two.pdf',size:20},{name:'second.pdf',size:30}];
        const holdAction=update=>new Promise(resolve=>{window.finishAction=()=>{update();resolve({});};});
        window.puter={env:'app',auth:{getUser:()=>new Promise((resolve,reject)=>{
          window.finishProfile=fail=>{
            if(fail) reject(new Error('Profile unavailable')); else resolve({username:'alice'});
            setTimeout(()=>window.profileSettled=true,0);
          };
        })},fs:{
          readdir:async()=>{
            window.listReads++;
            const files=window.files.map(f=>({...f,path:'PDF Editor/'+f.name}));
            if(${holdListing}) return new Promise(resolve=>{window.finishListing=()=>resolve(files);});
            return files;
          },
          read:async()=>new Blob(['%PDF-1.4']),
          rename:()=>holdAction(()=>{window.files[0].name='renamed.pdf';}),
          delete:()=>holdAction(()=>{window.files.shift();}),
          write:()=>holdAction(()=>{window.files.push({name:'report copy.pdf',size:10});}),
        },ui:{onItemsOpened:()=>{},onWindowClose:()=>{}}};`,
    }),
  );
  await page.goto('/#library');
  await expect.poll(() => page.evaluate(() => typeof window.finishProfile)).toBe('function');
  if (holdListing)
    await expect.poll(() => page.evaluate(() => typeof window.finishListing)).toBe('function');
  else
    await expect(page.locator('.file-open')).toHaveText([
      'report.pdf',
      'report-two.pdf',
      'second.pdf',
    ]);
}
async function finishProfile(page, outcome) {
  await page.evaluate((fail) => window.finishProfile(fail), outcome === 'failure');
  await expect.poll(() => page.evaluate(() => window.profileSettled)).toBe(true);
  const name = outcome === 'success' ? 'alice' : 'Puter user';
  await expect(page.locator('.account-label')).toHaveText(name);
  await expect(page.locator('.account-label')).toHaveAttribute('title', name);
}
for (const outcome of ['success', 'failure']) {
  for (const focus of ['search', 'sort', 'options'])
    test(`profile ${outcome} preserves library search, sorting, and ${focus} focus`, async ({
      page,
    }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await setup(page);
      const search = page.getByRole('searchbox', { name: 'Search PDFs', exact: true });
      const sort = page.getByRole('combobox', { name: 'Sort PDFs', exact: true });
      await sort.selectOption('size');
      await search.fill('report');
      if (focus === 'sort') await search.press('Shift+Tab');
      if (focus === 'options') {
        await page.getByRole('button', { name: 'Options for report.pdf', exact: true }).click();
        await page
          .getByRole('dialog', { name: 'report.pdf', exact: true })
          .getByRole('button', { name: 'Rename', exact: true })
          .focus();
      }
      await finishProfile(page, outcome);
      await expect(search).toHaveValue('report');
      await expect(sort).toHaveValue('size');
      await expect(page.locator('.file-open')).toHaveText(['report-two.pdf', 'report.pdf']);
      if (focus === 'options') {
        const options = page.getByRole('dialog', { name: 'report.pdf', exact: true });
        await expect(options.getByRole('button', { name: 'Rename', exact: true })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(0);
        await expect(
          page.getByRole('button', { name: 'Options for report.pdf', exact: true }),
        ).toBeFocused();
      } else await expect(focus === 'sort' ? sort : search).toBeFocused();
      expect(await page.evaluate(() => window.listReads)).toBe(1);
      await search.fill('second');
      await expect(page.locator('.file-open')).toHaveText(['second.pdf']);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toContainText(
        `Signed in as ${outcome === 'success' ? 'alice' : 'Puter user'}`,
      );
      expect(errors).toEqual([]);
    });
  for (const action of ['Rename', 'Duplicate', 'Delete'])
    test(`profile ${outcome} preserves a pending library ${action}`, async ({ page }) => {
      await setup(page);
      await page.getByRole('button', { name: 'Options for report.pdf', exact: true }).click();
      await page.getByRole('button', { name: action, exact: true }).click();
      if (action === 'Rename') {
        const dialog = page.getByRole('dialog', { name: 'Rename PDF', exact: true });
        await dialog.getByLabel('File name', { exact: true }).fill('renamed');
        await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
      } else if (action === 'Delete') {
        await page
          .getByRole('dialog', { name: 'Delete PDF?', exact: true })
          .getByRole('button', { name: 'Delete PDF', exact: true })
          .click();
      }
      await expect.poll(() => page.evaluate(() => typeof window.finishAction)).toBe('function');
      await finishProfile(page, outcome);
      expect(await page.evaluate(() => window.listReads)).toBe(1);
      await page.evaluate(() => window.finishAction());
      await expect(page.locator('.file-open')).toHaveText(
        {
          Rename: ['renamed.pdf', 'report-two.pdf', 'second.pdf'],
          Duplicate: ['report.pdf', 'report-two.pdf', 'second.pdf', 'report copy.pdf'],
          Delete: ['report-two.pdf', 'second.pdf'],
        }[action],
      );
      await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(0);
      await expect(page.getByRole('searchbox', { name: 'Search PDFs', exact: true })).toBeFocused();
      expect(await page.evaluate(() => window.listReads)).toBe(2);
    });
  test(`profile ${outcome} preserves the pending initial library listing`, async ({ page }) => {
    await setup(page, { holdListing: true });
    const search = page.getByRole('searchbox', { name: 'Search PDFs', exact: true });
    await search.fill('second');
    await finishProfile(page, outcome);
    expect(await page.evaluate(() => window.listReads)).toBe(1);
    await expect(search).toHaveValue('second');
    await expect(search).toBeFocused();
    await page.evaluate(() => window.finishListing());
    await expect(page.locator('.file-open')).toHaveText(['second.pdf']);
  });
}
