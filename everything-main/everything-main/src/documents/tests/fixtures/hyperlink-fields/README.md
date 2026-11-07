# Cached HYPERLINK field controls

Original OPC/XML from `tools/hyperlink_fields_fixture.py`, using the project's
original scaffold, explicit Arial 12pt, and locked results. No corpus artwork or
font files are copied. Seven HYPERLINK fields cover simple/complex syntax,
internal/external targets, ScreenTips, target frames, empty results, and a
two-paragraph result with nested PAGEREF.

The reference application exports two pages. Both full-size page pairs were inspected;
all eleven measured lines match, max X/Y difference 0.0241/0.0536pt, no unmatched
lines. `record_hyperlink_fields.py` records source/PDF hashes and origins.
`record_hyperlink_fields.ps1` records all seven native destinations, display
ranges, ScreenTips and frames; tests compare them directly with the model.

Producer extension: a split TOC hyperlink generates `HYPERLINK \l "Topic1" \h`
in `../toc-pageref/native-edits.json`. ECMA-376 Part 1 §17.16.5.25 lists `\l`,
`\m`, `\n`, `\o`, `\t`, but not `\h`. This manual control includes internal
fields with and without that flag. The reference application reports the same target for both. The
editor preserves the emitted flag without inventing an additional meaning.

Result edits retain envelopes without duplicate hyperlink wrappers/relationships.
Explicit link removal/retargeting converts the affected HYPERLINK field to
paragraph-local `w:hyperlink` markup, allowing a partial link edit while retaining
other targets and nested PAGEREF fields. Bookmark renames update instructions,
including arguments split over instruction runs. Browser coverage includes
navigation, stubbed external opening, partial removal, empty refill and reopening.
Undo restores the original ZIP parts exactly.

Relative/file destinations, mixed external-address/bookmark targets, image-map
switches and field refresh remain outstanding; unsupported forms stay guarded.
