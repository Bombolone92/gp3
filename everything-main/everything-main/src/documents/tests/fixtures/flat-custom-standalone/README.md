# Standalone zero-extent custom paths

`tools/flat_custom_standalone_fixture.py` reuses the independently authored twelve
paths from `flat-custom-shapes`, removes their ordinary group wrappers and assigns
the original shape extents directly to each WordprocessingML anchor.

The reference application opened the exact source and exported the retained one-page PDF.
The whole page was inspected. All twelve ink bounds/absences match the grouped
controls: both-zero frames paint nothing, one-zero-axis absolute paths still paint
outside the frame, and explicit path dimensions collapse the corresponding axis.
The recorder retains source/PDF hashes and exact color-bound measurements.

The browser regression verifies the native bounds and no-ink cases, editing,
package preservation, exact undo and edited reopening. Both-zero custom drawings
retain their original zero-sized frame and XML; they are not replaced with a
positive-sized placeholder or dropped from the document.
