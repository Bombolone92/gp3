# Thai and Lao word wrapping

`tools/thai_wrap_fixture.py` manually constructs four OOXML paragraphs, each
on a separate page, using the original table-shading fixture's package shell.
No template content or third-party engine is used. Right indents narrow each
paragraph so that it wraps. The cases are a Thai paragraph, a Thai word split
across two source runs, Thai mixed with Latin text and punctuation, and Lao.
`cases.json` lists each case's runs and writing width in points.

There is no native reference: the tests check that each line ends on an
`Intl.Segmenter` word boundary and that the lines rebuild the source text,
rather than comparing exact line positions with another application.
