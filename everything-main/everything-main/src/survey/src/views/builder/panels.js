/**
 * The builder's side panels: Build (question types and starter questions),
 * Style (theme), Logic (overview of every rule) and Options (survey-wide
 * settings and closing screens).
 *
 * Panels redraw after edits made elsewhere (undo, canvas). Their own edits
 * use origin 'panel' (theme, toggles) or 'input' (typing), which they skip,
 * so a color picker or text field is never torn down while in use.
 */
import { h, replace, domId } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { toastError } from '../../lib/ui.js';
import {
  QUESTION_TYPES,
  THEME_PRESETS,
  FONTS,
  ANSWER_PRESETS,
  LOGIC_TYPES,
  makeQuestion,
  makeChoice,
  allQuestions,
} from '../../model/survey.js';
import * as edit from '../../model/edit.js';
import { isAnswerable, questionNumbers, OTHER_ID, NONE_ID } from '../../shared/runtime.js';
import { readableOn, safeHttpUrl } from '../../respond/render.js';

const preset = (id) => ANSWER_PRESETS.find((p) => p.id === id).items;
const choices = (labels) => labels.map((l) => makeChoice(l));

/** Ready-made questions people add all the time. */
export const STARTERS = [
  { label: 'Name', make: () => makeQuestion('text', { title: 'What is your name?' }) },
  { label: 'Email address', make: () => makeQuestion('text', { title: 'What is your email address?', validation: { kind: 'email', min: '', max: '', message: '' } }) },
  { label: 'Contact details', make: () => makeQuestion('contact', { title: 'How can we reach you?' }) },
  { label: 'Age range', make: () => makeQuestion('single', { title: 'What is your age?', choices: choices(preset('age')) }) },
  { label: 'Overall satisfaction', make: () => makeQuestion('rating', { title: 'Overall, how satisfied are you?', minLabel: 'Not satisfied', maxLabel: 'Very satisfied' }) },
  { label: 'Would recommend', make: () => makeQuestion('nps', { title: 'How likely are you to recommend us to a friend or colleague?' }) },
  { label: 'Ease of use', make: () => makeQuestion('single', { title: 'How easy was it to use?', choices: choices(preset('easy5')) }) },
  { label: 'How often', make: () => makeQuestion('single', { title: 'How often do you use it?', choices: choices(['Every day', 'A few times a week', 'About once a week', 'A few times a month', 'Less often']) }) },
  {
    label: 'How you heard about us',
    make: () => makeQuestion('single', {
      title: 'How did you hear about us?',
      choices: choices(['Search engine', 'Social media', 'A friend or colleague', 'An advertisement', 'An event']),
      other: { enabled: true, label: 'Somewhere else (please specify)' },
    }),
  },
  {
    label: 'Rate several things',
    make: () => makeQuestion('matrix', {
      title: 'How would you rate the following?',
      rows: choices(['Quality', 'Value for money', 'Customer support']),
      columns: preset('quality5').map((l, i) => ({ ...makeChoice(l), weight: i + 1 })),
    }),
  },
  { label: 'Open feedback', make: () => makeQuestion('textarea', { title: 'Is there anything else you would like to tell us?' }) },
  {
    label: 'Consent',
    // Saying no ends the survey there: nobody answers without agreeing.
    make: () => {
      const options = choices(['Yes, I agree', 'No, I do not agree']);
      return makeQuestion('single', { title: 'Do you agree to take part in this survey?', required: true, choices: options, logic: { [options[1].id]: { type: 'end' } } });
    },
  },
];

/* ---- Small builders ---- */

function section(title, ...children) {
  const id = domId('sec');
  return h('section', { class: 'panel-sec', 'aria-labelledby': id }, h('h3', { id }, title), children);
}

function switchRow(label, checked, onChange, fk, hint) {
  const id = domId('sw');
  return h('label', { class: 'switch', for: id },
    h('span', null, label, hint ? h('span', { class: 'field-hint block' }, hint) : null),
    h('input', { type: 'checkbox', role: 'switch', id, checked, 'data-fk': fk, onchange: (e) => onChange(e.target.checked) }));
}

function seg(label, value, options, onPick, fk) {
  return h('div', { class: 'field' }, h('span', { class: 'field-label', id: `${fk}-l` }, label),
    h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': `${fk}-l` },
      options.map(([v, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), 'data-fk': `${fk}:${v}`, onclick: () => onPick(v) }, l))));
}

