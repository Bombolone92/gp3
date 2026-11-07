import { describe, it, expect } from 'vitest';
import {
  newCollector,
  nextLinkName,
  workerPayload,
  linkState,
  toLocalInput,
  fromLocalInput,
  validateSettings,
  embedSnippet,
  mailtoLink,
  lintSurvey,
  errorMessage,
} from '../src/views/collect/logic.js';
import { makeQuestion, makeSurvey, publicSnapshot } from '../src/model/survey.js';
import { makeWorker } from './helpers.js';

const base = () => ({ ...newCollector('ssurvey00001', 'Web link 1', 1000), id: 'link000001' });

const form = (over = {}) => ({
  name: 'Newsletter',
  open: true,
  closeOn: false,
  closeAt: '',
  limitOn: false,
  maxResponses: '',
  allowMultiple: true,
  passwordOn: false,
  password: '',
  thankYouOn: false,
  tyTitle: '',
  tyMessage: '',
  tyRedirect: '',
  ...over,
});

describe('collector records', () => {
  it('starts open with no limits', () => {
    const c = newCollector('ssurvey00001', 'Web link 1', 5);
    expect(c).toMatchObject({ sid: 'ssurvey00001', status: 'open', createdAt: 5, closeAt: null, maxResponses: 0, allowMultiple: true, password: '', thankYou: null });
    expect(c.id).toMatch(/^[a-z0-9]{10}$/);
  });

  it('names new links after the first free number', () => {
    expect(nextLinkName({})).toBe('Web link 1');
    expect(nextLinkName({ a: { name: 'Web link 1' }, b: { name: 'Web link 3' } })).toBe('Web link 4');
    expect(nextLinkName({ a: { name: 'Web link 2' } })).toBe('Web link 3');
    expect(nextLinkName({ a: { name: 'Web link 2' }, b: { name: 'Other' } })).toBe('Web link 3');
  });
});

describe('workerPayload', () => {
  it('sends the password only when it changed', () => {
    const c = base();
    expect('password' in workerPayload(c, null)).toBe(false);
    expect(workerPayload({ ...c, password: 'x' }, null).password).toBe('x');
    expect('password' in workerPayload({ ...c, password: 'x' }, { ...c, password: 'x' })).toBe(false);
    expect(workerPayload({ ...c, password: '' }, { ...c, password: 'x' }).password).toBe('');
    expect(workerPayload({ ...c, password: 'y' }, { ...c, password: 'x' }).password).toBe('y');
  });

  it('carries only what the worker keeps', () => {
    const p = workerPayload({ ...base(), name: 'secret name', closeAt: 99, maxResponses: 5, allowMultiple: false }, null);
    expect(p).toEqual({ id: 'link000001', sid: 'ssurvey00001', status: 'open', closeAt: 99, maxResponses: 5, allowMultiple: false, thankYou: null });
  });
});

describe('linkState', () => {
  it('reports closed, ended, full and open', () => {
    const c = base();
    expect(linkState({ ...c, status: 'closed' })).toBe('closed');
    expect(linkState({ ...c, closeAt: 10 }, 0, 20)).toBe('ended');
    expect(linkState({ ...c, closeAt: 30 }, 0, 20)).toBe('open');
    expect(linkState({ ...c, maxResponses: 3 }, 3)).toBe('full');
    expect(linkState({ ...c, maxResponses: 3 }, 2)).toBe('open');
  });
});

describe('datetime-local values', () => {
  it('round-trips in local time to the minute', () => {
    const t = new Date(2026, 9, 12, 14, 5).getTime();
    expect(toLocalInput(t)).toBe('2026-10-12T14:05');
    expect(fromLocalInput('2026-10-12T14:05')).toBe(t);
    expect(toLocalInput(null)).toBe('');
    expect(fromLocalInput('')).toBe(null);
    expect(fromLocalInput('nope')).toBe(null);
  });
});

