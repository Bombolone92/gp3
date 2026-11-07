/**
 * Performing an inspection. Built for a phone in one hand: large Pass and
 * Fail targets, "pass the rest" for speed, notes and photos only where an
 * item fails, a progress bar, and a signature pad.
 */
import { h, uniqueId } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { picker } from '../ui/form.js';
import { app, lookup, myName } from '../app.js';
import { navigate, setQuery } from '../ui/router.js';
import { onLeave } from '../ui/viewhost.js';
import { toast } from '../ui/toast.js';
import { vehicleName } from '../core/format.js';
import { parseDecimal } from '../core/money.js';
import { formatDate, relativeDays } from '../core/dates.js';
import { answerable, evaluate, missingRequired, formAppliesTo } from '../core/inspections.js';
import { submitInspection, meterWarnings } from '../core/actions.js';
import { saveFile } from '../files.js';
import { options, vehicleThumb, meterText, meterUnitLabel, loadImage, emptyPage } from './common.js';

export function render(ctx) {
  const store = app.store;
  const forms = () => store.all('inspectionForms').filter((f) => !f.archived);
  let vehicleId = ctx.query.vehicle || null;
  let formId = ctx.query.form || null;
  if (!forms().length) {
    return emptyPage('No inspection forms yet', 'Create an inspection form first. A ready-made pre-trip checklist is one click away on the Forms page.');
  }
  // Go straight to the checklist only with an active form that applies to
  // the vehicle; when just one form applies, it is the one.
  const fits = () => forms().filter((f) => !vehicleId || formAppliesTo(f, vehicleId));
  if (!formId && fits().length === 1) formId = fits()[0].id;
  const chosen = fits().find((f) => f.id === formId);
  if (vehicleId && chosen) return runner(ctx, chosen, vehicleId);

  // Step 1: choose the vehicle and the form.
  const vPick = picker({
    label: 'Vehicle',
    placeholder: 'Choose a vehicle',
    items: options.vehicles({ keep: vehicleId }),
    value: vehicleId,
    allowClear: false,
    onChange: (v) => {
      vehicleId = v;
      drawForms();
    },
  });
  const formList = h('div.form-choices', { role: 'radiogroup', 'aria-label': 'Inspection form' });
  function drawForms() {
    const list = fits();
    if (formId && !list.some((f) => f.id === formId)) formId = null;
    formList.replaceChildren(
      ...list.map((f) => {
        const last = vehicleId ? store.all('inspections').filter((s) => s.formId === f.id && s.vehicleId === vehicleId).sort((a, b) => b.date.localeCompare(a.date))[0] : null;
        return h(
          'button.form-choice',
          { type: 'button', role: 'radio', 'aria-checked': String(f.id === formId), tabindex: f.id === (formId || list[0].id) ? '0' : '-1', onClick: () => pickForm(f.id) },
          h('span.form-choice-icon', icon('clipboard-check', 20)),
          h('span.grow', h('strong', f.name), h('span.cell-sub', `${answerable(f).length} items${last ? ` · last done ${relativeDays(last.date, app.today())}` : ''}`)),
          f.id === formId ? icon('circle-check', 18) : null,
        );
      }),
    );
    if (!list.length) formList.append(h('p.subtle', 'No form applies to this vehicle.'));
  }
  // Choosing redraws the list, so focus goes to the new chosen button.
  function pickForm(id) {
    formId = id;
    drawForms();
    formList.querySelector('[aria-checked="true"]')?.focus();
  }
  formList.addEventListener('keydown', (e) => {
    const btns = [...formList.querySelectorAll('[role="radio"]')];
    const i = btns.indexOf(document.activeElement);
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (i < 0 || !step) return;
    e.preventDefault();
    pickForm(fits()[(i + step + btns.length) % btns.length].id);
  });
  drawForms();
  const start = () => {
    if (!vehicleId) return toast('Choose a vehicle first.', { type: 'error' }), vPick.button.focus();
    if (!formId) return toast('Choose an inspection form.', { type: 'error' });
    navigate(`/inspections/start?vehicle=${vehicleId}&form=${formId}`, { replace: true });
  };
  return {
    node: h(
      'div.page.narrow-page',
      h('header.page-header', h('div.titles', h('h1', 'Start an inspection'), h('div.subtitle', 'Choose the vehicle you are inspecting and the checklist to use.'))),
      h('section.card.panel', h('div.card-body.stack', h('div.field', h('label', { for: vPick.button.id }, 'Vehicle'), vPick), h('div.field', h('span.field-label', 'Inspection form'), formList), h('button.btn.primary.lg.block', { type: 'button', onClick: start }, 'Start inspection', icon('arrow-right', 18)))),
    ),
    title: 'Start inspection',
  };
}

