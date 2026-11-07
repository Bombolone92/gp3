# Rotated screen metrics controls

Original OOXML authored by `tools/rotated_screen_metrics_fixture.py`, using the
project's original `rotated_live_fixture` construction. No reference-produced source
file, corpus content, font program or third-party artwork is included.

Six pages contain six `a` glyphs separated by manual line breaks in one rotated
paragraph. Paired tables differ only by a one-twip indent: 12-point Arial with
automatic spacing, 10-point Arial with exact 237-twip spacing, and 10-point
Courier New with automatic spacing. `cases.json` records the source properties.

`capture.json` records twelve observed reference views at 200% and 500%, their crop
rectangles and provenance. Source and owned reference copy had identical hashes after
the saved control was closed. Visible authored labels identified each page;
the reference application's status-bar page count remained stale. Raw Sky JPEGs are retained without
transformation. Measurements exclude blue borders, red proofing marks, labels
and the pointer. They establish bounded black threshold placement, not exact
glyph shape, absolute paper alignment or general font fidelity.

Regenerate source in a scratch folder with the generator. Recalculate native
bounds and hashes using `python tools/record_rotated_screen_metrics.py`.
The browser suite separately checks editable six-page loading, editing, source
part preservation, export/reopen and exact undo. Native relative placement is
an explicit expected failure at both observed zooms, after provenance and
loading checks pass. No runtime behavior is changed by this diagnostic.

`tools/investigate-rotated-screen-metrics.mjs OUTPUT` isolates nearest-device
origin snapping and floor/nearest/ceiling whole-twip baseline hypotheses.
`tools/compare_rotated_screen_metrics.py OUTPUT` compares saved render bounds
against this control and the prior 10-point controls. All four hypotheses fail
the wider evidence; ceiling also regresses the prior 200% positive control.
Screen raster placement is unspecified by the cited OOXML properties; this is
an observed reference compatibility gap, not a new normative rounding rule.

`repeats/` audits two later views of page 1 at 200%; their six threshold bounds
match each other and the prior reference. A fresh 500% repeat was not obtained
because the input helper did not enter the requested percentage. The invalid
zoom edit was dismissed; the owned source was closed unchanged. This does not
establish stability for other views.

`tools/investigate-rotated-glyph-raster.mjs OUTPUT` tests device-size horizontal
glyph bitmaps rotated into the existing cell clip with fractional or nearest
baseline placement. Both hypotheses fail the wider references; fractional
placement also breaks the prior positive controls. Disconnected threshold-column
groups in Courier are recorded as isolation failures, never truncated into six
apparently matching glyphs. The default native measurement still requires six
isolated groups. No bitmap hypothesis is integrated into production.
