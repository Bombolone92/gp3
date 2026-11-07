/**
 * Renders a survey for a respondent: pages, questions, validation, logic,
 * progress, and the closing screens. The public respondent page and the
 * builder's preview both use this, so what creators preview is exactly what
 * respondents get.
 *
 * Plain DOM, no framework, no SDK: the respondent page must load fast on any
 * phone. Every input is a native control (radios, checkboxes, selects,
 * range, date) styled up, so keyboard and screen reader behavior comes from
 * the browser.
 */
import {
  OTHER_ID,
  NONE_ID,
  sanitizeAnswer,
  validateAnswer,
  fieldIssue,
  isAnswerable,
  isQuestionVisible,
  nextStep,
  seededShuffle,
  questionNumbers,
  fieldsOf,
  ratingMax,
  sliderBounds,
  validateResponse,
} from '../shared/runtime.js';

/**
 * The URL if it is a plain http(s) address, else ''. Survey content comes
 * from whichever worker a link names, so it is untrusted: a javascript: or
 * data: redirect must never be followed or linked.
 */
export function safeHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const u = new URL(value.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch {
    return '';
  }
}

/* ---- Tiny DOM helper (this bundle stays independent of the builder) ---- */

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'value') node.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'hidden') node[k] = !!v;
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAPES = {
  star: 'M12 2.8l2.83 5.73 6.32.92-4.57 4.46 1.08 6.29L12 17.23l-5.66 2.97 1.08-6.29L2.85 9.45l6.32-.92z',
  heart: 'M12 20.5s-7.5-4.6-9.2-9.3C1.6 7.8 3.9 4.5 7.3 4.5c2 0 3.6 1.1 4.7 2.7 1.1-1.6 2.7-2.7 4.7-2.7 3.4 0 5.7 3.3 4.5 6.7-1.7 4.7-9.2 9.3-9.2 9.3z',
  thumb: 'M7 10v10H3V10h4zm2 10V9.6l4.5-6.6c.9-.9 2.6-.2 2.4 1.2L15.2 9H20c1.2 0 2.1 1.1 1.9 2.3l-1.4 7.2c-.2.9-1 1.5-1.9 1.5H9z',
  circle: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
};

function shapeSvg(shape) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'sv-shape');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', SHAPES[shape] || SHAPES.star);
  svg.append(path);
  return svg;
}

/* ---- Theme ---- */

const FONT_STACKS = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  humanist: "Seravek, 'Gill Sans Nova', Ubuntu, Calibri, 'DejaVu Sans', source-sans-pro, sans-serif",
  rounded: "ui-rounded, 'Hiragino Maru Gothic ProN', Quicksand, Comfortaa, Manjari, 'Arial Rounded MT', Calibri, sans-serif",
  serif: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, Georgia, serif",
  mono: "ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace",
};

