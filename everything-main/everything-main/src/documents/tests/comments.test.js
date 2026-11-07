// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { threadComments, createCommentsPanel } from '../src/ui/comments.js';

const items = [
  { commentId: '0', text: 'Root A', status: 'open', creatorName: 'Ana', anchoredText: 'Chapter' },
  { commentId: '1', text: 'Root B', status: 'resolved', creatorName: 'Bo' },
  { commentId: '2', text: 'Reply to A', status: 'open', parentCommentId: '0', creatorName: 'Cy' },
  { commentId: '9', text: 'insertion', trackedChange: true },
];

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('threadComments', () => {
  it('groups replies under their root and leaves tracked changes out', () => {
    const t = threadComments(items);
    expect(t.map((x) => x.root.commentId)).toEqual(['0', '1']);
    expect(t[0].replies.map((r) => r.commentId)).toEqual(['2']);
    expect(threadComments()).toEqual([]);
  });

  it.each([false, true])('keeps replies to replies in the original thread regardless of input order (reversed: %s)', (reversed) => {
    const records = [
      { commentId: 'root', text: 'Question' },
      { commentId: 'reply', parentCommentId: 'root', text: 'Answer' },
      { commentId: 'nested', parentCommentId: 'reply', rootCommentId: 'root', text: 'Follow-up' },
    ];
    const grouped = threadComments(reversed ? [...records].reverse() : records);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].root.commentId).toBe('root');
    expect(grouped[0].replies.map((r) => r.commentId)).toEqual(reversed ? ['nested', 'reply'] : ['reply', 'nested']);
  });

  it('follows parent chains without losing orphaned or cyclic imported comments', () => {
    const records = [
      { commentId: 'nested', parentCommentId: 'reply' },
      { commentId: 'reply', parentCommentId: 'root' },
      { commentId: 'root' },
      { commentId: 'orphan', parentCommentId: 'missing' },
      { commentId: 'cycle-a', parentCommentId: 'cycle-b' },
      { commentId: 'cycle-b', parentCommentId: 'cycle-a' },
    ];
    const grouped = threadComments(records);
    expect(grouped.find((t) => t.root.commentId === 'root').replies.map((r) => r.commentId)).toEqual(['nested', 'reply']);
    const displayed = grouped.flatMap((t) => [t.root, ...t.replies]).map((r) => r.commentId);
    expect(displayed.sort()).toEqual(records.map((r) => r.commentId).sort());
  });
});

