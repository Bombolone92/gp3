# Original overlapping-edge bevel controls

Five independently drawn notched polygons vary an edge offset by 0/1/2/4/8
design units. The zero-offset case contains a retraced edge. They use regular
325pt text with the existing original matte-bevel scaffold; synthetic bold is
disabled so this isolates the bevel painter from the expansion algorithm.

The temporary font uses original outlines and existing OFL-1.1 Source Sans Pro
metadata, renamed Overlap Bevel Probe 1000. It includes original rectangle
glyphs for ASCII probe coverage. No font binaries or corpus artwork are shipped.
The generator registers the font for its owned reference/browser captures, removes
registration in finally, and deletes the temporary files.

```
python tools/text_3d_overlap_fixture.py --output SCRATCH --url http://127.0.0.1:5173/playground.html
python tools/compare_text_3d_shallow_joins.py SCRATCH
```

The reference application produced the retained PDF. At baseline c4725024, the zero-offset
case fails 14 of 60,182 stable samples, maximum channel error 20 at tolerance 4.
The other four cases pass. A candidate that reconstructs the nonzero-fill
boundary before constructing bevel faces passes all five (maximum errors
3/2/3/2/2). The candidate measurements are diagnostic observations, not current
renderer expectations. Source/PDF hashes and observations are in reference.json.

On template #365, boundary reconstruction also removes the 33 newly failing
samples on Q introduced by the preceding synthetic-bold candidate. Applying
unequal x/y bold offsets before intersecting the original edges improves native
outline agreement further. Nevertheless, the combined candidate still introduces
two new failures across the 281,273-sample full-template grid while fixing 42;
it remains unshipped. A final coordinate-quantization experiment did not remove
these two failures. The renderer was restored; the goal and #365 remain open.

This records a native reference rendering requirement. MS-DOCX CT_Props3D describes the
effect declarations, but does not establish these polygon-processing details
as a normative geometry algorithm. Schema validation does not certify rendering.
