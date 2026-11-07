# Calibri capitals and character spacing

The source is independently authored XML/OPC by
`tools/calibri_tracking_fixture.py --output-folder FRESH_FOLDER`. The generator
refuses an existing output folder. The four 36pt bold Calibri paragraphs cross
literal uppercase versus mixed-case text with `w:caps`, and zero versus 1pt
`w:spacing`. All request `w:kern=28` (14pt), compatibility mode 15 and enabled
OpenType features. There are no embedded fonts or application exports.

`native-page-advances.json` contains guarded read-only observations of the exact
source in the reference application. Source bytes, Saved, view and zoom were
unchanged. Unicode text identities, font descriptors and integer advances are
retained; font programs, outlines and other metafile record contents are absent.
The page window is 5100 by 6600 units for a 612 by 792pt page (0.12pt/unit).
These are page-metafile observations, not PDF positions or raster equivalence.

The uppercase/caps pairs have identical native advances both with and without
tracking. Current viewer paint also gives equal pair positions, with exact
isolated RGBA reconstruction in all four paint calls. Against native page
origins, maximum horizontal differences are 0.162422pt without tracking and
0.129282pt with tracking. This rules out a caps-specific spacing correction for
this control; it does not establish general font or document fidelity.

ECMA-376 Part 1 `w:caps` and `w:kern` support (17.3.2.5 and 17.3.2.19) remains
unchanged. This evidence does not claim a reference/specification divergence.
