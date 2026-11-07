# Field Service

Free, open-source field service management for small service businesses (lawn care, cleaning, HVAC, plumbing, handyman work, and more). An open-source alternative to Jobber, Housecall Pro, and ServiceTitan.

Built with vanilla JavaScript, Vite, [Lucide](https://lucide.dev) icons, and [Puter.js](https://docs.puter.com) as the only backend. There is no framework and no server of its own.

> **Early alpha.** Features may change and data could be lost. Please do not rely on it for real business records yet.

## Features

- **Home dashboard** shows today's appointments with one-tap completion, the work pipeline (requests, quotes, jobs, invoices) with counts and amounts, revenue for the month, and everything that needs attention.
- **Clients** have multiple properties, phone numbers, and email addresses, plus tags, lead source, and internal notes. Each client page gathers the full work history, upcoming visits, billing history with a running balance, lifetime value, and files. You can import and export clients as CSV.
- **Requests** capture incoming work with preferred dates and times. You can schedule an on-site assessment, then convert the request to a quote or a job in one click.
- **Quotes** pull line items from your products and services catalog. They support optional add-ons, percentage or fixed discounts, tax, required deposits, a client message, and terms. A quote moves from draft to awaiting response to changes requested to approved, then converts into a job. Profit is estimated from unit costs.
- **Jobs** are one-off or recurring: daily, weekly on chosen days, monthly by date or by weekday, or yearly. A schedule ends after a number of visits or on a date. Jobs carry team assignment, an invoice reminder (on completion or after each visit), visit tracking, a late or requires-invoicing status, and a profitability view (line item cost, labour from timesheets, and linked expenses).
- **Schedule**
  - Views: a day view with a column per team member, plus week, month, and list views.
  - Drag a visit, assessment, task, or event to a new time, day, or person, with undo. Resize a block by dragging its bottom edge.
  - Alt + arrow keys move the focused item.
  - Unscheduled jobs sit in a side panel; drag them onto the calendar.
- **Invoices** are created from jobs, either for the whole job or per visit. Each invoice has payment terms and a due date. Status runs draft, awaiting payment, past due, paid, or bad debt, and the invoice keeps its payment history.
- **Payments** are recorded by method and reference, can be applied to invoices, and export to CSV.
- **Sending:** quotes and invoices are emailed from the app through Puter, can open in your email app, or can be printed or saved as PDF.
- **Timesheets:**
  - clock in and out per team member, optionally against a job
  - weekly hours grid with labour cost
  - manual entries with breaks
  - CSV export for payroll
- **Expenses** can carry receipt photos, link to jobs for costing, and track reimbursements.
- **Reports** cover invoiced and collected revenue by month, receivables aging, quote win rate, revenue by service, top clients, visits per team member, expenses by category, and lead sources.
- **Team sign-in.** The owner invites office staff and field crew with single-use links that expire after 7 days. Each person signs in with their own Puter account and works on the same business. Roles are admin and team member, and the owner can switch businesses or remove people at any time.
- **Files and photos** can be attached to clients, requests, quotes, and jobs. Photos are downscaled in the browser before upload.
- **Settings** cover:
  - business details and regional settings
  - your products and services catalog
  - your team, with roles, schedule colors, and labour rates
  - tax rates
  - document defaults and numbering
  - lists
  - theme
  - backup and restore as JSON, plus sample data
- **Throughout the app:**
  - global search (`/` or Ctrl+K) across clients, jobs, quotes, invoices, and requests, plus quick actions
  - keyboard shortcuts (`?` lists them)
  - light, dark, and system themes
  - layouts for desktop, tablet, and phone
- **Demo mode.** You can explore a realistic sample business without signing in. Nothing is saved.

## Development

```sh
npm install
npm run dev      # http://field-service.puter.localhost:5173/
npm test         # unit tests (Vitest)
npm run build    # production build in dist/
```

Open `/?demo` to start straight in the demo without the welcome screen.

### Email worker

Emailing quotes and invoices goes through one app-owned [Puter worker](https://docs.puter.com/Workers/), because outbound mail has to be authorized by a worker's own token. The app calls it with `puter.workers.exec()`, which forwards the signed-in user's session, so each send is billed to, and rate-limited as, that user. The app owner deploys it once:

```sh
npm run deploy:email-worker   # deploys src/workers/email-worker.js as field-service-email
```

Until it is deployed, the send dialog still works through **Open in email app**, **Copy**, and **Print or PDF**.

## Architecture

```
src/
  main.js            boot: sign-in, demo, welcome screen
  app.js             shared runtime context
  platform.js        Puter auth, environment, profile picture
  files.js           attachments in the app's Puter folder
  mailer.js          calling side of the email worker
  team.js            team sign-in: worker deploy, worker backend, invitations
  core/              framework-free logic (unit tested)
    store.js           local-first store and sync engine
    backend.js         Puter KV and in-memory backends
    cache.js           IndexedDB snapshot cache
    totals.js          line items, discounts, tax, deposits (integer cents)
    status.js          derived statuses (late, past due, requires invoicing...)
    recurrence.js      visit generation for recurring jobs
    workflow.js        request -> quote -> job -> invoice -> payment
    agenda.js          calendar items across jobs, requests and events
    reports.js         report calculations
    search.js          global search index
    csv.js, clients-io.js, sample.js, dates.js, money.js, format.js
  ui/                app shell, router, dialogs, menus, palette, charts
  views/             one module per screen, loaded on demand
  workers/           email worker (deployed separately)
public/worker/       team worker (deployed into each owner's account by the app)
tests/               Vitest unit tests
```

### Team sign-in

Puter KV and files are private to each account, so a shared business runs through a [Puter worker](https://docs.puter.com/Workers/) in the **owner's own account**. The worker source is `public/worker/field-service-team-worker.js`.

- **Turning it on:** when the owner turns on team sign-in, the app writes the worker to their drive and deploys it with `puter.workers.create`. It then copies the owner's records and files into it.
- **After that:** everyone, owner included, reads and writes through `puter.workers.exec`, which forwards each person's own session.
- **Access checks:** the worker identifies the caller from that session, never from the request body, and checks membership on every request. Managing the team requires the owner or an admin.
- **Invitations:** invite tokens are stored only as SHA-256 hashes, work once, and expire after 7 days. An invitation stops working if the person who sent it is removed.
- **Joining asks first:** joining sends your Puter session to that business's worker, so the app always asks before joining. Only accept invitations from people you know.
- **Key layout:** the worker uses the same KV layout as a single account, so the store and sync engine run unchanged on top of it (`createWorkerBackend` in `src/team.js`). The owner pays for the storage, and the data stays in their account.
- **Updates:** when the app ships a newer worker build, the owner's copy is updated the next time they open the app.

### Storage design

Puter KV is backed by DynamoDB, so the layout follows DynamoDB practice: small items, writes that touch only what changed, and prefix queries instead of scans.

| Key | Holds |
| --- | --- |
| `fs1:r:<collection>:<id>` | One record. A whole collection loads with a single prefix `list` (paged, values included). |
| `fs1:settings` | Business settings (one small item). |
| `fs1:meta` | `{ collection: version }`, bumped with an atomic `incr` after every write batch. |
| `fs1:seq` | Quote, job, invoice, and request numbers, from an atomic `incr`. |

How sync works:

- **Changed data only:** on focus, and every two minutes, a device reads `fs1:meta` (one read) and re-reads only the collections whose version moved.
- **Detecting other devices:** when a device bumps a version and gets back anything other than its own last version plus one, it knows another device wrote in between, and refreshes that collection.
- **Visits:** visits are stored inside their job, so a 16-visit recurring job is one item rather than 16.
- **Local first:** writes apply locally first, then go out in debounced batches with retry and backoff. An IndexedDB snapshot (including writes not yet sent) makes the app open instantly and keeps working offline.
- **Files:** attachments live in the app's Puter folder (`files/`, `receipts/`), never in KV. Records keep only a small reference.

### Performance notes

This is a forms, lists, and calendar app, so the right tools are plain DOM and SVG rather than WebGL or WebAssembly:

- **Code splitting:** each screen is its own chunk, loaded on demand.
- **Icons:** Lucide icons are imported by name, so only the ones used ship.
- **Rendering:** lists render in pages of 100 rows, live regions redraw at most once per animation frame, and statuses are computed on the fly.
- **Uploads:** photos are resized with `createImageBitmap` and `OffscreenCanvas` before upload.
- **Money:** all amounts are integer cents.

## Data and privacy

Each user's data lives in their own Puter account (KV and files). It is not shared with other users, and the app has no server of its own. The only exception is emailing a document, which passes the message through the email worker. That worker stores only hashed bookkeeping keys, so it holds nothing personal.

## License

This repository, including all its contents, sub-projects, modules, and components, is licensed under [MIT](../../LICENSE) unless explicitly stated otherwise. Third-party libraries included in this repository may be subject to their own licenses.