describe('validateSettings', () => {
  it('applies a valid form', () => {
    const { errors, value } = validateSettings(base(), form({
      open: false,
      closeOn: true,
      closeAt: '2030-01-01T09:00',
      limitOn: true,
      maxResponses: '250',
      allowMultiple: false,
      passwordOn: true,
      password: 'open-sesame',
      thankYouOn: true,
      tyTitle: ' Thanks! ',
      tyRedirect: 'https://example.com/done',
    }));
    expect(errors).toEqual({});
    expect(value).toMatchObject({
      name: 'Newsletter',
      status: 'closed',
      closeAt: new Date('2030-01-01T09:00').getTime(),
      maxResponses: 250,
      allowMultiple: false,
      password: 'open-sesame',
      thankYou: { title: 'Thanks!', message: '', redirect: 'https://example.com/done' },
    });
  });

  it('clears settings that are switched off', () => {
    const c = { ...base(), closeAt: 5, maxResponses: 9, password: 'x', thankYou: { title: 't' } };
    const { value } = validateSettings(c, form({ closeAt: '2030-01-01T09:00', maxResponses: '4', password: 'y', tyTitle: 'z' }));
    expect(value).toMatchObject({ closeAt: null, maxResponses: 0, password: '', thankYou: null });
  });

  it('reports each bad field', () => {
    const { errors } = validateSettings(base(), form({
      name: '  ',
      closeOn: true,
      limitOn: true,
      maxResponses: '2.5',
      passwordOn: true,
      thankYouOn: true,
      tyRedirect: 'http://insecure.example',
    }));
    expect(Object.keys(errors).sort()).toEqual(['closeAt', 'maxResponses', 'name', 'password', 'tyRedirect']);
    expect(validateSettings(base(), form({ thankYouOn: true })).errors).toHaveProperty('tyTitle');
    expect(validateSettings(base(), form({ limitOn: true, maxResponses: '0' })).errors).toHaveProperty('maxResponses');
    expect(validateSettings(base(), form({ thankYouOn: true, tyRedirect: 'javascript:alert(1)' })).errors).toHaveProperty('tyRedirect');
  });

  it('asks for passwords of 6 characters or more, keeping a shorter one set before', () => {
    expect(validateSettings(base(), form({ passwordOn: true, password: '4821' })).errors.password).toMatch(/6 characters/);
    expect(validateSettings(base(), form({ passwordOn: true, password: 'spring' })).errors).toEqual({});
    const old = { ...base(), password: '4821' };
    expect(validateSettings(old, form({ name: 'Renamed', passwordOn: true, password: '4821' })).errors).toEqual({});
  });

  it('refuses a new close time already past, but keeps one saved before', () => {
    const past = '2020-01-01T10:00';
    expect(validateSettings(base(), form({ closeOn: true, closeAt: past })).errors.closeAt).toMatch(/future/);
    // A link that has since ended: renaming it keeps its close time.
    const ended = { ...base(), closeAt: fromLocalInput(past) };
    const { errors, value } = validateSettings(ended, form({ name: 'Renamed', closeOn: true, closeAt: past }));
    expect(errors).toEqual({});
    expect(value.closeAt).toBe(fromLocalInput(past));
  });
});

describe('share snippets', () => {
  it('escapes the embed code and pins the message origin', () => {
    const code = embedSnippet('https://survey.puter.com/r/?embed=1#ada/link000001', 'Q&A "night" <b>');
    expect(code).toContain('src="https://survey.puter.com/r/?embed=1#ada/link000001"');
    expect(code).toContain('title="Q&amp;A &quot;night&quot; &lt;b&gt;"');
    expect(code).toContain('e.origin !== "https://survey.puter.com"');
    expect(code).toContain('frames[i].contentWindow === e.source');
    const doc = new DOMParser().parseFromString(code, 'text/html');
    expect(doc.querySelectorAll('iframe')).toHaveLength(1);
    expect(doc.querySelectorAll('script')).toHaveLength(1);
  });

  it('builds a mailto link with the survey link in the body', () => {
    const href = mailtoLink({ title: 'Team & lunch', url: 'https://x.test/r/#a/b' });
    expect(href.startsWith('mailto:?subject=')).toBe(true);
    const params = new URLSearchParams(href.slice('mailto:?'.length));
    expect(params.get('subject')).toBe('Please take this survey: Team & lunch');
    expect(params.get('body')).toContain('https://x.test/r/#a/b');
  });
});

describe('lintSurvey', () => {
  it('flags an empty survey and incomplete questions', () => {
    expect(lintSurvey(makeSurvey())).toEqual([{ qid: null, label: 'Survey', issues: ['Add at least one question.'] }]);
    const s = makeSurvey();
    const ok = makeQuestion('text', { title: 'Name?' });
    const bad = makeQuestion('single', { title: '' });
    s.pages[0].questions = [makeQuestion('statement', { title: 'Hello' }), ok, bad];
    const issues = lintSurvey(s);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ qid: bad.id, label: 'Q2' });
    expect(issues[0].issues).toEqual(['Add question text.', 'Add at least two answer choices.']);
  });
});

