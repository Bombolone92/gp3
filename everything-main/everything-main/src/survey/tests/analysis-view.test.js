import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '../src/views/analyze/index.js';
import { summarizeAsync } from '../src/analysis/run.js';

// Summaries can be held open to interleave tab switches; otherwise real.
const ctl = vi.hoisted(() => ({ gate: null }));
vi.mock('../src/analysis/run.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, summarizeAsync: (...a) => (ctl.gate ? ctl.gate.then(() => real.summarizeAsync(...a)) : real.summarizeAsync(...a)) };
});

const survey = {
  id: 'sview00001',
  title: 'Feedback',
  updatedAt: 1,
  pages: [
    {
      questions: [
        { id: 'q1', type: 'single', title: 'Pick one', choices: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }], other: { enabled: false } },
        { id: 'q2', type: 'textarea', title: 'Tell us more' },
      ],
    },
  ],
};

const now = Date.now();
const records = [
  { key: '0a', id: '0a', cid: 'c1', at: now - 2000, st: now - 9000, outcome: 'complete', answers: { q1: { c: 'a' }, q2: 'Lovely' }, meta: { device: 'mobile' } },
  { key: '0b', id: '0b', cid: 'c1', at: now - 1000, st: now - 5000, outcome: 'complete', answers: { q1: { c: 'b' } }, meta: { device: 'desktop' } },
];

