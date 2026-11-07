# Numbering alignment with inherited paragraph-mark spacing

These independent OOXML controls and derived native captures use the repository's
MIT license. No corpus text, artwork or font programs are included. They share
the generator and scope of `../numbering-tracking-alignment/README.md`.

Regenerate with:

```
python tools/numbering_tracking_alignment_fixture.py DESTINATION --mark-tracking
```

The 108 labels on 12 pages have the same four families, three alignments, three
tracking values and three label strings as the companion control. Numbering
level run properties omit character spacing; paragraph-mark run properties
supply it. Body runs explicitly specify zero tracking.

The reference application observed an exact helper-opened writable scratch copy. The native
capture tool did not save or change the UI; source hash and Saved state remained
unchanged. Capture arguments require 12 pages, 108 paragraphs, the exact source
hash and 612 by 792 pt geometry. Native EMFs retain descriptors, not font programs.

Verify retained captures with:

```
python tools/record_numbering_tracking_alignment.py tests/fixtures/numbering-mark-tracking-alignment/native --fixture tests/fixtures/numbering-mark-tracking-alignment --output reference.json
```

Label/body origin errors are at most 0.06 pt, under the 0.07 pt browser bound.
This does not certify glyph rasterization, script positioning or general agreement.
