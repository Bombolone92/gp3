import { describe, it, expect, beforeEach } from 'vitest';
import { makeWorker } from './helpers.js';
import { makeQuestion, makeSurvey, publicSnapshot } from '../src/model/survey.js';
import { WORKER_VERSION } from '../src/data/worker-version.js';

function sampleSurvey() {
  const q1 = makeQuestion('single', {
    title: 'Favorite?',
    required: true,
    choices: [
      { id: 'ca', label: 'A' },
      { id: 'cb', label: 'B' },
      { id: 'cblank', label: '' },
    ],
  });
  const q2 = makeQuestion('text', { title: 'Why?' });
  const s = makeSurvey({ title: 'Test' });
  s.pages[0].questions = [q1, q2];
  return { survey: publicSnapshot(s), q1, q2 };
}

describe('collector worker', () => {
  let w;
  let survey;
  let q1;
  let q2;

  beforeEach(async () => {
    w = await makeWorker();
    ({ survey, q1, q2 } = sampleSurvey());
    await w.call('POST', '/admin/publish', { admin: true, body: { survey } });
    await w.call('POST', '/admin/collector', {
      admin: true,
      body: { collector: { id: 'link000001', sid: survey.id, status: 'open' } },
    });
  });

  it('rejects admin calls without the secret', async () => {
    expect((await w.call('GET', '/admin/ping')).status).toBe(401);
    const res = await w.call('GET', '/admin/ping', { admin: true });
    expect(res.status).toBe(200);
    expect(res.data.version).toBe(WORKER_VERSION);
  });

  it('serves the published survey to respondents', async () => {
    const res = await w.call('GET', '/api/c/link000001');
    expect(res.status).toBe(200);
    expect(res.data.survey.title).toBe('Test');
    // Blank choices never reach respondents.
    expect(res.data.survey.pages[0].questions[0].choices.map((c) => c.id)).toEqual(['ca', 'cb']);
    expect(res.data.collector).toEqual({ id: 'link000001', allowMultiple: true, thankYou: null });
  });

  it('answers 404 for unknown links and anything else', async () => {
    expect((await w.call('GET', '/api/c/nothere123')).status).toBe(404);
    expect((await w.call('GET', '/api/c/constructor')).status).toBe(404);
    expect((await w.call('GET', '/whatever')).data).toEqual({ error: 'not_found' });
  });

  it('stores a valid response and counts it', async () => {
    const res = await w.call('POST', '/api/c/link000001/responses', {
      body: { answers: { [q1.id]: { c: 'ca' }, [q2.id]: 'Because', bogus: 1 }, startedAt: Date.now() - 5000, meta: { device: 'mobile' } },
    });
    expect(res.status).toBe(200);
    expect(res.data.ok).toBe(true);
    const page = await w.call('GET', `/admin/responses?sid=${survey.id}`, { admin: true });
    expect(page.data.items).toHaveLength(1);
    const rec = page.data.items[0].value;
    expect(rec.answers).toEqual({ [q1.id]: { c: 'ca' }, [q2.id]: 'Because' });
    expect(rec.meta.device).toBe('mobile');
    expect(rec.cid).toBe('link000001');
    expect(rec.at - rec.st).toBeGreaterThanOrEqual(4000);
    const stats = await w.call('GET', '/admin/stats', { admin: true });
    expect(stats.data).toEqual({ surveys: { [survey.id]: 1 }, collectors: { link000001: 1 } });
    // One survey's count, read without listing every counter.
    let lists = 0;
    const list = w.kv.list.bind(w.kv);
    w.kv.list = (...a) => (lists++, list(...a));
    const one = await w.call('GET', `/admin/stats?sid=${survey.id}`, { admin: true });
    expect(one.data).toEqual({ surveys: { [survey.id]: 1 }, collectors: {} });
    expect(lists).toBe(0);
    expect((await w.call('GET', '/admin/stats?sid=nosuchsurvey', { admin: true })).data.surveys).toEqual({ nosuchsurvey: 0 });
    w.kv.list = list;
  });

  it('stores a resent response once', async () => {
    const body = { answers: { [q1.id]: { c: 'ca' } }, rid: 'sub0000000001' };
    const first = await w.call('POST', '/api/c/link000001/responses', { body });
    const again = await w.call('POST', '/api/c/link000001/responses', { body });
    expect(first.data).toMatchObject({ ok: true, outcome: 'complete' });
    expect(again.status).toBe(200);
    expect(again.data).toMatchObject({ ok: true, outcome: 'complete' });
    const page = await w.call('GET', `/admin/responses?sid=${survey.id}`, { admin: true });
    expect(page.data.items).toHaveLength(1);
    const stats = await w.call('GET', '/admin/stats', { admin: true });
    expect(stats.data).toEqual({ surveys: { [survey.id]: 1 }, collectors: { link000001: 1 } });
    // A different submission is a different response.
    await w.call('POST', '/api/c/link000001/responses', { body: { ...body, rid: 'sub0000000002' } });
    expect((await w.call('GET', `/admin/responses?sid=${survey.id}`, { admin: true })).data.items).toHaveLength(2);
  });

  it('stores copies of one submission sent at once only once', async () => {
    await w.call('POST', '/admin/collector', { admin: true, body: { collector: { id: 'link000001', sid: survey.id, status: 'open', maxResponses: 3 } } });
    const body = { answers: { [q1.id]: { c: 'ca' } }, rid: 'sub0000000009' };
    const both = await Promise.all([w.call('POST', '/api/c/link000001/responses', { body }), w.call('POST', '/api/c/link000001/responses', { body })]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(both[0].data.id).toBe(both[1].data.id);
    expect((await w.call('GET', `/admin/responses?sid=${survey.id}`, { admin: true })).data.items).toHaveLength(1);
    expect((await w.call('GET', '/admin/stats', { admin: true })).data.collectors.link000001).toBe(1);
  });

  it('acknowledges a resend of the response that filled the link', async () => {
    await w.call('POST', '/admin/collector', { admin: true, body: { collector: { id: 'link000001', sid: survey.id, status: 'open', maxResponses: 1 } } });
    const body = { answers: { [q1.id]: { c: 'ca' } }, rid: 'sub0000000010' };
    const first = await w.call('POST', '/api/c/link000001/responses', { body });
    const again = await w.call('POST', '/api/c/link000001/responses', { body });
    expect(again.status).toBe(200);
    expect(again.data).toMatchObject({ ok: true, id: first.data.id, outcome: 'complete' });
    // Someone else is told it is full.
    expect((await w.call('POST', '/api/c/link000001/responses', { body: { ...body, rid: 'sub0000000011' } })).status).toBe(410);
  });

  it('stores a resent response whose first attempt failed part way', async () => {
    await w.call('POST', '/admin/collector', { admin: true, body: { collector: { id: 'link000001', sid: survey.id, status: 'open', maxResponses: 10 } } });
    const incr = w.kv.incr.bind(w.kv);
    let failOnce = true;
    w.kv.incr = async (key, by) => {
      if (failOnce && key.startsWith('svw:nc:')) {
        failOnce = false;
        throw new Error('rate limited');
      }
      return incr(key, by);
    };
    const body = { answers: { [q1.id]: { c: 'ca' } }, rid: 'sub0000000009' };
    expect((await w.call('POST', '/api/c/link000001/responses', { body })).status).toBe(500);
    const again = await w.call('POST', '/api/c/link000001/responses', { body });
    expect(again.data).toMatchObject({ ok: true, outcome: 'complete' });
    const items = (await w.call('GET', `/admin/responses?sid=${survey.id}`, { admin: true })).data.items;
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe(again.data.id);
    // And a third send is still only acknowledged.
    await w.call('POST', '/api/c/link000001/responses', { body });
    expect((await w.call('GET', `/admin/responses?sid=${survey.id}`, { admin: true })).data.items).toHaveLength(1);
  });

  it('lets a submission that was refused be sent again', async () => {
    const body = { answers: {}, rid: 'sub0000000003' };
    expect((await w.call('POST', '/api/c/link000001/responses', { body })).status).toBe(422);
    const fixed = await w.call('POST', '/api/c/link000001/responses', { body: { ...body, answers: { [q1.id]: { c: 'cb' } } } });
    expect(fixed.data.ok).toBe(true);
    expect((await w.call('GET', `/admin/responses?sid=${survey.id}`, { admin: true })).data.items).toHaveLength(1);
  });

  it('publishes surveys up to the survey size limit and names larger ones', async () => {
    const big = { ...survey, description: 'x'.repeat(300 * 1024) };
    expect((await w.call('POST', '/admin/publish', { admin: true, body: { survey: big } })).status).toBe(200);
    const huge = { ...survey, description: 'x'.repeat(400 * 1024) };
    const res = await w.call('POST', '/admin/publish', { admin: true, body: { survey: huge } });
    expect(res.status).toBe(413);
    expect(res.data.error).toBe('too_large');
  });

  it('refuses a body declared too large without reading it', async () => {
    const res = await w.worker.handle('https://sv-test.puter.work/api/c/link000001/responses', {
      method: 'POST',
      headers: { 'content-length': String(10 * 1024 * 1024) },
      body: JSON.stringify({ answers: {} }),
    });
    expect(res.status).toBe(413);
  });

  it('names a response that is too large to store', async () => {
    const res = await w.call('POST', '/api/c/link000001/responses', { body: { answers: { [q1.id]: { c: 'ca' }, [q2.id]: 'x'.repeat(300 * 1024) } } });
    expect(res.status).toBe(413);
    expect(res.data.error).toBe('too_large');
  });

  it('deletes every response of a deleted survey', async () => {
    for (let i = 0; i < 60; i++) await w.call('POST', '/api/c/link000001/responses', { body: { answers: { [q1.id]: { c: 'ca' } } } });
    const res = await w.call('POST', '/admin/survey/delete', { admin: true, body: { sid: survey.id, collectors: ['link000001'] } });
    expect(res.data).toEqual({ ok: true, deleted: 60 });
    expect((await w.call('GET', `/admin/responses?sid=${survey.id}`, { admin: true })).data.items).toEqual([]);
  });

  it('rejects invalid responses with per-question errors', async () => {
    const res = await w.call('POST', '/api/c/link000001/responses', { body: { answers: {} } });
    expect(res.status).toBe(422);
    expect(Object.keys(res.data.errors)).toEqual([q1.id]);
    expect((await w.call('POST', '/api/c/link000001/responses', { raw: 'not json' })).status).toBe(400);
  });

  it('silently drops honeypot submissions', async () => {
    const res = await w.call('POST', '/api/c/link000001/responses', { body: { hp: 'bot', answers: { [q1.id]: 'ca' } } });
    expect(res.data).toEqual({ ok: true, id: null });
    const stats = await w.call('GET', '/admin/stats', { admin: true });
    expect(stats.data.surveys).toEqual({});
  });

  it('refuses responses when closed or past the close date', async () => {
    await w.call('POST', '/admin/collector', { admin: true, body: { collector: { id: 'link000001', sid: survey.id, status: 'closed' } } });
    let res = await w.call('GET', '/api/c/link000001');
    expect(res.status).toBe(410);
    expect(res.data.error).toBe('closed');
    expect(res.data.title).toBe('Test');
    await w.call('POST', '/admin/collector', {
      admin: true,
      body: { collector: { id: 'link000001', sid: survey.id, status: 'open', closeAt: Date.now() - 1 } },
    });
    res = await w.call('POST', '/api/c/link000001/responses', { body: { answers: { [q1.id]: 'ca' } } });
    expect(res.status).toBe(410);
  });

  it('enforces the response limit', async () => {
    await w.call('POST', '/admin/collector', {
      admin: true,
      body: { collector: { id: 'link000001', sid: survey.id, status: 'open', maxResponses: 2 } },
    });
    const send = () => w.call('POST', '/api/c/link000001/responses', { body: { answers: { [q1.id]: 'cb' } } });
    const results = await Promise.all([send(), send(), send()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 410]);
    expect((await w.call('GET', '/api/c/link000001')).data.error).toBe('full');
  });

  it('protects links with a password', async () => {
    await w.call('POST', '/admin/collector', {
      admin: true,
      body: { collector: { id: 'link000001', sid: survey.id, status: 'open', password: 's3cret' } },
    });
    const open = await w.call('GET', '/api/c/link000001');
    expect(open.data).toMatchObject({ locked: true, title: 'Test' });
    expect(open.data.survey).toBeUndefined();
    expect((await w.call('POST', '/api/c/link000001/unlock', { body: { password: 'nope' } })).status).toBe(403);
    const ok = await w.call('POST', '/api/c/link000001/unlock', { body: { password: 's3cret' } });
    expect(ok.data.survey.id).toBe(survey.id);
    const denied = await w.call('POST', '/api/c/link000001/responses', { body: { answers: { [q1.id]: 'ca' } } });
    expect(denied.status).toBe(403);
    const sent = await w.call('POST', '/api/c/link000001/responses', { body: { password: 's3cret', answers: { [q1.id]: 'ca' } } });
    expect(sent.status).toBe(200);
    // Saving other settings without `password` keeps it.
    await w.call('POST', '/admin/collector', { admin: true, body: { collector: { id: 'link000001', sid: survey.id, status: 'open' } } });
    expect((await w.call('GET', '/api/c/link000001')).data.locked).toBe(true);
    // An empty password removes it.
    await w.call('POST', '/admin/collector', { admin: true, body: { collector: { id: 'link000001', sid: survey.id, status: 'open', password: '' } } });
    expect((await w.call('GET', '/api/c/link000001')).data.survey).toBeTruthy();
  });

  it('pages responses newest first and deletes them', async () => {
    for (let i = 0; i < 5; i++) {
      await w.call('POST', '/api/c/link000001/responses', { body: { answers: { [q1.id]: 'ca', [q2.id]: `r${i}` } } });
      await new Promise((r) => setTimeout(r, 2));
    }
    const first = await w.call('GET', `/admin/responses?sid=${survey.id}&limit=2`, { admin: true });
    expect(first.data.items.map((i) => i.value.answers[q2.id])).toEqual(['r4', 'r3']);
    expect(first.data.cursor).toBeTruthy();
    const second = await w.call('GET', `/admin/responses?sid=${survey.id}&limit=2&cursor=${first.data.cursor}`, { admin: true });
    expect(second.data.items.map((i) => i.value.answers[q2.id])).toEqual(['r2', 'r1']);

    const del = await w.call('POST', '/admin/responses/delete', {
      admin: true,
      body: { sid: survey.id, keys: [first.data.items[0].key, 'doesnotexist1'] },
    });
    expect(del.data.deleted).toBe(1);
    const stats = await w.call('GET', '/admin/stats', { admin: true });
    expect(stats.data.surveys[survey.id]).toBe(4);
    expect(stats.data.collectors.link000001).toBe(4);
  });

  it('limits password guesses sent all at once', async () => {
    await w.call('POST', '/admin/collector', { admin: true, body: { collector: { id: 'link000001', sid: survey.id, status: 'open', password: 'right' } } });
    const statuses = await Promise.all(
      Array.from({ length: 60 }, (_, i) => w.call('POST', '/api/c/link000001/unlock', { body: { password: `guess${i}` } }).then((r) => r.status)),
    );
    expect(statuses.filter((s) => s === 403)).toHaveLength(20);
    expect(statuses.filter((s) => s === 429)).toHaveLength(40);
  });

  it('does not count the right password against the limit', async () => {
    await w.call('POST', '/admin/collector', { admin: true, body: { collector: { id: 'link000001', sid: survey.id, status: 'open', password: 'right' } } });
    for (let i = 0; i < 30; i++) expect((await w.call('POST', '/api/c/link000001/unlock', { body: { password: 'right' } })).status).toBe(200);
    expect((await w.call('POST', '/api/c/link000001/unlock', { body: { password: 'wrong' } })).status).toBe(403);
  });

  it('lets the right password through on a retry after a burst of them', async () => {
    await w.call('POST', '/admin/collector', { admin: true, body: { collector: { id: 'link000001', sid: survey.id, status: 'open', password: 'right' } } });
    const unlock = () => w.call('POST', '/api/c/link000001/unlock', { body: { password: 'right' } }).then((r) => r.status);
    const burst = await Promise.all(Array.from({ length: 30 }, unlock));
    // What the respondent page does on 429: try once more, a moment later.
    const retried = await Promise.all(burst.map((st) => (st === 429 ? unlock() : st)));
    expect(retried.every((st) => st === 200)).toBe(true);
  });

  it('lets someone who unlocked submit while others lock the link', async () => {
    await w.call('POST', '/admin/collector', { admin: true, body: { collector: { id: 'link000001', sid: survey.id, status: 'open', password: 'right' } } });
    const { pass } = (await w.call('POST', '/api/c/link000001/unlock', { body: { password: 'right' } })).data;
    expect(pass).toMatch(/^\d+\.[0-9a-f]{64}$/);
    for (let i = 0; i < 25; i++) await w.call('POST', '/api/c/link000001/unlock', { body: { password: `guess${i}` } });
    const answers = { [q1.id]: { c: 'ca' } };
    expect((await w.call('POST', '/api/c/link000001/responses', { body: { answers, password: 'right' } })).status).toBe(429);
    expect((await w.call('POST', '/api/c/link000001/responses', { body: { answers, password: 'right', pass } })).status).toBe(200);
    // A forged or tampered pass is no pass.
    const forged = `${Date.now() + 1e6}.${'0'.repeat(64)}`;
    expect((await w.call('POST', '/api/c/link000001/responses', { body: { answers, pass: forged } })).status).toBe(429);
    // A new password voids passes.
    await w.call('POST', '/admin/collector', { admin: true, body: { collector: { id: 'link000001', sid: survey.id, status: 'open', password: 'other' } } });
    expect((await w.call('POST', '/api/c/link000001/responses', { body: { answers, pass } })).status).toBe(429);
  });

  it('limits wrong password guesses per link', async () => {
    await w.call('POST', '/admin/collector', { admin: true, body: { collector: { id: 'link000001', sid: survey.id, status: 'open', password: 'right' } } });
    const statuses = [];
    for (let i = 0; i < 22; i++) statuses.push((await w.call('POST', '/api/c/link000001/unlock', { body: { password: `guess${i}` } })).status);
    expect(statuses.slice(0, 20).every((s) => s === 403)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
    // Even the right password waits out the window.
    expect((await w.call('POST', '/api/c/link000001/unlock', { body: { password: 'right' } })).status).toBe(429);
  });

  it('does not let a skipped answer hide a required question', async () => {
    const gate = makeQuestion('single', { id: 'qgate', title: 'Gate', required: true, choices: [{ id: 'g1', label: 'Go' }, { id: 'g2', label: 'Skip' }], logic: { g2: { type: 'page', pageId: 'pz' } } });
    const skipped = makeQuestion('single', { id: 'qskip', title: 'Skipped', choices: [{ id: 's1', label: 'A' }, { id: 's2', label: 'B' }] });
    const req = makeQuestion('text', { id: 'qreq', title: 'Required when page 2 was skipped', required: true, display: { qid: 'qskip', op: 'notAnswered' } });
    const s = makeSurvey({ id: 'sbranch0001', title: 'Branch' });
    s.pages = [
      { id: 'pa', title: '', description: '', randomize: false, logic: null, questions: [gate] },
      { id: 'pb', title: '', description: '', randomize: false, logic: null, questions: [skipped] },
      { id: 'pz', title: '', description: '', randomize: false, logic: null, questions: [req] },
    ];
    await w.call('POST', '/admin/publish', { admin: true, body: { survey: publicSnapshot(s) } });
    await w.call('POST', '/admin/collector', { admin: true, body: { collector: { id: 'link000002', sid: s.id, status: 'open' } } });
    // The respondent skipped page 2, yet claims an answer there to hide the required question.
    const res = await w.call('POST', '/api/c/link000002/responses', { body: { answers: { qgate: { c: 'g2' }, qskip: { c: 's2' } } } });
    expect(res.status).toBe(422);
    expect(Object.keys(res.data.errors)).toEqual(['qreq']);
  });

  it('deletes everything belonging to a survey', async () => {
    await w.call('POST', '/api/c/link000001/responses', { body: { answers: { [q1.id]: 'ca' } } });
    await w.call('POST', '/admin/survey/delete', { admin: true, body: { sid: survey.id, collectors: ['link000001'] } });
    expect([...w.kv.map.keys()]).toEqual([]);
  });
});
