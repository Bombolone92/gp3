# Contacts

A clean, fast, private address book that lives in your [Puter](https://puter.com) cloud. Store contacts, search instantly, and sync across every device — no servers to run, no ads, and your data stays in your own account.

**Live demo:** https://contacts.puter.com
**Source:** https://github.com/HeyPuter/contacts

Tags: `puter` `puter-app` `puter-auth` `puter-kv` `puter-ai`

## Features

- **Master–detail layout** that collapses to a single column on mobile.
- **Rich contacts** — multiple emails, phones, links and addresses, plus company, job title, birthday, notes, tags, and favorites.
- **Instant search** across every field, with A–Z sections and sort by first/last name, recently updated, or recently added.
- **Favorites & tags** for quick filtering.
- **Smart add (AI)** — paste an email signature or business card and Puter AI extracts a structured contact for you to review.
- **Right-click context menus** using Puter's native [`puter.ui.contextMenu()`](https://docs.puter.com/UI/contextMenu/) inside the Puter desktop, with a matching fallback menu on the open web.
- **Import / export** standard `.vcf` (vCard 3.0) files — interoperable with Google and Apple Contacts. **Drop a `.vcf` anywhere on the app** to import it, from your desktop or from Puter's own file manager.
- **A contacts API for other Puter apps** — an allowlisted app (today: Calendar, which may only read, and AI) can search your address book over an [`AppConnection`](https://docs.puter.com/Objects/AppConnection/), so it can suggest people instead of asking you to retype them. See [App-to-app API](#app-to-app-api).
- **An MCP server**, on that same connection — the address book as tools an AI agent can call ([Model Context Protocol](https://modelcontextprotocol.io)), so an assistant app can find, add and edit people for you. See [MCP](#mcp).
- **Calendar, both ways** — inside the Puter desktop, add a contact's birthday to your [Calendar](https://calendar.puter.com) as a yearly all-day event, and see what's coming up with whoever you're looking at. See [Calendar integration](#calendar-integration).
- **Light & dark themes** that follow your system preference and remember your choice.
- **Keyboard shortcuts** — `/` to search, `n` for a new contact, `↑`/`↓` to move through the list.
- **SEO & social** meta tags, PWA manifest, and a generated social card.

## Powered by Puter

Puter.js is the only cloud/AI backend — there is no other server.

| Capability | Puter API |
| --- | --- |
| Sign in / account | `puter.auth` |
| Contact storage (one key per contact) | `puter.kv` |
| Smart-add extraction | `puter.ai.chat` |
| Native context menus & window title | `puter.ui` |
| Files dropped from the Puter desktop | `puter.ui.onItemsOpened()` |
| App-to-app API and MCP | `puter.ui.parentApp()` + [`AppConnection`](https://docs.puter.com/Objects/AppConnection/) |
| Reading & writing the user's calendar | `puter.ui.launchApp` + the same `AppConnection` |

Contacts are stored under per-user, per-app keys (`contact:<id>`), so each user only ever sees their own data and there is nothing to provision.

## App-to-app API

Other Puter apps can use your address book through Contacts, rather than keeping
their own copy of it. The Calendar app uses this to suggest people as you type
guests into an event.

**How a caller connects.** Inside the Puter desktop, launch Contacts in service
mode and talk to the connection you get back:

```js
const contacts = await puter.ui.launchApp({
  name: 'contacts',
  args: { service: 'contacts-api' },
  background: true, // no window on screen; older desktops ignore this
})

contacts.on('message', (msg) => {
  if (msg.$ !== 'contacts-api') return
  if (msg.type === 'ready') {
    // msg.methods lists what this app is allowed to call
    contacts.postMessage({ $: 'contacts-api', v: 1, id: '1', method: 'suggest', params: { query: 'ada' } })
  }
  if (msg.id === '1' && msg.ok) console.log(msg.result.suggestions)
})
```

A service-mode instance mounts no UI, so the caller gets an API rather than
something the user has to look at. It closes itself after a few idle minutes, and
closing the connection closes it immediately. Pass `background: true` to the
launch as well: the Puter desktop creates and shows an app's window *before* the
app's own code runs, so without it a service window briefly appears on screen no
matter how early the app hides itself.

**Methods.** One reply per request, matched on `id`: `{ ok: true, result }` or
`{ ok: false, error: { code, message, details? } }`.

| Method | Params | Result |
| --- | --- | --- |
| `ping` | — | `{ app, methods, time }` |
| `list` | `{ limit?, offset?, sort? }` | `{ contacts, total, offset }` |
| `search` | `{ query, limit?, favoritesOnly?, tag?, sort? }` | `{ contacts, total }` |
| `suggest` | `{ query, limit? }` | `{ suggestions, total }` — one entry per email address, ranked (an address two people share is offered once, under whichever of them `list` returns first) |
| `get` | `{ id }` | `{ contact }` |
| `create` | `{ contact }` | `{ contact }` |
| `update` | `{ id, patch }` | `{ contact }` |
| `delete` | `{ id }` or `{ ids }` | `{ deleted: true, id }` / `{ deleted: [...], failed: [...] }` |

`list`/`search`/`suggest` return lightweight summaries (no photo, no notes);
`get`/`create`/`update` return the whole contact. Contacts also posts
`{ type: 'changed' }` whenever the address book changes, so a caller holding a
cached copy knows to re-read it — and only then. Reading is silent, however
often we re-read the book ourselves to answer you (see **Freshness**), and so is
anything the user does in a Contacts window that isn't a change to the book. A
caller can therefore treat every notice as worth acting on.

**Deleting in batches.** `delete` takes either one `id` or up to 500 `ids`, and
answers in the shape you asked in — so a caller passing `ids` always reads back
two lists and never has to test which form it got. An unknown id fails the batch
whole and deletes nothing: a caller working from a list that has gone stale gets
its mistake back intact rather than a half-applied delete whose extent it now has
to work out. Past that check the deletes run per contact, so the cloud can fail
partway through; `failed` names the ones still in the address book, and only a
batch that deleted nothing at all comes back as an error.

**Freshness.** Every request is answered from an address book that was read from
the cloud within the last few seconds; an older one is re-read first. This matters
because the process serving you is not necessarily the one the user is editing in
— a service instance can stay open for minutes while they add someone in their own
Contacts window, and nothing tells us about it, so `changed` alone would leave you
stale. A burst of requests (paging through `list`) shares one read, which also
keeps `offset` consistent across the pages of one sweep. If that re-read fails and
we already have a book, you get it rather than an error — so a caller can be
briefly stale, but is never left with nothing while the cloud is unreachable.

**Who may call it.** The API is closed by default. `ALLOWED_CALLERS` in
[`src/api/protocol.js`](src/api/protocol.js) maps an app name to the methods it
may use — today `{ calendar: READ_METHODS, ai: '*' }` — and an app with no entry
gets no listener at all. The Calendar reads the address book to suggest guests
and has never written a contact, so it cannot: an app that puts a name into a
guest field has no business renaming or deleting the person behind it, and a
grant is the cheapest place to say so. The caller's identity comes from the
`puter.source_app.name`
launch parameter, which the Puter desktop stamps onto the app window from the
*calling process*: an app cannot claim to be Calendar, and cannot set that
parameter for a window it did not launch. A caller may only ever touch the
signed-in user's own contacts, since the API runs inside their session.

Worth being plain about the limit of that: the iframe/postMessage model gives a
child window no way to cryptographically verify its parent, so these checks hold
inside a genuine Puter desktop session — the environment they are written for —
and are not a defence against a page that embeds this app itself and forges
launch parameters. The API is never served outside `puter.env === 'app'`.

## MCP

Contacts is also an [MCP](https://modelcontextprotocol.io) server, so an AI app
can use the address book with tools instead of a bespoke API it had to be taught.
It is the same connection, the same methods, and the same grant as above — only
the wire vocabulary differs, and a caller picks one simply by writing in it:
JSON-RPC 2.0 messages are answered as MCP, `$: 'contacts-api'` messages the way
they always were. There is no mode to negotiate and no second window to open, so
one app can use both.

```js
const contacts = await puter.ui.launchApp({
  name: 'contacts',
  args: { service: 'mcp' },   // 'contacts-api' works too — same server
  background: true,
})

contacts.postMessage({ jsonrpc: '2.0', id: 1, method: 'initialize',
                       params: { protocolVersion: '2025-06-18', clientInfo: { name: 'assistant', version: '1' } } })
contacts.postMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call',
                       params: { name: 'search_contacts', arguments: { query: 'ada' } } })
```

**Tools.** `search_contacts`, `list_contacts`, `suggest_recipients`,
`get_contact`, `create_contact`, `update_contact`, `delete_contact` — defined in
[`src/api/tools.js`](src/api/tools.js), each dispatching to the method table the
app-to-app API uses. A caller is offered only the tools whose method its grant
covers, so the allowlist governs both protocols at once.

Every result comes back twice: as `structuredContent` (byte-for-byte what the
app-to-app API returns) and as a compact text rendering for the model, one line
per person rather than JSON. An address book is exactly the repetitive data where
that is worth several times its own weight in context.

Failures are split deliberately. A bad *call* — unknown method, unknown tool — is
a JSON-RPC error, because the client got it wrong. A bad *request* — no such
contact, invalid email — comes back as a normal result with `isError: true`,
because the model got it wrong and is the one who can fix it; a JSON-RPC error
would be swallowed by the client's plumbing and never reach it.

**Resources.** `contact://<id>` reads one contact as a vCard 3.0. `resources/list`
is deliberately empty: a thousand contacts as a thousand resource entries is a
listing no client wants and no model can afford to read, and the template plus
`search_contacts` is the same capability far more cheaply. Changes to the address
book are announced as `notifications/resources/list_changed`.

**Seeing it work.** `npm run mcp:demo` plays a whole session — handshake, tool
calls, a vCard read, both kinds of failure — against the real server, with an
in-memory Map standing in for `puter.kv` and a fake AppConnection for the one the
desktop hands over. No Puter account, no desktop, nothing to install.

**Discovery.** [`public/.well-known/mcp.json`](public/.well-known/mcp.json)
publishes the whole tool catalogue — names, descriptions, JSON Schemas — as a
static file, so a client can learn what Contacts offers *without* launching it.
Booting a hidden app window just to ask "what can you do?" is the cost that
removes, and it is the difference between an agent listing one app's tools and
listing twenty. Regenerate it with `npm run manifest`; a test fails the build if
it drifts from the code.

## Calendar integration

The [Calendar](https://github.com/HeyPuter/calendar) app serves an API of its
own, and inside the Puter desktop Contacts uses it — the same door, in the other
direction. [`src/calendar.js`](src/calendar.js) launches Calendar in service mode
(no UI, `background: true`) and talks to the connection `puter.ui.launchApp`
returns; Calendar grants `contacts` exactly the methods used below and no others,
identifying the caller from the app name the desktop stamps on the window it
launched.

Two things use it, and deliberately only two:

**Add birthday to Calendar.** A birthday lives in an address book but needs to be
seen in a calendar. The contact menu offers it for anyone whose birthday you have
recorded, and adds an all-day event that repeats yearly, anchored on the next one
to come, with the birth year (when known) in the description — the one place a
repeating event can keep something that doesn't repeat. It is announced with a
toast and an Undo, and pressing it twice is safe: Contacts looks for the event it
would have created before creating one, so an already-added birthday says so, and
a birthday you have since corrected *moves* its existing series instead of being
joined by a second, contradictory one.

**Upcoming with this person.** The contact card shows the next few events
involving any of that contact's addresses — the reciprocal of the guest
suggestions Contacts already gives the Calendar. It is read live (no cached copy
of anyone's calendar), asked at most once per contact per couple of minutes, and
rendered only when there is something to show: no heading over an empty list, and
no error when the calendar can't be reached, because reading a contact card is
not a question that deserves one.

Nothing else the Calendar API offers is used. An address book has no business
listing someone's whole calendar or opening events by id, and the grant it holds
says so. Everything here is an enhancement: on the open web there is no desktop
to launch anything into, and the Calendar app may not be installed — in which
case the menu item is not offered and the card shows exactly what it always did.
A failed launch backs off (doubling, up to ten minutes), so a missing Calendar
costs one attempt rather than one per contact you click.

## Development

```bash
npm install        # install dev tooling (Vite, Vitest, ESLint)
npm run dev        # start the dev server (http://localhost:3000)
npm test           # run the unit + DOM smoke tests
npm run lint       # lint
npm run manifest   # regenerate public/.well-known/mcp.json from src/api/
npm run mcp:demo   # play a full MCP session against the real server, offline
npm run build      # run tests, then build to dist/
npm run preview    # preview the production build
```

Puter.js itself is loaded from the CDN (`https://js.puter.com/v2/`) in `index.html`, so there is nothing to install for the cloud features.

### Regenerating icons

`icon.png` in the repo root is the master artwork. The PNG app icons are resized from it with zero native dependencies (`public/icon.svg` and `public/favicon.svg` are its vector twin, kept in sync by hand):

```bash
node scripts/generate-icons.js
```

## Project structure

```
index.html             App shell + SEO/social meta + theme pre-paint
public/                Icons, manifest, robots.txt, social card
src/
  main.js              Bootstrap: auth gate, then mount + load
  store.js             Reactive store backed by puter.kv
  env.js               Puter runtime helpers + local prefs
  model.js             Contact shape, normalization, validation
  search.js            Filtering, sorting, grouping
  calendar.js          The Calendar app's events, over AppConnection
  birthday.js          A birthday as a calendar event (pure)
  vcard.js             vCard 3.0 import / export
  avatar.js            Initials + deterministic colors
  format.js            Escaping & formatting helpers
  contextmenu.js       puter.ui.contextMenu with DOM fallback
  icons.js, toast.js   UI primitives
  styles.css           Design system (tokens, light/dark, responsive)
  ui/                  app, list, detail, editor, smartadd, confirm
  ui/dropimport.js     Drop a .vcf on the app to import it (OS + Puter desktop)
  ui/calendar.js       The two things Contacts does with the Calendar app
  api/                 protocol.js  wire format + access control
                       methods.js   the operations, transport-free
                       server.js    serves both protocols on one AppConnection
                       tools.js     the MCP tool surface, as data
                       mcp.js       MCP (JSON-RPC 2.0) + the published manifest
  *.test.js            Vitest unit + DOM tests
```

## Testing

Tests run on [Vitest](https://vitest.dev). The pure logic (model, validation, search/sort, vCard round-trip, formatting, avatars) is covered by fast unit tests, and a happy-dom smoke test boots the whole app against a stubbed Puter SDK to catch wiring regressions.

```bash
npm test
```

## Populate a demo

After signing in and letting the address book load, run this in the browser console:

```js
await contacts.populateSampleData()
```

Available in development and production builds. Creates 18 fictional contacts with
companies, roles, notes, birthdays, favorites and tags, then opens the **Sample data**
group. Contacts are saved to your Puter account and survive reloads. Existing contacts
are preserved. Each completed call adds a fresh batch; overlapping calls share one
operation. Returns `{ created, ids, tag }`. Remove the samples through the normal
contact selection/delete controls. A failed operation rejects and reports how many
contacts were already saved; those remain available, and another call starts a fresh batch.

## License

This repository, including all its contents, sub-projects, modules, and components, is licensed under [MIT](../../LICENSE) unless explicitly stated otherwise. Third-party libraries included in this repository may be subject to their own licenses.
