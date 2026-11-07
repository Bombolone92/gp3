# Fractional-phase native cubic controls

`tools/svg_cubic_phase_fixture.py OUTPUT_DIRECTORY` authors this companion to
`svg-cubic-step-changes` by shifting all eight original cubic control points by
(1/16, 1/16). Every uncompressed DOCX part is identical except the authored SVG.
The generator writes deterministic packages. Original vector artwork only;
no corpus artwork or font program. Licensing follows the repository.

The exact scratch source was opened using the reference-application document helper. The reference application was then captured by `tools/capture_open_picture_metafile.ps1` using
the existing exact document moniker. The read-only capture makes no selection,
view, save, close or Quit calls. Saved state and source hash were unchanged.
`tools/record_svg_group_cubic.py` extracts eight native PNG layers from this
picture metafile. `metafile-reference.json` binds source, cases, both metafiles,
capture metadata, PNG hashes, dimensions and origins.

`tools/compare-svg-midpoint-state.mjs OUTPUT_JSON` compares all 40 native reference
RGBA layers across narrow, whole, split and phase controls. Its candidate is
routed only into a separate experimental browser context; production source
and DOCX/SVG input stay unchanged. The p6-even midpoint model matches all eight
phase layers but regresses three split layers. It is rejected for production.

The browser regression checks native dimensions/origins, input hashes, source
immutability, temporary host cleanup, editing/export/reopen and exact undo.
Known whole/phase pixel gaps are reported without requiring them to stay wrong.
