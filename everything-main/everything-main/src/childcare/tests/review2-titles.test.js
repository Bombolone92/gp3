// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { bootViews, go, app } from './review2-people-harness.js';

describe('page titles', () => {
  beforeAll(async () => {
    await bootViews();
  });

  it('names a missing child page "Child not found", not "Unknown"', async () => {
    await go('#/children/nope');
    expect(document.title).toBe('Child not found · Childcare');
  });

  it('names a statement page after the statement, not the school', async () => {
    const inv = app.store.all('invoices').find((i) => i.number);
    await go(`#/statements/${inv.id}`);
    expect(document.title).toBe(`Statement #${inv.number} · Childcare`);
  });
});

describe('settings page titles', () => {
  it('reads as "<section> · Settings", not "My contact details settings"', async () => {
    await go('#/settings/about');
    expect(document.title).toBe('About · Settings · Childcare');
  });
});
