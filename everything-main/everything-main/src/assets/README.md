# AssetDesk: Asset & Equipment Manager

Track laptops, tools, warranties, assignments, maintenance, and return dates in one place.

Built with vanilla JavaScript (no UI framework), [Vite](https://vitejs.dev), [Lucide](https://lucide.dev) icons, and [Puter.js](https://docs.puter.com) as the only backend. Asset records live in the signed-in user's Puter key-value store and attachment files in their Puter cloud storage, so there is no server to run.

## Features

- **Overview dashboard** with stat tiles (including book value), upcoming returns, warranty watch, reservations starting soon, service due, category breakdown, inventory value by category, and recent activity.
- **Asset inventory** with search (name, serial, model, location, assignee, tags, custom fields), category/status/location/tag filters, sorting, and a responsive table that collapses to cards on mobile.
- **Bulk actions**: select multiple assets (or everything in the current filter) and assign, tag, re-categorize, retire, export, print labels, or delete them in one pass — partial failures and skipped assets are reported honestly.
- **Custom categories, tags & fields**: manage your own category list, label assets with free-form tags via a chip input, and define custom fields (text, number, or date; optionally scoped to categories) that join the form, detail view, search, and CSV round-trips.
- **Managed locations**: location autocomplete, a Locations view showing what is in each place, and one-step renames that fix typo fragmentation across every asset.
- **Backups that are actually restores**: a complete backup — records, supplies, settings, and the attachment bytes — written into your own Puter storage automatically on the first open of each day, keeping the last few. Restore from the picker in Settings or from a file you kept elsewhere; nothing already there is overwritten, and the export menu says plainly which download carries the files and which does not.
- **Import & export**: bring an existing spreadsheet in via a CSV wizard (auto-mapped columns, per-row validation, categories and custom fields created on the fly, assignments and retired status honored) and get data out as CSV (all or the filtered view) or a restorable JSON backup.
- **Bulk editing through the spreadsheet**: an import can update the assets it matches — on the AssetDesk id the export writes, or on the serial — so exporting, fixing 200 locations in a spreadsheet, and re-importing is a round trip instead of a duplicate inventory. One choice for the whole file (update, leave alone, or add a second record), a preview of every field change before it runs, blank cells left as they are, and lifecycle state never touched.
- **Duplicate detection**: the add/edit form warns when a serial number already belongs to another asset (and names it), a batch add refuses to give two units the same serial, the import wizard counts the rows that match assets you already have and skips them by default, and a "Possible duplicates" report groups whatever has already drifted in.
- **Reminders that reach you**: add any return date, warranty expiry, service date, or reservation to your calendar (.ics, per asset or all upcoming at once), opt into browser notifications for deadlines that newly become urgent, and see the needs-attention count on the installed app's icon badge.
- **Attachments**: keep photos, receipts, and warranty documents with each asset (stored in your Puter cloud storage) — image thumbnails, in-app preview, download, and per-file delete.
- **QR labels & stocktake**: every asset has a scannable label (print one, print a sheet, or download the SVG); scanning opens the asset via a shareable deep link, and stocktake mode verifies physical inventory against the app — scan codes with the in-app camera or tick assets off, then export whatever is unaccounted for.
- **Scan from anywhere**: a scan button in the top bar opens the camera and jumps straight to the matching asset — the fastest lookup there is, and the natural start of a check-out or return. It reads the barcodes already on the equipment (Code 128, Code 39, EAN, UPC) as well as AssetDesk's own QR labels, looks an unknown code up as a serial or asset tag, offers to add an asset with it when nothing matches, and scans straight into the serial field on the add form.
- **Assignments**: check assets out to people with optional return dates; overdue and due-soon returns are flagged; one-click return (with optional printed return receipt), in-place editing, one-step transfers, and duplicate/batch-add for identical units.
- **Condition at check-out and return**: a three-value scale (good / fair / damaged) with a note and photos, recorded at the moments an item changes hands — the assignment keeps the condition it went out in, so a handover form printed later still describes what was signed for, and damage found at check-in offers to start maintenance straight away, pre-filled.
- **Reservations**: promise equipment to someone ahead of time with conflict warnings; on the day, one click converts the reservation into an assignment.
- **Sets**: link the dock, charger, or lens that travels with an asset, and it is issued, transferred, and returned with it — each accessory still its own tracked, serialled, depreciable record. One handover form per set, honest partial results ("with 1 of 2 accessories · USB-C hub is available"), and a flag when an accessory is somewhere other than the rest of its set.
- **Supplies**: consumables tracked by quantity rather than one record each — cables, batteries, toner, safety glasses. Name, category, location, count, and the level at which you want to hear about it; take-out and restock movements logged with who and when; low stock joins the dashboard, the nav badges, notifications, and the app icon badge; CSV in and out, matched on name and location so a re-import corrects counts instead of doubling them. Kept out of asset counts, book value, and stocktake entirely.
- **People**: everything in someone's hands grouped by holder — an instant check-in or offboarding checklist — with assignee autocomplete and printable handover forms with signature lines.
- **Maintenance**: start and complete repair records with notes and cost, plus preventive service schedules (fixed date or repeating interval) with service-due reminders everywhere deadlines live.
- **Cost reporting**: a Reports view that adds up what the app already records — spend over time (acquisitions and maintenance, by month, quarter, or year, broken down by category and location), a printable inventory valuation as at any date, total cost of ownership per asset (purchase price plus every repair, also sortable in the inventory), and replacement candidates chosen on real evidence rather than depreciation alone.
- **Depreciation**: straight-line book value from purchase price, purchase date, and useful life (per-category defaults, per-asset overrides), with replacement-candidate hints for fully depreciated assets.
- **Full lifecycle**: available, assigned, maintenance, retired, reactivated, with an audit history per asset — and a 30-day trash with undo instead of permanent deletion.
- **Settings**: one screen for the display currency (defaulting to the browser's region, not to dollars), the lead times that decide how far ahead a warranty, return, service date, or reservation counts as needing attention, notifications, appearance, and the category and custom-field dialogs.
- **Works offline**: a service worker caches the app shell (and the Puter client), so the installed app opens with no signal — which is where a stocktake in a stockroom, a van, or a basement actually happens. Records are mirrored locally: reads fall back to the mirror with an "offline, showing data from …" banner, writes land locally and queue, and the queue is sent as soon as there is a connection again (last write wins, per record). Attachments stay online-only and say so, and a new version of the app is offered rather than forced.
- **Theming**: system, light, and dark modes, defaulting to system, persisted per device.
- **Guided first run**: an intro page before sign-in, then a one-decision onboarding modal on an empty inventory (add an asset, explore with sample data, or skip).
- **Sample data**: one click installs a realistic inventory; a persistent banner marks sample mode and "Start fresh" wipes it and reopens onboarding.
- **Demo mode**: append `?demo=1` to run against an in-memory store, no account needed (dev convenience).

## Development

```sh
npm install
npm run dev        # local dev server
npm test           # run the vitest suite
npm run build      # production build to dist/
npm run preview    # preview the production build
```

## Deployment

The `dist/` output is fully static (built with relative paths), so it can be hosted anywhere, including Puter hosting. Puter.js handles authentication: visitors sign in with their Puter account and each user sees only their own inventory.

Offline copies and queued edits are isolated by Puter account ID. After upgrading from a version with a shared offline cache, connect once to confirm the account. If older unsynced edits exist, the app asks which signed-in account should recover them; choosing “Keep for later” preserves them on the device. Subsequent offline opens recognize the same authentication session without another network lookup succeeding.

## Architecture

```
src/
  main.js            entry: theme, intro/auth gate, data load, routing, onboarding
  state.js           central state + pub/sub
  actions.js         bridges the pure model to persistence + toasts
  lib/
    model.js         asset shape, validation, lifecycle transitions (pure)
    query.js         filter / sort / stats / activity (pure)
    dates.js         calendar math with injectable "now" (pure)
    depreciation.js  straight-line book value (pure)
    duplicates.js    duplicate-serial and look-alike detection (pure)
    accessories.js   sets: parent/accessory links and their derivations (pure)
    consumables.js   supplies tracked by quantity: stock math and movements (pure)
    backup.js        complete backup archives: build, read, prune (pure)
    mirror.js        local mirror of the cloud store (IndexedDB or memory)
    account-storage.js account ownership and recovery of older offline edits
    offline.js       offline-aware backend: mirror reads, queued writes, sync
    zip.js           minimal zip writer/reader, no dependency (pure)
    reports.js       cost aggregation: spend, valuation, cost of ownership (pure)
    format.js        display formatting (pure)
    store.js         persistence over Puter KV; in-memory backend for demo/tests
    theme.js         system/light/dark controller with injectable deps
    router.js        hash router
    sample.js        sample inventory built through real lifecycle functions
  sw.js              service worker template; the build injects its precache list
  ui/                DOM builder, icons, toasts, modals, drawer, views
tests/               vitest suites for every lib module
```

All domain logic is pure and dependency-injected (time, storage, backend), which is what the test suite covers; the UI layer stays thin.

## License

This repository, including all its contents, sub-projects, modules, and components, is licensed under [MIT](../../LICENSE) unless explicitly stated otherwise. Third-party libraries included in this repository may be subject to their own licenses.