function textField(label, value, fk, onValue, { multiline = false, placeholder = '', maxlength = 300 } = {}) {
  const id = domId('tf');
  const control = multiline
    ? h('textarea', { class: 'textarea', id, rows: 3, maxlength, placeholder, 'data-fk': fk, oninput: (e) => onValue(e.target.value) })
    : h('input', { class: 'input', id, value, maxlength, placeholder, 'data-fk': fk, oninput: (e) => onValue(e.target.value) });
  if (multiline) control.value = value;
  return h('div', { class: 'field' }, h('label', { for: id }, label), control);
}

/**
 * The thank-you redirect, saying right away when the text is not a link
 * respondents can be sent to (one without https://, or with a space), which
 * would otherwise be dropped without a word.
 */
function redirectField(value, onValue) {
  const field = textField('Then send respondents to (optional)', value, 'ty-redirect', (v) => {
    onValue(v);
    check(v);
  }, { placeholder: 'https://example.com', maxlength: 2000 });
  const input = field.querySelector('input');
  const hint = h('p', { class: 'field-hint', id: domId('hint') }, 'Links must start with https:// or http://.');
  input.setAttribute('aria-describedby', hint.id);
  const check = (v) => {
    const bad = !!v.trim() && !safeHttpUrl(v);
    input.setAttribute('aria-invalid', String(bad));
    hint.classList.toggle('field-error', bad);
    hint.textContent = bad ? 'This is not a full link, so respondents will not be sent there. Start it with https://.' : 'Links must start with https:// or http://.';
  };
  check(value || '');
  field.append(hint);
  return field;
}

/* ---- Contrast (WCAG relative luminance) ---- */

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => v / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
}

export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/* ---- Logo: downscale uploads so the survey stays small ---- */

async function logoDataUrl(file) {
  if (file.type === 'image/svg+xml') {
    if (file.size > 120_000) throw new Error('svg too large');
    const text = await file.text();
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 480 / bitmap.width, 160 / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let url = canvas.toDataURL('image/png');
  if (url.length > 150_000) url = canvas.toDataURL('image/webp', 0.85);
  if (url.length > 150_000) url = canvas.toDataURL('image/jpeg', 0.8);
  if (url.length > 190_000) throw new Error('too large');
  return url;
}

/* ---- Panels ---- */

function buildPanel({ actions }) {
  const types = h('div', { class: 'type-grid' }, QUESTION_TYPES.map((t) => {
    const b = h('button', { type: 'button', class: 'type-item', draggable: 'true', title: t.hint, onclick: () => actions.addQuestion(t.type) },
      h('span', { class: 'type-icon' }, icon(t.icon, { size: 16 })), h('span', { class: 'type-label' }, t.label));
    b.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-qtype', t.type);
      e.dataTransfer.effectAllowed = 'copy';
    });
    return b;
  }));
  return [
    section('Add a question',
      h('p', { class: 'field-hint' }, 'Click to add after the selected question, or drag onto a page.'),
      types),
    section('Starter questions',
      h('p', { class: 'field-hint' }, 'Common questions, ready to edit.'),
      h('div', { class: 'starter-list' }, STARTERS.map((s) => h('button', { type: 'button', class: 'starter-q', onclick: () => actions.insertQuestion(s.make()) }, icon('plus', { size: 14 }), s.label)))),
    section('Paste questions',
      h('p', { class: 'field-hint' }, 'Turn a list of questions and answers into survey questions in one go.'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => actions.pasteQuestions() }, icon('clipboard', { size: 14 }), 'Paste a list')),
  ];
}

