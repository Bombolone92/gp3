import { test, expect } from '@playwright/test';

for (const paragraph of [false, true]) {
  for (const position of ['first-end', 'second-start', 'second-end', 'last-end']) {
    test(`Enter at ${position} adds one break in ${paragraph ? 'paragraph' : 'grouped'} text`, async ({
      page,
    }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      await page.evaluate(
        async ({ paragraph, position }) => {
          const { textLineInput } = await import('/src/text-line-input.js');
          const group = {
            text: 'one two three',
            parts: [{}, {}, {}],
            segments: [
              { text: 'one ', part: 0 },
              { text: 'two', part: 1 },
              { text: ' three', part: 2 },
            ],
            paragraph: paragraph ? { leading: 1.2 } : null,
          };
          const input = textLineInput(group);
          Object.assign(input.style, {
            position: 'static',
            width: '300px',
            height: '160px',
            font: '20px sans-serif',
          });
          input.children[1].style.fontWeight = 'bold';
          document.body.replaceChildren(input);
          input.focus();
          const [index, offset] = {
            'first-end': [0, 4],
            'second-start': [1, 0],
            'second-end': [1, 3],
            'last-end': [2, 6],
          }[position];
          const range = document.createRange();
          range.setStart(input.children[index].firstChild, offset);
          range.collapse(true);
          getSelection().removeAllRanges();
          getSelection().addRange(range);
        },
        { paragraph, position },
      );
      const input = page.getByRole('textbox');
      await input.press('Enter');
      const expected = {
        'first-end': 'one \ntwo three',
        'second-start': 'one \ntwo three',
        'second-end': 'one two\n three',
        'last-end': 'one two three\n',
      }[position];
      const state = await input.evaluate((el) => ({
        value: el.value,
        html: el.innerHTML,
        text: el.innerText,
      }));
      expect(state.value, JSON.stringify(state)).toBe(expected);
      await input.press('Backspace');
      expect(await input.evaluate((el) => el.value)).toBe('one two three');
      await input.press('Shift+Enter');
      expect(await input.evaluate((el) => el.value)).toBe(expected);
      expect(errors).toEqual([]);
    });
  }
}

for (const acrossFragments of [false, true]) {
  test(`moving selected text ${acrossFragments ? 'across fragments' : 'within a fragment'} preserves styles and native undo`, async ({
    page,
  }) => {
    await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
    await page.goto('/#library');
    const points = await page.evaluate(async (acrossFragments) => {
      const { textLineInput } = await import('/src/text-line-input.js');
      const input = textLineInput({
        text: 'alpha beta gamma',
        parts: [{}, {}],
        segments: [
          { text: 'alpha ', part: 0 },
          { text: 'beta gamma', part: 1 },
        ],
      });
      Object.assign(input.style, {
        position: 'static',
        width: '600px',
        height: '120px',
        font: '24px sans-serif',
      });
      input.lastChild.style.fontWeight = 'bold';
      document.body.replaceChildren(input);
      input.focus();
      const range = document.createRange();
      range.setStart(
        acrossFragments ? input.firstChild.firstChild : input.lastChild.firstChild,
        acrossFragments ? 2 : 0,
      );
      range.setEnd(input.lastChild.firstChild, 5);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      const start = range.getClientRects()[0];
      const caret = document.createRange();
      caret.setStart(
        acrossFragments ? input.lastChild.firstChild : input.firstChild.firstChild,
        acrossFragments ? 10 : 0,
      );
      caret.collapse(true);
      const end = caret.getBoundingClientRect();
      return {
        start: { x: start.x + start.width / 2, y: start.y + start.height / 2 },
        end: { x: end.x + (acrossFragments ? 1 : 0.1), y: end.y + end.height / 2 },
      };
    }, acrossFragments);
    // Native text dragging distinguishes a held selection from an ordinary caret click.
    await page.waitForTimeout(250);
    await page.mouse.move(points.start.x, points.start.y);
    await page.mouse.down();
    await page.waitForTimeout(250);
    await page.mouse.move(points.end.x, points.end.y, { steps: 20 });
    await page.mouse.up();
    const input = page.getByRole('textbox');
    const expected = acrossFragments ? 'algammapha beta ' : 'beta alpha gamma';
    await expect.poll(() => input.evaluate((el) => el.value)).toBe(expected);
    const segments = acrossFragments
      ? [
          { text: 'al', part: 0 },
          { text: 'gamma', part: 1 },
          { text: 'pha ', part: 0 },
          { text: 'beta ', part: 1 },
        ]
      : [
          { text: 'beta ', part: 1 },
          { text: 'alpha ', part: 0 },
          { text: 'gamma', part: 1 },
        ];
    expect(await input.evaluate((el) => el.segments())).toEqual(segments);
    expect(
      await input.evaluate((el) =>
        [...el.querySelectorAll('[data-part="1"]')]
          .filter((span) => span.textContent)
          .every((span) => getComputedStyle(span).fontWeight === '700'),
      ),
    ).toBe(true);
    await input.press('ControlOrMeta+z');
    expect(await input.evaluate((el) => el.value)).toBe('alpha beta gamma');
    expect(await input.evaluate((el) => el.segments())).toEqual([
      { text: 'alpha ', part: 0 },
      { text: 'beta gamma', part: 1 },
    ]);
    await input.press('ControlOrMeta+Shift+z');
    expect(await input.evaluate((el) => el.value)).toBe(expected);
    expect(await input.evaluate((el) => el.segments())).toEqual(segments);
    // An unrelated drop after the internal move must still import only plain text.
    await input.evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      const range = document.createRange();
      range.setStart(node, 0);
      range.collapse(true);
      const caret = range.getBoundingClientRect();
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', '<external>');
      dataTransfer.setData('text/html', '<b>Rich external markup</b>');
      el.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          clientX: caret.x + 0.1,
          clientY: caret.y + caret.height / 2,
        }),
      );
    });
    expect(await input.evaluate((el) => el.value)).toBe('<external>' + expected);
    await expect(input.locator('b')).toHaveCount(0);
  });
}

