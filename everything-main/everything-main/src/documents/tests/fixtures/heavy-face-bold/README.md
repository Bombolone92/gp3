# Bold applied to installed heavy faces

`tools/heavy_face_bold_fixture.py` independently authors 72 samples: six families,
three sizes (12, 24 and 85pt), and regular/bold/italic/bold-italic combinations.
No corpus markup or artwork is copied. `control.docx` passes all ten applicable
standard/extension XML checks. The reference application exported `native.pdf`; the seven-page
overview was inspected. The last Arial Black sample flows onto page five.

`tools/record_heavy_face_bold.py` records the PDF text rendering mode, stroke
width, font and size for each sample, with source/case/PDF hashes. These are
native observations, not renderer-derived expectations:

- Franklin Gothic Demi, Book and Medium: bold and bold-italic use fill plus
  stroke (mode 2). Stroke widths are 0.34286, 0.68571 and 2.4281pt, approximately
  native font size / 35. Regular and italic samples use fill only.
- Arial Black and Arial Bold: all four combinations use fill only. Applying
  another outline to these faces would introduce a regression.
- Arial: genuine regular, bold, italic and bold-italic faces use fill only.

The corpus screenplay (#354) exposes the missing Demi synthesis. Browser
regular/bold ink equality alone is insufficient to choose between its behavior
and the already-bold Arial controls. A general detector is still unresolved;
these controls do not claim a production fix. No font binaries are vendored.
OOXML `w:b` is specified in ECMA-376 Part 1 §17.3.2.1; these observations concern
the reference application's font realization, not a demonstrated contradiction of that element.
