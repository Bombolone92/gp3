# Mixed inline picture/text metrics

Original, independently generated controls from
`tools/inline_picture_run_metrics_fixture.py`. The red square is generated with
Pillow. Native reference PDFs and text baselines are captured separately;
`tools/inline_picture_run_metrics_reference.py` extracts Before/Tail/After
baselines and pins the DOCX/PDF hashes.

- `source.docx`: compatibility mode 14; twelve combinations of picture-run
  Calibri sizes 8/11/16/24pt and picture heights 4/8/16pt, with Verdana 8pt text.
- `modern.docx`: identical controls with explicit compatibility mode 15.
- `spacing.docx`: seven modern controls covering compressed/multiple, exact,
  and minimum spacing.

In mode 14, a mixed line's text metrics and the picture extent determine its
natural height. In mode 15, the picture run's complete font height also supplies
a minimum. When that minimum is larger, the reference application raises the baseline while retaining
the visible text's descent. The rule does not append the picture run's font
descender to the picture. Large pictures still determine the reservation.
Exact spacing retains its assigned height/baseline; automatic and minimum
spacing use the expanded natural line metrics.

These controls extend the existing picture-only evidence in
`tests/fixtures/inline-object-baseline`. Relevant clauses are ECMA-376 Part 1
§20.4.2.8 (inline), §17.3.1.29 (paragraph-mark properties), §17.3.1.33 (spacing),
and §17.3.1.39 (consumer-defined automatic vertical alignment). The compatibility
mode difference is native reference behavior, not a universal formula prescribed by
the standard. No source-document-specific rule is used.

Browser comparisons use installed Calibri and Verdana and check all 93 text
baselines within 0.15pt. Unit checks cover compatibility gating, large objects,
image-run formatting, preservation, exact undo and the native capture hashes.
