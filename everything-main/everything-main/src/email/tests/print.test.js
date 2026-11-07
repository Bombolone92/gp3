import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';

/**
 * Printing: the button in the reader, and what it opens before it prints.
 * The print itself is the browser's, so it is a stub here.
 */

const settle = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

let root;
let printed = 0;

const mount = () => {
  const { fs, mailPath, objectsPath } = createSampleMailbox();
  renderApp(root, {
    fs, mailPath, objectsPath, sample: true, account: { username: 'sample' },
  });
};

const rowFor = (subject) => [...root.querySelectorAll('.row')]
  .find((row) => row.querySelector('.row-subject').textContent === subject);

const printBtn = () => root.querySelector('.msg-toolbar [aria-label="Print"]');

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
  printed = 0;
  window.print = () => { printed++; };
});

afterEach(() => {
  root.remove();
  delete window.print;
  document.querySelectorAll('.toast').forEach((node) => node.remove());
});

describe('Print', () => {
  it('is offered once a message is open, and not on the list', async () => {
    mount();
    await settle(250);
    expect(printBtn().hidden).toBe(true);
    rowFor('Welcome to your Puter mailbox').click();
    await settle(250);
    expect(printBtn().hidden).toBe(false);
    printBtn().click();
    await settle(50);
    expect(printed).toBe(1);
  });

  it('opens every message in the conversation before printing it', async () => {
    mount();
    await settle(250);
    // Opened once to read it, then again: the second time only the newest
    // message is open, the way a conversation that has been read opens.
    rowFor('Thursday walkthrough').click();
    await settle(300);
    root.querySelector('[aria-label="Back to list"]').click();
    rowFor('Thursday walkthrough').click();
    await settle(300);
    const items = () => [...root.querySelectorAll('.msg-item')];
    expect(items().length).toBe(3);
    expect(items().some((item) => !item.classList.contains('is-open'))).toBe(true);

    printBtn().click();
    await settle(300);

    expect(items().every((item) => item.classList.contains('is-open'))).toBe(true);
    expect(printed).toBe(1);
  });

  it('is hidden again when the reader closes', async () => {
    mount();
    await settle(250);
    rowFor('Welcome to your Puter mailbox').click();
    await settle(250);
    root.querySelector('[aria-label="Back to list"]').click();
    expect(printBtn().hidden).toBe(true);
  });
});
