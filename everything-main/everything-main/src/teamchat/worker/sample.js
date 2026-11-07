/**
 * "Explore with sample data": builds a complete demo workspace owned by the
 * caller, populated by six fictional teammates. Everything is written with
 * the same key layout the live code uses, so the demo exercises the real
 * read paths (blocks, overlays, threads, reads, mentions). Sample members
 * carry `smp_` uuids and never map to real accounts.
 */
import { KEYS, blockIndexOf, mergeBlock, overlayKey, threadConvId } from '../src/shared/blocks.js';
import { uid, inviteCode, dmConvId } from '../src/shared/ids.js';
import { INVITE_TTLS, DEFAULT_INVITE_TTL } from '../src/shared/limits.js';
import { kv } from './lib.js';
import { writeIndexFor, indexStamp } from './search.js';

const PEOPLE = [
  { uuid: 'smp_ava', username: 'ava', name: 'Ava Chen', title: 'Product designer', color: 5 },
  { uuid: 'smp_marcus', username: 'marcus', name: 'Marcus Reid', title: 'Engineering lead', color: 1 },
  { uuid: 'smp_priya', username: 'priya', name: 'Priya Nair', title: 'Frontend engineer', color: 3 },
  { uuid: 'smp_tomas', username: 'tomas', name: 'Tomas Alvarez', title: 'Marketing', color: 2 },
  { uuid: 'smp_lena', username: 'lena', name: 'Lena Fischer', title: 'Customer support', color: 4 },
  { uuid: 'smp_jordan', username: 'jordan', name: 'Jordan Blake', title: 'Founder', color: 7 },
];

/** A conversation under construction: messages in order, plus overlays. */
class Conv {
  constructor(id) {
    this.id = id;
    this.m = [];
    this.x = {};
  }
  add(u, t, ts, extra = {}) {
    const s = this.m.length + 1;
    this.m.push({ s, u, t, ts, ...extra });
    return s;
  }
  react(seq, reaction, users) {
    const k = overlayKey(seq);
    this.x[k] = this.x[k] || {};
    this.x[k].r = this.x[k].r || {};
    this.x[k].r[reaction] = Object.fromEntries(users.map((u) => [u, 1]));
  }
  edit(seq, text, ts) {
    const k = overlayKey(seq);
    this.x[k] = { ...(this.x[k] || {}), t: text, e: ts };
  }
  thread(seq, count, lastTs) {
    const k = overlayKey(seq);
    this.x[k] = { ...(this.x[k] || {}), rc: count, rt: lastTs };
  }
  get seq() {
    return this.m.length;
  }
  last() {
    return this.m[this.m.length - 1];
  }
}

/** Write a conversation as its counter plus 50-message blocks. */
async function flush(conv) {
  const blocks = new Map();
  for (const m of conv.m) {
    const n = blockIndexOf(m.s);
    if (!blocks.has(n)) blocks.set(n, { m: [], x: {} });
    blocks.get(n).m.push(m);
  }
  for (const [k, o] of Object.entries(conv.x)) {
    const seq = Number(k.slice(1));
    const b = blocks.get(blockIndexOf(seq));
    if (b) b.x[k] = o;
  }
  if (!blocks.size) blocks.set(0, { m: [], x: {} });
  const head = Math.max(...blocks.keys());
  if (!blocks.has(head + 1)) blocks.set(head + 1, { m: [], x: {} });
  await kv().set(KEYS.seq(conv.id), conv.seq);
  for (const [n, b] of blocks) await kv().set(KEYS.block(conv.id, n), b);
}

