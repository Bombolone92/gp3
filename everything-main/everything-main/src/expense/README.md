# Expenses

Receipt capture with AI OCR, expense reports, and reconciliation. Built with
vanilla JavaScript (no frameworks), Vite, and [Puter.js](https://developer.puter.com)
as the only backend: your data lives in your own Puter account, not on anyone's server.

## Features

- **Receipt capture with AI OCR.** Take a photo, drop a scan or PDF, or paste an
  image. The receipt is uploaded to your Puter drive and read by a vision model
  through `puter.ai.chat`: merchant, date, total, tax, currency, category, payment
  method and line items are pre-filled for you to confirm. If the vision call
  fails, `puter.ai.img2txt` plus a text extraction pass takes over. Several
  receipts at once are queued and confirmed one by one.
- **Expenses.** Searchable, filterable list grouped by day: not in a report, in a
  report, reconciled, missing receipt, by category and month. Multi-select to add
  expenses to a report. CSV export of whatever is on screen.
- **Expense reports.** Bundle expenses into a report and move it from draft to
  submitted, approved and reimbursed (with withdraw back to draft). Expenses in a
  submitted report are locked. Per-report CSV export and print view.
- **Reconciliation.** Import a card or bank statement CSV. Delimiter, header row,
  date format, and the sign convention are detected and can be corrected before
  import; duplicate lines are skipped. Lines are matched to expenses by amount,
  posting-date lag and merchant words, with a confidence score. Confirm all,
  confirm one, match by hand, or create an expense straight from an unmatched
  charge.
- **Dashboard.** This month's spend with a month-over-month delta, unreported and
  awaiting-reimbursement totals, open statement lines, spend by category, and a
  six-month trend.
- **Dark, light and system theme** (system is the default), applied before first
  paint and synced to your account.
- **Sample data and onboarding.** First run offers a guided start or a full sample
  dataset (three months of expenses, three reports, a statement with matched and
  open lines, a few generated receipt images) with a one-tap "Start fresh".
- **App-like UX.** Sidebar on desktop; bottom tab bar and a capture button on
  mobile; bottom sheets; keyboard shortcuts (`n` capture, `g` then `h/e/r/c/s`).
  Installable PWA with an app-shell service worker.
- **Accessibility.** Labelled controls, inline validation wired with
  `aria-describedby`, focus management in dialogs (`inert` on the page behind),
  skip link, status live region for toasts, and colours checked for contrast and
  colour-vision deficiency.
- **Puter desktop aware.** When `puter.env === 'app'` the sign-out option is
  hidden, because the desktop owns the session.

## Storage design (Puter)

`puter.kv` holds only small, hot values. Everything that is a file or can grow
lives in `puter.fs` under the app's data folder.

| Where | Key / path | What |
|---|---|---|
| KV | `exp:settings:v1` | base currency, theme, onboarding flags, OCR model |
| KV | `exp:categories:v1` | the category list |
| KV | `exp:months:v1` | index of month files, so loading never lists a directory |
| FS | `expenses-data/exp-YYYY-MM.json` | expenses, one file per month |
| FS | `expenses-data/reports.json` | expense reports (expenses point at them by id) |
| FS | `expenses-data/statements.json` | imported statement lines |
| FS | `expenses-data/receipts/<expenseId>.<ext>` | receipt images and PDFs |

Writes to the same file go through a per-path queue as read-modify-write
operations, so quick successive edits cannot clobber each other.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest
```

Two dev harnesses (excluded from the production build):

- **`/mock.html`** runs the full app against an in-memory mock of the Puter SDK
  (`dev/puter-mock.js`) with a fake vision model. No Puter account needed; state
  resets on reload. Add `?env=app` to simulate running inside the Puter desktop,
  `?signedout=1` to see the intro page, `?aifail=1` to exercise the OCR failure path.
- **`/dev/phone.html`** shows the mock app in phone-sized frames.

```bash
npm run build      # production build to dist/
npm run preview    # serve dist/ locally
```

## Deploying

`dist/` is fully static (built with relative paths), so it can be hosted anywhere,
including Puter's own hosting via `puter.hosting`. The app talks to Puter directly
from the browser; there is no server to run.

---

Powered by [Puter](https://developer.puter.com).

## License

This repository, including all its contents, sub-projects, modules, and components, is licensed under [MIT](../../LICENSE) unless explicitly stated otherwise. Third-party libraries included in this repository may be subject to their own licenses.
