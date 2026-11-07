/**
 * Demo data for the dev mock: `await __seed()` in the console of mock.html
 * fills the current help desk with organizations, customers, tickets with
 * conversations spread over the last few weeks, and help articles. It runs
 * the real backend with a moving clock, so timestamps and reports look real.
 */
import { createBackend } from '../src/server/backend.js';

const ORGS = [
  ['Northwind Traders', 'northwind.example'],
  ['Bluebird Health', 'bluebird.example'],
  ['Atlas Logistics', 'atlas.example'],
  ['Juniper Studio', 'juniper.example'],
  ['Kestrel Bank', 'kestrel.example'],
];
const FIRST = ['Ava', 'Liam', 'Maya', 'Noah', 'Zoe', 'Ethan', 'Isla', 'Lucas', 'Aria', 'Mateo', 'Nora', 'Leo', 'Hana', 'Omar', 'Sofia', 'Ravi', 'Elena', 'Kai', 'Priya', 'Jonas'];
const LAST = ['Patel', 'Nguyen', 'Garcia', 'Kim', 'Okafor', 'Rossi', 'Schmidt', 'Haddad', 'Silva', 'Novak', 'Tanaka', 'Moreau'];
const ISSUES = [
  ['Unable to log in after password reset', 'I reset my password this morning but the sign in page keeps saying my credentials are wrong. I have tried twice. Could someone take a look?', 'incident', ['login']],
  ['Invoice shows the wrong billing address', 'Our latest invoice still has our old office address. We moved in March. Can you update it and send a corrected copy?', 'question', ['billing']],
  ['Export to CSV times out', 'When I export the monthly report to CSV, the page spins for a minute and then shows a timeout error. Smaller date ranges work.', 'problem', ['export', 'reports']],
  ['How do I add a new team member?', 'We hired two people this week. What is the best way to give them access with the right permissions?', 'question', ['accounts']],
  ['Mobile app crashes on startup', 'Since the latest update the iOS app closes right after the splash screen. iPhone 13, iOS 18.', 'incident', ['mobile', 'crash']],
  ['Request to upgrade our plan', 'We would like to move to the annual plan with 25 seats. Can you send a quote?', 'task', ['sales', 'billing']],
  ['Emails from your system go to spam', 'Notifications sent to our customers are landing in spam folders for Outlook users.', 'problem', ['email']],
  ['Charged twice this month', 'I see two identical charges on our card for October. Please refund the duplicate.', 'incident', ['billing', 'refund']],
  ['Feature request: dark mode in reports', 'Our team works late shifts and would love a dark theme in the reporting area.', 'question', ['feedback']],
  ['Data import failed halfway', 'The import of our contacts stopped at row 4,312 with an unknown error. The file is attached to an earlier email.', 'incident', ['import']],
  ['Two-factor codes not arriving', 'Text messages with sign in codes are not arriving for several of our users in Germany.', 'incident', ['login', '2fa']],
  ['Can we change the account owner?', 'Our previous admin left the company. We need to transfer ownership to me.', 'question', ['accounts']],
];
const REPLIES = [
  'Thanks for the details. I am looking into this now and will get back to you shortly.',
  'Could you send a screenshot of the error and the time it happened? That will help us trace it.',
  'I was able to reproduce this. Our engineers are working on a fix and I will keep you posted.',
  'This should be fixed now. Could you try again and let me know if it works for you?',
  'I have updated this on your account. You should see the change within a few minutes.',
];
const CUSTOMER_REPLIES = [
  'Here is the screenshot. It happened around 9:40 this morning.',
  'That worked, thank you so much for the quick help!',
  'Still seeing the same problem on my side, unfortunately.',
  'Thanks, that answers my question.',
];
const ARTICLES = [
  ['Reset your password', '<p>If you forgot your password, choose <strong>Forgot password</strong> on the sign in page and follow the link we email you.</p><ul><li>The link is valid for 30 minutes.</li><li>Check your spam folder if it does not arrive.</li></ul>'],
  ['Add and remove team members', '<p>Administrators can invite people from <strong>Settings, Team</strong>. Each person gets an email with a link to join.</p><p>To remove someone, open their profile and choose <strong>Remove from team</strong>.</p>'],
  ['Understanding your invoice', '<p>Your invoice lists every seat and add-on for the billing period. Taxes are calculated from your billing address.</p>'],
  ['Export data to CSV', '<p>Open any report and choose <strong>Export</strong>. Large exports are emailed to you when they are ready.</p>'],
  ['Set up two-factor authentication', '<p>Two-factor authentication adds a second step when you sign in. Turn it on from <strong>Profile, Security</strong>.</p>'],
  ['Troubleshoot the mobile app', '<p>Update to the latest version, then restart your phone. If the app still closes, reinstall it and sign in again.</p>'],
];

function pick(list, i) {
  return list[i % list.length];
}

