/** Admin sections: General, Help center and Email. */
import { selectField } from '../ui/components.js';
import { timeZones } from '../ui/format.js';
import { go } from '../ui/router.js';
import { normEmail } from '../shared/model.js';
import { app } from '../app.js';
import { toast, toastError } from '../ui/toast.js';
import { mailboxAddress, mailboxAccess, importMailbox } from '../client/mailbox.js';
import { LOCAL } from '../client/api.js';
import { h, uid, icon, sectionHead, panel, settingRow, toggle, saveBar, guardUnsaved, copyField, callout } from './admin-common.js';

/**
 * Shared form plumbing: `read()` returns the current values from the meta,
 * `draft` holds edits, `diff()` gives the patch to save.
 */
function form(container, { title, description, read, build, toPatch, validate }) {
  // `base` follows the saved settings, also when another administrator
  // changes them; `origin` is what this draft started from. Only the values
  // edited here are saved, over the latest ones.
  let base = read();
  let origin = base;
  let draft = structuredClone(base);
  const edited = () => {
    const out = { ...base };
    for (const k of Object.keys(draft)) if (JSON.stringify(draft[k]) !== JSON.stringify(origin[k])) out[k] = draft[k];
    return out;
  };
  const errorEl = h('p.field-error', { role: 'alert' });
  const fields = h('div.admin-form');
  const bar = saveBar({
    getPatch: () => {
      const next = edited();
      return JSON.stringify(next) === JSON.stringify(base) ? null : toPatch(next, base);
    },
    onSave: async (patch) => {
      const problem = validate?.(edited());
      if (problem) {
        errorEl.textContent = problem;
        throw new Error(problem);
      }
      errorEl.textContent = '';
      await app.saveMeta(patch);
      base = read();
      origin = base;
      draft = structuredClone(base);
      paint();
    },
    onDiscard: () => {
      origin = base;
      draft = structuredClone(base);
      errorEl.textContent = '';
      paint();
    },
  });
  const formEl = h('form.admin-form-wrap', {
    novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      bar.submit();
    },
    oninput: () => bar.refresh(),
    onchange: () => bar.refresh(),
  }, fields, errorEl, bar.el);
  function paint() {
    fields.replaceChildren(...build(draft, () => bar.refresh(), paint));
    bar.refresh();
  }
  container.append(sectionHead(title, description), formEl);
  paint();
  const unguard = guardUnsaved(() => bar.refresh());
  // Another administrator may change these settings meanwhile.
  const onChange = (e) => {
    if (!e.detail?.kinds?.has('d')) return;
    const fresh = read();
    if (JSON.stringify(fresh) === JSON.stringify(base)) return;
    const clean = JSON.stringify(draft) === JSON.stringify(origin);
    base = fresh;
    if (clean) {
      origin = base;
      draft = structuredClone(base);
      paint();
    } else bar.refresh();
  };
  app.replica.addEventListener('change', onChange);
  return () => {
    unguard();
    app.replica.removeEventListener('change', onChange);
  };
}

/* ------------------------------------------------------------- General */

