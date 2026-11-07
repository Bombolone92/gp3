# Cap Table store assets

The listing is in [STORE_LISTING.md](../STORE_LISTING.md). Final promotional PNGs are in `screenshots/`, with exactly four files in each requested size. Use these original PNGs for store upload, not the smaller JPEG review previews.

| File | Feature | Headline |
| --- | --- | --- |
| `01-ownership.png` | Ownership by share class | Know who owns what |
| `02-fundraising.png` | Before-and-after ownership in a funding scenario | See dilution before you raise |
| `03-hiring.png` | Planned grants and option pool forecast | Plan equity for every hire |
| `04-exit.png` | Potential sale proceeds by holder | Know what an exit means |

Each filename is provided at **1920 × 1080**, **1024 × 768**, and **1080 × 2280**. The compositions are designed separately for each format. Tablet artwork uses shorter excerpts; portrait artwork gives the interface more vertical space.

## Production details

- RGB PNG exports, rendered at the exact destination size without stretching or resizing.
- Light-mode UI from the real application view functions and original styles, fonts, icons and chart elements.
- Large, uniformly magnified interface details in a promotional frame. No browser chrome, account controls, scrollbars, URLs or contact information.
- Fictional sample company and holders. Figures are computed by the app, with a fixed reference date of September 5, 2026.
- The $5 million Series A scenario uses an $18 million pre-money valuation and a 10% unallocated option pool target. The displayed dilution includes the sample SAFE and note conversions.
- The $60 million exit is a hypothetical scenario. The app computes the proceeds from the sample holdings and terms.
- The hiring plan contains eight planned hires requiring 800,000 shares against 600,000 available shares. It first exceeds the available pool in March 2027.

## Review and verification

`previews/` contains review sheets and reduced-size JPEGs. Desktop previews are shown at both 30% and 40% scale; mobile previews at 32%; tablet previews at 40%. `manifest.json` records dimensions, file sizes and SHA-256 hashes for all 12 final PNGs. `source/render-report.json` records captured copy and layout bounds.

The final package is `captable-store-assets.zip`. It contains the listing, this handoff note, the manifest and all 12 original PNGs.

## Regenerate

The renderer lives entirely under `store/source/` and does not change application code, dependencies or live data. It imports the real views and mounts selected interface elements in local preview frames. Text and values inside those interface elements are not redrawn or replaced. Small secondary elements are omitted where needed for readable store previews.

1. Start the app's existing Vite preview with `npm run dev -- --host 127.0.0.1`.
2. Run `node store/source/render.mjs` in an environment with Playwright and Chromium available. If Playwright is outside the project's dependency path, set `PLAYWRIGHT_MODULE` to its package directory. Set `ASSET_ORIGIN` if the preview uses a different origin or port.
3. Run `python3 store/source/package-assets.py` with Pillow available to verify dimensions and text constraints, rebuild review images, update the manifest and recreate the delivery ZIP.

## Claim references

The listing describes implemented functionality in `src/views/captable.js`, `src/views/rounds.js`, `src/views/exit.js`, `src/views/stakeholder.js`, `src/views/reports.js`, `src/views/classes.js`, `src/views/history.js`, `src/ui/hiringplan.js`, `src/ui/closeround.js`, `src/ui/planform.js`, `src/lib/captable.js`, `src/lib/audit.js` and `src/lib/store.js`. The equity plan claims follow `docs/INCENTIVE_PLANS.md` and the history claims follow `docs/AUDIT_HISTORY.md`. It makes no claims about user counts, ratings, certifications, guaranteed outcomes or automatic legal compliance.
