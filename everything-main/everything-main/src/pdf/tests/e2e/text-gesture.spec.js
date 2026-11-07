import { test, expect } from '@playwright/test';

for (const kind of ['position', 'width'])
  test(`text ${kind} uses release coordinates and recovers from lost pointer capture`, async ({
    page,
  }) => {
    await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
    await page.goto('/#library');
    await page.evaluate(async (kind) => {
      const { textPositionControls } = await import('/src/text-position.js');
      const { textWidthControls } = await import('/src/text-width.js');
      let position = [40, 300],
        width = 180,
        changes = 0;
      const input = document.createElement('div');
      input.style.transform = 'matrix(0,1,-1,0,0,0)';
      const control =
        kind === 'width'
          ? textWidthControls({
              input,
              getWidth: () => width,
              setWidth: (value) => {
                width = value;
              },
              zoom: 0.5,
              changed: () => {
                changes++;
                control.sync(400);
              },
            })
          : textPositionControls({
              getPosition: () => position,
              setPosition: (value) => {
                position = value;
              },
              viewport: { userUnit: 2, scale: 1, convertToPdfPoint: (x, y) => [y / 2, x / 2] },
              pointAt: (e) => [e.clientY / 2, e.clientX / 2],
              changed: () => {
                changes++;
              },
            });
      document.body.replaceChildren(control.handle, control.root);
      control.sync?.(400);
      control.handle.addEventListener(
        'pointerdown',
        (e) => {
          window.gesturePointer = e.pointerId;
        },
        true,
      );
      window.textGesture = { read: () => ({ position, width, changes }) };
    }, kind);
    const target = page.getByRole('button', {
      name: kind === 'width' ? 'Resize paragraph width' : 'Move text',
      exact: true,
    });
    const cdp = await page.context().newCDPSession(page);
    const start = async () => {
      const box = await target.boundingBox();
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      return point;
    };
    const read = () => page.evaluate(() => window.textGesture.read());
    const value = async () => {
      const state = await read();
      return kind === 'width' ? state.width : state.position;
    };
    const point = await start();
    // A release can carry a newer location than the last delivered pointermove.
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x + 20,
      y: point.y + 10,
      button: 'left',
      clickCount: 1,
    });
    const released = kind === 'width' ? 200 : [45, 310];
    await expect.poll(value).toEqual(released);
    const next = await start();
    await page.mouse.move(next.x + 20, next.y + 10);
    await expect.poll(value).not.toEqual(released);
    await target.evaluate((el) => el.releasePointerCapture(window.gesturePointer));
    await page.mouse.move(next.x + 21, next.y + 11);
    await expect.poll(value).toEqual(released);
    await page.mouse.up();
    const last = await start();
    await page.mouse.move(last.x + 20, last.y + 10);
    await page.mouse.up();
    await expect.poll(value).toEqual(kind === 'width' ? 220 : [50, 320]);
    const state = await read();
    await target.click();
    expect(await read()).toEqual(state);
    // A second finger on the same control also gets implicit pointer capture.
    // Releasing it must not cancel the first finger's drag.
    const box = await target.boundingBox();
    const first = { id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const second = { id: 2, x: first.x + 4, y: first.y + 4 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
    first.y += 10;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [first] });
    const dragged = kind === 'width' ? 240 : [55, 320];
    await expect.poll(value).toEqual(dragged);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [first, second],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [second] });
    await expect.poll(value).toEqual(dragged);
    first.y += 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [first] });
    await expect.poll(value).toEqual(kind === 'width' ? 244 : [56, 320]);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect.poll(value).toEqual(kind === 'width' ? 220 : [50, 320]);
  });