export async function buildSampleWorkspace(profile) {
  const wsId = uid(10);
  const now = Date.now();
  const HOUR = 3600 * 1000;
  const DAY = 24 * HOUR;
  // Minutes into a day, N days ago, landing on a normal working day rhythm.
  const at = (daysAgo, h, m = 0) => {
    const d = new Date(now - daysAgo * DAY);
    d.setHours(h, m, 0, 0);
    return Math.min(d.getTime(), now - 60 * 1000);
  };
  const me = profile.uuid;
  const meName = profile.name || profile.username;
  const [ava, marcus, priya, tomas, lena, jordan] = PEOPLE.map((p) => p.uuid);

  const ids = {
    general: uid(10), design: uid(10), engineering: uid(10), random: uid(10),
    announcements: uid(10), launch: uid(10),
  };

  /* ---- #general: long enough to span two blocks ------------------------ */
  const general = new Conv(ids.general);
  general.add(jordan, 'Jordan Blake created #general', at(9, 9, 0), { k: 'sys' });
  const chatter = [
    [jordan, 'Morning all. Standup notes are in the usual doc; nothing blocking this week.'],
    [marcus, 'Heads up: staging redeploys at 11:00. Should be a two minute blip.'],
    [ava, 'Posting the updated onboarding flow in #design after lunch, would love eyes on it.'],
    [priya, 'Merged the keyboard navigation fixes for the sidebar. Tab order finally makes sense.'],
    [tomas, 'Newsletter draft is ready for review. Aiming to send Thursday.'],
    [lena, 'Support queue is quiet today. Two questions about invite links, both answered.'],
    [marcus, 'Staging is back. Let me know if anything looks off.'],
    [ava, 'Reminder: design critique is at 3pm. Bring one thing you are unsure about.'],
    [jordan, 'Great critique today. The empty state direction is the right call.'],
    [priya, 'Quick one: are we keeping the 44px touch targets on desktop too? I vote yes.'],
    [ava, 'Yes. Consistency beats density here.'],
    [tomas, 'Blog post on how we use threads is live. Sharing internally first for feedback.'],
    [lena, 'A customer asked whether private channels can be converted to public. Do we support that?'],
    [marcus, 'Not yet. Tracking it as a feature request.'],
    [jordan, 'Friday demo is at 4pm. Everyone shows one thing they shipped, no slides.'],
    [priya, 'Dark mode contrast pass is done. Every text color clears 4.5:1 now.'],
    [ava, 'The new avatar colors look great in both themes.'],
    [tomas, 'Q3 launch teaser goes out Monday. Copy is in the shared folder.'],
    [lena, 'Two more sign ups from the teaser preview list. People are curious.'],
    [marcus, 'Message pagination is deployed. Old history loads a block at a time now.'],
    [jordan, 'That was fast. Nice work.'],
    [priya, 'Working on the composer autocomplete for mentions today.'],
    [ava, 'Can we show the mention chip in the accent color rather than a background fill?'],
    [priya, 'Sure, easy change.'],
    [tomas, 'Heads up: I will be out Thursday afternoon.'],
    [lena, 'Same, dentist. Back by 3.'],
    [marcus, 'Reminder to rotate the demo workspace invite code after the webinar.'],
    [jordan, 'Done.'],
    [lena, 'Docs question: where do we explain the difference between leaving and archiving a channel?'],
    [ava, 'In the channel details panel, next to the buttons themselves. Help where the decision is.'],
    [priya, 'Added a short line there. Shipping with the next deploy.'],
    [tomas, 'Webinar slides are in the shared folder for comments until Wednesday.'],
  ];
  let day = 8;
  let hour = 9;
  for (const [u, t] of chatter) {
    general.add(u, t, at(day, hour, (hour * 7) % 60));
    hour += 1;
    if (hour > 17) {
      hour = 9;
      day -= 1;
    }
  }
  // More recent traffic, spread over the last two days.
  const recent = [
    [2, 9, 5, priya, 'Shipped the thread panel. Replies open on the right on desktop and full screen on mobile.'],
    [2, 9, 12, ava, 'Trying it now.'],
    [2, 9, 30, ava, 'Love it. One nit: the reply count should be a button, not just text.'],
    [2, 9, 41, priya, 'Agreed, fixing.'],
    [2, 11, 2, tomas, 'Webinar registrations passed 200.'],
    [2, 11, 15, jordan, 'Excellent. Lena, can you prep a short FAQ for the chat during the session?'],
    [2, 11, 20, lena, 'On it.'],
    [2, 14, 5, marcus, 'Reactions now sync between clients within a few seconds. Give them a try on this message.'],
    [2, 16, 30, ava, 'End of day screenshots of the settings screen are in #design.'],
    [1, 9, 2, jordan, 'Reminder that we have a new teammate starting today.'],
    [1, 9, 15, lena, 'Coffee is on. Welcome!'],
    [1, 10, 0, marcus, 'Standup moved to 10:15 today so everyone can join.'],
    [1, 12, 30, tomas, 'Lunch order is in. Pickup at 12:45.'],
    [1, 15, 0, priya, 'Fixed the unread divider jumping when older messages load.'],
    [1, 15, 10, ava, 'That one was driving me nuts. Thank you.'],
    [1, 17, 45, jordan, 'Have a good evening everyone.'],
    [0, 8, 55, marcus, 'Morning. Deploy went out overnight; no alerts.'],
    [0, 9, 10, lena, 'Support inbox is at zero.'],
    [0, 9, 20, tomas, 'Sharing the launch checklist in #launch-q3 shortly.'],
  ];
  const seqOf = {};
  for (const [d, h, m, u, t] of recent) {
    const s = general.add(u, t, at(d, h, m));
    if (t.startsWith('Reactions now sync')) seqOf.reactions = s;
    if (t.startsWith('Shipped the thread panel')) seqOf.threadPanel = s;
  }
  const welcomeSeq = general.add(ava, `@${profile.username} welcome aboard! Say hello whenever you are ready, and ask me anything about the design system.`, at(0, 9, 32), { mn: [me] });
  general.add(jordan, 'Welcome! Glad you are here.', at(0, 9, 35));
  general.react(seqOf.reactions, 'thumbs-up', [ava, priya, lena]);
  general.react(seqOf.reactions, 'rocket', [jordan]);
  general.react(welcomeSeq, 'heart', [jordan, lena]);
  general.react(seqOf.threadPanel, 'party-popper', [ava, marcus, tomas, jordan]);

  // Thread under the thread panel message.
  const threadA = new Conv(threadConvId(ids.general, seqOf.threadPanel));
  threadA.add(marcus, 'Does the panel remember its width between sessions?', at(2, 9, 50));
  threadA.add(priya, 'Not yet. It is fixed at 360px on desktop for now.', at(2, 9, 58));
  threadA.add(ava, 'Fixed is fine for v1. Resizable can come later.', at(2, 10, 5));
  general.thread(seqOf.threadPanel, threadA.seq, threadA.last().ts);

  /* ---- #design ---------------------------------------------------------- */
  const design = new Conv(ids.design);
  design.add(ava, 'Ava Chen created #design', at(9, 9, 5), { k: 'sys' });
  design.add(ava, 'Principles for this app, in one line each:\n**Calm** over busy.\n**Legible** over dense.\n**Consistent** over clever.', at(8, 10, 0));
  const critiqueSeq = design.add(ava, 'Updated onboarding flow: three steps, one decision each. Create, join, or explore with sample data.', at(6, 13, 40));
  design.add(priya, 'The sample data option is going to save so many first sessions.', at(6, 13, 55));
  design.add(jordan, 'Agree. Also nice that skipping loses nothing.', at(6, 14, 10));
  design.add(ava, 'Settings screen with the theme switcher. System is the default; the toggle stamps the root element so it wins over the OS preference.', at(2, 16, 28));
  design.add(tomas, 'Can I use these for the launch post?', at(2, 16, 40));
  design.add(ava, 'Yes, but wait for the final icon set. Draft ones have inconsistent stroke widths.', at(2, 16, 47));
  design.react(critiqueSeq, 'heart', [priya, jordan, lena]);
  const threadB = new Conv(threadConvId(ids.design, critiqueSeq));
  threadB.add(lena, 'Could the join step accept a full invite link, not just the code?', at(6, 14, 30));
  threadB.add(ava, 'Yes, it should. Paste either and we pull the code out.', at(6, 14, 42));
  design.thread(critiqueSeq, threadB.seq, threadB.last().ts);

  /* ---- #engineering ----------------------------------------------------- */
  const eng = new Conv(ids.engineering);
  eng.add(marcus, 'Marcus Reid created #engineering', at(9, 9, 10), { k: 'sys' });
  eng.add(marcus, 'Storage design recap. Each conversation has a counter and fixed-size blocks:\n```\ntc:conv:{id}:seq     -> kv.incr, gives every message its seq\ntc:conv:{id}:b:{n}   -> block n holds seqs n*50+1 .. (n+1)*50\n```\nThe head block index is `floor((seq - 1) / 50)`, so readers never list keys.', at(7, 11, 0));
  eng.add(priya, 'And edits go into the overlay map on the same block rather than rewriting the array?', at(7, 11, 12));
  const overlaySeq = eng.add(marcus, 'Right. `kv.update(block, {"x.s42.t": text})` is one atomic path write, so it can never race an append.', at(7, 11, 15));
  eng.add(priya, 'Clean. Threads are just conversations with an `_t{seq}` suffix then.', at(7, 11, 20));
  eng.add(marcus, 'Exactly, same code path.', at(7, 11, 21));
  eng.add(priya, 'PR for the sync poll is up. One read of the activity doc per poll, deltas only.', at(1, 14, 0));
  eng.add(marcus, 'Reviewing now.', at(1, 14, 8));
  eng.add(marcus, 'Approved. Ship it.', at(1, 14, 40));
  eng.edit(overlaySeq, 'Right. `kv.update(block, {"x.s42.t": text})` is one atomic path write, so it can never race an append. Same trick for reactions and thread counts.', at(7, 11, 18));
  eng.react(overlaySeq, 'check', [priya, jordan]);

  /* ---- #random ---------------------------------------------------------- */
  const random = new Conv(ids.random);
  random.add(tomas, 'Tomas Alvarez created #random', at(9, 9, 15), { k: 'sys' });
  random.add(tomas, 'Best coffee near the office. Go.', at(5, 15, 0));
  random.add(lena, 'The place on the corner, no contest.', at(5, 15, 3));
  random.add(priya, 'Overrated. The cart by the park.', at(5, 15, 6));
  random.add(jordan, 'The office machine, because it is free.', at(5, 15, 9));
  const bikeSeq = random.add(ava, 'Anyone cycling in tomorrow? Weather looks good.', at(1, 18, 30));
  random.add(marcus, 'Count me in.', at(1, 18, 45));
  random.react(bikeSeq, 'thumbs-up', [marcus, tomas]);
  random.react(5, 'laugh', [ava, lena, priya, tomas]);

  /* ---- #announcements (default, low traffic) ---------------------------- */
  const ann = new Conv(ids.announcements);
  ann.add(jordan, 'Jordan Blake created #announcements', at(9, 9, 20), { k: 'sys' });
  ann.add(jordan, 'Q3 launch date is confirmed for the 15th. Details in #launch-q3.', at(3, 10, 0));
  ann.add(jordan, 'The office is closed next Monday for the public holiday.', at(1, 9, 0));

  /* ---- #launch-q3 (private, includes the user) --------------------------- */
  const launch = new Conv(ids.launch);
  launch.add(tomas, 'Tomas Alvarez created #launch-q3', at(4, 9, 0), { k: 'sys' });
  launch.add(tomas, 'Launch checklist:\n1. Final copy approved\n2. Screenshots in both themes\n3. Webinar FAQ\n4. Invite code rotated after the session', at(0, 9, 25));
  launch.add(jordan, `Adding ${meName} here so they have the full context from day one.`, at(0, 9, 28));

  /* ---- Direct messages -------------------------------------------------- */
  // Scoped to this workspace, as every direct message is: two sample
  // workspaces of one owner would otherwise share (and overwrite) these.
  const dmAva = new Conv(dmConvId([me, ava], wsId));
  dmAva.add(ava, `Hi ${meName}! I am Ava, I look after design. If anything in the app feels off, tell me here.`, at(0, 9, 40));
  dmAva.add(ava, 'Also: the sample workspace is yours to play with. Nothing here is precious.', at(0, 9, 41));

  const dmGroup = new Conv(dmConvId([me, marcus, priya], wsId));
  dmGroup.add(marcus, `Looping in ${meName}. Priya, can you share the onboarding notes?`, at(0, 10, 5));
  dmGroup.add(priya, 'Sure, sending them over in a bit.', at(0, 10, 9));

  /* ---- Write everything ------------------------------------------------- */
  const ts = now;
  const code = inviteCode();
  const inviteExp = ts + INVITE_TTLS[DEFAULT_INVITE_TTL].seconds * 1000;
  // The owner's card as memberRecord makes one: their photo and status
  // travel with it, as they do into any other workspace of theirs.
  const members = { [me]: { username: profile.username, name: meName, title: profile.title || '', color: profile.color || 6, avatar: profile.avatar || null, status: profile.status || null, role: 'owner', joinedAt: at(0, 9, 30) } };
  const statuses = {
    [ava]: { emoji: '🎨', text: 'In critique until 3', until: now + 3 * HOUR },
    [marcus]: { emoji: '🚀', text: 'Deploying, back soon', until: now + HOUR },
    [lena]: { emoji: '🌴', text: 'On holiday until Monday', until: null },
  };
  for (const p of PEOPLE) {
    members[p.uuid] = { username: p.username, name: p.name, title: p.title, color: p.color, role: p.uuid === jordan ? 'admin' : 'member', joinedAt: at(9, 9, 0), sample: true, status: statuses[p.uuid] || null };
  }
  const memberCount = PEOPLE.length + 1;
  const channel = (id, name, topic, extra = {}) => ({
    id, name, topic, private: false, def: false, createdBy: jordan, createdAt: at(9, 9, 0), count: memberCount, ...extra,
  });
  const ws = {
    id: wsId,
    name: 'Northwind Studio',
    owner: me,
    invite: code,
    inviteExp,
    createdAt: at(9, 9, 0),
    sample: true,
    search: indexStamp(),
    channels: {
      [ids.general]: channel(ids.general, 'general', 'Company-wide announcements and conversation', { def: true }),
      [ids.announcements]: channel(ids.announcements, 'announcements', 'Official updates. Low traffic, high signal.', { def: true }),
      [ids.design]: channel(ids.design, 'design', 'Critique, principles, and work in progress', { createdBy: ava }),
      [ids.engineering]: channel(ids.engineering, 'engineering', 'Architecture, deploys, and code review', { createdBy: marcus }),
      [ids.random]: channel(ids.random, 'random', 'Everything that is not work', { createdBy: tomas }),
      [ids.launch]: channel(ids.launch, 'launch-q3', 'Private: Q3 launch coordination', {
        private: true, createdBy: tomas, count: 4, members: [me, tomas, jordan, marcus],
      }),
    },
    members,
  };

  const convs = [general, design, eng, random, ann, launch, threadA, threadB, dmAva, dmGroup];
  const activity = { c: {}, p: { [ava]: ts, [marcus]: ts, [priya]: ts - 40 * 1000, [tomas]: ts - 3 * HOUR }, ps: { [marcus]: 'dnd' }, u: {}, w: ts };
  for (const c of convs) {
    const last = c.last();
    if (last) activity.c[c.id] = { s: c.seq, t: last.ts, u: last.u };
  }
  activity.c[ids.general].x = ts;

  const allChannels = Object.keys(ids).map((k) => ids[k]);
  const dmEntry = (ms) => ({ members: [...ms].sort(), createdAt: at(0, 9, 40) });
  const myDoc = {
    channels: allChannels,
    dms: { [dmAva.id]: dmEntry([me, ava]), [dmGroup.id]: dmEntry([me, marcus, priya]) },
    // Caught up on the quiet channels; #general, #design, the private
    // channel, and both DMs have unread messages waiting.
    reads: {
      [ids.general]: general.seq - 3,
      [ids.design]: design.seq - 2,
      [ids.engineering]: eng.seq,
      [ids.random]: random.seq,
      [ids.announcements]: ann.seq,
      [ids.launch]: 1,
    },
    mentions: { [ids.general]: 1 },
    joinedAt: at(0, 9, 30),
  };

  await kv().set(KEYS.ws(wsId), ws);
  await kv().set(KEYS.invite(code), { ws: wsId, exp: inviteExp });
  await kv().expire(KEYS.invite(code), INVITE_TTLS[DEFAULT_INVITE_TTL].seconds).catch(() => {});
  await kv().set(KEYS.activity(wsId), activity);
  await kv().set(KEYS.member(wsId, me), myDoc);
  for (const p of PEOPLE) {
    const chans = p.uuid === tomas || p.uuid === jordan || p.uuid === marcus ? allChannels : allChannels.filter((c) => c !== ids.launch);
    await kv().set(KEYS.member(wsId, p.uuid), { channels: chans, dms: {}, reads: {}, mentions: {}, joinedAt: at(9, 9, 0), sample: true });
  }
  for (const c of convs) await flush(c);
  // The demo is searchable from the first moment, like a fresh workspace.
  await writeIndexFor(wsId, convs.map((c) => ({ id: c.id, messages: mergeBlock({ m: c.m, x: c.x }) })));
  return wsId;
}