function stylePanel({ session, focus }) {
  const s = session.survey;
  const t = s.theme;
  // Color pickers coalesce and skip redraws while dragging; everything
  // else redraws so the panel shows the new state.
  const setTheme = (p, coalesce) => session.apply((x) => edit.setTheme(x, p), coalesce ? { origin: 'panel', coalesce } : {});

  const presets = h('div', { class: 'preset-grid', role: 'radiogroup', 'aria-label': 'Theme presets' }, THEME_PRESETS.map((p) =>
    h('button', {
      type: 'button',
      role: 'radio',
      class: 'preset',
      'aria-checked': String(t.preset === p.id),
      'data-fk': `preset:${p.id}`,
      style: { '--p-bg': p.background, '--p-surface': p.surface, '--p-accent': p.accent, '--p-text': p.text },
      onclick: () => session.apply((x) => edit.setTheme(x, { preset: p.id, accent: p.accent, background: p.background, surface: p.surface, text: p.text, font: p.font })),
    }, h('span', { class: 'preset-swatch', 'aria-hidden': 'true' }, h('span', { class: 'preset-card' }, h('span', { class: 'preset-line' }), h('span', { class: 'preset-dot' }))), h('span', { class: 'preset-name' }, p.name))));

  const colorRow = (key, label) => {
    const id = domId('c');
    return h('div', { class: 'color-row' },
      h('label', { for: id }, label),
      h('input', { type: 'color', id, value: t[key], 'data-fk': `color:${key}`, oninput: (e) => setTheme({ [key]: e.target.value, preset: 'custom' }, `color:${key}`), onchange: () => rerender() }),
      h('code', null, t[key]));
  };
  const textOnSurface = contrast(t.text, t.surface);
  const textOnBg = contrast(t.text, t.background);
  const accentOnSurface = contrast(t.accent, t.surface);
  const warnings = [];
  if (textOnSurface < 4.5) warnings.push(`Text on the question area has low contrast (${textOnSurface.toFixed(1)}:1, aim for 4.5:1).`);
  if (textOnBg < 4.5) warnings.push(`Text on the background has low contrast (${textOnBg.toFixed(1)}:1).`);
  if (accentOnSurface < 3) warnings.push(`The accent color is hard to see on the question area (${accentOnSurface.toFixed(1)}:1, aim for 3:1).`);

  // Opened from the Upload button, never focused itself: focus stays on the
  // button through the redraw, and the page does not scroll to the input.
  const fileInput = h('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml',
    hidden: true,
    onchange: async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        setTheme({ logo: await logoDataUrl(file) });
      } catch (err) {
        // Pictures of any size are scaled down; only an SVG has a limit.
        toastError(
          String(err && err.message) === 'svg too large'
            ? 'That SVG is too large (over 120 KB). Try a simpler SVG, or a PNG or JPEG.'
            : 'That image could not be used. Try a PNG, JPEG, WebP or SVG file.',
        );
      }
    },
  });
  let rerender = () => {};
  const node = h('div', null,
    section('Theme', presets),
    section('Colors',
      colorRow('accent', 'Accent'),
      colorRow('background', 'Background'),
      colorRow('surface', 'Question area'),
      colorRow('text', 'Text'),
      h('div', { class: 'contrast-preview', style: { background: t.surface, color: t.text, borderColor: t.background } },
        h('span', null, 'Sample text'), h('span', { class: 'contrast-btn', style: { background: t.accent, color: readableOn(t.accent) } }, 'Button')),
      warnings.length ? h('div', { class: 'banner banner-warn small', role: 'note' }, icon('alert', { size: 14 }), h('div', null, warnings.map((w) => h('p', null, w)))) : null),
    section('Text and shapes',
      h('div', { class: 'field' }, h('label', { for: 'font-sel' }, 'Font'),
        h('select', { class: 'select', id: 'font-sel', 'data-fk': 'font', onchange: (e) => setTheme({ font: e.target.value }) },
          FONTS.map((f) => h('option', { value: f.id, selected: f.id === t.font }, f.label)))),
      seg('Corners', t.radius, [['sharp', 'Square'], ['soft', 'Soft'], ['round', 'Round']], (v) => setTheme({ radius: v }), 'radius'),
      seg('Answer choices', t.answerStyle, [['classic', 'Classic'], ['tiles', 'Boxes']], (v) => setTheme({ answerStyle: v }), 'answers')),
    section('Logo',
      t.logo ? h('div', { class: `logo-preview logo-${t.logoAlign}` }, h('img', { src: t.logo, alt: 'Current logo' })) : h('p', { class: 'field-hint' }, 'Shown above the survey title. PNG, JPEG, WebP or SVG.'),
      h('div', { class: 'field-row' },
        fileInput,
        h('button', { type: 'button', class: 'btn btn-sm', 'data-fk': 'logo-upload', onclick: () => fileInput.click() }, icon('upload', { size: 14 }), t.logo ? 'Replace' : 'Upload logo'),
        t.logo ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost btn-danger', onclick: () => {
          setTheme({ logo: '' });
          // This button goes with the logo: on to uploading another.
          requestAnimationFrame(() => document.querySelector('[data-fk="logo-upload"]')?.focus());
        } }, 'Remove') : null),
      t.logo ? seg('Position', t.logoAlign, [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], (v) => setTheme({ logoAlign: v }), 'logo-align') : null),
  );
  if (focus === 'logo') requestAnimationFrame(() => node.querySelector('[data-fk="logo-upload"]')?.focus());
  return { node, setRerender: (fn) => (rerender = fn) };
}

