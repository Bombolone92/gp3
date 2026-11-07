# Horizontal table grid display phases

These original, textless OOXML controls isolate cumulative row-boundary rounding
from document fonts and artwork. `tools/table_grid_phase_fixture.py` authors
`control.docx`; run it with `--holdout` to author the separate modern-compatibility
mixed-height holdout. Each contains three floating two-column/six-row tables,
with half-point, three-quarter-point and 2.25-point single borders. Cases record
all positions, exact row heights and border sizes. No third-party document content,
font programs or reference-application binaries are redistributed.

The live reference application, DPR 1, establishes 21 horizontal opaque bands
per observation: control and holdout at 100%, and holdout at 75%. The source SHA,
case SHA, original capture SHA and cropped PNG SHA bind each reference. Native
metadata records unchanged source bytes, saved state and exact row heights.
The 75% capture changes only the view after the holdout's 100% metadata reading.

Paper origins were observed independently at visible page edges, not fitted to
the rules: (103,95) at 100%, (235,98) at 75%. Crops omit application UI and contain only
the original neutral geometry. JPEG captures are not exact alpha/coverage oracles;
measure seven opaque interior pixels (`max(R,G,B) < 128`) away from junctions.
The retained references establish horizontal band positions, not full-page native
agreement or horizontal floating-table placement across compatibility modes.

With the original full screenshots kept privately, reproduce measurements using:

```text
python tools/record_table_grid_screen.py CAPTURE control.docx cases.json control-reference.json --page-origin 103 95 --crop 135 220 876 493 --sample-x 103 415 727 --zoom 100
python tools/record_table_grid_screen.py CAPTURE holdout.docx holdout-cases.json holdout-reference.json --page-origin 103 95 --crop 135 220 876 493 --sample-x 103 415 727 --zoom 100
python tools/record_table_grid_screen.py CAPTURE holdout.docx holdout-cases.json holdout-reference-75.json --page-origin 235 98 --crop 259 188 684 370 --sample-x 77 311 545 --zoom 75
```

Use full fixture paths from the app directory. For read-only native metadata,
open a byte-identical owned copy in the reference application and run `tools/record-table-grid-native.ps1`
with `-Path` and `-Output`; it refuses unsaved or changed sources.

ECMA-376 Part 1 §§17.4.38 (`tblBorders`), 17.4.66 (`tcBorders`) and 17.4.80
(`trHeight`) define declarations, inheritance and exact row sizing. They do not
prescribe device raster rounding. Screen compatibility advances horizontal bands
from the rounded frame origin using cumulative row offsets. Minimum exposed
bottom ink respects the ending frame, including a half-pixel tie tolerance for
the engine's 1e-6-pixel coordinate representation. Source geometry and physical
print projection remain separate.

Unit and browser controls cover all 63 bands, editable import, package identity
without editing, changed-document reopening, untouched parts and exact undo.
Older frame and shading controls retain their independent native assertions;
unresolved older phase discrepancies remain explicit expected failures.
