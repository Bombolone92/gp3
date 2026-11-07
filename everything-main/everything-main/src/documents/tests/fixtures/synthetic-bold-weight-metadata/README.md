# Native synthetic-bold weight boundaries

These 42 original OOXML paragraphs compare regular and bold at 21 OS/2 weight
values. The fonts have identical outlines, shaping, metrics and selection flags.
Only the numeric weight and the unique family/full/PostScript identifiers differ.
The reference application exported five pages using the exact probe faces; the recorder
asserts every PDF face name to reject substitution. Only weights 300 and 400
receive fill-plus-stroke (`2 Tr`). Immediate neighbors 299/301 and 399/401 retain
fill-only (`0 Tr`), as do the other recorded values from 100 through 900.

The generator derives temporary fonts from the project's reviewed
`public/fonts/SourceSansPro-Regular.ttf` (SHA-256
`c6f835b6a6d942b196e2607bf73a7b086407ae8dbdc928c23a2fb4893ec383f6`).
Adobe's SIL OFL-1.1 permits modification; the derivatives use the new primary
name **Weight Probe**, avoiding the reserved name “Source”. Copyright/license
records remain in the fonts, and the generator copies the retained OFL text.
Original editable-source provenance is in `public/fonts/PROVENANCE.md`.
No derivative font binary is shipped here. The source generator and original
font reproduce all 21 hashes in `reference.json`.

Regenerate into an absolute scratch directory:

1. `python tools/synthetic_bold_weight_metadata_fixture.py SCRATCH_DIRECTORY`
2. `powershell -File tools/export-synthetic-bold-weight-metadata.ps1 -FontDirectory SCRATCH_DIRECTORY`
3. `python tools/record_synthetic_bold_weight_metadata.py SCRATCH_DIRECTORY`

The Windows helper registers only the generated `WeightProbe*.ttf` files for
the session, exports through an owned hidden reference-application instance, then removes those
registrations in `finally`. It does not install registry entries or copy fonts
to Windows directories. The source DOCX contains no embedded fonts.

The unit oracle compares the implementation to these independently recorded
native operators. Separate 384dpi browser controls in `synthetic-bold/weights`
check actual installed-font ink, including the previously overstroked Dubai
Medium and Segoe UI Semilight. Synthetic glyph advances remain independently
tested and are not disabled with the stroke. This is observed native reference compatibility;
ECMA-376 §17.3.2.1 does not prescribe a synthetic outline algorithm.