function logicPanel({ session, actions }) {
  const s = session.survey;
  const numbers = questionNumbers(s);
  const all = allQuestions(s);
  const pageOptions = (pi, value) => [
    h('option', { value: '', selected: !value }, pi < s.pages.length - 1 ? 'Next page (default)' : 'End of survey (default)'),
    ...s.pages.map((p, i) => (i > pi ? h('option', { value: `page:${p.id}`, selected: value === `page:${p.id}` }, `Page ${i + 1}${p.title ? `: ${p.title.slice(0, 30)}` : ''}`) : null)),
    // The last page ends the survey anyway: one "End of survey" is enough,
    // unless this one is already chosen.
    pi < s.pages.length - 1 || value === 'end' ? h('option', { value: 'end', selected: value === 'end' }, 'End of survey (submit)') : null,
    h('option', { value: 'disqualify', selected: value === 'disqualify' }, 'Disqualify'),
  ];
  const pagesSec = section('Page logic',
    h('p', { class: 'field-hint' }, 'Choose where respondents go after each page. Question skip logic, when it applies, wins.'),
    s.pages.map((p, pi) => {
      const v = !p.logic ? '' : p.logic.type === 'page' ? `page:${p.logic.pageId}` : p.logic.type;
      const id = domId('pl');
      return h('div', { class: 'field' },
        h('label', { for: id }, `After page ${pi + 1}${p.title ? `: ${p.title}` : ''}`),
        h('select', { class: 'select select-sm', id, 'data-fk': `pl:${p.id}`, onchange: (e) => {
          const val = e.target.value;
          const logic = !val ? null : val.startsWith('page:') ? { type: 'page', pageId: val.slice(5) } : { type: val };
          session.apply((x) => edit.updatePage(x, p.id, { logic }));
        } }, pageOptions(pi, v)));
    }));
  const rules = all.filter((q) => q.logic || q.display);
  const label = (q, cid) => {
    if (cid === OTHER_ID) return (q.other && q.other.label) || 'Other';
    if (cid === NONE_ID) return (q.none && q.none.label) || 'None of the above';
    const c = (q.choices || []).find((x) => x.id === cid);
    return c ? c.label : 'a removed answer';
  };
  const target = (t) => (t.type === 'end' ? 'end of survey' : t.type === 'disqualify' ? 'disqualify' : `page ${s.pages.findIndex((p) => p.id === t.pageId) + 1}`);
  const rulesSec = section('Question rules',
    rules.length
      ? h('ul', { class: 'rule-list' }, rules.map((q) => h('li', null,
          h('button', { type: 'button', class: 'rule-q', onclick: () => actions.edit(q.id, q.logic ? 'logic' : 'options') },
            h('strong', null, isAnswerable(q) ? `Q${numbers[q.id]}` : 'Text'), ` ${q.title || 'Untitled'}`),
          q.logic ? h('ul', null, Object.entries(q.logic).map(([cid, t]) => h('li', null, `“${label(q, cid)}” goes to ${target(t)}`))) : null,
          q.display ? h('p', { class: 'field-hint' }, 'Has a display condition') : null)))
      : h('p', { class: 'field-hint' }, 'No rules yet. Open a multiple choice, checkbox or dropdown question and use its Logic tab, or add a display condition in a question’s Options.'),
    h('div', { class: 'field-hint' }, (() => {
      const n = all.filter((q) => LOGIC_TYPES.includes(q.type)).length;
      return n === 1 ? '1 question can carry skip logic.' : `${n} questions can carry skip logic.`;
    })()));
  const shuffleSec = section('Question order',
    s.pages.map((p, pi) => switchRow(`Shuffle questions on page ${pi + 1}`, p.randomize, (v) => session.apply((x) => edit.updatePage(x, p.id, { randomize: v }), { origin: 'panel' }), `rnd:${p.id}`)));
  return [pagesSec, rulesSec, shuffleSec];
}