describe('errorMessage', () => {
  it('explains known failures', () => {
    expect(errorMessage({ code: 'email_unverified' })).toMatch(/Verify the email/);
    expect(errorMessage({ code: 'network' })).toMatch(/connection/);
    expect(errorMessage(new Error('x'))).toMatch(/Something went wrong/);
  });
});

describe('collector settings reach respondents', () => {
  it('enforces what the settings form saved', async () => {
    const w = await makeWorker();
    const s = makeSurvey({ title: 'Lunch' });
    const q = makeQuestion('nps', { title: 'Recommend?', required: true });
    s.pages[0].questions = [q];
    await w.call('POST', '/admin/publish', { admin: true, body: { survey: publicSnapshot(s) } });
    const c = { ...base(), sid: s.id };
    await w.call('POST', '/admin/collector', { admin: true, body: { collector: workerPayload(c, null) } });
    expect((await w.call('GET', `/api/c/${c.id}`)).data.survey.title).toBe('Lunch');

    const { value } = validateSettings(c, form({ passwordOn: true, password: 'pw', thankYouOn: true, tyTitle: 'Cheers' }));
    await w.call('POST', '/admin/collector', { admin: true, body: { collector: workerPayload(value, c) } });
    expect((await w.call('GET', `/api/c/${c.id}`)).data.locked).toBe(true);
    const unlocked = await w.call('POST', `/api/c/${c.id}/unlock`, { body: { password: 'pw' } });
    expect(unlocked.data.collector.thankYou).toEqual({ title: 'Cheers', message: '', redirect: '' });

    // Saving again without touching the password keeps the protection.
    const renamed = { ...value, name: 'Renamed' };
    await w.call('POST', '/admin/collector', { admin: true, body: { collector: workerPayload(renamed, value) } });
    expect((await w.call('GET', `/api/c/${c.id}`)).data.locked).toBe(true);

    const closed = { ...renamed, status: 'closed' };
    await w.call('POST', '/admin/collector', { admin: true, body: { collector: workerPayload(closed, renamed) } });
    expect((await w.call('GET', `/api/c/${c.id}`)).data.error).toBe('closed');
  });
});

describe('survey status from links', async () => {
  const { collectorsStatus, surveyStatus } = await import('../src/data/publish.js');
  const now = 1_800_000_000_000;

  it('counts only links that take responses right now', () => {
    expect(collectorsStatus({}, now)).toEqual({ status: 'draft', openUntil: 0 });
    expect(collectorsStatus({ a: { status: 'closed' } }, now).status).toBe('closed');
    expect(collectorsStatus({ a: { status: 'open', closeAt: now - 1 } }, now).status).toBe('closed');
    expect(collectorsStatus({ a: { status: 'open', closeAt: now + 10 }, b: { status: 'open', closeAt: now + 99 } }, now)).toEqual({ status: 'open', openUntil: now + 99 });
    expect(collectorsStatus({ a: { status: 'open', closeAt: now + 10 }, b: { status: 'open' } }, now)).toEqual({ status: 'open', openUntil: 0 });
  });

  it('reads as closed once the last open link has closed on its own', () => {
    expect(surveyStatus({ status: 'open', openUntil: now + 10 }, now)).toBe('open');
    expect(surveyStatus({ status: 'open', openUntil: now - 10 }, now)).toBe('closed');
    expect(surveyStatus({ status: 'open' }, now)).toBe('open');
    expect(surveyStatus({}, now)).toBe('draft');
  });
});

describe('repo bulk index updates', async () => {
  const { createRepo } = await import('../src/data/repo.js');
  const { createLocalKv } = await import('../src/data/local-kv.js');
  it('patches many surveys in one write', async () => {
    const kv = createLocalKv();
    await kv.set('sv:index', { a: { title: 'A', folder: '' }, b: { title: 'B', folder: '' }, c: { title: 'C', folder: 'f1' } });
    let writes = 0;
    const update = kv.update.bind(kv);
    kv.update = (...args) => (writes++, update(...args));
    const repo = createRepo({ kv, fs: {} });
    await repo.loadIndex();
    await repo.patchMany({ a: { folder: 'f1' }, b: { folder: 'f1' } });
    expect(writes).toBe(1);
    expect(repo.index.a).toEqual({ title: 'A', folder: 'f1' });
    const stored = await kv.get('sv:index');
    expect(stored.b).toEqual({ title: 'B', folder: 'f1' });
    expect(stored.c).toEqual({ title: 'C', folder: 'f1' });
  });
});

