// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { flattenDeepMarkdownLists, MAX_LIST_LEVELS } from '../src/lib/import-markdown-depth.js';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

const outline = (levels, indent = '  ') => Array.from({ length: levels }, (_, i) => `${indent.repeat(i)}- level ${i}`).join('\n');
const deepest = (markdown) => {
  let max = -1;
  const walk = (node, depth) => { for (const child of node.children || []) { if (child.type === 'list') { max = Math.max(max, depth); walk(child, depth + 1); } else walk(child, depth); } };
  walk(fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }), 0);
  return max + 1;
};

describe('Markdown lists deeper than DOCX allows', () => {
  it('returns the text itself when no list is that deep, without parsing it', () => {
    const text = `# Title\n\n${outline(9)}\n\nSome *text* with a_b_c.\n`;
    expect(flattenDeepMarkdownLists(text)).toBe(text);
    expect(flattenDeepMarkdownLists('')).toBe('');
    expect(flattenDeepMarkdownLists(null)).toBe('');
    // Deep indentation that is not a list item (a code block) is left alone too.
    const code = '                    not a list\n';
    expect(flattenDeepMarkdownLists(code)).toBe(code);
  });

  it('lifts items past the ninth level into the ninth list, in order, for spaces and tabs', () => {
    for (const indent of ['  ', '    ', '\t']) {
      const text = outline(13, indent);
      expect(deepest(text)).toBe(13);
      const flat = flattenDeepMarkdownLists(text);
      expect(deepest(flat)).toBe(MAX_LIST_LEVELS);
      expect([...flat.matchAll(/level (\d+)/g)].map((m) => Number(m[1]))).toEqual(Array.from({ length: 13 }, (_, i) => i));
    }
  });

  it('keeps the rest of the document as it was', () => {
    const rest = 'Intro with **strong** and <span style="color:red">html</span> and [a link](http://example.com "title").\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```js\ncode();\n```\n';
    const flat = flattenDeepMarkdownLists(`${rest}\n${outline(11)}\n`);
    expect(flat.startsWith(rest.replace('| a | b |\n| - | - |', '| a | b |\n| - | - |'))).toBe(true);
    expect(deepest(flat)).toBe(MAX_LIST_LEVELS);
  });
});