function optionsPanel({ session }) {
  const o = session.survey.options;
  const setOpt = (p, opts = {}) => session.apply((x) => edit.setOptions(x, p), opts);
  const typed = (key) => ({ origin: 'input', coalesce: `opt:${key}` });
  return [
    section('Format',
      seg('Show', o.format, [['classic', 'All on a page'], ['focus', 'One at a time']], (v) => setOpt({ format: v }), 'format'),
      seg('Progress bar', o.progressBar, [['top', 'Top'], ['bottom', 'Bottom'], ['off', 'Off']], (v) => setOpt({ progressBar: v }), 'progress')),
    section('Display',
      switchRow('Number the questions', o.numbering, (v) => setOpt({ numbering: v }), 'numbering'),
      switchRow('Mark required questions with *', o.requiredMark, (v) => setOpt({ requiredMark: v }), 'requiredMark'),
      switchRow('Show page titles', o.pageTitles, (v) => setOpt({ pageTitles: v }), 'pageTitles'),
      switchRow('Let respondents go back', o.allowBack, (v) => setOpt({ allowBack: v }), 'allowBack')),
    section('Button labels',
      h('div', { class: 'grid3' },
        textField('Back', o.buttons.prev, 'btn-prev', (v) => setOpt({ buttons: { ...session.survey.options.buttons, prev: v } }, typed('prev')), { maxlength: 40 }),
        textField('Next', o.buttons.next, 'btn-next', (v) => setOpt({ buttons: { ...session.survey.options.buttons, next: v } }, typed('next')), { maxlength: 40 }),
        textField('Finish', o.buttons.done, 'btn-done', (v) => setOpt({ buttons: { ...session.survey.options.buttons, done: v } }, typed('done')), { maxlength: 40 }))),
    section('Thank-you screen',
      textField('Title', o.thankYou.title, 'ty-title', (v) => setOpt({ thankYou: { ...session.survey.options.thankYou, title: v } }, typed('tyt'))),
      textField('Message', o.thankYou.message, 'ty-msg', (v) => setOpt({ thankYou: { ...session.survey.options.thankYou, message: v } }, typed('tym')), { multiline: true, maxlength: 3000 }),
      redirectField(o.thankYou.redirect, (v) => setOpt({ thankYou: { ...session.survey.options.thankYou, redirect: v.trim() } }, typed('tyr')))),
    section('Disqualified screen',
      h('p', { class: 'field-hint' }, 'Shown when skip logic disqualifies a respondent.'),
      textField('Title', o.disqualify.title, 'dq-title', (v) => setOpt({ disqualify: { ...session.survey.options.disqualify, title: v } }, typed('dqt'))),
      textField('Message', o.disqualify.message, 'dq-msg', (v) => setOpt({ disqualify: { ...session.survey.options.disqualify, message: v } }, typed('dqm')), { multiline: true, maxlength: 3000 })),
    section('Closed survey',
      textField('Message when the survey is closed', o.closedMessage, 'closed-msg', (v) => setOpt({ closedMessage: v }, typed('closed')), { multiline: true, maxlength: 1000 })),
  ];
}

export const PANELS = [
  { id: 'build', label: 'Build', icon: 'plus' },
  { id: 'style', label: 'Style', icon: 'palette' },
  { id: 'logic', label: 'Logic', icon: 'logic' },
  { id: 'options', label: 'Options', icon: 'settings' },
];

/**
 * A panel host: render(kind) draws the panel; refresh(change) redraws it
 * after outside edits, keeping focus on the same control.
 */
export function createPanelHost({ session, actions }) {
  const node = h('div', { class: 'panel-body scroll' });
  let kind = null;
  let focus = null;

  function draw() {
    const active = document.activeElement;
    const fk = active && node.contains(active) ? active.dataset.fk : null;
    let content;
    if (kind === 'build') content = buildPanel({ actions });
    else if (kind === 'style') {
      const r = stylePanel({ session, focus });
      r.setRerender(draw);
      content = r.node;
    } else if (kind === 'logic') content = logicPanel({ session, actions });
    else if (kind === 'options') content = optionsPanel({ session });
    focus = null;
    const scroll = node.scrollTop;
    replace(node, content);
    node.scrollTop = scroll;
    if (fk) node.querySelector(`[data-fk="${CSS.escape(fk)}"]`)?.focus();
  }

  return {
    node,
    get kind() {
      return kind;
    },
    show(k, focusTarget = null) {
      kind = k;
      focus = focusTarget;
      node.scrollTop = 0;
      draw();
    },
    refresh(change = {}) {
      if (!kind || kind === 'build') return;
      if (change.origin === 'input' || change.origin === 'panel') return;
      draw();
    },
  };
}
