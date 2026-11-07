/**
 * Presence on the canvas and in the title bar: other participants'
 * cursors and selections (in their colors, with names), comment pins
 * (which follow the objects they are pinned to), the participant avatars
 * with follow, the role and connection status, and the Share button.
 * Publishes this participant's cursor, selection and view.
 */
import { h } from '../../lib/dom.js';
import { icon } from '../../ui/icons.js';
import { openMenu } from '../../ui/menubar.js';
import { overlayHooks } from '../../render/overlay.js';
import { nodeBounds, localCorners } from '../../model/geometry.js';
import { ROLE_LABELS, colorFor, initials } from './protocol.js';
import { messagesOf } from './comments.js';

export const PIN_RADIUS = 11;
const MAX_AVATARS = 4;

/** Pins on screen for the active editor: [{ thread, number, x, y }]. */
export function screenPins(app, editor) {
  const c = app.comments;
  if (!c?.pinsVisible || !editor?.doc.comments) return [];
  return c.listed(editor).map(({ thread, number }) => {
    const p = c.pin(thread, editor);
    const s = editor.view.toScreen(p.x, p.y);
    return { thread, number, x: s.x, y: s.y, attached: p.attached };
  });
}

function roundRect(ctx, x, y, w, hgt, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, r);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function nameTag(ctx, text, x, y, color) {
  ctx.font = '600 11px Inter, system-ui, sans-serif';
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = color;
  roundRect(ctx, x, y, w, 17, 4);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 5, y + 9);
}

