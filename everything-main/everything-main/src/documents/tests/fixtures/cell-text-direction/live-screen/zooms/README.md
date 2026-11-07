# Fresh reference screen holdouts at 100% and 200%

These October 3, 2026 captures use an unchanged byte-for-byte copy of the
original `../control.docx`, built independently by `tools/rotated_live_fixture.py`.
The reference-opening helper confirmed its full path before the unique reference application window was
selected. `capture.json` records the actual protocol, application version, source
hash, screenshot crops and the later UI-input failure. No source text was
typed or saved. No font programs are read or distributed.

At both observed zooms, all six native glyph X bounds stay unchanged after
the one-twip indent change. Current viewer relative bounds (including widths
and heights) match these captures exactly. Absolute page origins and RGB
glyph shapes are not compared. The retained 500% reference remains separate,
and the viewer's known failure there is unchanged.

The native recorder verifies the source's independent construction, input
hashes, window dimensions and six isolated black components. Blue borders
and red proofing marks are excluded from the bounded glyph crops.

```powershell
python tools/record_rotated_screen_zooms.py
python tests/rotated_screen_zooms_test.py
npx playwright test tests/browser/cell-text-direction-screen.spec.js --workers=1
```

To reproduce the rejected origin-snapping candidate without changing production:

```powershell
node tools/investigate-rotated-screen-origin.mjs OUTPUT_DIRECTORY
python tools/compare_rotated_screen_origin.py OUTPUT_DIRECTORY
```

The candidate rounds the composed rotated-frame translation to device pixels
inside an isolated browser context. It removes the paired 500% translation
failure but retains a one-pixel last-glyph spacing error on both pages. It is
not a complete correction and was not integrated. These controls do not prove
behavior for other fonts, directions, page phases or device scales, nor editing,
printing or performance of that candidate. Do not special-case the zoom or font
to conceal the remaining failure.
