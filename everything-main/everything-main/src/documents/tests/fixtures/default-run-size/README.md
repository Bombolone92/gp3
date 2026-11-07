# Imported default font size — independent reference control

`tools/default_run_size_fixture.py` manually authors the DOCX package. It has
three Arial paragraphs: no size anywhere in the hierarchy, explicit 10 pt, and
explicit 12 pt. The reference application on this Windows host opened the exact file and
exported `native.pdf` without saving the DOCX. PDF text sizes are respectively
9.96, 9.96, and 12 pt (the native reference PDF quantization of the first two 10 pt runs).

Source SHA-256: F7643E87E1557F4E665F6DB58669FD3CF9B8D0E19E866D13ACF7DF04286C84D7

PDF SHA-256: 16DA6C01E4FFA09BC974B2F2EDB07DD8976E9327A50A9E5B61EA1BFAB2B433DE

ECMA-376 Part 1 §17.3.2.38 leaves a completely unspecified size to the consumer.
This is a reference-compatible consumer default, not a divergence from the standard.
The browser regression checks the selected canvas sizes and editing/export/undo;
it does not claim identical text antialiasing between Canvas and PDF.
