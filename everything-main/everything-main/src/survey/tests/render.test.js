import { describe, it, expect, vi } from 'vitest';
import { mountSurvey, readableOn, applySurveyTheme, textDirection } from '../src/respond/render.js';
import { makeSurvey, makeQuestion, makePage, publicSnapshot } from '../src/model/survey.js';

function survey() {
  const pet = makeQuestion('single', {
    id: 'qpet',
    title: 'Do you have a pet?',
    required: true,
    choices: [
      { id: 'cyes', label: 'Yes' },
      { id: 'cno', label: 'No' },
    ],
    logic: { cno: { type: 'end' } },
  });
  const name = makeQuestion('text', { id: 'qname', title: 'Pet name', display: { qid: 'qpet', op: 'is', value: 'cyes' } });
  const s = makeSurvey({ title: 'Pets' });
  s.pages = [
    makePage({ id: 'p1', questions: [pet, name] }),
    makePage({ id: 'p2', title: 'More', questions: [makeQuestion('nps', { id: 'qnps', title: 'Recommend?', required: true })] }),
  ];
  return publicSnapshot(s);
}

const flush = () => new Promise((r) => setTimeout(r, 0));
// Forms only submit while in the document.
const host = () => document.body.appendChild(document.createElement('div'));
const next = (root) => root.querySelector('.sv-btn-primary').click();
const pick = (root, qid, cid) => {
  const input = root.querySelector(`#${qid}-${cid}`);
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('mountSurvey', () => {
  it('marks required questions in text, not markup', () => {
    const root = host();
    mountSurvey(root, { survey: survey(), preview: true });
    const legend = root.querySelector('[data-q="qpet"] legend').textContent;
    expect(legend).not.toContain('[object');
    expect(legend).toContain('(required)');
    expect(legend).toContain('Do you have a pet?');
  });

  it('blocks on required answers and shows the message', () => {
    const root = host();
    mountSurvey(root, { survey: survey(), preview: true });
    next(root);
    const err = root.querySelector('[data-err="qpet"]');
    expect(err.hidden).toBe(false);
    expect(err.textContent).toMatch(/requires an answer/);
    expect(root.querySelector('[data-q="qpet"]').classList.contains('sv-has-error')).toBe(true);
  });

  it('shows a conditional question only when its condition holds', () => {
    const root = host();
    mountSurvey(root, { survey: survey(), preview: true });
    expect(root.querySelector('[data-q="qname"]')).toBeNull();
    pick(root, 'qpet', 'cyes');
    expect(root.querySelector('[data-q="qname"]')).not.toBeNull();
  });

  it('follows skip logic and submits only answers on the path', async () => {
    const onSubmit = vi.fn(async () => ({ ok: true, outcome: 'complete' }));
    const root = host();
    mountSurvey(root, { survey: survey(), onSubmit });
    pick(root, 'qpet', 'cyes');
    root.querySelector('#in-qname').value = 'Rex';
    root.querySelector('#in-qname').dispatchEvent(new Event('input'));
    pick(root, 'qpet', 'cno');
    // "No" ends the survey, so the button reads Submit and the hidden
    // follow-up is not sent.
    expect(root.querySelector('.sv-btn-primary').textContent).toBe('Submit');
    next(root);
    await flush();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.answers).toEqual({ qpet: { c: 'cno' } });
    expect(payload.hp).toBe('');
    expect(payload.meta.device).toBe('desktop');
    expect(root.querySelector('.sv-end-title').textContent).toBe('Thank you');
  });

  it('moves through pages and back', () => {
    const root = host();
    mountSurvey(root, { survey: survey(), preview: true });
    pick(root, 'qpet', 'cyes');
    next(root);
    expect(root.querySelector('.sv-page-title').textContent).toBe('More');
    expect(root.querySelector('.sv-progress').getAttribute('aria-valuenow')).toBe('50');
    root.querySelector('.sv-btn-secondary').click();
    expect(root.querySelector('#qpet-cyes').checked).toBe(true);
  });

  it('shows collector errors on the right page', async () => {
    const onSubmit = vi.fn(async () => ({ ok: false, errors: { qpet: 'Server says no.' } }));
    const root = host();
    mountSurvey(root, { survey: survey(), onSubmit });
    pick(root, 'qpet', 'cno');
    next(root);
    await flush();
    await flush();
    expect(root.querySelector('[data-err="qpet"]').textContent).toBe('Server says no.');
  });

  it('shows one question at a time in focus mode', () => {
    const s = survey();
    s.options = { ...s.options, format: 'focus' };
    const root = host();
    mountSurvey(root, { survey: s, preview: true });
    expect(root.querySelectorAll('.sv-q').length).toBe(1);
  });

  it('picks readable text for button colors', () => {
    expect(readableOn('#ffffff')).toBe('#111111');
    expect(readableOn('#111111')).toBe('#ffffff');
    expect(readableOn('nonsense')).toBe('#ffffff');
  });
});

