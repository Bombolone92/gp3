# Field refresh phases

`tools/field_refresh_fixture.py` manually authors these three original two-page
controls. They contain no corpus content, embedded fonts or external links.
Each contains simple, complex, dirty and locked PAGEREF fields targeting a
bookmark after a page break. Their deliberately stale results are 99, 88, 77,
and 66. Only the document-level `updateFields` setting differs.

The reference application produced `reference.json`, using fresh owned
automation instances, read-only source opens and no source saves. Source hashes
were checked before and after capture. `UpdateFieldsAtPrint` was false.

| Setting | Immediately opened | After Repaginate | After explicit Fields.Update |
| --- | --- | --- | --- |
| absent | 99, 88, 1, 66 | 99, 88, 1, 66 | 2, 2, 2, 66 |
| false | 99, 88, 1, 66 | 99, 88, 1, 66 | 2, 2, 2, 66 |
| true | 1, 1, 1, 66 | 1, 1, 1, 66 | 2, 2, 2, 66 |

The reference application's early calculation yields 1 before pagination; Repaginate alone does not
refresh that cached value. Explicit update resolves the bookmark to page 2.
This is an observed lifecycle behavior, not a general instruction to hardcode
page 1. A complete implementation must resolve bookmarks and field locks,
refresh policy, nested fields and pagination dependencies generically.

ECMA-376 Part 1 (2016), 17.15.1.90, specifies automatic field recalculation when
`updateFields` is true, and no automatic recalculation from this setting when
omitted. It must respect document/write protection. PAGEREF is 17.16.5.45;
the field delimiter's dirty and lock properties are described in 17.16.18.

The viewer now resolves dirty or update-requested PAGEREF fields after layout.
Absent/false settings preserve clean caches, giving 99, 88, 2, 66; true gives
2, 2, 2, 66. Explicit F9 or “Update page references” gives 2, 2, 2, 66 for all
three controls, matching the reference application's explicit-update phase. The early native value
of 1 remains a recorded lifecycle divergence, not an expected failure or a
special case in the renderer. Raw package import still preserves original
caches exactly; display opening recalculation is saved as a document change.

The additional independently authored `switches.docx` uses updateFields=true,
PAGEREF hyperlink/relative-position switches, a Roman override and an unknown
switch. It proves healthy references update while unsupported results remain
cached and editable with an explanatory notice. It has no native reference;
its assertions come from the specification. Generate only this extra control
with `python tools/field_refresh_fixture.py --switches-only` to avoid changing
the hash-bound lifecycle sources. Browser exports preserve unrelated parts,
field instructions and locks; successful refresh clears dirty. Undo is one
step and exactly restores the package before the explicit command.

Supported refresh includes simple/complex body PAGEREF, references inside
cached TOC results, enclosing locks, section numbering, general/numeric number
formats already supported by PAGE, and the h/p switches. It does not regenerate
TOC/INDEX entries or evaluate arbitrary field codes, instruction expressions,
nested PAGEREF results, CHARFORMAT or unsupported number formats. Such caches
remain available; this is not a claim of complete field or reference equivalence.

Capture with `powershell.exe -NoProfile -ExecutionPolicy Bypass -File
tools/record-field-refresh.ps1`. Optional `-IncludePdf` adds the printing phase.
PDF export stalled in this session and was terminated only in the owned
capture process. No PDF or printing-phase result is claimed. The reference
application opening UI was also inspected for the absent-setting case. This is a field
lifecycle reference, not a complete visual rendering comparison.
