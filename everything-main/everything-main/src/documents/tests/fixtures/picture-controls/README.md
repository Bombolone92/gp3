# Native picture-control editing reference

`tools/picture_controls_fixture.py` creates eight original inline picture-control
cases using the repository's authored RGBA PNG. Temporary and persistent controls
each exercise resizing, typing into the selected contents, deleting selected
contents, and inserting a picture using the reference application's InlineShapes.AddPicture API.
The historical case suffix `replace` refers to that insertion probe; it did not
perform an in-place image replacement and must not be described as one.

Run `tools/picture_controls_native.ps1 -OutputDirectory <scratch-directory>` with
the reference application, then `tools/record_picture_controls.py <scratch-directory>`.
The helper verifies the opened full path, opens read-only, writes separate native
copies and closes only its own documents/application. The reference application produced
the committed source PDF and XML references. Native intermediate DOCX files stay
in scratch. No corpus content is included. The source passes OOXML schema checks.

Observed native behavior:

- Resizing preserves both temporary and persistent wrappers.
- Selection.TypeText and Selection.Delete on the picture contents are rejected
  for both kinds of wrapper. These probes do not establish behavior for deleting
  an enclosing range that includes the wrapper itself.
- InlineShapes.AddPicture with the control's range inserts a second picture.
  A persistent wrapper remains around both pictures; a temporary wrapper unwraps.

ECMA-376 Part 1 §17.5.2.24 requires a picture control to contain a single DrawingML
picture, within at most one paragraph or cell. The native persistent insertion
result therefore diverges from that single-picture restriction. It is recorded
as an automation insertion result, not generalized to the reference application's Change Picture UI.
Both native XML and the relevant control/picture counts prove the divergence.

The `placeholders` variant marks the same eight original cases with
`w:showingPlcHdr`. The reference application retains the placeholder flag on resize and rejects text
and deletion as before, but insertion replaces the placeholder picture instead
of adding a second one. Persistent wrappers remain with the placeholder flag
cleared; temporary wrappers unwrap. Generate this variant with
`tools/picture_control_placeholders_fixture.py`, probe with
`tools/picture_controls_native.ps1 -Placeholders -OutputDirectory <scratch>`, and
record with `tools/record_picture_controls.py <scratch> --placeholders`.

Runtime support now accepts unlocked inline picture-only controls. Geometry
edits preserve wrappers; text replacement, deletion of selected contents, and
hyperlinks are rejected before mutation. Image insertion matches the recorded
native API behavior, including multiple pictures in a persistent wrapper.
Block/cell picture wrappers and interactive Change Picture behavior remain
outside this subset. Carets at the outer edges type outside the wrapper; an
enclosing selection can remove the wrapper with its contents.
