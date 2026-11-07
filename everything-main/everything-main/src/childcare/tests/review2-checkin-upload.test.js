// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

const uploads = [];
URL.createObjectURL ||= () => 'blob:test';
URL.revokeObjectURL ||= () => {};
vi.mock('../src/files.js', () => ({
  isImage: (t) => /^image\//.test(t),
  saveFile: vi.fn(
    (f) =>
      new Promise((resolve) => uploads.push(() => resolve({ id: f.name, name: f.name, type: f.type, path: `media/x/${f.name}` }))),
  ),
  deleteFile: vi.fn(async () => {}),
  fileUrl: () => Promise.reject(new Error('none')),
}));

const { setupStore, settle } = await import('./review2-checkin-env.js');
const { app } = await import('../src/app.js');
const { activityName } = await import('../src/core/activities.js');
const files = await import('../src/files.js');

describe('log activity uploads', () => {
  it('cancelling while photos upload does not save the entry, and removes the uploads', async () => {
    const store = await setupStore({ students: [{ id: 's1', firstName: 'Ava', status: 'active' }] });
    const { openLogActivity } = await import('../src/views/log.js');
    const done = openLogActivity({ type: 'photo', studentIds: ['s1'] });
    const dlg = document.querySelector('dialog[open]');
    const input = dlg.querySelector('input[type=file]');
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'a.png', { type: 'image/png' })] });
    input.dispatchEvent(new Event('change'));
    dlg.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    [...dlg.querySelectorAll('.dialog-foot button')].find((b) => b.textContent === 'Cancel').click();
    expect(await done).toBeNull();
    uploads.shift()();
    await settle();
    await settle();
    expect(store.all(activityName(app.today()))).toHaveLength(0);
    expect(files.deleteFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'media/x/a.png' }));
  });
});
