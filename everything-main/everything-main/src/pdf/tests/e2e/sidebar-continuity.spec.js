import { clickAway } from './editing-helpers.js';
import { test, expect } from '@playwright/test';
import { PDFDocument, rgb } from 'pdf-lib';
import { addBookmark } from '../../src/core/outline-edit.js';
import { addNote } from '../../src/core/notes.js';

async function openPage(page) {
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.puter = { env: 'web', auth: { isSignedIn: () => true, getUser: async () => ({username:'test-user'}) }, fs: { readdir: async () => [] }, ui: { onLaunchedWithItems: () => {}, onItemsOpened: () => {} } };`,
    }),
  );
  await page.goto('/#library');
  const doc = await PDFDocument.create(),
    sheet = doc.addPage([400, 600]);
  sheet.drawRectangle({ x: 0, y: 0, width: 400, height: 600, color: rgb(0.2, 0.4, 0.6) });
  sheet.drawText('Original words', { x: 40, y: 360, size: 20 });
  for (let i = 0; i < 30; i++) {
    addBookmark(doc, { title: `Section ${i + 1}`, pageIndex: 0 });
    addNote(doc, 0, { x: 350, y: 50, text: `Comment ${i + 1}`, author: 'Reviewer' });
  }
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open a PDF/ }).click();
  await (
    await chooser
  ).setFiles({
    name: 'continuity.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
}

for (const panel of ['Outline', 'Comments']) {
  test(`${panel} keeps its entries and scroll position while text history reloads`, async ({
    page,
  }) => {
    await openPage(page);
    await page.getByRole('button', { name: 'Edit text: Original words', exact: true }).click();
    await page.getByRole('textbox', { name: 'Edit text', exact: true }).fill('Revised words');
    await clickAway(page);
    await expect(
      page.getByRole('button', { name: 'Edit text: Revised words', exact: true }),
    ).toBeEnabled();
    if (!(await page.locator('#page-sidebar').isVisible()))
      await page.getByRole('button', { name: 'Toggle pages panel', exact: true }).click();
    await page.getByRole('tab', { name: new RegExp(`^${panel}`) }).click();
    const container = page.locator(`#sidebar-panel-${panel.toLowerCase()}`);
    const item = panel === 'Outline' ? '.outline-item' : '.comment-item';
    await expect(container.locator(item)).toHaveCount(30);
    await container.evaluate((node) => (node.scrollTop = node.scrollHeight));
    await page.evaluate(
      ({ panel, item }) => {
        const container = document.querySelector(`#sidebar-panel-${panel.toLowerCase()}`);
        window.panelFrames = {
          running: true,
          empty: 0,
          samples: 0,
          scroll: container.scrollTop,
          moved: [],
        };
        const sample = () => {
          const frames = window.panelFrames;
          if (!frames.running) return;
          frames.samples++;
          if (container.querySelectorAll(item).length !== 30) frames.empty++;
          if (Math.abs(container.scrollTop - frames.scroll) > 1)
            frames.moved.push(container.scrollTop);
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      },
      { panel, item },
    );
    for (const action of ['Undo', 'Redo']) {
      await page.getByRole('button', { name: action, exact: true }).click();
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      await expect(container.locator(item)).toHaveCount(30);
    }
    const frames = await page.evaluate(() => {
      window.panelFrames.running = false;
      return window.panelFrames;
    });
    expect(frames.samples).toBeGreaterThan(1);
    expect(frames.scroll).toBeGreaterThan(0);
    expect(frames.empty).toBe(0);
    expect(frames.moved).toEqual([]);
  });
}

test('outline refresh retains expanded groups and focus, updates destinations, and ignores stale loads', async ({
  page,
}) => {
  await openPage(page);
  const result = await page.evaluate(async () => {
    const { createOutlinePanel } = await import('/src/outline.js');
    const visited = [];
    const panel = createOutlinePanel({ onNavigate: (page) => visited.push(page) });
    Object.assign(panel.el.style, { height: '120px', position: 'fixed', top: '0', left: '0' });
    document.body.append(panel.el);
    const items = [
      { title: 'Chapter', dest: [{ num: 1 }], items: [{ title: 'Child', dest: [{ num: 2 }] }] },
      ...Array.from({ length: 30 }, (_, i) => ({ title: `Section ${i}`, dest: [0] })),
    ];
    const pdf = {
      numPages: 4,
      getOutline: async () => items,
      getPageIndex: async (ref) => ref.num - 1,
    };
    await panel.load(pdf);
    panel.setCurrent(1);
    const child = panel.el.querySelectorAll('.outline-item')[1];
    child.focus({ preventScroll: true });
    panel.el.scrollTop = panel.el.scrollHeight;
    const scroll = panel.el.scrollTop;
    let release;
    const pending = panel.load({
      ...pdf,
      getOutline: () => new Promise((resolve) => (release = resolve)),
    });
    await new Promise(requestAnimationFrame);
    const during = {
      connected: child.isConnected,
      focus: document.activeElement === child,
      scroll: panel.el.scrollTop,
    };
    release(items);
    await pending;
    panel.setCurrent(1);
    const unchanged = {
      connected: child.isConnected,
      expanded: panel.el.querySelector('.outline-item').getAttribute('aria-expanded'),
      focus: document.activeElement === child,
      scroll: panel.el.scrollTop,
    };
    // Same PDF references after a page reorder must resolve against the new document.
    await panel.load({ ...pdf, getPageIndex: async (ref) => 4 - ref.num });
    panel.el.querySelectorAll('.outline-item')[1].click();
    const changed = {
      expanded: panel.el.querySelector('.outline-item').getAttribute('aria-expanded'),
      focused: document.activeElement.textContent,
      scroll: panel.el.scrollTop,
    };
    const stale = panel.load({
      ...pdf,
      getOutline: () => new Promise((resolve) => (release = resolve)),
    });
    await panel.load({ ...pdf, getOutline: async () => [{ title: 'Latest chapter', dest: [0] }] });
    release(items);
    await stale;
    // Destroying the old PDF can reject a read before the next PDF has loaded.
    let current = true,
      rejectRead;
    const abandoned = panel.load(
      {
        ...pdf,
        getOutline: () => new Promise((_, reject) => (rejectRead = reject)),
      },
      { isCurrent: () => current },
    );
    current = false;
    rejectRead(new Error('Document destroyed'));
    await abandoned;
    const latest = panel.el.textContent;
    panel.clear();
    panel.el.remove();
    return { scroll, during, unchanged, changed, visited, latest };
  });
  expect(result.scroll).toBeGreaterThan(0);
  expect(result.during).toEqual({ connected: true, focus: true, scroll: result.scroll });
  expect(result.unchanged).toEqual({
    connected: true,
    expanded: 'true',
    focus: true,
    scroll: result.scroll,
  });
  expect(result.changed).toEqual({ expanded: 'true', focused: 'Child', scroll: result.scroll });
  expect(result.visited).toEqual([2]);
  expect(result.latest).toBe('Latest chapter');
});