export function renderGeneral(container) {
  return form(container, {
    title: 'General',
    description: 'The basics of your help desk.',
    read: () => {
      const m = app.replica.meta || {};
      return { name: m.name || '', timezone: m.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone, autoCloseDays: m.autoCloseDays ?? 4, csat: !!m.csat?.enabled };
    },
    validate: (d) => (!d.name.trim() ? 'Give the help desk a name.' : null),
    toPatch: (d, b) => {
      const p = {};
      if (d.name !== b.name) p.name = d.name.trim();
      if (d.timezone !== b.timezone) p.timezone = d.timezone;
      if (d.autoCloseDays !== b.autoCloseDays) p.autoCloseDays = d.autoCloseDays;
      if (d.csat !== b.csat) p.csat = { enabled: d.csat };
      return p;
    },
    build: (d, refresh) => {
      const nameId = uid('name');
      const tzId = uid('tz');
      const daysId = uid('days');
      const zones = timeZones();
      const tz = selectField({
        id: tzId, value: d.timezone, label: 'Time zone',
        options: () => zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') })),
        onChange: (v) => { d.timezone = v; refresh(); },
      });
      const days = h(`input#${daysId}.input.input-narrow`, {
        type: 'number', min: 0, max: 28, step: 1, value: d.autoCloseDays, inputmode: 'numeric',
        oninput: (e) => {
          const n = Math.round(Number(e.target.value));
          d.autoCloseDays = Number.isFinite(n) ? Math.max(0, Math.min(28, n)) : 0;
        },
      });
      return [
        panel('Identity', null,
          settingRow({ id: nameId, label: 'Help desk name', description: 'Shown to agents, in the help center and in emails to customers.', control: h(`input#${nameId}.input`, { value: d.name, maxlength: 80, required: true, oninput: (e) => { d.name = e.target.value; } }) }),
          settingRow({ id: tzId, label: 'Time zone', description: 'Where your team works. Reports show days and hours in each viewer\'s own time zone.', control: tz })),
        panel('Tickets', null,
          settingRow({ id: daysId, label: 'Close solved tickets after', description: 'Solved tickets become closed and read-only after this many days. Customers who reply later start a follow-up. Use 0 to keep them solved.', control: h('div.inline-unit', days, h('span.muted', 'days')) }),
          settingRow({ label: 'Customer satisfaction', description: 'Ask requesters to rate solved tickets as good or bad in the help center.', control: toggle({ checked: d.csat, label: 'Customer satisfaction ratings', onChange: (v) => { d.csat = v; refresh(); } }) })),
      ];
    },
  });
}

/* --------------------------------------------------------- Help center */

const SWATCHES = ['#3554d1', '#0f766e', '#2f855a', '#c2410c', '#b91c1c', '#7c3aed', '#be185d', '#1f2937'];

