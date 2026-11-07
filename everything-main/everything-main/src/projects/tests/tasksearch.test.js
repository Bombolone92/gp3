import { describe, it, expect } from 'vitest';
import {
  searchTasks, matchAt, matchTask, matchSnippet, MATCH_LABELS,
} from '../src/lib/tasksearch.js';

const project = (id, name, tasks, extra = {}) => ({
  entry: { id, name, color: '#000', ...extra },
  doc: {
    id,
    tasks: tasks.map((task, i) => (typeof task === 'string'
      ? { id: `${id}-${i}`, title: task }
      : { id: `${id}-${i}`, ...task })),
  },
});

const DOCS = [
  project('p1', 'Launch', ['Beta invitations', 'Write the beta email']),
  project('p2', 'Old work', ['Beta feedback'], { archived: true }),
];

describe('searchTasks', () => {
  it('finds title matches across projects', () => {
    expect(searchTasks(DOCS, 'beta').map((r) => r.task.title)).toEqual([
      'Beta invitations',  // prefix match, live project
      'Write the beta email',
      'Beta feedback',     // archived, so last however well it matches
    ]);
  });

  it('is case-insensitive and reports where it matched', () => {
    const [first] = searchTasks(DOCS, 'BETA');
    expect(first.at).toBe(0);
    expect(matchAt('Write the beta email', 'beta')).toBe(10);
    expect(matchAt(null, 'beta')).toBe(-1);
  });

  it('returns nothing for an empty query', () => {
    expect(searchTasks(DOCS, '   ')).toEqual([]);
    expect(searchTasks(DOCS, undefined)).toEqual([]);
  });

  it('returns nothing when nothing matches', () => {
    expect(searchTasks(DOCS, 'zzz')).toEqual([]);
  });
});

describe('searching the content of a task', () => {
  const CONTENT = [
    project('p1', 'Launch', [
      { title: 'Ship it', description: 'We chose **Postmark** for the blast' },
      { title: 'Groom', checklist: [{ id: 'i1', text: 'Ask about Postmark limits' }] },
      { title: 'Decide', comments: [{ id: 'c1', text: 'Postmark it is, then' }] },
      { title: 'Collect', attachments: [{ id: 'a1', name: 'postmark-quote.pdf' }] },
      { title: 'Unrelated', description: 'nothing to see' },
    ]),
  ];

  it('finds a match in a description, checklist, comment, or attachment name', () => {
    const found = searchTasks(CONTENT, 'postmark');
    expect(found.map((r) => [r.task.title, r.match.field])).toEqual([
      ['Ship it', 'description'],
      ['Groom', 'checklist'],
      ['Decide', 'comment'],
      ['Collect', 'attachment'],
    ]);
    // Every field a result can come from has words for it.
    for (const r of found) expect(MATCH_LABELS[r.match.field]).toBeTruthy();
  });

  it('ranks a title match above any body match, and archived last', () => {
    const docs = [
      project('p1', 'Live', [
        { title: 'Beta plan' },                       // title prefix
        { title: 'Plan the launch', description: 'beta' },
        { title: 'Rework the beta email' },           // title, not at the start
      ]),
      project('p2', 'Old', [{ title: 'Beta retro' }], { archived: true }),
    ];
    expect(searchTasks(docs, 'beta').map((r) => r.task.title)).toEqual([
      'Beta plan', 'Rework the beta email', 'Plan the launch', 'Beta retro',
    ]);
  });

  it('reports a title match as a title match, whatever else also matches', () => {
    const task = { title: 'Postmark', description: 'Postmark again' };
    expect(matchTask(task, 'postmark').field).toBe('title');
    expect(matchTask(task, 'postmark').at).toBe(0);
  });

  it('searches titles only when asked, for when that is the question', () => {
    const found = searchTasks(CONTENT, 'postmark', { scope: 'titles' });
    expect(found).toEqual([]);
    expect(searchTasks(CONTENT, 'ship', { scope: 'titles' }).map((r) => r.task.title))
      .toEqual(['Ship it']);
  });

  it('copes with tasks written before any of these fields existed', () => {
    const bare = [project('p1', 'Old', [{ title: 'Bare' }])];
    expect(searchTasks(bare, 'bare')).toHaveLength(1);
    expect(searchTasks(bare, 'anything')).toEqual([]);
    expect(matchTask({ title: 'x' }, 'y')).toBe(null);
  });

  it('leaves `at` pointing into the title only when the title matched', () => {
    const [body] = searchTasks(CONTENT, 'blast');
    expect(body.at).toBe(-1);
    expect(searchTasks(CONTENT, 'ship')[0].at).toBe(0);
  });
});

describe('matchSnippet', () => {
  const long = `${'a'.repeat(100)} needle ${'b'.repeat(100)}`;

  it('windows the text around the match and says which ends were cut', () => {
    const snip = matchSnippet(long, long.indexOf('needle'), 6);
    expect(snip.text.slice(snip.at, snip.at + snip.length)).toBe('needle');
    expect(snip.cutStart).toBe(true);
    expect(snip.cutEnd).toBe(true);
    expect(snip.text.length).toBeLessThan(95);
  });

  it('keeps the run-up short, so the match cannot be ellipsized away', () => {
    const snip = matchSnippet(long, long.indexOf('needle'), 6);
    expect(snip.at).toBeLessThanOrEqual(15);
  });

  it('keeps a short text whole, with nothing cut', () => {
    const snip = matchSnippet('a needle here', 2, 6);
    expect(snip).toMatchObject({ text: 'a needle here', at: 2, cutStart: false, cutEnd: false });
  });

  it('collapses newlines and tabs, and still points at the match', () => {
    const snip = matchSnippet('first line\n\n  needle  \n third', 14, 6);
    expect(snip.text).toBe('first line needle third');
    expect(snip.text.slice(snip.at, snip.at + snip.length)).toBe('needle');
  });

  it('does not throw on nothing at all', () => {
    expect(matchSnippet(null, 0, 3).text).toBe('');
    expect(matchSnippet('text', 99, 3).at).toBe(0);
  });
});
