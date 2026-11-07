import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openCompose } from '../src/ui/compose.js';

/**
 * The compose dialog is DOM, not pure logic, so only the wiring that has
 * actually broken is covered here: how the dialog is entered, and how the body
 * gets into and out of the formatting editor. Opening a draft passes no
 * prefill at all, which is a different argument from a reply's.
 *
 * The editor's *commands* are not covered: happy-dom has no execCommand, and a
 * test that stubbed one would only be checking the stub. What is covered is
 * everything around it -- the markup going in, the text and markup coming out,
 * and the fact that a missing execCommand leaves a typing surface rather than
 * an exception.
 */

const draftStore = () => {
  const held = new Map();
  return {
    list: () => [...held.values()],
    get: (id) => held.get(id) ?? null,
    get count() { return held.size; },
    save(draft) {
      held.set(draft.id, draft);
      return true;
    },
    remove(id) {
      return held.delete(id);
    },
  };
};

const A_DRAFT = {
  id: 'draft-1',
  updated: 1_700_000_000_000,
  attachments: 0,
  domain: 'puter.email',
  to: 'ana@example.com',
  cc: '',
  subject: 'Half written',
  body: 'so far',
  html: '<div>so <b>far</b></div>',
  inReplyTo: '',
  references: '',
};

const editorOf = (modal) => modal.panel.querySelector('.rte-body');
const bodyText = (modal) => editorOf(modal).textContent;

// A recipient field holds its addresses as chips and only what is still being
// typed in the input, so both have to be read to see the whole field.
const chipsOf = (modal, field) => [...modal.panel
  .querySelectorAll(`#compose-${field}`)[0].parentElement
  .querySelectorAll('.recipient-chip .chip-name')].map((node) => node.textContent);
const typedIn = (modal, field) => modal.panel.querySelector(`#compose-${field}`).value;

// Typing, as the field sees it: the value lands and then the key that ends
// the address is pressed over it.
const typeInto = (input, text, key) => {
  input.value = text;
  input.dispatchEvent(new Event('input'));
  if (key) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }
};

/**
 * A pointer press on a chip's remove button, as the browser sequences one: the
 * press first, and the focus it would move -- and so the blur -- only where
 * nothing cancelled it.
 */
const pressRemove = (modal, address, input) => {
  const button = modal.panel.querySelector(`[aria-label="Remove ${address}"]`);
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  button.dispatchEvent(down);
  if (!down.defaultPrevented) input?.dispatchEvent(new FocusEvent('blur'));
  button.click();
};

beforeEach(() => {
  globalThis.puter = { ui: {}, fs: {}, APIOrigin: 'https://api.example', authToken: 't' };
});

afterEach(() => {
  document.querySelectorAll('.modal-root').forEach((node) => node.remove());
  document.getElementById('app')?.remove();
  delete globalThis.puter;
});

