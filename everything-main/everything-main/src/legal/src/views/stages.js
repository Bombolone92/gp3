/**
 * Matter stages board: one column per stage of a practice area, with open
 * and pending matters as cards. Cards move by dragging (mouse, pen, or a
 * long press on touch) or with the keyboard through each card's "Move to
 * stage" menu. Every move can be undone.
 */
import '../styles/settings.css';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, meId } from '../app.js';
import { pageHeader, navTabs, select, searchBox, avatar, emptyState } from '../ui/components.js';
import { setQuery } from '../ui/router.js';
import { openMenu } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { matterStatusPill } from './common.js';
import { stagesFor } from '../core/settings.js';
import { matches, colorFor } from '../core/format.js';
import { diffDays, toISODate } from '../core/dates.js';

const NO_STAGE = '__none';

export function render(ctx) {
  const store = app.store;
  const s = () => app.settings();
  const state = { area: ctx.query.area || '', q: ctx.query.q || '', resp: ctx.query.resp || '' };

  const areaSel = select({
    name: 'area',
    value: state.area,
    'aria-label': 'Practice area',
    options: [{ value: '', label: 'All practice areas' }, ...s().practiceAreas.map((p) => ({ value: p.id, label: p.name }))],
  });
  areaSel.addEventListener('change', () => {
    state.area = areaSel.value;
    setQuery({ area: state.area });
    draw();
  });
  const respSel = select({
    name: 'resp',
    value: state.resp,
    'aria-label': 'Responsible lawyer',
    options: [{ value: '', label: 'Anyone responsible' }, { value: 'me', label: 'Me' }, ...lookup.activeUsers().map((u) => ({ value: u.id, label: u.name }))],
  });
  respSel.addEventListener('change', () => {
    state.resp = respSel.value;
    setQuery({ resp: state.resp });
    draw();
  });
  const search = searchBox({
    value: state.q,
    placeholder: 'Filter matters',
    label: 'Filter matters',
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      draw();
    },
  });

  const board = h('div.board', { role: 'region', 'aria-label': 'Stages board', tabindex: '-1' });
  const note = h('p.subtle.small.board-note');

  /** Stage columns for the selection: the area's own list, or the shared list. */
  function columns() {
    const st = s();
    const list = state.area ? stagesFor(st, state.area) : st.stages;
    return [{ id: NO_STAGE, name: 'No stage' }, ...list];
  }

  function visibleMatters(stageIds) {
    const st = s();
    const me = meId();
    return store
      .all('matters')
      .filter((m) => {
        if (m.status === 'closed') return false;
        if (state.area) {
          if (m.practiceAreaId !== state.area) return false;
        } else if (st.practiceAreas.find((p) => p.id === m.practiceAreaId)?.stages?.length) return false;
        if (state.resp && m.responsibleId !== (state.resp === 'me' ? me : state.resp)) return false;
        if (state.q && !matches(`${m.displayNumber} ${m.description} ${lookup.contactName(m.clientId)}`, state.q)) return false;
        return true;
      })
      .map((m) => ({ m, col: m.stageId && stageIds.has(m.stageId) ? m.stageId : NO_STAGE }));
  }

  function moveMatter(m, stageId) {
    const target = stageId === NO_STAGE ? '' : stageId;
    if ((m.stageId || '') === target) return false;
    const prev = { stageId: m.stageId || '', stageChangedAt: m.stageChangedAt || null };
    store.patch('matters', m.id, { stageId: target, stageChangedAt: new Date().toISOString() });
    const name = target ? columns().find((c) => c.id === target)?.name : 'No stage';
    toast(`${m.displayNumber || 'Matter'} moved to ${name}`, { action: { label: 'Undo', run: () => store.patch('matters', m.id, prev) } });
    return true;
  }

  // A card moved from its menu gets focus back once the board redraws.
  let refocus = null;

  function card(m, cols) {
    const today = app.today();
    const days = m.stageChangedAt ? diffDays(toISODate(new Date(m.stageChangedAt)), today) : null;
    const u = lookup.user(m.responsibleId);
    const moveBtn = h(
      'button.icon-btn.sm.card-move',
      {
        type: 'button',
        'aria-label': `Move ${m.displayNumber} to another stage`,
        title: 'Move to stage',
        onClick: (e) =>
          openMenu(e.currentTarget, [
            { heading: 'Move to stage' },
            ...cols.map((c) => ({ label: c.name, checked: (m.stageId || NO_STAGE) === c.id || (c.id === NO_STAGE && !cols.some((x) => x.id === m.stageId)), run: () => (moveMatter(m, c.id) ? (refocus = m.id) : moveBtn.focus()) })),
          ]),
      },
      icon('more', 16),
    );
    const node = h(
      'article.board-card',
      { dataset: { id: m.id }, 'aria-label': `${m.displayNumber} ${m.description}` },
      h('div.board-card-top', h('span.matter-num', m.displayNumber), m.status === 'pending' ? matterStatusPill('pending') : null, h('div.spacer'), moveBtn),
      h('a.board-card-title', { href: `#/matters/${m.id}`, draggable: 'false' }, m.description),
      h(
        'div.board-card-foot',
        h('span.truncate.subtle', lookup.contactName(m.clientId)),
        h('div.spacer'),
        days !== null ? h('span.subtle.small', { title: 'Days in this stage' }, `${days}d`) : null,
        u ? avatar(u.name, { color: u.color || colorFor(u.id), size: 'xs', title: `Responsible: ${u.name}` }) : null,
      ),
    );
    enableDrag(node, m);
    return node;
  }

  function draw() {
    const cols = columns();
    const ids = new Set(cols.map((c) => c.id));
    const items = visibleMatters(ids);
    const byCol = new Map(cols.map((c) => [c.id, []]));
    for (const it of items) byCol.get(it.col).push(it.m);
    const hiddenAreas = !state.area ? s().practiceAreas.filter((p) => p.stages?.length) : [];
    const one = hiddenAreas.length === 1;
    const names = new Intl.ListFormat('en', { type: 'conjunction' }).format(hiddenAreas.map((p) => p.name));
    note.textContent = hiddenAreas.length ? `${names} ${one ? 'has its' : 'have their'} own stages. Choose ${one ? 'it' : 'one'} above to see those matters.` : '';
    note.hidden = !hiddenAreas.length;
    const hasUnstaged = byCol.get(NO_STAGE).length > 0;
    board.replaceChildren(
      ...cols
        .filter((c) => c.id !== NO_STAGE || hasUnstaged)
        .map((c) => {
          const list = byCol.get(c.id).sort((a, b) => (b.number || 0) - (a.number || 0));
          const headingId = `stage-${c.id}`;
          return h(
            'section.board-col',
            { dataset: { stage: c.id }, 'aria-labelledby': headingId },
            h('header.board-col-head', h('h2', { id: headingId }, c.name), h('span.tab-count', String(list.length))),
            h('div.board-col-body', list.length ? list.map((m) => card(m, cols)) : h('p.board-empty', 'Drop matters here')),
          );
        }),
    );
    if (!items.length && !store.all('matters').some((m) => m.status !== 'closed')) {
      board.replaceChildren(
        emptyState({
          icon: 'kanban',
          title: 'No open matters',
          text: 'Open matters appear here so you can move them through your stages.',
          actions: [h('a.btn.primary', { href: '#/matters/new' }, icon('plus', 16), 'New matter')],
          headingLevel: 2,
        }),
      );
    }
    if (refocus) {
      [...board.querySelectorAll('.board-card')].find((n) => n.dataset.id === refocus)?.querySelector('.card-move')?.focus();
      refocus = null;
    }
  }

  // ---- Drag and drop -----------------------------------------------------------

  let drag = null;
  let stale = false; // the store changed while a card was being dragged

  function columnAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el?.closest?.('.board-col') || null;
  }

  function enableDrag(node, m) {
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button, a.board-card-title:focus-visible')) return;
      const start = { x: e.clientX, y: e.clientY };
      const touch = e.pointerType === 'touch';
      let timer = null;
      let begun = false;
      const begin = () => {
        begun = true;
        const r = node.getBoundingClientRect();
        const ghost = node.cloneNode(true);
        ghost.classList.add('board-ghost');
        ghost.style.width = `${r.width}px`;
        ghost.style.left = `${r.left}px`;
        ghost.style.top = `${r.top}px`;
        document.body.append(ghost);
        node.classList.add('dragging-source');
        drag = { m, ghost, dx: start.x - r.left, dy: start.y - r.top, over: null };
        try {
          node.setPointerCapture(e.pointerId);
        } catch {}
      };
      const onMove = (ev) => {
        if (!begun) {
          const dist = Math.hypot(ev.clientX - start.x, ev.clientY - start.y);
          if (touch) {
            if (dist > 8) cleanup();
            return;
          }
          if (dist < 5) return;
          begin();
        }
        ev.preventDefault();
        drag.ghost.style.left = `${ev.clientX - drag.dx}px`;
        drag.ghost.style.top = `${ev.clientY - drag.dy}px`;
        const col = columnAt(ev.clientX, ev.clientY);
        if (col !== drag.over) {
          drag.over?.classList.remove('drop-target');
          col?.classList.add('drop-target');
          drag.over = col;
        }
        // Scroll the board when dragging near its edges.
        const br = board.getBoundingClientRect();
        if (ev.clientX > br.right - 40) board.scrollLeft += 14;
        else if (ev.clientX < br.left + 40) board.scrollLeft -= 14;
      };
      const onUp = () => {
        if (begun && drag) {
          const target = drag.over?.dataset.stage;
          drag.over?.classList.remove('drop-target');
          drag.ghost.remove();
          node.classList.remove('dragging-source');
          const moved = drag.m;
          drag = null;
          if (!(target && moveMatter(moved, target)) && stale) draw();
          stale = false;
          // Swallow the click that follows a drag.
          node.addEventListener('click', (c) => c.preventDefault(), { once: true, capture: true });
        }
        cleanup();
      };
      const noScroll = (ev) => begun && ev.preventDefault();
      function cleanup() {
        clearTimeout(timer);
        node.removeEventListener('pointermove', onMove);
        node.removeEventListener('pointerup', onUp);
        node.removeEventListener('pointercancel', onCancel);
        node.removeEventListener('touchmove', noScroll);
      }
      const onCancel = () => {
        if (drag) {
          drag.over?.classList.remove('drop-target');
          drag.ghost.remove();
          node.classList.remove('dragging-source');
          drag = null;
          if (stale) draw();
          stale = false;
        }
        cleanup();
      };
      node.addEventListener('pointermove', onMove);
      node.addEventListener('pointerup', onUp);
      node.addEventListener('pointercancel', onCancel);
      node.addEventListener('touchmove', noScroll, { passive: false });
      if (touch) timer = setTimeout(() => begin(), 380);
    });
  }

  draw();
  ctx.watch(['matters', 'contacts', 'users', 'settings'], () => {
    if (drag) stale = true;
    else draw();
  });

  return {
    title: 'Matter stages',
    node: h(
      'div.page.fill.board-page',
      pageHeader({
        title: 'Matters',
        actions: [h('a.btn.primary', { href: '#/matters/new' }, icon('plus', 16), 'New matter')],
        tabs: navTabs(
          [
            { href: '#/matters', label: 'Matters' },
            { href: '#/matters/stages', label: 'Stages', current: true },
          ],
          'Matter views',
        ),
      }),
      h('div.board-toolbar', areaSel, respSel, search, h('div.spacer'), h('a.btn.ghost', { href: '#/settings/practice', 'aria-label': 'Edit stages' }, icon('settings', 16), h('span.hide-sm', 'Edit stages'))),
      note,
      board,
      h('p.sr-only', 'To move a matter with the keyboard, open its Move to stage menu.'),
    ),
  };
}