/** Outline of a node's bounds on screen (follows rotation for transformed objects). */
function boundsQuad(editor, node) {
  const b = nodeBounds(editor.doc, node);
  if (!b) return null;
  const pts = node.transform && node.type !== 'path' && node.width ? localCorners({ x: 0, y: 0, w: node.width, h: node.height }, node.transform) : [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
  return pts.map((p) => editor.view.toScreen(p.x, p.y));
}

function drawRemote(ctx, editor, session) {
  const doc = editor.doc;
  for (const p of session.participants()) {
    const s = p.state || {};
    ctx.save();
    // Their selection.
    let labelAt = null;
    for (const id of s.selection || []) {
      const node = doc.get(id);
      if (!node) continue;
      const q = boundsQuad(editor, node);
      if (!q) continue;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      q.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
      ctx.closePath();
      ctx.stroke();
      if (!labelAt) labelAt = q.reduce((a, b) => (b.y < a.y || (b.y === a.y && b.x < a.x) ? b : a));
    }
    if (labelAt && !s.cursor) nameTag(ctx, p.username, labelAt.x, labelAt.y - 20, p.color);
    // Their cursor.
    if (s.cursor) {
      const c = editor.view.toScreen(s.cursor.x, s.cursor.y);
      if (c.x > -20 && c.y > -20 && c.x < editor.view.width + 20 && c.y < editor.view.height + 20) {
        ctx.fillStyle = p.color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(c.x, c.y + 16);
        ctx.lineTo(c.x + 4.5, c.y + 12);
        ctx.lineTo(c.x + 11, c.y + 12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        nameTag(ctx, s.commenting ? `${p.username} (commenting)` : p.username, c.x + 10, c.y + 14, p.color);
      }
    }
    ctx.restore();
  }
}

function drawPins(ctx, app, editor) {
  const c = app.comments;
  const pins = screenPins(app, editor);
  ctx.save();
  ctx.font = '700 11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const pin of pins) {
    const active = c.active === pin.thread.id;
    const color = pin.thread.resolved ? '#7a7a7a' : colorFor(pin.thread.author?.id);
    const r = active ? PIN_RADIUS + 2 : PIN_RADIUS;
    // A speech-bubble pin whose tip marks the point.
    ctx.beginPath();
    ctx.moveTo(pin.x, pin.y);
    ctx.arc(pin.x + r, pin.y - r, r, Math.PI * 0.5, Math.PI * 2.0, false);
    ctx.arc(pin.x + r, pin.y - r, r, 0, Math.PI * 0.5, false);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = active ? 2.5 : 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(pin.number), pin.x + r, pin.y - r + 0.5);
  }
  // The draft pin of a comment being written.
  if (c.draft && editor === app.editor) {
    const p = c.draft.anchor;
    const pos = c.pin({ anchor: p }, editor);
    const s = editor.view.toScreen(pos.x, pos.y);
    ctx.beginPath();
    ctx.arc(s.x + PIN_RADIUS, s.y - PIN_RADIUS, PIN_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();
    ctx.setLineDash([3, 2]);
    ctx.strokeStyle = colorFor(c.author(editor).id);
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

/** The pin under a screen point (topmost), or null. */
export function pinAt(app, editor, sx, sy) {
  const pins = screenPins(app, editor);
  for (let i = pins.length - 1; i >= 0; i--) {
    const p = pins[i];
    if (Math.hypot(sx - (p.x + PIN_RADIUS), sy - (p.y - PIN_RADIUS)) <= PIN_RADIUS + 3) return p;
  }
  return null;
}

export function installPresence(app) {
  overlayHooks.add((ctx, editor) => {
    if (editor.collab) drawRemote(ctx, editor, editor.collab);
    if (app.comments) drawPins(ctx, app, editor);
  });

  app.on('started', () => {
    const host = app.canvasHost;
    let last = 0;
    host.addEventListener('pointermove', (e) => {
      const ed = app.editor;
      const s = ed?.collab;
      if (!s || e.pointerType === 'touch') return;
      const now = performance.now();
      if (now - last < 40) return;
      last = now;
      const r = host.getBoundingClientRect();
      const p = ed.view.toDoc(e.clientX - r.left, e.clientY - r.top);
      s.setLocalState({ cursor: { x: p.x, y: p.y } });
    });
    host.addEventListener('pointerleave', () => app.editor?.collab?.setLocalState({ cursor: null }));
    // Clicking a pin opens its discussion, whatever the tool.
    host.addEventListener(
      'pointerdown',
      (e) => {
        const ed = app.editor;
        if (!ed || e.button !== 0) return;
        const r = host.getBoundingClientRect();
        const pin = pinAt(app, ed, e.clientX - r.left, e.clientY - r.top);
        if (!pin) return;
        e.stopPropagation();
        e.preventDefault();
        app.comments.open(pin.thread.id, { reveal: false });
      },
      true,
    );
    host.addEventListener(
      'pointermove',
      (e) => {
        const ed = app.editor;
        if (!ed || e.buttons) return;
        const r = host.getBoundingClientRect();
        const over = Boolean(pinAt(app, ed, e.clientX - r.left, e.clientY - r.top));
        host.classList.toggle('over-comment-pin', over);
      },
      true,
    );
    buildTitlebar(app);
  });

  // Publish selection and view.
  const watched = new WeakSet();
  const watch = (ed) => {
    if (!ed || watched.has(ed)) return;
    watched.add(ed);
    ed.on('selection', () => ed.collab?.setLocalState({ selection: [...ed.selection].slice(0, 100) }));
    ed.on('view', () => {
      if (!ed.collab) return;
      ed.collab.setLocalState({ view: ed.view.visibleRect() });
      // Navigating yourself stops following.
      if (ed.collabFollow && !ed.collabFollowing) {
        app.collab.follow(ed, null);
        app.notify('Stopped following.', { polite: true });
      }
    });
  };
  app.collab.on('change', (ed) => {
    watch(ed);
    if (ed?.collab) ed.collab.setLocalState({ view: ed.view.visibleRect(), selection: [...ed.selection].slice(0, 100) });
  });
  app.on('tool', (id) => app.editor?.collab?.setLocalState({ commenting: id === 'comment' || undefined }));
}

// ---- title bar ----

function statusInfo(session) {
  if (!session) return null;
  if (session.status === 'offline') return { icon: 'cloud-off', text: session.pending.length ? 'Offline: changes kept on this device' : 'Offline', tone: 'warn' };
  if (session.status === 'connecting') return { icon: 'loader', text: 'Connecting', tone: '' };
  if (session.status === 'ended') return { icon: 'cloud-off', text: 'Not shared', tone: 'warn' };
  if (session.pending.length) return { icon: 'cloud', text: 'Saving', tone: '' };
  return { icon: 'cloud', text: 'Live', tone: 'ok' };
}

export function roleLabel(session) {
  if (!session) return '';
  if (session.review && session.role === 'commenter') return 'Reviewing';
  if (session.role === 'viewer') return 'View only';
  return ROLE_LABELS[session.role] || '';
}

function buildTitlebar(app) {
  const bar = h('div.collab-bar', { role: 'group', 'aria-label': 'Collaboration' });
  app.collabBar = bar;
  app.topRight.insertBefore(bar, app.topRight.firstChild);
  const render = () => {
    const ed = app.editor;
    const session = ed?.collab || null;
    const parts = [];
    if (session) {
      const st = statusInfo(session);
      parts.push(h(`span.collab-status${st.tone ? `.${st.tone}` : ''}`, { role: 'status', 'data-tip': st.text, 'aria-label': `Shared document: ${st.text}` }, icon(st.icon, 14), h('span.collab-status-text', st.text)));
      const role = roleLabel(session);
      if (session.role !== 'owner' && session.role !== 'editor') parts.push(h('span.collab-role', { 'data-tip': 'Your access to this document' }, icon(session.role === 'viewer' ? 'eye' : 'message-square', 13), role));
      const people = session.participants();
      const shown = people.slice(0, MAX_AVATARS);
      const avatars = h('div.collab-avatars', { role: 'list', 'aria-label': `${people.length} other ${people.length === 1 ? 'person' : 'people'} here` });
      for (const p of shown) {
        const following = ed.collabFollow === p.session;
        const btn = h(
          `button.collab-avatar${following ? '.following' : ''}`,
          {
            type: 'button',
            style: { '--who': p.color },
            'aria-label': `${p.username}, ${roleLabelFor(p)}${following ? ', following' : ''}`,
            'data-tip': `${p.username} · ${roleLabelFor(p)}`,
            'aria-haspopup': 'menu',
            onclick: (e) => participantMenu(app, ed, p, e.currentTarget),
          },
          initials(p.username),
        );
        avatars.append(h('span', { role: 'listitem' }, btn));
      }
      if (people.length > MAX_AVATARS) {
        const more = h('button.collab-avatar.more', { type: 'button', 'aria-label': `${people.length - MAX_AVATARS} more people`, 'aria-haspopup': 'menu', onclick: (e) => peopleMenu(app, ed, people.slice(MAX_AVATARS), e.currentTarget) }, `+${people.length - MAX_AVATARS}`);
        avatars.append(h('span', { role: 'listitem' }, more));
      }
      if (people.length) parts.push(avatars);
    }
    if (ed && app.commands.get('file.invite')) {
      parts.push(h('button.btn.small.collab-share-btn', { type: 'button', 'data-tip': session ? 'Manage access' : 'Invite to Edit', onclick: () => app.commands.run('file.invite') }, icon('user-plus', 14), h('span.collab-share-label', 'Share')));
    }
    bar.replaceChildren(...parts);
    bar.hidden = !parts.length;
  };
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      render();
    });
  };
  app.on('active-editor', schedule);
  app.collab.on('change', schedule);
  app.collab.on('presence', schedule);
  app.collab.on('role', schedule);
  app.on('user', schedule);
  render();
  app.renderCollabBar = render;
}

