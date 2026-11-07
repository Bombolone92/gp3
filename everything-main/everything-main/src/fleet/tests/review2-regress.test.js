// @vitest-environment jsdom
/**
 * Second review of the first wave of fixes: places where two fixes, or a
 * fix and existing data, worked against each other.
 */
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
  Element.prototype.scrollIntoView ??= function () {};
});

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const openDialogs = () => [...document.querySelectorAll('dialog[open]')];

describe('form dialogs closed by the browser', () => {
  it('keep a filled-in form and ask, when Chrome closes it on a repeated Escape', async () => {
    const { openFormDialog } = await import('../src/ui/form.js');
    document.body.replaceChildren();
    const done = openFormDialog({ title: 'Add expense', fields: [{ id: 'note', label: 'Note' }], onSave: () => true });
    const dlg = document.querySelector('dialog[open]');
    const input = dlg.querySelector('input');
    input.value = 'Tolls for the week';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // Chrome, after "Keep editing" was chosen with Escape: the cancel event
    // can't be prevented, and the dialog closes right after it.
    dlg.dispatchEvent(new Event('cancel', { cancelable: false }));
    HTMLDialogElement.prototype.close.call(dlg);
    dlg.dispatchEvent(new Event('close'));
    await tick();
    expect(dlg.isConnected).toBe(true);
    expect(openDialogs()).toEqual([dlg, expect.anything()]);
    [...openDialogs()[1].querySelectorAll('button')].find((b) => /Keep editing/.test(b.textContent)).click();
    await tick();
    expect(openDialogs()).toEqual([dlg]);
    expect(input.value).toBe('Tolls for the week');
    expect(await Promise.race([done, tick(20).then(() => 'open')])).toBe('open');
  });

  it('close a discard prompt Chrome cancels for good, and keep the form', async () => {
    const { openFormDialog } = await import('../src/ui/form.js');
    document.body.replaceChildren();
    openFormDialog({ title: 'Add expense', fields: [{ id: 'note', label: 'Note' }], onSave: () => true });
    const dlg = document.querySelector('dialog[open]');
    const input = dlg.querySelector('input');
    input.value = 'Tolls';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    dlg.dispatchEvent(new Event('cancel', { cancelable: true }));
    await tick();
    const prompt = openDialogs()[1];
    // Escape on the prompt without user activation: not preventable.
    prompt.dispatchEvent(new Event('cancel', { cancelable: false }));
    HTMLDialogElement.prototype.close.call(prompt);
    await tick();
    expect(prompt.isConnected).toBe(false);
    // Then Escape on the form, also not preventable, and no close event seen.
    dlg.dispatchEvent(new Event('cancel', { cancelable: false }));
    HTMLDialogElement.prototype.close.call(dlg);
    await tick(10);
    expect(openDialogs()).toEqual([dlg, expect.anything()]);
    expect(openDialogs()[1].textContent).toMatch(/Discard changes/);
  });
});