test('dragged text without source wrappers follows later size and color edits', async ({
  page,
}) => {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/#library');
  const points = await page.evaluate(async () => {
    const { textLineInput } = await import('/src/text-line-input.js');
    const transform = [24, 0, 0, 24, 0, 0];
    const input = textLineInput({
      text: 'Original',
      transform,
      fillColor: '#111111',
      parts: [
        {
          transform,
          fontFamily: 'sans-serif',
          fontWeight: '400',
          fontStyle: 'normal',
          fillColor: '#111111',
          state: { size: 24, charSpacing: 0, wordSpacing: 0 },
          widths: new Map(),
        },
      ],
      segments: [{ text: 'Original', part: 0 }],
    });
    Object.assign(input.style, {
      position: 'static',
      width: '600px',
      height: '120px',
      font: '24px sans-serif',
    });
    document.body.replaceChildren(input);
    // A draft cleared through its value setter can contain newly typed, unwrapped text.
    input.value = 'alpha beta gamma';
    input.focus();
    const range = document.createRange();
    range.setStart(input.firstChild, 0);
    range.setEnd(input.firstChild, 6);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const start = range.getBoundingClientRect();
    const caret = document.createRange();
    caret.setStart(input.firstChild, input.firstChild.length);
    caret.collapse(true);
    const end = caret.getBoundingClientRect();
    return {
      start: { x: start.x + start.width / 2, y: start.y + start.height / 2 },
      end: { x: end.x + 1, y: end.y + end.height / 2 },
    };
  });
  await page.waitForTimeout(250);
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.waitForTimeout(250);
  await page.mouse.move(points.end.x, points.end.y, { steps: 20 });
  await page.mouse.up();
  const input = page.getByRole('textbox');
  expect(await input.evaluate((el) => el.value)).toBe('beta gammaalpha ');
  const styles = await input.evaluate((el) => {
    el.style.fontSize = '36px';
    el.style.color = '#224466';
    el.updateStyle('#224466', 36);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const styles = [];
    while (walker.nextNode()) {
      if (!walker.currentNode.data.trim()) continue;
      const style = getComputedStyle(walker.currentNode.parentElement);
      styles.push({ size: style.fontSize, color: style.color });
    }
    return styles;
  });
  expect(styles.length).toBeGreaterThan(0);
  expect(styles.every((style) => style.size === '36px' && style.color === 'rgb(34, 68, 102)')).toBe(
    true,
  );
});
