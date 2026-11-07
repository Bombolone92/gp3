/**
 * Banking: statement lines to review, categorize, match, or exclude.
 */
import { el, append, clear, pickFile, swap } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { amountNode, dateText } from '../ui/format.js';
import { toast, toastError } from '../ui/toast.js';
import { openDialog } from '../ui/dialog.js';
import { selectInput, checkbox, field, textInput } from '../ui/fields.js';
import { navigate, setQuery } from '../ui/router.js';
import { pageHead, splitButton, searchBox, emptyState, viewState, tabs, freshQuery } from './page.js';
import { accountPicker, contactPicker } from '../forms/common.js';
import { openAccountForm } from '../forms/account.js';
import { openTxn } from '../forms/index.js';
import { openRuleForm } from './rules.js';
import { store } from '../lib/store.js';
import { typeLabel } from '../lib/txn.js';
import { formatMoney } from '../lib/money.js';
import { formatDate, today } from '../lib/dates.js';
import { findRule, findMatches, draftFromLine, settleFromLine, suggestFromHistory } from '../lib/banking.js';
import { parseCSVStatement, parseOFX, isOFX, dedupe, linesFromCSV } from '../lib/bankimport.js';
import { parseCSV } from '../lib/csv.js';
import { newId } from '../lib/ids.js';

const PAGE = 100;
const drafts = new Map(); // bank line id -> { contactId, categoryId, memo, transferId, mode }

function draftFor(line) {
  if (drafts.has(line.id)) return drafts.get(line.id);
  const rule = findRule([...store.rules.values()], line);
  const hist = rule ? null : suggestFromHistory(store, line);
  const d = {
    mode: rule?.set?.transferAccountId ? 'transfer' : 'categorize',
    contactId: rule?.set?.contactId || hist?.contactId || null,
    categoryId: rule?.set?.categoryId || hist?.categoryId || null,
    transferId: rule?.set?.transferAccountId || null,
    memo: rule?.set?.memo || '',
    ruleName: rule?.name || null,
    fromHistory: !!hist,
  };
  if (!d.categoryId && d.contactId) d.categoryId = store.contact(d.contactId)?.defaultAccountId || null;
  drafts.set(line.id, d);
  return d;
}

export function addLine(line, d = draftFor(line)) {
  const t = d.mode === 'transfer'
    ? draftFromLine(store, line, { transferAccountId: d.transferId, memo: d.memo })
    : draftFromLine(store, line, { contactId: d.contactId, categoryId: d.categoryId, memo: d.memo });
  const saved = store.saveTxn(t);
  store.put('bankLines', { ...line, status: 'added', txnId: saved.id, matched: false });
  drafts.delete(line.id);
  return saved;
}

function matchLine(line, m) {
  if (m.kind === 'open') {
    const saved = store.saveTxn(settleFromLine(store, line, m.txn));
    store.put('bankLines', { ...line, status: 'added', txnId: saved.id, matched: false });
  } else {
    store.put('bankLines', { ...line, status: 'added', txnId: m.txn.id, matched: true });
  }
  drafts.delete(line.id);
}

function undoLine(line) {
  if (line.txnId && !line.matched && store.txn(line.txnId)) store.deleteTxn(line.txnId);
  store.put('bankLines', { ...line, status: 'review', txnId: null, matched: false });
}

