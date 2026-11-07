# List-label recovery controls

Original OOXML packages generated with Python's standard library by
`tools/list_label_recovery_fixture.py`, using the original image-recovery
fixture builder for surrounding content. No third-party document engine is used.

- `unsupported.docx` contains an upper-Roman list starting at 4000, outside
  this viewer's supported Roman numeral range. A separate healthy decimal list
  continues from 1 to 2. Another decimal instance sharing the failing list's
  abstract definition continues at 4001, verifying retained counter progression.
- `healthy.docx` replaces only the failing abstract label format/text with
  `none` and an empty label. It is the supported rendering control.
- `header-unsupported.docx` and `header-healthy.docx` move the failing item
  and its shared-counter successor into the header, retaining healthy body lists.

All four retain supported text styles, pictures, a table and header content.
All four pass the official transitional schemas. Schema validity does not
establish rendering equivalence. The unsupported inputs remain read-only, report the
omitted label and preserve their original package bytes. Browser comparisons
check the complete rendered canvases and body line geometry against the matched
blank-label controls, plus exact original download bytes through the UI.

Relevant semantics are ECMA-376 Part 1 section 17.9 (numbering). These controls
test localized recovery, not Roman numeral support above 3999 or the reference application's rendering
of that range. Existing shared-counter behavior is unchanged. Invalid current
level definitions and other structural numbering failures can still require
broader fallback.
