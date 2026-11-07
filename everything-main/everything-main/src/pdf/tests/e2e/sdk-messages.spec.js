import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function setup(page, context, baseURL, sender) {
  // Keep all frame origins public; browser local-network restrictions otherwise block
  // an embedded dev server before any application message handling can be exercised.
  const devURL = baseURL;
  baseURL = 'https://editor.example';
  await context.route(`${baseURL}/**`, async (route) => {
    const response = await route.fetch({
      url: route.request().url().replace(baseURL, devURL),
      headers: { ...route.request().headers(), host: new URL(devURL).host },
    });
    await route.fulfill({ response });
  });
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  doc.addPage([300, 300]);
  const bytes = Buffer.from(await doc.save()).toString('base64');
  await context.route('https://js.puter.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        window.receivedCommands=[]; window.otherMessages=[]; window.barriers=0; window.exits=0;
        let opened, closing;
        const controls=['click','focus','drag','drop','itemsOpened','windowWillClose','pictureInPictureClosed'];
        // Match the SDK's environment detection and its unfiltered desktop-message listener.
        window.puter={
          env:new URLSearchParams(location.search).has('puter.app_instance_id') && parent!==window ? 'app':'web',
          auth:{isSignedIn:()=>false,getUser:async()=>({username:'test-user'})},
          fs:{readdir:async()=>[],read:async()=>new Blob([Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0))])},
          ui:{onItemsOpened:handler=>{opened=handler;},onWindowClose:handler=>{closing=handler;}},
          exit:()=>{window.exits++;},
        };
        window.addEventListener('message',event=>{
          const data=event.data;
          if(data?.msg==='audit-barrier') {window.barriers++;return;}
          if(!controls.includes(data?.msg)) {window.otherMessages.push(data);return;}
          window.receivedCommands.push(data.msg);
          if(data.msg==='click') document.elementFromPoint(data.x,data.y)?.click();
          if(data.msg==='itemsOpened') opened?.(data.items);
          if(data.msg==='windowWillClose') {if(closing) closing();else window.exits++;}
        });`,
    }),
  );
  await context.route(/^https:\/\/(desktop|unrelated)\.example\//, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Host</title>' }),
  );
  await context.route('**/unrelated.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Sibling</title>' }),
  );
  let editor, source;
  if (sender === 'opener') {
    await page.goto('https://unrelated.example/');
    const pending = page.waitForEvent('popup');
    await page.evaluate((url) => {
      window.editor = window.open(url);
    }, baseURL);
    editor = await pending;
    source = page;
  } else {
    await page.goto('https://desktop.example/');
    const desktop = sender !== 'web parent';
    await page.evaluate(
      (url) => {
        const frame = document.createElement('iframe');
        frame.src = url;
        frame.style = 'position:fixed;inset:0;width:100%;height:100%;border:0';
        document.body.append(frame);
        window.editor = frame.contentWindow;
      },
      baseURL + (desktop ? '/?puter.app_instance_id=test' : '/'),
    );
    await expect
      .poll(() =>
        page
          .frames()
          .find((f) => f.url().startsWith(baseURL))
          ?.url(),
      )
      .toBe(baseURL + (desktop ? '/?puter.app_instance_id=test' : '/'));
    editor = page.frames().find((f) => f.url().startsWith(baseURL));
    source = page;
    if (sender.endsWith('sibling')) {
      const siblingURL =
        sender === 'same-origin sibling'
          ? baseURL + '/unrelated.html'
          : 'https://unrelated.example/';
      await page.evaluate((url) => {
        const frame = document.createElement('iframe');
        frame.src = url;
        frame.hidden = true;
        document.body.append(frame);
      }, siblingURL);
      await expect
        .poll(() =>
          page
            .frames()
            .find((f) => f.url() === siblingURL)
            ?.url(),
        )
        .toBe(siblingURL);
      source = page.frames().find((f) => f.url() === siblingURL);
      await source.evaluate(() => {
        window.editor = parent.frames[0];
      });
    }
  }
  await expect(editor.locator('.page-caption')).toHaveText('Page 1 of 1');
  return {
    editor,
    async send(data) {
      const before = await editor.evaluate(() => window.barriers);
      await source.evaluate((data) => {
        window.editor.postMessage(data, '*');
        window.editor.postMessage({ msg: 'audit-barrier' }, '*');
      }, data);
      await expect.poll(() => editor.evaluate(() => window.barriers)).toBe(before + 1);
    },
  };
}
for (const sender of [
  'opener',
  'web parent',
  'desktop sibling',
  'same-origin sibling',
  'desktop parent',
]) {
  for (const command of ['click', 'itemsOpened', 'windowWillClose'])
    test(`${sender} ${sender === 'desktop parent' ? 'can' : 'cannot'} send ${command} to the editor`, async ({
      page,
      context,
      baseURL,
    }) => {
      const { editor, send } = await setup(page, context, baseURL, sender);
      const allowed = sender === 'desktop parent';
      const settings = editor.getByRole('button', { name: 'Settings', exact: true });
      const bounds = await settings.boundingBox();
      await send({
        msg: command,
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
        items: [{ name: 'incoming.pdf', path: 'incoming.pdf' }],
      });
      expect(await editor.evaluate(() => window.receivedCommands)).toEqual(
        allowed ? [command] : [],
      );
      if (command === 'click') {
        const dialog = editor.getByRole('dialog', { name: 'Settings', exact: true });
        if (allowed) await expect(dialog).toBeVisible();
        else {
          await expect(dialog).toHaveCount(0);
          await settings.click();
          await expect(dialog).toBeVisible();
        }
      } else if (command === 'itemsOpened') {
        await expect(editor.locator('.page-caption')).toHaveText(`Page 1 of ${allowed ? 2 : 1}`);
        if (allowed)
          await expect(
            editor.getByRole('button', { name: 'Rename incoming.pdf', exact: true }),
          ).toBeVisible();
      } else await expect.poll(() => editor.evaluate(() => window.exits)).toBe(allowed ? 1 : 0);
    });
  test(`${sender} desktop event filtering preserves other SDK messages`, async ({
    page,
    context,
    baseURL,
  }) => {
    const { editor, send } = await setup(page, context, baseURL, sender);
    const messages = ['focus', 'drag', 'drop', 'pictureInPictureClosed'];
    for (const msg of messages) await send({ msg, x: 0, y: 0 });
    expect(await editor.evaluate(() => window.receivedCommands)).toEqual(
      sender === 'desktop parent' ? messages : [],
    );
    // Authentication and ordinary messages still reach the SDK for its own validation.
    const others = [
      { msg: 'puter.token', token: 'test-only' },
      { original_msg_id: 'picker', msg: 'fileOpenCancelled' },
      null,
      'message',
    ];
    for (const data of others) await send(data);
    expect(await editor.evaluate(() => window.otherMessages)).toEqual(others);
  });
}
