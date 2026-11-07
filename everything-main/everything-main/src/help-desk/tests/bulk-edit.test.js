/** Bulk edit from a view. */
import { describe, it, expect, vi } from 'vitest';
import { app } from '../src/app.js';
import { bulkEditDialog } from '../src/views/bulk-edit.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('bulk edit', () => {
  it('adds tags to every ticket it can, past one that is closed', async () => {
    app.replica = { tickets: new Map([[1, { id: 1, tags: [], status: 'closed' }], [2, { id: 2, tags: ['a'], status: 'open' }]]), members: {}, cfg: { groups: [] }, agents: () => [] };
    app.updateTicket = vi.fn(async (id) => {
      if (id === 1) throw new Error('Closed tickets cannot be changed.');
      return {};
    });
    const done = vi.fn();
    try {
      bulkEditDialog([1, 2], done);
      const dlg = document.querySelector('dialog[open]');
      const input = [...dlg.querySelectorAll('input')].find((i) => i.closest('.field')?.textContent.includes('Add tags'));
      input.value = 'vip';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Update tickets').click();
      await tick(20);
      expect(app.updateTicket.mock.calls.map(([id, body]) => [id, body.patch.tags])).toEqual([[1, ['vip']], [2, ['a', 'vip']]]);
      expect(done).toHaveBeenCalled();
      const toasts = [...document.querySelectorAll('.toast')].map((t) => t.textContent);
      expect(toasts.some((t) => t.includes('1 ticket could not be updated'))).toBe(true);
      expect(toasts.some((t) => t.includes('1 ticket updated'))).toBe(true);
    } finally {
      delete app.updateTicket;
    }
  });
});
