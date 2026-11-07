/**
 * The mailbox watched rather than polled.
 *
 * The shell subscribes to `.mail` as a whole with `puter.events.onLocal()`,
 * so one subscription covers every folder, and mail delivered, filed,
 * restored or deleted -- by emailrx, by another device, by another tab --
 * arrives as an event naming the path that changed:
 *
 *   /<username>/.mail/<folder dir>/<YYYY-MM-DD>/<uuidv7>--<base64url subject>
 *
 * This module reads a batch of those events as changes to folders, and
 * nothing here touches the DOM or the network.
 *
 * An event's `self` flag is not used. It says whether the change was made by
 * the *account* holding the subscription, and this account's other devices
 * and tabs -- the changes the watch is for -- are the same account. The
 * shell tells its own writes apart by remembering the paths it has just
 * written instead.
 */

import { BOX_DIRS } from './mailbox.js';

/** The subject that covers every folder of a mailbox. */
export const mailSubject = (mailPath) => `fs:${mailPath}`;

/**
 * Which folder a path under `.mail` is in, and, when it names a message, the
 * day and filename. Null for a path outside the mailbox, or in a directory
 * that is not a folder of it. `name` is null for a folder-level path: the
 * folder directory itself, a day folder, or anything nested deeper than a
 * message can be.
 */
export function locate(mailPath, path) {
  if (typeof path !== 'string' || !path.startsWith(`${mailPath}/`)) return null;
  const [dir, day = null, name = null, ...deeper] = path.slice(mailPath.length + 1).split('/');
  const box = Object.keys(BOX_DIRS).find((id) => BOX_DIRS[id] === dir);
  if (!box) return null;
  return { box, day, name: deeper.length ? null : name };
}

/**
 * Read a batch of events as changes to folders:
 *
 *   gap        something was dropped on the way, so every folder is to be
 *              re-read -- a gap means "something happened", never "nothing"
 *   arrived    per folder, the paths of messages written into it -- for the
 *              inbox, mail delivered
 *   filed      per folder, the paths of messages moved into it from
 *              somewhere else -- archived, deleted, restored
 *   left       per folder, the paths of messages that went from it
 *   disturbed  folders changed in a way that names no message -- a day
 *              folder removed or moved in -- so the listing is re-read rather
 *              than patched
 *
 * Delivered and filed are kept apart because they are shown differently: mail
 * that lands is announced, and mail put back where it was is only listed. A
 * move is a departure from one folder and an arrival in another, and a
 * rename within a folder is both in the same one. A folder-level `add` is
 * nothing on its own: a new day folder means nothing until a message lands
 * in it, and that message is its own event. `write` to a message already
 * listed is nothing either -- the listing is of names, not contents. `meta`
 * is nothing yet, and so is any operation newer than this code.
 *
 * Home-relative paths (`~/.mail/…`) are read the same as absolute ones: the
 * mailbox is always directly under the home directory, so the home is the
 * first segment of `mailPath`.
 */
export function planChanges(mailPath, events) {
  const plan = {
    gap: false, arrived: new Map(), filed: new Map(), left: new Map(), disturbed: new Set(),
  };
  const home = mailPath.split('/').slice(0, 2).join('/');
  const absolute = (path) => (typeof path === 'string' && (path === '~' || path.startsWith('~/'))
    ? `${home}${path.slice(1)}`
    : path);
  const note = (map, box, path) => {
    if (!map.has(box)) map.set(box, new Set());
    map.get(box).add(path);
  };
  // What a path turning up somewhere means, and what one going means.
  const came = (map, path) => {
    const at = locate(mailPath, path);
    if (!at) return;
    if (at.name) note(map, at.box, path);
    else plan.disturbed.add(at.box);
  };
  const went = (path) => {
    const at = locate(mailPath, path);
    if (!at) return;
    if (at.name) note(plan.left, at.box, path);
    else plan.disturbed.add(at.box);
  };

  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const path = absolute(event.path);
    switch (event.op) {
      case 'gap':
        plan.gap = true;
        break;
      case 'add':
      case 'write': {
        const at = locate(mailPath, path);
        if (at?.name) note(plan.arrived, at.box, path);
        break;
      }
      case 'remove':
        went(path);
        break;
      case 'move':
        went(absolute(event.from));
        came(plan.filed, path);
        break;
      default:
    }
  }
  return plan;
}
