import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';

/**
 * The Unsubscribe control in the reader, over the sample newsletter that
 * carries a List-Unsubscribe header.
 */

const settle = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

const NEWSLETTER = 'Issue 214: Interfaces that disappear';
const PLAIN = 'Welcome to your Puter mailbox';

let root;

const mount = (extra = {}) => {
  const { fs, mailPath, objectsPath } = createSampleMailbox();
  renderApp(root, {
    fs, mailPath, objectsPath, sample: true, account: { username: 'sample' }, ...extra,
  });
};

const rowFor = (subject) => [...root.querySelectorAll('.row')]
  .find((row) => row.querySelector('.row-subject').textContent === subject);

const open = async (subject) => {
  rowFor(subject).click();
  await settle(250);
};

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  document.querySelectorAll('.toast, .modal-root').forEach((node) => node.remove());
});

describe('Unsubscribe', () => {
  it('is beside the sender of a message that names a way out', async () => {
    mount();
    await settle(250);
    await open(NEWSLETTER);
    const control = root.querySelector('.msg-unsubscribe');
    expect(control).not.toBe(null);
    expect(control.closest('.msg-from')).not.toBe(null);
    expect(control.textContent).toBe('Unsubscribe');
  });

  it('opens the list\'s own page where there is nowhere to write from', async () => {
    mount();
    await settle(250);
    await open(NEWSLETTER);
    const control = root.querySelector('.msg-unsubscribe');
    // The sample inbox cannot send, so the mailto is not on offer.
    expect(control.tagName).toBe('A');
    expect(control.getAttribute('href')).toBe('https://designweekly.example/unsubscribe?u=sample');
    expect(control.getAttribute('target')).toBe('_blank');
    expect(control.getAttribute('rel')).toBe('noopener noreferrer');
    expect(control.title).toContain('designweekly.example');
  });

  it('writes to the list where it can, prefilled and shown first', async () => {
    let prefill = null;
    mount({ onCompose: (given) => { prefill = given; } });
    await settle(250);
    await open(NEWSLETTER);
    const control = root.querySelector('.msg-unsubscribe');
    expect(control.tagName).toBe('BUTTON');
    control.click();
    expect(prefill).toMatchObject({
      kind: 'unsubscribe',
      to: 'leave@designweekly.example',
      subject: 'unsubscribe',
    });
  });

  it('is absent from a message that names none', async () => {
    mount();
    await settle(250);
    await open(PLAIN);
    expect(root.querySelector('.msg-unsubscribe')).toBe(null);
  });
});
