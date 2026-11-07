# Independent shadow grid boundary controls

`tools/shadow_grid_boundary_fixture.py` independently authors sixteen textless
OOXML cases using the earlier project's original rectangle OPC scaffolding.
The source is an opaque black 32×32 PNG; no corpus artwork, font programs,
third-party renderer or downloaded asset is included. These authored test
resources use the repository license. No application layout/export code is
used to generate the source.

Widths/heights surround 144pt by ±0.18/0.36pt, with 18pt blur. Separate cases
vary aspect ratio, ±0.3pt translation and 36pt blur. Anchors are page-relative
at (72,100)pt before the declared translation; the shadow is displaced 216pt
to the right. Fractional geometry is retained in EMUs in both frame declarations.

The reference-application opening helper opens an owned scratch copy. Then
`tools/capture_shadow_grid_boundary.ps1` requires its exact hash, validates
authored extents and identities, and observes its already-open visible reference-application
document. It captures page-range metafiles without selection, document save,
implicit opening, document closing or the reference application quitting. `-IncludePdf` additionally
requests a new PDF export in the fresh capture directory. Source bytes, native
picture properties, saved state and view must remain unchanged during capture.

The reference application had marked this compatibility source dirty before the successful capture;
the trigger was not established. The successful metafile capture explicitly
records `Saved=false` before and after. It does
not falsely claim that the in-memory document was pristine. The on-disk source
remains byte-identical and is not saved. Native captures remain in scratch;
[the hash-bound record](native-metafile-grid.json) retains PNG dimensions/hashes,
recorded image draw transforms and API properties without font programs.

All 32 shadow/source PNG objects and image draw records reproduce across two
captures. At 18pt blur the 144pt square's shadow bitmap is 215×215 in the
metafile. The earlier, distinct PDF reference is 72×72. Do not compare these
dimensions as though they were the same raster path or fit one path's formula
to the other.

API widths are also distinct from emitted picture draws. For authored 143.64pt,
the API reports 143.600006pt but the source draw's span relative to the 144pt
control is 143.639999963pt. For 143.82pt, corresponding horizontal and vertical
draw spans differ (143.759999976pt and 143.879999988pt), although both API
dimensions report 143.800003pt. These are emitted device-coordinate observations,
not internal layout measurements. Neither API twip rounding nor a uniform
size-only correction explains all of them. The fixture does not establish the
generic origin/endpoint rounding rule or an exact blur kernel.

Six local guard/reproducibility tests pass. A sixteen-page browser scenario
checks no-edit preservation, insertion, unrelated parts, exact undo and editable
export/reopen; source and three exports pass forty schema views. The first
browser attempt incorrectly expected no object placeholders in the textarea;
the final check requires exactly sixteen U+FFFC drawing objects and fifteen
paragraph separators. The source generator's initial namespace serialization
failure was corrected before opening the final source in the reference application.

ECMA-376 Part 1 §20.1.8.45 specifies `outerShdw` parameters, not the reference application's raster
grid or emitted device projection. This is compatibility evidence; no OOXML
contradiction, production correction or original corpus-document completion is claimed.

`native-pdf-grid.json` adds a fresh, fully guarded sixteen-page capture with PDF
image dictionary sizes, using the repaired owned reference exporter. At 18pt blur,
widths 143.64/143.82pt produce 71×72 PDF shadow images; 144/144.18/144.36pt produce
72×72. The same capture retains the distinct 214/215-unit metafile dimensions.
These observations do not identify an internal blur kernel or certify screen
pixels.
