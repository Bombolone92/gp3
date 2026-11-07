/**
 * The frame around one survey: the app bar with its title, status, save
 * state and the Design / Collect / Analyze steps, hosting whichever step is
 * open. The survey's editing session lives as long as the frame, so moving
 * between steps keeps undo history and pending saves.
 *
 * A step module exports mount(container, ctx) returning { unmount, update? }
 * where ctx = { app, session, sid, route, frame }.
 */
import { h, replace } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { toastError } from '../lib/ui.js';
import { hasUnpublishedChanges, isPublished, surveyStatus } from '../data/publish.js';

const STEPS = [
  { id: 'design', label: 'Design', load: () => import('./builder/index.js') },
  { id: 'collect', label: 'Collect', load: () => import('./collect.js') },
  { id: 'analyze', label: 'Analyze', load: () => import('./analyze/index.js') },
];

const STATUS_LABEL = { draft: 'Draft', open: 'Open', closed: 'Closed' };

export async function mount(container, route, app) {
  const sid = route.sid;
  const session = await app.session(sid, { refresh: true });
  // The user may have left while the survey loaded: draw nothing, and leave
  // the app bar to whatever is showing now.
  if (!location.hash.startsWith(`#/s/${sid}`)) return { unmount() {} };
  let stepId = route.step;
  let step = null;
  let stepToken = 0;

  const body = h('div', { class: 'frame-body' });
  // The visible title is a rename button in the app bar; screen readers
  // still get a proper page heading.
  const heading = h('h1', { class: 'sr-only' });
  const frame = h('div', { class: 'survey-frame' }, heading, body);
  container.append(frame);

  /* ---- App bar ---- */

  const titleBtn = h('button', { type: 'button', class: 'title-btn', title: 'Rename survey' });
  const chip = h('span', { class: 'chip' });
  const saveState = h('span', { class: 'save-state', role: 'status', 'aria-live': 'polite' });
  const steps = h('nav', { class: 'steps tabs', 'aria-label': 'Survey steps' });

  function renderTitle() {
    titleBtn.textContent = (session.survey.title || '').trim() || 'Untitled survey';
    titleBtn.setAttribute('aria-label', `Survey title: ${session.survey.title}. Rename`);
    document.title = `${session.survey.title} · Surveys`;
    heading.textContent = `${session.survey.title}: ${(STEPS.find((s) => s.id === stepId) || STEPS[0]).label}`;
  }

  titleBtn.addEventListener('click', () => {
    const input = h('input', { class: 'input title-input', value: session.survey.title, maxlength: '300', 'aria-label': 'Survey title' });
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (commit && v && v !== session.survey.title) session.apply((s) => ({ ...s, title: v }), { coalesce: 'title' });
      input.replaceWith(titleBtn);
      renderTitle();
      titleBtn.focus();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    titleBtn.replaceWith(input);
    input.focus();
    input.select();
  });

  function renderChip() {
    const status = surveyStatus(session.meta);
    chip.className = `chip chip-${status}`;
    chip.textContent = STATUS_LABEL[status] || 'Draft';
    if (hasUnpublishedChanges(session)) {
      chip.className = 'chip chip-warn';
      chip.textContent = 'Unpublished changes';
    }
  }

  function renderSave() {
    const st = session.saveState;
    saveState.classList.toggle('error', st === 'error');
    if (st === 'error') {
      replace(saveState, icon('alert', { size: 14 }), h('span', { class: 'label' }, 'Not saved'),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => session.retrySave() }, 'Retry'));
    } else if (st === 'saving' || st === 'unsaved') {
      replace(saveState, h('span', { class: 'label' }, 'Saving…'));
    } else {
      replace(saveState, icon('check', { size: 14 }), h('span', { class: 'label' }, 'Saved'));
    }
  }

  function renderSteps() {
    replace(
      steps,
      STEPS.map((s, i) => [
        i ? h('span', { class: 'step-sep', 'aria-hidden': 'true' }, icon('chevRight', { size: 14 })) : null,
        h('a', { class: 'tab', href: `#/s/${sid}/${s.id}`, 'aria-current': s.id === stepId ? 'page' : undefined }, s.label),
      ]),
    );
  }

  const homeLink = h('a', { class: 'btn btn-ghost btn-icon', href: '#/', 'aria-label': 'All surveys', title: 'All surveys' }, icon('chevLeft', { size: 18 }));
  const rightSlot = h('div', { class: 'frame-actions', style: 'display:flex;gap:6px;align-items:center' });
  app.setAppbar({
    left: h('div', { class: 'crumb' }, homeLink, titleBtn, chip),
    center: steps,
    right: [saveState, rightSlot],
  });

  const unsubscribe = session.subscribe((doc, change) => {
    if (change.type === 'save') renderSave();
    else {
      renderSave();
      renderTitle();
      renderChip();
    }
    if (change.type === 'meta') renderChip();
  });

  /* ---- Steps ---- */

  const frameApi = {
    /** Put step-specific buttons in the app bar's right side. */
    setActions(nodes) {
      replace(rightSlot, nodes);
    },
    renderChip,
  };

  async function showStep(r) {
    const token = ++stepToken;
    stepId = r.step;
    renderSteps();
    renderTitle();
    frameApi.setActions(null);
    if (step && step.unmount) await step.unmount();
    step = null;
    replace(body, h('div', { class: 'view-loading', role: 'status' }, h('div', { class: 'spinner' })));
    try {
      const def = STEPS.find((s) => s.id === stepId) || STEPS[0];
      const mod = await def.load();
      if (token !== stepToken) return;
      replace(body);
      const mounted = await mod.mount(body, { app, session, sid, route: r, frame: frameApi });
      // Another step was picked while this one was loading its data.
      if (token !== stepToken) {
        if (mounted && mounted.unmount) await mounted.unmount();
        return;
      }
      step = mounted;
    } catch (err) {
      console.error(err);
      if (token !== stepToken) return;
      replace(body, h('div', { class: 'empty' }, h('h3', null, 'This step could not load'), h('p', null, 'Check your connection and try again.'),
        h('button', { type: 'button', class: 'btn', onclick: () => showStep(r) }, 'Try again')));
      toastError('Something went wrong loading this step.');
    }
  }

  renderTitle();
  renderChip();
  renderSave();
  await showStep(route);

  return {
    async update(r) {
      if (r.step === stepId && step && step.update) {
        step.update(r);
        return;
      }
      if (r.step !== stepId) await showStep(r);
    },
    async unmount() {
      unsubscribe();
      if (step && step.unmount) await step.unmount();
      await session.flush().catch(() => {});
    },
  };
}

export { isPublished };
