# AutoFit cell preferences

These original controls contain no corpus content. The generator authors OPC
and WordprocessingML using the existing numeric-page-fields fixture as a shell.
The reference application opened each DOCX read-only and exported the adjacent
eight-page PDF without saving the source. The recorder hashes both files and
extracts the blue/orange cell-fill rectangles independently of the app.

Each table has a 7,200-twip preferred width, a 4,200/3,000-twip stored grid and
4,800/3,600-twip cell preferences. The eight cases compare omitted layout,
explicit AutoFit and fixed layout, with and without a vertical merge, then
vary the minimum content widths by putting a longer unbroken word in each
column in turn. Both compatibility modes 12 and 15 are captured.

With the original short words, the reference application's AutoFit fill widths are approximately
204.50/155.57 points, while fixed layout gives 205.70/154.37. A wider word in
the first column changes AutoFit to 212.06/148.01 points; a wider word in the
second changes it to 198.02/162.05. Merging and omitted versus explicit AutoFit
do not change those results. PDF fill edges include the reference application's coordinate rounding.

The previous engine capped explicit cell preferences at their already-reduced
fixed allocation, so it lost the room available above each column's minimum.
The first control differed by 1.214 points before the fix. Keeping the first
explicit cell preference until content-aware distribution matches all sixteen
native reference cases within 0.2 point. No stored grid or width preference is rewritten.

ECMA-376 Part 1 §§17.4.63 (`tblW`), 17.4.71 (`tcW`) and 17.18.87
(`ST_TblLayoutType`) apply. The AutoFit guidance says the first preferred cell
width overrides the column's maximum content width and permits alternative
layout algorithms. This is a refinement of that guidance to match the reference application, not
an asserted normative contradiction. Fixed layout remains a separate path.

Browser checks compare column origins/widths and painted fill coverage, retain
the whole no-edit package, edit surrounding text, preserve unrelated parts,
restore exact bytes on undo and reopen the edited file. Broader table tests
cover percentage preferences, page limits, nested/merged tables and indivisible
content. These controls do not establish every possible AutoFit combination.

The geometry comparison requires locally installed Arial, as used by the reference application.
The fixtures reference the font by name; no font files are bundled.