describe('openCompose', () => {
  it('opens a stored draft, which arrives with no prefill of its own', () => {
    const drafts = draftStore();
    drafts.save(A_DRAFT);

    const modal = openCompose({
      username: 'me',
      mailPath: '/me/.mail',
      prefill: null,
      drafts,
      draft: A_DRAFT,
    });

    expect(modal.panel.querySelector('.modal-title').textContent).toBe('Draft');
    expect(chipsOf(modal, 'to')).toEqual(['ana@example.com']);
    expect(modal.panel.querySelector('#compose-subject').value).toBe('Half written');
    expect(editorOf(modal).innerHTML).toBe('<div>so <b>far</b></div>');
    modal.close(true);
  });

  it('rebuilds the editor from a draft stored before there was one', () => {
    const drafts = draftStore();
    // Every draft written by an earlier build of this app looks like this.
    const older = { ...A_DRAFT, html: '', body: 'line one\n\nline two' };
    drafts.save(older);

    const modal = openCompose({
      username: 'me', mailPath: '/me/.mail', prefill: null, drafts, draft: older,
    });

    expect(editorOf(modal).innerHTML)
      .toBe('<div>line one</div><div><br></div><div>line two</div>');
    modal.close(true);
  });

  it('cleans the markup of a draft on the way back in', () => {
    const drafts = draftStore();
    // The store is localStorage, which is a place a body can be edited by hand.
    const tampered = { ...A_DRAFT, html: '<div onclick="x">hi</div><script>y</script>' };
    drafts.save(tampered);

    const modal = openCompose({
      username: 'me', mailPath: '/me/.mail', prefill: null, drafts, draft: tampered,
    });

    expect(editorOf(modal).innerHTML).toBe('<div>hi</div>');
    modal.close(true);
  });

  it('opens a reply from its prefill', () => {
    const modal = openCompose({
      username: 'me',
      mailPath: '/me/.mail',
      prefill: { kind: 'reply', to: 'bob@example.com', subject: 'Re: hello', body: '\n\n> hi' },
      drafts: draftStore(),
    });

    expect(modal.panel.querySelector('.modal-title').textContent).toBe('Reply');
    expect(chipsOf(modal, 'to')).toEqual(['bob@example.com']);
    // The quote arrives as text and becomes a real quote, with room above it.
    expect(editorOf(modal).innerHTML)
      .toBe('<div><br></div><div><br></div><blockquote><div>hi</div></blockquote>');
    modal.close(true);
  });

  it('gives the editor a toolbar and the body an accessible name', () => {
    const modal = openCompose({ username: 'me', mailPath: '/me/.mail', drafts: draftStore() });
    const editor = editorOf(modal);

    expect(editor.getAttribute('role')).toBe('textbox');
    expect(editor.getAttribute('aria-label')).toBe('Message body');
    expect(editor.getAttribute('contenteditable')).toBe('true');
    // Without a tabindex the modal's focus trap walks straight past the body.
    expect(editor.getAttribute('tabindex')).toBe('0');

    const toolbar = modal.panel.querySelector('.rte-toolbar');
    expect(toolbar.getAttribute('role')).toBe('toolbar');
    for (const name of ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Font', 'Size',
      'Text colour', 'Bulleted list', 'Numbered list', 'Quote', 'Clear formatting']) {
      expect(toolbar.querySelector(`[aria-label="${name}"]`)).toBeTruthy();
    }
    modal.close(true);
  });

  it('is one tab stop, with the arrow keys inside it', () => {
    const modal = openCompose({ username: 'me', mailPath: '/me/.mail', prefill: null });
    const toolbar = modal.panel.querySelector('.rte-toolbar');
    const buttons = [...toolbar.querySelectorAll('.rte-btn')];

    // Eleven controls used to be eleven stops between the subject and the
    // message, in both directions.
    expect(buttons.length).toBeGreaterThan(5);
    expect(buttons.filter((button) => button.tabIndex === 0)).toEqual([buttons[0]]);

    const arrow = (from, key) => from.dispatchEvent(new KeyboardEvent('keydown', {
      key, bubbles: true, cancelable: true,
    }));

    arrow(buttons[0], 'ArrowRight');
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons[1].tabIndex).toBe(0);
    expect(buttons[0].tabIndex).toBe(-1);

    // The ends wrap, and Home and End reach them outright.
    arrow(buttons[1], 'ArrowLeft');
    arrow(buttons[0], 'ArrowLeft');
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    arrow(buttons[buttons.length - 1], 'Home');
    expect(document.activeElement).toBe(buttons[0]);

    modal.close(true);
  });

  it('leaves the arrow keys of an open menu to the menu', () => {
    const modal = openCompose({ username: 'me', mailPath: '/me/.mail', prefill: null });
    const toolbar = modal.panel.querySelector('.rte-toolbar');

    // A menu opens inside the toolbar, so its items are within reach of the
    // toolbar's own key handling.
    toolbar.querySelector('[aria-label="Font"]').click();
    const item = toolbar.querySelector('.menu-item');
    expect(item).toBeTruthy();

    item.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', bubbles: true, cancelable: true,
    }));

    // Not walked off to the next toolbar button.
    expect(toolbar.contains(document.activeElement)).toBe(true);
    expect(document.activeElement.classList.contains('rte-btn')).toBe(false);
    modal.close(true);
  });

  it('survives a platform with no execCommand rather than throwing', () => {
    const modal = openCompose({ username: 'me', mailPath: '/me/.mail', drafts: draftStore() });
    // happy-dom has none, which is the case being relied on here.
    expect(document.execCommand).toBe(undefined);

    const bold = modal.panel.querySelector('[aria-label="Bold"]');
    expect(() => bold.dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow();
    expect(bold.getAttribute('aria-pressed')).toBe('false');
    modal.close(true);
  });

  it('autosaves the body as text and as markup', () => {
    const drafts = draftStore();
    const modal = openCompose({
      username: 'me',
      mailPath: '/me/.mail',
      prefill: { to: 'bob@example.com', subject: 'Notes' },
      drafts,
    });

    const editor = editorOf(modal);
    editor.innerHTML = '<div>plain</div><div><b>bold</b></div>';
    editor.dispatchEvent(new Event('input'));
    // Not close(true): the ordinary close is the one that flushes the draft.
    modal.close();

    const [saved] = drafts.list();
    expect(saved.html).toBe('<div>plain</div><div><b>bold</b></div>');
    expect(saved.body).toBe('plain\nbold');
  });

  it('shows the placeholder only while the body is empty', () => {
    const modal = openCompose({ username: 'me', mailPath: '/me/.mail', drafts: draftStore() });
    const editor = editorOf(modal);
    expect(editor.dataset.placeholder).toBe('Write your message…');
    expect(editor.classList.contains('is-empty')).toBe(true);

    editor.innerHTML = '<div>typed</div>';
    editor.dispatchEvent(new Event('input'));
    expect(editor.classList.contains('is-empty')).toBe(false);
    expect(bodyText(modal)).toBe('typed');
    modal.close(true);
  });

  it('says what closing would cost, then lets the next close through', () => {
    const drafts = draftStore();
    const modal = openCompose({
      username: 'me',
      mailPath: '/me/.mail',
      prefill: { to: 'bob@example.com', subject: 'With a file', body: 'see attached' },
      drafts,
    });

    // An attachment's bytes are not stored with a draft, so closing loses it.
    // window.confirm answers false in the cross-origin iframe a Puter app runs
    // in, which used to veto every close and trap the dialog for good.
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const input = modal.panel.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    modal.close();
    expect(modal.panel.isConnected).toBe(true);
    expect(modal.panel.querySelector('.compose-status').textContent)
      .toContain('Close again');

    modal.close();
    expect(modal.panel.isConnected).toBe(false);
  });

  it('leaves no draft behind when a reply is closed before anything is typed', () => {
    const drafts = draftStore();
    const modal = openCompose({
      username: 'me',
      mailPath: '/me/.mail',
      prefill: { kind: 'reply', to: 'bob@example.com', subject: 'Re: hello', body: '\n\nOn Monday, Bob wrote:\n> hi' },
      drafts,
    });
    document.querySelectorAll('.toast').forEach((node) => node.remove());
    modal.close();
    expect(document.querySelector('.modal-root')).toBe(null);
    expect(drafts.count).toBe(0);
    expect([...document.querySelectorAll('.toast')].map((node) => node.textContent))
      .not.toContain('Draft saved.');
  });

  it('leaves no draft behind when a forward is closed with only its files on it', async () => {
    const drafts = draftStore();
    const modal = openCompose({
      username: 'me',
      mailPath: '/me/.mail',
      prefill: {
        kind: 'forward', to: '', subject: 'Fwd: figures', body: '\n\n---------- Forwarded message ----------\nFrom: bob',
        attachments: [{ filename: 'q3.csv', type: 'text/csv', read: async () => new Uint8Array([1, 2, 3]) }],
      },
      drafts,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    modal.close();
    expect(drafts.count).toBe(0);
  });

  it('keeps the draft once something is written above the quote', () => {
    const drafts = draftStore();
    const modal = openCompose({
      username: 'me',
      mailPath: '/me/.mail',
      prefill: { kind: 'reply', to: 'bob@example.com', subject: 'Re: hello', body: '\n\n> hi' },
      drafts,
    });
    const body = editorOf(modal);
    body.firstChild.textContent = 'Thanks, Bob.';
    body.dispatchEvent(new Event('input', { bubbles: true }));
    modal.close();
    expect(drafts.count).toBe(1);
    expect(drafts.list()[0].body).toBe('Thanks, Bob.\n\n> hi');
  });

  it('does not save a resumed draft again when nothing in it changed', () => {
    const drafts = draftStore();
    drafts.save({ ...A_DRAFT, updated: 1 });
    let changes = 0;
    const modal = openCompose({
      username: 'me', mailPath: '/me/.mail', drafts, draft: drafts.get('draft-1'),
      onDraftsChanged: () => { changes++; },
    });
    document.querySelectorAll('.toast').forEach((node) => node.remove());
    modal.close();
    // Not stamped anew -- a draft opened to look at does not jump to the top
    // of Drafts with the time of the look -- and nothing was said about a
    // save of nothing.
    expect(drafts.get('draft-1').updated).toBe(1);
    expect(changes).toBe(0);
    expect([...document.querySelectorAll('.toast')].map((node) => node.textContent))
      .not.toContain('Draft saved.');
  });

  it('saves a resumed draft once something in it changes', () => {
    const drafts = draftStore();
    drafts.save({ ...A_DRAFT, updated: 1 });
    const modal = openCompose({ username: 'me', mailPath: '/me/.mail', drafts, draft: drafts.get('draft-1') });
    typeInto(modal.panel.querySelector('#compose-subject'), 'Now written');
    modal.close();
    expect(drafts.get('draft-1').subject).toBe('Now written');
    expect(drafts.get('draft-1').updated).not.toBe(1);
  });

  it('keeps a resumed draft however little it holds', () => {
    const drafts = draftStore();
    drafts.save({ ...A_DRAFT, body: 'so far', html: '<div>so far</div>' });
    const modal = openCompose({ username: 'me', mailPath: '/me/.mail', drafts, draft: drafts.get('draft-1') });
    modal.close();
    expect(drafts.count).toBe(1);
  });

  it('opens an empty message when there is neither draft nor prefill', () => {
    const modal = openCompose({
      username: 'me',
      mailPath: '/me/.mail',
      drafts: draftStore(),
    });

    expect(modal.panel.querySelector('.modal-title').textContent).toBe('New message');
    expect(chipsOf(modal, 'to')).toEqual([]);
    expect(typedIn(modal, 'to')).toBe('');
    modal.close(true);
  });
});

/**
 * The To field addresses a message to any number of people, so what is covered
 * here is the way a list is built and taken apart: what ends one address and
 * starts the next, what a pasted list becomes, and that the whole field still
 * reads back as the one comma-separated string a draft stores.
 */
describe('sending from the keyboard', () => {
  const open = () => openCompose({
    username: 'me', mailPath: '/me/.mail', prefill: null, drafts: draftStore(),
  });

  const chord = (node) => node.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', metaKey: true, bubbles: true, cancelable: true,
  }));

  const submits = (modal) => {
    let sent = false;
    modal.panel.querySelector('.compose-form')
      .addEventListener('submit', (event) => { event.preventDefault(); sent = true; });
    return () => sent;
  };

  it('sends from the message body, where Enter is a new line and always will be', () => {
    const modal = open();
    const sent = submits(modal);

    chord(modal.panel.querySelector('.rte-body'));

    expect(sent()).toBe(true);
    modal.close(true);
  });

  it('sends from a recipient field without the completion list answering first', () => {
    const modal = openCompose({
      username: 'me', mailPath: '/me/.mail', prefill: null, drafts: draftStore(),
      contacts: () => [{ email: 'ana@example.com', name: 'Ana', seconds: 1, written: true }],
    });
    const sent = submits(modal);
    const input = modal.panel.querySelector('#compose-to');

    // A list open with something highlighted: plain Enter would take the
    // highlighted one, and used to swallow the chord with it.
    input.value = 'ana';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown', bubbles: true, cancelable: true,
    }));

    chord(input);

    expect(sent()).toBe(true);
    modal.close(true);
  });

  it('does not start a second send over one already in flight', () => {
    const modal = open();
    const sendBtn = modal.panel.querySelector('.btn-primary');
    let sends = 0;
    modal.panel.querySelector('.compose-form')
      .addEventListener('submit', (event) => { event.preventDefault(); sends++; });

    sendBtn.disabled = true;
    chord(modal.panel.querySelector('#compose-subject'));

    expect(sends).toBe(0);
    modal.close(true);
  });

  it('does not send on a bare Enter in a recipient field', () => {
    const modal = open();
    const sent = submits(modal);
    const input = modal.panel.querySelector('#compose-to');

    typeInto(input, 'ana@example.com', 'Enter');

    // The second press, on a field that now holds a chip and no text. The
    // browser submits a form on an Enter the field does not take, so what has
    // to be true is that the field takes it -- the one action nobody can take
    // back used to be one stray keystroke away, in the field where the same
    // key's other meaning is "yes, that address".
    const press = new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true,
    });
    input.dispatchEvent(press);

    expect(press.defaultPrevented).toBe(true);
    expect(sent()).toBe(false);
    expect(chipsOf(modal, 'to')).toEqual(['ana@example.com']);
    modal.close(true);
  });

  it('goes to the message on Enter in the subject, rather than sending', () => {
    const modal = open();
    const sent = submits(modal);
    const subject = modal.panel.querySelector('#compose-subject');

    subject.value = 'Quarterly numbers';
    subject.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true,
    }));

    expect(sent()).toBe(false);
    expect(document.activeElement).toBe(modal.panel.querySelector('.rte-body'));
    modal.close(true);
  });

  it('says on the button which chord presses it', () => {
    const modal = open();
    expect(modal.panel.querySelector('.btn-primary').title).toMatch(/Send \(.+Enter\)/);
    modal.close(true);
  });
});