const ab = (id, extra = {}) =>
  makeQuestion('single', { id, title: id, choices: [{ id: 'ca', label: 'A' }, { id: 'cb', label: 'B' }], ...extra });
const type = (root, qid, text) => {
  const input = root.querySelector(`#in-${qid}`);
  input.value = text;
  input.dispatchEvent(new Event('input'));
};

describe('logic follows only the answers that still count', () => {
  it('hides a question whose condition rests on an answer that was hidden', () => {
    const s = makeSurvey({ title: 'Nested' });
    s.pages = [
      makePage({
        id: 'p1',
        questions: [
          ab('qa'),
          ab('qb', { display: { qid: 'qa', op: 'is', value: 'ca' } }),
          makeQuestion('text', { id: 'qc', title: 'qc', required: true, display: { qid: 'qb', op: 'is', value: 'ca' } }),
        ],
      }),
    ];
    const root = host();
    mountSurvey(root, { survey: publicSnapshot(s), preview: true });
    pick(root, 'qa', 'ca');
    pick(root, 'qb', 'ca');
    expect(root.querySelector('[data-q="qc"]')).not.toBeNull();
    pick(root, 'qa', 'cb');
    expect(root.querySelector('[data-q="qb"]')).toBeNull();
    expect(root.querySelector('[data-q="qc"]')).toBeNull();
  });

  it('ignores answers on a page the respondent backed out of', async () => {
    const s = makeSurvey({ title: 'Branch' });
    s.pages = [
      makePage({ id: 'p1', questions: [ab('qa', { required: true, logic: { cb: { type: 'page', pageId: 'p3' } } })] }),
      makePage({ id: 'p2', questions: [makeQuestion('text', { id: 'qb', title: 'qb' })] }),
      makePage({
        id: 'p3',
        questions: [
          makeQuestion('text', { id: 'qc', title: 'qc', required: true, display: { qid: 'qb', op: 'notAnswered' } }),
          // Keeps the page from being skipped as empty while qc is hidden.
          makeQuestion('text', { id: 'qd', title: 'qd' }),
        ],
      }),
    ];
    const onSubmit = vi.fn(async () => ({ ok: true, outcome: 'complete' }));
    const root = host();
    mountSurvey(root, { survey: publicSnapshot(s), onSubmit });
    pick(root, 'qa', 'ca');
    next(root);
    type(root, 'qb', 'hello');
    next(root);
    expect(root.querySelector('[data-q="qc"]')).toBeNull();
    root.querySelector('.sv-btn-secondary').click();
    root.querySelector('.sv-btn-secondary').click();
    pick(root, 'qa', 'cb');
    next(root);
    // qb is no longer on the path, so qc shows and must be answered.
    expect(root.querySelector('[data-q="qc"]')).not.toBeNull();
    type(root, 'qc', 'answer');
    next(root);
    await flush();
    expect(onSubmit.mock.calls[0][0].answers).toEqual({ qa: { c: 'cb' }, qc: 'answer' });
  });
});

