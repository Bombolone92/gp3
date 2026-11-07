# Independent physical half-grid controls

`tools/print_section_phase_fixture.py tie` authors eight textless, one-cell
tables directly in OOXML, using only the independently authored print-row-phase
package shell. Every table starts a next-page section on Letter paper. Borders
are single 8/8pt, cell margins are zero, and exact rows are 403 or 415 twips.
Origins are 4455 or 7755 twips; grids are 4320 or 8640 twips. This separates
absolute origin, half-grid parity and table width without renderer input.

Reproduce into a fresh directory with
`python tools/print_section_phase_fixture.py tie --output-folder PATH`.
The generator rejects nonempty destinations, including this captured fixture;
it never overwrites a source or leaves existing native references beside new bytes.

Captured source SHA-256:
`a6ffe3870fb86f0089b996792b2977b07a1c9ad65f06069702203eeee066fc4d`.
An exact owned copy was opened in the visible reference application. It remained saved and
byte-identical during native metafile capture and visible PDF/XPS export.

`native-metafile-rectangles.json` retains raw 600dpi rectangle destinations,
clipping and capture hashes. Each page contains twelve unclipped blue fills.
Native bottom bounds in case order are
`2032, 2032, 2038, 2038, 3407, 3407, 3413, 3413`.
Ideal whole-twip layout bounds are
`2032.5, 2032.5, 2037.5, 2037.5, 3407.5, 3407.5, 3412.5, 3412.5`.
Doubling table width leaves every blue Y/height operation unchanged. Neither
floor, nearest-away nor round-to-even explains all cases.

`native.pdf` reconstructs only native rectangle fills and their active rectangular
clips, with no text or font resources. The private native PDF is not distributed;
its hash is retained in `native-print-frames.json`. PDF point coordinates and raw
600dpi coordinates are separate observations, not interchangeable references.
The PDF bounds also remain unchanged when width doubles.

Although nearest rounding of float32 point coordinates fits these eight cases,
the separate original print-row-phase 406-twip case disproves that shortcut:
it predicts raw bottom 477 while the captured bottom is 478. Do not rewrite
source geometry, fit a bias or add a page-origin exception to match this control.

The public capture/record tools reproduce the reference from a fresh exact owned
source and native exports. Regenerating ZIP timestamps changes the package hash;
do not overwrite a captured source without recapturing the native reference. Independently
regenerated package parts and case bytes match this fixture. Browser coverage
checks editable load, no-edit save, editing, undo and reopen. Horizontal native
placement passes; vertical placement remains an explicit expected failure.
