import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';
import { createSettings } from '../src/lib/settings.js';
import { memoryStorage } from '../src/lib/readstate.js';

/**
 * Display density: a class on the frame, chosen in Settings and kept per
 * account.
 */

const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

let root;

const mount = (settings) => {
  const { fs, mailPath, objectsPath } = createSampleMailbox();
  renderApp(root, {
    fs, mailPath, objectsPath, sample: true, account: { username: 'sample' }, settings,
  });
};

const frame = () => root.querySelector('.app-frame');
const openSettings = async () => {
  root.querySelector('[aria-label="Settings"]').click();
  await settle(50);
};
const item = (label) => [...document.querySelectorAll('.menu .menu-item')]
  .find((node) => node.textContent.trim() === label);

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  document.querySelectorAll('.menu, .toast').forEach((node) => node.remove());
});

describe('density', () => {
  it('is the default until chosen', async () => {
    mount();
    await settle(300);
    expect(frame().classList.contains('density-compact')).toBe(false);
  });

  it('is applied from the stored setting at launch', async () => {
    const settings = createSettings('t', memoryStorage());
    settings.set('density', 'compact');
    mount(settings);
    await settle(300);
    expect(frame().classList.contains('density-compact')).toBe(true);
  });

  it('is chosen in Settings and remembered', async () => {
    const settings = createSettings('t', memoryStorage());
    mount(settings);
    await settle(300);
    await openSettings();
    expect(item('Default').getAttribute('aria-checked')).toBe('true');
    item('Compact').click();
    await settle(50);
    expect(frame().classList.contains('density-compact')).toBe(true);
    expect(settings.get('density', '')).toBe('compact');

    await openSettings();
    expect(item('Compact').getAttribute('aria-checked')).toBe('true');
    item('Default').click();
    expect(frame().classList.contains('density-compact')).toBe(false);
  });

  it('falls back to the default for a stored value that is not a density', async () => {
    const settings = createSettings('t', memoryStorage());
    settings.set('density', 'tiny');
    mount(settings);
    await settle(300);
    expect(frame().classList.contains('density-compact')).toBe(false);
  });
});
