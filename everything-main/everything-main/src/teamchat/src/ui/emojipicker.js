/**
 * The emoji picker: a popover with search, a frequently used row, every
 * category, and a skin tone choice. Used for reactions (message.js) and for
 * inserting into the composer. The grid is keyboard navigable: arrows move
 * by cell, Home/End by row, Enter or Space picks, Escape closes; every cell
 * is labelled with the emoji's name for assistive tech.
 *
 *   openEmojiPicker(anchor, { onPick(key, char, entry), selected: Set })
 */
import { el, fieldId, composing } from './dom.js';
import { icon } from './icons.js';
import { openPopover } from './menu.js';
import {
  loadEmoji, emojiReady, emojiCategories, searchEmoji, recentEmoji, emojiEntry, withTone, keyFor,
  preferredTone, setPreferredTone, noteEmojiUse,
} from '../lib/emoji.js';

const COLUMNS = 8;
const CATEGORY_ICONS = ['😀', '👋', '🐻', '🍎', '✈️', '⚽', '💡', '🔣', '🏳️'];
const TONE_SAMPLE = ['👋', '👋🏻', '👋🏼', '👋🏽', '👋🏾', '👋🏿'];

/**
 * The entry whose emoji is the text in the search box: an emoji pasted or
 * typed from a keyboard's own picker, with or without a skin tone (the tone
 * and the presentation selector are set aside; the picker draws the entry
 * in the reader's chosen tone). The shortcode search reads letters only, so
 * "👋🏽" found nothing, though the picker knows the emoji.
 */
function entryByGlyph(text) {
  const bare = (s) => [...s].filter((c) => !/[\u{1F3FB}-\u{1F3FF}\u{FE0F}]/u.test(c)).join('');
  const want = bare(text.trim());
  if (!want || /[a-z0-9]/i.test(want)) return null;
  for (const c of emojiCategories()) for (const e of c.items) if (bare(e.char) === want) return e;
  return null;
}

