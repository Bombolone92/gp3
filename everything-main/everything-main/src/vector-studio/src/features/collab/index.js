/**
 * Collaboration feature: File > Invite to Edit and Share for Review,
 * shared documents with live sync, presence and follow, view-only roles,
 * and the Comments panel with pinned discussions (which also work in
 * personal files, saved with them).
 */
import { AtSign, CircleCheckBig, Cloud, CloudOff, LoaderCircle, LocateFixed, MapPin, MessageSquarePlus, RotateCcw, UserPlus, Users } from 'lucide';
import { h } from '../../lib/dom.js';
import { icon, registerIcons } from '../../ui/icons.js';
import { relativeTime } from '../files/naming.js';
import { CollabManager } from './manager.js';
import { CommentsController } from './comments-controller.js';
import { CommentsPanel } from './comments-panel.js';
import { CommentTool } from './comment-tool.js';
import { installGating } from './gating.js';
import { installPresence } from './presence-ui.js';
import { inviteDialog, reviewDialog, sharingNeeds, stopSharing } from './share-dialogs.js';
import { mentionsIn } from './comments.js';
import { parseShareLink, shareLink, ROLE_LABELS } from './protocol.js';
import './styles.css';

export function install(app, options = {}) {
  registerIcons({
    users: Users,
    'user-plus': UserPlus,
    'message-square-plus': MessageSquarePlus,
    'at-sign': AtSign,
    'circle-check': CircleCheckBig,
    'rotate-ccw': RotateCcw,
    cloud: Cloud,
    'cloud-off': CloudOff,
    'map-pin': MapPin,
    locate: LocateFixed,
    loader: LoaderCircle,
  });
  app.collab = new CollabManager(app, options);
  app.comments = new CommentsController(app);
  app.registerTool(CommentTool);
  app.registerPanel(CommentsPanel);
  installGating(app);
  installPresence(app);
  registerCommands(app);
  wrapFileCommands(app);
  installHomeSection(app);
  installMentions(app);
  app.on('ready', () => openLinkFromLocation(app));
  if (typeof window !== 'undefined') window.addEventListener('hashchange', () => openLinkFromLocation(app));
  app.on('active-editor', () => app.comments.cancelDraft());
}

function registerCommands(app) {
  let toolBefore = 'selection';
  app.commands.register([
    { id: 'file.invite', label: 'Invite to Edit...', enabled: (a) => Boolean(a.editor), run: (a) => inviteDialog(a) },
    { id: 'file.shareReview', label: 'Share for Review...', enabled: (a) => Boolean(a.editor), run: (a) => reviewDialog(a) },
    {
      id: 'comments.mode',
      label: 'Comment Mode',
      checked: (a) => a.toolId === 'comment',
      enabled: (a) => Boolean(a.editor) && (a.toolId === 'comment' || a.comments.canComment()),
      run: (a) => {
        if (a.toolId === 'comment') {
          a.comments.cancelDraft();
          a.setTool(a.canUseTool && !a.canUseTool(toolBefore) ? 'hand' : toolBefore);
        } else {
          toolBefore = a.toolId;
          a.setTool('comment');
          a.openPanel('comments');
        }
        a.dock?.update();
      },
    },
    {
      id: 'comments.add',
      label: 'Add Comment',
      enabled: (a) => Boolean(a.editor) && a.comments.canComment(),
      run: (a) => a.comments.startDraft(a.comments.defaultAnchor()),
    },
    {
      id: 'collab.stopSharing',
      label: 'Stop Sharing...',
      enabled: (a) => a.editor?.collab?.role === 'owner',
      run: (a) => stopSharing(a, a.editor),
    },
  ]);
  app.on('tool', () => app.dock?.update());
}