describe('createCommentsPanel', () => {
  it('cuts a long comment\'s name between whole characters', () => {
    const p = createCommentsPanel({ onAction: vi.fn() });
    document.body.append(p.el); p.open();
    p.update({ items: [{ commentId: '0', text: `${'x'.repeat(78)}😀 and more words after`, status: 'open', creatorName: 'Ana' }] });
    const label = p.el.querySelector('.comment-card').getAttribute('aria-label');
    expect(label).toContain(`${'x'.repeat(78)}😀…`);
    expect(label).not.toMatch(/[\ud800-\udbff]…/);
  });

  it('names each card for a screen reader and goes to the text on Enter or Space', () => {
    const onAction = vi.fn();
    const p = createCommentsPanel({ onAction });
    document.body.append(p.el); p.open(); p.update({ items });
    const [first, second] = p.el.querySelectorAll('.comment-card');
    expect(first.getAttribute('aria-label')).toBe('Comment by Ana on “Chapter”: Root A, 1 reply');
    expect(second.getAttribute('aria-label')).toBe('Resolved comment by Bo: Root B');
    expect(first.getAttribute('aria-description')).toBe('Press Enter to go to the commented text');
    for (const key of ['Enter', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      first.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(onAction.mock.calls.map((c) => c[0])).toEqual(['jump', 'jump']);
    // A key inside the card's own controls is theirs, not the card's.
    onAction.mockClear();
    first.querySelector('[data-action="edit"]').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(onAction).not.toHaveBeenCalled();
  });

  it('keeps keyboard focus on the same comment action after a refresh and reorder', () => {
    const p = createCommentsPanel();
    document.body.append(p.el); p.open(); p.update({ items });
    const replyDelete = p.el.querySelector('.comment-msg.reply .danger');
    replyDelete.focus();
    p.update({ items: [items[1], items[0], items[2]] });
    expect(document.activeElement).toBe(p.el.querySelector('.comment-msg.reply .danger'));
  });

  it('keeps focus in the thread when the focused reply is deleted, then in a nearby thread', () => {
    const p = createCommentsPanel();
    document.body.append(p.el); p.open(); p.update({ items });
    p.el.querySelector('.comment-msg.reply .danger').focus();
    p.update({ items: items.slice(0, 2) });
    expect(document.activeElement).toBe(p.el.querySelector('[data-id="0"]'));
    p.update({ items: [items[1]] });
    expect(document.activeElement).toBe(p.el.querySelector('[data-id="1"]'));
    p.update({ items: [] });
    expect(document.activeElement).toBe(p.el.querySelector('[aria-label="Close comments"]'));
  });

  it('returns focus to the thread after cancelling a reply without stealing outside focus', () => {
    const p = createCommentsPanel();
    document.body.append(p.el); p.open(); p.update({ items });
    [...p.el.querySelectorAll('.link-btn')].find((button) => button.textContent === 'Reply').click();
    p.el.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(p.el.querySelector('[data-id="0"]'));
    const outside = document.createElement('button'); document.body.append(outside); outside.focus();
    p.update({ items });
    expect(document.activeElement).toBe(outside);
  });

  it('updates large overlapping comment selections with bounded membership work', () => {
    const records = Array.from({ length: 300 }, (_, i) => ({ commentId: String(i), text: `Comment ${i}` }));
    let reads = 0;
    const selected = records.map((record) => record.commentId);
    const includes = Array.prototype.includes;
    const lookup = vi.spyOn(Array.prototype, 'includes').mockImplementation(function (value, ...args) {
      const found = includes.call(this, value, ...args);
      if (this.length === records.length && this[0] === '0') reads += found ? this.indexOf(value) + 1 : this.length;
      return found;
    });
    try {
      const panel = createCommentsPanel();
      document.body.append(panel.el);
      panel.update({ items: records, activeIds: selected });
      expect(panel.el.querySelectorAll('.comment-card.active')).toHaveLength(records.length);
      expect(reads).toBeLessThan(records.length * 10);
      reads = 0;
      panel.update({ activeIds: selected });
      expect(panel.el.querySelectorAll('[aria-current="true"]')).toHaveLength(records.length);
      expect(reads).toBeLessThan(records.length * 10);
      panel.update({ activeIds: ['1', '20'] });
      expect([...panel.el.querySelectorAll('.comment-card.active')].map((card) => card.dataset.id)).toEqual(['1', '20']);
    } finally { lookup.mockRestore(); }
  });

  it('keeps separate unfinished replies when switching threads', async () => {
    const p = createCommentsPanel();
    document.body.append(p.el); p.open();
    p.update({ items: items.map((item) => ({ ...item, status: 'open' })) });
    const reply = (id) => [...p.el.querySelector(`[data-id="${id}"]`).querySelectorAll('.link-btn')]
      .find((button) => button.textContent === 'Reply').click();
    reply('0'); await Promise.resolve();
    const first = p.el.querySelector('textarea');
    first.value = 'Draft for A'; first.setSelectionRange(2, 6);
    reply('1'); await Promise.resolve();
    p.el.querySelector('textarea').value = 'Draft for B';
    reply('0'); await Promise.resolve();
    expect(p.el.querySelector('textarea').value).toBe('Draft for A');
    expect([p.el.querySelector('textarea').selectionStart, p.el.querySelector('textarea').selectionEnd]).toEqual([2, 6]);
    expect(document.activeElement).toBe(p.el.querySelector('textarea'));
    reply('1'); await Promise.resolve();
    expect(p.el.querySelector('textarea').value).toBe('Draft for B');
  });

  it('finishes a pending reply without losing the draft in another thread', async () => {
    let finish;
    const onAction = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const p = createCommentsPanel({ onAction });
    document.body.append(p.el); p.open();
    p.update({ items: items.map((item) => ({ ...item, status: 'open' })) });
    const reply = (id) => [...p.el.querySelector(`[data-id="${id}"]`).querySelectorAll('.link-btn')]
      .find((button) => button.textContent === 'Reply').click();
    reply('0');
    p.el.querySelector('textarea').value = 'Sending A';
    p.el.querySelector('.comment-reply-box .btn-primary').click();
    reply('1');
    const second = p.el.querySelector('textarea'); second.value = 'Draft B';
    finish(true); await Promise.resolve();
    expect(p.el.querySelector('textarea')).toBe(second);
    expect(second.value).toBe('Draft B');
    reply('0');
    expect(p.el.querySelector('textarea').value).toBe('');
    reply('1');
    expect(p.el.querySelector('textarea').value).toBe('Draft B');
  });

  it('keeps an unfinished reply and its selection when the controller refreshes', async () => {
    const p = createCommentsPanel();
    document.body.append(p.el); p.open(); p.update({ items });
    [...p.el.querySelectorAll('.link-btn')].find((button) => button.textContent === 'Reply').click();
    await Promise.resolve();
    let input = p.el.querySelector('textarea');
    input.value = 'Draft reply'; input.setSelectionRange(3, 8);
    p.update({ activeIds: ['0'], canAdd: true });
    p.update({ items: items.map((item) => ({ ...item })) });
    input = p.el.querySelector('textarea');
    expect(input.value).toBe('Draft reply');
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 8]);
    p.el.remove();
  });

  it('does not jump back to the document when interacting with a reply form', () => {
    const onAction = vi.fn();
    const p = createCommentsPanel({ onAction });
    document.body.append(p.el); p.open(); p.update({ items });
    [...p.el.querySelectorAll('.link-btn')].find((button) => button.textContent === 'Reply').click();
    const input = p.el.querySelector('textarea');
    input.click(); input.value = 'Reply';
    p.el.querySelector('.comment-reply-box .btn-primary').click();
    expect(onAction.mock.calls).toEqual([['reply', items[0], 'Reply']]);
    p.el.remove();
  });

  it('retains a failed reply for retry and does not submit IME composition', async () => {
    const onAction = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const p = createCommentsPanel({ onAction });
    document.body.append(p.el); p.open(); p.update({ items });
    [...p.el.querySelectorAll('.link-btn')].find((button) => button.textContent === 'Reply').click();
    const input = p.el.querySelector('textarea'); input.value = '초안';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    expect(onAction).not.toHaveBeenCalled();
    const submit = p.el.querySelector('.comment-reply-box .btn-primary');
    submit.click(); submit.click();
    expect(onAction).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(input.value).toBe('초안');
    expect(submit.disabled).toBe(false);
    expect(p.el.querySelector('.field-error').hidden).toBe(false);
    submit.click(); await Promise.resolve();
    expect(p.el.querySelector('textarea')).toBeNull();
  });

  it('renders threads, marks active and resolved ones, and reports actions', () => {
    const store = new Map();
    vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) });
    const actions = [];
    const p = createCommentsPanel({ onAction: (k, c, v) => actions.push([k, c?.commentId, v]) });
    document.body.append(p.el);
    expect(p.el.hidden).toBe(true);
    // The list fills the panel's height, so the hint must come before it to sit under the button.
    expect(p.el.querySelector('.comments-empty').hidden).toBe(false);
    expect(p.el.querySelector('.comments-empty').nextElementSibling).toBe(p.el.querySelector('.comments-list'));
    p.update({ items, activeIds: ['2'], canAdd: false });
    expect(p.el.querySelector('.comments-empty').hidden).toBe(true);
    const cards = [...p.el.querySelectorAll('.comment-card')];
    expect(cards.length).toBe(2);
    expect(cards[0].classList.contains('active')).toBe(true);
    expect(cards[1].classList.contains('resolved')).toBe(true);
    expect(cards[0].querySelector('.comment-anchor').textContent).toBe('Chapter');
    expect(cards[0].querySelectorAll('.comment-msg').length).toBe(2);
    expect(p.el.querySelector('.comments-actions button').disabled).toBe(true);
    expect(p.el.querySelector('.badge').textContent).toBe('1');

    cards[0].click();
    expect(actions.at(-1)).toEqual(['jump', '0', undefined]);
    [...cards[1].querySelectorAll('.link-btn')].find((b) => b.textContent === 'Reopen').click();
    expect(actions.at(-1)).toEqual(['reopen', '1', undefined]);
    [...cards[0].querySelectorAll('.link-btn')].find((b) => b.textContent === 'Reply').click();
    const box = p.el.querySelector('.comment-reply-box textarea');
    expect(box).toBeTruthy();
    box.value = 'Thanks';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(actions.at(-1)).toEqual(['reply', '0', 'Thanks']);

    p.update({ canAdd: true });
    expect(p.el.querySelector('.comments-actions button').disabled).toBe(false);
    p.toggle();
    expect(p.isOpen).toBe(true);
    expect(localStorage.getItem('documents:comments')).toBe('1');
  });
});

it('leaves the cards in place when a refresh brings the same comments again', () => {
  const p = createCommentsPanel({ onAction() {} });
  document.body.append(p.el); p.open();
  const items = [{ commentId: 'a', text: 'First', status: 'open', creatorName: 'Ana', createdTime: 1 }, { commentId: 'b', text: 'Second', status: 'open', creatorName: 'Ben', createdTime: 2 }];
  p.update({ items });
  const cards = [...p.el.querySelectorAll('article')];
  expect(cards).toHaveLength(2);
  // The caret moved through a commented range: the same list comes back, and the same cards stay.
  p.update({ items: items.map((c) => ({ ...c })), activeIds: ['b'] });
  expect([...p.el.querySelectorAll('article')]).toEqual(cards);
  expect(cards[1].classList.contains('active')).toBe(true);
  // A changed text does rebuild.
  p.update({ items: [items[0], { ...items[1], text: 'Second, edited' }] });
  expect([...p.el.querySelectorAll('article')]).not.toEqual(cards);
  expect(p.el.textContent).toContain('Second, edited');
  document.body.replaceChildren();
});
