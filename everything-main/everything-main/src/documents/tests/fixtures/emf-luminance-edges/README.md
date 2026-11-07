# EMF brightness edge controls

`tools/emf_luminance_edges_fixture.py` writes original binary EMF records into
the repository's authored shape-defaults layout. No corpus artwork or external
document engine generates the inputs. Each row pairs a black rectangular outline
and chevron with the same white geometry transformed by `a:lum bright="-100000"`.
The four rows vary display size; the final row uses fractional pixel dimensions.
The original layout's heading is retained. `cases.json` identifies the pictures.

The committed source was opened read-only in the reference application, its exact
FullName verified, and exported to the one-page `native.pdf`. Source schemas pass.
`tools/record_emf_luminance_edges.py` records source/PDF hashes, image dimensions,
and inclusive dark-pixel bounds at 96 dpi (each RGB channel below 80).

These controls establish frame mapping, not complete pixel equivalence.
The reference application exports the untreated black drawings as vectors and the brightness-adjusted
drawings as RGBA images sized 133x131, 199x196, 266x262 and 133x132. Their image
dictionaries explicitly disable interpolation. The app opens editable, and its
no-op package, unrelated-part retention, exact undo and edited reopen pass.

Before the frame correction, app adjusted-image bounds at 96 dpi were
`[427,133,489,195]`, `[427,320,521,413]`, `[427,507,552,630]`,
`[427,693,489,755]`. Drawing the exact native PDF bitmaps through browser canvas
at the PDF's own image boxes instead gives `[427,133,490,195]`,
`[427,320,522,413]`, `[427,507,554,632]`, `[427,693,490,756]`.
Thus PDF-versus-browser sampling explains part, but not all, of the discrepancy.
Changing the PDF interpolation flags in a scratch copy did not change its dark
bounds under PDFium. No source or reference PDF was altered by that experiment.

The `--variant inset-bounds` and `--variant expanded-frame` generators change
only the EMF header's ink bounds or double its physical frame. The reference application
exported both variants after exact-path verification. Insetting ink bounds leaves
native output unchanged; doubling the physical frame halves the artwork for
both vectors and adjusted bitmaps. Each sibling folder contains hashed native
references and extracted original PNGs, recorded with the same `--variant` flag.

An experimental luminance path omitted the extra final device pixel. It improved
alpha agreement at all eight tested raster sizes/frame combinations and matched
the base and inset controls' native-bitmap-through-browser outer bounds exactly,
including after edit/reopen. It was nevertheless rejected: in the doubled-frame
control, row two's right edge moved from the matching native x=473 to x=474.
The original renderer differs instead at row four's right edge (458 versus 457).
This is not evidence for a universally correct replacement mapping. Runtime
changes and their candidate tests were removed; the production renderer retained
its prior behavior. A passing mean-error comparison cannot overrule a known
new mismatch in an independent control.

Private scratch evidence includes `emf-effect-frame-comparison.json`,
`emf-expanded-before-*`, `emf-luminance-frame-browser.log` and its failed
expanded-frame screenshot/trace. The candidate's 42 focused unit cases passed;
the browser suite reported eight passes (including the existing expected-failure
transparency diagnostic) and one failed exact comparison. Those are experimental
results, not validation of a shipped runtime fix. The retained native PNGs and
their PDF placement boxes allow further comparisons without conflating browser
and PDFium image sampling. Corpus document 69 remains partial.

ECMA-376 Part 1 §20.1.8.42 defines luminance adjustment but does not prescribe
metafile rasterization. This is recorded as native measured reference behavior,
not a contradiction of an explicit OOXML viewport rule. Existing plain EMF
controls continue to establish their inclusive physical-frame viewport.

The subsequent output-device correction retains that source SVG viewport but
maps the physical frame through the output raster's final device pixel. A
reference-device pixel no longer grows with raster resolution. Keeping the
source viewport also preserves crossing strokes until the output canvas clips
them. The new `overflow-frame` control proves this distinction independently.
Native range checks cover all twelve base, doubled-frame and crossing-frame
rasters. Neutral luminance, ordinary unadjusted metafiles and degenerate frames
retain their existing viewports. Raster allocation sizes, limits and cache keys
are unchanged. Corpus document 69's native alpha error improves, but it remains partial
because native placement and antialiasing differences remain.
