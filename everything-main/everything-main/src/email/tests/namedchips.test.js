import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openCompose } from '../src/ui/compose.js';

/**
 * A recipient chip shows the person's name where the address book has one,
 * and the address everywhere it matters.
 */

const draftStore = () => {
  const held = new Map();
  return {
    list: () => [...held.values()],
    get: (id) => held.get(id) ?? null,
    get count() { return held.size; },
    save(draft) { held.set(draft.id, draft); return true; },
    remove(id) { return held.delete(id); },
  };
};

const BOOK = () => [
  { name: 'Ana Petrova', email: 'ana@example.com', seconds: 100, written: true },
  { name: '', email: 'bo@example.com', seconds: 90, written: false },
];

const chips = (modal) => [...modal.panel.querySelectorAll('#compose-to')[0].parentElement
  .querySelectorAll('.recipient-chip')];
const names = (modal) => chips(modal).map((chip) => chip.querySelector('.chip-name').textContent);

beforeEach(() => {
  globalThis.puter = { ui: {}, fs: {}, APIOrigin: 'https://api.example', authToken: 't' };
});

afterEach(() => {
  document.querySelectorAll('.modal-root').forEach((node) => node.remove());
  delete globalThis.puter;
});

describe('named recipient chips', () => {
  it('shows the name the address book has, and the address where it has none', () => {
    const modal = openCompose({
      username: 'me', mailPath: '/me/.mail', drafts: draftStore(), contacts: BOOK,
      prefill: { to: 'ana@example.com, bo@example.com, cy@example.com' },
    });
    expect(names(modal)).toEqual(['Ana Petrova', 'bo@example.com', 'cy@example.com']);
    const ana = chips(modal)[0];
    expect(ana.classList.contains('is-named')).toBe(true);
    expect(ana.dataset.address).toBe('ana@example.com');
    expect(ana.querySelector('.chip-edit').title).toContain('Ana Petrova <ana@example.com>');
    expect(ana.querySelector('.chip-remove').getAttribute('aria-label')).toBe('Remove ana@example.com');
    modal.close(true);
  });

  it('keeps the address underneath: in the draft, and when the chip is edited', () => {
    const drafts = draftStore();
    const modal = openCompose({
      username: 'me', mailPath: '/me/.mail', drafts, contacts: BOOK,
      prefill: { to: 'ana@example.com', subject: 's' },
    });
    const input = modal.panel.querySelector('#compose-to');
    // Typing anywhere saves the draft with the addresses, not the names.
    modal.panel.querySelector('#compose-subject').value = 'subject';
    modal.panel.querySelector('#compose-subject').dispatchEvent(new Event('input'));
    modal.close();
    expect(drafts.list()[0].to).toBe('ana@example.com');

    const again = openCompose({
      username: 'me', mailPath: '/me/.mail', drafts: draftStore(), contacts: BOOK,
      prefill: { to: 'ana@example.com' },
    });
    again.panel.querySelector('.chip-edit').click();
    expect(again.panel.querySelector('#compose-to').value).toBe('ana@example.com');
    expect(input.value).toBe('');
    again.close(true);
  });

  it('is matched without regard to case', () => {
    const modal = openCompose({
      username: 'me', mailPath: '/me/.mail', drafts: draftStore(), contacts: BOOK,
      prefill: { to: 'Ana@Example.com' },
    });
    expect(names(modal)).toEqual(['Ana Petrova']);
    modal.close(true);
  });

  it('shows the address alone where there is no address book', () => {
    const modal = openCompose({
      username: 'me', mailPath: '/me/.mail', drafts: draftStore(),
      prefill: { to: 'ana@example.com' },
    });
    expect(names(modal)).toEqual(['ana@example.com']);
    modal.close(true);
  });
});
