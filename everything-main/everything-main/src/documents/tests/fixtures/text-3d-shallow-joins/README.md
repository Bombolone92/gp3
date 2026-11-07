# Original shallow quadratic joins

Five original outlines vary one join coordinate by -2/-1/0/1/2 design units.
The temporary test font also supplies original rectangular glyphs for the
remaining ASCII letters: without that coverage the synthetic-bold probe would
sample fallback fonts, invalidating the comparison. Source Sans Pro's existing
OFL-1.1 metadata supplies font headers under a new family name. No font binary,
proprietary outline, or corpus content is included.

The reference application exported these five pages at 325pt synthetic bold with
the original fixture's matte bevel. The retained source passes three standard
MCE XML schema checks; those checks do not validate w14 rendering semantics.
The reference application and the browser were captured while the generated font was registered.
It was unregistered afterward. Use the generator rather than opening the DOCX
without that temporary font.

Reproduce into a scratch directory while the app is running:

```
python tools/text_3d_shallow_join_fixture.py --output SCRATCH --url http://127.0.0.1:5173/playground.html
python tools/compare_text_3d_shallow_joins.py SCRATCH
```

The first command creates original font files in a temporary directory, captures
reference and browser output, removes registration in finally, and deletes the fonts.
The second writes text3d-junction-comparison.json and paired crops. Native reference
hashes and the measured baseline are retained in reference.json. Compare
regenerated observations before updating references; PDF metadata may differ.

At ad9bdedc, four cases pass all stable native samples; the +1 case has five
failures out of 41,432 samples, maximum channel difference 5 at a tolerance of 4.
The other four cases have maximum differences of 2. No tolerance was changed.
The paired captures were inspected. This remains diagnostic evidence, not a new
passing renderer regression or a completed template.

gdi-reference.json separately records GetGlyphOutlineW(GGO_NATIVE|GGO_UNHINTED)
coordinates for the same original shapes at 1000/2048 units per em. Large
pointwise differences from the current expansion do not reliably predict the reference application's
shaded-raster error. Do not replace the expansion with a point-matching rule
without checking the visible native result. Earlier scratch captures with missing
probe glyphs or inconsistent 2048-unit metrics were discarded.

The existing Franklin Gothic Book bold “4” control still fails 88 of 13,331
stable samples, with maximum error 19. The other five Y/4 controls pass. Its
remaining discrepancy must be isolated between outline and bevel/shading;
template #365 remains partial. MS-DOCX CT_Props3D describes the effect, but
these observations do not establish a normative geometry algorithm.

The subsequent flat-material isolation confirms a visible outline defect:
the first five Y/4 controls have ink masks within one raster pixel, while
synthetic-bold Franklin Gothic Book 4 requires seven pixels of Chebyshev
dilation at four pixels per point. This is independent of bevel shading;
it does not prove that shading has no additional errors. Reproduce with
`python tools/compare_text_3d_flat_outlines.py SCRATCH URL`; paired crops put
the native reference on the left. This changes only the original controls' material to flat
and retains the app's glyph-outline rendering path.
