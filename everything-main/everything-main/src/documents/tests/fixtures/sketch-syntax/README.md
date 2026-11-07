# Sketch metadata syntax controls

Four original project-authored rectangle controls use seed 12345 and identical
size, varying sd attribute versus ask:seed element and empty versus omitted
optional a:avLst. Generate with tools/sketch_syntax_fixture.py. The quadrant
artwork is original; no corpus artwork or third-party engine is included.

The reference application exported the PDF and separately saved DOCX using
tools/export-reference.ps1. All four saved geometries match exactly.
Extract with tools/extract_sketch_geometry.py tests/fixtures/sketch-syntax.
native-recording.json binds source, native outputs and extraction with SHA-256.

The supported importer keeps the complete drawing XML as an atomic object.
Text edits can be exported without changing sketch metadata or materialized
source paths. Resizing or changing the retained drawing internals stays guarded.
Simultaneous seed forms, absent seeds, adjusted presets, saved custom geometry,
freehand and scribble are not enabled by this evidence.
