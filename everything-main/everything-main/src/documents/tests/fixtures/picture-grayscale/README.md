# DrawingML grayscale pictures

The original generator authors eight controls as OPC/XML using this project's
own 16 RGBA swatches. It does not call the application serializer. The reference application
exported the one-page PDF without saving the DOCX. The independent recorder binds
source/PDF hashes and samples every swatch at 288 DPI.

Controls cover no effect, grayscale, grayscale then red/white duotone, the reverse
order, alphaModFix before/after grayscale, repeated grayscale, and black/white
duotone. The reference application's grayscale and black/white duotone pixels are identical, including
transparent swatches. Opaque grayscale is floor((2126R+7152G+722B)/10000), leaving
source alpha unchanged. Effect order matters with colored duotone and commutes
with the separately applied alpha modifier.

The importer maps grayscale into the existing ordered color pipeline, avoiding
a second image pass or duplicate media. Original grayscale XML and image bytes
remain intact through edits and export; a newly materialized shell can use the
equivalent black/white duotone representation. Nested pictures and shape fills
share the same reader. Malformed attributes, children, text and effects after
the extension list remain rejected.

Unit checks compare all opaque swatches exactly and retain alpha/package parts.
Browser tests compare all 128 swatches before/after editing, undo and reopening,
with the existing three-channel-level allowance for PDF/canvas alpha rounding.
The source is ECMA-376 Part 1 §20.1.8.34 (`grayscl`); no reference/spec divergence was
found. The spec leaves luminance coefficients/quantization unspecified, so the
native controls establish those details.
