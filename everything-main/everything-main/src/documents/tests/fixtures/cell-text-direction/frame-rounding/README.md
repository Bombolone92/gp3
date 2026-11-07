# Rotated line-frame evidence

These original controls extend `../spacing-phase`, independently of the viewer.
`tools/rotated_frame_fixture.py` reconstructs every source part; the recorder
rejects any input that differs from that construction.

- `highlight`: add yellow run highlighting, retaining every other property.
- `margin`: change the page's left margin from 1440 to 1441 twips.
- `multiple`: use automatic 1, 1.5 and 2 line spacing, retaining the same three
  regular 10 pt faces, four table offsets, six lines and two text directions.

Each variant has 36 tables, captured read-only using the reference application's
`Range.EnhMetaFileBits`. References bind the inputs, capture metadata and 108
metafiles: 1,296 text origins in total. The highlight variant additionally
records 432 native background rectangles. No font binaries are included.

## Findings

Adding highlights preserves all 432 text records' origins. Changing the page
margin by one twip likewise preserves all 432 **local** origins in the table
range captures. This is evidence about the extraction's coordinate origin;
it does not by itself establish a live-screen or PDF page translation rule.

The nonmonotonic `tbRl` baseline is accompanied by a highlight-frame change.
For Arial single spacing, the third line's baseline moves 1375 to 1374 logical
units when table indentation increases one twip. Its highlight's left edge
remains 1356, while its width decreases 99 to 98 units. A correction confined
to glyph positioning would not explain the complete native drawing.

Expanded spacing adds another distinction. For Arial and Times New Roman at
zero table offset, the first `btLr` baseline changes from 79 units at single
spacing to 80 at both 1.5 and 2 spacing. The first `tbRl` baseline changes from
1571 to 1570. Courier New retains 71 and 1579 respectively. This occurs before
advancing to any second line; it is not merely accumulated line spacing.

## Rejected renderer candidate

Let Q round to the native 0.12 pt drawing grid, U be the physical right edge
at the line's top, H its allocated height, and A its baseline offset. The
candidate `Q(U-H) + Q(U+H) - Q(U) - Q(A)` matched all earlier Arial phase
origins and removed the existing height/origins fidelity mismatches. It also
matched the new highlighted and shifted-margin controls for automatic `tbRl`.

However, it misses 96 of 216 `tbRl` origins in the new multiple-spacing
control by one drawing unit: all expanded-spacing Arial and Times New Roman
cases. It does not establish baseline placement within the native line frame.
The candidate was reverted; do not repeat it as a general fix or restrict its
application to selected documents/fonts. No renderer tolerance was relaxed.

## Extraction and limits

`record_rotated_frame.py` extends the existing bounded text recorder with
selected solid-brush/PATCOPY rectangle extraction. It checks compatible GDI
mapping, source construction, selected fonts, glyph advances, baseline
alignment, EMF+ wrappers and raster operation. It rejects unknown operations
instead of approximating them. This is not a general EMF renderer or evidence
of live-screen rasterization, and font family records do not prove the exact
installed font bytes selected retrospectively.

The original implementation uses the published MS-EMF format definitions for
[EMR_CREATEBRUSHINDIRECT](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-emf/b9a8ef5d-0089-4e42-b317-e6ebc0ff098f)
and [EMR_BITBLT](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-emf/347d1c44-1847-47ec-8762-7059e9e9b185).
Source properties are ECMA-376 Part 1 §17.3.2.15 `highlight`, §17.6.11 `pgMar`,
§17.3.1.33 `spacing`, §17.4.50 `tblInd`, and §17.4.72 `textDirection`.
The measured rounding behavior is not a normative OOXML requirement.

## Reproduce

```powershell
python tools/rotated_frame_fixture.py
# Repeat the capture command for highlight, margin, and multiple.
powershell -NoProfile -ExecutionPolicy Bypass -File tools/capture-rotated-spacing-phase.ps1 -SourceFullPath "$PWD/tests/fixtures/cell-text-direction/frame-rounding/highlight/control.docx" -OutputDirectory "$PWD/tests/fixtures/cell-text-direction/frame-rounding/highlight"
python tools/record_rotated_frame.py
python -m unittest discover -s tests -p 'rotated*test.py'
```

Review regenerated differences. The preceding phase references remain unchanged.
This evidence does not promote corpus #338 or claim a finished renderer fix.
