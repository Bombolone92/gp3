# Retained empty page stories

The original OPC/XML generator derives from this project's independently authored
page-story controls. It declares first/even/default headers and footers, each
containing a paragraph with properties only. All six stories share a style with
three body paragraphs. The shaded companion changes only that shared style to
22AA88 paragraph fill; it proves that an empty story can still have visible
formatting and must not be deleted or treated as permanently invisible.

The reference application exports three pages for both controls. Source/PDF hashes bind the
independent reference. The PDF recorder checks text and measures shaded bands at
x=500pt at 144 DPI. Browser tests compare the bands before and after a shared-style
edit, reopening and undo; bounds are checked within 1pt when Arial is installed.
Without the reference font, the test retains band count and package checks.

ECMA-376 Part 1 §§17.10.1, 17.10.2, 17.10.5 and 17.10.6 define footer/header
parts and references. No reference/spec divergence was observed. Paragraph-property-only
stories now permit body editing; source parts and references remain untouched.
Nonempty stories, empty runs and structural content still retain their editing
guard. This is not a header/footer editing UI or support for arbitrary stories.
Existing read-only story rendering remains unchanged. Editable shared-style
changes resolve story formatting afresh, without mutating the imported story
paragraphs, and are validated before export.
