# Complex fields across sections

`tools/section_fields_fixture.py` manually authors these OPC/XML packages without
corpus XML. Arial 12pt and exact 18pt paragraph spacing make the measurements
independent of any application default theme. No font or third-party engine is bundled.

`continuous.docx` nests a cached TOC in an INDEX across single/two/single-column
sections. `next-page.docx` reverses the two field types and uses next-page breaks.
The reference application renders one and three pages respectively. The field results span
both section breaks. The paragraph containing the nested field start consumes
18pt despite having no visible glyph; the other, truly empty section boundary
does not consume a line. This catches the former empty-paragraph shortcut as
well as the former import rejection.

`boundaries.docx` isolates truly empty, field-start-only, field-end-only, empty
cached-result, and invisible XE boundaries. The reference application consumes one line for all four
field-bearing cases and no line for the truly empty case. A sixth case verifies
that a numbered field-only boundary displays `1.` and advances the following
visible list item to `2.`. It renders one page. Field contents therefore matter
even when their visible result string is empty.

The three PDFs were exported by `tools/export-reference.ps1`, opening the
specified file in a private reference-application instance, verifying FullName, repaginating and
closing without saving. `tools/record_section_fields.py` binds source/PDF hashes
and 55 labeled line origins. `tools/record_section_field_edits.ps1` independently
records the reference application's in-memory XML for insertion after the second boundary, paragraph
splitting inside the result before the first boundary, and formatting inside
the two-column result. All six cases preserve three sections and nested fields.

ECMA-376 Part 1 §17.16.2 permits any number of result runs and paragraphs;
§17.16.18 defines complex field boundaries, §17.16.5.29 defines INDEX (including
its column switch), and §§17.6.18/17.6.22 define section properties/transitions.
The former section-crossing prohibition was an editor limitation, not a
requirement of the standard. The empty-section suppression exception for field
markers is measured native behavior beyond the general paragraph rules.

Unit checks compare edited XML boundary positions with the native reference, preserve
section properties and unrelated parts, and verify export/reopen and exact
undo. Browser checks compare every native line origin within 0.2pt, page counts,
list markers, typing, export/reopen, unrelated parts and exact undo. Adjacent
empty-section and continuous-section references remain regression controls.

Cached results and instructions are retained; this does not implement index/TOC
regeneration. Table-cell/control boundary restrictions and the existing atomic
guard against deleting across a section break remain in force.
