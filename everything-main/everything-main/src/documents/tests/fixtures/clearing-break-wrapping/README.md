# Text-clearing breaks beside floating pictures

`tools/clearing_break_wrapping_fixture.py` authors these seven packages with
standard-library XML/ZIP construction and original repository PNG artwork.
All visible text explicitly uses Arial 12 pt. No corpus content or third-party
document engine is included. Source code and original controls use the repository
MIT license.

The sixteen body cases combine `none`, `left`, `right` and `all` with left,
middle, right and two-sided square floats. Header and footer controls repeat the
four values beside a middle float. Four boundary controls compare `all` and
`none` in compatibility modes 15 and 12, following an exact-height blank line.

The reference application opened exact owned copies through the reference-opening helper.
Read-only page capture checked physical Letter geometry, Saved state and source
hashes before and after capture. Each `*-native.json` binds its source and raw
EMF bytes. The gzip files preserve all 31 page captures. Unicode GDI origins and
bitmap frames use the independently verified 0.12 pt logical unit; the browser
test replays raw records, rejects viewport/world transforms and compares text
origins and picture frames within the existing 0.2 pt capture tolerance.
The captures contain font descriptors, not font programs. No commercial font
program was read, copied, installed or distributed.

Part 1 §§17.3.3.1 and 17.18.3 define the interrupted-line clearance rules.
LTR `left` applies in the leftmost text region; `right` applies when a float
interrupts the region to the right; `all` restarts at full width. Ordinary
breaks retain the native next-region behavior documented in the adjacent
manual-break controls. In mode 15 the reference application moves a fitting paragraph-relative square
float and its anchor onto the next page when needed; mode 12 permits the float
to extend below the body margin. This is an observed compatibility distinction,
not a new requirement inferred from the schema.

Run `python tools/clearing_break_wrapping_fixture.py --output FRESH_DIRECTORY`
to regenerate source controls without modifying a document open in the reference application.
Capture each exact owned copy using `tools/capture_manual_break_wrapping.ps1`,
then run `tools/record_clearing_break_wrapping.py CAPTURE_DIRECTORY --scope NAME`.
The recorder binds captures to the corresponding checked-in source hash.

Browser checks cover all seven scopes, unchanged package parts, text editing,
reopen and exact undo. Inline-only controls in `clearing-break-recovery` separately
prove retained pictures, hyperlinks and formatting in body, cells and stories.
RTL paragraphs, wrapped drawings in cells, glossary-placeholder clearing breaks
and other unsupported anchor combinations retain their existing guards. Oversized
floats taller than a fresh writing area are excluded from the placement reservation.
A separate before-spacing/anchor interaction still differs from the reference application and is
recorded in the feature evidence; these controls do not establish its correctness.
