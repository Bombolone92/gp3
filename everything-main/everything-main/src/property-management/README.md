# Property Management

Free, open-source property management for landlords and property managers: properties and units, leases and tenants, rent collection, double-entry accounting, maintenance, and reports. An open-source alternative to Buildium, AppFolio, and Rent Manager.

Built with vanilla JavaScript, Vite, [Lucide](https://lucide.dev) icons, and [Puter.js](https://docs.puter.com) as the only backend. There is no framework and no server of its own.

> **Early alpha.** Features may change and data could be lost. Please do not use it for real tenant, lease or accounting records yet.

## Features

- **Dashboard** with rent collected this month, outstanding balances, occupancy, open work orders, incoming requests, expiring leases, applications, vacant units, bills due, a 12-month income and expense chart, and what is coming up this week.
- **Properties and units.** Residential and commercial property types, rental owners with ownership percentages, a property manager, bank account and reserve. Units carry beds, baths, size, market rent and a listing. Each property shows occupancy, rent, cash, financials, leases and maintenance in one place.
- **Rent roll and leases.** Fixed, fixed then month-to-month, and month-to-month leases with any number of tenants. Rent and other monthly charges post automatically on their due day, late fees follow a company-wide or per-lease policy, and prepaid rent is applied to new charges. Leases cover deposits, renewals, move-outs and eviction flags.
- **Lease ledger.** Receive payments (applied to what is owed, deposits first, rent last, editable), enter charges, issue credits, refund credit balances or deposits, apply deposits at move-out, print receipts, and view the balance by account.
- **Outstanding balances** with aging buckets and one-click payment entry.
- **Tenants and rental owners** with contacts, emergency contacts, vehicles and pets, lease history, owner statements, contributions and distributions.
- **Leasing:** listings for vacant and soon-vacant units, an applicant pipeline with screening checklists and income-to-rent ratios that converts straight to a lease, and a renewals board (not started, offer sent, renewing, moving out).
- **Accounting:** a double-entry general ledger, chart of accounts, bank accounts with registers and reconciliation, vendor bills and bill payments, expenses, transfers, journal entries, owner contributions and distributions, and budgets with budget vs actual.
- **Maintenance:** work orders with priorities, entry permissions, line items and one-click billing, vendors with insurance tracking and amounts owed, and move-in, move-out and routine inspections with condition comparisons.
- **Tasks** for resident, owner and contact requests and to-dos, with assignees, due dates and an update thread.
- **Communication:** email tenants, owners and vendors from templates, send announcements to a whole property, and keep a log of letters and calls.
- **Calendar** of move-ins, move-outs, lease ends, due dates, inspections and events.
- **Reports:** income statement, balance sheet, cash flow, trial balance, general ledger, budget vs actual, rent roll, delinquency, tenant ledger, vacancy, deposits held, unpaid bills, leases ending, renewals, applicants, work orders, vendor insurance, owner statements and more. Every report prints and exports to CSV.
- **Team sign-in.** The owner invites staff with single-use links. Everyone signs in with their own Puter account and works on the same company.
- **Throughout the app:** global search (`/` or Ctrl+K), a New menu (`N`), keyboard navigation (`G` then a letter, `?` lists them), light, dark and system themes, and layouts for desktop, tablet and phone. Files and photos can be attached to almost any record.
- **Try it without an account.** Explore a realistic sample portfolio with a year of history without signing in. Nothing is saved.

## Development

```sh
npm install
npm run dev      # http://property-management.puter.localhost:5173/
npm test         # unit and screen tests (Vitest)
npm run build    # production build in dist/
```

Open `/?demo` to start straight in the sample portfolio without the welcome screen.

### Email worker

Sending email goes through one app-owned [Puter worker](https://docs.puter.com/Workers/), because outbound mail has to be authorized by a worker's own token. The app calls it with `puter.workers.exec()`, which forwards the signed-in user's session, so each send is billed to, and rate-limited as, that user. The app owner deploys it once:

```sh
npm run deploy:email-worker   # deploys src/workers/email-worker.js as property-management-email
```

Until it is deployed, the compose dialog still offers **Open in email app** and **Copy**, and the message is kept in the communication log.

## Architecture

```
src/
  main.js            boot: sign-in, demo, welcome screen, automatic posting
  app.js             shared runtime context and memoized derived data
  platform.js        Puter auth, environment, profile picture
  files.js           attachments in the app's Puter folder
  mailer.js          calling side of the email worker
  team.js            team sign-in: worker deploy, worker backend, invitations
  core/              framework-free logic (unit tested)
    store.js           local-first store, sync engine, monthly ledger partitions
    backend.js         Puter KV and in-memory backends
    cache.js           IndexedDB snapshot cache
    accounts.js        default chart of accounts
    ledger.js          double-entry transaction builders and balances
    leases.js          lease status, recurring charges, late fees
    financials.js      income statement, balance sheet, cash flow, owner statements
    reports.js         rent roll, delinquency, vacancy and other reports
    counts.js, status.js, search.js, sample.js, backup.js, dates.js, money.js, format.js, csv.js
  ui/                app shell, router, dialogs, menus, palette, charts
  views/             one module per screen, loaded on demand
  workers/           email worker (deployed separately)
public/worker/       team worker (deployed into each owner's account by the app)
tests/               Vitest tests
```

### Accounting model

Every financial event is one balanced double-entry transaction. Amounts are integer cents, positive for debits and negative for credits, and the lines of a transaction always sum to zero (the test suite checks this for every builder and for the whole sample portfolio).

- **Lease charges** debit accounts receivable and credit an income account. Each receivable line remembers which account it is for, so balances can be shown by account and payments applied to specific charges.
- **Payments** debit a bank account and credit receivables. Anything paid beyond what is owed becomes prepaid rent (a liability) and is applied to the next charges automatically.
- **Security deposits** are charged to a deposits-held liability, so the amount owed back to each tenant is always known. Applying a deposit at move-out moves it from the liability onto the tenant's charges.
- **Bills** debit expense accounts and credit accounts payable per property. **Bill payments** are spread across the properties on the bill so every property's books balance.
- The ledger is on the accrual basis.

### Automatic posting

Each recurring charge on a lease remembers the last due date it was posted for. When the app opens (and when the day changes), it posts every charge that has come due since, then late fees for months where rent was still unpaid after the grace period. Posted charges get ids derived from the lease, the charge and the due date, so two devices or two team members posting at the same moment write the same records rather than duplicates, and a charge someone deleted on purpose is not posted again.

### Team sign-in

Puter KV and files are private to each account, so a shared company runs through a [Puter worker](https://docs.puter.com/Workers/) in the **owner's own account**. The worker source is `public/worker/property-management-team-worker.js`.

- **Turning it on:** when the owner turns on team sign-in, the app writes the worker to their drive and deploys it with `puter.workers.create`. It then copies the owner's records and files into it.
- **After that:** everyone, owner included, reads and writes through `puter.workers.exec`, which forwards each person's own session.
- **Access checks:** the worker identifies the caller from that session, never from the request body, and checks membership on every request. Managing the team requires the owner or an admin.
- **Invitations:** invite tokens are stored only as SHA-256 hashes, work once, and expire after 7 days.
- **Joining asks first:** joining sends your Puter session to that company's worker, so the app always asks before joining.
- **Key layout:** the worker uses the same KV layout as a single account, so the store and sync engine run unchanged on top of it.

### Storage design

Puter KV is backed by DynamoDB, so the layout follows DynamoDB practice: small items, writes that touch only what changed, and prefix queries instead of scans. There are no secondary indexes; everything the app filters on is derived in memory from data it already has.

| Key | Holds |
| --- | --- |
| `pm1:r:<collection>:<id>` | One record. A whole collection loads with a single prefix `list` (paged, values included). |
| `pm1:r:tx.<YYYY-MM>:<id>` | One ledger transaction, in the partition for its month. |
| `pm1:settings` | Company settings (one small item). |
| `pm1:meta` | `{ collection: version }`, bumped with an atomic `incr` after every write batch. |
| `pm1:seq` | Lease, work order and task numbers, from an atomic `incr`. |

How sync works:

- **Changed data only:** on focus, and every two minutes, a device reads `pm1:meta` (one read) and re-reads only the collections whose version moved.
- **A growing ledger stays cheap:** transactions are split into one collection per month, each with its own version. Recording today's rent payment makes other devices re-read this month only, not years of history.
- **Detecting other devices:** when a device bumps a version and gets back anything other than its own last version plus one, it knows another device wrote in between, and refreshes that collection.
- **Local first:** writes apply locally first, then go out in debounced batches with retry and backoff. An IndexedDB snapshot (including writes not yet sent) makes the app open instantly and keeps working offline.
- **Files:** attachments live in the app's Puter folder, never in KV. Records keep only a small reference.

### Performance notes

This is a forms, tables and ledger app, so the right tools are plain DOM, SVG charts and careful data structures rather than WebGL or WebAssembly:

- **Code splitting:** each screen is its own chunk, loaded on demand.
- **One pass over the ledger:** every balance (leases, bills, vendors, accounts) comes from a single pass over the transactions, memoized until the ledger changes.
- **Rendering:** long tables render in pages of 100 rows, live regions redraw at most once per animation frame, and date-based statuses are derived on the fly.
- **Icons:** Lucide icons are imported by name, so only the ones used ship.
- **Money:** all amounts are integer cents.

## Data and privacy

Each user's data lives in their own Puter account (KV and files). It is not shared with other users, and the app has no server of its own. The only exception is sending email, which passes the message through the email worker.

## Credits

Icons are from [Lucide](https://lucide.dev) (ISC license).

## License

This repository, including all its contents, sub-projects, modules, and components, is licensed under [MIT](../../LICENSE) unless explicitly stated otherwise. Third-party libraries included in this repository may be subject to their own licenses.
