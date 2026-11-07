/**
 * Collect: publish the survey and manage its share links ("collectors").
 *
 * A survey can have several links, each with its own settings (open or
 * closed, close date, response limit, password, thank-you screen), so the
 * creator can tell audiences apart in the results. Every change goes to the
 * collector worker first and to the creator's own storage second: if the
 * worker call fails nothing changes locally, and the screen never claims a
 * setting respondents do not actually get.
 */
import '../styles/collect.css';
import { h, replace, announce, domId, scrollMotion } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { openDialog, confirmDialog, toast, toastError } from '../lib/ui.js';
import { fmtDate, fmtDateTime, fmtNum, copyText, downloadText, downloadBlob, slugify } from '../lib/format.js';
import { qrSvg, qrPngBlob } from '../lib/qr.js';
import { labelOf } from '../data/collector-client.js';
import { publishSurvey, hasUnpublishedChanges, isPublished, syncStatus } from '../data/publish.js';
import {
  newCollector,
  nextLinkName,
  workerPayload,
  linkState,
  LINK_STATE,
  toLocalInput,
  validateSettings,
  embedSnippet,
  mailtoLink,
  lintSurvey,
  errorMessage,
} from './collect/logic.js';

export async function mount(container, ctx) {
  const { app, session, sid, frame } = ctx;
  const root = h('div', { class: 'collect scroll' });
  container.append(root);

  let collectors = {};
  let counts = {};
  let cfg = null;
  let selected = null;
  let busy = null; // { step, error } while creating the first link
  let formDirty = false;
  let alive = true;
  const cleanups = [];
  // Leaving this screen (another step, Home, Back) asks before dropping
  // unsaved link settings, as switching links does.
  cleanups.push(app.setLeaveGuard({ dirty: () => formDirty, title: 'Discard changes?', message: 'You have unsaved changes to this link’s settings.' }));

  frame.setActions(
    h('button', {
      type: 'button',
      class: 'btn btn-ghost hide-narrow',
      onclick: async () => {
        const { openPreview } = await import('./preview.js');
        openPreview(session.survey);
      },
    }, icon('eye'), 'Preview'),
  );

  /* ---- Data ---- */

  const sorted = () => Object.values(collectors).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  async function link(c) {
    if (!cfg) cfg = await app.client.peek();
    if (!cfg) return '';
    return app.shareUrl(cfg.label || labelOf(cfg.name), c.id);
  }

  async function loadCounts() {
    if (!cfg) return;
    try {
      const stats = await app.client.stats();
      if (!alive) return;
      counts = stats.collectors || {};
      for (const el of root.querySelectorAll('[data-count]')) {
        const n = counts[el.dataset.count] || 0;
        el.textContent = el.dataset.long ? `${fmtNum(n)} ${n === 1 ? 'response' : 'responses'}` : fmtNum(n);
      }
      for (const el of root.querySelectorAll('[data-state]')) {
        const c = collectors[el.dataset.state];
        if (c) paintChip(el, c);
      }
    } catch {
      /* counts stay unknown; the rest of the screen still works */
    }
  }

  /** Save a collector: worker first, then the creator's storage. */
  async function persist(next, prev) {
    await app.client.saveCollector(workerPayload(next, prev));
    await app.repo.saveCollector(sid, next);
    collectors = { ...collectors, [next.id]: next };
    await syncStatus(app, session, collectors).catch(() => {});
    frame.renderChip();
  }

  /* ---- Publishing ---- */

  /** If the survey has problems respondents would trip over, ask first. */
  function confirmLint() {
    const issues = lintSurvey(session.survey);
    if (!issues.length) return Promise.resolve(true);
    return openDialog({
      title: 'Some questions need attention',
      build: (close) => ({
        body: h(
          'div',
          { class: 'lint' },
          h('p', { class: 'muted' }, 'Respondents will see these questions as they are. You can fix them first, or publish anyway.'),
          h(
            'ul',
            { class: 'lint-list' },
            issues.map((it) =>
              h('li', null, h('strong', null, it.label), it.title ? h('span', { class: 'lint-title' }, ` ${it.title}`) : null,
                h('ul', null, it.issues.map((m) => h('li', null, m)))),
            ),
          ),
        ),
        foot: [
          h('a', { class: 'btn', href: `#/s/${sid}/design`, onclick: () => close(false) }, 'Review in Design'),
          h('button', { type: 'button', class: 'btn btn-primary', autofocus: true, onclick: () => close(true) }, 'Publish anyway'),
        ],
      }),
    }).then((v) => v === true);
  }

  async function publishChanges(btn) {
    if (!(await confirmLint())) return;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Publishing…';
    }
    try {
      await publishSurvey(app, session);
      toast('Changes published. Respondents now see the latest version.');
    } catch (err) {
      toastError(errorMessage(err));
    }
    renderLiveBar();
  }

  /** Create a link, setting up the collector and publishing as needed. */
  async function createLink() {
    // Adding a link shows it in place of the one being edited.
    if (formDirty) {
      const ok = await confirmDialog({ title: 'Discard changes?', message: 'You have unsaved changes to this link’s settings.', confirm: 'Discard', danger: true });
      if (!ok) return;
      formDirty = false;
    }
    // Only a survey that was never published goes live here: adding another
    // link must not quietly publish edits the creator has not released.
    const mustPublish = !isPublished(session.meta);
    const first = !sorted().length;
    if (mustPublish && !(await confirmLint())) return;
    busy = { step: 0, error: '' };
    await renderAll();
    const stopStatus = app.onWorkerStatus((s) => {
      if (busy && (s === 'deploying' || s === 'updating')) setStep(0);
    });
    try {
      setStep(0);
      cfg = await app.client.ensureWorker();
      if (mustPublish) {
        setStep(1);
        await publishSurvey(app, session);
      }
      setStep(2);
      const c = newCollector(sid, nextLinkName(collectors));
      await persist(c, null);
      busy = null;
      selected = c.id;
      formDirty = false;
      await renderAll();
      announce(`${c.name} created`);
      root.querySelector('.cd-title')?.focus();
    } catch (err) {
      console.error(err);
      if (busy && first) {
        busy.error = errorMessage(err);
        await renderAll();
        root.querySelector('.collect-start .btn-primary')?.focus();
      } else {
        busy = null;
        await renderAll();
        toastError(errorMessage(err));
      }
    } finally {
      stopStatus();
    }
  }

  function setStep(i) {
    if (!busy) return;
    busy.step = i;
    const steps = root.querySelectorAll('.start-steps li');
    steps.forEach((li, k) => {
      li.dataset.state = k < i ? 'done' : k === i ? 'active' : 'todo';
    });
  }

  /* ---- Rendering: first-time card ---- */

  const STEPS = ['Setting up your response collector', 'Publishing your survey', 'Creating your link'];

  function renderStart() {
    const working = busy && !busy.error;
    return h(
      'section',
      { class: 'collect-start', 'aria-labelledby': 'start-title' },
      h('div', { class: 'start-icon' }, icon('link', { size: 24 })),
      h('h2', { id: 'start-title' }, 'Share your survey'),
      h(
        'p',
        { class: 'muted' },
        'Create a link to send by email, post anywhere, or embed in a website. Anyone with the link can answer, no account needed, and responses come straight back to your Puter account.',
      ),
      !cfg
        ? h('p', { class: 'start-note' }, icon('info', { size: 14 }),
            'The first time, a small response collector is set up in your Puter account. This can take up to 30 seconds.')
        : null,
      working
        ? h(
            'ol',
            { class: 'start-steps', 'aria-live': 'polite' },
            STEPS.map((s, k) =>
              h('li', { 'data-state': k < busy.step ? 'done' : k === busy.step ? 'active' : 'todo' },
                h('span', { class: 'step-mark', 'aria-hidden': 'true' }, h('span', { class: 'spinner' }), icon('check', { size: 14 })),
                h('span', null, s)),
            ),
          )
        : null,
      busy && busy.error
        ? h('div', { class: 'banner banner-error', role: 'alert' }, icon('alert'),
            h('span', { class: 'grow' }, busy.error,
              /verify the email/i.test(busy.error) ? [' ', h('a', { href: 'https://puter.com', target: '_blank', rel: 'noopener' }, 'Open Puter')] : null))
        : null,
      h(
        'button',
        { type: 'button', class: 'btn btn-primary btn-lg', disabled: working, 'aria-busy': working ? 'true' : undefined, onclick: () => createLink() },
        working ? 'Working…' : busy && busy.error ? 'Try again' : [icon('link'), 'Create a share link'],
      ),
    );
  }

  /* ---- Rendering: live version bar ---- */

  const liveHost = h('div', { class: 'collect-live' });

  function renderLiveBar() {
    if (!isPublished(session.meta)) {
      replace(liveHost);
      return;
    }
    const when = fmtDateTime(session.meta.publishedAt);
    if (hasUnpublishedChanges(session)) {
      const btn = h('button', { type: 'button', class: 'btn btn-sm btn-primary' }, 'Publish changes');
      btn.addEventListener('click', () => publishChanges(btn));
      replace(
        liveHost,
        h('div', { class: 'banner banner-warn', role: 'status' }, icon('alert'),
          h('span', { class: 'grow' }, `You edited the survey after publishing. Respondents still see the version from ${when}.`), btn),
      );
    } else {
      replace(liveHost, h('div', { class: 'banner', role: 'status' }, icon('globe'), h('span', { class: 'grow' }, `Live. Respondents see the version published ${when}.`)));
    }
  }

  /* ---- Rendering: list ---- */

  function paintChip(el, c) {
    const st = LINK_STATE[linkState(c, counts[c.id] || 0)];
    el.className = `chip ${st.chip}`;
    el.textContent = st.label;
  }

  function chipFor(c) {
    const el = h('span', { 'data-state': c.id });
    paintChip(el, c);
    return el;
  }

  async function select(id) {
    if (id === selected) return;
    if (formDirty) {
      const ok = await confirmDialog({ title: 'Discard changes?', message: 'You have unsaved changes to this link’s settings.', confirm: 'Discard', danger: true });
      if (!ok) return;
    }
    selected = id;
    formDirty = false;
    await renderAll();
    const title = root.querySelector('.cd-title');
    if (title) {
      title.focus({ preventScroll: true });
      if (window.matchMedia('(max-width: 860px)').matches) title.scrollIntoView({ block: 'start', behavior: scrollMotion() });
    }
  }

  function renderList() {
    const list = sorted();
    return h(
      'section',
      { class: 'cl', 'aria-labelledby': 'cl-title' },
      h('div', { class: 'cl-head' }, h('h2', { id: 'cl-title' }, 'Share links'),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => createLink(), disabled: !!busy }, icon('plus'), 'Add link')),
      h(
        'ul',
        { class: 'cl-list' },
        list.map((c) =>
          h(
            'li',
            null,
            h(
              'button',
              { type: 'button', class: 'cl-item', 'aria-current': c.id === selected ? 'true' : undefined, onclick: () => select(c.id) },
              h('span', { class: 'cl-icon' }, icon(c.password ? 'lock' : 'link', { size: 16 })),
              h('span', { class: 'cl-main' }, h('span', { class: 'cl-name' }, c.name),
                h('span', { class: 'cl-sub' }, `Created ${fmtDate(c.createdAt)}`)),
              h('span', { class: 'cl-side' }, chipFor(c),
                h('span', { class: 'cl-count', 'data-count': c.id, 'data-long': '1' }, cfg ? `${fmtNum(counts[c.id] || 0)} ${(counts[c.id] || 0) === 1 ? 'response' : 'responses'}` : '')),
            ),
          ),
        ),
      ),
    );
  }

  /* ---- Rendering: detail ---- */

  function field(label, control, { hint = '', id, error = '' } = {}) {
    const errId = `${id}-err`;
    const hintId = `${id}-hint`;
    control.id = id;
    const described = [hint ? hintId : '', errId].filter(Boolean).join(' ');
    control.setAttribute('aria-describedby', described);
    return h('div', { class: 'field' }, h('label', { for: id }, label), control,
      hint ? h('p', { class: 'field-hint', id: hintId }, hint) : null,
      h('p', { class: 'field-error', id: errId, 'data-error-for': id, hidden: !error }, error));
  }

  function switchRow(label, checked, { hint = '', onchange } = {}) {
    const input = h('input', { type: 'checkbox', role: 'switch', checked });
    if (onchange) input.addEventListener('change', onchange);
    const hintId = hint ? domId('hint') : null;
    if (hintId) input.setAttribute('aria-describedby', hintId);
    return {
      input,
      node: h('div', { class: 'switch-block' }, h('label', { class: 'switch' }, h('span', null, label), input),
        hint ? h('p', { class: 'field-hint', id: hintId }, hint) : null),
    };
  }

  function renderDetail(c, url) {
    const count = counts[c.id] || 0;
    const titleId = domId('cd');

    /* Share */
    const linkInput = h('input', { class: 'input cd-link', readonly: true, value: url, 'aria-label': 'Share link', onfocus: (e) => e.target.select() });
    const copyBtn = h('button', { type: 'button', class: 'btn btn-primary' }, icon('copy'), 'Copy link');
    copyBtn.addEventListener('click', async () => {
      if (await copyText(url)) {
        announce('Link copied');
        replace(copyBtn, icon('check'), 'Copied');
        setTimeout(() => copyBtn.isConnected && replace(copyBtn, icon('copy'), 'Copy link'), 1600);
      } else toastError('Could not copy. Select the link and copy it yourself.');
    });
    const share = h(
      'section',
      { class: 'cd-card', 'aria-labelledby': `${titleId}-share` },
      h('h3', { id: `${titleId}-share` }, 'Share'),
      h('div', { class: 'cd-linkrow' }, linkInput, copyBtn,
        h('a', { class: 'btn btn-icon', href: url, target: '_blank', rel: 'noopener', 'aria-label': 'Open the survey in a new tab', title: 'Open' }, icon('external'))),
      h(
        'div',
        { class: 'cd-ways' },
        h('button', { type: 'button', class: 'btn', onclick: () => qrDialog(c, url) }, icon('qr'), 'QR code'),
        h('button', { type: 'button', class: 'btn', onclick: () => embedDialog(c) }, icon('code'), 'Embed on a website'),
        h('a', { class: 'btn', href: mailtoLink({ title: session.survey.title, url }) }, icon('send'), 'Send by email'),
      ),
      c.status !== 'open'
        ? h('p', { class: 'field-hint' }, 'This link is closed. People who open it see a message that the survey is not accepting responses.')
        : null,
    );

    /* Settings */
    const form = h('form', { class: 'cd-card cd-form', novalidate: true, 'aria-labelledby': `${titleId}-settings` });
    const nameInput = h('input', { class: 'input', value: c.name, maxlength: '100', autocomplete: 'off' });
    const open = switchRow('Accepting responses', c.status === 'open', { hint: 'Turn off to pause the link without deleting it.' });

    const closeOn = switchRow('Close automatically', !!c.closeAt);
    const closeAt = h('input', { class: 'input', type: 'datetime-local', value: toLocalInput(c.closeAt) });
    const closeWrap = h('div', { class: 'sub-fields', hidden: !c.closeAt }, field('Close on', closeAt, { id: domId('f') }));

    const limitOn = switchRow('Limit the number of responses', c.maxResponses > 0);
    const limit = h('input', { class: 'input', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: c.maxResponses || '' });
    const limitWrap = h('div', { class: 'sub-fields', hidden: !(c.maxResponses > 0) },
      field('Stop after', limit, { id: domId('f'), hint: 'Responses already received count toward the limit.' }));

    const multi = switchRow('Allow more than one response per device', c.allowMultiple !== false, {
      hint: 'When off, a browser that already answered sees a thank-you note instead of the survey. People can still answer again from another browser.',
    });

    const passOn = switchRow('Require a password', !!c.password);
    const pass = h('input', { class: 'input', type: 'password', value: c.password || '', maxlength: '100', autocomplete: 'new-password' });
    const showPass = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-pressed': 'false' }, 'Show');
    showPass.addEventListener('click', () => {
      const on = pass.type === 'password';
      pass.type = on ? 'text' : 'password';
      showPass.setAttribute('aria-pressed', String(on));
      showPass.textContent = on ? 'Hide' : 'Show';
    });
    const passField = field('Password', pass, { id: domId('f'), hint: 'At least 6 characters. Share it with the people you want to answer.' });
    passField.insertBefore(h('div', { class: 'pass-row' }, pass, showPass), passField.querySelector('.field-hint'));
    const passWrap = h('div', { class: 'sub-fields', hidden: !c.password }, passField);

    const ty = c.thankYou || {};
    const tyOn = switchRow('Custom thank-you screen for this link', !!c.thankYou, { hint: 'Replaces the survey’s thank-you screen for people who answer through this link.' });
    const tyTitle = h('input', { class: 'input', value: ty.title || '', maxlength: '300' });
    const tyMessage = h('textarea', { class: 'textarea', maxlength: '3000', rows: '3' });
    tyMessage.value = ty.message || '';
    const tyRedirect = h('input', { class: 'input', type: 'url', value: ty.redirect || '', placeholder: 'https://', inputmode: 'url' });
    const tyWrap = h('div', { class: 'sub-fields', hidden: !c.thankYou },
      field('Title', tyTitle, { id: domId('f') }),
      field('Message', tyMessage, { id: domId('f') }),
      field('Then go to (optional)', tyRedirect, { id: domId('f'), hint: 'Send people to your website a moment after they finish.' }));

    const toggles = [
      [closeOn, closeWrap, closeAt],
      [limitOn, limitWrap, limit],
      [passOn, passWrap, pass],
      [tyOn, tyWrap, tyTitle],
    ];
    for (const [sw, wrap, first] of toggles) {
      sw.input.addEventListener('change', () => {
        wrap.hidden = !sw.input.checked;
        if (sw.input.checked) first.focus();
      });
    }

    const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save settings');
    const resetBtn = h('button', { type: 'button', class: 'btn btn-ghost', hidden: true }, 'Discard changes');
    const markDirty = () => {
      formDirty = true;
      resetBtn.hidden = false;
    };
    form.addEventListener('input', markDirty);
    form.addEventListener('change', markDirty);
    resetBtn.addEventListener('click', async () => {
      formDirty = false;
      await renderAll();
      root.querySelector('.cd-form input')?.focus();
    });

    const ids = {
      name: nameInput,
      closeAt,
      maxResponses: limit,
      password: pass,
      tyTitle,
      tyRedirect,
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { errors, value } = validateSettings(c, {
        name: nameInput.value,
        open: open.input.checked,
        closeOn: closeOn.input.checked,
        closeAt: closeAt.value,
        limitOn: limitOn.input.checked,
        maxResponses: limit.value,
        allowMultiple: multi.input.checked,
        passwordOn: passOn.input.checked,
        password: pass.value,
        thankYouOn: tyOn.input.checked,
        tyTitle: tyTitle.value,
        tyMessage: tyMessage.value,
        tyRedirect: tyRedirect.value,
      });
      for (const [key, input] of Object.entries(ids)) {
        const msg = errors[key] || '';
        input.setAttribute('aria-invalid', msg ? 'true' : 'false');
        const box = form.querySelector(`[data-error-for="${input.id}"]`);
        if (box) {
          box.textContent = msg;
          box.hidden = !msg;
        }
      }
      const firstBad = Object.keys(errors)[0];
      if (firstBad) {
        ids[firstBad].focus();
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        await persist(value, c);
        formDirty = false;
        toast('Link settings saved');
        await renderAll();
        root.querySelector('.cd-form .btn-primary')?.focus();
      } catch (err) {
        console.error(err);
        toastError(errorMessage(err));
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save settings';
      }
    });

    append(form,
      h('h3', { id: `${titleId}-settings` }, 'Settings'),
      field('Link name', nameInput, { id: domId('f'), hint: 'Only you see this. Use it to tell links apart in your results.' }),
      open.node,
      h('div', { class: 'divider' }),
      closeOn.node, closeWrap,
      limitOn.node, limitWrap,
      multi.node,
      passOn.node, passWrap,
      tyOn.node, tyWrap,
      h('div', { class: 'cd-actions' }, resetBtn, saveBtn),
    );

    /* Danger zone */
    const danger = h(
      'section',
      { class: 'cd-card cd-danger', 'aria-labelledby': `${titleId}-del` },
      h('h3', { id: `${titleId}-del` }, 'Delete this link'),
      h('p', { class: 'muted' }, 'The link stops working right away. Responses already collected through it are kept.'),
      h('div', null, h('button', { type: 'button', class: 'btn btn-danger', onclick: () => removeLink(c) }, icon('trash'), 'Delete link')),
    );

    // A link past its close date has ended: reopening it means dropping
    // that date, or it would stay ended.
    const ended = c.status === 'open' && c.closeAt && Date.now() >= c.closeAt;
    const live = c.status === 'open' && !ended;
    const toggleBtn = h('button', { type: 'button', class: 'btn btn-sm' }, live ? 'Close link' : 'Reopen link');
    toggleBtn.addEventListener('click', async () => {
      if (formDirty) {
        const ok = await confirmDialog({ title: 'Discard changes?', message: 'Your unsaved settings will be lost.', confirm: 'Discard', danger: true });
        if (!ok) return;
      }
      toggleBtn.disabled = true;
      const pastClose = !!c.closeAt && Date.now() >= c.closeAt;
      try {
        await persist(live ? { ...c, status: 'closed' } : { ...c, status: 'open', closeAt: pastClose ? null : c.closeAt }, c);
        formDirty = false;
        toast(live ? 'Link closed' : pastClose ? 'Link reopened. Its close date has passed, so it no longer closes automatically.' : 'Link reopened');
        await renderAll();
        root.querySelector('.cd-head .btn')?.focus();
      } catch (err) {
        toastError(errorMessage(err));
        toggleBtn.disabled = false;
      }
    });

    return h(
      'section',
      { class: 'cd', 'aria-labelledby': titleId },
      h('div', { class: 'cd-head' },
        h('div', { class: 'cd-headings' },
          h('h2', { class: 'cd-title', id: titleId, tabindex: '-1' }, c.name),
          h('p', { class: 'cd-meta' }, chipFor(c),
            h('span', { 'data-count': c.id, 'data-long': '1' }, `${fmtNum(count)} ${count === 1 ? 'response' : 'responses'}`),
            c.closeAt ? h('span', null, icon('clock', { size: 12 }), `${Date.now() >= c.closeAt ? 'Closed' : 'Closes'} ${fmtDateTime(c.closeAt)}`) : null,
            c.maxResponses ? h('span', null, `Limit ${fmtNum(c.maxResponses)}`) : null,
            c.password ? h('span', null, icon('lock', { size: 12 }), 'Password') : null)),
        toggleBtn),
      share,
      form,
      danger,
    );
  }

  function append(el, ...kids) {
    for (const k of kids) if (k) el.append(k);
    return el;
  }

  async function removeLink(c) {
    const ok = await confirmDialog({
      title: `Delete “${c.name}”?`,
      message: 'Anyone who opens this link will be told the survey was not found. Responses already collected through it stay in your results.',
      confirm: 'Delete link',
      danger: true,
    });
    if (!ok) return;
    try {
      await app.client.deleteCollector(c.id);
      await app.repo.removeCollector(sid, c.id);
      const next = { ...collectors };
      delete next[c.id];
      collectors = next;
      await syncStatus(app, session, collectors).catch(() => {});
      frame.renderChip();
      const rest = sorted();
      selected = rest.length ? rest[rest.length - 1].id : null;
      formDirty = false;
      await renderAll();
      announce(`${c.name} deleted`);
      (root.querySelector('.cl-item[aria-current="true"]') || root.querySelector('.collect-start .btn-primary'))?.focus();
    } catch (err) {
      toastError(errorMessage(err));
    }
  }

  /* ---- Dialogs ---- */

  function qrDialog(c, url) {
    const file = `${slugify(session.survey.title)}-${slugify(c.name, 'link')}-qr`;
    openDialog({
      title: 'QR code',
      build: (close) => {
        const art = h('div', { class: 'qr-art' });
        // Generated locally from our own encoder output: safe markup.
        art.innerHTML = qrSvg(url, { title: `QR code for ${c.name}` });
        return {
          body: h('div', { class: 'qr-body' }, art,
            h('p', { class: 'muted' }, 'People can scan this with a phone camera to open the survey. Print it on flyers, posters or slides.')),
          foot: [
            h('button', { type: 'button', class: 'btn', onclick: () => downloadText(`${file}.svg`, qrSvg(url), 'image/svg+xml') }, icon('download'), 'SVG'),
            h('button', {
              type: 'button',
              class: 'btn btn-primary',
              onclick: async () => {
                try {
                  downloadBlob(`${file}.png`, await qrPngBlob(url, 1024));
                } catch {
                  toastError('Could not create the image.');
                }
              },
            }, icon('download'), 'PNG'),
            h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, 'Done'),
          ],
        };
      },
    });
  }

  function embedDialog(c) {
    if (!cfg) return;
    const url = app.shareUrl(cfg.label || labelOf(cfg.name), c.id, { embed: true });
    const code = embedSnippet(url, session.survey.title);
    openDialog({
      title: 'Embed on a website',
      wide: true,
      build: (close) => {
        const ta = h('textarea', { class: 'textarea embed-code', readonly: true, rows: '10', 'aria-label': 'Embed code', spellcheck: 'false' });
        ta.value = code;
        ta.addEventListener('focus', () => ta.select());
        const copy = h('button', { type: 'button', class: 'btn btn-primary' }, icon('copy'), 'Copy code');
        copy.addEventListener('click', async () => {
          if (await copyText(code)) {
            announce('Embed code copied');
            replace(copy, icon('check'), 'Copied');
          } else toastError('Could not copy. Select the code and copy it yourself.');
        });
        return {
          body: h('div', { class: 'embed-body' },
            h('p', { class: 'muted' }, 'Paste this into your page’s HTML. The survey appears in a frame that grows to fit it. Responses through the embed count toward this link.'),
            ta),
          foot: [h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, 'Done'), copy],
        };
      },
    });
  }

  /* ---- Whole screen ---- */

  async function renderAll() {
    const list = sorted();
    if (selected && !collectors[selected]) selected = null;
    if (!selected && list.length) selected = list[list.length - 1].id;
    renderLiveBar();
    if (!list.length) {
      replace(root, h('div', { class: 'collect-inner' }, liveHost, renderStart()));
      return;
    }
    const c = collectors[selected];
    const url = await link(c);
    if (!alive) return;
    replace(
      root,
      h('div', { class: 'collect-inner' }, liveHost, h('div', { class: 'collect-grid' }, renderList(), renderDetail(c, url))),
    );
  }

  const unsubscribe = session.subscribe((doc, change) => {
    if (change.type !== 'save') renderLiveBar();
  });
  cleanups.push(unsubscribe);

  replace(root, h('div', { class: 'view-loading', role: 'status' }, h('div', { class: 'spinner' }), h('span', { class: 'sr-only' }, 'Loading share links')));
  try {
    [collectors, cfg] = await Promise.all([app.repo.loadCollectors(sid), app.client.peek()]);
  } catch (err) {
    console.error(err);
    replace(root, h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon('alert', { size: 22 })),
      h('h3', null, 'Could not load share links'), h('p', null, 'Check your connection and try again.'),
      h('button', { type: 'button', class: 'btn', onclick: () => location.reload() }, 'Reload')));
    return { unmount() { alive = false; cleanups.forEach((f) => f()); } };
  }
  await renderAll();
  loadCounts();

  return {
    unmount() {
      alive = false;
      cleanups.forEach((f) => f());
    },
  };
}
