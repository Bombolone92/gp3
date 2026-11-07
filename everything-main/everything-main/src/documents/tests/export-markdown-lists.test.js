// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { markdownLists } from '../src/lib/export-markdown-lists.js';

const label = (text) => `<span data-document-list-label data-document-list-suffix="tab">${text}&#9;</span>`;
const li = (marker, body) => `<li style="list-style-type:none">${label(marker)}${body}</li>`;

describe('markdownLists', () => {
  it('turns the engine\'s raw-HTML lists into Markdown lists, nested by indentation', () => {
    const bullets = `<ul data-document-list-labels="explicit">${li('•', 'One')}${li('•', `Two<ul data-document-list-labels="explicit">${li('◦', 'Nested')}</ul>`)}</ul>`;
    const numbers = `<ol data-document-list-labels="explicit">${li('1.', 'A')}${li('2.', 'B')}</ol>`;
    expect(markdownLists(`Before\n\n${bullets}\n\n${numbers}\n\nAfter`)).toBe('Before\n\n- One\n- Two\n  - Nested\n\n1. A\n2. B\n\nAfter');
    // The engine writes one list straight after another on the same line.
    expect(markdownLists(`Before\n\n${bullets}${numbers}\n\nAfter`)).toBe('Before\n\n- One\n- Two\n  - Nested\n\n1. A\n2. B\n\nAfter');
  });

  it('writes checkbox bullets as task list items, keeping which are done', () => {
    const todo = `<ul data-document-list-labels="explicit">${li('☐', 'Open task')}${li('☑', 'Done task')}${li('☒', 'Also done')}</ul>`;
    expect(markdownLists(todo)).toBe('- [ ] Open task\n- [x] Done task\n- [x] Also done');
  });

  it('escapes a heading number that holds markup or Markdown punctuation', () => {
    const heading = `<ol data-document-list-labels="explicit"><li data-heading-level="1" style="list-style-type:none">${label('&lt;b&gt;1.&lt;/b&gt; *x*')}Title</li></ol>`;
    expect(markdownLists(heading)).toBe('# \\<b\\>1.\\</b\\> \\*x\\* Title');
  });

  it('keeps a bookmark target on a list item, so the links to it still reach it', () => {
    const list = `<ol data-document-list-labels="explicit">${li('1.', '<span id="document-bookmark-1"></span>Target item')}${li('2.', 'Next')}</ol>`;
    expect(markdownLists(list)).toBe('1. <span id="document-bookmark-1"></span>Target item\n2. Next');
  });

  it('keeps two numbered lists in a row apart, so a restarted numbering does not carry on', () => {
    const one = `<ol data-document-list-labels="explicit">${li('1.', 'A')}${li('2.', 'B')}</ol>`;
    const two = `<ol data-document-list-labels="explicit">${li('1.', 'C')}${li('2.', 'D')}</ol>`;
    expect(markdownLists(`${one}${two}`)).toBe('1. A\n2. B\n\n<!-- -->\n\n1. C\n2. D');
    expect(markdownLists(`${one}\n\n${two}`)).toBe('1. A\n2. B\n\n<!-- -->\n\n1. C\n2. D');
    // A paragraph between them, or a list of the other kind, already keeps them apart.
    expect(markdownLists(`${one}\n\nBetween\n\n${two}`)).toBe('1. A\n2. B\n\nBetween\n\n1. C\n2. D');
  });

  it('keeps numbering Markdown understands and counts on where it has no words for the marker', () => {
    const numbered = `<ol data-document-list-labels="explicit">${li('7)', 'Seven')}${li('8)', 'Eight')}</ol>`;
    expect(markdownLists(numbered)).toBe('7) Seven\n8) Eight');
    const lettered = `<ol data-document-list-labels="explicit">${li('a.', 'Alpha')}${li('b.', `Beta<ol data-document-list-labels="explicit">${li('i.', 'Roman')}</ol>`)}</ol>`;
    expect(markdownLists(lettered)).toBe('1. Alpha\n2. Beta\n   1. Roman');
  });

  it('writes the inline formatting Markdown has words for and keeps the text of the rest', () => {
    const source = `<ul data-document-list-labels="explicit">${li('•', 'Read <strong>this</strong> and <em>that</em>, <a href="https://example.com/x">a link</a>, <code>code</code>, <u>plain</u> &amp; more')}</ul>`;
    expect(markdownLists(source)).toBe('- Read **this** and *that*, [a link](https://example.com/x), `code`, plain \\& more');
  });

  it('escapes typed punctuation and markup so it stays text, as the engine does in paragraphs', () => {
    const source = `<ul data-document-list-labels="explicit">${li('•', 'see &lt;b&gt;tag&lt;/b&gt; and *star* and 2 &lt; 3 &lt;/ul&gt;')}${li('•', '<code>a `tick` in code</code> and <a href="https://example.com/a(b) c">a (link)</a>')}</ul>`;
    expect(markdownLists(source)).toBe('- see \\<b\\>tag\\</b\\> and \\*star\\* and 2 \\< 3 \\</ul\\>\n- ``a `tick` in code`` and [a \\(link\\)](https://example.com/a\\(b\\)%20c)');
  });

  it('keeps the spaces around a formatted run outside its delimiters', () => {
    const source = `<ul data-document-list-labels="explicit">${li('•', 'Two <strong>bold </strong>and <em> both </em>here <code> x </code>.')}</ul>`;
    // A code span keeps its spaces (a reader trims one on each side); the period is written as the engine would.
    expect(markdownLists(source)).toBe('- Two **bold** and *both* here ` x `\\.');
  });

  it('writes a line break inside an item as a hard break, continued at the item text', () => {
    const source = `<ol data-document-list-labels="explicit">${li('1.', 'First line<br>second line')}${li('2.', 'Plain')}</ol>`;
    expect(markdownLists(source)).toBe('1. First line  \n   second line\n2. Plain');
    const nested = `<ul data-document-list-labels="explicit">${li('•', `Top<ul data-document-list-labels="explicit">${li('◦', 'One<br>two')}</ul>`)}</ul>`;
    expect(markdownLists(nested)).toBe('- Top\n  - One  \n    two');
  });

  it('keeps a picture inside a list item', () => {
    const source = `<ul data-document-list-labels="explicit">${li('•', 'Photo <img src="data:image/png;base64,AAAA" alt="A cat" width="40"> here')}${li('•', '<a href="https://example.com/"><img src="https://example.com/x.png" alt=""></a>')}</ul>`;
    expect(markdownLists(source)).toBe('- Photo ![A cat](data:image/png;base64,AAAA) here\n- [![](https://example.com/x.png)](https://example.com/)');
  });

  it('leaves other Markdown and HTML alone', () => {
    expect(markdownLists('# Title\n\n<ul><li>hand-written</li></ul>\n\n- already a list')).toBe('# Title\n\n<ul><li>hand-written</li></ul>\n\n- already a list');
    expect(markdownLists('')).toBe('');
    expect(markdownLists(null)).toBe('');
  });
});
