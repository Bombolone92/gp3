import { el } from './dom.js';
import { openModal } from './modal.js';
import { signatureBlock } from '../lib/compose.js';

/**
 * The signature, as a dialog of its own under Settings.
 *
 * A signature is the one thing about writing a message that is decided once
 * rather than every time, and nothing in the app had anywhere to decide it:
 * every message went out signed by hand or not at all. It is plain text on
 * purpose -- it goes into the message the way a reply's quoted text does, as
 * lines the writer can then format in the editor if they want to -- and it is
 * shown here under the same `-- ` separator it will be sent under, so what is
 * seen in the dialog is what a recipient sees at the foot of the message.
 *
 * openSignatureDialog({ value, onSave }) -- `onSave` is given the new text,
 * trimmed, and is not called when nothing changed or the dialog was dismissed.
 */
export function openSignatureDialog({ value = '', onSave }) {
  let modal;
  const initial = String(value ?? '');

  const input = el('textarea.signature-input', {
    id: 'signature-text',
    rows: 5,
    placeholder: 'Your name\nWhat you do, where',
    // A signature is prose, so the phone keyboard's defaults are right for
    // it; a spellchecker is not, because most of what goes here is a name.
    'aria-describedby': 'signature-hint',
  });
  input.value = initial;
  input.spellcheck = false;

  const preview = el('pre.signature-preview', { 'aria-hidden': 'true' });
  const paint = () => {
    const block = signatureBlock(input.value);
    preview.textContent = block ? block.replace(/^\n+/, '') : '';
    preview.hidden = !block;
  };
  input.addEventListener('input', paint);
  paint();

  const save = () => {
    const next = input.value.replace(/\r\n?/g, '\n').trim();
    if (next !== initial.trim()) onSave?.(next);
    modal.close(true);
  };

  const form = el('form.signature-form', {
    onsubmit: (event) => {
      event.preventDefault();
      save();
    },
    // Enter in a textarea is a new line; the chord sends the form, the way it
    // sends a message from the compose dialog.
    onkeydown: (event) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      save();
    },
  },
    el('label.signature-label', { htmlFor: 'signature-text' }, 'Signature'),
    input,
    el('p.signature-hint', { id: 'signature-hint' },
      'Added at the end of every new message, and above the quoted text in a reply. '
      + 'Leave it empty to sign nothing.'),
    preview,
    el('div.confirm-actions', {},
      el('button.btn', { type: 'button', onclick: () => modal.close(true) }, 'Cancel'),
      el('button.btn.btn-primary', { type: 'submit' }, 'Save'),
    ),
  );

  modal = openModal({ title: 'Signature', content: form });
  modal.panel.classList.add('signature-panel');
  input.focus();
  // The caret goes to the end of what is there: the common edit is to add a
  // line, not to rewrite the first one.
  input.setSelectionRange(input.value.length, input.value.length);
  return modal;
}