/** Shared documents save as you work: Save sends what is pending; Save As saves a personal copy. */
function wrapFileCommands(app) {
  const wrap = (id, fn) => {
    const c = app.commands.get(id);
    if (c) app.commands.register({ ...c, run: (a, args) => fn(c, a, args) });
  };
  wrap('file.save', async (c, a, args) => {
    const ed = args?.editor || a.editor;
    const session = a.collab.sessionOf(ed);
    if (!session) return c.run(a, args);
    await session.sync().catch(() => {});
    if (session.pending.length) a.notify(session.status === 'offline' ? 'Offline: your changes are kept on this device and will be shared when the connection returns.' : 'Sharing your latest changes...', { polite: session.status !== 'offline' });
    else a.notify('Shared documents save automatically. Everything is up to date.', { polite: true });
    return true;
  });
  wrap('file.saveAs', (c, a, args) => {
    const ed = args?.editor || a.editor;
    if (a.collab.sessionOf(ed)) return a.commands.run('file.saveCopy', args);
    return c.run(a, args);
  });
}

/** Notify when someone mentions you in a comment. */
function installMentions(app) {
  app.collab.on('remote-comments', ({ editor, ops, by }) => {
    const me = editor.collab?.user.username.toLowerCase();
    if (!me || by?.uuid === editor.collab.user.uuid) return;
    for (const op of ops) {
      const text = op.create?.text ?? op.set?.text;
      if (typeof text !== 'string' || !mentionsIn(text).includes(me)) continue;
      app.notify(`${by?.username || 'Someone'} mentioned you in "${editor.name}".`, { timeout: 6000 });
      return;
    }
  });
}

let opening = null;

/** Open a share link in the address (after sign-in when needed). */
async function openLinkFromLocation(app) {
  const link = typeof location !== 'undefined' ? parseShareLink(location.href) : null;
  if (!link || opening) return;
  opening = (async () => {
    try {
      if (!(await sharingNeeds(app, 'Open Shared Document'))) return;
      app.notify('Opening the shared document...', { polite: true });
      await app.collab.open(link);
      // Keep a reusable address without the one-time invitation.
      if (link.invite) history.replaceState(history.state, '', shareLink(link.server, link.room));
    } catch (err) {
      await app.dialogs.alert({ title: 'Shared Document', message: err?.message || 'The shared document could not be opened.' });
    } finally {
      opening = null;
    }
  })();
  return opening;
}

/** Home screen: shared documents this account opened or shared. */
function installHomeSection(app) {
  const base = app.renderHome;
  app.renderHome = (host) => {
    const done = base?.(host);
    const main = host.querySelector('.home-main');
    if (main && app.collab.identity()) main.append(sharedSection(app));
    return done;
  };
}

function sharedSection(app) {
  const list = h('div.recent-list.collab-home-list', { 'aria-label': 'Shared documents' }, h('p.muted', 'Loading shared documents...'));
  const section = h('section.collab-home', { 'aria-labelledby': 'collab-home-title' }, h('h2#collab-home-title.home-h2', 'Shared'), list);
  app.collab.recent().then((items) => {
    if (!items.length) {
      list.replaceChildren(h('p.muted', 'Documents you share, or open from a share link, appear here.'));
      return;
    }
    list.setAttribute('role', 'list');
    list.replaceChildren(
      ...items.slice(0, 24).map((it) =>
        h(
          'div.recent-cell',
          { role: 'listitem' },
          h(
            'button.recent-item',
            {
              type: 'button',
              onclick: async () => {
                try {
                  await app.collab.open({ server: it.server, room: it.room, invite: null });
                } catch (err) {
                  await app.dialogs.alert({ title: 'Shared Document', message: err.message });
                }
              },
            },
            h('span.recent-thumb', icon('users', 24)),
            h('span.recent-name', it.name || 'Shared document'),
            h('span.recent-meta', [it.role === 'owner' ? 'Shared by you' : `${ROLE_LABELS[it.role] || 'Shared'}${it.owner ? ` · ${it.owner}` : ''}`, relativeTime(it.opened)].filter(Boolean).join(' · ')),
          ),
          h(
            'button.icon-btn.recent-remove',
            {
              type: 'button',
              'aria-label': `Remove ${it.name || 'shared document'} from this list`,
              'data-tip': 'Remove from list',
              onclick: async (e) => {
                await app.collab.forget(it);
                e.currentTarget.closest('.recent-cell')?.remove();
              },
            },
            icon('x', 12),
          ),
        ),
      ),
    );
  });
  return section;
}
