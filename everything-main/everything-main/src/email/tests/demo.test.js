import { describe, expect, it, vi } from 'vitest';
import { createSampleDataPopulator } from '../src/lib/demo.js';
import { createSampleMailbox } from '../src/lib/sample.js';
import { createMailbox, enrichMessage } from '../src/lib/mailbox.js';
import { splitMessage, parseHeaders, extractText, listAttachments } from '../src/lib/mime.js';
import { renderApp } from '../src/ui/app.js';

describe('console sample email', () => {
  it('writes persistent MIME, preserves existing mail, groups replies and includes an attachment', async () => {
    const source = createSampleMailbox();
    const mailbox = createMailbox(source);
    await mailbox.open();
    const existing = await (await source.fs.read(mailbox.messages[0].path)).text();
    const existingPath = mailbox.messages[0].path;
    const app = { mailWrite: op => op(), refreshInbox: vi.fn() };
    const session = { ...source, app };
    const populate = createSampleDataPopulator(() => session);
    const pending = populate();
    expect(populate()).toBe(pending);
    const result = await pending;
    expect(result.created).toBe(16);
    expect(app.refreshInbox).toHaveBeenCalledOnce();
    expect(await (await source.fs.read(existingPath)).text()).toBe(existing);
    const headers = [], attachments = [];
    for (const path of result.paths) {
      const { head, body } = splitMessage(await (await source.fs.read(path)).text());
      const h = parseHeaders(head);
      headers.push(h);
      expect(h.get('from')).toMatch(/@northwind\.example>/);
      expect(extractText(body, h)).toContain('Fictional sample');
      attachments.push(...listAttachments(body, h));
    }
    expect(headers.filter(h => h.get('in-reply-to') === headers[0].get('message-id'))).toHaveLength(2);
    expect(attachments.map(a => a.filename)).toEqual(['launch-checklist.csv']);
    const fresh = createMailbox(source);
    await fresh.open();
    for (const path of result.paths) {
      const message = fresh.messages.find(m => m.path === path);
      expect(message).toBeTruthy();
      expect((await enrichMessage(source.fs, message)).unreadable).not.toBe(true);
    }
    const next = await populate();
    expect(next.paths.some(path => result.paths.includes(path))).toBe(false);
  });

  it('rejects before startup and reports partial writes, then releases the concurrency guard', async () => {
    await expect(createSampleDataPopulator(() => null)()).rejects.toThrow('Sign in');
    const source = createSampleMailbox();
    const write = vi.spyOn(source.fs, 'write');
    const app = { mailWrite: op => op(), refreshInbox: vi.fn() };
    const session = { ...source, app };
    const populate = createSampleDataPopulator(() => session);
    const original = write.getMockImplementation();
    write.mockImplementationOnce(original).mockRejectedValueOnce(new Error('Write denied'));
    await expect(populate()).rejects.toThrow('after 1 messages were saved');
    expect(app.refreshInbox).not.toHaveBeenCalled();
    expect((await populate()).created).toBe(16);
    expect(write.mock.calls.every(([, , options]) => options.overwrite === false)).toBe(true);
  });

  it('refreshes the live shell after creation through its normal write-permission path', async () => {
    const source = createSampleMailbox();
    const root = document.createElement('div');
    document.body.append(root);
    const requestWrite = vi.fn(async () => true);
    const app = renderApp(root, { ...source, sample: true, account: { username: 'sample' }, requestWrite });
    try {
      await vi.waitFor(() => expect(root.querySelector('.row')).toBeTruthy());
      vi.spyOn(source.fs, 'write').mockRejectedValueOnce(new Error('Write denied'));
      const session = { ...source, app };
      await createSampleDataPopulator(() => session)();
      expect(requestWrite).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(root.textContent).toContain('The autumn launch is ready for review'));
    } finally { root.remove(); }
  });
});
