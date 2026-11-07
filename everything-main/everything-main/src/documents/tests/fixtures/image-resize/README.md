# Picture resizing controls

`tools/image_resize_fixture.py` constructs ten OOXML cases from original XML
and original artwork: absent and explicit false aspect locks, outer and inner
true locks, 30° and 90° pictures, cropping/flipping, inline placement, and
right/center alignment with ordinary and rotated pictures.
No user template content or third-party artwork is included.

ECMA-376 Part 1 §§20.1.2.2.19 `graphicFrameLocks`, 20.1.2.2.31 `picLocks`
(`noChangeAspect`), 20.1.7.6 `xfrm`, 20.4.2.3 `anchor`, 20.4.2.7 `extent`,
20.4.2.8 `inline`, and 20.4.2.10–12 placement coordinates are relevant.
Missing/false locks permit independent dimensions; either true lock preserves
proportions. This changes editing gestures, not initial document rendering.

Resizing is free with the aspect lock off; Shift preserves proportions and
Ctrl (Windows) / Option (Mac) retains the center.
These controls do not constitute a native reference capture or layout certification.

The browser regression exercises all four physical corners, rotated selection
frames, single-transaction undo, reopened dimensions/locks, unchanged package
parts, inline resizing, modifier overrides and unlocked keyboard resizing.
The aligned case reproduces a 24-pixel opposite-corner shift before the placement
correction. Alignment is retained only when it still yields the required origin;
otherwise that axis becomes a numeric offset for the resized picture.
The independent geometry checks also cover signed corners and fractional EMUs.
Retained groups and relative-size drawings remain protected; simple retained
preset shapes keep their existing resizing behavior.