describe('a send in flight', () => {
  const ready = (drafts) => {
    const modal = openCompose({
      username: 'me', mailPath: '/me/.mail', prefill: null, drafts,
    });
    const input = modal.panel.querySelector('#compose-to');
    input.value = 'ana@example.com';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true,
    }));
    modal.panel.querySelector('#compose-subject').value = 'Numbers';
    return modal;
  };

  // A fetch that is still in the air, and the handle to land it with.
  const held = () => {
    let land;
    globalThis.fetch = () => new Promise((resolve) => { land = resolve; });
    return {
      ok: () => land({ ok: true, json: async () => ({}) }),
      fail: (message) => land({
        ok: false, status: 500, json: async () => ({ message }),
      }),
    };
  };

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  afterEach(() => { delete globalThis.fetch; });

  it('says on the button that it is sending, and refuses to be sent again', async () => {
    const modal = ready(draftStore());
    const flight = held();
    const sendBtn = modal.panel.querySelector('.btn-primary');

    modal.panel.querySelector('.compose-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    expect(sendBtn.disabled).toBe(true);
    expect(sendBtn.classList.contains('is-busy')).toBe(true);
    expect(sendBtn.getAttribute('aria-busy')).toBe('true');
    // A message already on its way is not one to throw away underneath itself.
    expect(modal.panel.querySelector('[aria-label="Discard draft"]').disabled).toBe(true);

    flight.fail('Nope.');
    await flush();

    expect(sendBtn.disabled).toBe(false);
    expect(sendBtn.classList.contains('is-busy')).toBe(false);
    modal.close(true);
  });

  it('says a late failure out loud once its own status line has gone', async () => {
    const modal = ready(draftStore());
    const flight = held();

    modal.panel.querySelector('.compose-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    // Closing keeps the draft, so leaving while a slow send finishes is a
    // reasonable thing to do.
    modal.close(true);

    flight.fail('The server said no.');
    await flush();

    const toasts = [...document.querySelectorAll('.toast')].map((node) => node.textContent);
    expect(toasts.some((text) => text.includes('The server said no.'))).toBe(true);
  });
});

