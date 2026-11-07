import { describe, it, expect } from 'vitest';
import { parseRoute, projectHash, taskHash } from '../src/lib/routes.js';

describe('parseRoute', () => {
  it('treats anything unrecognized as home', () => {
    for (const hash of ['', '#', '#/', '#/nope', '#/p']) {
      expect(parseRoute(hash).name).toBe('home');
    }
    expect(parseRoute(undefined).name).toBe('home');
  });

  it('parses settings', () => {
    expect(parseRoute('#/settings')).toEqual({ name: 'settings' });
  });

  it('parses the two cross-project views', () => {
    expect(parseRoute('#/today')).toEqual({ name: 'today' });
    expect(parseRoute('#/all')).toEqual({ name: 'all' });
  });

  it('parses a project board and its tabs', () => {
    expect(parseRoute('#/p/abc')).toEqual({ name: 'project', id: 'abc', tab: 'board', taskId: null });
    expect(parseRoute('#/p/abc/timeline').tab).toBe('timeline');
    expect(parseRoute('#/p/abc/milestones').tab).toBe('milestones');
    expect(parseRoute('#/p/abc/list').tab).toBe('list');
    // An unknown tab is a board link, not a broken page.
    expect(parseRoute('#/p/abc/bogus').tab).toBe('board');
  });

  it('parses an open task from the path and from the query', () => {
    expect(parseRoute('#/p/abc/t/t1')).toEqual({
      name: 'project', id: 'abc', tab: 'board', taskId: 't1',
    });
    expect(parseRoute('#/p/abc/timeline?task=t1')).toEqual({
      name: 'project', id: 'abc', tab: 'timeline', taskId: 't1',
    });
    expect(parseRoute('#/p/abc/t/')).toMatchObject({ tab: 'board', taskId: null });
  });

  it('ignores a stray query on other routes', () => {
    expect(parseRoute('#/settings?task=t1')).toEqual({ name: 'settings' });
    expect(parseRoute('#/?task=t1').name).toBe('home');
  });

  it('survives a malformed escape instead of throwing', () => {
    expect(parseRoute('#/p/%E0%A4%A/t/x')).toMatchObject({ id: '%E0%A4%A', taskId: 'x' });
  });
});

describe('hash builders', () => {
  it('round-trips project hashes', () => {
    for (const tab of ['board', 'timeline', 'milestones', 'list']) {
      expect(parseRoute(projectHash('p1', tab))).toEqual({
        name: 'project', id: 'p1', tab, taskId: null,
      });
    }
  });

  it('round-trips task hashes on every tab', () => {
    for (const tab of ['board', 'timeline', 'milestones', 'list']) {
      expect(parseRoute(taskHash('p1', 't1', tab))).toEqual({
        name: 'project', id: 'p1', tab, taskId: 't1',
      });
    }
  });
});
