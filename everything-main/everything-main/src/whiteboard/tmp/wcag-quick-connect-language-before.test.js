import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { board, item, validateBoard } from '../src/model.js';
import { createQuickConnectUI } from '../src/quick-connect-ui.js';
import { language, setLanguage } from '../src/i18n.js';

test('quick-connect destination description preserves the saved phrase language', () => {
  const dom = new JSDOM('<html lang="en"><body><div id="quick"></div></body></html>');
  const previousDocument = globalThis.document, previousLanguage = language;
  globalThis.document = dom.window.document;
  setLanguage('en');
  const source = item('rect', 0, 0, { w: 100, h: 100, text: 'Start' });
  const target = item('ellipse', 200, 0, { w: 100, h: 100, text: 'Bonjour à tous.', lang: 'fr-CA' });
  const b = { ...board(), items: [source, target] };
  validateBoard(b);
  const root = dom.window.document.querySelector('#quick');
  let ui;
  ui = createQuickConnectUI({ state: () => ({ board: b, source, view: { x: 0, y: 0, z: 1 } }), draw: () => ui.render() });
  try {
    ui.bind(root);
    ui.render();
    const button = root.querySelector('[data-quick-direction="right"]');
    button.focus();
    const plan = ui.render();
    assert.equal(plan.target.id, target.id);
    assert.ok(button.title.includes('Bonjour à tous.'), 'The actual destination is exposed in the description');
    console.log(JSON.stringify({ page: dom.window.document.documentElement.lang, title: button.title, button: button.outerHTML, descriptions: button.getAttribute('aria-describedby').split(/\s+/).map(id => dom.window.document.getElementById(id).outerHTML) }));
    assert.equal(root.querySelector('[lang="fr-CA"]')?.textContent, 'Bonjour à tous.');
  } finally {
    setLanguage(previousLanguage);
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    dom.window.close();
  }
});
