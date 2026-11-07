# Store listing and promotional assets

The listing is in `../STORE_LISTING.md`. The final PNGs are in `screenshots/`.

Five slides are supplied at each requested size, following the final instruction to add a whole-app opening slide and retain the four feature slides. There are 15 final images in total.

| Slide | Feature | Filename |
| --- | --- | --- |
| 01 | Whole app overview | `01-app-overview.png` |
| 02 | Stock by location and shelf minimums | `02-stock-by-location.png` |
| 03 | Demand-based reorder quantities | `03-smart-reordering.png` |
| 04 | Barcode scanning and batch take-out | `04-scan-and-take-out.png` |
| 05 | Sales and gross profit | `05-sales-and-profit.png` |

Each slide has a separate composition at **1920 × 1080**, **1024 × 768**, and **1080 × 2280**. These are marketing compositions with headlines, brand colours, framing, and real app UI. They are not raw screen captures.

Open `preview.html` for a local gallery, including a 35% view for reviewing the final exports at reduced size.

## Capture and rendering

- UI comes from the project's real views, CSS, system fonts, and Lucide icons, rendered in light mode using the existing local mock harness.
- `source/sample-data.mjs` provides fictional stock, suppliers, locations, and a dated sales history. No personal account or live inventory is used. Stock totals, sales totals, and reports are calculated by the app itself.
- Feature panels are enlarged captures of complete app elements or crops that end between controls. They are not redraws of the interface.
- The opening slide includes the full app viewport. Desktop and tablet include the desktop navigation. Mobile includes the responsive navigation. The desktop composition also enlarges the stock-value tile.
- Capture-only CSS suppresses carets and scrollbars. The floating add shortcut is hidden in the mobile overview capture because it otherwise covers a Restock label. This does not change application source or data.
- No generated photographs, external fonts, or third-party illustration assets are needed. The app's existing icon is used for branding.
- `source/compositions/` contains the exact HTML/CSS used for each export. `source/ui/` contains the underlying UI captures and capture metadata. `source/asset-manifest.json` records each final size, headline, subhead, and layout bounds.

## Reproduce

Requirements: the project's Node environment, Google Chrome, and the Playwright version in `tools/package.json`.

From the repository root:

```sh
npm install
npm install --prefix store/tools
npm run dev -- --host 127.0.0.1
```

In a second terminal:

```sh
node store/tools/generate.mjs
node store/tools/verify.mjs
```

Set `STORE_APP_URL` if the local Vite server uses a different address. To update only promotional composition, reuse the saved UI captures:

```sh
node store/tools/generate.mjs --reuse-captures
```

These files prepare the listing and assets for submission. They do not publish to a store or change the app.
