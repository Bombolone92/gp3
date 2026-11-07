import { describe, it, expect, vi } from 'vitest';
import { makeSurvey, makeQuestion, makePage, normalizeSurvey, publicSnapshot, lintQuestion } from '../src/model/survey.js';
import * as edit from '../src/model/edit.js';
import { createSession } from '../src/data/session.js';

function twoPages() {
  const s = makeSurvey();
  const q1 = makeQuestion('single', {
    id: 'qa',
    title: 'A',
    choices: [
      { id: 'c1', label: 'One' },
      { id: 'c2', label: 'Two' },
    ],
    logic: { c1: { type: 'page', pageId: 'p2' } },
  });
  const q2 = makeQuestion('text', { id: 'qb', title: 'B', display: { qid: 'qa', op: 'is', value: 'c2' } });
  const q3 = makeQuestion('nps', { id: 'qc', title: 'C' });
  s.pages = [makePage({ id: 'p1', questions: [q1, q2] }), makePage({ id: 'p2', questions: [q3] })];
  return s;
}

describe('edit operations', () => {
  it('shares untouched pages and questions', () => {
    const s = twoPages();
    const next = edit.updateQuestion(s, 'qc', { title: 'C2' });
    expect(next.pages[0]).toBe(s.pages[0]);
    expect(next.pages[1]).not.toBe(s.pages[1]);
    expect(next.pages[1].questions[0].title).toBe('C2');
  });

  it('drops skip logic that points at a deleted page', () => {
    const s = edit.removePage(twoPages(), 'p2');
    expect(s.pages[0].questions[0].logic).toBeUndefined();
  });

  it('drops a display condition when its source moves after it', () => {
    const s = edit.moveQuestion(twoPages(), 'qa', 'p2', 1);
    const qb = s.pages[0].questions.find((q) => q.id === 'qb');
    expect(qb.display).toBeUndefined();
  });

  it('drops a display condition on a removed choice', () => {
    const s = edit.updateQuestion(twoPages(), 'qa', (q) => ({ ...q, choices: q.choices.filter((c) => c.id !== 'c2') }));
    expect(s.pages[0].questions[1].display).toBeUndefined();
  });

  it('keeps a display condition while its choice exists', () => {
    const s = edit.updateQuestion(twoPages(), 'qa', (q) => ({ ...q, choices: q.choices.filter((c) => c.id !== 'c1') }));
    expect(s.pages[0].questions[1].display).toEqual({ qid: 'qa', op: 'is', value: 'c2' });
  });

  it('drops an "is" condition when its source can no longer be compared', () => {
    const s = edit.updateQuestion(twoPages(), 'qa', (q) => edit.convertQuestion(q, 'text'));
    expect(s.pages[0].questions[1].display).toBeUndefined();
  });

  it('keeps an "is answered" condition when its source changes type', () => {
    let s = twoPages();
    s = edit.updateQuestion(s, 'qb', { display: { qid: 'qa', op: 'answered', value: '' } });
    s = edit.updateQuestion(s, 'qa', (q) => edit.convertQuestion(q, 'text'));
    expect(s.pages[0].questions[1].display).toEqual({ qid: 'qa', op: 'answered', value: '' });
  });

  it('drops any condition on a question turned into a text block', () => {
    let s = twoPages();
    s = edit.updateQuestion(s, 'qb', { display: { qid: 'qa', op: 'answered', value: '' } });
    s = edit.updateQuestion(s, 'qa', (q) => edit.convertQuestion(q, 'statement'));
    expect(s.pages[0].questions[1].display).toBeUndefined();
  });

  it('drops a rating condition outside a shortened scale', () => {
    let s = twoPages();
    s = edit.updateQuestion(s, 'qa', (q) => edit.convertQuestion(q, 'rating'));
    s = edit.updateQuestion(s, 'qa', { scale: 10 });
    s = edit.updateQuestion(s, 'qb', { display: { qid: 'qa', op: 'is', value: '9' } });
    expect(s.pages[0].questions[1].display).toBeTruthy();
    s = edit.updateQuestion(s, 'qa', { scale: 5 });
    expect(s.pages[0].questions[1].display).toBeUndefined();
  });

  it('cleans up such conditions when a survey is opened', () => {
    const s = twoPages();
    s.pages[0].questions[0] = { ...s.pages[0].questions[0], choices: [{ id: 'c1', label: 'One' }] };
    expect(normalizeSurvey(s).pages[0].questions[1].display).toBeUndefined();
  });

  it('moves the page logic to the second half of a split page', () => {
    let s = twoPages();
    s = edit.addPage(s, 2, makePage({ id: 'p3' })).survey;
    s = edit.updatePage(s, 'p1', { logic: { type: 'page', pageId: 'p3' } });
    s = edit.splitPageAfter(s, 'qa');
    expect(s.pages.map((p) => p.questions.map((q) => q.id))).toEqual([['qa'], ['qb'], ['qc'], []]);
    expect(s.pages[0].logic).toBeNull();
    expect(s.pages[1].logic).toEqual({ type: 'page', pageId: 'p3' });
  });

  it('keeps the later page logic when merging pages', () => {
    let s = twoPages();
    s = edit.updatePage(s, 'p2', { logic: { type: 'disqualify' } });
    s = edit.mergeWithPrevious(s, 'p2');
    expect(s.pages).toHaveLength(1);
    expect(s.pages[0].logic).toEqual({ type: 'disqualify' });
  });

  it('drops skip logic that would point backwards after a page move', () => {
    // qa's first choice jumps from p1 to p2; moving p2 to the top makes it
    // a backwards jump, which respondents never take.
    const s = edit.movePage(twoPages(), 'p2', 0);
    expect(s.pages.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(s.pages[1].questions[0].logic).toBeUndefined();
    let t = edit.updatePage(twoPages(), 'p1', { logic: { type: 'page', pageId: 'p2' } });
    t = edit.movePage(t, 'p2', 0);
    expect(t.pages[1].logic).toBeNull();
    // Forward jumps stay.
    expect(edit.movePage(twoPages(), 'p1', 0).pages[0].questions[0].logic).toEqual({ c1: { type: 'page', pageId: 'p2' } });
  });

  it('points conditions in a duplicated page at its own copies', () => {
    const { survey, page } = edit.duplicatePage(twoPages(), 'p1');
    const [qa2, qb2] = page.questions;
    expect(qb2.display.qid).toBe(qa2.id);
    expect(qa2.choices.map((c) => c.id)).toContain(qb2.display.value);
    // The original keeps its own condition.
    expect(survey.pages[0].questions[1].display).toEqual({ qid: 'qa', op: 'is', value: 'c2' });
    // A condition on a question outside the page is kept as it is.
    let s = twoPages();
    s = edit.updateQuestion(s, 'qc', { display: { qid: 'qa', op: 'answered', value: '' } });
    const dup = edit.duplicatePage(s, 'p2');
    expect(dup.page.questions[0].display).toEqual({ qid: 'qa', op: 'answered', value: '' });
  });

  it('drops logic for a removed choice', () => {
    const s = edit.updateQuestion(twoPages(), 'qa', (q) => ({ ...q, choices: q.choices.filter((c) => c.id !== 'c1') }));
    expect(s.pages[0].questions[0].logic).toBeUndefined();
  });

  it('nudges across page boundaries', () => {
    let s = edit.nudgeQuestion(twoPages(), 'qc', -1);
    expect(s.pages[0].questions.map((q) => q.id)).toEqual(['qa', 'qb', 'qc']);
    s = edit.nudgeQuestion(s, 'qa', -1);
    expect(s.pages[0].questions[0].id).toBe('qa');
  });

  it('duplicates with fresh ids and remapped logic', () => {
    const { survey, question } = edit.duplicateQuestion(twoPages(), 'qa');
    expect(question.id).not.toBe('qa');
    expect(survey.pages[0].questions[1]).toBe(question);
    const [cid] = Object.keys(question.logic);
    expect(question.choices.map((c) => c.id)).toContain(cid);
  });

  it('splits and merges pages', () => {
    const split = edit.splitPageAfter(twoPages(), 'qa');
    expect(split.pages.map((p) => p.questions.length)).toEqual([1, 1, 1]);
    const merged = edit.mergeWithPrevious(split, split.pages[1].id);
    expect(merged.pages.map((p) => p.questions.length)).toEqual([2, 1]);
  });

  it('keeps answers and logic when switching between choice types', () => {
    const s = twoPages();
    const q = s.pages[0].questions[0];
    const dd = edit.convertQuestion(q, 'dropdown');
    expect(dd.choices).toEqual(q.choices);
    expect(dd.logic).toEqual(q.logic);
    const grid = edit.convertQuestion(q, 'matrix');
    expect(grid.rows.map((r) => r.label)).toEqual(['One', 'Two']);
    expect(grid.logic).toBeUndefined();
  });

  it('never leaves a survey without a page', () => {
    const s = edit.removePage(edit.removePage(twoPages(), 'p2'), 'p1');
    expect(s.pages).toHaveLength(1);
    expect(s.pages[0].questions).toEqual([]);
  });
});

describe('model', () => {
  it('normalizes garbage into a valid survey', () => {
    const s = normalizeSurvey({ pages: [{ questions: [{ type: 'nope' }, { type: 'single', choices: ['x', { label: 'y' }] }] }], theme: { accent: 'red', logo: 'javascript:alert(1)' } });
    expect(s.pages[0].questions).toHaveLength(1);
    expect(s.pages[0].questions[0].choices.map((c) => c.label)).toEqual(['x', 'y']);
    expect(s.theme.accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(s.theme.logo).toBe('');
  });

  it('accepts only http(s) redirects', () => {
    expect(normalizeSurvey({ options: { thankYou: { redirect: 'javascript:alert(1)' } } }).options.thankYou.redirect).toBe('');
    expect(normalizeSurvey({ options: { thankYou: { redirect: 'https://example.com' } } }).options.thankYou.redirect).toBe('https://example.com');
  });

  it('publishes without blank choices', () => {
    const s = makeSurvey();
    s.pages[0].questions = [makeQuestion('single', { title: 'Q', choices: [{ id: 'a', label: 'A' }, { id: 'b', label: ' ' }] })];
    expect(publicSnapshot(s).pages[0].questions[0].choices.map((c) => c.id)).toEqual(['a']);
  });

  it('flags questions respondents would trip over', () => {
    expect(lintQuestion(makeQuestion('single'))).toEqual(['Add question text.', 'Add at least two answer choices.']);
    expect(lintQuestion(makeQuestion('text', { title: 'Name' }))).toEqual([]);
  });

  it('drops choice images, which nothing shows, and choices with only one', () => {
    const s = normalizeSurvey({ pages: [{ questions: [{ type: 'single', title: 'T', choices: [{ label: '', image: 'https://example.com/t.png' }, { label: 'A', image: 'https://example.com/a.png' }, { label: 'B' }] }] }] });
    const q = s.pages[0].questions[0];
    expect(q.choices.some((c) => 'image' in c)).toBe(false);
    expect(publicSnapshot(s).pages[0].questions[0].choices.map((c) => c.label)).toEqual(['A', 'B']);
  });

  it('flags a condition on an answer whose text was cleared', () => {
    const s = makeSurvey();
    const src = makeQuestion('single', { id: 'qa', title: 'A', choices: [{ id: 'y', label: 'Yes' }, { id: 'n', label: '' }] });
    const fu = makeQuestion('text', { id: 'qb', title: 'Why?', display: { qid: 'qa', op: 'is', value: 'n' } });
    s.pages = [makePage({ id: 'p1', questions: [src, fu] })];
    expect(lintQuestion(fu, s).join(' ')).toMatch(/answer with no text/);
    expect(lintQuestion({ ...fu, display: { qid: 'qa', op: 'is', value: 'y' } }, s)).toEqual([]);
    // Without the survey (older callers), nothing to say.
    expect(lintQuestion(fu)).toEqual([]);
  });

  it('flags settings no answer can meet', () => {
    const two = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
    expect(lintQuestion(makeQuestion('multi', { title: 'T', choices: two, minSelect: 3 }))).toEqual(['It asks for at least 3 choices but has 2.']);
    expect(lintQuestion(makeQuestion('multi', { title: 'T', choices: two, minSelect: 2, maxSelect: 1 }))).toEqual(['The minimum number of choices is more than the maximum.']);
    expect(lintQuestion(makeQuestion('text', { title: 'T', validation: { kind: 'integer', min: 120, max: 18, message: '' } }))).toEqual(['The minimum is more than the maximum.']);
    expect(lintQuestion(makeQuestion('text', { title: 'T', validation: { kind: 'length', min: 1200, max: '', message: '' } }))).toEqual(['The minimum length is more than an answer can hold (1000 characters).']);
    const hidden = Object.fromEntries(['name', 'email', 'phone', 'company', 'address', 'address2', 'city', 'state', 'zip', 'country'].map((id) => [id, { enabled: false }]));
    expect(lintQuestion(makeQuestion('contact', { title: 'T', fields: hidden }))).toEqual(['Show at least one field.']);
    expect(lintQuestion(makeQuestion('slider', { title: 'T', min: 5, max: 5 }))).toEqual(['The slider’s lowest value must be below its highest.']);
    expect(lintQuestion(makeQuestion('multi', { title: 'T', choices: two, minSelect: 2 }))).toEqual([]);
  });
});

describe('session', () => {
  function setup() {
    let t = 1000;
    const saved = [];
    const repo = { saveSurvey: vi.fn(async (s) => (saved.push(s), {})) };
    const session = createSession({ repo, survey: makeSurvey({ title: 'T' }), saveDelay: 5, now: () => t });
    return { session, saved, repo, tick: (ms) => (t += ms) };
  }

  it('coalesces typing into one undo step', () => {
    const { session, tick } = setup();
    session.apply((s) => ({ ...s, title: 'Ta' }), { coalesce: 'title' });
    tick(200);
    session.apply((s) => ({ ...s, title: 'Tab' }), { coalesce: 'title' });
    expect(session.undo()).toBe(true);
    expect(session.survey.title).toBe('T');
    expect(session.canUndo).toBe(false);
    expect(session.redo()).toBe(true);
    expect(session.survey.title).toBe('Tab');
  });

  it('ignores an edit that changes nothing', async () => {
    const { session, saved } = setup();
    session.apply((s) => ({ ...s, theme: { ...s.theme } }));
    session.apply((s) => ({ ...s, pages: s.pages.map((p) => ({ ...p })) }));
    expect(session.canUndo).toBe(false);
    expect(session.dirty).toBe(false);
    await session.flush();
    expect(saved).toHaveLength(0);
    session.apply((s) => ({ ...s, theme: { ...s.theme, radius: 'round' } }));
    expect(session.canUndo).toBe(true);
  });

  it('starts a new undo step after a pause or a seal', () => {
    const { session, tick } = setup();
    session.apply((s) => ({ ...s, title: 'A' }), { coalesce: 'title' });
    tick(1500);
    session.apply((s) => ({ ...s, title: 'AB' }), { coalesce: 'title' });
    session.seal();
    session.apply((s) => ({ ...s, title: 'ABC' }), { coalesce: 'title' });
    session.undo();
    expect(session.survey.title).toBe('AB');
    session.undo();
    expect(session.survey.title).toBe('A');
  });

  it('autosaves the latest version and reports state', async () => {
    const { session, saved } = setup();
    const states = [];
    session.subscribe((doc, change) => change.type === 'save' && states.push(session.saveState));
    session.apply((s) => ({ ...s, title: 'X' }));
    session.apply((s) => ({ ...s, title: 'Y' }));
    expect(session.dirty).toBe(true);
    await session.flush();
    expect(saved.at(-1).title).toBe('Y');
    expect(session.saveState).toBe('saved');
    expect(states).toContain('saving');
  });

  it('keeps unsaved state and retries after a failed save', async () => {
    const { session, repo } = setup();
    repo.saveSurvey.mockRejectedValueOnce(new Error('offline'));
    session.apply((s) => ({ ...s, title: 'X' }));
    await session.flush().catch(() => {});
    expect(session.saveState).toBe('error');
    expect(session.dirty).toBe(true);
    await session.retrySave();
    expect(session.saveState).toBe('saved');
  });

  it('takes a newer copy saved in another tab only with nothing unsaved', async () => {
    const { session, saved, tick } = setup();
    const announced = [];
    const changes = [];
    session.subscribe((doc, change) => changes.push(change.type));
    // Saves are passed on (to other tabs).
    const s2 = createSession({ repo: { saveSurvey: async () => ({}) }, survey: makeSurvey({ title: 'T' }), saveDelay: 5, onSaved: (d) => announced.push(d) });
    s2.apply((d) => ({ ...d, title: 'Saved here' }));
    await s2.flush();
    expect(announced.map((d) => d.title)).toEqual(['Saved here']);

    session.apply((d) => ({ ...d, title: 'Mine' }));
    tick(10);
    const other = { ...session.survey, title: 'Theirs', updatedAt: session.survey.updatedAt + 5 };
    // An edit not yet saved here wins.
    expect(session.adopt(other)).toBe(false);
    await session.flush();
    expect(saved.at(-1).title).toBe('Mine');
    // Saved: a newer copy is taken, and undo cannot bring the old one back.
    expect(session.adopt(other)).toBe(true);
    expect(session.survey.title).toBe('Theirs');
    expect(session.meta.title).toBe('Theirs');
    expect(session.dirty).toBe(false);
    expect(session.canUndo).toBe(false);
    expect(changes.at(-1)).toBe('external');
    // Nothing to save, and an older copy is ignored.
    await session.flush();
    expect(saved.at(-1).title).toBe('Mine');
    expect(session.adopt({ ...other, title: 'Older', updatedAt: other.updatedAt - 1 })).toBe(false);
  });

  it('passes on its own list changes, not ones from another tab', () => {
    const sent = [];
    const s = createSession({ repo: { saveSurvey: async () => ({}) }, survey: makeSurvey({ title: 'T' }), onMeta: (m) => sent.push(m) });
    s.setMeta({ publishedVersion: 5 });
    s.setMeta({ publishedVersion: 6 }, { remote: true });
    expect(sent).toEqual([{ publishedVersion: 5 }]);
    expect(s.meta.publishedVersion).toBe(6);
  });

  /** A repo whose saves wait until released, one by one. */
  function heldRepo() {
    const saved = [];
    const pending = [];
    const repo = {
      saveSurvey: vi.fn(
        (s) =>
          new Promise((resolve, reject) => {
            pending.push({ ok: () => (saved.push(s), resolve({ title: s.title, status: 'draft', publishedAt: 0 })), fail: () => reject(new Error('offline')) });
          }),
      ),
    };
    const next = async () => {
      while (!pending.length) await new Promise((r) => setTimeout(r, 1));
      return pending.shift();
    };
    return { repo, saved, next };
  }

  it('saves the latest edit on flush even when the save in flight fails', async () => {
    const { repo, saved, next } = heldRepo();
    const session = createSession({ repo, survey: makeSurvey({ title: 'T' }), saveDelay: 1 });
    session.apply((s) => ({ ...s, title: 'X' }));
    const first = await next();
    session.apply((s) => ({ ...s, title: 'Y' }));
    let done = false;
    const flushed = session.flush().then(() => (done = true));
    first.fail();
    (await next()).ok();
    await flushed;
    expect(done).toBe(true);
    expect(saved.at(-1).title).toBe('Y');
    expect(session.saveState).toBe('saved');
  });

  it('settles every flush only once the latest edit is saved', async () => {
    const { repo, saved, next } = heldRepo();
    const session = createSession({ repo, survey: makeSurvey({ title: 'T' }), saveDelay: 1 });
    session.apply((s) => ({ ...s, title: 'X' }));
    const first = await next();
    session.apply((s) => ({ ...s, title: 'Y' }));
    const settled = [];
    const a = session.flush().then(() => settled.push(saved.at(-1)?.title));
    const b = session.flush().then(() => settled.push(saved.at(-1)?.title));
    first.ok();
    (await next()).ok();
    await Promise.all([a, b]);
    expect(settled).toEqual(['Y', 'Y']);
  });

  it('rejects a flush whose save keeps failing', async () => {
    const { repo, next } = heldRepo();
    const session = createSession({ repo, survey: makeSurvey({ title: 'T' }), saveDelay: 1 });
    session.apply((s) => ({ ...s, title: 'X' }));
    const flushed = session.flush();
    (await next()).fail();
    await expect(flushed).rejects.toThrow('offline');
    expect(session.saveState).toBe('error');
  });

  it('keeps publish state set while a save was under way', async () => {
    const { repo, next } = heldRepo();
    const session = createSession({ repo, survey: makeSurvey({ title: 'T' }), meta: { status: 'draft', publishedAt: 0 }, saveDelay: 1 });
    session.apply((s) => ({ ...s, title: 'X' }));
    const pending = await next();
    // Publishing finishes while the autosave, which read the old index, is
    // still writing.
    session.setMeta({ status: 'open', publishedAt: 5 });
    pending.ok();
    await session.flush();
    expect(session.meta).toMatchObject({ status: 'open', publishedAt: 5, title: 'X' });
  });

  it('passes the edit origin to subscribers', () => {
    const { session } = setup();
    const seen = [];
    session.subscribe((doc, change) => change.type === 'edit' && seen.push(change.origin));
    session.apply((s) => ({ ...s, title: 'X' }), { origin: 'input' });
    expect(seen).toEqual(['input']);
  });
});
