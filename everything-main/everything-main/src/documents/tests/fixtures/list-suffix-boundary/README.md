# Numbering suffix at the body indent

Original controls authored by tools/list_suffix_boundary_fixture.py; no corpus
content. Each source has nine numbered paragraphs in Arial 10pt with exact 20pt
lines. Left/center/right labels and indents of 0, 288 and 720 twips distinguish
label alignment from default tab-grid position. The second source enables
noTabHangInd. Both use compatibility mode 15 and explicit tab suffixes.

The reference application renders the two sources identically. When the right-aligned label
ends exactly at the body indent, its suffix tab adds no advance. Left and centered
labels extend past the indent and advance to the next default stop. The implicit
boundary applies even at zero indent or with noTabHangInd enabled. This is native
boundary behavior within ECMA-376 Part 1 17.9.7 and 17.9.28; it differs from
treating the suffix as an ordinary tab, which always advances from that position.
Ordinary tab behavior is explicitly protected by unit tests.

The reference generator captures all eighteen native text origins and both full
page images. SHA-256 hashes bind source and native PDF. Browser checks compare
positions within 0.15pt, hit targets, text editing, untouched package parts,
export/reopen and exact undo. All native pages were visually inspected. Neither
these controls nor this fix certify all suffixes or numbering compatibility modes.
