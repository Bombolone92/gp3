# Connected half-point table screen controls

`tools/half_point_table_screen_fixture.py` manually authors deterministic OPC/XML:
12 floating two-by-two tables, 0.5pt single rules, exact 18pt rows, zero cell
margins, four x/y phases, automatic black, accent4 yellow, and background1 white
on blue. The theme is original XML; there are no text, images, font programs or
corpus content. The white exterior merges into the white paper, so white profiles
only cover internal rules. Native references come from the live reference application, not a PDF.

The reference-opening helper confirmed the exact owned scratch copy. Sky observed its unique
title, Saved status, and zoom at 100%/200%. Table handles and pointer halos were
cleared before capture. Visible paper edges fix origins at (439,260)/(247,116);
origins were not fitted to table artwork. The recorder checks those paper edges,
unchanged source-copy bytes and all 112 fixed source-positioned profile strips.
The captured JPEG hashes and lossless decoded crop hashes are retained in
`native-screen-reference.json`. Raw JPEGs remain in private scratch.

All 112 native strips have one-pixel thickness at both zooms. Neutral automatic
black reaches RGB 0 or 1; current viewer black is RGB 0. This contradicts a
proposal to make half-point borders semitransparent to match supersampled PDF
edges. JPEG chroma smearing changes narrow yellow/white RGB, so those samples
establish contrasting footprint, not precise colored opacity or chroma equivalence.

Positions remain unresolved: 65/112 strips differ from the viewer's current
placement. The tests retain every native position and write current positions,
but deliberately do not freeze wrong viewer positions as expected native output.

Reproduction uses existing dependencies and Vite at 0.0.0.0:5173:

```
python tools/half_point_table_screen_fixture.py <fresh-output>
python tools/record_half_point_table_screen.py <private-capture-directory>
npx vitest run tests/half-point-table-screen.test.js
npx playwright test tests/browser/half-point-table-screen.spec.js
```

The browser workflow independently recomputes native profiles from crop pixels,
checks current contrast/thickness, and verifies no-edit package preservation,
text insertion, unrelated theme/settings preservation, exact undo and edited
reopening. These are not a full native rendering or corpus completion claim.
