/** App shell: sidebar / bottom-nav navigation, hash router, theme menu. */
import { el, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { uid } from '../lib/id.js';
import { DEFAULT_STAGES, isActive, onActiveCandidates, stagesFrom } from '../core/pipeline.js';
import { brandMark, downloadFile, initials, field } from './components.js';
import { openImportWizard, openPasteApplication } from './importer.js';
import { buildBackup, candidatesCSV, interviewsCSV, offersCSV, validateBackup } from '../core/transfer.js';
import { plural } from '../lib/format.js';
import { confirmDialog, ignoreChanges, notifyChanged, openModal } from './modal.js';
import { primeToastRegion, toast } from './toast.js';
import { openOnboarding } from './onboarding.js';
import { calendarFeedUrl, reconcilePublishedPages, startFeedSync, unpublishJob } from './publish.js';
import { openCalendarShare } from './calendar.js';
import { openGuidesEditor } from './guides.js';
import { openTemplatesEditor } from './plans.js';
import { openSnapshots, snapshotSummary } from './snapshots.js';
import { onboardingTemplates } from '../core/onboard.js';
import { guidesFrom } from '../core/guides.js';
import { openCandidateEditor } from './editors/candidate.js';
import { openQuickFind } from './quickfind.js';
import { renderDashboard } from './views/dashboard.js';
import { renderJobs } from './views/jobs.js';
import { renderPipeline } from './views/pipeline.js';
import { renderCandidate } from './views/candidate.js';
import { renderCompare } from './views/compare.js';
import { renderInterviews } from './views/interviews.js';
import { renderOffers } from './views/offers.js';
import { renderOnboarding } from './views/onboarding.js';
import { renderReports } from './views/reports.js';
import { OFFER_STATUS } from '../core/offers.js';
import { reminderSettings } from '../core/reminders.js';
import { isProposed, workingHours } from '../core/interviews.js';
import { notificationsSupported, requestNotificationPermission, startNotifications } from './notifications.js';
import { EMAIL_TEMPLATES, emailTemplate, templatePlaceholders, templateVariables } from '../core/emails.js';
import { DEFAULT_OFFER_TEMPLATE, OFFER_TEMPLATE_VARIABLES, offerTemplate } from '../core/offers.js';
import { RETENTION_OPTIONS, retentionDue } from '../core/retention.js';
import { openRetentionReview } from './retention.js';
import { formatTimestamp, todayISO, toMinutes } from '../lib/dates.js';
import { browserTimeZone, zoneAbbreviation, zoneLabel } from '../lib/zones.js';
import { timeZoneSelect } from './editors/form.js';

const VIEWS = {
  dashboard: { title: 'Overview', icon: 'dashboard', render: renderDashboard },
  jobs: { title: 'Jobs', icon: 'briefcase', render: renderJobs },
  pipeline: { title: 'Pipeline', icon: 'kanban', render: renderPipeline },
  candidates: { title: 'Candidate', icon: 'user', render: renderCandidate, nav: 'pipeline' },
  compare: { title: 'Compare', icon: 'users', render: renderCompare, nav: 'pipeline' },
  interviews: { title: 'Interviews', icon: 'calendar', render: renderInterviews },
  offers: { title: 'Offers', icon: 'signature', render: renderOffers },
  onboarding: { title: 'Onboarding', icon: 'rocket', render: renderOnboarding },
  reports: { title: 'Reports', icon: 'chart', render: renderReports },
};

const SIDEBAR_ORDER = ['dashboard', 'jobs', 'pipeline', 'interviews', 'offers', 'onboarding', 'reports'];
const TABBAR_ORDER = ['dashboard', 'jobs', 'pipeline', 'interviews', 'offers'];
/* The phone tab bar has room for five; the rest live behind its "More"
   sheet. Without it they had no entry point at all once the sidebar is
   hidden — Reports only through one button on the overview, Onboarding
   only when a hire happened to have an unfinished checklist. */
const TABBAR_MORE = SIDEBAR_ORDER.filter((name) => !TABBAR_ORDER.includes(name));

/* ---- Theme ---------------------------------------------------------- */

const THEME_KEY = 'hiring.theme';
const THEMES = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'monitor' },
];

function getTheme() {
  // Storage can throw inside iframes with third-party storage blocked
  // (the app runs embedded in Puter); the theme toggle must still work
  // for the session even when the preference cannot persist.
  let t = null;
  try {
    t = localStorage.getItem(THEME_KEY);
  } catch {}
  return t === 'light' || t === 'dark' ? t : 'system';
}

function setTheme(value) {
  try {
    if (value === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, value);
  } catch {}
  if (value === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
  syncThemeColorMeta();
}

/** Keep the browser chrome color in step with the effective theme. */
function syncThemeColorMeta() {
  const stamped = document.documentElement.dataset.theme;
  const dark = stamped === 'dark' || (!stamped && matchMedia('(prefers-color-scheme: dark)').matches);
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', dark ? '#101013' : '#fad319');
  }
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeColorMeta);
syncThemeColorMeta();

/* One theme menu at a time; its own button toggles it closed. */
let themeMenu = null;