describe('showing and hiding follow-up questions', () => {
  function conditional(format) {
    const s = makeSurvey({ title: 'Typing' });
    s.options = { ...s.options, format };
    s.pages = [
      makePage({
        id: 'p1',
        questions: [
          makeQuestion('text', { id: 'qname', title: 'Name' }),
          makeQuestion('text', { id: 'qmore', title: 'More', display: { qid: 'qname', op: 'answered' } }),
          makeQuestion('text', { id: 'qlast', title: 'Last' }),
        ],
      }),
    ];
    return publicSnapshot(s);
  }

  it('keeps the control being answered, and its focus, while follow-ups appear', () => {
    const root = host();
    mountSurvey(root, { survey: conditional('page'), preview: true });
    const input = root.querySelector('#in-qname');
    const last = root.querySelector('[data-q="qlast"]');
    input.focus();
    for (const text of ['J', 'Jo', 'Joh', 'John']) {
      input.value = text;
      input.dispatchEvent(new Event('input'));
    }
    expect(input.isConnected).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(root.querySelector('[data-q="qlast"]')).toBe(last);
    expect([...root.querySelectorAll('[data-q]')].map((n) => n.dataset.q)).toEqual(['qname', 'qmore', 'qlast']);
    input.value = '';
    input.dispatchEvent(new Event('input'));
    expect(document.activeElement).toBe(input);
    expect([...root.querySelectorAll('[data-q]')].map((n) => n.dataset.q)).toEqual(['qname', 'qlast']);
  });

  it('keeps focus while answering in one-question-at-a-time mode', () => {
    const root = host();
    mountSurvey(root, { survey: conditional('focus'), preview: true });
    const input = root.querySelector('#in-qname');
    input.focus();
    input.value = 'J';
    input.dispatchEvent(new Event('input'));
    expect(input.isConnected).toBe(true);
    expect(document.activeElement).toBe(input);
  });
});

describe('the next button', () => {
  it('reads Submit as soon as an answer ends the survey', () => {
    const s = makeSurvey({ title: 'Ends' });
    s.pages = [
      makePage({ id: 'p1', questions: [ab('qa', { logic: { cb: { type: 'end' } } })] }),
      makePage({ id: 'p2', questions: [makeQuestion('text', { id: 'qz', title: 'qz' })] }),
    ];
    const root = host();
    mountSurvey(root, { survey: publicSnapshot(s), preview: true });
    const label = () => root.querySelector('.sv-btn-primary').textContent;
    expect(label()).toBe('Next');
    pick(root, 'qa', 'cb');
    expect(label()).toBe('Submit');
    pick(root, 'qa', 'ca');
    expect(label()).toBe('Next');
  });
});

