# Cell margin resets

Original controls authored directly as OPC/XML by
`tools/cell_margin_reset_fixture.py`, with no corpus document content. The
reference application exported the 22-page `native.pdf`; `tools/record_cell_margin_reset.py`
records text origins and ink bounds independently from that PDF and hashes both
inputs. Each page has one centered fixed-width table with two rows, and left-
and right-aligned Courier New labels. Its right table default is 24pt.

The cases distinguish omitted, zero, 18pt, nil, auto and percentage cell
exceptions; first-row overrides; a 15pt direct table default; a 12pt direct cell
exception; 9pt row defaults; 8pt conditional table defaults; and a derived style
that cancels its parent's 18pt cell exception. Each side of a cell exception
cascade resolves independently. A nil/auto/pct cell value cancels an earlier
cell exception and uses the applicable table/row default. An omitted side keeps
the earlier cell exception. Direct table/row defaults do not displace an
explicit numeric cell-style exception.

The reference application differs from ECMA-376's zero interpretation of nil table measurements.
The published MS-OI29500 notes for §§17.4.35 and 17.4.77 describe ignoring nil;
these controls clarify that this does not mean retaining an earlier cell-style
exception. A first-row nil right margin restores 24pt even when the global
cell-style margin is zero.

Unit tests compare all 44 resolved right margins and all 88 text x origins
against the reference application (0.15pt tolerance). Browser tests compare left/right ink edges
(0.6pt tolerance) and exercise editing, export, reopen and exact package undo.
Vertical fidelity is not certified: the first Courier New ink band is roughly
1pt above the reference application in the app. Its recorded vertical bounds retain evidence for a
separate font-baseline investigation; it does not explain the horizontal reset.

### Font-independent margin verification

The browser control now captures actual text-paint positions and compares all
left/right margin edges against the reference application within 0.15pt. For right alignment, the
independent reference edge includes the 12pt Courier advance (7.2pt per glyph),
so a substitute font cannot move the margin oracle. A separate native raster at
that reference edge verifies painted ink within the existing 0.6pt tolerance.
The original native reference ink comparison remains mandatory when Courier New is installed.
Both the declared font and a deliberately missing family exercise editing,
reopening and exact undo. This corrects a host-font-dependent test assumption;
it does not change application layout or widen a tolerance.