export function renderHelpCenter(container) {
  const local = app.server === LOCAL;
  return form(container, {
    title: 'Help center',
    description: 'A public site where customers search your articles and send requests.',
    read: () => {
      const p = app.replica.meta?.portal || {};
      return { enabled: !!p.enabled, title: p.title || app.replica.meta?.name || '', intro: p.intro || '', color: p.color || '', signInRequired: !!p.signInRequired };
    },
    validate: (d) => (d.color && !/^#[0-9a-f]{6}$/i.test(d.color) ? 'Enter the brand color as a six digit hex code, like #3554d1.' : null),
    toPatch: (d) => ({ portal: { enabled: d.enabled, title: d.title.trim(), intro: d.intro.trim(), color: d.color || null, signInRequired: d.signInRequired } }),
    build: (d, refresh, repaint) => {
      const titleId = uid('title');
      const introId = uid('intro');
      const hexId = uid('hex');
      const url = app.helpCenterUrl();
      const status = [];
      if (local) {
        status.push(callout('info', 'info',
          h('strong', 'Turn on team access to publish your help center. '),
          'Right now this help desk runs only in your account, so customers cannot reach it yet. ',
          h('button.link-btn', { type: 'button', onclick: () => go('/admin/team') }, 'Go to Team')));
      } else if (url) {
        status.push(panel('Public address', 'Share this link, or link to it from your website.', copyField(url, { label: 'Help center link', open: true })));
      } else if (!d.enabled) {
        status.push(callout('neutral', 'globe', 'The help center is off. Turn it on below and save to get its public link.'));
      }
      const hex = h(`input#${hexId}.input.hex-input`, {
        value: d.color, placeholder: '#3554d1', maxlength: 7, spellcheck: false, 'aria-label': 'Brand color hex code',
        oninput: (e) => {
          let v = e.target.value.trim();
          if (v && !v.startsWith('#')) v = `#${v}`;
          d.color = v;
          preview.style.background = /^#[0-9a-f]{6}$/i.test(v) ? v : 'var(--accent)';
          for (const b of swatchEls) b.setAttribute('aria-checked', String(b.dataset.color === v.toLowerCase()));
        },
      });
      const swatchEls = SWATCHES.map((c) => h('button.swatch', {
        type: 'button', role: 'radio', 'aria-checked': String(d.color.toLowerCase() === c), 'aria-label': `Use ${c}`, title: c, dataset: { color: c },
        style: { background: c },
        onclick: () => {
          d.color = c;
          repaint();
        },
      }, icon('check', { size: 14 })));
      const preview = h('span.color-preview', { style: { background: /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : 'var(--accent)' }, 'aria-hidden': 'true' });
      return [
        ...status,
        panel('Availability', null,
          settingRow({ label: 'Help center', description: local ? 'Available after you turn on team access.' : 'Customers can browse published articles and send requests.', control: toggle({ checked: d.enabled, label: 'Help center on', disabled: local, onChange: (v) => { d.enabled = v; refresh(); } }) }),
          settingRow({ label: 'Require sign-in to send requests', description: 'Only people signed in with a Puter account can submit. Articles stay public.', control: toggle({ checked: d.signInRequired, label: 'Require sign-in', onChange: (v) => { d.signInRequired = v; refresh(); } }) })),
        panel('Appearance', null,
          settingRow({ id: titleId, label: 'Title', description: 'The heading customers see.', control: h(`input#${titleId}.input`, { value: d.title, maxlength: 100, oninput: (e) => { d.title = e.target.value; } }) }),
          settingRow({ id: introId, label: 'Welcome text', description: 'One or two sentences under the title.', control: h(`textarea#${introId}.textarea`, { rows: 3, maxlength: 300, oninput: (e) => { d.intro = e.target.value; } }, d.intro) }),
          settingRow({ id: hexId, label: 'Brand color', description: 'Used for buttons and links in the help center.', control: h('div.color-picker', h('div.swatches', { role: 'radiogroup', 'aria-label': 'Brand color presets' }, swatchEls), h('div.hex-row', preview, hex)) })),
      ];
    },
  });
}

/* --------------------------------------------------------------- Email */

export function renderEmail(container) {
  const local = app.server === LOCAL;
  const triggers = (app.replica.cfg.triggers || []).filter((t) => (t.actions || []).some((a) => a.field === 'notify_requester' || a.field === 'notify_email'));
  return form(container, {
    title: 'Email',
    description: 'Email notifications that keep requesters up to date.',
    read: () => {
      const e = app.replica.meta?.email || {};
      // inbox and address are changed by their own switch; they are read here
      // so the section repaints when they change.
      return { enabled: !!e.enabled, replyTo: e.replyTo || '', inbox: !!e.inbox, address: e.address || null };
    },
    validate: (d) => (d.replyTo && !normEmail(d.replyTo) ? 'That reply-to address does not look right.' : null),
    toPatch: (d) => ({ email: { ...currentEmail(), enabled: d.enabled, replyTo: d.replyTo.trim() || null } }),
    build: (d, refresh) => {
      const replyId = uid('reply');
      return [
        inboxPanel(local),
        local
          ? callout('info', 'info', h('strong', 'Emails start once team access is on. '), 'Sending needs the help desk server. ', h('button.link-btn', { type: 'button', onclick: () => go('/admin/team') }, 'Go to Team'))
          : callout('neutral', 'mail', 'Emails are sent from a Puter address on behalf of your help desk and billed to the owner’s Puter account, which needs a paid plan for sending. Every email links to the request in your help center, where customers can read the conversation and reply.'),
        panel('Notifications', null,
          settingRow({ label: 'Send email notifications', description: 'When off, triggers that email customers are skipped. Replies still appear in the help center.', control: toggle({ checked: d.enabled, label: 'Send email notifications', onChange: (v) => { d.enabled = v; refresh(); } }) }),
          settingRow({ id: replyId, label: 'Reply-to address', description: 'Where replies to notification emails go. Leave empty to use the owner’s Puter email.', control: h(`input#${replyId}.input`, { type: 'email', value: d.replyTo, placeholder: 'support@yourcompany.com', autocomplete: 'email', oninput: (e) => { d.replyTo = e.target.value; } }) })),
        panel('What gets sent', 'Triggers decide when customers get an email. Edit them to change the wording or timing.',
          triggers.length
            ? h('ul.trigger-list', triggers.map((t) => h('li', h(`span.dot${t.active ? '.on' : ''}`, { 'aria-hidden': 'true' }), h('span.grow', t.title), h('span.muted', t.active ? 'On' : 'Off'))))
            : h('p.muted', 'No triggers send email right now.'),
          h('div', h('button.btn', { type: 'button', onclick: () => go('/admin/triggers') }, icon('workflow', { size: 14 }), 'Edit triggers'))),
      ];
    },
  });
}

/** The email settings as stored, with all four fields (the server replaces the whole object). */
function currentEmail() {
  const e = app.replica.meta?.email || {};
  return { enabled: !!e.enabled, replyTo: e.replyTo || null, inbox: !!e.inbox, address: e.address || null };
}

/**
 * "Receive requests by email": the owner's Puter mailbox becomes a channel.
 * Mail is read by the owner's browser while Help Desk is open.
 */
function inboxPanel(local) {
  const isOwner = app.me?.role === 'owner';
  const e = currentEmail();
  const body = [];
  const status = h('p.muted.inbox-status', { role: 'status', 'aria-live': 'polite' });
  const sw = toggle({
    checked: e.inbox,
    label: 'Receive requests by email',
    disabled: !isOwner,
    onChange: async (on) => {
      sw.disabled = true;
      try {
        if (on) {
          status.textContent = 'Asking Puter for access to your mailbox';
          const granted = await mailboxAccess({ prompt: true });
          if (!granted) {
            sw.checked = false;
            status.textContent = '';
            toastError({ message: 'Help Desk needs permission to read your Puter mailbox to turn this on.' });
            return;
          }
          await app.saveMeta({ email: { ...currentEmail(), inbox: true, address: await mailboxAddress() } });
          toast('Email is now a channel. New mail becomes tickets.', { kind: 'success' });
        } else {
          await app.saveMeta({ email: { ...currentEmail(), inbox: false } });
          toast('Stopped turning email into tickets.');
        }
      } catch (err) {
        sw.checked = !on;
        toastError(err);
      } finally {
        status.textContent = '';
        sw.disabled = !isOwner;
      }
    },
  });
  body.push(settingRow({
    label: 'Turn new email into tickets',
    description: isOwner
      ? 'New messages to your Puter mailbox open tickets. Replies with the ticket number in the subject are added to that ticket.'
      : 'Only the owner can turn this on or off, because it reads the owner\u2019s mailbox.',
    control: sw,
  }));
  if (e.inbox && e.address) {
    body.push(h('div.field', h('span.field-label', 'Your help desk address'), copyField(e.address, { label: 'Email address' }), h('p.field-hint', 'Share this address with customers, or forward your support address to it.')));
    if (isOwner) {
      const check = h('button.btn', {
        type: 'button',
        onclick: async () => {
          check.disabled = true;
          try {
            const res = await importMailbox(app, { onProgress: (i, n) => { status.textContent = `Importing message ${i} of ${n}`; } });
            status.textContent = '';
            const parts = [];
            if (res.created) parts.push(`${res.created} new ticket${res.created === 1 ? '' : 's'}`);
            if (res.appended) parts.push(`${res.appended} repl${res.appended === 1 ? 'y' : 'ies'} added`);
            if (res.failed) parts.push(`${res.failed} could not be imported`);
            toast(parts.length ? `${parts.join(', ')}.` : 'No new email.', { kind: res.failed ? 'warning' : 'success' });
          } catch (err) {
            status.textContent = '';
            toastError(err);
          } finally {
            check.disabled = false;
          }
        },
      }, icon('refresh-cw', { size: 14 }), 'Check for new email now');
      body.push(h('div.inbox-actions', check, status));
    }
    body.push(callout('neutral', 'clock', 'Mail is checked every few minutes while the owner has Help Desk open, and right away when they open it.'));
  } else body.push(status);
  if (local) body.unshift(callout('info', 'info', 'You can receive email now. Sending notifications back to customers starts once team access is on.'));
  return panel('Receive requests by email', 'Every Puter account has its own email address. Use it as your support inbox.', ...body);
}