describe('one question at a time', () => {
  function focusSurvey() {
    const s = makeSurvey({ title: 'Focus' });
    s.options = { ...s.options, format: 'focus' };
    s.pages = [makePage({ id: 'p1', questions: [ab('q1'), ab('q2')] })];
    return publicSnapshot(s);
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shown = (root) => root.querySelector('[data-q]').dataset.q;
  const tap = (root, qid, cid) => {
    root.querySelector(`label[for="${qid}-${cid}"]`).dispatchEvent(new Event('pointerdown', { bubbles: true }));
    pick(root, qid, cid);
  };

  it('moves on after a tap', async () => {
    const root = host();
    mountSurvey(root, { survey: focusSurvey(), preview: true });
    tap(root, 'q1', 'ca');
    await wait(400);
    expect(shown(root)).toBe('q2');
  });

  it('stays put when an answer is picked with the keyboard', async () => {
    const root = host();
    mountSurvey(root, { survey: focusSurvey(), preview: true });
    root.querySelector('#q1-ca').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    pick(root, 'q1', 'cb');
    await wait(400);
    expect(shown(root)).toBe('q1');
  });

  it('never submits on its own', async () => {
    const onSubmit = vi.fn(async () => ({ ok: true, outcome: 'complete' }));
    const root = host();
    mountSurvey(root, { survey: focusSurvey(), onSubmit });
    tap(root, 'q1', 'ca');
    await wait(400);
    tap(root, 'q2', 'ca');
    await wait(400);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(shown(root)).toBe('q2');
  });
});

describe('when sending fails', () => {
  function twoPages() {
    const s = makeSurvey({ title: 'Send' });
    s.pages = [
      makePage({ id: 'p1', questions: [makeQuestion('text', { id: 'qa', title: 'qa' })] }),
      makePage({ id: 'p2', questions: [makeQuestion('text', { id: 'qb', title: 'qb' })] }),
    ];
    return publicSnapshot(s);
  }

  it('explains errors it cannot show next to a question', async () => {
    const onSubmit = vi.fn(async () => ({ ok: false, errors: { qnew: 'This question requires an answer.' } }));
    const root = host();
    mountSurvey(root, { survey: twoPages(), onSubmit });
    next(root);
    next(root);
    await flush();
    const banner = root.querySelector('.sv-banner');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toMatch(/reload/i);
    expect(document.activeElement).toBe(banner);
  });

  it('goes back to the question and focuses it, with Back still right', async () => {
    const onSubmit = vi.fn(async () => ({ ok: false, errors: { qa: 'Server says no.' } }));
    const root = host();
    mountSurvey(root, { survey: twoPages(), onSubmit });
    next(root);
    next(root);
    await flush();
    expect(root.querySelector('[data-err="qa"]').textContent).toBe('Server says no.');
    expect(document.activeElement).toBe(root.querySelector('#in-qa'));
    // Back to page 1 means there is nothing to go back to.
    expect(root.querySelector('.sv-btn-secondary')).toBeNull();
  });

  it('keeps Back to earlier questions of the page in one-at-a-time mode', async () => {
    const s = makeSurvey({ title: 'F' });
    s.options = { ...s.options, format: 'focus' };
    s.pages = [makePage({ id: 'p1', questions: ['qa', 'qb', 'qc'].map((id) => makeQuestion('text', { id, title: id })) })];
    const onSubmit = vi.fn(async () => ({ ok: false, errors: { qc: 'Server says no.' } }));
    const root = host();
    mountSurvey(root, { survey: publicSnapshot(s), onSubmit });
    next(root);
    next(root);
    next(root);
    await flush();
    expect(root.querySelector('[data-q]').dataset.q).toBe('qc');
    root.querySelector('.sv-btn-secondary').click();
    expect(root.querySelector('[data-q]').dataset.q).toBe('qb');
  });

  it('resends with the same submission id', async () => {
    const onSubmit = vi.fn(async () => ({ ok: false, message: 'Timed out.' }));
    const root = host();
    mountSurvey(root, { survey: twoPages(), onSubmit });
    next(root);
    next(root);
    await flush();
    next(root);
    await flush();
    const [a, b] = onSubmit.mock.calls.map((c) => c[0].rid);
    expect(a).toMatch(/^[a-z0-9]{16}$/);
    expect(b).toBe(a);
  });

  it('focuses the message when the connection fails', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('offline');
    });
    const root = host();
    mountSurvey(root, { survey: twoPages(), onSubmit });
    next(root);
    next(root);
    await flush();
    expect(document.activeElement).toBe(root.querySelector('.sv-banner'));
  });

  it('shows a survey that stopped taking responses as closed, with nothing to retry', async () => {
    const onSubmit = vi.fn(async () => ({ ok: false, closed: { title: 'This survey is full', message: 'It has received all the responses it needs.' } }));
    const onFinish = vi.fn();
    const root = host();
    mountSurvey(root, { survey: twoPages(), onSubmit, onFinish });
    next(root);
    next(root);
    await flush();
    expect(root.querySelector('.sv-end-title').textContent).toBe('This survey is full');
    expect(document.activeElement).toBe(root.querySelector('.sv-end-title'));
    expect(root.querySelector('.sv-btn-primary')).toBeNull();
    expect(root.querySelector('.sv-end-mark')).toBeNull();
    expect(onFinish).not.toHaveBeenCalled();
  });
});

