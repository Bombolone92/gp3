// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { normalizeMarkup, normalizeMarkdown } from '../src/lib/import-markup.js';
import { htmlBody, toInsertPayload } from '../src/lib/importers.js';

const normalized = (html) => { const doc = new DOMParser().parseFromString(html, 'text/html'); normalizeMarkup(doc.body); return doc.body.innerHTML; };

describe('markup the converter reads poorly', () => {
  it('turns a definition list into term and definition paragraphs', () => {
    expect(normalized('<dl><dt>Term</dt><dd>Definition</dd><dt>T2</dt><dd>D2</dd></dl>')).toBe('<p><b>Term</b></p><p>Definition</p><p><b>T2</b></p><p>D2</p>');
  });

  it('moves a table caption before the table as a centered italic line', () => {
    expect(normalized('<table><caption>Sales <b>2026</b></caption><tr><td>a</td></tr></table>')).toBe('<p style="text-align:center"><i>Sales <b>2026</b></i></p><table><tbody><tr><td>a</td></tr></tbody></table>');
  });

  it('keeps a task list\'s state as characters and drops hidden content', () => {
    expect(normalized('<ul><li><input type="checkbox"> todo</li><li><input type="checkbox" checked> done</li></ul><p hidden>gone</p><span style="display: none">gone too</span><p style="display:block">kept</p>'))
      .toBe('<ul><li>☐  todo</li><li>☑  done</li></ul><p style="display:block">kept</p>');
  });

  it('reads terms and definitions grouped in divs', () => {
    expect(htmlBody('<dl><div><dt>Term</dt><dd>Def</dd></div><div><dt>T2</dt><dd>D2</dd></div></dl>')).toBe('<p><b>Term</b></p><p>Def</p><p><b>T2</b></p><p>D2</p>');
  });

  it('runs as part of preparing an HTML page', () => {
    expect(htmlBody('<html><body><dl><dt>A</dt><dd>B</dd></dl></body></html>')).toBe('<p><b>A</b></p><p>B</p>');
  });
});

describe('markdown the converter reads poorly', () => {
  it('drops YAML front matter and keeps task list states', () => {
    expect(normalizeMarkdown('---\ntitle: Hello\nauthor: Me\n---\n\n# Heading\n\n- [ ] todo\n- [x] done\n  - [X] nested\n1. [ ] numbered\n\n[not] a task')).toBe('\n# Heading\n\n- ☐ todo\n- ☑ done\n  - ☑ nested\n1. ☐ numbered\n\n[not] a task');
    expect(normalizeMarkdown('﻿---\r\ntitle: X\r\n...\r\nBody')).toBe('Body');
    // A rule that is not front matter stays.
    expect(normalizeMarkdown('Intro\n\n---\n\nAfter')).toBe('Intro\n\n---\n\nAfter');
    expect(toInsertPayload('---\ntitle: T\n---\nBody', 'markdown').value).toBe('Body');
  });

  it('keeps the opening section of a document that merely starts with a rule', () => {
    const rules = '---\n\n# Title\n\nSome text.\n\n---\n\nAfter the rule.';
    expect(normalizeMarkdown(rules)).toBe(rules);
    const prose = '---\nAn intro paragraph.\n---\nBody';
    expect(normalizeMarkdown(prose)).toBe(prose);
    const longer = '---\nIntro\n-----\n\nAfter.';
    expect(normalizeMarkdown(longer)).toBe(longer);
    const ellipsis = '---\nIntro\n...and it goes on.\n';
    expect(normalizeMarkdown(ellipsis)).toBe(ellipsis);
    // Real front matter still goes, including lists, comments and non-Latin keys.
    expect(normalizeMarkdown('---\ntitle: "A: B"\ntags:\n  - a\n  - b\n# note\n제목: 안녕\n---\nBody')).toBe('Body');
  });

  it('leaves task list syntax shown inside a fenced code block as written', () => {
    const fenced = '```md\n- [ ] not a task\n```\n- [ ] real\n~~~\n1. [x] shown\n~~~\n- [x] done';
    expect(normalizeMarkdown(fenced)).toBe('```md\n- [ ] not a task\n```\n- ☐ real\n~~~\n1. [x] shown\n~~~\n- ☑ done');
    // A fence closes only with a fence of its own kind and at least its length.
    expect(normalizeMarkdown('````\n```\n- [ ] still code\n````\n- [ ] task')).toBe('````\n```\n- [ ] still code\n````\n- ☐ task');
    expect(normalizeMarkdown('```\r\n- [ ] code\r\n```\r\n- [ ] task\r\n')).toBe('```\r\n- [ ] code\r\n```\r\n- ☐ task\r\n');
  });
});

describe('lists deeper than DOCX allows', () => {
  const nested = (n, tag = 'ul') => (n === 0 ? '<li>deep</li>' : `<li>level ${n}<${tag}>${nested(n - 1, tag)}</${tag}></li>`);
  const depths = (html) => { const doc = new DOMParser().parseFromString(html, 'text/html'); return [...doc.querySelectorAll('li')].map((li) => { let n = 0; for (let p = li.parentElement?.closest('li'); p; p = p.parentElement?.closest('li')) n++; return n; }); };
  it('lifts items past the ninth level into the ninth list, keeping every item and their order', () => {
    const html = normalized(`<ul>${nested(12)}</ul>`);
    expect(Math.max(...depths(html))).toBe(8);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect([...doc.querySelectorAll('li')].map((li) => li.firstChild.textContent.trim())).toEqual(['level 12', 'level 11', 'level 10', 'level 9', 'level 8', 'level 7', 'level 6', 'level 5', 'level 4', 'level 3', 'level 2', 'level 1', 'deep']);
    expect(doc.querySelectorAll('li').length).toBe(13);
  });
  it('leaves nine levels alone', () => {
    const html = `<ol>${nested(8, 'ol')}</ol>`;
    expect(normalized(html)).toBe(html);
  });
});
