# Repeated-glyph advance observations

Original deterministic OPC/XML contains 24 rows: Franklin Gothic Book,
Franklin Gothic Demi and Arial, regular/bold, four Latin glyphs repeated twenty
times at 12pt with explicit zero kerning. The reference application opened a byte-identical
private copy and exported one page. The PDF remains private; only hashes and
numeric glyph-left coordinates are published. No native font bytes are copied.

The recorder measures average advance from the first to last ink-left coordinate
of each repeated glyph, divided by nineteen. Equal glyph side bearings cancel.
PDF placement quantization remains visible within the rows. These averages are
not a native line-fit oracle and must not be used to fit a production rounding
rule. Use the existing `synthetic-bold-advance` native whole-twip thresholds for
line-fitting assertions.

The two browser diagnostic runs isolate installed-font permission. With access,
the existing synthetic advance implementation adds exactly 12/2048pt per glyph
to the eight Franklin bold rows. All regular rows and Arial's genuine bold
retain their measurements. Without access the browser cannot derive the private
font face and retains its existing advances. Neither run changes the user's
browser permissions: `--authorized` applies to an isolated diagnostic context.

This recheck explains corpus #44's recorded wrapping discrepancy. The unchanged
current renderer measures the mixed-weight candidate as 460.658203125pt without
font access and 460.822265625pt with access. Its writing width is 460.8pt; the
authorized case moves the final word to the next line, matching the reference application. The earlier
native one-line threshold was 460.85pt. Both fresh full pages were compared;
heading-weight differences remain, so #44 is not complete. No runtime correction
or reference/spec divergence is claimed by this investigation.

Reproduce after native export to `<work>/text-advance-grid-native.pdf`:

```
python tools/text_advance_grid_fixture.py
python tools/record_text_advance_grid.py <work>
node tools/diagnose-text-advance-grid.mjs <work>/text-advance-grid-browser.json
node tools/diagnose-text-advance-grid.mjs <work>/text-advance-grid-browser-authorized.json --authorized
```

The source passes all three schema checks. The unit check binds native evidence,
verifies all 24 paragraphs and checks unchanged package export. The original
report separately passed a local browser edit/export/undo/reopen check with
installed-font permission. This is compatibility evidence related to ECMA-376
Part 1 §17.3.2.1 (`b`), §17.3.2.26 (`rFonts`) and §17.3.2.19 (`kern`), not an
implementation of new formatting semantics.
