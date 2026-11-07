/**
 * The test mailbox: a handful of realistic raw RFC 822 messages served from
 * an in-memory fs with the same shape as puter.fs (readdir/read/stat) and the
 * same on-disk layout the `emailrx` extension writes. The suites mount the
 * whole app over it, so its normal code path runs against real MIME:
 * quoted-printable, base64, encoded words, multipart, attachments.
 */

const enc = new TextEncoder();

const b64 = (text) => btoa(String.fromCharCode(...enc.encode(text)));
const b64url = (text) => b64(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const pad = (n, w = 2) => String(n).padStart(w, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// A uuidv7-shaped name: the leading timestamp hex keeps text order equal to
// time order, which is all the mailbox layout relies on.
const fakeUuid7 = (date, seq) => {
  const ms = date.getTime().toString(16).padStart(12, '0');
  return `${ms.slice(0, 8)}-${ms.slice(8, 12)}-7${pad(seq, 3)}-8000-000000000000`;
};

const CRLF = '\r\n';
const join = (lines) => lines.join(CRLF);

/** One message: daysAgo/hour/minute anchor the Date header, raw() builds the file. */
const MESSAGES = [
  {
    daysAgo: 0, hour: 9, minute: 24,
    subject: 'Welcome to your Puter mailbox',
    raw: (date, to) => join([
      `From: Puter Team <hello@puter.com>`,
      `To: ${to}`,
      `Subject: Welcome to your Puter mailbox`,
      `Date: ${date.toUTCString()}`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      `Hi there,`,
      ``,
      `This inbox lives entirely in your Puter account. Messages sent to your`,
      `address are stored as files under /you/.mail, and this app simply reads`,
      `them. Nothing is copied anywhere else.`,
      ``,
      `A few things worth knowing:`,
      ``,
      `- Messages render as plain text, which keeps tracking pixels and`,
      `  scripts out of your inbox.`,
      `- Attachments can be downloaded from the message view.`,
      `- Your read/unread state stays on this device.`,
      ``,
      `Enjoy,`,
      `The Puter Team`,
    ]),
  },
  {
    daysAgo: 0, hour: 8, minute: 2,
    subject: '[HeyPuter/puter] Pull request #4821: Fix window snapping on multi-monitor setups',
    raw: (date, to) => {
      const boundary = 'gh-boundary-0001';
      return join([
        `From: GitHub <notifications@github.com>`,
        `To: ${to}`,
        `Subject: [HeyPuter/puter] Pull request #4821: Fix window snapping on multi-monitor setups`,
        `Date: ${date.toUTCString()}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset=utf-8`,
        ``,
        `@mira-dev requested your review on this pull request.`,
        ``,
        `Fix window snapping on multi-monitor setups`,
        ``,
        `Snapping previously used the primary display bounds for every window.`,
        `This change resolves the display under the cursor first.`,
        ``,
        `View it on GitHub: https://github.com/HeyPuter/puter/pull/4821`,
        `--${boundary}`,
        `Content-Type: text/html; charset=utf-8`,
        ``,
        `<html><body><p><b>@mira-dev</b> requested your review.</p></body></html>`,
        `--${boundary}--`,
      ]);
    },
  },
  {
    daysAgo: 0, hour: 7, minute: 41,
    subject: 'Your receipt from Nimbus Coffee',
    raw: (date, to) => {
      const body = [
        'Thanks for stopping by!',
        '',
        'Flat white (oat)        4.80',
        'Almond croissant        3.50',
        '------------------------------',
        'Total                   8.30',
        '',
        'Paid with card ending 4421.',
        'See you tomorrow?',
      ].join('\n');
      return join([
        `From: Nimbus Coffee <receipts@nimbus.coffee>`,
        `To: ${to}`,
        `Subject: Your receipt from Nimbus Coffee`,
        `Date: ${date.toUTCString()}`,
        `MIME-Version: 1.0`,
        `Content-Type: text/plain; charset=utf-8`,
        `Content-Transfer-Encoding: base64`,
        ``,
        b64(body).replace(/(.{72})/g, `$1${CRLF}`),
      ]);
    },
  },
  {
    daysAgo: 1, hour: 18, minute: 12,
    subject: 'Réservation confirmée pour vendredi',
    raw: (date, to) => join([
      `From: =?utf-8?Q?Caf=C3=A9_Lumi=C3=A8re?= <bonjour@lumiere.example>`,
      `To: ${to}`,
      `Subject: =?utf-8?Q?R=C3=A9servation_confirm=C3=A9e_pour_vendredi?=`,
      `Date: ${date.toUTCString()}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=utf-8`,
      `Content-Transfer-Encoding: quoted-printable`,
      ``,
      `Bonjour,`,
      ``,
      `Votre table pour deux est confirm=C3=A9e vendredi =C3=A0 20h00.`,
      `Au plaisir de vous accueillir !`,
      ``,
      `Caf=C3=A9 Lumi=C3=A8re`,
    ]),
  },
  {
    // A real HTML newsletter: table layout, inline CSS, an inline image by
    // cid, a remote image, a tracking pixel, a script, and a javascript: link.
    // Everything the HTML view has to handle, in one message.
    daysAgo: 1, hour: 11, minute: 55,
    subject: 'Issue 214: Interfaces that disappear',
    raw: (date, to) => {
      const boundary = 'related-boundary-0003';
      const dot = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
      return join([
        `From: Design Weekly <digest@designweekly.example>`,
        `To: ${to}`,
        `Subject: Issue 214: Interfaces that disappear`,
        `Date: ${date.toUTCString()}`,
        // The way off the list that a real newsletter carries in its headers,
        // which is what the reader's Unsubscribe control reads.
        `List-Unsubscribe: <mailto:leave@designweekly.example?subject=unsubscribe>,`,
        ` <https://designweekly.example/unsubscribe?u=sample>`,
        `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/related; boundary="${boundary}"; type="text/html"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/html; charset=utf-8`,
        ``,
        `<html><head><style>`,
        `  .wrap { font-family: Georgia, serif; color: #222; }`,
        `  .rule { border-top: 3px solid #0b57d0; width: 64px; }`,
        `  td { padding: 8px 12px; vertical-align: top; }`,
        `  .muted { color: #777; font-size: 12px; }`,
        `</style></head><body style="margin:0;background:#f4f4f2">`,
        `<table class="wrap" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">`,
        `<table width="560" bgcolor="#ffffff" cellpadding="0" cellspacing="0">`,
        `<tr><td><img src="cid:dw-logo@designweekly.example" width="40" height="40" alt="Design Weekly"></td></tr>`,
        `<tr><td><h1 style="font-size:26px;margin:8px 0 4px">Interfaces that disappear</h1>`,
        `<div class="rule"></div></td></tr>`,
        `<tr><td><p>The best tools stay out of the way. This week we look at three`,
        ` products that removed chrome instead of adding it, and what happened`,
        ` to their retention curves afterwards.</p>`,
        `<img src="https://designweekly.example/img/issue-214-hero.png" width="520" alt="Three before-and-after screenshots">`,
        `<table cellspacing="0"><tr><td bgcolor="#eef3fb"><b>Removed</b></td><td bgcolor="#eef3fb"><b>Effect</b></td></tr>`,
        `<tr><td>Sidebar</td><td>+8% week-two retention</td></tr>`,
        `<tr><td>Onboarding modal</td><td>No change, fewer support tickets</td></tr>`,
        `</table>`,
        `<p><a href="https://designweekly.example/214" style="color:#0b57d0">Read the full issue</a></p>`,
        `<p class="muted">Manage your subscription`,
        ` <a href="javascript:void(document.title='clicked')">here</a>.</p>`,
        `<script>document.write('scripts in mail should never run')</` + `script>`,
        `<img src="https://designweekly.example/px/open.gif?u=sample" width="1" height="1" alt="">`,
        `</td></tr></table></td></tr></table>`,
        `</body></html>`,
        `--${boundary}`,
        `Content-Type: image/png`,
        `Content-ID: <dw-logo@designweekly.example>`,
        `Content-Disposition: inline; filename="logo.png"`,
        `Content-Transfer-Encoding: base64`,
        ``,
        dot,
        `--${boundary}--`,
      ]);
    },
  },
  {
    // Three messages of one conversation, with the Message-ID and References
    // chain a real client writes -- so the sample inbox exercises the grouping
    // the list does rather than only describing it. The two replies carry the
    // quoted copy of what they answer, which is what the reader folds away.
    daysAgo: 0, hour: 10, minute: 12,
    subject: 'Re: Thursday walkthrough',
    raw: (date, to) => join([
      `From: Priya Raman <priya@northgate.example>`,
      `To: ${to}`,
      `Cc: Tom Beckett <tom@northgate.example>`,
      `Subject: Re: Thursday walkthrough`,
      `Date: ${date.toUTCString()}`,
      `Message-ID: <walkthrough-3@northgate.example>`,
      `In-Reply-To: <walkthrough-2@northgate.example>`,
      `References: <walkthrough-1@northgate.example> <walkthrough-2@northgate.example>`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      `Two o'clock is perfect. I'll bring the printed sheets so we can mark`,
      `them up as we go.`,
      ``,
      `Priya`,
      ``,
      `On Wednesday, Tom Beckett wrote:`,
      `> Thursday works. Shall we say two o'clock, in the small room?`,
      `> I'll have the storage numbers ready by then.`,
      `>`,
      `> Tom`,
    ]),
  },
  {
    daysAgo: 1, hour: 9, minute: 40,
    subject: 'Re: Thursday walkthrough',
    raw: (date, to) => join([
      `From: Tom Beckett <tom@northgate.example>`,
      `To: ${to}`,
      `Cc: Priya Raman <priya@northgate.example>`,
      `Subject: Re: Thursday walkthrough`,
      `Date: ${date.toUTCString()}`,
      `Message-ID: <walkthrough-2@northgate.example>`,
      `In-Reply-To: <walkthrough-1@northgate.example>`,
      `References: <walkthrough-1@northgate.example>`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      `Thursday works. Shall we say two o'clock, in the small room?`,
      `I'll have the storage numbers ready by then.`,
      ``,
      `Tom`,
      ``,
      `On Tuesday, Priya Raman wrote:`,
      `> Could we walk through the storage figures together before the review?`,
      `> Thursday or Friday both work for me.`,
    ]),
  },
  {
    daysAgo: 2, hour: 11, minute: 5,
    subject: 'Thursday walkthrough',
    raw: (date, to) => join([
      `From: Priya Raman <priya@northgate.example>`,
      `To: ${to}`,
      `Cc: Tom Beckett <tom@northgate.example>`,
      `Subject: Thursday walkthrough`,
      `Date: ${date.toUTCString()}`,
      `Message-ID: <walkthrough-1@northgate.example>`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      `Could we walk through the storage figures together before the review?`,
      `Thursday or Friday both work for me.`,
      ``,
      `Priya`,
    ]),
  },
  {
    daysAgo: 2, hour: 16, minute: 30,
    subject: 'Q3 usage report attached',
    raw: (date, to) => {
      const boundary = 'mixed-boundary-0002';
      const csv = [
        'week,active_users,storage_gb',
        '2026-07-06,1204,318',
        '2026-07-13,1287,331',
        '2026-07-20,1342,349',
        '2026-07-27,1398,362',
        '2026-08-03,1476,381',
        '2026-08-10,1533,402',
      ].join('\n');
      return join([
        `From: Ana Petrova <ana@meridianlabs.example>`,
        `To: ${to}`,
        `Subject: Q3 usage report attached`,
        `Date: ${date.toUTCString()}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset=utf-8`,
        ``,
        `Hi,`,
        ``,
        `Here is the usage export you asked for, one row per week since early`,
        `July. Growth is steady at around 5% week over week. Happy to walk`,
        `through it on Thursday.`,
        ``,
        `Ana`,
        `--${boundary}`,
        `Content-Type: text/csv; name="q3-usage.csv"`,
        `Content-Disposition: attachment; filename="q3-usage.csv"`,
        `Content-Transfer-Encoding: base64`,
        ``,
        b64(csv).replace(/(.{72})/g, `$1${CRLF}`),
        `--${boundary}--`,
      ]);
    },
  },
  {
    daysAgo: 2, hour: 9, minute: 5,
    subject: 'Überweisung bestätigt',
    raw: (date, to) => join([
      `From: Volksbank <service@volksbank.example>`,
      `To: ${to}`,
      `Subject: =?utf-8?B?${b64('Überweisung bestätigt')}?=`,
      `Date: ${date.toUTCString()}`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      `Guten Tag,`,
      ``,
      `Ihre Überweisung über 249,00 EUR an Stadtwerke wurde ausgeführt.`,
      `Der Betrag wird innerhalb eines Bankarbeitstages gutgeschrieben.`,
      ``,
      `Mit freundlichen Grüßen`,
      `Ihre Volksbank`,
    ]),
  },
  {
    daysAgo: 3, hour: 21, minute: 47,
    subject: 'Resolved: elevated API latency in eu-central',
    raw: (date, to) => join([
      `From: Status <alerts@statuspage.example>`,
      `To: ${to}`,
      `Subject: Resolved: elevated API latency in eu-central`,
      `Date: ${date.toUTCString()}`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      `Incident resolved after 42 minutes.`,
      ``,
      `Between 20:58 and 21:40 UTC, API requests in eu-central saw p95`,
      `latency above 900ms. A cache node was recycled and latency returned`,
      `to normal levels. No data was lost.`,
    ]),
  },
  {
    daysAgo: 4, hour: 14, minute: 18,
    subject: 'Notes from the roadmap session',
    raw: (date, to) => join([
      `From: Leo Tanaka <leo@puter.com>`,
      `To: ${to}`,
      `Cc: team@puter.com`,
      `Subject: Notes from the roadmap session`,
      `Date: ${date.toUTCString()}`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      `Thanks everyone for a focused session. Summary below.`,
      ``,
      `Decisions`,
      `1. Mail receiving ships first; sending follows once the reader is solid.`,
      `2. The reader stays text-first. HTML mail is flattened, not rendered,`,
      `   so nothing in a message can run code or phone home.`,
      `3. Attachments are downloadable but never previewed inline.`,
      ``,
      `Open questions`,
      `- Do we want per-sender notification rules in v1?`,
      `- Should the list show a preview line on small screens?`,
      ``,
      `Next check-in is Tuesday. Add comments to the doc before then if you`,
      `can. The relevant sections are short.`,
      ``,
      `Leo`,
    ]),
  },
  {
    daysAgo: 6, hour: 10, minute: 0,
    subject: '',
    raw: (date, to) => join([
      `From: noreply@parcelmotion.example`,
      `To: ${to}`,
      `Date: ${date.toUTCString()}`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      `Your parcel PM-83920114 was handed to the carrier.`,
      `Estimated delivery: two working days.`,
    ]),
  },
  {
    // Carries an image attachment -- a swatch of the blue the message is
    // about -- which is what the reader previews in place rather than
    // downloading.
    daysAgo: 21, hour: 15, minute: 32,
    subject: 'Print files, final versions',
    raw: (date, to) => {
      const boundary = 'mixed-boundary-0005';
      return join([
        `From: Marta Silva <marta@atelier.example>`,
        `To: ${to}`,
        `Subject: Print files,`,
        ` final versions`,
        `Date: ${date.toUTCString()}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset=utf-8`,
        ``,
        `The corrected files went to the printer this afternoon. Proofs should`,
        `arrive by the end of next week. I kept the darker blue we agreed on;`,
        `it holds up much better on uncoated stock. Swatch attached.`,
        `--${boundary}`,
        `Content-Type: image/png; name="swatch.png"`,
        `Content-Disposition: attachment; filename="swatch.png"`,
        `Content-Transfer-Encoding: base64`,
        ``,
        `iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAJUlEQVR42mPgDr/wn5aYYdSCUQtGLRi1YNSCUQtGLRi1YGhYAADkkO59SDf3RgAAAABJRU5ErkJggg==`,
        `--${boundary}--`,
      ]);
    },
  },
];

export const SAMPLE_ADDRESS = 'sample@puter.com';

/** Build the in-memory mailbox. `now` is injectable for tests. */
export function createSampleMailbox(now = new Date()) {
  const mailPath = '/sample/.mail';
  const objectsPath = `${mailPath}/objects`;

  // One flat map of path -> file, so the fs below can serve any folder under
  // .mail rather than only `objects/`. Archive, Trash and the moves between
  // them are then the same code path the real mailbox takes.
  const files = new Map();

  // Early in the morning today's 10:12 message would still be in the future
  // and sort after anything sent now; move the whole mailbox back a day.
  const minutes = now.getHours() * 60 + now.getMinutes();
  const early = MESSAGES.some((spec) => spec.daysAgo === 0 && spec.hour * 60 + spec.minute > minutes);

  MESSAGES.forEach((spec, i) => {
    const date = new Date(now);
    date.setDate(date.getDate() - spec.daysAgo - (early ? 1 : 0));
    date.setHours(spec.hour, spec.minute, 0, 0);
    const day = dayKey(date);
    const name = `${fakeUuid7(date, i)}--${b64url(spec.subject)}`;
    const bytes = enc.encode(spec.raw(date, SAMPLE_ADDRESS));
    const path = `${objectsPath}/${day}/${name}`;
    files.set(path, {
      name,
      path,
      is_dir: false,
      size: bytes.length,
      modified: Math.floor(date.getTime() / 1000),
      bytes,
    });
  });

  const strip = ({ bytes, ...rest }) => rest;
  const basename = (path) => path.slice(path.lastIndexOf('/') + 1);

  /** Direct children of a directory: its files, plus one entry per subfolder. */
  const children = (path) => {
    const prefix = `${path}/`;
    const found = new Map();
    for (const entry of files.values()) {
      if (!entry.path.startsWith(prefix)) continue;
      const rest = entry.path.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) found.set(entry.path, strip(entry));
      else {
        const dir = rest.slice(0, slash);
        found.set(`${path}/${dir}`, { name: dir, path: `${path}/${dir}`, is_dir: true });
      }
    }
    return [...found.values()];
  };

  const fs = {
    async readdir(path) {
      const found = children(path);
      // An absent folder and an empty one are the same thing here, and the
      // real fs throws for both -- Trash before anything has been deleted.
      if (!found.length) throw Object.assign(new Error(`No such directory: ${path}`), {
        code: 'subject_does_not_exist',
      });
      return found;
    },
    async read(path, opts = {}) {
      const entry = files.get(path);
      if (!entry) throw new Error(`No such file: ${path}`);
      const slice = opts.byte_count ? entry.bytes.slice(0, opts.byte_count) : entry.bytes;
      return new Blob([slice]);
    },
    async stat(path) {
      if (path === mailPath || children(path).length) return { path, is_dir: true };
      const entry = files.get(path);
      if (!entry) throw new Error(`No such file: ${path}`);
      return strip(entry);
    },
    async mkdir(path) {
      // A folder here exists only as the prefix of the files under it, so
      // there is nothing to make -- but the mailbox asks before it moves, the
      // way it has to against a real filesystem.
      return { path };
    },
    async write(path, data) {
      const bytes = new Uint8Array(await (data instanceof Blob ? data : new Blob([data])).arrayBuffer());
      files.set(path, {
        name: basename(path),
        path,
        is_dir: false,
        size: bytes.length,
        modified: Math.floor(Date.now() / 1000),
        bytes,
      });
      return { path };
    },
    async move(from, toDir) {
      const entry = files.get(from);
      if (!entry) throw new Error(`No such file: ${from}`);
      const path = `${toDir}/${entry.name}`;
      if (files.has(path)) throw new Error(`Already exists: ${path}`);
      files.delete(from);
      files.set(path, { ...entry, path });
      return { path };
    },
    async delete(path) {
      if (!files.delete(path)) throw new Error(`No such file: ${path}`);
    },
  };

  return { fs, mailPath, objectsPath };
}
