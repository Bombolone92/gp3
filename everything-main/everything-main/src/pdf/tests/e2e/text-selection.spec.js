import { test, expect } from '@playwright/test';

test('measuring a dense text selection batches browser layout work', async ({ page }) => {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/#library');
  await page.evaluate(async () => {
    const { selectedTextQuads } = await import('/src/text-selection.js');
    const paper = document.createElement('div');
    Object.assign(paper.style, { position: 'relative', width: '600px', height: '900px' });
    const container = document.createElement('div');
    container.className = 'textLayer';
    const textDivs = Array.from({ length: 240 }, (_, i) => {
      const span = document.createElement('span');
      span.textContent = `Selected words ${i}`;
      Object.assign(span.style, {
        font: '12px sans-serif',
        left: `${(i % 4) * 150}px`,
        top: `${Math.floor(i / 4) * 15}px`,
        transform: 'none',
      });
      return span;
    });
    container.append(...textDivs);
    paper.append(container);
    document.body.replaceChildren(paper);
    const range = document.createRange();
    range.selectNodeContents(container);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const viewport = { width: 600, height: 900, convertToPdfPoint: (x, y) => [x, 900 - y] };
    window.measureSelection = () => {
      const started = performance.now();
      const result = selectedTextQuads({ textDivs }, viewport, paper);
      return { result, duration: performance.now() - started };
    };
    // Flush setup separately from the operation under test.
    paper.getBoundingClientRect();
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () =>
    Object.fromEntries(
      (await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]),
    );
  const before = await metrics();
  const { result, duration } = await page.evaluate(() => window.measureSelection());
  const after = await metrics();
  expect(result.quads).toHaveLength(240);
  expect(result.text).toContain('Selected words 239');
  expect(result.quads[0][0]).toBeCloseTo(0, 4);
  expect(result.quads.at(-1)[0]).toBeCloseTo(450, 4);
  expect(result.quads[0][1] - result.quads.at(-1)[1]).toBeCloseTo(885, 4);
  test.info().annotations.push({
    type: 'measurement',
    description: `${after.LayoutCount - before.LayoutCount} layouts; ${duration.toFixed(1)} ms`,
  });
  expect(after.LayoutCount - before.LayoutCount).toBeLessThanOrEqual(4);
});

test('aligning dense selectable text batches styles without changing glyph widths', async ({
  page,
}) => {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/#library');
  await page.evaluate(async () => {
    const { alignTextLayer } = await import('/src/text-selection.js');
    const container = document.createElement('div');
    container.className = 'textLayer';
    container.style.setProperty('--total-scale-factor', '1.5');
    container.style.setProperty('--min-font-size', '1.5');
    const textDivs = Array.from({ length: 1000 }, (_, i) => {
      const span = document.createElement('span');
      span.textContent = `Selected words ${i}`;
      Object.assign(span.style, {
        font: `${12 + (i % 4)}px ${i % 2 ? 'serif' : 'sans-serif'}`,
        left: `${(i % 4) * 150}px`,
        top: `${Math.floor(i / 4) * 15}px`,
      });
      if (i % 2) span.style.setProperty('--rotate', '90deg');
      return span;
    });
    container.append(...textDivs);
    document.body.replaceChildren(container);
    const content = {
      items: textDivs.map((span, i) => ({
        str: span.textContent,
        fontName: i % 2 ? 'vertical' : 'horizontal',
        width: 100,
        height: 60,
      })),
      styles: { horizontal: {}, vertical: { vertical: true } },
    };
    const viewport = { scale: 0.75, userUnit: 2 };
    window.alignSelectionText = () => {
      const start = performance.now();
      alignTextLayer({ textDivs }, content, viewport);
      const widths = textDivs.map((span, i) => {
        const box = span.getBoundingClientRect();
        return i % 2 ? box.height : box.width;
      });
      return { duration: performance.now() - start, widths };
    };
    container.getBoundingClientRect();
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () =>
    Object.fromEntries(
      (await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]),
    );
  const before = await metrics();
  const { duration, widths } = await page.evaluate(() => window.alignSelectionText());
  const after = await metrics();
  for (let i = 0; i < widths.length; i++)
    expect(Math.abs(widths[i] - (i % 2 ? 90 : 150))).toBeLessThan(0.1);
  test.info().annotations.push({
    type: 'measurement',
    description: `${after.RecalcStyleCount - before.RecalcStyleCount} style recalculations; ${duration.toFixed(1)} ms`,
  });
  expect(after.RecalcStyleCount - before.RecalcStyleCount).toBeLessThanOrEqual(2);
});
