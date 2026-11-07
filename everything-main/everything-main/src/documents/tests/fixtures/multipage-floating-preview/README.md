# Multi-page floating-table preview recovery

These original paired controls extend the independently authored rich
`floating-column-preview` scaffold. The generator edits OOXML directly: one
column, 24 exact 720-twip rows per affected table, and horizontal/vertical
aligned positions. The multiple case has two affected tables. Pictures,
formatted sibling text, shading, header and footer remain in the package.

`*-matched.docx` removes floating positioning and declares zero inline indent.
It defines the disclosed preview approximation. It is not a native-fidelity
oracle for floating tables. No native artwork, corpus contents or font programs
are redistributed. Source hashes and scaffold provenance are in
[source-manifest.json](source-manifest.json).

Regenerate from the app directory with:
`python tools/multipage_floating_preview_fixture.py` (requires lxml).
The generator verifies the original scaffold hash and uses stable ZIP dates.

Unit checks verify strict rejection, bounded recovery of each affected table,
matched layout geometry, immutable imported structure and exact package export.
Browser checks compare all screen and physical print pixels at 75%/100%, retain
both pictures and healthy stories, disclose the approximation, prevent editing
and download the original bytes. Full native floating positioning remains open.
