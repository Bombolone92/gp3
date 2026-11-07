/**
 * Kiosk: a tablet at the front door. Family members type their 4-digit PIN
 * and check their children in or out; staff clock in and out the same way.
 * The app's navigation is hidden, and leaving can require the director's PIN.
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { navigate } from '../ui/router.js';
import { app, setKioskLock, isManager } from '../app.js';
import { call } from '../team.js';
import { personName, firstName } from '../core/format.js';
import { attendanceName, indexDay, statusOf, currentRoom, checkIn, checkOut, staffClockIn, staffClockOut, nowHHMM } from '../core/attendance.js';
import { sortRooms } from '../core/people.js';
import { formatTime } from '../core/dates.js';
import { childAvatar, staffAvatar } from './common.js';

const IDLE_MS = 25000;
// A second tap this soon after checking a child in or out is the rest of a
// double tap, not a request to undo it.
const REPEAT_TAP_MS = 2000;

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Leave kiosk mode for good (after the exit PIN, when one is set). */
function leave() {
  setKioskLock(false);
  navigate('/');
}

/**
 * Who a PIN belongs to. With staff and family access on, the school server
 * checks it, since staff devices never receive staff PINs.
 */
async function lookup(store, pin) {
  if (app.team?.url) {
    const { match } = await call(app.team.url, 'kioskLookup', { pin });
    if (!match) return null;
    return match.kind === 'staff' ? { kind: 'staff', who: store.get('staff', match.id) } : { kind: 'guardian', who: store.get('guardians', match.id) };
  }
  const m = store.all('staff').find((x) => x.pin && x.pin === pin && x.active !== false);
  if (m) return { kind: 'staff', who: m };
  const g = store.all('guardians').find((x) => x.pin && x.pin === pin && (x.studentIds || []).length);
  return g ? { kind: 'guardian', who: g } : null;
}

async function exitAllowed(pin) {
  if (app.team?.url) {
    try {
      return (await call(app.team.url, 'kioskExit', { pin })).match;
    } catch (err) {
      // The kiosk outlives reloads, so with the server unreachable the
      // director and admins check against the PIN's hash they hold.
      if (!isManager() || (err?.status > 0 && err.status < 500)) throw err;
    }
  }
  const hash = app.settings().kioskPinHash;
  return !hash || (await sha256Hex(pin)) === hash;
}