function luminance(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

// Letters of right-to-left scripts (Hebrew, Arabic, Syriac, Thaana, N'Ko
// and their presentation forms).
const RTL_LETTER = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/gu;

/** 'rtl' when most letters in `text` are from right-to-left scripts. */
export function textDirection(text) {
  const t = String(text || '').slice(0, 4000);
  const rtl = (t.match(RTL_LETTER) || []).length;
  const letters = (t.match(/\p{L}/gu) || []).length;
  return rtl > letters - rtl ? 'rtl' : 'ltr';
}

/** Black or white, whichever reads better on `hex`. */
export function readableOn(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '#ffffff';
  const L = luminance(hex);
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#111111' : '#ffffff';
}

/** Apply a survey theme as CSS custom properties on `node`. */
export function applySurveyTheme(node, theme = {}) {
  const t = theme || {};
  const set = (k, v) => v && node.style.setProperty(k, v);
  set('--sv-accent', t.accent);
  set('--sv-on-accent', readableOn(t.accent));
  set('--sv-bg', t.background);
  set('--sv-surface', t.surface);
  set('--sv-text', t.text);
  set('--sv-font', FONT_STACKS[t.font] || FONT_STACKS.system);
  set('--sv-radius', { sharp: '2px', soft: '10px', round: '18px' }[t.radius] || '10px');
  // Error text, form controls and their native parts sit on the question
  // area: its color decides, even when the page background differs.
  node.dataset.svDark = luminance(t.surface || t.background || '#ffffff') < 0.2 ? 'true' : 'false';
  node.dataset.svAnswers = t.answerStyle === 'tiles' ? 'tiles' : 'classic';
}

function logoNode(theme) {
  // Logos are embedded images only: a remote URL could track respondents.
  if (!theme || typeof theme.logo !== 'string' || !/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/.test(theme.logo)) return null;
  const align = ['left', 'center', 'right'].includes(theme.logoAlign) ? theme.logoAlign : 'left';
  return el('div', { class: `sv-logo sv-logo-${align}` }, el('img', { src: theme.logo, alt: '' }));
}

function textBlock(text, cls) {
  return text && text.trim() ? el('div', { class: cls }, text) : null;
}

/**
 * Mark `root` [data-sv-narrow] while it is 600px wide or less. The narrow
 * layout follows the survey's own width, not the window's, so it also
 * applies in the builder's phone preview and in narrow embeds.
 */
export function trackWidth(root) {
  const set = () => {
    const w = root.clientWidth;
    root.toggleAttribute('data-sv-narrow', w > 0 && w <= 600);
  };
  set();
  if (!root.__svWidth && typeof ResizeObserver !== 'undefined') {
    root.__svWidth = new ResizeObserver(set);
    root.__svWidth.observe(root);
  }
}

/** A creator's button label, or the default when it is empty or blank. */
const label = (text, fallback) => (typeof text === 'string' && text.trim()) || fallback;

/* ---- Device detection for response metadata ---- */

export function deviceKind() {
  const ua = navigator.userAgent || '';
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

/* ---- Main ---- */

/**
 * Mount a survey into `root`.
 *
 * options:
 *   survey      the published snapshot
 *   collector   { thankYou } overrides, or null
 *   preview     true in the builder: shows a banner, never submits
 *   onSubmit    async ({ answers, startedAt, meta }) => { ok, outcome, errors?, message?, closed? }
 *               closed: { title, message } when the survey stopped taking
 *               responses (closed, link ended, full): shown in place of it
 *   onFinish    called with the outcome after the closing screen shows
 *   startPage   page index to open at (preview "jump to page")
 *   embedded    in another site's frame: a redirect is offered as a link
 *               that leaves the frame, not followed inside it
 */
export function mountSurvey(root, { survey, collector = null, preview = false, onSubmit, onFinish, startPage = 0, embedded = false }) {
  const opts = survey.options || {};
  const focusMode = opts.format === 'focus';
  const numbers = questionNumbers(survey);
  const seed = Math.random().toString(36).slice(2);
  // A shuffled page keeps its range of numbers, counted in the order shown.
  for (const page of survey.pages) {
    if (!page.randomize) continue;
    const shown = pageQuestions(page).filter((q) => numbers[q.id]);
    const nums = shown.map((q) => numbers[q.id]).sort((a, b) => a - b);
    shown.forEach((q, i) => (numbers[q.id] = nums[i]));
  }
  // One id per visit: the collector stores a resent submission only once.
  const rid = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => (b % 36).toString(36)).join('');
  const startedAt = Date.now();
  const answers = {};
  const touched = new Set();
  const errors = {};
  const history = [];
  let pageIndex = Math.min(Math.max(0, startPage), Math.max(0, survey.pages.length - 1));
  // Preview can open at any page: the pages before it count as visited.
  let openedAt = pageIndex;
  let stepInPage = 0; // focus mode: index into the page's visible questions
  let submitting = false;

  root.classList.add('sv-root');
  // A survey written in Hebrew or Arabic reads right to left throughout.
  root.dir = textDirection(
    [survey.title, survey.description, ...survey.pages.flatMap((p) => [p.title, ...p.questions.flatMap((q) => [q.title, ...(q.choices || []).map((c) => c.label)])])].join(' '),
  );
  applySurveyTheme(root, survey.theme);
  root.replaceChildren();
  trackWidth(root);

  const shell = el('div', { class: `sv-shell${focusMode ? ' sv-focus' : ''}` });
  const progress = el('div', {
    class: 'sv-progress',
    role: 'progressbar',
    'aria-label': 'Survey progress',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
  }, el('div', { class: 'sv-progress-fill' }));
  const head = el('header', { class: 'sv-head' }, logoNode(survey.theme), el('h1', { class: 'sv-title' }, survey.title));
  const main = el('main', { class: 'sv-main', id: 'sv-main', tabindex: '-1' });
  const foot = el(
    'footer',
    { class: 'sv-foot' },
    el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Powered by Puter'),
  );

  if (preview) {
    shell.append(el('div', { class: 'sv-preview-note', role: 'note' }, 'Preview: answers are not recorded'));
  }
  if (opts.progressBar === 'top') head.prepend(progress);
  shell.append(head, main);
  if (opts.progressBar === 'bottom') foot.prepend(progress);
  shell.append(foot);
  root.append(shell);

  /* ---- Ordering ---- */

  function orderedChoices(q) {
    const list = (q.choices || []).filter((c) => (c.label || '').trim());
    return q.randomize ? seededShuffle(list, `${seed}:${q.id}`) : list;
  }

  function pageQuestions(page) {
    const qs = page.questions || [];
    if (!page.randomize) return qs;
    // Shuffled, a follow-up still comes right after the question it depends
    // on: ahead of it, it would appear above the answer that reveals it, and
    // one at a time it would shift the step being answered.
    const onPage = new Set(qs.map((q) => q.id));
    const out = [];
    const firsts = [];
    const followUps = new Map();
    for (const q of seededShuffle(qs, `${seed}:${page.id}`)) {
      const src = q.display && q.display.qid;
      if (src && onPage.has(src) && src !== q.id) followUps.set(src, [...(followUps.get(src) || []), q]);
      else firsts.push(q);
    }
    const place = (q) => {
      out.push(q);
      const fs = followUps.get(q.id) || [];
      followUps.delete(q.id);
      fs.forEach(place);
    };
    firsts.forEach(place);
    // Conditions only look at earlier questions, so every follow-up has a
    // place; any left (a cycle in hand-made data) go last.
    for (const fs of followUps.values()) out.push(...fs);
    return out;
  }

  /**
   * The answers logic may use: those on the pages of the path actually
   * taken, to questions showing at that point, as the collector counts
   * them. `answers` also keeps what was typed into questions since hidden
   * and pages backed out of, so they come back filled in if shown again,
   * but those must never show, hide or skip anything.
   */
  function liveAnswers() {
    const pages = Array.from({ length: openedAt }, (_, i) => i);
    for (const h of history) if (!pages.includes(h.pageIndex)) pages.push(h.pageIndex);
    if (!pages.includes(pageIndex)) pages.push(pageIndex);
    const live = {};
    for (const i of pages) {
      for (const q of (survey.pages[i] && survey.pages[i].questions) || []) {
        if (answers[q.id] !== undefined && isAnswerable(q) && isQuestionVisible(q, survey, live)) live[q.id] = answers[q.id];
      }
    }
    return live;
  }

  function visibleQuestions(page) {
    const live = liveAnswers();
    return pageQuestions(page).filter((q) => isQuestionVisible(q, survey, live));
  }

  /* ---- Answers ---- */

  function setAnswer(q, raw, { rerenderPage = true } = {}) {
    const v = sanitizeAnswer(q, raw);
    if (v === undefined) delete answers[q.id];
    else answers[q.id] = v;
    touched.add(q.id);
    if (errors[q.id]) {
      const msg = checkAnswer(q);
      if (!msg) {
        delete errors[q.id];
        updateError(q);
      }
    }
    // Display logic can show or hide later questions on this page.
    if (rerenderPage && dependents.has(q.id)) refreshPage();
    // Skip logic can make this the last step, or no longer the last.
    else if (q.logic) updateNavLabel();
  }

  /**
   * Show and hide questions after an answer changed, in place: the control
   * being answered must stay in the document (and focused) while the
   * respondent types, drags a slider or arrows through choices.
   */
  function refreshPage() {
    const form = main.querySelector('.sv-page');
    if (!form) return;
    // One at a time, only the question being answered is on screen, and
    // follow-ups come after it.
    if (!focusMode) {
      const want = visibleQuestions(survey.pages[pageIndex]);
      const ids = new Set(want.map((q) => q.id));
      for (const node of form.querySelectorAll(':scope > [data-q]')) if (!ids.has(node.dataset.q)) node.remove();
      let prev = null;
      for (const q of want) {
        let node = form.querySelector(`:scope > [data-q="${q.id}"]`);
        if (!node) {
          node = renderQuestion(q);
          if (prev) prev.after(node);
          else (form.querySelector(':scope > [data-q]') || form.querySelector(':scope > .sv-hp')).before(node);
        }
        prev = node;
      }
    }
    updateNavLabel();
    updateProgress(pathEstimate());
  }

  function updateNavLabel() {
    const btn = main.querySelector('.sv-nav .sv-btn-primary');
    if (!btn || submitting) return;
    const buttons = opts.buttons || {};
    btn.textContent = isLastStep() ? label(buttons.done, 'Submit') : label(buttons.next, 'Next');
  }

  // Checks of what is typed but cannot become an answer yet (half a date and
  // time, a date the browser cannot read), per question, read from the
  // controls when needed: said on Next, not silently lost.
  const partial = new Map();
  const checkAnswer = (q) => (partial.has(q.id) && partial.get(q.id)()) || validateAnswer(q, answers[q.id]);
  // Per question: the box or row its error is about (the Other text, a
  // contact field, an unanswered row), which gets focus; null for the first.
  const fixAt = new Map();
  const otherMissing = (q) => {
    const v = answers[q.id];
    return !!v && (Array.isArray(v.c) ? v.c.includes(OTHER_ID) : v.c === OTHER_ID) && q.other.required !== false && !v.t;
  };

  const dependents = new Set();
  for (const p of survey.pages) for (const q of p.questions) if (q.display && q.display.qid) dependents.add(q.display.qid);

  function updateError(q) {
    const box = main.querySelector(`[data-err="${q.id}"]`);
    const wrap = main.querySelector(`[data-q="${q.id}"]`);
    if (!box || !wrap) return;
    const msg = errors[q.id] || '';
    box.textContent = msg;
    box.hidden = !msg;
    wrap.classList.toggle('sv-has-error', !!msg);
    const control = wrap.querySelector('[data-control]');
    if (control) control.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  /* ---- Question renderers ---- */

  function choiceInput(q, type, choice, checked, name, onChange) {
    const id = `${q.id}-${choice.id}`;
    return el(
      'label',
      { class: 'sv-choice', for: id },
      el('input', { type, id, name, value: choice.id, checked, onchange: onChange }),
      el('span', { class: 'sv-choice-label' }, choice.label),
    );
  }

  function otherInput(q, value, onInput) {
    return el('input', {
      class: 'sv-input sv-other-input',
      type: 'text',
      maxlength: '1000',
      'aria-label': q.other.label || 'Other',
      placeholder: 'Please specify',
      value: value || '',
      oninput: onInput,
    });
  }

  function renderSingle(q) {
    const cur = answers[q.id] || {};
    const name = `q-${q.id}`;
    const list = el('div', { class: `sv-choices sv-layout-${q.layout || 'vertical'}`, role: 'radiogroup', 'data-control': '' });
    const commit = () => {
      const picked = list.querySelector('input[type=radio]:checked');
      const other = list.querySelector('.sv-other-input');
      setAnswer(q, picked ? { c: picked.value, t: other ? other.value : '' } : undefined);
      if (other) other.hidden = !(picked && picked.value === OTHER_ID);
      if (focusMode && picked && picked.value !== OTHER_ID) scheduleAutoAdvance(q);
    };
    for (const c of orderedChoices(q)) list.append(choiceInput(q, 'radio', c, cur.c === c.id, name, commit));
    if (q.other && q.other.enabled) {
      const oc = { id: OTHER_ID, label: q.other.label || 'Other' };
      const row = el('div', { class: 'sv-other' }, choiceInput(q, 'radio', oc, cur.c === OTHER_ID, name, commit));
      const input = otherInput(q, cur.t, () => {
        const radio = row.querySelector('input[type=radio]');
        if (!radio.checked && input.value) radio.checked = true;
        commit();
      });
      input.hidden = cur.c !== OTHER_ID;
      row.append(input);
      list.append(row);
      fixAt.set(q.id, () => otherMissing(q) && input);
    }
    return list;
  }

  function renderMulti(q) {
    const cur = answers[q.id] || { c: [] };
    const list = el('div', { class: `sv-choices sv-layout-${q.layout || 'vertical'}`, role: 'group', 'data-control': '' });
    const commit = (e) => {
      const boxes = [...list.querySelectorAll('input[type=checkbox]')];
      // "None of the above" clears the others, and any other choice clears it.
      if (e && e.target && e.target.checked) {
        if (e.target.value === NONE_ID) boxes.forEach((b) => b !== e.target && (b.checked = false));
        else boxes.forEach((b) => b.value === NONE_ID && (b.checked = false));
      }
      const picked = boxes.filter((b) => b.checked).map((b) => b.value);
      const other = list.querySelector('.sv-other-input');
      if (other) other.hidden = !picked.includes(OTHER_ID);
      setAnswer(q, picked.length ? { c: picked, t: other ? other.value : '' } : undefined);
    };
    const name = `q-${q.id}`;
    for (const c of orderedChoices(q)) list.append(choiceInput(q, 'checkbox', c, cur.c.includes(c.id), name, commit));
    if (q.other && q.other.enabled) {
      const oc = { id: OTHER_ID, label: q.other.label || 'Other' };
      const row = el('div', { class: 'sv-other' }, choiceInput(q, 'checkbox', oc, cur.c.includes(OTHER_ID), name, commit));
      const input = otherInput(q, cur.t, () => {
        const box = row.querySelector('input[type=checkbox]');
        if (!box.checked && input.value) box.checked = true;
        commit();
      });
      input.hidden = !cur.c.includes(OTHER_ID);
      row.append(input);
      list.append(row);
      fixAt.set(q.id, () => otherMissing(q) && input);
    }
    if (q.none && q.none.enabled) {
      list.append(choiceInput(q, 'checkbox', { id: NONE_ID, label: q.none.label || 'None of the above' }, cur.c.includes(NONE_ID), name, commit));
    }
    return list;
  }

  function renderDropdown(q) {
    const cur = answers[q.id] || {};
    const select = el('select', { class: 'sv-input sv-select', 'data-control': '', id: `in-${q.id}`, 'aria-labelledby': `t-${q.id}` });
    select.append(el('option', { value: '' }, 'Select an answer'));
    for (const c of orderedChoices(q)) {
      const o = el('option', { value: c.id }, c.label);
      if (cur.c === c.id) o.selected = true;
      select.append(o);
    }
    let other = null;
    if (q.other && q.other.enabled) {
      const o = el('option', { value: OTHER_ID }, q.other.label || 'Other');
      if (cur.c === OTHER_ID) o.selected = true;
      select.append(o);
      other = otherInput(q, cur.t, () => setAnswer(q, { c: select.value, t: other.value }));
      other.hidden = cur.c !== OTHER_ID;
      fixAt.set(q.id, () => otherMissing(q) && other);
    }
    select.addEventListener('change', () => {
      if (other) other.hidden = select.value !== OTHER_ID;
      setAnswer(q, select.value ? { c: select.value, t: other ? other.value : '' } : undefined);
    });
    return el('div', { class: 'sv-dropdown' }, el('div', { class: 'sv-select-wrap' }, select), other);
  }

  function scaleLabels(q) {
    if (!q.minLabel && !q.maxLabel) return null;
    return el('div', { class: 'sv-scale-labels', 'aria-hidden': 'true' }, el('span', null, q.minLabel || ''), el('span', null, q.maxLabel || ''));
  }

  function renderRating(q) {
    const max = ratingMax(q);
    const cur = answers[q.id];
    const name = `q-${q.id}`;
    const group = el('div', { class: `sv-rating sv-shape-${q.shape || 'star'}`, role: 'radiogroup', 'data-control': '' });
    const paint = (v) => {
      group.querySelectorAll('.sv-rating-item').forEach((item, i) => item.classList.toggle('sv-on', v != null && i < v));
    };
    for (let i = 1; i <= max; i++) {
      const id = `${q.id}-r${i}`;
      const label =
        i === 1 && q.minLabel ? `${i}, ${q.minLabel}` : i === max && q.maxLabel ? `${i}, ${q.maxLabel}` : `${i} of ${max}`;
      const input = el('input', {
        type: 'radio',
        id,
        name,
        value: String(i),
        checked: cur === i,
        class: 'sv-visually-hidden',
        onchange: () => {
          setAnswer(q, i);
          paint(i);
          if (focusMode) scheduleAutoAdvance(q);
        },
      });
      const item = el('label', { class: 'sv-rating-item', for: id, title: label }, el('span', { class: 'sv-visually-hidden' }, label), shapeSvg(q.shape));
      item.addEventListener('pointerenter', () => paint(i));
      item.addEventListener('pointerleave', () => paint(answers[q.id]));
      group.append(input, item);
    }
    paint(cur);
    return el('div', null, group, scaleLabels(q));
  }

  function renderNps(q) {
    const cur = answers[q.id];
    const name = `q-${q.id}`;
    const group = el('div', { class: 'sv-nps', role: 'radiogroup', 'data-control': '' });
    for (let i = 0; i <= 10; i++) {
      const id = `${q.id}-n${i}`;
      group.append(
        el('input', {
          type: 'radio',
          id,
          name,
          value: String(i),
          checked: cur === i,
          class: 'sv-visually-hidden',
          onchange: () => {
            setAnswer(q, i);
            if (focusMode) scheduleAutoAdvance(q);
          },
        }),
        el(
          'label',
          { for: id, class: 'sv-nps-item' },
          String(i),
          // The end labels show below the scale, hidden from screen readers:
          // say them with their numbers instead, as star ratings do.
          i === 0 && q.minLabel ? el('span', { class: 'sv-visually-hidden' }, `, ${q.minLabel}`) : null,
          i === 10 && q.maxLabel ? el('span', { class: 'sv-visually-hidden' }, `, ${q.maxLabel}`) : null,
        ),
      );
    }
    return el('div', null, group, scaleLabels(q));
  }

  function renderMatrix(q) {
    const cur = answers[q.id] || {};
    const cols = (q.columns || []).filter((c) => (c.label || '').trim());
    let rows = (q.rows || []).filter((r) => (r.label || '').trim());
    if (q.randomize) rows = seededShuffle(rows, `${seed}:${q.id}`);
    const type = q.multi ? 'checkbox' : 'radio';
    const table = el('table', { class: 'sv-matrix', 'data-control': '' });
    const thead = el('thead', null, el('tr', null, el('td', null), cols.map((c) => el('th', { scope: 'col' }, c.label))));
    const tbody = el('tbody');
    const commit = () => {
      const out = {};
      for (const r of rows) {
        const picked = [...tbody.querySelectorAll(`input[data-row="${r.id}"]:checked`)].map((i) => i.value);
        if (picked.length) out[r.id] = q.multi ? picked : picked[0];
      }
      setAnswer(q, Object.keys(out).length ? out : undefined);
    };
    for (const r of rows) {
      const rowId = `${q.id}-${r.id}`;
      const tr = el('tr', null, el('th', { scope: 'row', id: rowId }, r.label));
      for (const c of cols) {
        const v = cur[r.id];
        const checked = q.multi ? Array.isArray(v) && v.includes(c.id) : v === c.id;
        const input = el('input', {
          type,
          name: `q-${q.id}-${r.id}`,
          value: c.id,
          'data-row': r.id,
          checked,
          'aria-label': `${r.label}: ${c.label}`,
          onchange: commit,
        });
        tr.append(el('td', { 'data-col': c.label }, el('label', { class: 'sv-cell' }, input, el('span', { class: 'sv-cell-label', 'aria-hidden': 'true' }, c.label))));
      }
      tbody.append(tr);
    }
    table.append(thead, tbody);
    fixAt.set(q.id, () => {
      const row = rows.find((r) => !Object.prototype.hasOwnProperty.call(answers[q.id] || {}, r.id));
      return row && tbody.querySelector(`input[data-row="${row.id}"]`);
    });
    return el('div', { class: 'sv-matrix-wrap' }, table);
  }

  function renderSlider(q) {
    const { min, max, step } = sliderBounds(q);
    const cur = answers[q.id];
    const output = el('output', { class: 'sv-slider-value', 'aria-hidden': 'true' }, cur == null ? 'Not answered' : String(cur));
    const pick = () => {
      setAnswer(q, Number(input.value));
      output.textContent = input.value;
      input.removeAttribute('aria-valuetext');
      unset.textContent = '';
      wrap.classList.add('sv-set');
    };
    const input = el('input', {
      type: 'range',
      class: 'sv-range',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(cur == null ? min + (max - min) / 2 : cur),
      'data-control': '',
      'aria-labelledby': `t-${q.id}`,
      // Until moved, the thumb sits mid-way: say it is not answered (some
      // browsers ignore valuetext on a native slider, so the description
      // says it too).
      'aria-valuetext': cur == null ? 'Not answered' : undefined,
      'data-describe': `nv-${q.id}`,
      oninput: pick,
      // A click on the untouched thumb picks the value it shows, though
      // the value did not change.
      onclick: () => wrap.classList.contains('sv-set') || pick(),
    });
    const unset = el('span', { class: 'sv-visually-hidden', id: `nv-${q.id}` }, cur == null ? 'Not answered' : '');
    const wrap = el('div', { class: `sv-slider${cur == null ? '' : ' sv-set'}` }, el('div', { class: 'sv-slider-row' }, input, output, unset), scaleLabels(q) ||
      el('div', { class: 'sv-scale-labels', 'aria-hidden': 'true' }, el('span', null, String(min)), el('span', null, String(max))));
    return wrap;
  }

  function renderRanking(q) {
    const items = orderedChoices(q);
    let order = Array.isArray(answers[q.id]) ? answers[q.id].slice() : items.map((c) => c.id);
    const byId = new Map(items.map((c) => [c.id, c]));
    const list = el('ol', { class: 'sv-rank', 'data-control': '', 'aria-describedby': `rh-${q.id}`, tabindex: '-1' });
    const hint = el('p', { class: 'sv-hint', id: `rh-${q.id}` }, 'Use the arrow buttons or drag to order, most preferred first.');
    const status = el('div', { class: 'sv-visually-hidden', 'aria-live': 'polite' });
    const keep = el('button', { type: 'button', class: 'sv-link-btn' }, 'Keep this order');
    keep.addEventListener('click', () => {
      commit();
      // The button hides itself: keep focus in the question.
      list.focus();
    });
    const commit = () => {
      setAnswer(q, order.slice());
      keep.hidden = true;
      list.classList.add('sv-set');
    };
    const move = (id, delta, focusDir) => {
      const i = order.indexOf(id);
      const j = i + delta;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      commit();
      draw();
      status.textContent = `${byId.get(id).label} moved to position ${j + 1} of ${order.length}`;
      // The same direction, or the other once at the top or bottom (a
      // disabled button cannot take focus).
      const btn = list.querySelector(`[data-id="${id}"] [data-dir="${focusDir}"]:not(:disabled)`) || list.querySelector(`[data-id="${id}"] button:not(:disabled)`);
      if (btn) btn.focus();
    };
    let drag = null;
    function draw() {
      list.replaceChildren();
      order.forEach((id, i) => {
        const c = byId.get(id);
        if (!c) return;
        const up = el('button', { type: 'button', class: 'sv-rank-btn', 'data-dir': 'up', 'aria-label': `Move ${c.label} up`, disabled: i === 0 }, '↑');
        const down = el('button', { type: 'button', class: 'sv-rank-btn', 'data-dir': 'down', 'aria-label': `Move ${c.label} down`, disabled: i === order.length - 1 }, '↓');
        up.addEventListener('click', () => move(id, -1, 'up'));
        down.addEventListener('click', () => move(id, 1, 'down'));
        const handle = el('span', { class: 'sv-rank-handle', 'aria-hidden': 'true' }, '☰');
        const li = el('li', { class: 'sv-rank-item', 'data-id': id }, el('span', { class: 'sv-rank-pos' }, String(i + 1)), handle, el('span', { class: 'sv-rank-label' }, c.label), up, down);
        handle.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          drag = { id, pointer: e.pointerId };
          li.classList.add('sv-dragging');
          handle.setPointerCapture(e.pointerId);
        });
        handle.addEventListener('pointermove', (e) => {
          if (!drag || drag.id !== id) return;
          const rows = [...list.children];
          const target = rows.find((r) => {
            const b = r.getBoundingClientRect();
            return e.clientY >= b.top && e.clientY <= b.bottom;
          });
          if (target && target.dataset.id !== id) {
            const from = order.indexOf(id);
            const to = order.indexOf(target.dataset.id);
            order.splice(from, 1);
            order.splice(to, 0, id);
            // The other rows move around the dragged one: moving the row
            // that holds the pointer capture would end the drag.
            const rows = new Map([...list.children].map((r) => [r.dataset.id, r]));
            const k = order.indexOf(id);
            for (const other of order.slice(0, k)) if (rows.has(other)) li.before(rows.get(other));
            for (const other of order.slice(k + 1).reverse()) if (rows.has(other)) li.after(rows.get(other));
            [...list.children].forEach((r, k) => (r.querySelector('.sv-rank-pos').textContent = String(k + 1)));
          }
        });
        const end = () => {
          if (!drag) return;
          drag = null;
          commit();
          draw();
        };
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
        list.append(li);
      });
    }
    draw();
    keep.hidden = Array.isArray(answers[q.id]);
    if (keep.hidden) list.classList.add('sv-set');
    return el('div', null, hint, list, keep, status);
  }

  function renderText(q) {
    const v = q.validation || {};
    const type = v.kind === 'email' ? 'email' : 'text';
    const input = el('input', {
      class: 'sv-input',
      dir: 'auto',
      type,
      id: `in-${q.id}`,
      'data-control': '',
      'aria-labelledby': `t-${q.id}`,
      // Number keypads, except where negative numbers are allowed: phone
      // number keypads (iOS) have no minus key.
      inputmode: v.min !== '' && v.min != null && Number(v.min) < 0 ? undefined : v.kind === 'number' ? 'decimal' : v.kind === 'integer' ? 'numeric' : undefined,
      autocomplete: v.kind === 'email' ? 'email' : 'off',
      maxlength: '1000',
      placeholder: q.placeholder || '',
      value: answers[q.id] || '',
      oninput: () => setAnswer(q, input.value),
    });
    return input;
  }

  function renderTextarea(q) {
    const input = el('textarea', {
      class: 'sv-input sv-textarea',
      dir: 'auto',
      id: `in-${q.id}`,
      rows: '4',
      'data-control': '',
      'aria-labelledby': `t-${q.id}`,
      maxlength: '10000',
      placeholder: q.placeholder || '',
      oninput: () => setAnswer(q, input.value),
    });
    input.value = answers[q.id] || '';
    return input;
  }

  const AUTOCOMPLETE = {
    name: 'name',
    company: 'organization',
    address: 'address-line1',
    address2: 'address-line2',
    city: 'address-level2',
    state: 'address-level1',
    zip: 'postal-code',
    country: 'country-name',
    email: 'email',
    phone: 'tel',
  };

  function renderFields(q) {
    const cur = answers[q.id] || {};
    const wrap = el('div', { class: 'sv-fields', 'data-control': '' });
    const inputs = [];
    const commit = () => {
      const out = {};
      for (const [id, input] of inputs) out[id] = input.value;
      setAnswer(q, out);
    };
    for (const f of fieldsOf(q)) {
      const id = `in-${q.id}-${f.id}`;
      const input = el('input', {
        class: 'sv-input',
        dir: 'auto',
        id,
        type: f.kind === 'email' ? 'email' : f.kind === 'phone' ? 'tel' : 'text',
        autocomplete: q.type === 'contact' ? AUTOCOMPLETE[f.id] || 'off' : 'off',
        maxlength: '500',
        value: cur[f.id] || '',
        'aria-required': f.required ? 'true' : undefined,
        oninput: commit,
      });
      inputs.push([f.id, input]);
      wrap.append(el('div', { class: 'sv-field' }, el('label', { for: id }, f.label, f.required ? el('span', { class: 'sv-req', 'aria-hidden': 'true' }, ' *') : null), input));
    }
    fixAt.set(q.id, () => {
      const issue = fieldIssue(q, answers[q.id] || {});
      return issue && wrap.querySelector(`#in-${q.id}-${issue.id}`);
    });
    return wrap;
  }

  function renderDatetime(q) {
    const cur = answers[q.id] || '';
    const wantDate = q.date !== false;
    const wantTime = !!q.time;
    const [d0, t0] = wantDate && wantTime ? cur.split('T') : wantTime ? ['', cur] : [cur, ''];
    const date = wantDate ? el('input', { class: 'sv-input sv-date', type: 'date', value: d0 || '', 'aria-label': 'Date' }) : null;
    const time = wantTime ? el('input', { class: 'sv-input sv-time', type: 'time', value: t0 || '', 'aria-label': 'Time' }) : null;
    const raw = () => {
      const d = date ? date.value : '';
      const t = time ? time.value : '';
      return wantDate && wantTime ? (d && t ? `${d}T${t}` : '') : wantTime ? t : d;
    };
    const bad = (input) => !!(input && input.validity && input.validity.badInput);
    // The message, and the box it is about.
    const issue = () => {
      const d = date ? date.value : '';
      const t = time ? time.value : '';
      // A half-typed date reads as empty, with badInput set.
      if (bad(date) || (d && raw() && sanitizeAnswer(q, raw()) === undefined)) return ['Enter a valid date.', date];
      if (bad(time)) return ['Enter a valid time.', time];
      if (wantDate && wantTime && !!d !== !!t) return ['Enter both a date and a time.', d ? time : date];
      return ['', null];
    };
    partial.set(q.id, () => issue()[0]);
    fixAt.set(q.id, () => issue()[1]);
    const commit = () => setAnswer(q, raw());
    date && date.addEventListener('input', commit);
    time && time.addEventListener('input', commit);
    return el('div', { class: 'sv-datetime', 'data-control': '', role: 'group', 'aria-labelledby': `t-${q.id}` }, date, time);
  }

  const RENDERERS = {
    single: renderSingle,
    multi: renderMulti,
    dropdown: renderDropdown,
    rating: renderRating,
    nps: renderNps,
    matrix: renderMatrix,
    slider: renderSlider,
    ranking: renderRanking,
    text: renderText,
    textarea: renderTextarea,
    multitext: renderFields,
    contact: renderFields,
    datetime: renderDatetime,
  };

  /** Fieldset-based groups label themselves with <legend>; single controls
   *  point at the title with aria-labelledby. */
  const GROUPED = new Set(['single', 'multi', 'rating', 'nps', 'matrix', 'ranking', 'multitext', 'contact']);

  function renderQuestion(q) {
    if (q.type === 'statement') {
      return el('section', { class: 'sv-q sv-statement', 'data-q': q.id }, textBlock(q.title, 'sv-statement-title'), textBlock(q.description, 'sv-desc'));
    }
    const grouped = GROUPED.has(q.type);
    const num = opts.numbering !== false && numbers[q.id] ? el('span', { class: 'sv-num' }, `${numbers[q.id]}.`) : null;
    const req = q.required
      ? [opts.requiredMark !== false ? el('span', { class: 'sv-req', 'aria-hidden': 'true' }, '*') : null, el('span', { class: 'sv-visually-hidden' }, ' (required)')]
      : null;
    const titleInner = [num, el('span', { class: 'sv-qtext' }, q.title || 'Untitled question'), req];
    const errBox = el('div', { class: 'sv-error', 'data-err': q.id, id: `e-${q.id}`, role: 'alert', hidden: true, dir: 'auto' });
    const desc = q.description && q.description.trim() ? el('div', { class: 'sv-desc', id: `d-${q.id}` }, q.description) : null;
    const control = RENDERERS[q.type](q);
    const describedBy = [desc ? `d-${q.id}` : '', `e-${q.id}`].filter(Boolean).join(' ');
    let node;
    if (grouped) {
      node = el(
        'fieldset',
        { class: `sv-q sv-q-${q.type}`, 'data-q': q.id, 'aria-describedby': describedBy },
        el('legend', { class: 'sv-qtitle', id: `t-${q.id}` }, titleInner),
        desc,
        control,
        errBox,
      );
    } else {
      node = el(
        'div',
        { class: `sv-q sv-q-${q.type}`, 'data-q': q.id, role: 'group', 'aria-labelledby': `t-${q.id}` },
        el('div', { class: 'sv-qtitle', id: `t-${q.id}` }, el('label', { for: `in-${q.id}` }, titleInner)),
        desc,
        control,
        errBox,
      );
      const field = node.querySelector('[data-control]');
      if (field) {
        field.setAttribute('aria-describedby', [describedBy, field.dataset.describe].filter(Boolean).join(' '));
        if (q.required && /^(INPUT|SELECT|TEXTAREA)$/.test(field.tagName)) field.setAttribute('aria-required', 'true');
      }
    }
    if (errors[q.id]) {
      errBox.textContent = errors[q.id];
      errBox.hidden = false;
      node.classList.add('sv-has-error');
    }
    return node;
  }

  /* ---- Pages and navigation ---- */

  function pathEstimate() {
    // Progress is pages done out of pages in the survey; skip logic can
    // shorten the real path, so the bar may jump forward, never back.
    const total = survey.pages.length || 1;
    if (focusMode) {
      const page = survey.pages[pageIndex];
      const qs = page ? visibleQuestions(page).length || 1 : 1;
      return Math.round(((pageIndex + Math.min(stepInPage, qs) / qs) / total) * 100);
    }
    return Math.round((pageIndex / total) * 100);
  }

  function updateProgress(pct) {
    progress.setAttribute('aria-valuenow', String(pct));
    progress.setAttribute('aria-valuetext', `${pct}% complete`);
    progress.firstChild.style.width = `${pct}%`;
  }

  function isLastStep() {
    const page = survey.pages[pageIndex];
    if (focusMode) {
      const qs = visibleQuestions(page);
      if (stepInPage < qs.length - 1) return false;
    }
    const to = nextPage(pageIndex);
    return to === 'end' || to === 'disqualify';
  }

  /**
   * Where Next goes from page `from`: past pages whose questions are all
   * hidden by answers given (the follow-ups did not apply), which would
   * show empty. A page made with no questions (an interlude) still shows.
   */
  function nextPage(from) {
    const live = liveAnswers();
    let to = nextStep(survey, from, live);
    while (typeof to === 'number' && survey.pages[to] && survey.pages[to].questions.length && !visibleQuestions(survey.pages[to]).length) {
      to = nextStep(survey, to, live);
    }
    return to;
  }

  function renderNav() {
    const buttons = opts.buttons || {};
    const nav = el('div', { class: 'sv-nav' });
    const canBack = opts.allowBack !== false && history.length > 0;
    if (canBack) {
      nav.append(el('button', { type: 'button', class: 'sv-btn sv-btn-secondary', onclick: back }, label(buttons.prev, 'Back')));
    }
    const last = isLastStep();
    const next = el(
      'button',
      { type: 'submit', class: 'sv-btn sv-btn-primary', 'aria-busy': submitting ? 'true' : undefined, disabled: submitting },
      last ? label(buttons.done, 'Submit') : label(buttons.next, 'Next'),
    );
    nav.append(next);
    return nav;
  }

  function renderPage(moveFocus = true) {
    const page = survey.pages[pageIndex];
    if (!page) return;
    const qs = visibleQuestions(page);
    const form = el('form', { class: 'sv-page', novalidate: true, 'aria-label': page.title || `Page ${pageIndex + 1}` });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      advance();
    });
    const showPageHead = opts.pageTitles !== false && (!focusMode || stepInPage === 0);
    if (showPageHead && (page.title || page.description)) {
      form.append(el('div', { class: 'sv-page-head' }, page.title ? el('h2', { class: 'sv-page-title' }, page.title) : null, textBlock(page.description, 'sv-desc')));
    }
    // textBlock is null for blank text; prepend(null) would write "null".
    const welcome = pageIndex === 0 && (!focusMode || stepInPage === 0) ? textBlock(survey.description, 'sv-survey-desc') : null;
    if (welcome) form.prepend(welcome);
    const shown = focusMode ? qs.slice(stepInPage, stepInPage + 1) : qs;
    for (const q of shown) form.append(renderQuestion(q));
    // Honeypot: hidden from people and assistive tech; bots fill it in.
    form.append(
      el('div', { class: 'sv-hp', 'aria-hidden': 'true' }, el('label', null, 'Leave this empty', el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' }))),
    );
    form.append(renderNav());
    main.replaceChildren(form);
    updateProgress(pathEstimate());
    if (moveFocus) {
      main.focus({ preventScroll: true });
      (root.closest('.sv-scroll') || document.scrollingElement || root).scrollTo?.({ top: 0 });
      root.scrollIntoView?.({ block: 'start' });
    }
  }

  let autoTimer = null;
  // Whether the latest pick came from a pointer. Arrow keys change a radio
  // on every press, so keyboard picks never move on by themselves.
  let pointerPick = false;
  main.addEventListener('pointerdown', () => (pointerPick = true), true);
  main.addEventListener('keydown', () => (pointerPick = false), true);

  function scheduleAutoAdvance(q) {
    // In one-question-at-a-time mode a single tap answers and moves on, the
    // way people expect from a conversational form. Only for questions that
    // take exactly one tap, and never past the last one: sending the
    // response takes a press of Submit.
    clearTimeout(autoTimer);
    if (!pointerPick || isLastStep()) return;
    autoTimer = setTimeout(() => {
      const page = survey.pages[pageIndex];
      const qs = visibleQuestions(page);
      if (qs[stepInPage] && qs[stepInPage].id === q.id && !checkAnswer(q)) advance();
    }, 350);
  }

  function validateShown() {
    const page = survey.pages[pageIndex];
    const qs = visibleQuestions(page);
    const shown = focusMode ? qs.slice(stepInPage, stepInPage + 1) : qs;
    let first = null;
    for (const q of shown) {
      if (!isAnswerable(q)) continue;
      const msg = checkAnswer(q);
      if (msg) {
        errors[q.id] = msg;
        if (!first) first = q;
      } else delete errors[q.id];
      updateError(q);
    }
    if (first) {
      focusQuestion(first.id);
      return false;
    }
    return true;
  }

  function focusQuestion(qid) {
    const node = main.querySelector(`[data-q="${qid}"]`);
    if (!node) return false;
    const target =
      (fixAt.has(qid) && fixAt.get(qid)()) ||
      node.querySelector('input:not([type=hidden]):not(.sv-visually-hidden), select, textarea, button:not(:disabled)') ||
      node.querySelector('input');
    const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView?.({ block: 'center', behavior: still ? 'auto' : 'smooth' });
    if (target) target.focus({ preventScroll: true });
    return true;
  }

  function showBanner(message) {
    const banner = el('div', { class: 'sv-banner', role: 'alert', tabindex: '-1', dir: 'auto' }, message);
    main.prepend(banner);
    banner.focus({ preventScroll: true });
    banner.scrollIntoView?.({ block: 'center' });
  }


  function advance() {
    if (submitting) return;
    clearTimeout(autoTimer);
    if (!validateShown()) return;
    const page = survey.pages[pageIndex];
    if (focusMode) {
      const qs = visibleQuestions(page);
      if (stepInPage < qs.length - 1) {
        history.push({ pageIndex, stepInPage });
        stepInPage++;
        renderPage();
        return;
      }
    }
    const to = nextPage(pageIndex);
    if (to === 'end' || to === 'disqualify') {
      submit(to);
      return;
    }
    history.push({ pageIndex, stepInPage });
    pageIndex = to;
    stepInPage = 0;
    renderPage();
  }

  function back() {
    clearTimeout(autoTimer);
    const prev = history.pop();
    if (!prev) return;
    pageIndex = prev.pageIndex;
    stepInPage = prev.stepInPage;
    renderPage();
  }

  async function submit(outcome) {
    const trap = main.querySelector('.sv-hp input');
    const payload = {
      hp: trap ? trap.value : '',
      // Exactly what the collector accepts: answers on the pages actually
      // visited, to questions that were showing. Nothing left over from a
      // branch the respondent backed out of is sent.
      answers: validateResponse(survey, liveAnswers()).answers,
      startedAt,
      rid,
      meta: { device: deviceKind(), lang: (navigator.language || '').slice(0, 20) },
    };
    if (preview || !onSubmit) {
      finish(outcome === 'disqualify' ? 'disqualified' : 'complete');
      return;
    }
    submitting = true;
    renderNavState();
    let result;
    try {
      result = await onSubmit(payload);
    } catch {
      result = { ok: false, message: 'Your response could not be sent. Check your connection and try again.' };
    }
    submitting = false;
    if (result && result.ok) {
      finish(result.outcome || (outcome === 'disqualify' ? 'disqualified' : 'complete'));
      return;
    }
    if (result && result.closed) {
      // No retry can succeed: say so in place of the questions.
      clearTimeout(autoTimer);
      progress.hidden = true;
      renderEnd(main, { title: result.closed.title, message: result.closed.message });
      return;
    }
    if (result && result.errors) {
      // The collector disagreed with a check: show its messages on the
      // first page that has one.
      Object.assign(errors, result.errors);
      const firstPage = survey.pages.findIndex((p) => p.questions.some((q) => result.errors[q.id]));
      if (firstPage >= 0) {
        // The path now resumes from that page (and, one at a time, from that
        // question): keep Back to the steps before it.
        let step = 0;
        if (focusMode) {
          pageIndex = firstPage;
          const qs = visibleQuestions(survey.pages[firstPage]);
          step = Math.max(0, qs.findIndex((q) => result.errors[q.id]));
        }
        const after = (h) => h.pageIndex > firstPage || (h.pageIndex === firstPage && h.stepInPage >= step);
        while (history.length && after(history[history.length - 1])) history.pop();
        pageIndex = firstPage;
        stepInPage = step;
      }
      renderPage(false);
      const shown = Object.keys(result.errors).find((id) => main.querySelector(`[data-q="${id}"].sv-has-error`));
      // An error for a question this copy of the survey does not show: the
      // survey was republished while the respondent was answering.
      if (shown) focusQuestion(shown);
      else showBanner('This survey was updated while you were answering. Please reload the page to see the latest version.');
      return;
    }
    renderPage(false);
    showBanner((result && result.message) || 'Your response could not be sent. Please try again.');
  }

  function renderNavState() {
    const btn = main.querySelector('.sv-btn-primary');
    if (btn) {
      btn.disabled = submitting;
      btn.setAttribute('aria-busy', submitting ? 'true' : 'false');
      if (submitting) btn.textContent = 'Sending…';
    }
  }

  function finish(outcome) {
    const ty = (collector && collector.thankYou) || {};
    const base = outcome === 'disqualified' ? opts.disqualify || {} : opts.thankYou || {};
    const title = outcome === 'disqualified' ? base.title : ty.title || base.title;
    const message = outcome === 'disqualified' ? base.message : ty.message || base.message;
    // A link's own thank-you screen replaces the survey's, so the survey's
    // redirect does not apply; blank text still falls back to the survey's.
    const redirect = outcome === 'disqualified' ? '' : safeHttpUrl(collector && collector.thankYou ? ty.redirect : base.redirect);
    updateProgress(100);
    progress.hidden = true;
    renderEnd(main, { title: title || 'Thank you', message, redirect: preview ? '' : redirect, done: true, embedded });
    if (preview && redirect) {
      main.querySelector('.sv-end').append(el('p', { class: 'sv-hint' }, `Respondents will be sent to ${redirect}`));
    }
    onFinish && onFinish(outcome);
    // In a frame, going on automatically would load the page inside the
    // frame (where many sites refuse to show); the link leaves the frame.
    if (!preview && !embedded && safeHttpUrl(redirect)) setTimeout(() => location.assign(safeHttpUrl(redirect)), 1800);
  }

  renderPage(false);

  return {
    goToPage(i) {
      pageIndex = Math.max(0, Math.min(i, survey.pages.length - 1));
      openedAt = pageIndex;
      stepInPage = 0;
      history.length = 0;
      renderPage();
    },
    get answers() {
      return { ...answers };
    },
    touched,
  };
}