describe('ranking', () => {
  function ranking(required) {
    const s = makeSurvey({ title: 'Rank' });
    s.pages = [
      makePage({
        id: 'p1',
        questions: [makeQuestion('ranking', { id: 'qr', title: 'Order these', required, choices: [{ id: 'c1', label: 'One' }, { id: 'c2', label: 'Two' }] })],
      }),
    ];
    return publicSnapshot(s);
  }

  it('explains a required ranking and focuses a usable control', () => {
    const root = host();
    mountSurvey(root, { survey: ranking(true), preview: true });
    next(root);
    expect(root.querySelector('[data-err="qr"]').textContent).toMatch(/Keep this order/);
    expect(document.activeElement.disabled).toBe(false);
    expect(root.querySelector('[data-q="qr"]').contains(document.activeElement)).toBe(true);
  });

  it('keeps focus in the question after "Keep this order"', () => {
    const root = host();
    mountSurvey(root, { survey: ranking(false), preview: true });
    const keep = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Keep this order');
    keep.focus();
    keep.click();
    expect(keep.hidden).toBe(true);
    expect(root.querySelector('[data-q="qr"]').contains(document.activeElement)).toBe(true);
  });

  it('keeps focus on the moved choice when it reaches the end', () => {
    const root = host();
    mountSurvey(root, { survey: ranking(false), preview: true });
    root.querySelector('[aria-label="Move One down"]').click();
    expect(document.activeElement.getAttribute('aria-label')).toBe('Move One up');
  });

  it('drags a choice past several others in one drag', () => {
    const s = makeSurvey({ title: 'Rank' });
    const choices = ['One', 'Two', 'Three', 'Four'].map((label, i) => ({ id: `c${i}`, label }));
    s.pages = [makePage({ id: 'p1', questions: [makeQuestion('ranking', { id: 'qr', title: 'Order these', choices })] })];
    const root = host();
    mountSurvey(root, { survey: publicSnapshot(s), preview: true });
    const list = root.querySelector('.sv-rank');
    // Rows 20px tall, in their current order.
    for (const li of list.children) li.getBoundingClientRect = () => ({ top: [...list.children].indexOf(li) * 20, bottom: [...list.children].indexOf(li) * 20 + 19 });
    const dragged = list.children[0];
    const handle = dragged.querySelector('.sv-rank-handle');
    handle.setPointerCapture = () => {};
    // Moving the row holding the pointer capture would end the drag.
    const removed = [];
    new MutationObserver((recs) => recs.forEach((r) => removed.push(...r.removedNodes))).observe(list, { childList: true });
    const pointer = (type, y) => handle.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { pointerId: 1, clientY: y }));
    pointer('pointerdown', 5);
    pointer('pointermove', 30);
    pointer('pointermove', 70);
    const labels = () => [...list.querySelectorAll('.sv-rank-label')].map((n) => n.textContent);
    expect(labels()).toEqual(['Two', 'Three', 'Four', 'One']);
    return Promise.resolve().then(() => {
      expect(removed).not.toContain(dragged);
      pointer('pointerup', 70);
      expect(labels()).toEqual(['Two', 'Three', 'Four', 'One']);
      expect(list.classList.contains('sv-set')).toBe(true);
    });
  });
});

describe('0 to 10 scale', () => {
  it('names its end points for screen readers', () => {
    const s = makeSurvey({ title: 'N' });
    s.pages = [makePage({ id: 'p1', questions: [makeQuestion('nps', { id: 'qn', title: 'Recommend?', minLabel: 'Not likely', maxLabel: 'Very likely' })] })];
    const root = host();
    mountSurvey(root, { survey: publicSnapshot(s), preview: true });
    const name = (i) => root.querySelector(`label[for="qn-n${i}"]`).textContent;
    expect(name(0)).toBe('0, Not likely');
    expect(name(5)).toBe('5');
    expect(name(10)).toBe('10, Very likely');
  });
});

