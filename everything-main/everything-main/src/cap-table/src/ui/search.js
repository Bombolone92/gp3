/**
 * Global search: one field that finds any record on the cap table, and any
 * route, without leaving the keyboard.
 *
 * Everything here is searched in memory - a few hundred records at most - so
 * there is no index to maintain and no dependency to add. Ranking is exact
 * match, then prefix, then word start, then substring, with a record's own
 * name or label outranking the things around it (a holder's name on a
 * certificate, the class it belongs to): typing "CS-1" should land on the
 * certificate labelled CS-1, not on the ten others its holder also holds.
 *
 * The dialog owns focus the way every other dialog in the app does - Escape
 * closes, focus goes back where it came from - and the input keeps it while
 * the arrow keys move an active option (the combobox pattern), so typing
 * never has to stop to move the selection.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { openSecurityForm } from './securityform.js';
import { openClassForm } from '../views/classes.js';
import { openPlanLedger } from './planform.js';
import { departureNote } from './bits.js';
import { store } from '../lib/store.js';
import {
  stakeholderKindInfo, grantOutstanding, convertibleValue, rsuOutstanding,
  isClosed, isConverted, grantStatus, rsuStatus, cancellationHistory,
  isMatured, warrantRemaining, warrantExercised,
  plansOf, awardPlanId, planBalances, planIsOpen,
} from '../lib/captable.js';
import { shares, moneyCompact, dateLong, countLabel } from '../lib/format.js';
import { todayISO } from '../lib/util.js';

/** Result groups, in the order they appear, wearing the nav's own icons. */
const GROUPS = [
  { type: 'stakeholder', label: 'Stakeholders' },
  { type: 'security', label: 'Securities' },
  { type: 'class', label: 'Share classes' },
  { type: 'plan', label: 'Equity plans' },
  { type: 'round', label: 'Saved rounds' },
  { type: 'exit', label: 'Saved exits' },
  { type: 'route', label: 'Go to' },
];

const KIND_LABEL = {
  shares: 'Shares', option: 'Options', rsu: 'RSU', warrant: 'Warrant', safe: 'SAFE', note: 'Note',
};

/* Enough rows per group to answer the question, without a group of two
   hundred certificates burying every other kind of match. The heading says
   when there are more, rather than truncating silently. */
const MAX_PER_GROUP = 6;

/* Case- and accent-insensitive: both sides of every comparison pass through
   here, so "muller" finds Zoe Müller and "jose" finds José. Marks come off
   after decomposition, which leaves the string's length alone for the
   precomposed letters names are typed in. */
const norm = (value) => String(value ?? '').trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/**
 * How well one field answers the query: 0 exact, 1 prefix, 2 word start,
 * 3 substring anywhere, null for no match at all.
 */
