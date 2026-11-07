# Manual breaks preserve floating picture wrapping

`tools/manual_break_wrapping_fixture.py` authors these OPC/XML controls with
Python's standard library. The small blue PNG is original repository artwork
from `canvas_anchor_position_fixture.py`; no original template artwork or
third-party document engine is included. Every visible run explicitly declares
Arial 12 pt, separating wrapping from unspecified-font substitution.

The body contains 13 independent pages: top-and-bottom bands before, between
and after two manually separated text runs; a picture anchored after the break;
one-sided and split-row square wrapping; consecutive and terminal breaks; a
large break-only run; explicit `clear="none"`; and a carriage return. Header
and footer controls repeat the three band placements, including body clearance.

The reference application was opened on exact owned scratch copies using the
reference-opening helper. Read-only document/page API capture verified Saved state,
source hashes, page counts and physical Letter geometry before/after reading
page EMFs. Captured EMFs contain original bitmap artwork and Unicode GDI text
with LOGFONT descriptors, not commercial font programs. No font programs were
read, copied, installed or bundled. PDFs are not needed by these references.

`native.json` binds 15 raw page captures, 76 nonblank text origins and 19 picture
frames. The gzip files preserve the exact EMF bytes. The recorder rejects GDI
viewport/world transforms and unexpected record types; the Page API's physical
612 × 792 pt geometry, logical 5100 × 6600 extent and 600-dpi metadata establish
the 0.12 pt logical unit. Image fallback emission order is unrelated to source
object order; all picture bounds are compared in spatial order. Raw coordinate
replay is independently checked in the browser test.

To recapture, open a fresh owned source copy through the reference-opening helper, then
run `tools/capture_manual_break_wrapping.ps1` with its scope, exact source path
and a fresh output directory. Arrange captures under `body-full`, `header` and
`footer`; run `tools/record_manual_break_wrapping.py CAPTURE_ROOT` to regenerate
the bound references. The capture tool leaves the reference application and other documents open.

Part 1 §§17.3.3.1, 17.3.3.4, 17.18.3, 20.4.2.17 and 20.4.2.20 govern these
features. The reference application resumes ordinary breaks in the next available text region,
including the other side of a square-wrapped picture on the same physical row.
The explicit-none and carriage-return controls prove the same behavior. This
differs from §17.18.3's description of `none` as advancing to the next line
regardless of left/right position. The renderer follows the native behavior.

Native comparisons use a 0.2 pt tolerance for 600-dpi export quantization, with
ordinary CSS access to installed Arial. Source preservation, body/story text
editing, undo and reopen are checked separately. These controls do not establish
other font/device profiles, page/column-break anchor placement or cell wrapping.
