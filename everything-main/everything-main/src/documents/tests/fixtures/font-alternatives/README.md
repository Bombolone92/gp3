Independent OPC/XML generator: `tools/canvas_font_alternatives_fixture.py`.
The two source DOCX files use absent primary names AltProbeMissing73/74 and
single alternative names Arial/Times New Roman. An available Arial run has a
Times New Roman alternative to check primary-name precedence. Italic table
text and a following paragraph exercise shared rendering and line metrics.
The font table is relationship-resolved at `config/fonts2.xml`.

The reference application opened each exact source and exported PDF/FlatOPC without saving.
The retained captures show Arial/Arial Italic in the first probe and Times New
Roman/Times New Roman Italic in the second; both keep the available Arial run.
`manifest.json` records source and capture hashes. `positions.json` records
PDF text origins and font names. Browser regressions check font selection,
baselines within 0.2pt, editing, export, exact undo and reopening. Installed
Arial/Times New Roman are required for those reference comparisons, not bundled.
A separate browser test checks context isolation and unavailable alternatives.

The probes use distinct short primary names: The reference application limits font-name handling
and can reuse a previously loaded font's substitution metadata within a session.
Initial exploratory long-name probes did not select the declared alternatives;
those are not used as reference evidence for these final sources. Broad
missing-font matching, long-name behavior, embedded fonts and comma-separated
alternative lists require further reference probes; these captures establish the
single-name cases, not complete font substitution equivalence.