function fieldScore(text, q) {
  const t = norm(text);
  if (!t || !q) return null;
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  const at = t.indexOf(q);
  if (at < 0) return null;
  // A match that starts a word ("chen" in "Ada Chen") is worth more than one
  // buried mid-word ("hen" in the same name).
  return /[\s\-/(,.]/.test(t[at - 1] || '') ? 2 : 3;
}

/* Fields that are the record itself outrank fields that merely describe it. */
const SECONDARY_PENALTY = 4;
/* Last resort: every word of the query appears somewhere ("opt sam"). */
const TOKEN_SCORE = 9;

function score(item, q) {
  let best = null;
  const consider = (value) => {
    if (value !== null && (best === null || value < best)) best = value;
  };
  for (const text of item.primary) consider(fieldScore(text, q));
  for (const text of item.secondary) {
    const s = fieldScore(text, q);
    if (s !== null) consider(s + SECONDARY_PENALTY);
  }
  if (best !== null) return best;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const haystack = norm([...item.primary, ...item.secondary].join(' '));
  return tokens.every((t) => haystack.includes(t)) ? TOKEN_SCORE : null;
}

/* The word for a lifecycle state the row should not read as still live. */
const GRANT_STATE = { cancelled: 'Cancelled', expired: 'Expired', exercised: 'Fully exercised' };
const RSU_STATE = { cancelled: 'Cancelled', settled: 'Fully settled' };

/**
 * What a security's row says about itself under its label - its size, and
 * where it stands once it has stopped being what its size says. A transferred
 * certificate read "3,800,000 shares" beside a holder who no longer had them,
 * and a converted SAFE read as money still waiting for a round.
 *
 * Exported for the tests; the dialog is the only other caller.
 */
export function securitySummary(security, asOf, securities = store.securities) {
  /* A cancellation dated ahead of today has not happened yet: "Cancels Nov 1"
     rather than "Cancelled", the tense the departure note already keeps. */
  const cancelled = (s) => {
    const last = cancellationHistory(s).at(-1)?.date || s.cancelledDate;
    return last && last > asOf ? `Cancels ${dateLong(last)}` : 'Cancelled';
  };
  if (security.kind === 'option') {
    const status = grantStatus(security, asOf);
    const state = status === 'cancelled' ? cancelled(security) : GRANT_STATE[status];
    return `${countLabel(grantOutstanding(security), 'option')}${state ? ` · ${state}` : ''}`;
  }
  if (security.kind === 'rsu') {
    const status = rsuStatus(security, asOf);
    const state = status === 'cancelled' ? cancelled(security) : RSU_STATE[status];
    return `${countLabel(rsuOutstanding(security), 'unit')}${state ? ` · ${state}` : ''}`;
  }
  if (security.kind === 'safe' || security.kind === 'note') {
    // A note recorded as matured and settled is no longer money waiting on a round.
    const state = isConverted(security) ? ' · Converted' : isMatured(security) ? ' · Matured' : '';
    return `${moneyCompact(convertibleValue(security, asOf))}${state}`;
  }
  if (security.kind === 'warrant') {
    /* What is left of the rights, not what was issued: a warrant exercised
       in full read "10,000 shares" beside a certificate holding them. An
       expired warrant reads the rights that lapsed, as its attention item does. */
    const lapsed = security.expires && security.expires < asOf;
    const remaining = warrantRemaining(security, securities, lapsed ? security.expires : asOf);
    const exercised = warrantExercised(security, securities);
    const spent = security.quantity - (security.cancelled || 0) - exercised <= 0;
    const state = spent
      ? (exercised > 0 && !(security.cancelled > 0) ? 'Fully exercised'
        : !exercised && security.cancelled > 0 ? cancelled(security) : 'Nothing outstanding')
      : lapsed ? 'Expired' : '';
    return `${countLabel(remaining, 'share')}${state ? ` · ${state}` : ''}`;
  }
  if (isClosed(security)) {
    return `${countLabel(security.quantity, 'share')} · `
      + `${security.closedReason === 'repurchase' ? 'Repurchased' : 'Transferred'} ${dateLong(security.closedAt)}`;
  }
  return countLabel(security.quantity, 'share');
}

/**
 * Everything searchable, as flat rows: { type, title, sub, icon, primary,
 * secondary, run }. Built per keystroke-free open, not per keystroke.
 */
function buildIndex({ routes, navigate, close }) {
  const items = [];
  const asOf = todayISO();

  for (const holder of store.stakeholders) {
    const kind = stakeholderKindInfo(holder.kind);
    items.push({
      type: 'stakeholder',
      title: holder.name,
      sub: [kind.label, holder.email,
        departureNote(holder, asOf),
        // Why a query on the old name landed here.
        holder.formerNames?.length ? `Formerly ${holder.formerNames[0]}` : null].filter(Boolean).join(' · '),
      icon: kind.icon,
      primary: [holder.name],
      // A name they went by before a rename still finds them.
      secondary: [holder.email, ...(holder.formerNames || [])],
      run: () => navigate(`#/stakeholders/${encodeURIComponent(holder.id)}`),
    });
  }

  const plans = plansOf(store.company);
  for (const security of store.securities) {
    const holder = store.stakeholder(security.stakeholderId);
    const cls = store.shareClass(security.classId);
    // The plan an award draws from finds it too, and shows once there are several.
    const plan = plans.find((p) => p.id === awardPlanId(security, plans)) || null;
    items.push({
      type: 'security',
      title: security.label,
      sub: [KIND_LABEL[security.kind], holder?.name, cls?.name, plans.length > 1 ? plan?.name : null,
        securitySummary(security, asOf)].filter(Boolean).join(' · '),
      icon: 'file-text',
      primary: [security.label],
      secondary: [holder?.name, cls?.name, KIND_LABEL[security.kind], plan?.name],
      // No detail view for a security, so its own form is the record.
      run: () => openSecurityForm({ existing: security }),
    });
  }

  for (const plan of store.company.plans) {
    const row = planBalances(store.db).plans.find((r) => r.planId === plan.id);
    items.push({
      type: 'plan',
      title: plan.name,
      sub: [planIsOpen(plan) ? 'Equity plan' : 'Equity plan · retired',
        row ? `${shares(Math.max(0, row.available))} available of ${shares(row.authorized)}` : null].filter(Boolean).join(' · '),
      icon: 'wallet',
      primary: [plan.name],
      secondary: ['plan', 'equity plan', 'option pool'],
      // No detail view for a plan: its movements sheet is the record.
      run: () => openPlanLedger(plan),
    });
  }

  for (const cls of store.classes) {
    items.push({
      type: 'class',
      title: cls.name,
      sub: cls.kind === 'preferred'
        ? `Preferred · ${cls.liquidationMultiple}x${cls.participating ? ' participating' : ''}`
        : 'Common',
      icon: 'layers',
      primary: [cls.name],
      secondary: [cls.kind === 'preferred' ? 'Preferred' : 'Common'],
      run: () => openClassForm(cls),
    });
  }

  for (const scenario of store.scenarios) {
    items.push({
      type: 'round',
      title: scenario.name,
      sub: `${moneyCompact(scenario.preMoney)} pre · ${moneyCompact(scenario.investment)} in`,
      icon: 'trending-up',
      primary: [scenario.name],
      secondary: ['round', 'scenario'],
      // The saved terms load into the round model, which is where the
      // scenario means anything.
      run: () => navigate(`#/rounds?scenario=${encodeURIComponent(scenario.id)}`),
    });
  }

  for (const scenario of store.exits) {
    items.push({
      type: 'exit',
      title: scenario.name,
      sub: `${moneyCompact(scenario.exitValue)} sale price`,
      icon: 'scale',
      primary: [scenario.name],
      secondary: ['exit', 'scenario', 'waterfall'],
      run: () => navigate(`#/exit?scenario=${encodeURIComponent(scenario.id)}`),
    });
  }

  for (const route of routes) {
    items.push({
      type: 'route',
      title: route.label,
      sub: route.sub || 'Go to this page',
      icon: route.icon,
      primary: [route.label],
      secondary: [route.hash.replace(/^#\//, '')],
      run: () => navigate(route.hash),
    });
  }

  // Every row closes the dialog before it acts, so a form that opens on top
  // isn't stacked behind this one - the same order the other action sheets
  // in the app use.
  return items.map((item) => ({
    ...item,
    activate: () => { close(); item.run(); },
  }));
}

/**
 * Ranked, grouped results for a query. `''` offers the routes as jumps.
 * Pure over the index, which is what makes the ranking testable.
 */
export function rankResults(index, query) {
  const q = norm(query);
  const hits = q
    ? index
      .map((item) => ({ item, rank: score(item, q) }))
      .filter((hit) => hit.rank !== null)
      .sort((a, b) => a.rank - b.rank
        || GROUPS.findIndex((g) => g.type === a.item.type) - GROUPS.findIndex((g) => g.type === b.item.type)
        || a.item.title.localeCompare(b.item.title))
      .map((hit) => hit.item)
    : index.filter((item) => item.type === 'route');
  /* The empty field offers the whole jump list rather than results: there is
     nothing here for a per-group cap to protect the reader from, and a list
     of destinations that hides two of them is just a list with a gap. */
  const cap = q ? MAX_PER_GROUP : Infinity;

  /* Groups appear in the order their best match did, so the kind of record
     that answered the query best leads - typing a holder's name puts
     Stakeholders first, typing "CS-" puts Securities first. */
  const groups = [];
  const byType = new Map();
  for (const item of hits) {
    let group = byType.get(item.type);
    if (!group) {
      group = { type: item.type, label: GROUPS.find((g) => g.type === item.type).label, items: [], total: 0 };
      byType.set(item.type, group);
      groups.push(group);
    }
    group.total += 1;
    if (group.items.length < cap) group.items.push(item);
  }
  return { groups, total: hits.length, shown: groups.reduce((a, g) => a + g.items.length, 0) };
}

let seq = 0;

/**
 * Open the search dialog. `routes` are the shell's own destinations, so the
 * same field jumps to a page as well as to a record.
 */
export function openSearch({ routes = [], navigate = () => {} } = {}) {
  const id = `search-${++seq}`;
  const resultsId = `${id}-results`;

  const input = el('input.input.search-input', {
    type: 'search',
    autocomplete: 'off',
    // A search field is the one control whose value the browser must not
    // "helpfully" capitalize or correct on a phone keyboard.
    autocapitalize: 'off',
    placeholder: 'Search holders, securities, classes, pages',
    'aria-label': 'Search the cap table',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': resultsId,
    'aria-autocomplete': 'list',
  });
  /* Set on the element rather than passed to el(), which skips every false
     attribute so that `disabled: false` and `checked: false` mean absent -
     and so left this field spellchecked, red-underlining every holder's
     surname and certificate label as it was typed. */
  input.spellcheck = false;
  const results = el('div.search-results', {
    id: resultsId, role: 'listbox', 'aria-label': 'Search results',
  });
  /* Beside the listbox, not inside it: a listbox may only own options, and
     the empty message rendered as its one child was read as an empty list or
     as nothing by screen readers while the combobox still said expanded. */
  const empty = el('p.search-empty', { hidden: true });
  /* The count is announced rather than left to be discovered: the results
     are below a field that keeps focus, so a screen reader user gets no
     event from them changing. */
  const status = el('div.visually-hidden', { role: 'status', 'aria-live': 'polite' });

  const modal = openModal({
    title: 'Search',
    content: el('div', {},
      el('div.search-field', {},
        el('span.search-ic', { html: icon('search', 17, 2), 'aria-hidden': 'true' }),
        input),
      results,
      empty,
      status,
      el('p.search-hint', {},
        'Enter opens · arrow keys move · Escape closes')),
  });

  const index = buildIndex({ routes, navigate, close: modal.close });

  let rows = [];
  let active = 0;

  function setActive(next, { scroll = true } = {}) {
    if (!rows.length) return;
    active = (next + rows.length) % rows.length;
    for (const [i, row] of rows.entries()) {
      const on = i === active;
      row.node.setAttribute('aria-selected', String(on));
      row.node.classList.toggle('is-active', on);
    }
    input.setAttribute('aria-activedescendant', rows[active].node.id);
    if (scroll) rows[active].node.scrollIntoView({ block: 'nearest' });
  }

  function render() {
    const query = input.value;
    const { groups, total, shown } = rankResults(index, query);
    rows = [];
    results.replaceChildren();

    if (!groups.length) {
      input.removeAttribute('aria-activedescendant');
      input.setAttribute('aria-expanded', 'false');
      results.hidden = true;
      empty.hidden = false;
      empty.textContent = `Nothing matches “${query.trim()}”. Try a holder’s name, a certificate label, or a page.`;
      status.textContent = 'No results';
      return;
    }
    input.setAttribute('aria-expanded', 'true');
    results.hidden = false;
    empty.hidden = true;

    for (const group of groups) {
      const headingId = `${id}-g-${group.type}`;
      const groupNode = el('div.search-group', { role: 'group', 'aria-labelledby': headingId },
        el('div.search-group-head', { id: headingId },
          el('span.grow', {}, group.label),
          group.total > group.items.length
            ? el('span.small.muted', {}, `${group.items.length} of ${group.total}`)
            : null));
      for (const item of group.items) {
        const node = el('div.search-row', {
          role: 'option',
          id: `${id}-o-${rows.length}`,
          'aria-selected': 'false',
        },
          el('span.search-row-ic', { html: icon(item.icon, 16, 1.9), 'aria-hidden': 'true' }),
          el('span.grow', {},
            el('div.t', {}, item.title),
            item.sub ? el('div.s', {}, item.sub) : null),
          el('span.search-row-go', { html: icon('arrowR', 15, 2), 'aria-hidden': 'true' }));
        const i = rows.length;
        /* The press keeps focus in the field (a row is an option, not a
           control that can hold focus), and the click does the work - one
           listener each, so a mouse click can't activate the row twice. */
        node.addEventListener('mousedown', (e) => e.preventDefault());
        node.addEventListener('click', () => item.activate());
        node.addEventListener('mousemove', () => { if (i !== active) setActive(i, { scroll: false }); });
        rows.push({ node, item });
        groupNode.append(node);
      }
      results.append(groupNode);
    }

    setActive(0, { scroll: false });
    status.textContent = total === 1
      ? '1 result'
      : shown < total ? `${total} results, ${shown} shown` : `${total} results`;
  }

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    /* Keys spent on an IME composition (picking a candidate with the arrows,
       confirming it with Enter) are the composition's, not the list's: taken
       here, Enter opened the first result while a Japanese or Chinese name
       was still being typed. Chrome reports them as "Process" with keyCode
       229; Safari sends the real key with isComposing set. */
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      rows[active]?.item.activate();
    }
    /* Home and End are left to the field: in an editable combobox they move
       the caret to the start and end of what was typed, which is what a
       keyboard user reaching for them mid-edit means. Taken for the list,
       they jumped the selection to the first or last row instead and the
       caret stayed where it was. The rows are a few arrow presses apart.
       Escape is the dialog's, so it closes here exactly as it does elsewhere. */
  });

  render();
  /* Focus the field on every screen size, unlike the form sheets: this dialog
     exists to be typed into, so the phone keyboard coming up with it is the
     point rather than an ambush. One microtask later, so it lands after
     openModal's own first-paint focus rather than being undone by it. */
  queueMicrotask(() => { if (input.isConnected) input.focus(); });
  return modal;
}
