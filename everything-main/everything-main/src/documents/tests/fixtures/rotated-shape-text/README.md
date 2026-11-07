# Visible text in rotated DrawingML shapes

`tools/rotated_shape_text_fixture.py` authors 24 controls across two pages using
original shape/text XML and an existing independently authored package scaffold.
No corpus artwork or third-party document engine is included. Arial text uses
an explicit physical 10 pt size and 2 pt insets.

Cases cover 0/30/45±.001/90/135/180/225/270/315/-30 degrees, local reflections,
unequal ancestor scaling, composed parent/child rotations and upright text.
`reference.pdf` was exported by the reference application.
`tools/record_rotated_shape_text.py` records colored glyph bounds at 4× native
PDF resolution, with source/PDF hashes. The browser test checks all 24 bounds
within 1 pt (observed maximum .75 pt), including upright wrapping, and verifies
no-edit package equality, body insertion, unrelated parts, exact undo and reopen.
Both complete native/browser pages were visually inspected.

Native compatibility behavior: text dimensions use the rotated physical frame,
including the established quarter-turn ancestor-axis exchange. Upright glyphs
remain horizontal; their frame retains its transformed center and swaps width
and height in [45,135) and [225,315) degrees of the combined orientation. Thus
the upright 90/225-degree cases wrap differently from the unrotated/135/315
cases. ECMA-376 Part 1 §21.1.2.1.1 defines upright glyph orientation but does
not specify this discrete frame rule. The retained controls establish the reference application's
layout behavior independently; no source-specific branch is used.

Text in reflected/collapsed groups, upright text on vertically reflected shapes,
and text on flat rotated preset lines retain their separate import guards.

### High-density raster diagnostic

`density-probe.json` records a DPR 3 diagnostic against this fixture's original
native PDF. The current shape renderer samples at fixed 2x CSS resolution, then
upscales at DPR 3. A private browser-route candidate changed only raster scale
factors to 3 (shadow scenes explicitly excluded). Both versions completed the
full editing/export/undo/reopen workflow. All 24 text regions were measured
without registration shifts: 22 have lower native RGB error, while cases 8
(180-degree text) and 21 (225-degree upright text) have higher error. Enlarged
native/baseline/candidate crops confirm reduced blur but leave pixel placement
and glyph coverage unresolved. These are diagnostic observations, not a claim
of production support or proof that a blanket scale increase is regression-free.
Source, native PDF and tested module hashes are included. Scratch evidence:
work/shape-density-*, rotated-text-density{2,3}-*, template291-density3-*.

The subsequent `density-phase-probe.json` uses the same captures and searches
integer translations from -3 to +3 native pixels solely as a diagnostic. It
records native and candidate text bounds for every case. Case 8's best 3x
comparison samples at dx=-1/dy=-1 and reduces MAE to 20.57 (best 2x: 39.02).
Case 21's best 3x comparison samples at dx=0/dy=1 and reduces MAE to 27.09
(best 2x: 31.70). At this resolution one pixel is 0.25pt. These opposite shifts
must not become per-case adjustments; they separate positional phase from
blur, and do not prove that the unregistered placement already matches the reference application.
The source script is scratch work/shape-density-phase.py. No production
rendering changed. Demand-driven density must also cover the separate shadow
compositor and preserve both per-raster and aggregate preview resource limits.