export function renderBanking(main, route) {
  const feedAccounts = store.accountsOfType('bank', 'creditCard');
  const st = viewState('banking', { accountId: null, tab: 'review', q: '', shown: PAGE, expanded: null, selected: new Set() });
  const query = freshQuery(route);
  if (query.account) st.accountId = query.account;
  if (!st.accountId || !store.account(st.accountId)) st.accountId = feedAccounts[0]?.id || null;
  const rerender = () => renderBanking(main, { ...route, query: {} });

  const lines = [...store.bankLines.values()];
  const countFor = (accId, status) => lines.filter((l) => l.accountId === accId && l.status === status).length;

  // ----------------------------------------------------------- cards
  const cards = el('div.bank-cards', { role: 'group', 'aria-label': 'Bank and credit card accounts' },
    feedAccounts.map((a) => {
      const n = countFor(a.id, 'review');
      const on = a.id === st.accountId;
      const b = el('button.bank-card', { type: 'button', 'aria-pressed': String(on), onclick: () => { st.accountId = a.id; st.shown = PAGE; st.selected = new Set(); st.expanded = null; setQuery({ account: null }); rerender(); } },
        el('div.bank-card-head', {}, el('span.bank-card-ico', { html: icon(a.type === 'creditCard' ? 'card' : 'bank', 16) }), el('span.truncate.grow', {}, a.name), n ? el('span.badge.badge-primary', { title: `${n} to review` }, String(n)) : null),
        a.bankBalance ? el('div.bank-card-row', {}, el('span', {}, 'Bank'), el('strong.money', {}, formatMoney(a.bankBalance.amount))) : null,
        el('div.bank-card-row', {}, el('span', {}, 'In your books'), el('strong.money', {}, formatMoney(store.accountBalance(a.id)))),
        a.bankBalance ? el('div.bank-card-sub', {}, `Statement as of ${formatDate(a.bankBalance.asOf)}`) : null);
      return b;
    }),
    el('button.bank-card.bank-card-add', { type: 'button', onclick: async () => { const acc = await openAccountForm({ type: 'bank', types: ['bank', 'creditCard'] }); if (acc) { st.accountId = acc.id; rerender(); } } }, el('span', { html: icon('plus', 18) }), 'Add account'));

  if (!feedAccounts.length) {
    swap(main, el('div.page', {}, pageHead({ title: 'Banking', crumbs: [['Accounting', 'banking'], ['Banking']] }),
      emptyState({ iconName: 'bank', title: 'Add a bank account', text: 'Add your checking, savings, or credit card account, then upload a statement from your bank to categorize it here.', action: el('button.btn.btn-primary', { type: 'button', onclick: () => openAccountForm({ type: 'bank', types: ['bank', 'creditCard'] }) }, 'Add account') })));
    return;
  }

  const account = store.account(st.accountId);
  const all = lines.filter((l) => l.accountId === st.accountId && l.status === st.tab).sort((a, b) => (st.tab === 'review' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
  const q = st.q.trim().toLowerCase();
  const list = q ? all.filter((l) => `${l.desc} ${formatMoney(Math.abs(l.amount))}`.toLowerCase().includes(q)) : all;
  const taken = new Set(lines.filter((l) => l.txnId).map((l) => l.txnId));

  // ----------------------------------------------------------- table
  const table = el('table.grid.feed-table', { 'aria-label': `${account.name}: ${st.tab === 'review' ? 'to review' : st.tab}` });
  const allBox = el('input', { type: 'checkbox', 'aria-label': 'Select all shown' });
  allBox.checked = list.length > 0 && list.slice(0, st.shown).every((l) => st.selected.has(l.id));
  allBox.addEventListener('change', () => {
    for (const l of list.slice(0, st.shown)) if (allBox.checked) st.selected.add(l.id); else st.selected.delete(l.id);
    rerender();
  });
  const spentLabel = account.type === 'creditCard' ? 'Charges' : 'Spent';
  const recvLabel = account.type === 'creditCard' ? 'Payments' : 'Received';
  table.append(el('thead', {}, el('tr', {},
    el('th.check-cell', { scope: 'col' }, allBox),
    el('th', { scope: 'col' }, 'Date'),
    el('th', { scope: 'col' }, 'Description'),
    el('th.num', { scope: 'col' }, spentLabel),
    el('th.num', { scope: 'col' }, recvLabel),
    el('th', { scope: 'col', style: { width: '18%' } }, st.tab === 'review' ? 'From/To' : 'Payee'),
    el('th', { scope: 'col', style: { width: '22%' } }, st.tab === 'review' ? 'Categorize or match' : st.tab === 'added' ? 'Added or matched to' : 'Reason'),
    el('th', { scope: 'col', style: { width: '1%' } }, el('span.sr-only', {}, 'Action')))));
  const tb = el('tbody');
  for (const line of list.slice(0, st.shown)) {
    tb.append(...lineRows(line));
  }
  table.append(tb);

  function lineRows(line) {
    const checked = st.selected.has(line.id);
    const cb = el('input', { type: 'checkbox', checked, 'aria-label': `Select ${line.desc}` });
    cb.addEventListener('change', () => { if (cb.checked) st.selected.add(line.id); else st.selected.delete(line.id); rerender(); });
    const spent = line.amount < 0 ? amountNode(-line.amount) : '';
    const recv = line.amount > 0 ? amountNode(line.amount) : '';
    const tr = el('tr', { class: `${checked ? 'is-selected' : ''} ${st.expanded === line.id ? 'is-expanded' : ''}` });
    const expand = () => { st.expanded = st.expanded === line.id ? null : line.id; rerender(); };
    if (st.tab === 'review') {
      const d = draftFor(line);
      const matches = findMatches(store, line, { takenIds: taken });
      const payee = contactPicker({ kind: 'any', value: d.contactId, ariaLabel: `Payee for ${line.desc}`, onChange: (v) => {
        d.contactId = v;
        const def = store.contact(v)?.defaultAccountId;
        if (def && !d.categoryId) { d.categoryId = def; cat.value = def; }
      } });
      const cat = accountPicker({ value: d.categoryId, ariaLabel: `Category for ${line.desc}`, placeholder: 'Choose a category', onChange: (v) => { d.categoryId = v; } });
      let middle;
      let action;
      if (matches.length && d.mode !== 'categorize-forced') {
        const m = matches[0];
        middle = el('div.match-cell', {},
          el('span.badge.badge-positive', {}, matches.length > 1 ? `${matches.length} matches` : '1 match'),
          el('div.cell-sub', {}, `${typeLabel(m.txn.type)}${m.txn.num ? ` #${m.txn.num}` : ''} ${formatDate(m.txn.date)} ${store.contactName(m.txn.contactId)}`),
          el('button.btn-link', { type: 'button', onclick: () => { d.mode = 'categorize-forced'; expand(); } }, 'Categorize instead'));
        action = el('button.btn.btn-sm.btn-primary', { type: 'button', onclick: () => { try { matchLine(line, m); toast('Matched'); } catch (e) { toastError(e); } } }, 'Match');
      } else if (d.mode === 'transfer') {
        middle = el('div.cell-sub', {}, `Transfer ${line.amount < 0 ? 'to' : 'from'} ${store.accountName(d.transferId) || '...'}`);
        action = el('button.btn.btn-sm.btn-primary', { type: 'button', disabled: !d.transferId, onclick: () => { try { addLine(line, d); toast('Transfer recorded'); } catch (e) { toastError(e); } } }, 'Confirm');
      } else {
        middle = el('div', {}, cat.root, d.ruleName ? el('div.cell-sub', {}, el('span', { html: icon('rules', 12) }), ` Rule: ${d.ruleName}`) : d.fromHistory ? el('div.cell-sub', {}, 'Suggested from history') : null);
        action = el('button.btn.btn-sm.btn-primary', { type: 'button', onclick: () => { try { addLine(line, d); toast('Added'); } catch (e) { toastError(e); } } }, 'Add');
      }
      tr.append(
        el('td.check-cell', {}, cb),
        el('td.nowrap', {}, formatDate(line.date)),
        el('td', {}, el('button.row-link.feed-desc', { type: 'button', 'aria-expanded': String(st.expanded === line.id), onclick: expand }, line.desc || '(no description)')),
        el('td.num', {}, spent), el('td.num', {}, recv),
        el('td', {}, matches.length && d.mode !== 'categorize-forced' ? el('span.muted', {}, store.contactName(matches[0].txn.contactId)) : payee.root),
        el('td', {}, middle),
        el('td.actions-cell', {}, action));
      const rows = [tr];
      if (st.expanded === line.id) rows.push(detailRow(line, d, matches));
      return rows;
    }
    const t = line.txnId ? store.txn(line.txnId) : null;
    tr.append(
      el('td.check-cell', {}, cb),
      el('td.nowrap', {}, formatDate(line.date)),
      el('td', {}, line.desc),
      el('td.num', {}, spent), el('td.num', {}, recv),
      el('td', {}, t ? store.contactName(t.contactId) : ''),
      el('td', {}, st.tab === 'added' ? (t ? el('button.row-link', { type: 'button', onclick: () => openTxn(t.id) }, `${line.matched ? 'Matched: ' : ''}${typeLabel(t.type)}${t.num ? ` #${t.num}` : ''}`, el('div.cell-sub', {}, store.splitName(t, line.accountId))) : el('span.muted', {}, 'Transaction deleted')) : el('span.muted', {}, line.excludeReason || 'Excluded')),
      el('td.actions-cell', {}, el('button.btn.btn-sm', { type: 'button', onclick: () => {
        if (st.tab === 'added') { undoLine(line); toast('Moved back to review'); } else { store.put('bankLines', { ...line, status: 'review' }); toast('Moved back to review'); }
      } }, st.tab === 'added' ? 'Undo' : 'Include')));
    return [tr];
  }

  function detailRow(line, d, matches) {
    const box = el('div.feed-detail');
    const modeSel = el('div.segmented', { role: 'radiogroup', 'aria-label': 'What is this?' });
    const modes = [['categorize', 'Categorize'], ['match', `Find match${matches.length ? ` (${matches.length})` : ''}`], ['transfer', 'Record as transfer']];
    let mode = d.mode === 'transfer' ? 'transfer' : matches.length && d.mode !== 'categorize-forced' ? 'match' : 'categorize';
    const body = el('div.feed-detail-body');
    const paint = () => {
      modeSel.replaceChildren(...modes.map(([k, l]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(k === mode), onclick: () => { mode = k; paint(); } }, l)));
      clear(body);
      if (mode === 'categorize') {
        const payee = contactPicker({ kind: 'any', value: d.contactId, ariaLabel: 'Payee', onChange: (v) => { d.contactId = v; } });
        const cat = accountPicker({ value: d.categoryId, ariaLabel: 'Category', onChange: (v) => { d.categoryId = v; } });
        const memo = textInput({ value: d.memo || line.desc, ariaLabel: 'Memo' });
        memo.addEventListener('input', () => { d.memo = memo.value; });
        body.append(el('div.form-grid', {}, field(line.amount < 0 ? 'Payee' : 'Received from', payee), field('Category', cat), field('Memo', memo, { className: 'span-2' })),
          el('div.row', {},
            el('button.btn.btn-primary', { type: 'button', onclick: () => { d.mode = 'categorize'; try { addLine(line, d); toast('Added'); } catch (e) { toastError(e); } } }, 'Add'),
            el('button.btn', { type: 'button', onclick: () => openRuleForm({ fromLine: line, draft: d }) }, 'Create rule'),
            el('button.btn.btn-ghost', { type: 'button', onclick: () => exclude([line]) }, 'Exclude')));
      } else if (mode === 'match') {
        if (!matches.length) body.append(el('p.muted', {}, 'No transactions in your books match this amount within 10 days. Categorize it instead, or record it as a transfer.'));
        else {
          body.append(el('ul.match-list', {}, matches.map((m) => el('li', {},
            el('div.grow', {}, el('strong', {}, `${m.kind === 'open' ? 'Open ' : ''}${typeLabel(m.txn.type)}${m.txn.num ? ` #${m.txn.num}` : ''}`), ` ${formatDate(m.txn.date)} · ${store.contactName(m.txn.contactId) || ''} · ${formatMoney(m.kind === 'open' ? store.openBalance(m.txn.id) : Math.abs(line.amount))}`,
              m.kind === 'open' ? el('div.cell-sub', {}, line.amount > 0 ? 'Records a payment against this invoice' : 'Records a payment of this bill') : null),
            el('button.btn.btn-sm.btn-primary', { type: 'button', onclick: () => { try { matchLine(line, m); toast('Matched'); } catch (e) { toastError(e); } } }, 'Match')))));
        }
      } else {
        const other = accountPicker({ value: d.transferId, types: ['bank', 'creditCard', 'otherCurrentAsset', 'otherCurrentLiability', 'longTermLiability', 'equity'], exclude: [line.accountId], ariaLabel: line.amount < 0 ? 'Transfer to' : 'Transfer from', onChange: (v) => { d.transferId = v; } });
        body.append(el('div.form-grid', {}, field(line.amount < 0 ? 'Transfer to' : 'Transfer from', other)),
          el('div.row', {}, el('button.btn.btn-primary', { type: 'button', onclick: () => {
            if (!d.transferId) { toastError('Choose the other account.'); return; }
            d.mode = 'transfer';
            try { addLine(line, d); toast('Transfer recorded'); } catch (e) { toastError(e); }
          } }, 'Record transfer')));
      }
    };
    paint();
    box.append(modeSel, body);
    return el('tr.feed-detail-row', {}, el('td', { colSpan: 8 }, box));
  }

  const selectedLines = list.filter((l) => st.selected.has(l.id));
  async function exclude(ls) {
    for (const l of ls) store.put('bankLines', { ...l, status: 'excluded' }, { silent: false });
    st.selected = new Set();
    toast(`${ls.length} excluded`);
  }
  const batch = st.selected.size ? el('div.selection-bar', {},
    el('span', {}, `${selectedLines.length} selected`),
    st.tab === 'review' ? [
      el('button.btn.btn-sm.btn-primary', { type: 'button', onclick: () => {
        let n = 0; let skipped = 0;
        for (const l of selectedLines) {
          const d = draftFor(l);
          if (d.mode === 'transfer' && !d.transferId) { skipped++; continue; }
          try { addLine(l, d); n++; } catch { skipped++; }
        }
        st.selected = new Set();
        toast(`${n} added${skipped ? `, ${skipped} skipped` : ''}`);
      } }, 'Accept'),
      el('button.btn.btn-sm', { type: 'button', onclick: () => exclude(selectedLines) }, 'Exclude'),
    ] : el('button.btn.btn-sm', { type: 'button', onclick: () => {
      for (const l of selectedLines) { if (st.tab === 'added') undoLine(l); else store.put('bankLines', { ...l, status: 'review' }); }
      st.selected = new Set();
      toast('Moved back to review');
    } }, st.tab === 'added' ? 'Undo' : 'Include'),
    el('button.btn-link', { type: 'button', onclick: () => { st.selected = new Set(); rerender(); } }, 'Clear')) : null;

  const content = list.length
    ? el('div.table-wrap', {}, el('div.table-scroll', {}, table),
      list.length > st.shown ? el('div.table-foot', {}, el('button.btn.btn-sm', { type: 'button', onclick: () => { st.shown += PAGE * 2; rerender(); } }, `Show more (${list.length - st.shown} remaining)`)) : null)
    : el('div.table-wrap', {}, emptyState({
      iconName: st.tab === 'review' ? 'ok' : 'inbox',
      title: st.tab === 'review' ? (q ? 'No matches' : "You're all caught up") : 'Nothing here',
      text: st.tab === 'review' ? 'Upload a statement from your bank (CSV or OFX) to review its transactions here.' : st.tab === 'added' ? 'Transactions you add or match appear here.' : 'Transactions you exclude appear here.',
      action: st.tab === 'review' ? el('button.btn.btn-primary', { type: 'button', onclick: () => openBankImport(st.accountId) }, 'Upload transactions') : null,
    }));

  swap(main, el('div.page', {},
    pageHead({
      title: 'Banking',
      crumbs: [['Accounting', 'banking'], ['Banking']],
      actions: [
        el('a.btn', { href: '#/rules' }, 'Rules'),
        splitButton('Upload transactions', () => openBankImport(st.accountId), [
          { label: 'Go to register', icon: 'journal', onClick: () => navigate(`register/${st.accountId}`) },
          { label: 'Reconcile this account', icon: 'scale', onClick: () => navigate(`reconcile/${st.accountId}`) },
        ]),
      ],
    }),
    cards,
    tabs([['review', 'To review', countFor(st.accountId, 'review')], ['added', 'Added', countFor(st.accountId, 'added')], ['excluded', 'Excluded', countFor(st.accountId, 'excluded')]], st.tab, (k) => { st.tab = k; st.selected = new Set(); st.shown = PAGE; st.expanded = null; rerender(); main.querySelector('.tab[aria-selected="true"]')?.focus(); }, { label: 'Bank transaction status' }),
    el('div.toolbar', {},
      searchBox({ value: st.q, placeholder: 'Search by description or amount', label: 'Search bank transactions', onInput: (v) => { st.q = v; rerender(); main.querySelector('input[type="search"]')?.focus(); } }),
      el('div.toolbar-end', {}, el('span.muted', {}, `${list.length} transactions`))),
    batch,
    content));
}

// ------------------------------------------------------------------ import

export async function openBankImport(accountId) {
  const file = await pickFile('.csv,.ofx,.qfx,.qbo,text/csv');
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toastError('That file is larger than 10 MB.'); return; }
  const text = await file.text();
  let acct = accountId || store.accountsOfType('bank', 'creditCard')[0]?.id;
  let parsed;
  let mapping = null;
  let invert = false;
  let dateStyle = store.settings.dateStyle === 'dmy' ? 'dmy' : 'mdy';
  const ofx = isOFX(text);
  if (ofx) parsed = parseOFX(text);
  else {
    parsed = parseCSVStatement(text, { dateStyle });
    mapping = parsed.mapping;
  }
  const rows = ofx ? null : parseCSV(text);
  // A file with several accounts' statements is imported one statement at a time.
  let stmt = 0;
  const statement = () => parsed.statements[stmt];
  const acctPick = accountPicker({ value: acct, types: ['bank', 'creditCard'], ariaLabel: 'Account', onChange: (v) => { acct = v; preview(); } });
  const mapBox = el('div');
  const previewBox = el('div');

  function currentLines() {
    if (ofx) return { lines: statement().lines, skipped: [] };
    return linesFromCSV(rows, mapping, { hasHeader: parsed.hasHeader, dateStyle, invert });
  }

  function paintMapping() {
    if (ofx) return;
    const headers = parsed.headers;
    const sel = (key, label) => {
      const s = el('select.select', { 'aria-label': label }, el('option', { value: '-1' }, 'None'), headers.map((h, i) => el('option', { value: String(i), selected: mapping[key] === i }, h)));
      s.addEventListener('change', () => { mapping[key] = +s.value; preview(); });
      return field(label, s);
    };
    const modeSel = selectInput({ options: [['single', 'One column (negative is money out)'], ['split', 'Two columns (money out and money in)']], value: mapping.mode, ariaLabel: 'Amount columns', onChange: (v) => { mapping.mode = v; paintMapping(); preview(); } });
    const styleSel = selectInput({ options: [['mdy', 'MM/DD/YYYY'], ['dmy', 'DD/MM/YYYY']], value: dateStyle, ariaLabel: 'Date format', onChange: (v) => { dateStyle = v; preview(); } });
    append(clear(mapBox), [el('div.form-grid', {},
      sel('date', 'Date column'), sel('desc', 'Description column'), field('Date format', styleSel), field('Amounts', modeSel),
      mapping.mode === 'split' ? [sel('debit', 'Money out column'), sel('credit', 'Money in column')] : sel('amount', 'Amount column')),
    mapping.mode === 'single' ? checkbox({ checked: invert, label: 'My bank shows money out as positive numbers', onChange: (v) => { invert = v; preview(); } }) : null]);
  }

  function preview() {
    const { lines, skipped } = currentLines();
    const existing = [...store.bankLines.values()].filter((l) => l.accountId === acct);
    const { fresh, duplicates } = dedupe(lines, existing);
    append(clear(previewBox), [
      el('p', { role: 'status' }, `${fresh.length} new transaction${fresh.length === 1 ? '' : 's'}${duplicates ? `, ${duplicates} already imported and skipped` : ''}${skipped.length ? `, ${skipped.length} rows unreadable` : ''}.`),
      fresh.length ? el('div.table-wrap', {}, el('table.grid', {},
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Date'), el('th', { scope: 'col' }, 'Description'), el('th.num', { scope: 'col' }, 'Amount'))),
        el('tbody', {}, fresh.slice(0, 6).map((l) => el('tr', {}, el('td', {}, formatDate(l.date)), el('td', {}, l.desc), el('td.num', {}, amountNode(l.amount))))))) : null]);
    importBtn.disabled = !fresh.length || !acct;
  }

  const importBtn = el('button.btn.btn-primary', { type: 'button' }, 'Import');
  importBtn.addEventListener('click', () => {
    const { lines } = currentLines();
    const existing = [...store.bankLines.values()].filter((l) => l.accountId === acct);
    const { fresh } = dedupe(lines, existing);
    const importId = newId();
    const rules = [...store.rules.values()];
    let auto = 0;
    store.batch(({ put }) => {
      for (const l of fresh) put('bankLines', { ...l, accountId: acct, status: 'review', importId, importedAt: Date.now() });
      if (ofx && statement().balance !== null) put('accounts', { ...store.account(acct), bankBalance: { amount: statement().balance, asOf: fresh.reduce((m, l) => (l.date > m ? l.date : m), today()) } });
    });
    // Rules marked "add automatically" categorize straight into the books.
    for (const line of [...store.bankLines.values()].filter((l) => l.importId === importId)) {
      const rule = findRule(rules, line);
      if (rule?.autoAdd && (rule.set?.categoryId || rule.set?.transferAccountId)) {
        try { addLine(line, { mode: rule.set.transferAccountId ? 'transfer' : 'categorize', contactId: rule.set.contactId || null, categoryId: rule.set.categoryId || null, transferId: rule.set.transferAccountId || null, memo: rule.set.memo || '' }); auto++; } catch {}
      }
    }
    toast(`Imported ${fresh.length} transaction${fresh.length === 1 ? '' : 's'}${auto ? `, ${auto} added by rules` : ''}`);
    dlg.close();
    navigate(`banking?account=${acct}`);
  });
  paintMapping();
  const dlg = openDialog({
    title: 'Upload bank transactions',
    wide: true,
    body: el('div.stack', {},
      el('p.field-hint', {}, `${file.name} (${ofx ? 'OFX statement' : 'CSV'})`),
      ofx && parsed.statements.length > 1 ? field('This file has statements for several accounts. Which one is this import?', selectInput({
        options: parsed.statements.map((st, i) => [String(i), `${{ CHECKING: 'Checking', SAVINGS: 'Savings', CREDITCARD: 'Credit card', MONEYMRKT: 'Money market', CREDITLINE: 'Line of credit' }[st.accountType] || 'Account'}${st.accountNumber ? ` ending ${st.accountNumber.slice(-4)}` : ''} (${st.lines.length} transaction${st.lines.length === 1 ? '' : 's'})`]),
        value: '0',
        onChange: (v) => { stmt = +v; preview(); },
      }), { hint: 'Import the others into their own accounts by uploading the file again.' }) : null,
      field('Which account are these from?', acctPick, { required: true }),
      mapBox,
      previewBox),
    footer: el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.close() }, 'Cancel'), importBtn),
  });
  preview();
}