describe('thank-you redirect', () => {
  function redirecting() {
    const s = makeSurvey({ title: 'R' });
    s.options = { ...s.options, thankYou: { title: 'Thanks', message: '', redirect: 'https://example.com/next' } };
    s.pages = [makePage({ id: 'p1', questions: [makeQuestion('text', { id: 'qa', title: 'qa' })] })];
    return publicSnapshot(s);
  }

  it('offers a link that leaves the frame when embedded, and does not go on by itself', async () => {
    vi.useFakeTimers();
    try {
      const root = host();
      mountSurvey(root, { survey: redirecting(), embedded: true, onSubmit: async () => ({ ok: true, outcome: 'complete' }) });
      next(root);
      await vi.advanceTimersByTimeAsync(0);
      const a = root.querySelector('.sv-end a[href="https://example.com/next"]');
      expect(a.getAttribute('target')).toBe('_top');
      expect(root.textContent).not.toContain('Taking you onward');
      // jsdom would report a navigation attempt as an error; none comes.
      await vi.advanceTimersByTimeAsync(3000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is replaced, not inherited, by a link's own thank-you screen", async () => {
    const root = host();
    const collector = { thankYou: { title: 'Thanks, partner', message: 'Your code is P-42.', redirect: '' } };
    mountSurvey(root, { survey: redirecting(), collector, embedded: true, onSubmit: async () => ({ ok: true, outcome: 'complete' }) });
    next(root);
    await flush();
    expect(root.querySelector('.sv-end-title').textContent).toBe('Thanks, partner');
    expect(root.querySelector('.sv-end a')).toBeNull();
  });
});

describe('date and time answers', () => {
  it('asks for the missing half instead of dropping a partial answer', () => {
    const s = makeSurvey({ title: 'D' });
    s.pages = [
      makePage({ id: 'p1', questions: [makeQuestion('datetime', { id: 'qd', title: 'When', date: true, time: true })] }),
      makePage({ id: 'p2', questions: [makeQuestion('text', { id: 'qz', title: 'qz' })] }),
    ];
    const root = host();
    mountSurvey(root, { survey: publicSnapshot(s), preview: true });
    const date = root.querySelector('.sv-date');
    date.value = '2026-03-15';
    date.dispatchEvent(new Event('input'));
    next(root);
    expect(root.querySelector('[data-q="qd"]')).not.toBeNull();
    expect(root.querySelector('[data-err="qd"]').textContent).toMatch(/date and a time/);
    const time = root.querySelector('.sv-time');
    time.value = '09:30';
    time.dispatchEvent(new Event('input'));
    expect(root.querySelector('[data-err="qd"]').hidden).toBe(true);
    next(root);
    expect(root.querySelector('[data-q="qz"]')).not.toBeNull();
  });
});

describe('welcome message', () => {
  it('shows nothing for one that is only blank space', () => {
    const s = makeSurvey({ title: 'W', description: '  \n ' });
    s.pages = [makePage({ id: 'p1', questions: [makeQuestion('text', { id: 'qa', title: 'qa' })] })];
    const root = host();
    mountSurvey(root, { survey: publicSnapshot(s), preview: true });
    expect(root.querySelector('.sv-page').textContent).not.toContain('null');
  });
});

describe('button labels', () => {
  it('fall back to the defaults when blank', () => {
    const s = makeSurvey({ title: 'B' });
    s.options = { ...s.options, buttons: { next: '   ', done: ' ', prev: '' } };
    s.pages = [makePage({ id: 'p1', questions: [makeQuestion('text', { id: 'qa', title: 'qa' })] })];
    const root = host();
    mountSurvey(root, { survey: publicSnapshot(s), preview: true });
    expect(root.querySelector('.sv-btn-primary').textContent).toBe('Submit');
  });
});

describe('slider', () => {
  it('is announced as not answered until moved', () => {
    const s = makeSurvey({ title: 'S' });
    s.pages = [makePage({ id: 'p1', questions: [makeQuestion('slider', { id: 'qs', title: 'How many', min: 0, max: 10 })] })];
    const root = host();
    mountSurvey(root, { survey: publicSnapshot(s), preview: true });
    const input = root.querySelector('input[type=range]');
    expect(input.getAttribute('aria-valuetext')).toBe('Not answered');
    input.value = '7';
    input.dispatchEvent(new Event('input'));
    expect(input.hasAttribute('aria-valuetext')).toBe(false);
  });

  it('takes the value shown when the untouched thumb is clicked', async () => {
    const s = makeSurvey({ title: 'S' });
    s.pages = [makePage({ id: 'p1', questions: [makeQuestion('slider', { id: 'qs', title: 'How many', min: 0, max: 10, required: true })] })];
    const onSubmit = vi.fn(async () => ({ ok: true, outcome: 'complete' }));
    const root = host();
    mountSurvey(root, { survey: publicSnapshot(s), onSubmit });
    const input = root.querySelector('input[type=range]');
    // The value does not change, so no input event comes.
    input.click();
    expect(input.hasAttribute('aria-valuetext')).toBe(false);
    next(root);
    await flush();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].answers).toEqual({ qs: 5 });
  });
});

