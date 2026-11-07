# Embedded TIFF pictures

Original control created by `tools/tiff_pictures_fixture.py`. The DrawingML frames
are authored with PNG placeholders, then their image parts and relationships are
replaced with original TIFFs. This avoids an authoring library or the reference application normalizing
the TIFF before the test. Seventeen files exercise all eight orientation tags,
uncompressed RGB, LZW, DEFLATE, PackBits, grayscale, CCITT Group 4 bilevel, palette,
unassociated alpha, CMYK, and two-page TIFF content.

`native.pdf` is a read-only export from the reference application. The reference
extractor records source/PDF hashes, picture frames, and sixteen interior RGB
samples per picture from a PDFium render. No source-template content is included.

The reference application displays encoded pixel order for all eight TIFF orientation tags and uses
only the first image of a multipage TIFF. The DOCX renderer deliberately follows
those observed behaviors; HWP's existing orientation-aware rendering is unchanged.
OOXML §15.2.14 permits TIFF image parts, and §20.1.8.13 supplies their `a:blip`
relationships; neither clause specifies a TIFF orientation algorithm.

CMYK color management remains unresolved. The reference application maps the test's pure red to
(229,50,44), while the current decoder produces (255,0,0). Its separate browser
diagnostic is an expected failure, and all measured samples are retained. This
fixture does not establish full TIFF/ICC color fidelity. The other sixteen cases
are compared at one RGB level and 0.2pt geometry tolerance, including edit/export,
exact undo, and reopening. Separate insertion coverage preserves original bytes.

Decoder: existing UTIF 3.1.0 dependency, MIT licensed, via the shared bounded
TIFF worker. No new dependency or third-party binary has been added. The worker
keeps its 15-second deadline and preflight checks, transfers an exact byte copy,
and terminates after success or failure. Original TIFF bytes remain immutable.