function fakeCtx({ published = true, cached = records, synced = records } = {}) {
  let meta = { publishedAt: published ? 1 : 0, publishedVersion: 1, responses: 0 };
  const app = {
    client: {
      peek: vi.fn(async () => (published ? { url: 'https://sv-x.puter.work' } : null)),
      stats: vi.fn(async () => ({ surveys: { [survey.id]: synced.length } })),
    },
    repo: {
      loadCollectors: vi.fn(async () => ({ c1: { id: 'c1', name: 'Web link 1' } })),
      patchMeta: vi.fn(async () => {}),
    },
    responses: {
      cached: vi.fn(async () => cached),
      sync: vi.fn(async () => synced),
      remove: vi.fn(async () => synced.slice(1)),
    },
  };
  const session = {
    survey,
    get meta() {
      return meta;
    },
    setMeta: (p) => (meta = { ...meta, ...p }),
    subscribe: () => () => {},
  };
  const actions = [];
  const frame = { setActions: (nodes) => actions.push(nodes) };
  return { app, session, sid: survey.id, route: { sub: '' }, frame, actions };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('analyze view', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  it('shows summaries and records the synced count', async () => {
    const ctx = fakeCtx();
    const host = document.createElement('div');
    document.body.append(host);
    const view = await mount(host, ctx);
    await tick();
    await tick();
    expect(host.querySelector('.an-count').textContent).toBe('Respondents: 2 of 2');
    const cards = host.querySelectorAll('.an-q');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('Alpha');
    expect(cards[0].textContent).toContain('50.0%');
    expect(cards[1].textContent).toContain('Lovely');
    expect(ctx.app.repo.patchMeta).toHaveBeenCalledWith(survey.id, { responses: 2 });
    expect(ctx.actions.at(-1)).toHaveLength(2); // refresh + export
    view.unmount();
  });

  it('shows nothing in place of the missing word buttons and search box', async () => {
    const q3 = { id: 'q3', type: 'contact', title: 'Your details', fields: { name: { enabled: true } } };
    survey.pages[0].questions.push(q3);
    try {
      const answered = records.map((r) => ({ ...r, answers: { ...r.answers, q3: { name: 'Ada' } } }));
      const host = document.createElement('div');
      document.body.append(host);
      const view = await mount(host, fakeCtx({ cached: answered, synced: answered }));
      await tick();
      await tick();
      const card = host.querySelectorAll('.an-q')[2];
      expect(card.textContent).toContain('Ada');
      expect(card.textContent).not.toContain('null');
      view.unmount();
    } finally {
      survey.pages[0].questions.pop();
    }
  });

  it('switches to individual responses with labels, not ids', async () => {
    const ctx = fakeCtx();
    const host = document.createElement('div');
    document.body.append(host);
    const view = await mount(host, ctx);
    await tick();
    view.update({ sub: 'responses' });
    await tick();
    const detail = host.querySelector('.an-resp-detail');
    expect(detail.textContent).toContain('Response #2'); // newest first
    expect(detail.textContent).toContain('Beta');
    expect(detail.textContent).toContain('Skipped');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    expect(host.querySelector('.an-resp-detail').textContent).toContain('Lovely');
    view.unmount();
  });

  it('does not leave the responses tab dimmed by a summary it replaced', async () => {
    const ctx = fakeCtx();
    const host = document.createElement('div');
    document.body.append(host);
    const view = await mount(host, ctx);
    await tick();
    let release;
    ctl.gate = new Promise((r) => (release = r));
    view.update({ sub: 'responses' });
    view.update({ sub: '' });
    view.update({ sub: 'responses' });
    ctl.gate = null;
    release();
    await tick();
    await tick();
    expect(host.querySelector('.an-resp-detail')).toBeTruthy();
    expect(host.querySelector('.an-panel').classList.contains('an-busy')).toBe(false);
    view.unmount();
  });

  it('shows saved results when the collector cannot be looked up', async () => {
    const ctx = fakeCtx();
    ctx.app.client.peek = vi.fn(async () => {
      throw new Error('offline');
    });
    ctx.app.responses.sync = vi.fn(async () => {
      throw new Error('offline');
    });
    const host = document.createElement('div');
    document.body.append(host);
    const view = await mount(host, ctx);
    await tick();
    await tick();
    expect(host.textContent).not.toContain('No results yet');
    expect(host.querySelectorAll('.an-q')).toHaveLength(2);
    view.unmount();
  });

  it('says when filters leave no answers, rather than that none exist', async () => {
    sessionStorage.setItem(`sv:analyze-filters:${survey.id}`, JSON.stringify({ outcome: 'disqualified' }));
    const ctx = fakeCtx();
    const host = document.createElement('div');
    document.body.append(host);
    const view = await mount(host, ctx);
    await tick();
    await tick();
    expect(host.querySelector('.an-q').textContent).toContain('No answers match the filters.');
    expect(host.textContent).not.toContain('No answers yet');
    view.unmount();
  });

  it('invites sharing when the survey was never published', async () => {
    const ctx = fakeCtx({ published: false, cached: [], synced: [] });
    const host = document.createElement('div');
    document.body.append(host);
    const view = await mount(host, ctx);
    expect(host.textContent).toContain('No results yet');
    expect(host.querySelector('a[href$="/collect"]')).toBeTruthy();
    expect(ctx.app.responses.sync).not.toHaveBeenCalled();
    view.unmount();
  });

  it('keeps cached results visible when the collector is unreachable', async () => {
    const ctx = fakeCtx();
    ctx.app.responses.sync = vi.fn(async () => {
      throw new Error('offline');
    });
    const host = document.createElement('div');
    document.body.append(host);
    const view = await mount(host, ctx);
    await tick();
    await tick();
    expect(host.querySelector('.an-banner').textContent).toContain('Showing saved results');
    expect(host.querySelectorAll('.an-q')).toHaveLength(2);
    view.unmount();
  });

  it('summarizes on the main thread when workers are unavailable', async () => {
    const out = await summarizeAsync(survey, Array.from({ length: 3500 }, () => records[0]));
    expect(out.questions.q1.rows[0].count).toBe(3500);
  });
});

describe('overview card', () => {
  it('handles very large response counts', async () => {
    const { overviewCard } = await import('../src/views/analyze/summary.js');
    const base = Date.UTC(2026, 0, 1);
    const many = Array.from({ length: 150_000 }, (_, i) => ({ key: `k${i}`, at: base + i, st: base + i - 1000, outcome: 'complete', answers: {} }));
    expect(() => overviewCard(many, many.length)).not.toThrow();
  });

  it('gives the median time, between the middle two of an even count', async () => {
    const { overviewCard } = await import('../src/views/analyze/summary.js');
    const at = Date.UTC(2026, 0, 1);
    const card = overviewCard([10_000, 100_000].map((d, i) => ({ key: `k${i}`, at, st: at - d, outcome: 'complete', answers: {} })), 2);
    expect(card.textContent).toContain('55 s');
  });
});

describe('short percentages', () => {
  it('never round a share to 0 or 100 that is neither', async () => {
    const { fmtPctShort } = await import('../src/views/analyze/charts.js');
    expect([0, 0.004, 12.34, 99.96, 100].map(fmtPctShort)).toEqual(['0%', '<0.1%', '12.3%', '>99.9%', '100%']);
  });
});
