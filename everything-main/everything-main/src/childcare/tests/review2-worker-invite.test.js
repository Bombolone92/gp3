// @vitest-environment jsdom
/**
 * Regression tests from the second adversarial review of invitation links
 * (src/views/invite.js).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/team.js', () => ({ call: async () => ({ token: 'TOKENtoken1234567890' }), inviteLink: () => 'https://childcare.puter.com/#/join?w=childcare-abc&t=TOKENtoken1234567890' }));

const { app } = await import('../src/app.js');
const { invite } = await import('../src/views/invite.js');

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '';
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  app.demo = false;
  app.team = { url: 'https://childcare-abc.puter.work', role: 'owner' };
  app.store = { state: { settings: { school: { name: 'Acorn' } } } };
});

describe('invite: copying the link', () => {
  it('selects the link for copying by hand when the clipboard is not available or refuses', async () => {
    for (const clipboard of [undefined, { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) }]) {
      document.body.innerHTML = '';
      Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
      await invite({ role: 'parent', guardianId: 'g1', name: 'Mia Chen' });
      const field = document.querySelector('input[aria-label="Invitation link"]');
      const copy = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Copy');
      copy.click();
      await flush();
      expect(document.activeElement).toBe(field);
      expect(field.selectionStart).toBe(0);
      expect(field.selectionEnd).toBe(field.value.length);
      expect(document.body.textContent).toMatch(/to copy the link/);
    }
  });
});
