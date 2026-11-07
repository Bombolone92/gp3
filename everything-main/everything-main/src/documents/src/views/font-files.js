import { el } from '../ui/dom.js';
import { openPopover } from '../ui/popover.js';
import { loadFontFile } from '../engine/file-fonts.js';

export function fontFileControls({ onFontsAvailable, onLoaded = () => {}, status }) {
  const notice = status || el('p.field-hint', { role: 'status' });
  const input = el('input', { type: 'file', accept: '.ttf,.otf', multiple: true, hidden: true, 'aria-label': 'Font files' });
  const button = el('button.btn', { type: 'button', onclick: () => input.click() }, 'Load font files…');
  input.addEventListener('change', async () => {
    const files = [...input.files]; input.value = '';
    if (!files.length) return;
    button.disabled = input.disabled = true;
    notice.textContent = 'Loading fonts…';
    const loaded = [], errors = []; let changed = false;
    try {
      for (const file of files) {
        try { const result = await loadFontFile(file); loaded.push(result.family); changed ||= !result.duplicate; }
        catch (error) { errors.push(`${file.name}: ${error.message}`); }
      }
      if (changed) {
        try { await onFontsAvailable?.(); }
        catch { errors.push('Fonts loaded, but the document could not refresh. Reopen it to try again.'); }
      }
      notice.textContent = [loaded.length ? `Available in this session: ${[...new Set(loaded)].join(', ')}.` : '', ...errors].filter(Boolean).join(' ');
      onLoaded();
    } finally { button.disabled = input.disabled = false; }
  });
  return el('div', {}, button, input, el('p.field-hint', {}, 'TTF and OTF files stay on this device for this browser session. They are not added to the DOCX. Load the regular, bold and italic files you need.'), status ? null : notice);
}

export function openFontFiles({ anchor, onFontsAvailable }) {
  return openPopover({ anchor, label: 'Document fonts', content: el('form', { onsubmit: e => e.preventDefault() }, fontFileControls({ onFontsAvailable })) });
}
