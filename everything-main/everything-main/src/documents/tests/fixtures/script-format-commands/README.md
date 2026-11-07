# Native Bold and Italic commands

`tools/script_format_commands_fixture.py` creates original OOXML controls,
reusing only our original RTL fixture's package skeleton. The 43 paragraphs
cover Latin, Hebrew, Arabic and digits, explicit cs/rtl and no flags, all four
ordinary/complex-script toggle combinations, and seven mixed-run selections.
No corpus text or font files are included.

`tools/record-script-format-commands.ps1` opens disposable copies in its own
hidden reference-application instance. It records Font properties and ribbon pressed state,
invokes `CommandBars.ExecuteMso('Bold'/'Italic')`, records the resulting values,
and saves separate native DOCX files. The application build and SHA-256 hashes bind the
observations to both source and native outputs. The source is not overwritten.

The reference application toggles b/bCs and i/iCs independently, using each property's value on the
first selected character, including mixed selections. The ribbon's pressed
state reflects the ordinary property even in these explicit cs/rtl cases.
This is UI command behavior, not a claimed divergence from the OOXML property
definitions (ECMA-376 Part 1 17.3.2.1/.2 and 17.3.2.16/.17).

The model tests match all 86 native command observations in forward and reverse
selection order. A separate editable control verifies splitting, pending typing,
direct scalar edits, saved properties, unrelated part preservation and exact
undo. The browser test exercises toolbar, keyboard and beforeinput entry paths,
download and reopen. Active cs/rtl source imports remain read-only; these tests
do not establish complete RTL editing or font-size command behavior.

Release validation: 85 unit tests, two browser tests, 21 schema checks over
the original/native controls and browser downloads, and the production build
(including the dependency-license check) passed.