describe('attachments', () => {
  // A file whose read is held open, so the list can be caught mid-read.
  const heldFile = (name) => {
    let land;
    const blob = {
      name,
      type: 'application/pdf',
      arrayBuffer: () => new Promise((resolve) => { land = resolve; }),
    };
    return { blob, read: (bytes) => land(new Uint8Array(bytes).buffer) };
  };

  const drop = (modal, files) => {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    event.dataTransfer = { types: ['Files'], files };
    modal.panel.querySelector('.compose-form').dispatchEvent(event);
  };

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('keeps a chip while another file is still being read', async () => {
    const modal = openCompose({
      username: 'me', mailPath: '/me/.mail', prefill: null, drafts: draftStore(),
    });
    const one = heldFile('one.pdf');
    const two = heldFile('two.pdf');
    drop(modal, [one.blob, two.blob]);
    await flush();

    const chips = [...modal.panel.querySelectorAll('.compose-attachments .chip')];
    expect(chips).toHaveLength(2);
    const pendingIcon = chips[0].querySelector('.chip-icon');
    expect(chips[0].textContent).toContain('Reading…');

    // The second file lands while the first chip is under a pointer that has
    // already begun a click on its remove button. The list used to be thrown
    // away and rebuilt here, and the click went nowhere.
    two.read(64);
    await flush();

    expect(modal.panel.querySelectorAll('.compose-attachments .chip')[0]).toBe(chips[0]);
    expect(chips[0].querySelector('.chip-icon')).toBe(pendingIcon);
    expect(chips[1].textContent).toContain('64 B');
    expect(chips[0].textContent).toContain('Reading…');

    chips[0].querySelector('.chip-remove').click();
    expect(modal.panel.querySelectorAll('.compose-attachments .chip')).toHaveLength(1);
    modal.close(true);
  });

  it('repaints a chip in place as its own read lands', async () => {
    const modal = openCompose({
      username: 'me', mailPath: '/me/.mail', prefill: null, drafts: draftStore(),
    });
    const one = heldFile('one.pdf');
    drop(modal, [one.blob]);
    await flush();

    const chip = modal.panel.querySelector('.compose-attachments .chip');
    expect(chip.getAttribute('aria-busy')).toBe('true');
    expect(chip.querySelector('.spinner')).toBeNull();

    one.read(2048);
    await flush();

    expect(modal.panel.querySelector('.compose-attachments .chip')).toBe(chip);
    expect(chip.getAttribute('aria-busy')).toBe('false');
    expect(chip.textContent).toContain('2.0 KB');
    expect(modal.panel.querySelector('.attach-total').textContent)
      .toBe('1 attachment · 2.0 KB');
    modal.close(true);
  });

  it('keeps a known file size visible throughout a pending read', async () => {
    const modal = openCompose({
      username: 'me', mailPath: '/me/.mail', prefill: null, drafts: draftStore(),
    });
    const file = heldFile('report.pdf');
    file.blob.size = 2048;
    drop(modal, [file.blob]);
    await flush();
    const chip = modal.panel.querySelector('.compose-attachments .chip');
    const label = chip.textContent;
    expect(label).toContain('2.0 KB');
    expect(label).not.toContain('Reading');
    expect(chip.getAttribute('aria-busy')).toBe('true');
    const remove = chip.querySelector('.chip-remove');
    remove.focus();
    file.read(2048);
    await flush();
    expect(chip.textContent).toBe(label);
    expect(chip.getAttribute('aria-busy')).toBe('false');
    expect(document.activeElement).toBe(remove);
    modal.close(true);
  });
});