function openThemeMenu(anchor) {
  if (themeMenu?.anchor === anchor) {
    themeMenu.close({ refocus: true });
    return;
  }
  themeMenu?.close();
  const current = getTheme();
  const rect = anchor.getBoundingClientRect();
  const menu = el(
    'div',
    { class: 'menu', role: 'menu', 'aria-label': 'Theme' },
    THEMES.map((t) =>
      el(
        'button',
        {
          class: 'menu-item',
          role: 'menuitemradio',
          'aria-checked': String(t.value === current),
          onClick: () => {
            setTheme(t.value);
            close({ refocus: true });
          },
        },
        icon(t.icon, 15),
        t.label,
        t.value === current ? el('span', { class: 'check' }, icon('check', 15)) : null
      )
    )
  );

  function close({ refocus = false } = {}) {
    themeMenu = null;
    anchor.setAttribute('aria-expanded', 'false');
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    if (refocus && anchor instanceof HTMLElement) anchor.focus();
  }
  /* render() swaps the sidebar wholesale; when that destroys the anchor,
     the menu adopts the replacement button so aria-expanded, the outside-
     click check, the toggle, and Escape's refocus keep pointing at a live
     node instead of a detached one. */
  function reanchor(next) {
    anchor = next;
    themeMenu.anchor = next;
    next.setAttribute('aria-expanded', 'true');
  }
  function onOutside(e) {
    if (menu.contains(e.target)) return;
    // The anchor's own click toggles the menu in openThemeMenu; closing
    // on its mousedown too would make that click reopen a fresh menu.
    if (anchor.contains(e.target)) return;
    close();
  }

  const items = [...menu.querySelectorAll('.menu-item')];
  let focused = Math.max(0, items.findIndex((item) => item.getAttribute('aria-checked') === 'true'));

  function onKey(e) {
    if (e.metaKey || e.ctrlKey) {
      // A shortcut (Cmd/Ctrl+K…) is about to open another layer. This
      // capture-phase handler runs before that layer's — get out of the
      // way, or the menu keeps stealing arrow keys above the palette.
      close();
      return;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      close({ refocus: true });
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focused = (focused + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[focused].focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      focused = e.key === 'Home' ? 0 : items.length - 1;
      items[focused].focus();
    } else if (e.key === 'Tab') {
      // Hand focus back to the anchor and let the default Tab proceed
      // from there: removing the focused item mid-dispatch would reset
      // the tab order to the top of the document.
      close({ refocus: true });
    }
  }

  document.body.appendChild(menu);
  const menuRect = menu.getBoundingClientRect();
  const top = Math.min(rect.bottom + 6, window.innerHeight - menuRect.height - 8);
  const left = Math.min(Math.max(8, rect.right - menuRect.width), window.innerWidth - menuRect.width - 8);
  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.left = `${left}px`;
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  anchor.setAttribute('aria-expanded', 'true');
  themeMenu = { anchor, close, reanchor };
  items[focused]?.focus();
}

/* ---- Shell ----------------------------------------------------------- */

/* Cleanup for the previous startApp instance, when boot re-enters. */
let teardownApp = null;

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name, param] = hash.split('/');
  return { name: VIEWS[name] ? name : 'dashboard', param: param || null };
}