/** A closing or status screen: thank-you, closed, already answered. */
export function renderEnd(container, { title, message, redirect = '', done = false, embedded = false }) {
  const node = el(
    'div',
    { class: 'sv-end', role: 'status' },
    done ? el('div', { class: 'sv-end-mark', 'aria-hidden': 'true' }, checkSvg()) : null,
    el('h2', { class: 'sv-end-title', tabindex: '-1', dir: 'auto' }, title),
    message ? el('p', { class: 'sv-end-msg', dir: 'auto' }, message) : null,
    safeHttpUrl(redirect)
      ? embedded
        ? el('p', null, el('a', { class: 'sv-btn sv-btn-primary', href: safeHttpUrl(redirect), target: '_top', rel: 'noopener noreferrer' }, 'Continue'))
        : el('p', { class: 'sv-hint' }, 'Taking you onward… ', el('a', { href: safeHttpUrl(redirect), rel: 'noopener noreferrer' }, 'Continue'))
      : null,
  );
  container.replaceChildren(node);
  node.querySelector('.sv-end-title').focus({ preventScroll: true });
  return node;
}

function checkSvg() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.innerHTML = '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
  return svg;
}

/** A themed page with just a message (closed survey, bad link). */
export function mountMessage(root, { title, message, theme = null, surveyTitle = '' }) {
  root.classList.add('sv-root');
  root.dir = textDirection(surveyTitle);
  applySurveyTheme(root, theme || {});
  trackWidth(root);
  const main = el('main', { class: 'sv-main', id: 'sv-main' });
  const shell = el(
    'div',
    { class: 'sv-shell' },
    el('header', { class: 'sv-head' }, logoNode(theme), surveyTitle ? el('h1', { class: 'sv-title' }, surveyTitle) : null),
    main,
  );
  root.replaceChildren(shell);
  renderEnd(main, { title, message });
  return shell;
}