describe('repo autosave index writes', async () => {
  const { createRepo } = await import('../src/data/repo.js');
  const { createLocalKv } = await import('../src/data/local-kv.js');
  const { makeSurvey } = await import('../src/model/survey.js');
  it('writes the edit time to the survey list at most once a minute, and on flush', async () => {
    const kv = createLocalKv();
    const files = new Map();
    const fs = { write: async (p, d) => files.set(p, d), readText: async (p) => files.get(p) };
    let writes = 0;
    const update = kv.update.bind(kv);
    kv.update = (...args) => (writes++, update(...args));
    const repo = createRepo({ kv, fs });
    const s = await repo.createSurvey(makeSurvey({ title: 'T' }));
    writes = 0;
    await repo.saveSurvey({ ...s, updatedAt: 1 });
    await repo.saveSurvey({ ...s, updatedAt: 2 });
    await repo.saveSurvey({ ...s, updatedAt: 3 });
    expect(writes).toBe(1);
    expect(repo.index[s.id].updatedAt).toBe(3);
    // Anything else still goes out at once.
    await repo.saveSurvey({ ...s, title: 'New', updatedAt: 4 });
    expect(writes).toBe(2);
    await repo.saveSurvey({ ...s, title: 'New', updatedAt: 5 });
    await repo.flushMeta(s.id);
    expect(writes).toBe(3);
    expect((await kv.get('sv:index'))[s.id].updatedAt).toBe(5);
    await repo.flushMeta(s.id);
    expect(writes).toBe(3);
  });

  it('keeps status, folder and publish state set in another tab', async () => {
    const kv = createLocalKv();
    const files = new Map();
    const fs = { write: async (p, d) => files.set(p, d), readText: async (p) => files.get(p) };
    const tabB = createRepo({ kv, fs });
    await tabB.loadIndex();
    // Tab A makes, publishes and files a survey after B read the list.
    const tabA = createRepo({ kv, fs });
    const s = await tabA.createSurvey(makeSurvey({ title: 'T' }));
    await tabA.patchMeta(s.id, { status: 'open', folder: 'f1', publishedAt: 9, publishedVersion: 9, collectors: 1 });
    await tabB.saveSurvey({ ...s, title: 'Edited in B', updatedAt: s.updatedAt + 1 });
    expect((await kv.get('sv:index'))[s.id]).toMatchObject({ title: 'Edited in B', status: 'open', folder: 'f1', publishedAt: 9, collectors: 1 });
  });

  it('does not bring back a survey deleted in another tab', async () => {
    const kv = createLocalKv();
    const files = new Map();
    const fs = { write: async (p, d) => files.set(p, d), readText: async (p) => files.get(p), delete: async (p) => files.delete(p) };
    const tabA = createRepo({ kv, fs });
    const s = await tabA.createSurvey(makeSurvey({ title: 'T' }));
    const tabB = createRepo({ kv, fs });
    await tabB.loadIndex();
    const tabC = createRepo({ kv, fs });
    await tabA.deleteSurvey(s.id);
    // B still lists it: its write would recreate a bare entry.
    await expect(tabB.saveSurvey({ ...s, title: 'Edited in B', updatedAt: s.updatedAt + 1 })).rejects.toMatchObject({ code: 'deleted' });
    // C reads the list again first.
    await expect(tabC.saveSurvey({ ...s, title: 'Edited in C', updatedAt: s.updatedAt + 2 })).rejects.toMatchObject({ code: 'deleted' });
    expect((await kv.get('sv:index'))[s.id]).toBeUndefined();
    expect(files.has(`surveys/${s.id}.json`)).toBe(false);
  });

  it('keeps an older entry that lacks some fields', async () => {
    const kv = createLocalKv();
    const files = new Map();
    const fs = { write: async (p, d) => files.set(p, d), readText: async (p) => files.get(p), delete: async (p) => files.delete(p) };
    const s = makeSurvey({ title: 'Old' });
    await kv.set('sv:index', { [s.id]: { title: 'Old', status: 'draft', updatedAt: 1 } });
    const repo = createRepo({ kv, fs });
    await repo.saveSurvey({ ...s, title: 'Old, edited', updatedAt: 2 });
    expect((await kv.get('sv:index'))[s.id]).toMatchObject({ title: 'Old, edited', status: 'draft' });
    expect(files.has(`surveys/${s.id}.json`)).toBe(true);
  });
});
