/**
 * Font family picker: a button showing the current family in its own face
 * that opens a searchable list (ARIA combobox + listbox). Each family is
 * previewed in its own font, loaded as it scrolls into view. Local system
 * fonts can be added through the Local Font Access API.
 */
import { h } from '../../lib/dom.js';
import { icon } from '../../ui/icons.js';
import { openPopover, closePopover } from '../../ui/popover.js';
import { allFamilies, ensureFamily, localFontsSupported, loadLocalFonts, localFamilies } from './fonts.js';
import { quoteFamily } from '../../model/text-layout.js';

let pickerCount = 0;

export function createFontPicker(app, { label = 'Font family', onPick }) {
  const name = h('span.fp-name');
  const btn = h('button.fp-button', { type: 'button', 'aria-haspopup': 'listbox', 'aria-label': label }, name, icon('chevron-down', 14));
  let current = null;
  const set = (family) => {
    current = family;
    const mixed = family === 'mixed' || family == null;
    name.textContent = mixed ? '' : family;
    name.style.fontFamily = mixed ? '' : `${quoteFamily(family)}, var(--font-ui)`;
    btn.setAttribute('aria-label', mixed ? `${label}: mixed` : `${label}: ${family}`);
    btn.dataset.tip = mixed ? label : `${label}: ${family}`;
    if (!mixed) ensureFamily(family);
  };
  btn.addEventListener('click', () => openList(app, btn, current, (f) => onPick(f), label));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && e.altKey) {
      e.preventDefault();
      btn.click();
    }
  });
  return { el: btn, set };
}

function openList(app, anchor, current, pick, label) {
  const id = `fp-${++pickerCount}`;
  const search = h('input.fp-search', {
    type: 'search',
    placeholder: 'Search fonts',
    role: 'combobox',
    'aria-label': `Search ${label.toLowerCase()}`,
    'aria-expanded': 'true',
    'aria-controls': `${id}-list`,
    'aria-autocomplete': 'list',
    autocomplete: 'off',
    spellcheck: false,
    'data-autofocus': '',
  });
  const list = h('div.fp-list', { role: 'listbox', id: `${id}-list`, 'aria-label': label, tabindex: '-1' });
  const footer = h('div.fp-footer');
  let options = [];
  let active = -1;
  const io =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(
          (entries) => {
            for (const en of entries) {
              if (en.isIntersecting) {
                ensureFamily(en.target.dataset.family);
                io.unobserve(en.target);
              }
            }
          },
          { root: list },
        )
      : null;

  const setActive = (i) => {
    if (!options.length) {
      active = -1;
      search.removeAttribute('aria-activedescendant');
      return;
    }
    active = Math.max(0, Math.min(options.length - 1, i));
    options.forEach((o, k) => o.classList.toggle('active', k === active));
    const o = options[active];
    search.setAttribute('aria-activedescendant', o.id);
    o.scrollIntoView({ block: 'nearest' });
  };

  const choose = (family) => {
    closePopover();
    anchor.focus();
    pick(family);
  };

  const render = () => {
    const q = search.value.trim().toLowerCase();
    const all = allFamilies();
    // Name matches first (prefix matches before others), then category matches.
    const rank = (f) => {
      const name = f.family.toLowerCase();
      if (!q) return 0;
      if (name.startsWith(q)) return 1;
      if (name.split(/\s+/).some((w) => w.startsWith(q))) return 2;
      if (name.includes(q)) return 3;
      if ((f.category || '').includes(q)) return 4;
      return 0;
    };
    const fams = q ? all.filter((f) => rank(f)).sort((a, b) => (a.source === b.source ? rank(a) - rank(b) : a.source === 'bundled' ? -1 : 1)) : all;
    list.replaceChildren();
    options = [];
    let lastSource = null;
    let n = 0;
    for (const f of fams) {
      if (f.source !== lastSource) {
        lastSource = f.source;
        list.append(h('div.fp-group', { role: 'presentation' }, f.source === 'local' ? 'Local Fonts' : 'Fonts'));
      }
      const opt = h(
        'div.fp-option',
        {
          role: 'option',
          id: `${id}-o${n++}`,
          'aria-selected': String(f.family === current),
          dataset: { family: f.family },
          onclick: () => choose(f.family),
          onpointermove: () => setActive(options.indexOf(opt)),
        },
        h('span.fp-opt-name', { style: { fontFamily: `${quoteFamily(f.family)}, var(--font-ui)` } }, f.family),
        h('span.fp-opt-meta', f.source === 'local' ? `${f.faces.length} ${f.faces.length === 1 ? 'style' : 'styles'}` : f.category),
      );
      options.push(opt);
      list.append(opt);
      if (f.source === 'bundled') io ? io.observe(opt) : ensureFamily(f.family);
    }
    if (!options.length) list.append(h('p.fp-empty', 'No fonts match.'));
    const sel = options.findIndex((o) => o.dataset.family === current);
    setActive(q ? 0 : sel >= 0 ? sel : 0);
  };

  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => {
    // Escape reaches the popover, which closes the list.
    if (e.key === 'Escape') return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      setActive(active + (e.key === 'PageDown' ? 8 : -8));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (options[active]) choose(options[active].dataset.family);
    }
    e.stopPropagation();
  });

  if (localFontsSupported() && !localFamilies().length) {
    const localBtn = h('button.btn.small', { type: 'button' }, icon('monitor', 14), 'Show Local Fonts');
    localBtn.addEventListener('click', async () => {
      try {
        const n = await loadLocalFonts();
        localBtn.remove();
        render();
        app.notify(`${n} local font ${n === 1 ? 'family' : 'families'} added.`, { polite: true });
      } catch (err) {
        app.notify(err?.name === 'SecurityError' || err?.name === 'NotAllowedError' ? 'Access to local fonts was not granted.' : err?.message || 'Local fonts are unavailable.', { error: true });
      }
    });
    footer.append(localBtn);
  }

  render();
  const content = h('div.font-picker', search, list, footer.childElementCount ? footer : null);
  openPopover(anchor, content, { label, placement: 'below', onClose: () => io?.disconnect() });
  options[active]?.scrollIntoView({ block: 'nearest' });
}
