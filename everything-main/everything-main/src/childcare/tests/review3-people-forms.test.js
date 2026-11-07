// @vitest-environment jsdom
/** Third review: the child form. */
import { describe, it, expect, beforeAll } from 'vitest';
import { bootViews, go, app, tick } from './review2-people-harness.js';

let main;
beforeAll(async () => {
  main = await bootViews();
});

describe('child form', () => {
  it('Add child works again after a save that failed', async () => {
    await go('#/children/new');
    const before = app.store.all('students').length;
    const form = main.querySelector('form.form-page');
    const first = form.querySelector('input.input');
    first.value = 'Noor';
    first.dispatchEvent(new Event('input'));
    const put = app.store.put;
    let failed = false;
    app.store.put = function (coll, ...rest) {
      if (coll === 'students' && !failed) {
        failed = true;
        throw new Error('Storage is full');
      }
      return put.call(this, coll, ...rest);
    };
    try {
      const submit = form.querySelector('button[type=submit]');
      submit.click();
      await tick(30);
      expect(failed).toBe(true);
      expect(document.querySelector('.toast.error')?.textContent).toContain('Storage is full');
      submit.click();
      await tick(50);
      expect(app.store.all('students').length).toBe(before + 1);
    } finally {
      app.store.put = put;
    }
  });
});
