import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';

/**
 * Saving an attachment into the user's Puter files, through the save dialog
 * the shell is handed. The dialog is a stub: what is checked is what it is
 * given and what is said afterwards.
 */

const settle = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));
const WITH_FILE = 'Q3 usage report attached';

let root;

const mount = (extra = {}) => {
  const { fs, mailPath, objectsPath } = createSampleMailbox();
  renderApp(root, {
    fs, mailPath, objectsPath, sample: true, account: { username: 'sample' }, ...extra,
  });
};

const open = async (subject) => {
  [...root.querySelectorAll('.row')]
    .find((row) => row.querySelector('.row-subject').textContent === subject)
    .click();
  await settle(250);
};

const lastToast = () => [...document.querySelectorAll('.toast')].pop()?.textContent ?? '';

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  document.querySelectorAll('.toast').forEach((node) => node.remove());
});

describe('Save to Puter', () => {
  it('is not offered where there is no save dialog to hand the file to', async () => {
    mount();
    await settle(250);
    await open(WITH_FILE);
    expect(root.querySelector('.attachment')).not.toBe(null);
    expect(root.querySelector('.attachment-save')).toBe(null);
  });

  it('hands the decoded file and its safe name to the save dialog', async () => {
    const given = [];
    mount({
      saveToPuter: async (blob, name) => {
        given.push({ blob, name });
        return { name };
      },
    });
    await settle(250);
    await open(WITH_FILE);
    const save = root.querySelector('.attachment-save');
    expect(save).not.toBe(null);
    const chipName = save.parentElement.querySelector('.attachment-name').textContent;
    expect(save.getAttribute('aria-label')).toBe(`Save ${chipName} to your Puter files`);

    save.click();
    await settle(50);

    expect(given).toHaveLength(1);
    expect(given[0].name).toBe(chipName);
    expect(given[0].blob).toBeInstanceOf(Blob);
    expect(given[0].blob.size).toBeGreaterThan(0);
    expect(lastToast()).toBe(`Saved ${chipName} to your Puter files.`);
  });

  it('says nothing when the dialog is dismissed', async () => {
    mount({ saveToPuter: async () => { throw new Error('dismissed'); } });
    await settle(250);
    await open(WITH_FILE);
    root.querySelector('.attachment-save').click();
    await settle(50);
    expect(document.querySelectorAll('.toast')).toHaveLength(0);
  });
});