function roleLabelFor(p) {
  if (p.review && p.role === 'commenter') return 'Reviewing';
  return ROLE_LABELS[p.role] || 'Can view';
}

function participantMenu(app, editor, p, anchor) {
  const following = editor.collabFollow === p.session;
  const items = [
    { type: 'cmd', label: `${p.username} · ${roleLabelFor(p)}`, enabled: false },
    { type: 'sep' },
    { type: 'cmd', label: following ? `Stop Following ${p.username}` : `Follow ${p.username}`, enabled: true, run: () => app.collab.follow(editor, following ? null : p.session) },
    {
      type: 'cmd',
      label: `Go to ${p.username}'s View`,
      enabled: Boolean(p.state?.view),
      run: () => {
        editor.view.fit(p.state.view, 0);
        editor.viewChanged();
      },
    },
  ];
  const sel = (p.state?.selection || []).filter((id) => editor.doc.has(id));
  if (sel.length) {
    items.push({
      type: 'cmd',
      label: `Show ${p.username}'s Selection`,
      enabled: true,
      run: () => {
        let r = null;
        for (const id of sel) {
          const b = nodeBounds(editor.doc, editor.doc.get(id));
          if (b) r = r ? { x: Math.min(r.x, b.x), y: Math.min(r.y, b.y), w: Math.max(r.x + r.w, b.x + b.w) - Math.min(r.x, b.x), h: Math.max(r.y + r.h, b.y + b.h) - Math.min(r.y, b.y) } : b;
        }
        if (r) editor.view.centerOn(r.x + r.w / 2, r.y + r.h / 2);
        editor.viewChanged();
      },
    });
  }
  const r = anchor.getBoundingClientRect();
  openMenu(app, items, { x: Math.max(8, r.right - 220), y: r.bottom + 4, anchor, label: p.username });
}

function peopleMenu(app, editor, people, anchor) {
  const items = people.map((p) => ({ type: 'cmd', label: editor.collabFollow === p.session ? `Stop Following ${p.username}` : `Follow ${p.username}`, enabled: true, run: () => app.collab.follow(editor, editor.collabFollow === p.session ? null : p.session) }));
  const r = anchor.getBoundingClientRect();
  openMenu(app, items, { x: Math.max(8, r.right - 220), y: r.bottom + 4, anchor, label: 'More people' });
}

/** Unread-style summary for a thread's first message (accessible label). */
export function threadSummary(thread) {
  const first = messagesOf(thread).find((m) => !m.deleted);
  return first ? `${first.author?.name || 'Someone'}: ${first.text}` : 'Deleted comment';
}