test('comments retain the existing list during slow refreshes and publish only the latest results', async ({
  page,
}) => {
  await openPage(page);
  const result = await page.evaluate(async () => {
    const { createCommentsPanel } = await import('/src/comments.js');
    const panel = createCommentsPanel({ onSelect: () => {} });
    document.body.append(panel.el);
    const annotations = [{ subtype: 'Text', id: 'note', contents: 'Original comment' }];
    const pdf = (getAnnotations) => ({ numPages: 1, getPage: async () => ({ getAnnotations }) });
    await panel.load(pdf(async () => annotations));
    const button = panel.el.querySelector('button');
    button.focus();
    let release;
    const pending = panel.load(pdf(() => new Promise((resolve) => (release = resolve))));
    await new Promise(requestAnimationFrame);
    const during = {
      connected: button.isConnected,
      focused: document.activeElement === button,
      text: panel.el.textContent,
    };
    release(annotations);
    await pending;
    const unchanged = button.isConnected && document.activeElement === button;
    const stale = panel.load(pdf(() => new Promise((resolve) => (release = resolve))));
    // Let the first read begin before a newer revision supersedes it.
    await new Promise(requestAnimationFrame);
    await panel.load(pdf(async () => [{ ...annotations[0], contents: 'Revised comment' }]));
    release(annotations);
    await stale;
    let current = true,
      rejectRead;
    const abandoned = panel.load(
      pdf(() => new Promise((_, reject) => (rejectRead = reject))),
      {
        isCurrent: () => current,
      },
    );
    await new Promise(requestAnimationFrame);
    current = false;
    rejectRead(new Error('Document destroyed'));
    await abandoned;
    const latest = panel.el.textContent;
    panel.el.remove();
    return { during, unchanged, latest };
  });
  expect(result.during.connected).toBe(true);
  expect(result.during.focused).toBe(true);
  expect(result.during.text).toContain('Original comment');
  expect(result.unchanged).toBe(true);
  expect(result.latest).toContain('Revised comment');
  expect(result.latest).not.toContain('Original comment');
});

test('comment refresh follows focus through insertions and removals without stealing it', async ({
  page,
}) => {
  await openPage(page);
  const result = await page.evaluate(async () => {
    const { createCommentsPanel } = await import('/src/comments.js');
    const panel = createCommentsPanel({ onSelect: () => {} });
    document.body.append(panel.el);
    const load = (ids) =>
      panel.load({
        numPages: 1,
        getPage: async () => ({
          getAnnotations: async () => ids.map((id) => ({ subtype: 'Text', id, contents: id })),
        }),
      });
    const focused = () => document.activeElement.textContent;
    await load(['First', 'Middle', 'Last']);
    panel.el.querySelectorAll('button')[1].focus();
    await load(['Added', 'First', 'Middle', 'Last']);
    const inserted = focused();
    await load(['Added', 'First', 'Last']);
    const removed = focused();
    await load(['Added', 'First']);
    const removedLast = focused();
    await load([]);
    const empty = document.activeElement === panel.el;
    const emptyMessage = panel.el.textContent;
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    await load(['Returned']);
    const outsideKept = document.activeElement === outside;
    outside.remove();
    panel.el.remove();
    return { inserted, removed, removedLast, empty, emptyMessage, outsideKept };
  });
  expect(result.inserted).toBe('Middle');
  expect(result.removed).toBe('Last');
  expect(result.removedLast).toBe('First');
  expect(result.empty).toBe(true);
  expect(result.emptyMessage).toContain('No comments yet.');
  expect(result.outsideKept).toBe(true);
});
