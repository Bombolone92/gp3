# Thin-outline display resolution

`tools/shape_display_resolution_fixture.py` authors four 144pt by 72pt
transparent rectangles with black 0.5pt outlines, rotated 0, 3, 15 and 45
degrees. It writes original OPC/XML with deterministic ZIP metadata and uses
no corpus content. The reference application exported the exact source read-only using
`tools/export-reference.ps1`.

`tools/record_shape_display_resolution.py` binds source/PDF hashes and records
three horizontal profiles through the unrotated left outline at 384 dpi.
Native ink levels are `[0,0,0,86,255,255,85,0,0,0,0]`; the former fixed-2x app gave
`[0,0,42,128,170,170,127,42,0,0,0]`. Stroke coverage is similar, but the fixed
2x scene bitmap is enlarged at device scale 4, spreading ink and lowering
peak contrast. This isolates a display-resolution defect independently of
corpus document 114, whose tilted thin outline exhibits the same blur.

The corrected renderer passes the native profiles (two levels of edge
antialiasing tolerance), with the expected-failure marker removed. Editing, no-edit package
retention, unrelated parts, exact undo and editable reopening are separate
passing checks. The rotated rectangles remain visual controls; the recorded
numeric profiles do not claim full rotated-edge fidelity.

Drawing surfaces now follow display scale and zoom, retaining the 2x baseline
at ordinary resolutions. Physical pens, line ends, compound outlines, pattern
placement, text and shadow surfaces use that same resolution. A scene retains
one current bitmap and closes replaced surfaces; repeated paints reuse it.
Per-surface 8192px/16MP and aggregate 64MP limits remain. If an optional higher
resolution exceeds the session budget, the baseline rendering remains usable.
The zoom/resource regression verifies reuse, replacement, release and fallback.
Another regression samples all 54 native pattern presets at device scale 4,
checking physical cell size and page phase. Original drawing geometry and
DOCX bytes remain unchanged. Separate 3D-picture preview resolution is unchanged.
Relevant clauses: ECMA-376 Part 1 20.1.9.6 (`ln`) and 20.1.7.6 (`xfrm`).
Display sampling is an implementation requirement, not a reference/spec divergence.

## Screen and PDF distinction (2026-09-30)

The independent control was also opened unchanged in the reference application at 400% on the
96-dpi desktop. Its unrotated half-point line occupies three solid screen
pixels, unlike the fractional coverage in the PDF above. The screen left
margin is x=24; the 192-pixel half-inch margin places the page origin at -168.
`native-screen-400-strip.png` retains a neutral 11-by-30 JPEG-derived strip at
screen x=211 (page x=379). `native-screen-reference.json` binds its source,
capture and crop hashes. `tools/record_shape_display_screen.py` checks the
exact opened package and records the footprint using the fixed threshold 128.
This establishes opaque edge placement, not an opacity correction or full
rotated-screen equivalence. The native screenshot stays in the private work folder.

The viewer check now uses that screen footprint at equivalent device scale 4.
A separate physical-raster check retains all three original PDF profiles and
their original two-level tolerance. No PDF reference or tolerance was changed.
The first placed bitmap now replaces a measurement-only reservation, so the
resource lifecycle test includes that initial resize callback. It still checks
repeated-paint reuse, old-bitmap disposal, zoom and budget fallback.
