# Unsupported border preview geometry

Original, manually authored control from `tools/border_preview_fixture.py`.
Two sections use distinct nondefault page sizes, margins and orientation; the
second section has two columns. Both have blue handmade1 art borders. plain.docx
is the same control with only those border elements removed.

The reference application exported the retained two-page PDF. Both native/browser page pairs
were inspected. The reference recorder stores exact package/PDF/image hashes and
native page dimensions. No corpus art or third-party renderer is embedded.

This is a preview fallback regression, not art-border rendering support. Strict
import still rejects handmade1, and best-effort import remains read-only. Only
the unsupported border projection is omitted; valid page geometry and section
boundaries remain. Downloading the original retains every package part.

Unit tests compare section settings and layout with the border-free control,
including two other unsupported border cases. Browser tests verify native page
dimensions and black-text geometry on both pages, blocked editing, original
download and reopening. Blue border pixels are excluded from the black glyph
comparison. A one-pixel bidirectional tolerance and less than 0.5% unmatched
ink account for independent font rasterizers. No reference/spec divergence is claimed.