function runner(ctx, form, vehicleId) {
  const store = app.store;
  const v = lookup.vehicle(vehicleId);
  if (!v) return emptyPage('Vehicle not found', 'It may have been deleted.');
  const startedAt = new Date().toISOString();
  const answers = {};
  const items = form.items || [];
  const graded = answerable(form);
  const progressBar = h('span.progress-fill');
  const progressText = h('span.progress-text');
  const progressTrack = h('div.progress-track', { role: 'progressbar', 'aria-label': 'Items answered', 'aria-valuemin': '0', 'aria-valuemax': String(graded.length), 'aria-valuenow': '0' }, progressBar);
  const rows = new Map();
  let dirty = false;
  // Photo and signature uploads still in flight; Submit waits for them.
  const busy = new Set();
  const track = (p) => {
    busy.add(p);
    const done = () => busy.delete(p);
    p.then(done, done);
    return p;
  };
  const flushers = []; // save a signature now instead of after its pause

  function setAnswer(id, patch) {
    answers[id] = { ...(answers[id] || {}), ...patch };
    dirty = true;
    rows.get(id)?.refresh?.();
    progress();
  }

  function progress() {
    const done = graded.filter((it) => {
      const a = answers[it.id];
      return a && (a.value !== undefined && a.value !== null && a.value !== '' || a.photos?.length);
    }).length;
    progressBar.style.width = `${graded.length ? (done / graded.length) * 100 : 0}%`;
    progressTrack.setAttribute('aria-valuenow', String(done));
    const failed = graded.filter((it) => evaluate(it, answers[it.id]?.value) === false).length;
    progressText.textContent = `${done} of ${graded.length} answered${failed ? `, ${failed} failed` : ''}`;
  }

  function itemNode(it, n) {
    const id = uniqueId('it');
    if (it.type === 'section') return h('h2.insp-section', it.label);
    const head = h('div.insp-head', h('span.insp-num', String(n)), h('div.grow', h('h3.insp-label', { id }, it.label, it.required ? [h('span.req', { 'aria-hidden': 'true' }, ' *'), h('span.sr-only', ' (required)')] : null), it.help ? h('p.insp-help', it.help) : null));
    const extra = h('div.insp-extra');
    const row = h('section.insp-item', { 'aria-labelledby': id, dataset: { item: it.id } }, head);
    let control;
    const noteAndPhotos = (show) => {
      extra.hidden = !show;
      if (!show || extra.childElementCount) return;
      const note = h('textarea.textarea', { rows: 2, placeholder: 'What is wrong?', 'aria-label': `Note for ${it.label}` });
      note.value = answers[it.id]?.note || '';
      note.addEventListener('input', () => setAnswer(it.id, { note: note.value }));
      extra.append(note, photoInput(it, (photos) => setAnswer(it.id, { photos }), () => answers[it.id]?.photos || [], track));
    };
    switch (it.type) {
      case 'passfail': {
        const mk = (val, label, ic) =>
          h(`button.pf-btn.${val}`, { type: 'button', role: 'radio', 'aria-checked': 'false', onClick: () => setAnswer(it.id, { value: answers[it.id]?.value === val ? null : val }) }, icon(ic, 18), label);
        const pass = mk('pass', 'Pass', 'check');
        const fail = mk('fail', 'Fail', 'x');
        control = h('div.pf-group', { role: 'radiogroup', 'aria-labelledby': id }, pass, fail);
        const keys = radioKeys(control, [pass, fail], ['pass', 'fail'], (val) => setAnswer(it.id, { value: val }));
        row.refresh = () => {
          const val = answers[it.id]?.value;
          pass.setAttribute('aria-checked', String(val === 'pass'));
          fail.setAttribute('aria-checked', String(val === 'fail'));
          keys.sync(val);
          row.classList.toggle('failed', val === 'fail');
          noteAndPhotos(val === 'fail');
        };
        break;
      }
      case 'choice': {
        const btns = (it.options || []).map((o) => h('button.choice-btn', { type: 'button', role: 'radio', 'aria-checked': 'false', onClick: () => setAnswer(it.id, { value: answers[it.id]?.value === o ? null : o }) }, o));
        control = h('div.choice-group', { role: 'radiogroup', 'aria-labelledby': id }, btns);
        const keys = radioKeys(control, btns, it.options || [], (val) => setAnswer(it.id, { value: val }));
        row.refresh = () => {
          const val = answers[it.id]?.value;
          btns.forEach((b, i) => b.setAttribute('aria-checked', String(it.options[i] === val)));
          keys.sync(val);
          const ok = evaluate(it, val);
          row.classList.toggle('failed', ok === false);
          noteAndPhotos(ok === false);
        };
        break;
      }
      case 'number':
      case 'meter': {
        const inp = h('input.input.num.insp-num-input', { type: 'text', inputmode: 'decimal', 'aria-labelledby': id, placeholder: it.type === 'meter' ? (v.meter != null ? `Last: ${Number(v.meter).toLocaleString()}` : 'Reading') : it.min != null || it.max != null ? `${it.min ?? ''} to ${it.max ?? ''}` : '' });
        const warn = h('p.insp-warn', { 'aria-live': 'polite' });
        inp.addEventListener('input', () => {
          const n = parseDecimal(inp.value);
          // Text that is not a number stays unanswered, so a required item
          // still asks for a reading instead of saving nothing.
          const bad = Number.isNaN(n);
          setAnswer(it.id, { value: bad ? null : n });
          if (bad) warn.textContent = 'Enter a number.';
          else warn.textContent = it.type === 'meter' ? meterWarnings(store, { vehicleId, value: n, date: app.today() })[0] || '' : '';
        });
        control = h('div.insp-input', h('div.input-affix.unit', inp, h('span.affix-end', it.type === 'meter' ? meterUnitLabel(v) : it.unit || '')), warn);
        row.refresh = () => {
          const ok = evaluate(it, answers[it.id]?.value);
          row.classList.toggle('failed', ok === false);
          noteAndPhotos(ok === false);
        };
        break;
      }
      case 'date': {
        const inp = h('input.input', { type: 'date', 'aria-labelledby': id });
        inp.addEventListener('input', () => setAnswer(it.id, { value: inp.value || null }));
        control = inp;
        break;
      }
      case 'photo':
        control = photoInput(it, (photos) => setAnswer(it.id, { photos, value: photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'}` : null }), () => answers[it.id]?.photos || [], track);
        break;
      case 'signature':
        control = signaturePad(it, (file, typed) => setAnswer(it.id, { value: file ? 'signed' : typed ? `Signed by ${typed}` : null, photos: file ? [file] : [] }), track, flushers);
        break;
      default: {
        const t = h('textarea.textarea', { rows: 2, 'aria-labelledby': id });
        t.addEventListener('input', () => setAnswer(it.id, { value: t.value.trim() || null }));
        control = t;
      }
    }
    row.append(h('div.insp-control', control), extra);
    extra.hidden = true;
    rows.set(it.id, row);
    return row;
  }

  let n = 0;
  const list = h('div.insp-list', h('h2.sr-only', 'Checklist'), items.map((it) => itemNode(it, it.type === 'section' ? n : ++n)));

  const submit = async () => {
    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    for (const flush of flushers) flush();
    if (busy.size) {
      const close = toast('Finishing photo uploads', { type: 'info', duration: 60000 });
      while (busy.size) await Promise.all([...busy]).catch(() => {});
      close();
    }
    const missing = missingRequired(form, answers);
    if (missing.length) {
      submitBtn.disabled = false;
      toast(`${missing.length} required item${missing.length === 1 ? ' is' : 's are'} not answered.`, { type: 'error' });
      const row = rows.get(missing[0].id);
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row?.classList.add('missing');
      setTimeout(() => row?.classList.remove('missing'), 2400);
      row?.querySelector('button, input, textarea')?.focus({ preventScroll: true });
      return;
    }
    try {
      const sub = await submitInspection(store, { form, vehicleId, answers: failNotesOnly(), date: app.today(), startedAt, by: myName() }, app.settings());
      dirty = false;
      toast(sub.failed ? `Inspection submitted with ${sub.failed} failed item${sub.failed === 1 ? '' : 's'}.${sub.issueIds?.length ? ` ${sub.issueIds.length} issue${sub.issueIds.length === 1 ? ' was' : 's were'} opened.` : ''}` : 'Inspection submitted. Everything passed.');
      // The button stays disabled: this screen stays up while the
      // inspection page loads, and a second tap would submit it again.
      navigate(`/inspections/${sub.id}`, { replace: true });
    } catch (err) {
      submitBtn.disabled = false;
      toast(err?.message || 'The inspection could not be submitted.', { type: 'error' });
    }
  };
  // A note and photos belong to a failure. An item failed and then changed
  // to a passing answer keeps them only on screen, in case it fails again.
  const failNotesOnly = () => {
    const out = { ...answers };
    for (const it of graded) {
      if (!out[it.id] || !['passfail', 'choice', 'number'].includes(it.type) || evaluate(it, out[it.id].value) === false) continue;
      out[it.id] = { ...out[it.id], note: '', photos: [] };
    }
    return out;
  };
  const submitBtn = h('button.btn.primary.lg', { type: 'button', onClick: submit }, icon('check', 18), 'Submit inspection');
  const passRest = h(
    'button.btn',
    {
      type: 'button',
      onClick: () => {
        let k = 0;
        for (const it of graded) if (it.type === 'passfail' && !answers[it.id]?.value) (setAnswer(it.id, { value: 'pass' }), k++);
        toast(k ? `${k} item${k === 1 ? '' : 's'} marked as pass` : 'No unanswered pass or fail items', { type: 'info' });
      },
    },
    icon('check-check', 16),
    'Pass all remaining',
  );
  progress();
  const page = h(
    'div.page.narrow-page.insp-page',
    h(
      'header.insp-top',
      h('a.back-link', { href: '#/inspections/start', onClick: (e) => (e.preventDefault(), setQuery({}), navigate('/inspections/start')) }, icon('arrow-left', 15), 'Change vehicle or form'),
      h('div.insp-title', vehicleThumb(v, 'md'), h('div.grow', h('h1', vehicleName(v)), h('div.subtle', `${form.name} · ${formatDate(app.today())}${v.meter != null ? ` · last reading ${meterText(v.meter, v)}` : ''}`))),
      h('div.progress', progressTrack, progressText, h('span.grow'), passRest),
    ),
    list,
    h('div.insp-submit', submitBtn),
  );
  return { node: page, title: `Inspect ${vehicleName(v)}`, dirty: () => dirty };
}

/**
 * Keyboard for a group of radio buttons: one Tab stop (the chosen one, or
 * the first), and the arrow keys move to and choose the next or previous.
 */
function radioKeys(group, btns, values, choose) {
  const sync = (val) => {
    const i = Math.max(0, values.indexOf(val));
    btns.forEach((b, j) => (b.tabIndex = j === i ? 0 : -1));
  };
  group.addEventListener('keydown', (e) => {
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const n = (i + step + btns.length) % btns.length;
    btns[n].focus();
    choose(values[n]);
  });
  sync(null);
  return { sync };
}

/** Add photos from the camera or library; shows thumbnails with remove. */
function photoInput(it, onChange, current, track) {
  // No `capture`: it makes phones open the camera only, with no way to
  // pick a photo already taken.
  const input = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const thumbs = h('ul.insp-photos');
  const draw = () => {
    thumbs.replaceChildren(
      ...current().map((p, i) => {
        const t = h('span.photo-thumb', icon('image', 16));
        loadImage(t, p);
        return h('li', t, h('button.icon-btn.sm.photo-del', { type: 'button', 'aria-label': `Remove photo ${i + 1}`, onClick: () => remove(p, i) }, icon('x', 14)));
      }),
    );
  };
  // Focus goes to the next photo's remove button, or to "Add photo".
  const remove = (p, i) => {
    onChange(current().filter((x) => x !== p));
    draw();
    const dels = thumbs.querySelectorAll('.photo-del');
    (dels[i] || dels[i - 1] || addBtn).focus();
  };
  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    track(
      (async () => {
        for (const f of files) {
          try {
            const att = await saveFile(f, 'files/inspections');
            onChange([...current(), att]);
            draw();
          } catch (err) {
            toast(err.message || 'Could not add the photo.', { type: 'error' });
          }
        }
      })(),
    );
  });
  const addBtn = h('button.btn.sm', { type: 'button', onClick: () => input.click() }, icon('camera', 15), 'Add photo');
  draw();
  return h('div.insp-photo-wrap', thumbs, addBtn, input);
}

/** Signature pad on a canvas (pointer events), saved as a PNG file. */
function signaturePad(it, onChange, track, flushers) {
  const canvas = h('canvas.sig-canvas', { 'aria-label': `${it.label}. Draw with your finger, pen, or mouse.`, role: 'img' });
  let drawing = false;
  let has = false;
  let saveTimer = null;
  let version = 0; // bumped by every save and by Clear; a stale upload is dropped
  const ctx2 = () => canvas.getContext('2d');
  let fitted = 0; // the pixel ratio the drawing surface was sized for
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (!r.width) return;
    const w = Math.round(r.width * dpr);
    const hgt = Math.round(r.height * dpr);
    if (fitted === dpr && canvas.width === w && canvas.height === hgt) return;
    // Resizing a canvas erases it, so copy what was drawn and put it back.
    let old = null;
    if (has && fitted) {
      old = document.createElement('canvas');
      old.width = canvas.width;
      old.height = canvas.height;
      old.getContext('2d').drawImage(canvas, 0, 0);
    }
    const oldDpr = fitted;
    canvas.width = w;
    canvas.height = hgt;
    fitted = dpr;
    const c = ctx2();
    if (old) c.drawImage(old, 0, 0, (old.width * dpr) / oldDpr, (old.height * dpr) / oldDpr);
    c.scale(dpr, dpr);
    c.lineWidth = 2.2;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#111';
  };
  requestAnimationFrame(fit);
  // Turning the phone or resizing the window changes the pad's size; the
  // drawing surface has to follow or strokes land away from the finger.
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => !drawing && fit());
    ro.observe(canvas);
    onLeave(() => ro.disconnect());
  }
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  // One pointer draws at a time: a palm or second finger resting on the
  // pad must not jump the line to where it touches.
  let pointer = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (drawing) return;
    fit();
    drawing = true;
    pointer = e.pointerId;
    clearTimeout(saveTimer);
    saveTimer = null;
    canvas.setPointerCapture(e.pointerId);
    const c = ctx2();
    c.beginPath();
    c.moveTo(...pos(e));
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing || e.pointerId !== pointer) return;
    const c = ctx2();
    c.lineTo(...pos(e));
    c.stroke();
    has = true;
  });
  const end = (e) => {
    if (!drawing || e.pointerId !== pointer) return;
    drawing = false;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => ((saveTimer = null), track(save())), 500);
  };
  // Submitting right after the last stroke must not lose the signature.
  flushers.push(() => {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    track(save());
  });
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  async function save() {
    const mine = ++version;
    if (!has) return onChange(null, typed.value.trim());
    // Save black ink on white so it prints the same in any theme.
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const c = out.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, out.width, out.height);
    const src = ctx2().getImageData(0, 0, canvas.width, canvas.height);
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    const t = tmp.getContext('2d');
    t.putImageData(src, 0, 0);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = '#111';
    t.fillRect(0, 0, tmp.width, tmp.height);
    c.drawImage(tmp, 0, 0);
    const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
    try {
      const file = await saveFile(new File([blob], 'signature.png', { type: 'image/png' }), 'files/inspections');
      // Cleared, or signed again, while this one uploaded.
      if (mine === version) onChange(file);
    } catch (err) {
      if (mine === version) toast(err.message || 'Could not save the signature.', { type: 'error' });
    }
  }
  const clear = h(
    'button.link-btn',
    {
      type: 'button',
      onClick: () => {
        clearTimeout(saveTimer);
        saveTimer = null;
        version++;
        ctx2().clearRect(0, 0, canvas.width, canvas.height);
        has = false;
        onChange(null, typed.value.trim());
      },
    },
    'Clear',
  );
  // A typed name works too, for keyboard and screen reader users.
  const typed = h('input.input.sm', { type: 'text', autocomplete: 'name', placeholder: 'Or type your full name', 'aria-label': `${it.label}: type your full name` });
  typed.addEventListener('input', () => !has && onChange(null, typed.value.trim()));
  return h('div.sig-wrap', canvas, h('div.row', h('span.subtle.grow', 'Sign above'), clear), typed);
}
