# Sequential script input: native evidence

The repository-authored generator `tools/script_input_context_fixture.py`
creates 252 cases (42 action sequences in ordinary, cs and rtl contexts, each
with direct and paragraph-style-inherited properties). Supporting package
parts come from the repository's original script-input control. No proprietary
font or third-party document content is included.

`tools/record-script-input-context.ps1` uses its own hidden reference-application instance and
separate input copy, performs each case in reverse source-paragraph order, and
saves `native.docx`. Each step calls Selection.TypeText, except standalone newline
steps use Selection.TypeParagraph; batch newlines are passed as CR. The recorder
records build, method and source/output/case hashes. It does not change global
application options. This establishes COM input behavior, not keyboard/IME equivalence.

The reference application's formatting choices depend on input boundaries: separately typing an
Indic letter, digit and space retains cs on all three; inserting the same text
in one batch clears cs on the digit and trailing space. Sequential neutral
characters, tabs, combining marks, brackets and mixed-script strings are also
included. Source neighbors and exact paragraph counts/text are verified.

`node tools/audit-script-input-context.mjs` compares resolved paragraph
components without enabling unsupported source editing. At commit time it
reports 54 character-flag mismatches, with paragraph marks matching. This is a
diagnostic, not a test that requires bugs to remain. Inherited-source cases are
resolved before this component comparison; safe style-aware mutation is not
proved. The evidence tests independently bind hashes and native distinctions.

Relevant OOXML properties: ECMA-376 Part 1 §§17.3.2.7 (cs), 17.3.2.30 (rtl),
17.3.1.29 (paragraph-mark rPr). Input classification is application behavior;
these observations do not establish a standards divergence. Native rFonts hint
cs encounters the documented electronic ST_Hint schema omission, MS-OE376
§2.1.38, as in the original script-input fixtures. Keep native XML unmodified.

The subsequent context correction reduces the diagnostic to zero differences.
`tests/script-input-context.test.js` compares all 252 cases, marks and history;
the earlier 295 controls also remain passing. Style-aware source mutations and
physical keyboard/IME equivalence remain unproved; the import guard is retained.

Imported run-level RTL/CS editing is now enabled after the full source-package
checks in `tests/script-source-editing.test.js`: all 252 original style-aware
cases match the native reference before and after export/reopen, with untouched parts
preserved. Browser composition checks cover synthetic event handling, not all
physical OS input methods. Unsupported paragraph direction remains guarded.