window.__seed = async function seed() {
  const p = window.puter;
  const me = await p.auth.getUser();
  const doc = await p.kv.get('hdu:me');
  const ref = doc?.last;
  if (!ref || !ref.startsWith('local/')) throw new Error('Open a help desk created in this browser first');
  const desk = ref.split('/')[1];
  const start = Date.now() - 21 * 86400000;
  // Tickets are spread over the three weeks, each with room for its own
  // replies (at most about five hours), so nothing lands in the future.
  const spacing = (21 * 86400000 - 12 * 3600000) / 48;
  let now = start;
  const backend = createBackend({ kv: p.kv, fs: p.fs, now: () => now, ownerUuid: async () => me.uuid });
  const who = async () => ({ uuid: me.uuid, username: me.username });
  const call = async (method, path, body) => {
    const res = await backend.handle({ method, path, query: {}, body, headers: { 'x-real-ip': `10.0.0.${Math.floor(Math.random() * 200)}` }, who });
    if (res.status && res.status >= 400) throw new Error(`${path}: ${res.body?.message}`);
    return res.body;
  };
  const base = `/api/d/${desk}`;
  await call('PUT', `${base}/meta`, { portal: { enabled: true, title: 'Acme Help Center', intro: 'Search our guides or send us a request. We usually reply within a few hours.' } });
  const kb = await p.kv.get(`hd:${desk}:cfg:kb`);
  for (const [i, [title, body]] of ARTICLES.entries()) {
    await call('POST', `${base}/articles`, { title, body, status: 'published', section: kb.sections[i % kb.sections.length].id, labels: [] });
  }
  await call('PUT', `${base}/cfg/fields`, { value: [{ id: 'plan', title: 'Plan', type: 'dropdown', portal: true, options: [{ label: 'Free' }, { label: 'Team' }, { label: 'Business' }, { label: 'Enterprise' }] }] });
  const orgs = [];
  for (const [name, domain] of ORGS) orgs.push((await call('POST', `${base}/orgs`, { name, domains: domain })).org);
  const users = [];
  for (let i = 0; i < 22; i++) {
    const first = pick(FIRST, i);
    const last = pick(LAST, i * 7 + 3);
    const org = orgs[i % (orgs.length + 1)] || null;
    const email = `${first}.${last}@${org ? org.domains[0] : 'mail.example'}`.toLowerCase();
    users.push((await call('POST', `${base}/users`, { name: `${first} ${last}`, email, tz: pick(['Europe/Berlin', 'America/New_York', 'Asia/Tokyo', 'America/Los_Angeles'], i) })).user);
  }
  const statuses = ['new', 'open', 'open', 'pending', 'hold', 'solved', 'solved', 'closed', 'open', 'pending'];
  const pris = ['normal', 'high', 'normal', 'low', 'urgent', 'normal'];
  for (let i = 0; i < 48; i++) {
    now = Math.max(now, Math.floor(start + i * spacing + Math.random() * 0.3 * spacing));
    const [subject, desc, type, tags] = pick(ISSUES, i);
    const u = users[(i * 5) % users.length];
    const res = await call('POST', `/p/${desk}/requests`, { name: u.name, email: u.email, subject, description: desc });
    const id = res.id;
    await call('POST', `${base}/tickets/${id}`, { patch: { type, priority: pick(pris, i), tags, fields: { plan: pick(['team', 'business', 'free', 'enterprise'], i) } } });
    const target = pick(statuses, i);
    if (target === 'new' && i > 40) continue;
    now += Math.floor(40 * 60000 * Math.random()) + 10 * 60000;
    await call('POST', `${base}/tickets/${id}`, { patch: { assignee: i % 4 === 3 ? null : me.uuid, group: 'support', status: target === 'new' ? 'open' : 'open' }, comment: { html: `<p>Hi ${u.name.split(' ')[0]},</p><p>${pick(REPLIES, i)}</p>`, public: true } });
    if (i % 3 === 0) {
      now += 30 * 60000;
      await call('POST', `${base}/tickets/${id}`, { comment: { html: '<p>Checked the logs, looks related to the deploy on Tuesday. Keeping an eye on it.</p>', public: false } });
    }
    if (i % 2 === 0) {
      now += 2 * 3600000;
      await call('POST', `/p/${desk}/requests/${id}/comments`, { key: res.key, body: pick(CUSTOMER_REPLIES, i) });
    }
    if (['pending', 'hold', 'solved', 'closed'].includes(target)) {
      now += 3600000;
      await call('POST', `${base}/tickets/${id}`, { patch: { status: target === 'closed' ? 'solved' : target }, comment: { html: `<p>${pick(REPLIES, i + 3)}</p>`, public: true } });
      if (target === 'solved' || target === 'closed') {
        if (i % 3 !== 2) await call('POST', `/p/${desk}/requests/${id}/rate`, { key: res.key, score: i % 7 === 0 ? 'bad' : 'good', comment: i % 7 === 0 ? 'Took a while to get an answer.' : 'Quick and helpful, thanks!' });
      }
    }
  }
  now = Date.now();
  await p.kv.update(`hd:${desk}:meta`, { sweptAt: 0 });
  await call('GET', `${base}/sync`, null);
  // The seeded change feed is backdated (already expired), so drop the local cache
  // and let the next load read everything fresh.
  indexedDB.deleteDatabase('help-desk');
  return 'Seeded. Reload the page.';
};
