# Store listing and promotional assets

The listing is in [`../STORE_LISTING.md`](../STORE_LISTING.md). The final PNG files are in `screenshots/`, with five assets in each requested size. The fifth asset preserves all four feature stories while adding the requested full-app overview first.

| Order | File | Story |
| --- | --- | --- |
| 01 | `01-whole-shop.png` | A complete register screen, including navigation and an active sale |
| 02 | `02-custom-orders.png` | Product options with clear, automatically updated pricing |
| 03 | `03-stock-control.png` | Stock levels, low-stock filtering, and stock counts |
| 04 | `04-customer-rewards.png` | Customer loyalty and store credit |
| 05 | `05-profit-insights.png` | Gross profit, margin, and products ranked by profit |

## Artwork

Each story has a composition for 1920 × 1080, 1024 × 768, and 1080 × 2280. The mobile overview uses the app's complete responsive register screen. The landscape overview uses its complete desktop register screen. Feature slides show complete app panels and workflows. The order editor appears with the active sale, stock tools include the catalog and delivery form, customer profiles include credit activity and purchase history, and reports include metrics, charts, and product rankings. Each size uses a layout suited to its canvas.

All UI comes from the running app in light mode, with its existing fonts, colors, spacing, and Lucide icons. The only capture styling suppresses scrollbars. The artwork uses the existing app icon and code-rendered shapes and typography. It contains no generated or reconstructed UI, third-party photography, URLs, or account data.

The café fixtures are isolated in the development mock. The capture date is fixed to September 5, 2026. The catalog includes realistic product names, costs, margins, stock levels, and SKUs. Customer profiles include contact details and an actual sample reward redemption recorded through the app. Sample transactions use the app's existing sample generator and calculations. No live Puter account is accessed. The promotional compositions are separate from the product interface.

## Regenerate

Start the development server in one terminal:

```sh
npm run dev -- --host 127.0.0.1
```

The generator requires Playwright, Sharp, and Chrome. It uses installed modules when available, or the Codex runtime's modules. To install independent tooling without changing this project's dependencies:

```sh
npm install --prefix /tmp/pos-store-tools playwright sharp
STORE_NODE_MODULES=/tmp/pos-store-tools/node_modules node store/scripts/generate-assets.mjs
```

Optional environment variables:

- `STORE_APP_URL`: the development server origin, default `http://127.0.0.1:5174`.
- `STORE_NODE_MODULES`: a directory containing compatible Playwright and Sharp installations.
- `STORE_BROWSER`: Playwright browser channel, default `chrome`.
- `STORE_CAPTURE_DIR`: reuse a previous capture directory when refining the promotional composition.

[`scripts/composition.html`](scripts/composition.html) contains the editable layouts. [`scripts/generate-assets.mjs`](scripts/generate-assets.mjs) captures the app, renders the compositions, verifies PNG dimensions, and writes [`asset-manifest.json`](asset-manifest.json). It prints the temporary location of raw captures and review contact sheets. Those review files are kept outside the final screenshot directories.

## Review

This export was checked at full size and 35% scale. All 15 PNGs have the exact requested dimensions, every promotional headline contains 3 to 7 words, and the composition bounds checks pass. The listing has a 24-character tagline, a 156-character short description, four long-description paragraphs, and eight feature bullets. `npm run build` passed.

Check all 15 exports at full size and at 35% scale after changing the layouts. Verify every UI crop is complete, numbers match the sample data, and all headlines and feature details remain readable. The complete-app overview intentionally keeps the app's native information density; the following slides show the surrounding controls, data, and activity for each workflow.

The listing describes recorded payments. Card payments are taken on an external terminal. Offline sale recording requires an initial online sign-in and app load; history, edits, and refunds need a connection. These distinctions are reflected in the listing copy.
