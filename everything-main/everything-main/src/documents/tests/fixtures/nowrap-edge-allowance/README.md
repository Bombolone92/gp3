# Protected noWrap widths: isolated edge controls

**2026-09-29 correction:** The coupled eight-twip edge allowance and constrained
rounding rule now pass these native controls. The prior expected failures have
been removed without relaxing the 0.2pt geometry gate. Notes below describing
pending fixes or failed candidates are historical evidence against the parent
implementation (db793e48); they are superseded by this result. Automatic cells
with unresolved grid subdivisions remain outside the new rounding rule.


These 24 original controls isolate a mixed AutoFit table with one protected
absolute-width column and one automatic column. The automatic cell contains
an original one-pixel blue PNG displayed at exactly 40 twips wide. A merged
footer requests 6000 twips, with noWrap alternately absent and present.
The protected preferences are 240 and 2400 twips. Left/right margins are
(0,0), (1,0), (0,1), (8,0), (0,48), and (48,48) twips.

Generate with `python tools/nowrap_edge_allowance_fixture.py`. The generator
uses our independently authored, committed mixed-cell-width-content fixture
as an XML shell; it uses no corpus XML, third-party engine or font binary.
ZIP metadata is fixed. Record the reference application's read-only logical cell widths
with `powershell -File tools/record_nowrap_edge_allowance.ps1`.

`native-widths.json` binds the exact source and case manifest using SHA-256.
The reference application reports eight extra twips per zero-margin edge on the first
column, for both footer settings and both preferences. With a protected
footer, its logical total similarly includes that allowance; without it,
the second column absorbs the difference. These are logical measurements,
not an assertion about pixel-perfect painting. An optional PDF export was
stopped after these measurements had been saved; no PDF reference is claimed.

The current viewer is one twip wider in the protected column whenever an
edge has no inset. The unit and browser tests bound that known discrepancy;
the browser's exact native-width assertion remains an explicit expected
failure, reached only after preservation, editing, undo and reopening pass.

An eight-twip intrinsic allowance alone is **not a safe fix**. It matches
these 24 controls but regresses the existing mixed-cell-width-content case 7:
the second-column origin becomes 201.2 pt versus the reference application's 201.41000366210938 pt,
outside the unchanged 0.2 pt tolerance. Six other mixed-width browser tests
passed that candidate. The production change was reverted. The interaction
between protected minima and merged-column allocation remains unresolved;
these controls do not justify a special case for two-column tables.

Relevant existing conformance references are ECMA-376 Part 1 sections
17.4.29 (noWrap), 17.4.49 (tblGrid), 17.4.63 (tblW), 17.4.71 (tcW), and
17.18.87 (layout algorithm guidance). The observed eight-twip result is
reference compatibility evidence, not a constant prescribed by those clauses.