export function openEmojiPicker(anchor, { onPick, selected = new Set(), label = 'Pick an emoji', onClose = null } = {}) {
  const searchId = fieldId('emoji');
  const search = el('input.emoji-search', {
    id: searchId, type: 'search', placeholder: 'Search emoji', 'aria-label': 'Search emoji',
    autocomplete: 'off', spellcheck: false,
  });
  const toneBtn = el('button.emoji-tone', { type: 'button', 'aria-haspopup': 'listbox', 'aria-label': 'Skin tone', title: 'Skin tone' });
  const tabs = el('div.emoji-tabs', { role: 'tablist', 'aria-label': 'Categories' });
  const body = el('div.emoji-body', { role: 'grid', 'aria-label': label });
  const status = el('div.visually-hidden', { role: 'status', 'aria-live': 'polite' });
  const root = el('div.emoji-picker', {},
    el('div.emoji-head', {}, el('span.emoji-search-icon', { html: icon('search', 15, 2) }), search, toneBtn),
    tabs, body, status);

  let tone = preferredTone();
  let toneMenu = null;
  // On a touch screen the search field must not take the focus on open: the
  // on-screen keyboard would rise over half the grid, and its arrival used
  // to close the popover outright. The reader taps the field when they want
  // to search; the picker itself holds the focus so Escape still closes.
  const coarse = matchMedia('(pointer: coarse)').matches;
  const pop = openPopover(anchor, root, { align: 'end', side: 'top', label, role: 'dialog', autofocus: !coarse, onClose });
  pop.node.classList.add('emoji-pop');
  pop.node.style.padding = '0';

  const pick = (entry) => {
    const key = keyFor(entry, tone);
    noteEmojiUse(key);
    pop.close();
    onPick?.(key, withTone(entry, tone), entry);
  };

  function cell(entry) {
    const key = keyFor(entry, tone);
    const btn = el('button.emoji-cell', {
      type: 'button', role: 'gridcell', tabindex: -1,
      'aria-label': entry.code.replace(/[_-]+/g, ' '), title: `:${entry.code}:`,
      'aria-pressed': selected.has(key) || selected.has(entry.code) ? 'true' : null,
      onclick: () => pick(entry),
    }, withTone(entry, tone));
    return btn;
  }

  function renderTone() {
    toneBtn.textContent = TONE_SAMPLE[tone - 1];
  }

  function render() {
    body.replaceChildren();
    tabs.replaceChildren();
    if (!emojiReady()) {
      body.append(el('div.emoji-empty', {}, 'Loading emoji'));
      return;
    }
    const q = search.value.trim();
    if (q) {
      let hits = searchEmoji(q, 96);
      if (!hits.length) {
        const glyph = entryByGlyph(q);
        if (glyph) hits = [glyph];
      }
      status.textContent = hits.length ? `${hits.length} emoji` : 'No emoji match';
      if (!hits.length) {
        body.append(el('div.emoji-empty', {}, `Nothing matches “${q}”`));
        return;
      }
      body.append(section('Results', hits));
      rove(cells()[0]);
      return;
    }
    const recent = recentEmoji().map((k) => emojiEntry(k)).filter(Boolean);
    const sections = [{ id: 'recent', name: 'Frequently used', items: recent, glyph: '🕘' }]
      .concat(emojiCategories().map((c) => ({ ...c, glyph: CATEGORY_ICONS[c.id] || '•' })));
    for (const s of sections) {
      if (!s.items.length) continue;
      const sec = section(s.name, s.items);
      sec.id = `${searchId}-${s.id}`;
      body.append(sec);
      tabs.append(el('button.emoji-tab', {
        type: 'button', role: 'tab', 'aria-label': s.name, title: s.name, 'aria-controls': sec.id,
        onclick: () => {
          sec.scrollIntoView({ block: 'start' });
          markTab(sec.id);
        },
      }, s.glyph));
    }
    markTab(body.querySelector('.emoji-section')?.id);
    rove(cells()[0]);
  }

  /**
   * One tab stop on the grid, the cell the keyboard was last on or the
   * first (the ARIA grid pattern, as the category strip keeps one; see
   * markTab): every cell is out of the Tab order for the arrows to walk
   * them, and with none put back, Tab went from the search box straight to
   * the categories and the tone, past every emoji, so a keyboard that did
   * not know Down from the search box enters the grid never reached it,
   * and the grid could not be scrolled from the keyboard at all.
   */
  let stop = null;
  function rove(cell) {
    if (!cell) return;
    if (stop && stop !== cell) stop.setAttribute('tabindex', '-1');
    cell.setAttribute('tabindex', '0');
    stop = cell;
  }
  body.addEventListener('focusin', (e) => {
    if (e.target instanceof HTMLElement && e.target.classList.contains('emoji-cell')) rove(e.target);
  });

  function section(name, items) {
    const grid = el('div.emoji-grid', { role: 'row' });
    for (const e of items) grid.append(cell(e));
    return el('div.emoji-section', { role: 'rowgroup' }, el('div.emoji-section-title', {}, name), grid);
  }

  function markTab(id) {
    // The stop stays with the keyboard while it is on a tab of the strip:
    // the highlight follows the section in view as the grid scrolls (below),
    // and the scroll an arrow's own pick brings lights another tab where the
    // section cannot reach the top of the grid (the last few), which took
    // the stop with it, so the tab under the keyboard was in nobody's Tab
    // order, and Shift+Tab from it landed on that other tab rather than
    // leaving the strip for the tone button. The stop goes back to the
    // selected tab once the keyboard leaves the strip (see focusout).
    const focused = [...tabs.children].includes(document.activeElement) ? document.activeElement : null;
    for (const t of tabs.children) {
      const on = t.getAttribute('aria-controls') === id;
      t.setAttribute('aria-selected', String(on));
      // One stop on the strip, the selected tab (the ARIA tabs pattern): the
      // arrows step between the tabs (below). Each tab was a stop of its
      // own, nine presses of Tab between the search box and the tone button
      // and back round, where the conversation's and the details' tab strips
      // take one.
      t.setAttribute('tabindex', (focused ? t === focused : on) ? '0' : '-1');
    }
  }
  tabs.addEventListener('focusout', (e) => {
    if (e.relatedTarget instanceof Node && tabs.contains(e.relatedTarget)) return;
    const sel = [...tabs.children].find((t) => t.getAttribute('aria-selected') === 'true');
    if (sel) markTab(sel.getAttribute('aria-controls'));
  });
  // Left and Right step between the category tabs and pick as they go (the
  // section scrolls into view, as a click brings it), round at the ends;
  // Home and End go to the first and the last. A modified arrow is a
  // shortcut's (Alt+Left/Right), and one during an IME composition is the IME's.
  tabs.addEventListener('keydown', (e) => {
    if (e.altKey || e.metaKey || e.ctrlKey || composing(e)) return;
    const list = [...tabs.querySelectorAll('.emoji-tab')];
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    let next;
    if (e.key === 'ArrowRight') next = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft') next = (i + list.length - 1) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    list[next].focus({ preventScroll: true });
    list[next].click();
  });

  // Highlight the tab of the section in view while scrolling.
  body.addEventListener('scroll', () => {
    const top = body.getBoundingClientRect().top;
    let current = null;
    for (const sec of body.querySelectorAll('.emoji-section')) {
      if (sec.getBoundingClientRect().top - top <= 8) current = sec.id;
    }
    if (current) markTab(current);
  }, { passive: true });

  /* ---- tone menu -------------------------------------------------------- */

  const closeTones = () => {
    if (!toneMenu) return;
    toneMenu.remove();
    toneMenu = null;
    toneBtn.setAttribute('aria-expanded', 'false');
  };
  toneBtn.addEventListener('click', () => {
    if (toneMenu) {
      closeTones();
      return;
    }
    toneMenu = el('div.emoji-tones', { role: 'listbox', 'aria-label': 'Skin tone' },
      ...TONE_SAMPLE.map((glyph, i) => el('button', {
        type: 'button', role: 'option', 'aria-selected': String(tone === i + 1),
        'aria-label': ['No skin tone', 'Light', 'Medium light', 'Medium', 'Medium dark', 'Dark'][i],
        onclick: () => {
          tone = i + 1;
          setPreferredTone(tone);
          closeTones();
          renderTone();
          render();
          (coarse ? pop.node : search).focus({ preventScroll: true });
        },
      }, glyph)));
    // A listbox, so the arrows step through the tones (Home and End to the
    // ends) as they do through any list; Tab still leaves it, and Enter or
    // Space picks, as on any button.
    toneMenu.addEventListener('keydown', (e) => {
      // A modified arrow is a shortcut's (Alt+Up/Down steps between
      // conversations), and one during an IME composition is the IME's.
      if (e.altKey || e.metaKey || e.ctrlKey || composing(e)) return;
      const options = [...toneMenu.querySelectorAll('button')];
      const i = options.indexOf(document.activeElement);
      let next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = options[(i + 1) % options.length];
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = options[(i - 1 + options.length) % options.length];
      else if (e.key === 'Home') next = options[0];
      else if (e.key === 'End') next = options[options.length - 1];
      if (!next) return;
      e.preventDefault();
      e.stopPropagation();
      next.focus();
    });
    root.append(toneMenu);
    toneBtn.setAttribute('aria-expanded', 'true');
    toneMenu.querySelector('[aria-selected="true"]')?.focus();
  });
  // The tone list lies over the category tabs and the top of the grid, and
  // only its own button closed it: a reader who turned to the search box or
  // a tab instead was left with it covering what they were looking at.
  root.addEventListener('pointerdown', (e) => {
    if (toneMenu && !toneMenu.contains(e.target) && !toneBtn.contains(e.target)) closeTones();
  });

  /* ---- keys --------------------------------------------------------------- */

  const cells = () => [...body.querySelectorAll('.emoji-cell')];
  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => {
    // Down during an IME composition picks a candidate in the box, not the
    // first emoji; a modified Down is a shortcut's.
    if (e.altKey || e.metaKey || e.ctrlKey || composing(e)) return;
    if (e.key === 'ArrowDown' || (e.key === 'Enter' && search.value.trim())) {
      const first = cells()[0];
      if (first) {
        e.preventDefault();
        if (e.key === 'Enter') first.click();
        else first.focus();
      }
    }
  });
  // Rows are per section (each grid starts a new row), so up, down, Home and
  // End work within the cell's own grid and step into the neighbouring
  // section's nearest cell at its edges; left and right run on across them.
  body.addEventListener('keydown', (e) => {
    const cell = document.activeElement;
    if (!(cell instanceof HTMLElement) || !cell.classList.contains('emoji-cell')) return;
    // As above: a modified arrow, or one during an IME composition, is not the grid's.
    if (e.altKey || e.metaKey || e.ctrlKey || composing(e)) return;
    const grids = [...body.querySelectorAll('.emoji-grid')];
    const grid = cell.parentElement;
    const g = grids.indexOf(grid);
    const row = [...grid.children];
    const i = row.indexOf(cell);
    const col = i % COLUMNS;
    const inGrid = (gi, idx) => (grids[gi] ? grids[gi].children[Math.max(0, Math.min(idx, grids[gi].children.length - 1))] : null);
    let next = null; // an element, the search box, or nothing
    if (e.key === 'ArrowRight') next = row[i + 1] || inGrid(g + 1, 0) || cell;
    else if (e.key === 'ArrowLeft') next = i > 0 ? row[i - 1] : inGrid(g - 1, Infinity) || cell;
    else if (e.key === 'ArrowDown') {
      if (i + COLUMNS < row.length) next = row[i + COLUMNS];
      else if (Math.floor(i / COLUMNS) < Math.floor((row.length - 1) / COLUMNS)) next = row[row.length - 1]; // a shorter last row
      else next = inGrid(g + 1, col) || cell;
    } else if (e.key === 'ArrowUp') {
      if (i >= COLUMNS) next = row[i - COLUMNS];
      else if (g > 0) {
        const prev = grids[g - 1].children.length;
        next = inGrid(g - 1, Math.floor((prev - 1) / COLUMNS) * COLUMNS + col);
      } else next = search;
    } else if (e.key === 'Home') next = row[i - col];
    else if (e.key === 'End') next = row[Math.min(row.length - 1, i - col + COLUMNS - 1)];
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      cell.click();
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
    next?.focus();
  });

  renderTone();
  render();
  if (!emojiReady()) loadEmoji().then(render).catch(() => { body.replaceChildren(el('div.emoji-empty', {}, 'Could not load emoji')); });
  if (!coarse) setTimeout(() => search.focus(), 0);
  return pop;
}
