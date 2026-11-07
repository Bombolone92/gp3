import { describe, it, expect } from 'vitest';
import { kbOps, kbStructure, sectionPath, helpfulness, filterArticles } from '../src/views/kb.js';
import { validateConfig } from '../src/server/config.js';

const base = () => ({
  categories: [{ id: 'cat-a', name: 'General', order: 0 }, { id: 'cat-b', name: 'Billing', order: 1 }],
  sections: [
    { id: 'sec-1', categoryId: 'cat-a', name: 'Start', order: 0 },
    { id: 'sec-2', categoryId: 'cat-a', name: 'FAQ', order: 1 },
    { id: 'sec-3', categoryId: 'cat-b', name: 'Invoices', order: 0 },
  ],
});

describe('knowledge base structure edits', () => {
  it('adds categories and sections that survive server validation', () => {
    let kb = kbOps.addCategory(base(), 'Accounts');
    const cat = kb.categories[kb.categories.length - 1];
    kb = kbOps.addSection(kb, cat.id, 'Sign in');
    const clean = validateConfig('kb', kb);
    expect(clean.categories.map((c) => c.name)).toEqual(['General', 'Billing', 'Accounts']);
    expect(clean.sections.find((s) => s.categoryId === cat.id).name).toBe('Sign in');
  });

  it('adds new categories and sections last, after some were deleted', () => {
    let kb = kbOps.addCategory(base(), 'Accounts');
    kb = kbOps.remove(kb, 'category', 'cat-a');
    kb = kbOps.remove(kb, 'category', 'cat-b');
    kb = kbOps.addCategory(kb, 'Security');
    expect(kbStructure(kb).map((c) => c.name)).toEqual(['Accounts', 'Security']);
    kb = kbOps.addSection(base(), 'cat-a', 'Extra');
    kb = kbOps.remove(kb, 'section', 'sec-1');
    kb = kbOps.remove(kb, 'section', 'sec-2');
    kb = kbOps.addSection(kb, 'cat-a', 'Newest');
    expect(kbStructure(kb)[0].sections.map((s) => s.name)).toEqual(['Extra', 'Newest']);
  });

  it('reorders within a category only', () => {
    const kb = kbOps.move(base(), 'section', 'sec-2', -1);
    const tree = kbStructure(kb);
    expect(tree[0].sections.map((s) => s.id)).toEqual(['sec-2', 'sec-1']);
    expect(tree[1].sections.map((s) => s.id)).toEqual(['sec-3']);
    expect(kbOps.move(kb, 'section', 'sec-3', 1)).toBe(kb);
  });

  it('moves categories and renames items', () => {
    let kb = kbOps.move(base(), 'category', 'cat-b', -1);
    kb = kbOps.rename(kb, 'category', 'cat-b', 'Payments');
    expect(kbStructure(kb).map((c) => c.name)).toEqual(['Payments', 'General']);
  });

  it('removing a category removes its sections', () => {
    const kb = kbOps.remove(base(), 'category', 'cat-a');
    expect(kb.sections.map((s) => s.id)).toEqual(['sec-3']);
  });

  it('finds a section path', () => {
    const p = sectionPath(base(), 'sec-3');
    expect(p.section.name).toBe('Invoices');
    expect(p.category.name).toBe('Billing');
    expect(sectionPath(base(), 'nope').section).toBe(null);
  });
});

describe('article list helpers', () => {
  const list = [
    { id: 1, title: 'Reset password', status: 'published', section: 'sec-1', updatedAt: 3, up: 3, down: 1 },
    { id: 2, title: 'Draft about billing', status: 'draft', section: 'sec-3', updatedAt: 5, labels: ['money'] },
    { id: 3, title: 'Loose article', status: 'published', section: null, updatedAt: 1 },
  ];

  it('filters by status, section and words, newest first', () => {
    expect(filterArticles(list).map((a) => a.id)).toEqual([2, 1, 3]);
    expect(filterArticles(list, { status: 'published' }).map((a) => a.id)).toEqual([1, 3]);
    expect(filterArticles(list, { section: 'none' }).map((a) => a.id)).toEqual([3]);
    expect(filterArticles(list, { q: 'money' }).map((a) => a.id)).toEqual([2]);
  });

  it('computes helpfulness', () => {
    expect(helpfulness(list[0])).toBe(75);
    expect(helpfulness(list[2])).toBe(null);
  });
});
