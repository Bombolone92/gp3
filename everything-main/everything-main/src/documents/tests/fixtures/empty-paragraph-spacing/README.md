# Empty paragraph spacing controls

Six original pages compare direct and inherited paragraph-mark sizing and
explicit single line spacing versus omitted line spacing before a nested table.
Cases 1–4 use 10pt; cases 5–6 use 10.5pt. Regenerate using
`tools/empty_paragraph_spacing_fixture.py`.

The reference application gives identical prefix and following-label geometry for all four
10pt cases. The two 10.5pt cases also agree with each other. Thus omitted spacing
and style inheritance do not independently explain the classroom pack's lower
panel discrepancy in this geometry. The viewer also produces equal geometry
within each size cohort. No renderer correction is justified by these controls.

Native EMFs are detached table-range captures from the exact helper-opened saved
source moniker, with pre/post source-hash and saved-state checks. The moniker does
not prove visible-instance identity. Coordinates are range-local; physical-frame
rounding is not a page-position oracle. Original generated sources and descriptor
captures contain no embedded font programs or corpus artwork. Native invariants
and deterministic source regeneration are tested in
`tests/empty_paragraph_controls_test.py`.