export function render(ctx) {
  const store = app.store;
  // The day is read on every action, so a tablet left on overnight records
  // the morning's check-ins on the right day.
  const today = () => app.today();
  store.open([attendanceName(today())]);
  document.body.classList.add('kiosk-mode');
  setKioskLock(true);
  ctx.onDispose(() => document.body.classList.remove('kiosk-mode'));

  let pin = '';
  let mode = 'pin'; // 'pin' | 'family' | 'staff' | 'exit'
  let who = null;
  let fails = 0;
  let lockedUntil = 0;
  let idle = null;
  const lastTap = new Map(); // studentId -> ms of the last check in or out
  // Typing a digit updates the dots in place, so the key that was pressed
  // keeps focus, and this one live region (never redrawn) announces it.
  const live = h('span.sr-only', { 'aria-live': 'polite' });
  let dots = null;
  const root = h('div.kiosk', { role: 'application', 'aria-label': 'Check-in kiosk' }, live);
  const clock = h('span.kiosk-clock');
  const tick = () => (clock.textContent = formatTime(nowHHMM()));
  tick();
  const timer = setInterval(tick, 15000);
  ctx.onDispose(() => clearInterval(timer));

  const reset = () => {
    pin = '';
    mode = 'pin';
    who = null;
    draw();
  };
  const bump = () => {
    clearTimeout(idle);
    if (mode !== 'pin' || pin) idle = setTimeout(reset, IDLE_MS);
  };
  ctx.onDispose(() => clearTimeout(idle));

  async function submit() {
    if (Date.now() < lockedUntil) return;
    const entered = pin;
    pin = '';
    showPin();
    try {
      if (mode === 'exit') return (await exitAllowed(entered)) ? leave() : fail();
      const found = await lookup(store, entered);
      if (!found?.who) return fail();
      who = found.who;
      mode = found.kind === 'staff' ? 'staff' : 'family';
      fails = 0;
      await store.open([attendanceName(today())]);
    } catch (err) {
      toast(err.message || 'Could not check that PIN. Try again.', { type: 'error' });
      return;
    }
    draw();
    bump();
  }

  function fail() {
    fails++;
    if (fails >= 5) {
      lockedUntil = Date.now() + 30000;
      fails = 0;
      toast('Too many tries. Please wait 30 seconds or ask a teacher.', { type: 'error' });
      setTimeout(draw, 30100);
      draw();
    } else toast('That PIN was not recognized. Try again or ask a teacher.', { type: 'error' });
  }

  function showPin() {
    dots?.replaceChildren(...[0, 1, 2, 3].map((i) => h(`span${i < pin.length ? '.on' : ''}`)));
    live.textContent = mode === 'pin' || mode === 'exit' ? `${pin.length} of 4 digits entered` : '';
  }

  function press(k) {
    if (Date.now() < lockedUntil) return;
    if (k === 'del') pin = pin.slice(0, -1);
    else if (k === 'clear') pin = '';
    else if (pin.length < 4) pin += k;
    bump();
    showPin();
    if (pin.length === 4) submit();
  }

  function keypad(label) {
    dots = h('div.pin-dots', { 'aria-hidden': 'true' });
    const pad = h(
      'div.keypad',
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'del'].map((k) =>
        k === 'clear'
          ? h('button.key.key-ghost', { type: 'button', onClick: () => press('clear') }, 'Clear')
          : k === 'del'
            ? h('button.key.key-ghost', { type: 'button', 'aria-label': 'Delete', onClick: () => press('del') }, icon('arrow-left', 22))
            : h('button.key', { type: 'button', onClick: () => press(k) }, k),
      ),
    );
    return h('div.kiosk-pin', h('h2', label), dots, Date.now() < lockedUntil ? h('p.notice.warning', 'Please wait a moment before trying again.') : null, pad);
  }

  function familyPanel() {
    const day = today();
    const idx = indexDay(store.all(attendanceName(day))).students;
    const kids = (who.studentIds || []).map((id) => store.get('students', id)).filter((s) => s && s.status === 'active');
    const rooms = sortRooms(store.all('rooms'));
    return h(
      'div.kiosk-family',
      h('h2', `Hi ${firstName(who)}`),
      h('p.subtle', 'Tap to check in or out.'),
      h(
        'div.kiosk-kids',
        kids.map((s) => {
          const state = statusOf(idx.get(s.id));
          const inNow = state === 'in';
          // The room they are in, or the one a check in puts them in (today's room after a move).
          const roomId = currentRoom(idx.get(s.id)) || idx.get(s.id)?.roomId || s.roomId;
          return h(
            `button.kiosk-kid${inNow ? '.is-in' : ''}`,
            {
              type: 'button',
              dataset: { kid: s.id },
              onClick: () => {
                if (Date.now() - (lastTap.get(s.id) || 0) < REPEAT_TAP_MS) return;
                lastTap.set(s.id, Date.now());
                if (inNow) checkOut(store, day, s.id, { by: 'Kiosk', person: personName(who) });
                else checkIn(store, day, s.id, { roomId, by: 'Kiosk', person: personName(who) });
                toast(inNow ? `${firstName(s)} checked out. See you soon!` : `${firstName(s)} checked in. Have a great day!`);
                bump();
              },
            },
            childAvatar(s, { size: 'xl' }),
            h('span.kiosk-kid-name', personName(s)),
            h('span.kiosk-kid-room', rooms.find((r) => r.id === roomId)?.name || ''),
            h(`span.kiosk-action${inNow ? '.out' : ''}`, icon(inNow ? 'log-out' : 'log-in', 18), inNow ? 'Check out' : state === 'out' ? 'Check in again' : 'Check in'),
          );
        }),
      ),
      h('button.btn.lg', { type: 'button', onClick: reset }, 'Done'),
    );
  }

  function staffPanel() {
    const day = today();
    const rec = indexDay(store.all(attendanceName(day))).staff.get(who.id);
    const inNow = statusOf(rec) === 'in';
    const rooms = sortRooms(store.all('rooms'));
    const go = (roomId) => {
      if (inNow) staffClockOut(store, day, who.id, { by: 'Kiosk' });
      else staffClockIn(store, day, who.id, { roomId, by: 'Kiosk' });
      toast(inNow ? `${firstName(who)} clocked out` : `${firstName(who)} clocked in`);
      reset();
    };
    return h(
      'div.kiosk-family',
      staffAvatar(who, { size: 'xl' }),
      h('h2', `Hi ${firstName(who)}`),
      inNow
        ? h('button.btn.lg.primary', { type: 'button', onClick: () => go() }, icon('log-out', 18), 'Clock out')
        : h('div.stack', h('p.subtle', 'Which room are you starting in?'), h('div.kiosk-rooms', rooms.map((r) => h('button.btn.lg', { type: 'button', onClick: () => go(r.id) }, r.name)), h('button.btn.lg.ghost', { type: 'button', onClick: () => go(who.roomIds?.[0] || null) }, 'Not in a room'))),
      h('button.btn.ghost', { type: 'button', onClick: reset }, 'Cancel'),
    );
  }

  function draw() {
    const s = app.settings();
    // A check in redraws the cards; keep focus on the card that was tapped.
    const kid = root.contains(document.activeElement) ? document.activeElement.dataset?.kid : null;
    dots = null;
    for (const n of [...root.childNodes]) if (n !== live) n.remove();
    root.append(
      h(
        'header.kiosk-head',
        h('div', h('strong', s.school.name || 'Welcome'), h('span.subtle', ' · '), clock),
        h(
          'button.btn.ghost.sm',
          {
            type: 'button',
            onClick: async () => {
              // Families never see this PIN; with the school server, staff
              // devices do not either, so the server is asked.
              if (await exitAllowed('').catch(() => false)) return leave();
              mode = 'exit';
              pin = '';
              draw();
              bump();
            },
          },
          icon('lock', 15),
          'Exit kiosk',
        ),
      ),
      h('div.kiosk-main', mode === 'family' ? familyPanel() : mode === 'staff' ? staffPanel() : keypad(mode === 'exit' ? 'Director PIN to exit' : 'Enter your 4-digit PIN')),
      mode === 'exit' ? h('button.btn.ghost.kiosk-back', { type: 'button', onClick: reset }, 'Back') : h('footer.kiosk-foot.subtle.small', 'Ask a teacher if you do not know your PIN.'),
    );
    showPin();
    if (kid) [...root.querySelectorAll('[data-kid]')].find((b) => b.dataset.kid === kid)?.focus();
  }

  const onKey = (e) => {
    if (mode !== 'pin' && mode !== 'exit') return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
  };
  document.addEventListener('keydown', onKey);
  ctx.onDispose(() => document.removeEventListener('keydown', onKey));
  const off = store.subscribe((c) => c.has('attendance') && (mode === 'family' || mode === 'staff') && draw());
  ctx.onDispose(off);
  draw();
  return { node: root, title: 'Check-in kiosk' };
}
