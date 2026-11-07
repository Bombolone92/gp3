# Native font-size command

Original XML from `tools/script_size_commands_fixture.py`, using only the
package skeleton of our original script-format-commands control. Seventeen
cases cover Latin, Hebrew, Arabic, digits, explicit cs/rtl, independent sizes,
and mixed runs with equal or unequal displayed sizes. No corpus content or
font binary is included.

`tools/record-script-size-commands.ps1` opens a disposable copy in its own
reference-application instance, selects each paragraph's text, reads the built-in Font Size combo
box (control ID 1731), sets its text to 18.5 and executes it. The recorder saves
a separate native DOCX and records source/output hashes, build, raw Size and
SizeBi properties, and the control's displayed text. It closes its own document
before hashing the saved output and removes its temporary input copy.

The native command sets both sz and szCs to 18.5 pt. Its displayed size is szCs
for cs/rtl runs and sz otherwise; mixed selections compare those displayed
values, not merely the raw sz or szCs aggregate. Equal displayed values stay
visible even when the raw properties differ. Dormant CS differences do not make
an ordinary Latin selection mixed.

These are command/UI semantics, not an OOXML divergence. The underlying sz and
szCs properties remain independent (ECMA-376 Part 1 17.3.2.38 and 17.3.2.39).
Model regressions cover every native result in both selection directions,
pending typing, empty marks, invalid input, scalar independence, inherited
properties, untouched package parts, round trips, no-op history and exact undo.
The browser regression exercises unchanged Enter, changed sizes, pending
typing, downloaded properties and reopening. Active-script imports remain
read-only while other RTL editing/font issues are unverified.

Release checks: 64 unit tests, four browser tests (including existing large-font
visual/editing and Bold/Italic regressions), 67 schema checks, and the production
build with its license check passed.
