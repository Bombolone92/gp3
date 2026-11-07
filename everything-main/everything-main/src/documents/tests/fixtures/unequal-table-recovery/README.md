# Unequal-column table recovery

`tools/unequal_table_recovery_fixture.py` derives six controls from the independently authored image-recovery OPC package. Each retains two pictures, a styled heading, numbering, a header and a fixed-width table. The table starts in the first column, starts after an explicit column break, or has 90 rows that continue across columns/pages.

Each pair differs only in the second column width (2500 versus 4860 twips). Both retain the first column width of 2500 twips and a 720-twip gap. Short cell text and a fixed 1800-twip table allow the supported equal-width control to provide an exact unaffected-pixel/geometry reference. These controls test recovery, not native reference layout equivalence or complete percentage/AutoFit table support.

Strict layout still rejects tables in genuinely unequal columns. Read-only layout measures the table using the first column's available width throughout its continuations; ordinary paragraphs retain variable-width column layout. The banner identifies the affected section/table and approximation. The source model and original package stay intact, serialization remains blocked and downloading returns the original bytes.

Unit checks compare all cell/line geometry, preserve authored columns and package parts, and ensure unrelated measurement failures propagate. The browser check compares every canvas against its supported control, verifies retained images/tables and the banner, and downloads the original file. All six controls are schema-valid.