export function startApp({ store, user, canSignOut, onSignOut }) {
  const ui = {};

  const ctx = {
    store,
    ui,
    user,
    navigate(route) {
      location.hash = `#/${route}`;
    },
    refresh() {
      render();
    },
  };

  function themeButton(focusKey = null) {
    return el(
      'button',
      {
        class: 'btn btn-ghost btn-icon',
        'aria-label': 'Theme',
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
        dataset: focusKey ? { focusKey } : null,
        onClick: (e) => openThemeMenu(e.currentTarget),
      },
      icon('sun', 17)
    );
  }

  function openSettings() {
    const modalRef = { current: null };
    const { settings } = store.state;
    const company = el('input', { class: 'input', type: 'text', value: settings.companyName ?? '', placeholder: 'Shown on offer letters and emails' });
    /* Where the apply button on every published page sends applications.
       It used to live only in the Publish dialog — which is offered for a
       job that is not published yet — so once every open role was live
       there was no way left to change it: a recruiter leaving, or a
       switch to a shared inbox, meant unpublishing a page to reach the
       field. One address serves the whole site, so it belongs here. */
    const applyEmail = el('input', {
      class: 'input',
      type: 'email',
      value: settings.applyEmail ?? '',
      placeholder: 'applications@yourcompany.com',
    });

    /* Pipeline stages: rename, reorder, add, and remove intermediate steps.
       Applied and Hired stay pinned; Offer keeps its signing semantics. */
    const stagesAtOpen = stagesFrom(settings).map((s) => ({ key: s.key, label: s.label }));
    const stageDraft = stagesAtOpen.map((s) => ({ ...s }));
    const retiredDraft = {};
    const stageRows = el('div', { class: 'stage-editor' });
    const stageIconFor = (key) => DEFAULT_STAGES.find((s) => s.key === key)?.icon ?? 'milestone';

    /* Who is still standing in each stage, split by whether the user can
       do anything about it. An archived candidate holds a stage open just
       as firmly — removing it would leave them nowhere to be restored to —
       but they are on no board column and their profile's stage select is
       disabled, so "move its candidates out first" was advice with no way
       to follow it, in front of a stage that looked empty. */
    function stageOccupancy() {
      const counts = new Map();
      for (const c of store.state.candidates) {
        const held = counts.get(c.stage) ?? { active: 0, archived: 0 };
        held[isActive(c) ? 'active' : 'archived'] += 1;
        counts.set(c.stage, held);
      }
      return counts;
    }

    function removeBlockedReason(held) {
      if (!held) return null;
      if (held.active === 0) {
        return `${plural(held.archived, 'archived candidate')} would be stranded: this stage is where they get restored to`;
      }
      const archived = held.archived > 0 ? ` (${plural(held.archived, 'archived one')} holds it too)` : '';
      return `Move its ${plural(held.active, 'candidate')} out first${archived}`;
    }

    function moveStageRow(i, delta) {
      const [row] = stageDraft.splice(i, 1);
      stageDraft.splice(i + delta, 0, row);
      renderStageRows();
      notifyChanged(stageRows);
      const again = stageRows.querySelector(`[data-stage-move="${CSS.escape(`${row.key}:${delta}`)}"]`);
      if (again && !again.disabled) again.focus();
      else stageRows.querySelector(`[data-stage-key="${CSS.escape(row.key)}"] input`)?.focus();
    }

    function renderStageRows() {
      const last = stageDraft.length - 1;
      const occupancy = stageOccupancy();
      stageRows.replaceChildren(
        ...stageDraft.map((s, i) => {
          const anchor = i === 0 || i === last;
          const input = el('input', {
            class: 'input',
            type: 'text',
            value: s.label,
            disabled: anchor,
            placeholder: 'Stage name',
            'aria-label': `Stage ${i + 1} name`,
            onInput: (e) => {
              s.label = e.target.value;
            },
          });
          const mover = (delta, label, iconName) =>
            el(
              'button',
              {
                class: 'btn btn-ghost btn-icon btn-sm',
                'aria-label': `${label} ${s.label || 'stage'}`,
                title: label,
                disabled: anchor || (delta < 0 ? i <= 1 : i >= last - 1),
                dataset: { stageMove: `${s.key}:${delta}` },
                onClick: () => moveStageRow(i, delta),
              },
              icon(iconName, 14)
            );
          const blocked = removeBlockedReason(occupancy.get(s.key));
          const removable = !anchor && s.key !== 'offer';
          return el(
            'div',
            { class: 'stage-editor-row', dataset: { stageKey: s.key } },
            el('span', { class: 'stage-editor-icon' }, icon(stageIconFor(s.key), 15)),
            input,
            anchor
              ? el('span', { class: 'stage-editor-hint' }, i === 0 ? 'First' : 'Last')
              : el(
                  'span',
                  { class: 'stage-editor-controls' },
                  mover(-1, 'Move up', 'chevron-up'),
                  mover(1, 'Move down', 'chevron-down'),
                  removable
                    ? el(
                        'button',
                        {
                          class: 'btn btn-ghost btn-icon btn-sm btn-icon-danger',
                          'aria-label': `Remove ${s.label || 'stage'}`,
                          title: blocked ?? 'Remove stage',
                          disabled: Boolean(blocked),
                          onClick: () => {
                            if (stagesAtOpen.some((x) => x.key === s.key)) retiredDraft[s.key] = s.label.trim() || s.key;
                            stageDraft.splice(i, 1);
                            renderStageRows();
                            notifyChanged(stageRows);
                          },
                        },
                        icon('x', 14)
                      )
                    : el('span', { class: 'stage-editor-hint', title: 'A signed offer hires the candidate' }, 'Signing')
                )
          );
        })
      );
    }
    renderStageRows();

    const addStage = el(
      'button',
      {
        class: 'btn btn-sm',
        onClick: () => {
          const offerIndex = stageDraft.findIndex((s) => s.key === 'offer');
          const at = offerIndex > 0 ? offerIndex : stageDraft.length - 1;
          stageDraft.splice(at, 0, { key: uid('stg'), label: '' });
          renderStageRows();
          notifyChanged(stageRows);
          stageRows.querySelectorAll('input')[at]?.focus();
        },
      },
      icon('plus', 14),
      'Add stage'
    );

    /* Email and letter templates: working copies per key, one visible at
       a time. The offer letter joins the same editor as a body-only entry. */
    const LETTER_KEY = 'offerLetter';
    const drafts = {};
    for (const t of EMAIL_TEMPLATES) {
      const effective = emailTemplate(settings, t.key);
      drafts[t.key] = { subject: effective.subject, body: effective.body };
    }
    drafts[LETTER_KEY] = { subject: '', body: offerTemplate(settings) };
    let currentKey = EMAIL_TEMPLATES[0].key;
    // Both controls sit under the one "Email templates" label; name each
    // like the editors name their compound fields.
    const subject = el('input', { class: 'input', type: 'text', 'aria-label': 'Subject' });
    const body = el('textarea', { class: 'textarea', rows: 8, 'aria-label': 'Body' });
    const variablesHint = el('p', { class: 'muted small' });
    const stash = () => {
      drafts[currentKey] = { subject: subject.value, body: body.value };
    };
    const show = (key) => {
      currentKey = key;
      subject.value = drafts[key].subject;
      body.value = drafts[key].body;
      // The letter has no subject line, and its own placeholder set.
      subject.style.display = key === LETTER_KEY ? 'none' : '';
      // replaceChildren stringifies null into a literal "null" text node,
      // so the email templates' variable list ended in one; keep only the
      // real children.
      variablesHint.replaceChildren(
        ...[
          'Variables: ',
          // Per template, not the union of all of them: each one is
          // rendered with only the values its own call site builds, so
          // offering {{date}} while editing the rejection email was an
          // invitation to put a blank space in front of a candidate.
          (key === LETTER_KEY ? OFFER_TEMPLATE_VARIABLES : templateVariables(key)).map((v) => `{{${v}}}`).join('  '),
          key === LETTER_KEY ? '. A line whose variables all come up empty is left out of the letter.' : null,
        ].filter(Boolean)
      );
    };
    const picker = el(
      'select',
      {
        class: 'select',
        'aria-label': 'Template',
        onChange: (e) => {
          stash();
          show(e.target.value);
        },
      },
      EMAIL_TEMPLATES.map((t) => el('option', { value: t.key }, t.label)),
      el('option', { value: LETTER_KEY }, 'Offer letter')
    );
    // Choosing which template is on screen is navigation, not an edit, so
    // keep it away from the dialog's dirty tracker. Otherwise opening
    // Settings just to read the rejection wording and pressing Escape
    // asked to discard changes nobody made — the surest way to teach
    // people to click through the prompt that guards real work. Typing in
    // the fields below still marks it dirty.
    ignoreChanges(picker);
    const reset = el(
      'button',
      {
        class: 'btn btn-sm',
        onClick: () => {
          if (currentKey === LETTER_KEY) {
            drafts[LETTER_KEY] = { subject: '', body: DEFAULT_OFFER_TEMPLATE };
          } else {
            const base = EMAIL_TEMPLATES.find((t) => t.key === currentKey);
            drafts[currentKey] = { subject: base.subject, body: base.body };
          }
          show(currentKey);
          // show() assigns .value programmatically, which fires nothing:
          // without this the dialog still counts as untouched, and a
          // scrim click or Escape threw the reset away with no
          // "Discard changes?" at all — under a toast that said it
          // happened. Same duty the stage rows below discharge.
          notifyChanged(body);
          toast('Template reset to the default');
        },
      },
      icon('restore', 14),
      'Reset'
    );
    show(currentKey);

    /* Reminders: three kinds plus the browser-notification master switch. */
    const prefs = reminderSettings(settings);
    const reminderChecks = {};
    const reminderRow = (key, label) => {
      const check = el('input', { type: 'checkbox', class: 'task-check', checked: prefs[key], id: `rem-${key}` });
      reminderChecks[key] = check;
      return el('label', { class: 'task-label', for: `rem-${key}` }, check, el('span', {}, label));
    };
    const browserCheck = el('input', {
      type: 'checkbox',
      class: 'task-check',
      checked: prefs.browser && notificationsSupported() && Notification.permission === 'granted',
      disabled: !notificationsSupported(),
      id: 'rem-browser',
    });
    reminderChecks.browser = browserCheck;
    browserCheck.addEventListener('change', async () => {
      if (!browserCheck.checked) return;
      // The permission bubble doesn't block the page, so Save could read
      // (and persist) a tick the browser is about to refuse. Show the box
      // off until the grant actually lands — it is the truthful state,
      // and a Save racing the prompt then stores what is really in force.
      browserCheck.checked = false;
      const permission = await requestNotificationPermission();
      if (permission === 'granted') {
        browserCheck.checked = true;
      } else {
        toast('The browser blocked notifications. Allow them in the site settings first.', 'error');
      }
    });

    /* The zone new interviews are scheduled in. Blank follows whatever
       device the app is open on, which is right until someone schedules
       from a laptop that travels. */
    const own = browserTimeZone();
    const ownAbbr = own ? zoneAbbreviation(own) : '';
    const timeZone = timeZoneSelect(settings.timeZone ?? '', {
      emptyLabel: own ? `This device · ${zoneLabel(own)}${ownAbbr ? ` (${ownAbbr})` : ''}` : 'This device',
    });

    /* The working window open-slot suggestions are drawn from. */
    const hours = workingHours(settings);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const workStart = el('input', { class: 'input', type: 'time', value: hours.start, 'aria-label': 'Working day starts' });
    const workEnd = el('input', { class: 'input', type: 'time', value: hours.end, 'aria-label': 'Working day ends' });
    const dayChecks = dayNames.map((label, index) => {
      const box = el('input', { type: 'checkbox', class: 'task-check', checked: hours.days.includes(index), id: `work-day-${index}` });
      return { index, box, node: el('label', { class: 'task-label day-check', for: `work-day-${index}` }, box, el('span', {}, label)) };
    });

    /* Data retention: surface archived candidates past the window. */
    const retention = el(
      'select',
      { class: 'select', 'aria-label': 'Keep archived candidates' },
      RETENTION_OPTIONS.map((o) =>
        el('option', { value: o.value, selected: String(settings.retentionMonths ?? '') === o.value }, o.label)
      )
    );
    const dueCount = retentionDue(store.state).length;

    const save = el('button', { class: 'btn btn-primary' }, 'Save');
    save.addEventListener('click', async () => {
      stash();
      if (stageDraft.some((s) => !s.label.trim())) {
        toast('Every pipeline stage needs a name.', 'error');
        return;
      }
      /* workingHours() falls back to the default window whenever the
         stored one cannot be used, so an inverted range — or a week with
         no working days — was written to storage, reported as saved, and
         then quietly ignored: the dialog reopened reading 09:00–18:00,
         Mon–Fri, and "Suggest open times" kept using those. Say so
         instead, the way an unnamed stage above is refused. */
      const workDays = dayChecks.filter((d) => d.box.checked).map((d) => d.index);
      const workFrom = toMinutes(workStart.value);
      const workTo = toMinutes(workEnd.value);
      if (workFrom === null || workTo === null) {
        toast('Set when your working day starts and ends.', 'error');
        return;
      }
      if (workTo <= workFrom) {
        toast('The working day has to end after it starts.', 'error');
        return;
      }
      if (workDays.length === 0) {
        toast('Pick at least one working day — open interview times are suggested inside them.', 'error');
        return;
      }
      // The same test publishing applies: the address is baked into every
      // live page's apply button, and there is no second chance to notice
      // a typo there.
      const applyTo = applyEmail.value.trim();
      if (applyTo && !applyTo.includes('@')) {
        toast('That does not look like an email address applications can reach.', 'error');
        return;
      }
      // And a live page cannot be left with nowhere to apply: clearing the
      // address re-renders every published posting without its apply
      // button, so the page would invite nobody to do anything.
      const livePages = store.state.jobs.filter((j) => j.published && j.status === 'open').length;
      if (!applyTo && livePages > 0) {
        toast(
          `${plural(livePages, 'job page')} ${livePages === 1 ? 'is' : 'are'} live and ${livePages === 1 ? 'needs' : 'need'} an address for the apply button. Unpublish first if you want the pages without one.`,
          'error'
        );
        return;
      }
      save.disabled = true;
      // Store only real overrides so improved defaults reach existing users.
      const overrides = {};
      for (const t of EMAIL_TEMPLATES) {
        const draft = drafts[t.key];
        if (draft.subject !== t.subject || draft.body !== t.body) overrides[t.key] = { ...draft };
      }
      const letterBody = drafts[LETTER_KEY].body;
      // Warn (without blocking) about placeholders nothing will fill in —
      // for the emails as well as the letter, since each email template
      // is rendered with only its own handful of values.
      const unknown = new Set();
      for (const t of EMAIL_TEMPLATES) {
        const allowed = templateVariables(t.key);
        for (const text of [drafts[t.key].subject, drafts[t.key].body]) {
          for (const name of templatePlaceholders(text)) if (!allowed.includes(name)) unknown.add(name);
        }
      }
      for (const name of templatePlaceholders(letterBody)) {
        if (!OFFER_TEMPLATE_VARIABLES.includes(name)) unknown.add(name);
      }
      if (unknown.size > 0) {
        toast(`Heads up: {{${[...unknown].join('}}, {{')}}} won’t be filled in and will render blank.`, 'error');
      }
      // Persist the stage list only when it was actually edited, so an
      // untouched account keeps following the app defaults.
      const cleanStages = stageDraft.map((s) => ({ key: s.key, label: s.label.trim() }));
      const stagesChanged = JSON.stringify(cleanStages) !== JSON.stringify(stagesAtOpen);
      const companyRenamed = company.value.trim() !== String(settings.companyName ?? '').trim();
      const applyAddressChanged = applyTo !== String(settings.applyEmail ?? '').trim();
      try {
        await store.updateSettings({
          companyName: company.value.trim(),
          applyEmail: applyTo,
          timeZone: timeZone.value,
          emailTemplates: overrides,
          offerTemplate: letterBody.trim() && letterBody !== DEFAULT_OFFER_TEMPLATE ? letterBody : null,
          retentionMonths: retention.value ? Number(retention.value) : null,
          ...(stagesChanged
            ? {
                stages: cleanStages,
                retiredStages: { ...(settings.retiredStages ?? {}), ...retiredDraft },
              }
            : {}),
          workingHours: { start: workStart.value, end: workEnd.value, days: workDays },
          reminders: {
            browser: reminderChecks.browser.checked,
            interviews: reminderChecks.interviews.checked,
            proposals: reminderChecks.proposals.checked,
            offers: reminderChecks.offers.checked,
            scorecards: reminderChecks.scorecards.checked,
            followups: reminderChecks.followups.checked,
            onboarding: reminderChecks.onboarding.checked,
          },
        });
      } catch (err) {
        save.disabled = false;
        toast(err.message, 'error');
        return;
      }
      modal.close();
      toast('Settings saved');
      // Every published job page prints the company name — in its heading,
      // its <title>, its share card, and its JobPosting data — and bakes
      // the applications address into its apply button; so does the index
      // of open roles. They are static files, so a change here left the
      // live site introducing the company under its old name, or sending
      // applicants to an address nobody reads, until each job happened to
      // be edited. Re-render them (best-effort: a failure here must not
      // cast doubt on the settings that did save).
      if (companyRenamed || applyAddressChanged) {
        try {
          await reconcilePublishedPages(ctx);
        } catch (err) {
          console.error(err);
          toast('Couldn’t update the published job pages. Review them from the Jobs view.', 'error');
        }
      }
    });
    company.addEventListener('keydown', (e) => e.key === 'Enter' && save.click());

    const modal = openModal({
      title: 'Settings',
      wide: true,
      content: [
        field('Company name', company, 'set-company'),
        el(
          'div',
          { class: 'field' },
          el('label', { for: 'set-apply-email' }, 'Applications go to'),
          applyEmail,
          el(
            'p',
            { class: 'muted small' },
            'Where the apply button on your published job pages sends applications. Changing it re-renders the pages that are live.'
          )
        ),
        el(
          'div',
          { class: 'field' },
          el('label', {}, 'Pipeline stages'),
          stageRows,
          el('div', { class: 'input-row' }, addStage),
          el(
            'p',
            { class: 'muted small' },
            // The tooltip on a disabled button reaches neither keyboard nor
            // touch, so the rule that blocks the click is spelled out here.
            'Applied and Hired anchor the pipeline, and signing an offer still hires the candidate. Renaming keeps candidate history; a stage holding candidates can’t be removed, archived ones included, since this is the stage they would be restored to.'
          )
        ),
        el(
          'div',
          { class: 'field' },
          el('label', {}, 'Email & letter templates'),
          el('div', { class: 'input-row' }, picker, reset),
          subject,
          body,
          variablesHint
        ),
        el(
          'div',
          { class: 'field' },
          el('label', { for: 'set-zone' }, 'Interview time zone'),
          timeZone,
          el(
            'p',
            { class: 'muted small' },
            'The zone new interviews are scheduled in, and the one their invitations and calendar files name. Each interview can override it, and a candidate with a time zone of their own gets both readings shown.'
          )
        ),
        el(
          'div',
          { class: 'field' },
          el('label', {}, 'Working hours'),
          el('div', { class: 'input-row' }, workStart, el('span', { class: 'input-sep', 'aria-hidden': 'true' }, '–'), workEnd),
          el('div', { class: 'day-checks' }, dayChecks.map((d) => d.node)),
          el(
            'p',
            { class: 'muted small' },
            'Where “Suggest open times” looks when you propose interview slots. It never suggests a time that is already booked.'
          )
        ),
        el(
          'div',
          { class: 'field' },
          el('label', {}, 'Interview guides'),
          el(
            'div',
            { class: 'input-row' },
            el(
              'button',
              {
                class: 'btn btn-sm',
                onClick: async () => {
                  if ((await modalRef.current?.requestClose()) === false) return;
                  openGuidesEditor(ctx);
                },
              },
              icon('list-checks', 14),
              'Edit interview guides…'
            ),
            el(
              'span',
              { class: 'muted small' },
              guidesFrom(settings).length > 0 ? plural(guidesFrom(settings).length, 'guide') : 'None yet'
            )
          ),
          el(
            'p',
            { class: 'muted small' },
            'The questions behind an interview. Attach a guide to a format or a stage and scheduling picks it by default; the scorecard then asks for a note per question, beside the dimension it feeds.'
          )
        ),
        el(
          'div',
          { class: 'field' },
          el('label', {}, 'Onboarding templates'),
          el(
            'div',
            { class: 'input-row' },
            el(
              'button',
              {
                class: 'btn btn-sm',
                onClick: async () => {
                  if ((await modalRef.current?.requestClose()) === false) return;
                  openTemplatesEditor(ctx);
                },
              },
              icon('rocket', 14),
              'Edit onboarding templates…'
            ),
            el('span', { class: 'muted small' }, plural(onboardingTemplates(settings).length, 'template'))
          ),
          el(
            'p',
            { class: 'muted small' },
            'The checklist a signed offer stamps onto a new hire. Attach a template to a job or a department, and give a task a date relative to the start date so it comes due instead of only sitting unticked.'
          )
        ),
        el(
          'div',
          { class: 'field' },
          el('label', {}, 'Interview calendar'),
          el(
            'div',
            { class: 'input-row' },
            el(
              'button',
              {
                class: 'btn btn-sm',
                // Swapping one dialog for another is a dismissal, not a
                // save: unsaved settings get the same "Discard changes?".
                onClick: async () => {
                  if ((await modalRef.current?.requestClose()) === false) return;
                  openCalendarShare(ctx);
                },
              },
              icon('calendar', 14),
              calendarFeedUrl(settings) ? 'Manage the calendar link…' : 'Subscribe in your calendar…'
            ),
            calendarFeedUrl(settings) ? el('span', { class: 'muted small' }, 'Sharing is on') : null
          ),
          el(
            'p',
            { class: 'muted small' },
            'Publishes your interviews as one calendar your own app can subscribe to, instead of a file per interview. The link is public but unlisted; the dialog explains exactly what it carries.'
          )
        ),
        el(
          'div',
          { class: 'field' },
          el('label', {}, 'Reminders'),
          el('label', { class: 'task-label', for: 'rem-browser' }, browserCheck, el('span', {}, 'Browser notifications (asks for permission)')),
          reminderRow('interviews', 'Interviews starting soon'),
          reminderRow('proposals', 'Proposed interview times with no reply'),
          reminderRow('offers', 'Offers expiring within 3 days'),
          reminderRow('scorecards', 'Interviews still missing a scorecard'),
          reminderRow('followups', 'Follow-ups that are due'),
          reminderRow('onboarding', 'Onboarding tasks coming due'),
          el('p', { class: 'muted small' }, 'There is no server behind the app, so notifications fire only while a tab is open. The same items appear under Needs attention on the overview.')
        ),
        el(
          'div',
          { class: 'field' },
          el('label', {}, 'Keep archived candidates'),
          el(
            'div',
            { class: 'input-row' },
            retention,
            dueCount > 0
              ? el(
                  'button',
                  {
                    class: 'btn btn-sm',
                    // Swapping one dialog for another is a dismissal, like
                    // the four buttons above: this one skipped the check,
                    // so it stacked a review that permanently deletes
                    // records over a settings form with unsaved edits, and
                    // came back to a count the deletions had made stale.
                    onClick: async () => {
                      if ((await modalRef.current?.requestClose()) === false) return;
                      openRetentionReview(ctx);
                    },
                  },
                  icon('hourglass', 14),
                  `Review ${dueCount} due`
                )
              : null
          ),
          el(
            'p',
            { class: 'muted small' },
            'Archived candidates older than the window surface for review, here and on the pipeline’s Archived tab. Nothing is deleted without your confirmation, and talent-pool members are always kept.'
          )
        ),
        dataSection(modalRef),
      ],
      footer: [el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'), save],
    });
    applyEmail.id = 'set-apply-email';
    timeZone.id = 'set-zone';
    modalRef.current = modal;
  }

  /** Import, CSV export, and backup/restore controls for the settings dialog. */
  function dataSection(modalRef) {
    const stamp = todayISO();
    // Filled in once the drive answers: the dialog must open immediately,
    // and a slow (or failed) listing is only a missing line of detail.
    const snapshotNote = el('span', { class: 'muted small' });
    snapshotSummary(store).then((text) => {
      snapshotNote.textContent = text;
    });
    const exportButton = (label, make, filename) =>
      el(
        'button',
        {
          class: 'btn btn-sm',
          onClick: () => {
            downloadFile(filename, make(store.state), 'text/csv');
            toast(`${label} exported`);
          },
        },
        icon('download', 14),
        label
      );

    const restoreInput = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    restoreInput.addEventListener('change', async () => {
      const file = restoreInput.files[0];
      restoreInput.value = '';
      if (!file) return;
      let payload;
      try {
        payload = JSON.parse(await file.text());
      } catch {
        toast('That file is not valid JSON.', 'error');
        return;
      }
      const problems = validateBackup(payload);
      if (problems.length > 0) {
        toast(problems.join(' '), 'error');
        return;
      }
      const ok = await confirmDialog({
        title: 'Restore this backup?',
        message: `Everything currently in the app is replaced by the backup from ${formatTimestamp(payload.exportedAt) || 'an unknown date'} (${plural(payload.data.jobs.length, 'job')}, ${plural(payload.data.candidates.length, 'candidate')}).`,
        confirmLabel: 'Replace everything',
        danger: true,
      });
      if (!ok) return;
      try {
        await store.restoreBackup(payload);
        modalRef.current?.close();
        toast('Backup restored');
      } catch (err) {
        toast(err.message, 'error');
        return;
      }
      // The hosted job pages must match the restored data — a restore can
      // drop jobs whose pages would otherwise stay public with no record
      // (and no Unpublish button) left pointing at them. Best-effort: a
      // failure here must not cast doubt on the completed restore.
      try {
        await reconcilePublishedPages(ctx);
      } catch (err) {
        console.error(err);
        toast('Couldn’t sync the published job pages. Review them from the Jobs view.', 'error');
      }
    });

    return el(
      'div',
      { class: 'field' },
      el('label', {}, 'Data'),
      el(
        'div',
        { class: 'data-actions' },
        el(
          'button',
          {
            class: 'btn btn-sm',
            // These swap the Settings dialog for another one, so they are
            // a dismissal, not a Save/Cancel: edited-but-unsaved settings
            // get the same "Discard changes?" stop as a scrim click.
            onClick: async () => {
              if ((await modalRef.current?.requestClose()) === false) return;
              openImportWizard(ctx);
            },
          },
          icon('upload', 14),
          'Import candidates'
        ),
        el(
          'button',
          {
            class: 'btn btn-sm',
            onClick: async () => {
              if ((await modalRef.current?.requestClose()) === false) return;
              openPasteApplication(ctx);
            },
          },
          icon('mail', 14),
          'Paste application'
        ),
        exportButton('Candidates CSV', candidatesCSV, `hiring-candidates-${stamp}.csv`),
        exportButton('Interviews CSV', interviewsCSV, `hiring-interviews-${stamp}.csv`),
        exportButton('Offers CSV', offersCSV, `hiring-offers-${stamp}.csv`)
      ),
      el(
        'div',
        { class: 'data-actions' },
        el(
          'button',
          {
            class: 'btn btn-sm',
            onClick: () => {
              downloadFile(`hiring-backup-${stamp}.json`, JSON.stringify(buildBackup(store.state), null, 2), 'application/json');
              toast('Backup downloaded');
            },
          },
          icon('download', 14),
          'Download backup'
        ),
        el('button', { class: 'btn btn-sm', onClick: () => restoreInput.click() }, icon('restore', 14), 'Restore backup'),
        restoreInput,
        el(
          'button',
          {
            class: 'btn btn-sm',
            onClick: async () => {
              if ((await modalRef.current?.requestClose()) === false) return;
              openSnapshots(ctx);
            },
          },
          icon('cloud', 14),
          'Snapshots…'
        ),
        snapshotNote
      ),
      el('p', { class: 'muted small' }, 'The backup file holds every job, candidate, interview, scorecard, offer, and setting. Attachments live in your Puter cloud and are not part of it. The app also keeps its own dated snapshots in your drive, including one taken before anything irreversible.')
    );
  }

  function navButton(name, className) {
    const view = VIEWS[name];
    const route = parseRoute();
    const activeName = VIEWS[route.name].nav ?? route.name;
    const today = todayISO();
    // Both badges count live work, so they follow the Overview's stats and
    // the reminders in skipping archived candidates: an interview kept only
    // for cleanup used to make the sidebar read "Interviews 1" beside an
    // Overview stat that said "Nothing today", and a sent offer nobody can
    // sign any more inflated the offer badge the same way. A proposal is
    // the same kind of overcount: its date mirrors the earliest option so
    // the schedule can order it, but nobody has agreed to that time — the
    // Overview's stat, the upcoming list, and the shared calendar all
    // leave proposals out, and the badge said "3 today" against an
    // Overview reading "Nothing today".
    const { candidates } = store.state;
    const badgeCount =
      name === 'interviews'
        ? onActiveCandidates(store.state.interviews, candidates).filter((i) => i.date === today && !isProposed(i)).length
        : name === 'offers'
          ? onActiveCandidates(store.state.offers, candidates).filter((o) => o.status === OFFER_STATUS.SENT).length
          : 0;
    return el(
      'button',
      {
        class: className,
        'aria-current': activeName === name ? 'page' : null,
        // Navigation replaces the sidebar and tabbar; the focus key hands
        // keyboard focus to this button's successor (keys are per bar —
        // the sidebar and tabbar both hold a button for the same view).
        dataset: { focusKey: `nav-${className}-${name}` },
        onClick: () => ctx.navigate(name),
      },
      icon(view.icon, className === 'tab-item' ? 20 : 17),
      el('span', {}, view.title),
      // The tab bar used to be excluded, so the app's only ambient signal
      // that work is waiting — interviews today, offers out — existed on
      // desktop and vanished on a phone, where the sidebar that carries
      // it is hidden. Same counter on both bars; the tab bar's CSS lifts
      // it onto the icon rather than parking it beside a label.
      badgeCount > 0 ? el('span', { class: 'nav-badge' }, String(badgeCount)) : null
    );
  }

  function sidebar() {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    return el(
      'aside',
      { class: 'sidebar' },
      el(
        'div',
        { class: 'brand' },
        brandMark(30),
        el('div', { class: 'brand-name' }, 'Hiring')
      ),
      el(
        'button',
        // Focus keys on the sidebar's utility buttons: render() swaps the
        // whole sidebar on every notify, so a dialog opened from one of
        // these needs the key to hand focus back after a save.
        { class: 'nav-item nav-search', dataset: { focusKey: 'sidebar-search' }, onClick: () => openQuickFind(ctx) },
        icon('search', 17),
        el('span', {}, 'Search'),
        el('kbd', { class: 'nav-kbd' }, isMac ? '⌘K' : 'Ctrl K')
      ),
      el('nav', { class: 'nav', 'aria-label': 'Main' }, SIDEBAR_ORDER.map((name) => navButton(name, 'nav-item'))),
      el(
        'div',
        { class: 'sidebar-footer' },
        el(
          'div',
          { class: 'user-card' },
          // Decorative, like every avatar() in the views: the username it
          // abbreviates is the very next thing in the card, so without
          // this the footer reads "D demo, Signed in".
          el('span', { class: 'avatar', style: { '--person': 'var(--accent)' }, 'aria-hidden': 'true' }, user ? initials(user.username ?? 'U') : icon('circle-user', 16)),
          el(
            'div',
            { class: 'user-info' },
            el('div', { class: 'name' }, user?.username ?? 'Account'),
            el('div', { class: 'meta' }, 'Signed in')
          ),
          el(
            'button',
            { class: 'btn btn-ghost btn-icon', 'aria-label': 'Settings', title: 'Settings', dataset: { focusKey: 'sidebar-settings' }, onClick: openSettings },
            icon('settings', 16)
          ),
          themeButton('sidebar-theme'),
          canSignOut
            ? el(
                'button',
                { class: 'btn btn-ghost btn-icon', 'aria-label': 'Sign out', title: 'Sign out', dataset: { focusKey: 'sidebar-signout' }, onClick: onSignOut },
                icon('log-out', 16)
              )
            : null
        ),
        el(
          'div',
          { class: 'powered' },
          'Powered by ',
          el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noreferrer' }, 'Puter')
        )
      )
    );
  }

  function mobileTopbar() {
    return el(
      'header',
      { class: 'mobile-topbar' },
      brandMark(28),
      el('div', { class: 'brand-name' }, 'Hiring'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-ghost btn-icon', 'aria-label': 'Search', onClick: () => openQuickFind(ctx) }, icon('search', 16)),
      el('button', { class: 'btn btn-ghost btn-icon', 'aria-label': 'Settings', onClick: openSettings }, icon('settings', 16)),
      themeButton(),
      canSignOut
        ? el('button', { class: 'btn btn-ghost btn-icon', 'aria-label': 'Sign out', onClick: onSignOut }, icon('log-out', 16))
        : null
    );
  }

  /** The views the tab bar has no room for, as a sheet. */
  function openMoreNav() {
    const here = VIEWS[parseRoute().name].nav ?? parseRoute().name;
    const modal = openModal({
      title: 'More',
      content: el(
        'nav',
        { class: 'nav-sheet', 'aria-label': 'More views' },
        TABBAR_MORE.map((name) =>
          el(
            'button',
            {
              class: 'nav-item',
              'aria-current': here === name ? 'page' : null,
              onClick: () => {
                modal.close();
                ctx.navigate(name);
              },
            },
            icon(VIEWS[name].icon, 18),
            el('span', {}, VIEWS[name].title)
          )
        )
      ),
    });
  }

  function tabbar() {
    const route = parseRoute();
    const activeName = VIEWS[route.name].nav ?? route.name;
    return el(
      'nav',
      { class: 'tabbar', 'aria-label': 'Main' },
      el(
        'div',
        { class: 'tabbar-inner' },
        TABBAR_ORDER.map((name) => navButton(name, 'tab-item')),
        TABBAR_MORE.length > 0
          ? el(
              'button',
              {
                class: 'tab-item',
                // Highlighted while one of its own views is on screen, so
                // the bar never reads as if nothing is selected.
                'aria-current': TABBAR_MORE.includes(activeName) ? 'page' : null,
                'aria-haspopup': 'dialog',
                dataset: { focusKey: 'nav-tab-item-more' },
                onClick: openMoreNav,
              },
              icon('ellipsis', 20),
              el('span', {}, 'More')
            )
          : null
      )
    );
  }

  /* Sample-data banner: always visible while exploring, one-tap wipe. */
  const sampleBanner = el('div', { style: { display: 'contents' } });

  function renderSampleBanner() {
    sampleBanner.replaceChildren();
    if (!store.state.settings.sampleData) return;
    sampleBanner.appendChild(
      el(
        'div',
        { class: 'sample-banner' },
        icon('sparkles', 14),
        el('span', { class: 'grow' }, 'Sample data. Explore freely, nothing here is yours.'),
        el(
          'button',
          {
            class: 'btn btn-sm',
            onClick: async () => {
              // The wipe removes every record, not just the seeded ones —
              // sample mode is a sandbox ("nothing here is yours"). The
              // confirm must say so: a user who added a real job and
              // resumes while exploring loses them here, irreversibly.
              const ok = await confirmDialog({
                title: 'Start fresh?',
                message:
                  'This removes everything currently in the app: the sample records and anything you added while exploring, including uploaded files. Download a backup from Settings first if you want to keep any of it.',
                confirmLabel: 'Wipe everything',
                danger: true,
              });
              if (!ok) return;
              // Public pages must not outlive the jobs they describe; take
              // them down first, best-effort like a single job deletion.
              // Sequential, because each unpublish rewrites the site index.
              for (const job of store.state.jobs.filter((j) => j.published)) {
                await unpublishJob(ctx, job.id).catch(() => {});
              }
              try {
                await store.wipeSampleData();
              } catch (err) {
                console.error(err);
                toast('Couldn’t wipe the sample data. Check your connection.', 'error');
                return;
              }
              // The banner sits on every route, so the wipe can be run
              // from a job or a candidate it just removed. Deleting one
              // record sends you back to its list; deleting all of them
              // must not leave a deliberate fresh start reading "Job not
              // found · It may have been deleted".
              ctx.navigate('dashboard');
              openOnboarding(store, ctx);
            },
          },
          'Start fresh'
        )
      )
    );
  }

  const content = el('main', { class: 'content' });
  const shell = el(
    'div',
    { class: 'app' },
    sidebar(),
    el('div', { class: 'main' }, mobileTopbar(), sampleBanner, content),
    tabbar(),
    el(
      'button',
      { class: 'fab', 'aria-label': 'Add candidate', onClick: () => openCandidateEditor(ctx) },
      icon('user-plus', 22)
    )
  );

  function render() {
    const route = parseRoute();
    const view = VIEWS[route.name];

    // Re-rendering replaces every node. Elements that take repeated typing
    // (search, add-a-task) carry a data-focus-key; remember which one held
    // focus and where the caret was, and hand both back afterwards.
    const previous = document.activeElement;
    const focusKey =
      previous instanceof HTMLElement && shell.contains(previous) ? previous.dataset.focusKey : null;
    const selection =
      focusKey && typeof previous.selectionStart === 'number'
        ? { start: previous.selectionStart, end: previous.selectionEnd }
        : null;

    const scrollTop = content.scrollTop;
    // Scroll containers inside the view (the board's horizontal axis) are
    // replaced along with everything else; remember their positions by
    // key — the same convention focus restoration uses — and hand them
    // back after the swap.
    const scrolls = new Map();
    for (const node of content.querySelectorAll('[data-scroll-key]')) {
      if (node.scrollLeft || node.scrollTop) {
        scrolls.set(node.dataset.scrollKey, { left: node.scrollLeft, top: node.scrollTop });
      }
    }
    mount(content, el('div', { class: 'content-inner' }, view.render(ctx, route.param)));
    content.scrollTop = scrollTop;
    for (const [key, pos] of scrolls) {
      const node = content.querySelector(`[data-scroll-key="${CSS.escape(key)}"]`);
      if (node) {
        node.scrollLeft = pos.left;
        node.scrollTop = pos.top;
      }
    }

    // Sync nav highlight, badges, and the sample-data banner — before the
    // focus handoff, since the focused element may be a nav button.
    shell.querySelector('.sidebar').replaceWith(sidebar());
    shell.querySelector('.tabbar').replaceWith(tabbar());
    renderSampleBanner();

    // An open theme menu anchored to a button the swap just destroyed
    // would strand focus on close and report aria-expanded="false" while
    // visibly open; hand it the replacement button (found by focus key).
    if (themeMenu && !themeMenu.anchor.isConnected) {
      const key = themeMenu.anchor.dataset.focusKey;
      const next = key ? shell.querySelector(`[data-focus-key="${CSS.escape(key)}"]`) : null;
      if (next) themeMenu.reanchor(next);
      else themeMenu.close();
    }

    if (focusKey) {
      const replacement = shell.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
      if (replacement) {
        replacement.focus();
        if (selection && typeof replacement.setSelectionRange === 'function') {
          const max = replacement.value.length;
          try {
            replacement.setSelectionRange(Math.min(selection.start, max), Math.min(selection.end, max));
          } catch {}
        }
      }
    }

    document.title = `${view.title} · Hiring`;
  }

  const unsubscribe = store.subscribe(() => render());
  const stopNotifications = startNotifications(ctx);
  // A shared calendar has to keep up with the data on its own: interviews
  // change from half a dozen places, and a feed only some of them updated
  // would be worse than no feed at all.
  const stopFeedSync = startFeedSync(ctx);
  const onHashChange = () => {
    content.scrollTop = 0;
    render();
    content.scrollTop = 0;
  };
  const onGlobalKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      // An open dialog owns the screen (aria-modal): summoning the palette
      // over it and picking a result would swap the view underneath while
      // the dialog floated on, detached from what it was opened for.
      if (document.querySelector('.modal-overlay:not(.palette-overlay)')) return;
      openQuickFind(ctx);
    }
  };
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('keydown', onGlobalKey);
  // The auth screen's recovery path can re-run bootSignedIn after a boot
  // that failed mid-start; the previous instance's globals must not keep
  // rendering a detached shell or double-handle every keystroke.
  teardownApp?.();
  teardownApp = () => {
    unsubscribe();
    stopNotifications();
    stopFeedSync();
    window.removeEventListener('hashchange', onHashChange);
    window.removeEventListener('keydown', onGlobalKey);
  };

  mount(document.body, shell);
  primeToastRegion();
  render();
  return ctx;
}