describe('errors', () => {
  const mountOne = (q) => {
    const s = makeSurvey({ title: 'E' });
    s.pages = [makePage({ id: 'p1', questions: [q] })];
    const root = host();
    mountSurvey(root, { survey: publicSnapshot(s), preview: true });
    return root;
  };
  const type = (input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  it('focus the contact field the message names', () => {
    const root = mountOne(makeQuestion('contact', { id: 'qc', title: 'Contact', fields: { name: { enabled: true }, email: { enabled: true } } }));
    type(root.querySelector('#in-qc-name'), 'Ada');
    type(root.querySelector('#in-qc-email'), 'nope');
    next(root);
    expect(root.querySelector('[data-err="qc"]').textContent).toBe('Enter a valid email address.');
    expect(document.activeElement).toBe(root.querySelector('#in-qc-email'));
  });

  it('focus the Other box when it is left empty', () => {
    const root = mountOne(makeQuestion('single', { id: 'qo', title: 'Pick', choices: [{ id: 'a', label: 'A' }], other: { enabled: true } }));
    const radio = root.querySelector('.sv-other input[type=radio]');
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    next(root);
    expect(root.querySelector('[data-err="qo"]').textContent).toBe('Please specify your answer.');
    expect(document.activeElement).toBe(root.querySelector('.sv-other-input'));
  });

  it('focus the first unanswered row of a grid', () => {
    const root = mountOne(makeQuestion('matrix', { id: 'qm', title: 'Grid', required: true, rows: [{ id: 'r1', label: 'R1' }, { id: 'r2', label: 'R2' }], columns: [{ id: 'k1', label: 'K1' }] }));
    const first = root.querySelector('input[data-row="r1"]');
    first.checked = true;
    first.dispatchEvent(new Event('change'));
    next(root);
    expect(document.activeElement).toBe(root.querySelector('input[data-row="r2"]'));
  });

  it('focus the first input when nothing is answered', () => {
    const root = mountOne(makeQuestion('contact', { id: 'qc', title: 'Contact', required: true, fields: { name: { enabled: true }, email: { enabled: true } } }));
    next(root);
    expect(document.activeElement).toBe(root.querySelector('#in-qc-name'));
  });
});

describe('theme', () => {
  it('picks error and control colors for the question area, not the page background', () => {
    const node = document.createElement('div');
    applySurveyTheme(node, { background: '#000000', surface: '#ffffff', text: '#222222', accent: '#1d5fd1' });
    expect(node.dataset.svDark).toBe('false');
    applySurveyTheme(node, { background: '#ffffff', surface: '#111111', text: '#eeeeee', accent: '#ffb86b' });
    expect(node.dataset.svDark).toBe('true');
  });
});

describe('text direction', () => {
  it('follows the language the survey is written in', () => {
    expect(textDirection('האם תמליץ עלינו? Puter')).toBe('rtl');
    expect(textDirection('هل توصي بنا؟')).toBe('rtl');
    expect(textDirection('Would you recommend us? (עברית)')).toBe('ltr');
    expect(textDirection('')).toBe('ltr');
    const s = makeSurvey({ title: 'סקר' });
    s.pages = [makePage({ id: 'p1', questions: [makeQuestion('text', { id: 'qa', title: 'מה שלומך?' })] })];
    const root = host();
    mountSurvey(root, { survey: publicSnapshot(s), preview: true });
    expect(root.dir).toBe('rtl');
    // Typed answers take the direction of what is typed.
    expect(root.querySelector('#in-qa').getAttribute('dir')).toBe('auto');
  });
});

describe('pages left empty by conditions', () => {
  function survey() {
    const s = makeSurvey({ title: 'E' });
    s.pages = [
      makePage({ id: 'p1', questions: [makeQuestion('single', { id: 'qa', title: 'A', choices: [{ id: 'y', label: 'Yes' }, { id: 'n', label: 'No' }] })] }),
      makePage({ id: 'p2', questions: [makeQuestion('text', { id: 'qb', title: 'Why yes?', display: { qid: 'qa', op: 'is', value: 'y' } })] }),
      makePage({ id: 'p3', title: 'Interlude', questions: [] }),
      makePage({ id: 'p4', questions: [makeQuestion('text', { id: 'qd', title: 'D' })] }),
    ];
    return publicSnapshot(s);
  }
  const pick = (root, id) => {
    const r = root.querySelector(`#qa-${id}`);
    r.checked = true;
    r.dispatchEvent(new Event('change', { bubbles: true }));
  };

  it('are skipped, while a page made without questions still shows', () => {
    const root = host();
    mountSurvey(root, { survey: survey(), preview: true });
    pick(root, 'n');
    next(root);
    expect(root.querySelector('.sv-page-title').textContent).toBe('Interlude');
    next(root);
    expect(root.querySelector('[data-q="qd"]')).not.toBeNull();
    // Back returns over the skipped page.
    root.querySelector('.sv-btn-secondary').click();
    root.querySelector('.sv-btn-secondary').click();
    expect(root.querySelector('[data-q="qa"]')).not.toBeNull();
    pick(root, 'y');
    next(root);
    expect(root.querySelector('[data-q="qb"]')).not.toBeNull();
  });
});

describe('shuffled pages', () => {
  it('keep a follow-up after the question it depends on, numbered as shown', () => {
    const s = makeSurvey({ title: 'S' });
    s.pages = [
      makePage({
        id: 'p1',
        randomize: true,
        questions: [
          makeQuestion('single', { id: 'qa', title: 'A', choices: [{ id: 'y', label: 'Yes' }, { id: 'n', label: 'No' }] }),
          makeQuestion('text', { id: 'qb', title: 'B', display: { qid: 'qa', op: 'is', value: 'y' } }),
          makeQuestion('text', { id: 'qc', title: 'C' }),
          makeQuestion('text', { id: 'qd', title: 'D' }),
        ],
      }),
    ];
    const snap = publicSnapshot(s);
    const orders = new Set();
    const random = Math.random;
    try {
      for (let k = 1; k < 60; k++) {
        Math.random = () => k / 61;
        const root = host();
        mountSurvey(root, { survey: snap, preview: true });
        Math.random = random;
        const yes = root.querySelector('#qa-y');
        yes.checked = true;
        yes.dispatchEvent(new Event('change', { bubbles: true }));
        const ids = [...root.querySelectorAll('[data-q]')].map((n) => n.dataset.q);
        orders.add(ids.join());
        expect(ids.indexOf('qb'), ids.join()).toBe(ids.indexOf('qa') + 1);
        // Numbered in the order shown.
        expect([...root.querySelectorAll('.sv-num')].map((n) => n.textContent)).toEqual(['1.', '2.', '3.', '4.']);
        root.remove();
      }
    } finally {
      Math.random = random;
    }
    // Still shuffled.
    expect(orders.size).toBeGreaterThan(3);
  });
});

describe('number keypads', () => {
  it('leave the full keyboard where negative numbers are allowed', () => {
    const s = makeSurvey({ title: 'N' });
    s.pages = [makePage({ id: 'p1', questions: [
      makeQuestion('text', { id: 'qp', title: 'Age', validation: { kind: 'integer', min: 0, max: 120, message: '' } }),
      makeQuestion('text', { id: 'qn', title: 'Temperature', validation: { kind: 'number', min: -40, max: 50, message: '' } }),
    ] })];
    const root = host();
    mountSurvey(root, { survey: publicSnapshot(s), preview: true });
    expect(root.querySelector('#in-qp').getAttribute('inputmode')).toBe('numeric');
    expect(root.querySelector('#in-qn').hasAttribute('inputmode')).toBe(false);
  });
});

describe('safeHttpUrl', async () => {
  const { safeHttpUrl } = await import('../src/respond/render.js');
  it('allows only http and https', () => {
    expect(safeHttpUrl('https://example.com/x')).toBe('https://example.com/x');
    expect(safeHttpUrl('javascript:alert(1)')).toBe('');
    expect(safeHttpUrl(' JavaScript:alert(1)')).toBe('');
    expect(safeHttpUrl('data:text/html,hi')).toBe('');
    expect(safeHttpUrl('/relative')).toBe('');
    expect(safeHttpUrl(null)).toBe('');
  });
});
