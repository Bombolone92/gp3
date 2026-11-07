# Original drawing table/control editing reference

`tools/drawing_text_structures_fixture.py` manually authors a standalone WPS
frame containing a table, nested table and inline temporary/persistent controls.
A group contains a second table frame and an independent inline-control frame.
All words and XML are original; no corpus text, artwork, font programs or
third-party document-engine implementation are included. Frames retain fixed
extents so clipping and neighboring placement remain relevant to future edits.

The source was generated in an owned scratch directory, schema checked and
opened through the reference-opening helper. `tools/record_open_drawing_structure_edits.ps1`
checks the exact moniker, source hash, saved state, body/shape counts, group
structure and control tags. Detached range searches replace six exact strings
inside only the owned frames. No shared UI/selection setters or application-level
Open/Close/Quit are used. SaveAs writes a fresh separate `native-edited.docx`;
the original source bytes remain unchanged. Native build/state/text and control
lifetime observations are retained in `native-edits.json`.

The reference application changes ordinary/nested/grouped cell text. Filling temporary controls
removes their wrappers; filling the persistent control preserves ID 202 and
clears placeholder state. The native save also adds grouped alternate branches.
`hashes.json` binds all retained source/native bytes. Regeneration is compared
by uncompressed ZIP parts because timestamps vary; JSON bytes are preserved.

Current application tests verify retained rendering models and no-edit bytes,
ordinary surrounding body edits, unchanged drawing XML/parts and exact undo.
The browser baseline was visually inspected. These are reference/preservation
checks: application editing of drawing-local controls and tables is still
unfinished. The reference application's automation API text is not a pixel/caret/keyboard interaction oracle.
