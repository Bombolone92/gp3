import { describe, it, expect } from 'vitest';
import { createSampleMailbox, SAMPLE_ADDRESS } from '../src/lib/sample.js';
import { createMailbox, enrichMessage } from '../src/lib/mailbox.js';
import { splitMessage, parseHeaders, extractText, listAttachments } from '../src/lib/mime.js';

// The sample inbox runs through the exact same code path as a real mailbox,
// so this suite is an end-to-end check of layout, parsing, and enrichment.

const NOW = new Date(2026, 7, 19, 12, 0, 0);

const openSample = async () => {
  const { fs, objectsPath } = createSampleMailbox(NOW);
  const mailbox = createMailbox({ fs, objectsPath });
  await mailbox.open();
  return { fs, mailbox };
};

describe('sample mailbox', () => {
  it('serves the emailrx layout: day folders of subject-named files', async () => {
    const { fs, objectsPath } = createSampleMailbox(NOW);
    const days = await fs.readdir(objectsPath);
    expect(days.length).toBeGreaterThan(3);
    expect(days.every((d) => d.is_dir && /^\d{4}-\d{2}-\d{2}$/.test(d.name))).toBe(true);
  });

  it('loads every message newest-first', async () => {
    const { mailbox } = await openSample();
    expect(mailbox.messages.length).toBeGreaterThanOrEqual(10);
    const times = mailbox.messages.map((m) => `${m.day}/${m.name}`);
    expect([...times].sort().reverse()).toEqual(times);
    expect(mailbox.hasMore).toBe(false);
  });

  it('dates nothing after now, even early in the morning', async () => {
    for (const now of [new Date(2026, 9, 12, 6, 0), NOW]) {
      const { fs, objectsPath } = createSampleMailbox(now);
      const mailbox = createMailbox({ fs, objectsPath });
      await mailbox.open();
      for (const message of mailbox.messages) {
        const { date } = await enrichMessage(fs, message);
        expect(date.getTime()).toBeLessThanOrEqual(now.getTime());
      }
    }
  });

  it('enriches every message with a sender and clean preview', async () => {
    const { fs, mailbox } = await openSample();
    for (const message of mailbox.messages) {
      const patch = await enrichMessage(fs, message);
      expect(patch.from.name).not.toBe('(unreadable)');
      expect(patch.from.email).toContain('@');
      expect(patch.date).toBeInstanceOf(Date);
      // Previews must never leak raw base64 or quoted-printable escapes.
      expect(patch.snippet).not.toMatch(/=C3|Q29udGVud|<html/i);
    }
  });

  it('parses each full message to readable text addressed to the sample user', async () => {
    const { fs, mailbox } = await openSample();
    for (const message of mailbox.messages) {
      const raw = await (await fs.read(message.path)).text();
      const { head, body } = splitMessage(raw);
      const headers = parseHeaders(head);
      expect(headers.get('to')).toContain(SAMPLE_ADDRESS);
      expect(extractText(body, headers).length).toBeGreaterThan(20);
    }
  });

  it('includes a downloadable csv attachment and a previewable image', async () => {
    const { fs, mailbox } = await openSample();
    const all = [];
    for (const message of mailbox.messages) {
      const raw = await (await fs.read(message.path)).text();
      const { head, body } = splitMessage(raw);
      all.push(...listAttachments(body, parseHeaders(head)));
    }
    expect(all.map((a) => a.filename).sort()).toEqual(['q3-usage.csv', 'swatch.png']);
    const csv = new TextDecoder().decode(all.find((a) => a.filename === 'q3-usage.csv').bytes());
    expect(csv.startsWith('week,active_users,storage_gb')).toBe(true);
    const png = all.find((a) => a.filename === 'swatch.png');
    expect(png.type).toBe('image/png');
    // The PNG signature.
    expect([...png.bytes().slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('honors byte_count so list enrichment stays cheap', async () => {
    const { fs, mailbox } = await openSample();
    const blob = await fs.read(mailbox.messages[0].path, { byte_count: 100 });
    expect(blob.size).toBe(100);
  });
});


describe('the sample mailbox is writable', () => {
  const trashDir = '/sample/.mail/trash/2026-08-20';

  const firstMessage = async (fs, objectsPath) => {
    const [day] = await fs.readdir(objectsPath);
    const [file] = await fs.readdir(day.path);
    return file;
  };

  it('moves a message into another folder, keeping its bytes and its name', async () => {
    const { fs, objectsPath } = createSampleMailbox(new Date('2026-08-22T12:00:00Z'));
    const file = await firstMessage(fs, objectsPath);
    const before = await (await fs.read(file.path)).text();

    const { path } = await fs.move(file.path, trashDir);
    expect(path).toBe(`${trashDir}/${file.name}`);
    expect(await (await fs.read(path)).text()).toBe(before);
    await expect(fs.read(file.path)).rejects.toThrow();

    const listed = await fs.readdir(trashDir);
    expect(listed.map((item) => item.name)).toEqual([file.name]);
    expect(listed[0].bytes).toBeUndefined();
  });

  it('lists the day folders of a folder it has moved messages into', async () => {
    const { fs, objectsPath } = createSampleMailbox(new Date('2026-08-22T12:00:00Z'));
    const file = await firstMessage(fs, objectsPath);
    await fs.move(file.path, trashDir);
    const days = await fs.readdir('/sample/.mail/trash');
    expect(days).toEqual([{ name: '2026-08-20', path: trashDir, is_dir: true }]);
  });

  it('throws for an empty folder, the way a real fs does for a missing one', async () => {
    const { fs } = createSampleMailbox();
    await expect(fs.readdir('/sample/.mail/trash')).rejects.toThrow();
  });

  it('deletes a message for good', async () => {
    const { fs, objectsPath } = createSampleMailbox();
    const file = await firstMessage(fs, objectsPath);
    await fs.delete(file.path);
    await expect(fs.read(file.path)).rejects.toThrow();
    await expect(fs.delete(file.path)).rejects.toThrow();
  });

  it('writes a new file that readdir and read both see', async () => {
    const { fs } = createSampleMailbox();
    await fs.write('/sample/.mail/sent/2026-08-22/x--y', 'From: me\r\n\r\nhi\r\n');
    const [item] = await fs.readdir('/sample/.mail/sent/2026-08-22');
    expect(item.name).toBe('x--y');
    expect(await (await fs.read(item.path)).text()).toBe('From: me\r\n\r\nhi\r\n');
  });

  it('refuses a move that would overwrite a file of the same name', async () => {
    const { fs, objectsPath } = createSampleMailbox();
    const file = await firstMessage(fs, objectsPath);
    await fs.write(`${trashDir}/${file.name}`, 'other');
    await expect(fs.move(file.path, trashDir)).rejects.toThrow();
  });
});
