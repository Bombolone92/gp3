import { describe, it, expect, vi } from 'vitest';

// Survey frames whose mounts finish only when the test says so.
const ctl = vi.hoisted(() => ({ log: [], gate: {} }));
vi.mock('../src/views/survey-frame.js', () => ({
  mount: async (host, r) => {
    ctl.log.push(`mount ${r.step}`);
    await new Promise((res) => (ctl.gate[r.step] = res));
    const el = document.createElement('div');
    el.className = `frame-${r.step}`;
    host.append(el);
    return { update: (r2) => ctl.log.push(`update ${r2.step}`), unmount: () => ctl.log.push(`unmount ${r.step}`) };
  },
}));
vi.mock('../src/views/home.js', () => ({
  mount: async () => ({ update() {}, unmount: () => ctl.log.push('unmount home') }),
}));

const { createApp } = await import('../src/app.js');

const tick = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const backend = {
  kv: { get: async () => null, update: async () => {}, remove: async () => {} },
  fs: {},
  workers: {},
  mode: 'local',
  auth: { getUser: async () => ({ username: 'ada' }), getProfilePicture: async () => null },
};

// jsdom has no modal dialogs.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

// One app for the whole file: an app listens to the window for good.
const root = document.createElement('div');
document.body.append(root);
location.hash = '#/';
createApp({ backend, root }).start();

describe('routing while a survey loads', () => {
  it('keeps one live view when steps change mid-load, whichever mount finishes first', async () => {
    await tick();
    for (const order of [['design', 'analyze'], ['analyze', 'design']]) {
      ctl.log.length = 0;
      ctl.gate = {};
      location.hash = '#/s/abcdef123/design';
      await tick(20);
      location.hash = '#/s/abcdef123/analyze';
      await tick(20);
      for (const step of order) {
        ctl.gate[step]();
        await tick();
      }
      // The stale design view was unmounted, and only analyze is on screen.
      expect(ctl.log, order.join(' then ')).toContain('unmount design');
      expect([...root.querySelectorAll('[class^="frame-"]')].map((e) => e.className)).toEqual(['frame-analyze']);
      // The live view is the one that gets later route changes.
      location.hash = '#/s/abcdef123/collect';
      await tick();
      expect(ctl.log.at(-1)).toBe('update collect');
      location.hash = '#/';
      await tick();
      expect(ctl.log.filter((l) => l === 'unmount analyze')).toHaveLength(1);
    }
  });
});

describe('routing with a dialog open', () => {
  it('closes the dialog on Back or Forward', async () => {
    const { openDialog } = await import('../src/lib/ui.js');
    location.hash = '#/';
    await tick();
    const closed = openDialog({ title: 'QR code', build: () => document.createElement('p') });
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
    location.hash = '#/s/abcdef123/design';
    await tick();
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(0);
    await expect(closed).resolves.toBeUndefined();
  });
});
