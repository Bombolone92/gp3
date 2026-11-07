Independent OOXML generator: `tools/canvas_settings_location_fixture.py`.
The source is `public/fixtures/settings-location.docx`. Its main document
references `../config/settings2.xml`; the Settings part supplies 1-inch default
tab stops and compatibility mode 15. It contains a tabbed paragraph and a
100%-width autofit table with two columns and explicit cell margins.

The reference application opened the exact source and exported PDF and FlatOPC without
saving it. `manifest.json` records SHA256 hashes of the source and captures.
`positions.json` records PDF text origins in points, with y measured from the
top of the page. The browser regression checks tab and table text x positions
against the reference application, then changes default tab spacing, edits body text, downloads,
undoes and reopens while checking package-part preservation.

This proves that Settings are found through their relationship, not through
a conventional filename. It is not a reference/spec divergence or a claim of
complete vertical layout fidelity.
