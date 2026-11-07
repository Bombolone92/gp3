// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { liftNumberedHeadings } from '../src/lib/export-headings.js';
import { markdownLists } from '../src/lib/export-markdown-lists.js';

const label = (text) => `<span data-document-list-label data-document-list-suffix="tab">${text}&#9;</span>`;
const item = (level, number, text) => `<li${level ? ` data-heading-level="${level}"` : ''} style="list-style-type:none">${label(number)}${text}</li>`;
const list = (...items) => `<ol data-document-list-labels="explicit">${items.join('')}</ol>`;
/** Markup as the page serializes it once parsed: a bare attribute gains its empty value, a tab entity becomes a tab. */
const serialized = (html) => html.replace(/data-document-list-label /g, 'data-document-list-label="" ').replace(/&#9;/g, '\t');

describe('numbered headings in exported HTML', () => {
  it('turns a marked item into a heading of its level with its number, splitting the list around it', () => {
    const html = `<p>Before</p>${list(item(1, '1.', 'Introduction'))}<p>Body</p>${list(item(0, 'a)', 'point <strong>one</strong>'), item(2, '1.1', 'Background'), item(0, 'b)', 'point two'), item(0, 'c)', 'point three'))}`;
    expect(liftNumberedHeadings(html)).toBe('<p>Before</p><h1><span class="heading-number">1.</span> Introduction</h1><p>Body</p>'
      + serialized(`<ol data-document-list-labels="explicit">${item(0, 'a)', 'point <strong>one</strong>')}</ol>`)
      + '<h2><span class="heading-number">1.1</span> Background</h2>'
      + serialized(`<ol data-document-list-labels="explicit">${item(0, 'b)', 'point two')}${item(0, 'c)', 'point three')}</ol>`));
  });
  it('leaves HTML without marked items untouched, and keeps a list nested in a heading item after the heading', () => {
    const plain = `<p>x</p>${list(item(0, '1.', 'one'))}`;
    expect(liftNumberedHeadings(plain)).toBe(plain);
    const nested = list(`<li data-heading-level="3">${label('2.')}Method<ul data-document-list-labels="explicit"><li>${label('•')}step</li></ul></li>`);
    expect(liftNumberedHeadings(nested)).toBe(serialized(`<h3><span class="heading-number">2.</span> Method</h3><ul data-document-list-labels="explicit"><li>${label('•')}step</li></ul>`));
  });
});

describe('numbered headings in exported HTML: the number is text', () => {
  it('escapes markup and ampersands in a heading number instead of writing them as tags', () => {
    const html = list(item(1, '&lt;img src=x onerror=alert(1)&gt; &amp; 1.', 'Introduction'));
    expect(liftNumberedHeadings(html)).toBe('<h1><span class="heading-number">&lt;img src=x onerror=alert(1)&gt; &amp; 1.</span> Introduction</h1>');
  });
});

describe('numbered headings in exported Markdown', () => {
  it('writes a marked item as a heading line with its number, the items around it as lists', () => {
    const md = `Before\n\n${list(item(1, '1.', 'Introduction'))}\n\nBody\n\n${list(item(0, '1.', 'point <strong>one</strong>'), item(2, '1.1', 'Background'), item(0, '2.', 'point two'))}\n\nAfter`;
    expect(markdownLists(md)).toBe('Before\n\n# 1. Introduction\n\nBody\n\n1. point **one**\n\n## 1.1 Background\n\n2. point two\n\nAfter');
  });
});