describe('recipient fields', () => {
  const open = (prefill) => openCompose({
    username: 'me', mailPath: '/me/.mail', prefill, drafts: draftStore(),
  });

  it('turns each address into a chip of its own as it is entered', () => {
    const modal = open();
    const input = modal.panel.querySelector('#compose-to');

    typeInto(input, 'ana@example.com', 'Enter');
    typeInto(input, 'bo@example.com', ',');
    typeInto(input, 'cy@example.com', ';');

    expect(chipsOf(modal, 'to')).toEqual(
      ['ana@example.com', 'bo@example.com', 'cy@example.com']);
    // The separator ends the address rather than landing in the field.
    expect(typedIn(modal, 'to')).toBe('');
    modal.close(true);
  });

  it('splits a pasted list, in the forms other mail clients hand out', () => {
    const modal = open();
    const input = modal.panel.querySelector('#compose-to');

    const paste = new Event('paste', { bubbles: true, cancelable: true });
    paste.clipboardData = {
      getData: () => '"Doe, Jane" <jane@example.com>, leo@example.com; sam@example.com',
    };
    input.dispatchEvent(paste);

    expect(chipsOf(modal, 'to')).toEqual(
      ['jane@example.com', 'leo@example.com', 'sam@example.com']);
    modal.close(true);
  });

  it('leaves a comma alone when it is part of the name being typed', () => {
    const modal = open();
    const input = modal.panel.querySelector('#compose-to');

    // The comma inside the quotes belongs to the name, so it is not the end
    // of the address -- the field lets it through and waits for the rest.
    typeInto(input, '"Doe', ',');
    expect(chipsOf(modal, 'to')).toEqual([]);

    typeInto(input, '"Doe, Jane" <jane@example.com>', 'Enter');
    expect(chipsOf(modal, 'to')).toEqual(['jane@example.com']);
    modal.close(true);
  });

  it('collapses an address already on the message', () => {
    const modal = open();
    const input = modal.panel.querySelector('#compose-to');

    typeInto(input, 'ana@example.com', 'Enter');
    typeInto(input, 'ANA@Example.com', 'Enter');

    expect(chipsOf(modal, 'to')).toEqual(['ana@example.com']);
    modal.close(true);
  });

  it('marks an entry that is not an address where it was entered', () => {
    const modal = open();
    const input = modal.panel.querySelector('#compose-to');

    typeInto(input, 'ana@example.com', 'Enter');
    typeInto(input, 'not-an-address', 'Enter');

    const chips = [...modal.panel.querySelectorAll('.recipient-chip')];
    expect(chips.map((chip) => chip.classList.contains('is-error'))).toEqual([false, true]);
    modal.close(true);
  });

  it('removes one recipient without disturbing the others', () => {
    const modal = open();
    const input = modal.panel.querySelector('#compose-to');

    typeInto(input, 'ana@example.com', 'Enter');
    typeInto(input, 'bo@example.com', 'Enter');
    typeInto(input, 'cy@example.com', 'Enter');

    modal.panel.querySelector('[aria-label="Remove bo@example.com"]').click();

    expect(chipsOf(modal, 'to')).toEqual(['ana@example.com', 'cy@example.com']);
    modal.close(true);
  });

  it('removes one while another is being typed, without ending the one typed', () => {
    const modal = open();
    const input = modal.panel.querySelector('#compose-to');

    typeInto(input, 'ana@example.com', 'Enter');
    typeInto(input, 'bo@example.com', 'Enter');
    // Half an address, still being written, when the pointer reaches for the
    // remove button of a chip already on the message.
    input.focus();
    typeInto(input, 'cy@exa');

    pressRemove(modal, 'ana@example.com', input);

    expect(chipsOf(modal, 'to')).toEqual(['bo@example.com']);
    // The press was aimed at a control of this field, so it did not leave it:
    // what was being typed is still being typed.
    expect(typedIn(modal, 'to')).toBe('cy@exa');
    modal.close(true);
  });

  it('takes any chip back into the input to be corrected, not just the last', () => {
    const modal = open();
    const input = modal.panel.querySelector('#compose-to');

    typeInto(input, 'ana@example.com', 'Enter');
    typeInto(input, 'bo@exmaple.com', 'Enter');
    typeInto(input, 'cy@example.com', 'Enter');

    modal.panel.querySelectorAll('.chip-edit')[1].click();

    expect(chipsOf(modal, 'to')).toEqual(['ana@example.com', 'cy@example.com']);
    expect(typedIn(modal, 'to')).toBe('bo@exmaple.com');
    modal.close(true);
  });

  it('ends the address being typed before pulling another one back', () => {
    const modal = open();
    const input = modal.panel.querySelector('#compose-to');

    typeInto(input, 'ana@example.com', 'Enter');
    typeInto(input, 'bo@exmaple.com', 'Enter');
    // Half of a third, still in the field, when the second is pressed.
    typeInto(input, 'cy@exa');

    modal.panel.querySelectorAll('.chip-edit')[1].click();

    // The two never run together into one line that is neither address.
    expect(chipsOf(modal, 'to')).toEqual(['ana@example.com', 'cy@exa']);
    expect(typedIn(modal, 'to')).toBe('bo@exmaple.com');
    modal.close(true);
  });

  it('says what is wrong with an address that is not one, in words', () => {
    const modal = open();
    const input = modal.panel.querySelector('#compose-to');

    typeInto(input, 'ana@example.com', 'Enter');
    typeInto(input, 'not-an-address', 'Enter');

    const [good, bad] = modal.panel.querySelectorAll('.chip-edit');
    expect(good.getAttribute('aria-label')).toContain('ana@example.com');
    expect(good.getAttribute('aria-label')).not.toContain('not an email address');
    expect(bad.getAttribute('aria-label')).toContain('not-an-address is not an email address');
    expect(bad.title).toContain('not an email address');
    modal.close(true);
  });

  it('removes a chip from the keyboard without leaving its one tab stop', () => {
    const modal = open();
    const input = modal.panel.querySelector('#compose-to');

    typeInto(input, 'ana@example.com', 'Enter');
    typeInto(input, 'bo@example.com', 'Enter');

    const chip = modal.panel.querySelectorAll('.chip-edit')[0];
    chip.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Delete', bubbles: true, cancelable: true,
    }));

    expect(chipsOf(modal, 'to')).toEqual(['bo@example.com']);
    // The remove button is the pointer's way to the same thing, and stays out
    // of the walk through a field of six names.
    expect(modal.panel.querySelector('.chip-remove').tabIndex).toBe(-1);
    modal.close(true);
  });

  it('takes the last chip back into the input on Backspace, to be corrected', () => {
    const modal = open();
    const input = modal.panel.querySelector('#compose-to');

    typeInto(input, 'ana@example.com', 'Enter');
    typeInto(input, 'bo@exmaple.com', 'Enter');
    typeInto(input, '', 'Backspace');

    expect(chipsOf(modal, 'to')).toEqual(['ana@example.com']);
    expect(typedIn(modal, 'to')).toBe('bo@exmaple.com');
    // The same gesture as pressing the chip, so it says the same thing.
    expect(modal.panel.querySelector('.compose-recipients .sr-only').textContent)
      .toBe('bo@exmaple.com removed. 1 recipient.');
    modal.close(true);
  });

  it('holds a long list to a couple of rows, and says how many are behind it', () => {
    const modal = open();
    const input = modal.panel.querySelector('#compose-to');

    for (let n = 1; n <= 9; n++) typeInto(input, `p${n}@example.com`, 'Enter');
    // Writing the message is when the names are in the way, so leaving the
    // field is what puts them away.
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    expect(chipsOf(modal, 'to')).toEqual(
      ['p1@example.com', 'p2@example.com', 'p3@example.com', 'p4@example.com']);
    const more = modal.panel.querySelector('.recipient-more');
    expect(more.hidden).toBe(false);
    expect(more.textContent).toBe('+5 more');
    modal.close(true);
  });

  it('opens the whole list again the moment the field is used', () => {
    const modal = open();
    const input = modal.panel.querySelector('#compose-to');

    for (let n = 1; n <= 9; n++) typeInto(input, `p${n}@example.com`, 'Enter');
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(chipsOf(modal, 'to')).toHaveLength(4);

    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    expect(chipsOf(modal, 'to')).toHaveLength(9);
    expect(modal.panel.querySelector('.recipient-more').hidden).toBe(true);
    modal.close(true);
  });

  it('opens the whole list on the count itself, for a pointer that never focuses', () => {
    const modal = open();
    const input = modal.panel.querySelector('#compose-to');

    for (let n = 1; n <= 9; n++) typeInto(input, `p${n}@example.com`, 'Enter');
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    modal.panel.querySelector('.recipient-more').click();

    expect(chipsOf(modal, 'to')).toHaveLength(9);
    modal.close(true);
  });

  it('never hides an address that is not one behind the count', () => {
    const modal = open();
    const input = modal.panel.querySelector('#compose-to');

    for (let n = 1; n <= 5; n++) typeInto(input, `p${n}@example.com`, 'Enter');
    typeInto(input, 'not-an-address', 'Enter');
    for (let n = 6; n <= 9; n++) typeInto(input, `p${n}@example.com`, 'Enter');
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    // The list opens as far as the mark, because a mark nobody can see is not
    // one -- and no further.
    expect(chipsOf(modal, 'to')).toHaveLength(6);
    expect(chipsOf(modal, 'to')).toContain('not-an-address');
    expect(modal.panel.querySelector('.recipient-more').textContent).toBe('+4 more');
    modal.close(true);
  });

  it('leaves the chips it keeps alone, so a press or a focus survives the rebuild', () => {
    const modal = open();
    const input = modal.panel.querySelector('#compose-to');

    for (let n = 1; n <= 9; n++) typeInto(input, `p${n}@example.com`, 'Enter');
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    const first = modal.panel.querySelector('.recipient-chip');
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    // The same node, not a replacement standing in the same place.
    expect(modal.panel.querySelector('.recipient-chip')).toBe(first);
    expect(first.isConnected).toBe(true);
    modal.close(true);
  });

  it('says what changed rather than reading the whole list back', () => {
    const modal = open();
    const input = modal.panel.querySelector('#compose-to');
    const spoken = () => modal.panel.querySelector('.compose-recipients .sr-only').textContent;

    // The completion list lives inside the field, so a live region wrapped
    // around the field read all six offers back on every keystroke.
    expect(modal.panel.querySelector('.recipient-box').hasAttribute('aria-live')).toBe(false);

    typeInto(input, 'ana@example.com', 'Enter');
    expect(spoken()).toBe('ana@example.com added. 1 recipient.');

    typeInto(input, 'bo@example.com', 'Enter');
    expect(spoken()).toBe('bo@example.com added. 2 recipients.');

    // The field looks unchanged when a duplicate collapses, and the reason is
    // worth hearing.
    typeInto(input, 'ANA@example.com', 'Enter');
    expect(spoken()).toBe('Already on the message. 2 recipients.');

    modal.panel.querySelector('[aria-label="Remove ana@example.com"]').click();
    expect(spoken()).toBe('ana@example.com removed. 1 recipient.');
    modal.close(true);
  });

  it('asks a phone keyboard for the one thing this field ever holds', () => {
    const modal = open();

    for (const id of ['compose-to', 'compose-cc']) {
      const input = modal.panel.querySelector(`#${id}`);
      // Not type="email": the field takes a whole list, and names with angle
      // brackets in them, so one address per box is not its shape.
      expect(input.type).toBe('text');
      expect(input.getAttribute('inputmode')).toBe('email');
      // Left to its defaults a phone capitalises the first letter of every
      // address and autocorrects the domain of anything that looks misspelt.
      expect(input.getAttribute('autocapitalize')).toBe('off');
      expect(input.getAttribute('autocorrect')).toBe('off');
      expect(input.spellcheck).toBe(false);
    }
    modal.close(true);
  });

  it('keeps a whole list in the draft, as the string the store holds', () => {
    const drafts = draftStore();
    const modal = openCompose({
      username: 'me', mailPath: '/me/.mail', prefill: null, drafts,
    });
    const input = modal.panel.querySelector('#compose-to');

    typeInto(input, 'ana@example.com', 'Enter');
    typeInto(input, 'bo@example.com', 'Enter');
    // Left in the field rather than ended: it is still part of the message.
    typeInto(input, 'cy@example.com');
    modal.panel.querySelector('#compose-subject').value = 'Three of you';

    // Not close(true): the ordinary close is the one that flushes the draft.
    modal.close();

    expect(drafts.list()[0].to).toBe('ana@example.com, bo@example.com, cy@example.com');
  });

  it('reopens a stored list as chips again', () => {
    const drafts = draftStore();
    const many = { ...A_DRAFT, to: 'ana@example.com, bo@example.com', cc: 'cy@example.com' };
    drafts.save(many);

    const modal = openCompose({
      username: 'me', mailPath: '/me/.mail', prefill: null, drafts, draft: many,
    });

    expect(chipsOf(modal, 'to')).toEqual(['ana@example.com', 'bo@example.com']);
    expect(chipsOf(modal, 'cc')).toEqual(['cy@example.com']);
    modal.close(true);
  });

  it('fills both fields from a reply-all prefill', () => {
    const modal = open({
      kind: 'replyAll',
      to: 'bob@example.com',
      cc: 'ana@example.com, cy@example.com',
      subject: 'Re: hello',
      body: '',
    });

    expect(chipsOf(modal, 'to')).toEqual(['bob@example.com']);
    expect(chipsOf(modal, 'cc')).toEqual(['ana@example.com', 'cy@example.com']);
    modal.close(true);
  });
});
