# Independent VDMX script-position controls

Original manually authored OOXML (`w:vertAlign`, ECMA-376 Part 1 §17.3.2.42),
48 rows in six authored sizes and both script directions. Each four-row group
has its own label/page so the bounded native EMF reader can validate its mapping.
No fixture is loaded by production code. No native positioning formula is claimed.

Four fonts have identical OS/2, hhea, outlines, advances and hinting. Names and
checksums differ; three add one OpenType VDMX table. Absent retains no table.
Linear bounds are ceil(.95×ppem), −ceil(.35×ppem); Tall replaces .95 with 1.35;
Deep replaces .35 with .75. These are deliberately enlarged diagnostic bounds,
not recovered font design metrics. Version 1, one default all-aspect-ratios group,
full character set, all sizes 1–255. The generator preserves other table bytes.

The renamed derivatives use the repository's Bebas Neue under SIL OFL 1.1;
see `OFL.txt`, `public/fonts/PROVENANCE.md`, and the available corresponding
[design source](https://github.com/dharmatype/Bebas-Neue/blob/686d14af640c17af3691c597778f121d840d9051/sources/BebasNeueV2.0%282018%29.glyphs).
`tools/script_vdmx_fixture.py` is the source of all changes in these binaries.
No proprietary fonts are copied or distributed.

```text
python tools/script_vdmx_fixture.py
powershell -NoProfile -File tools/capture_script_position_metafiles.ps1 -ControlRoot tests/fixtures/script-vdmx-position
python tools/record_script_vdmx.py
python tools/test_script_vdmx.py
python tools/check-docx-schema.py tests/fixtures/script-vdmx-position/controls.docx
```

Before reference-application automation, use the reference-application opening helper. Capture opens a separate read-only document, temporarily registers
these four OFL derivatives and removes registrations in finally. Extraction
verifies all selected font tables by process-private GDI reselection, without
persistent installation. This verifies current font resolution, not retrospective
font bytes from the reference application's capture process.

The reference records all input hashes, 48 native baseline positions, selected
font heights and GDI metrics. FontTools independently validates VDMX structure
in the tests. EMF frame edges and integer window extents round independently;
the new controls explicitly allow at most half a logical unit plus half a .01mm
frame unit. Existing controls retain their previous stricter bound. Paint-origin
and font-size tolerances are unchanged; invalid mapping still fails.

Tall changes superscript offsets at 8, 10, 16 and 20 pt, and Deep changes all
subscript offsets. Linear leaves all offsets equal to Absent. Captured normal
and script font heights remain equal across variants. VDMX affects native
placement, but the existing ascent/descent-gap hypothesis still does not explain
these changes. The poetry booklet remains partial.

References: [OpenType VDMX](https://learn.microsoft.com/en-us/typography/opentype/spec/vdmx),
[MS-EMF Header](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-emf/e4a35c41-e8e3-43f9-bc07-a18e99bb866d).
