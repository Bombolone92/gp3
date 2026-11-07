# Comment and revision property coverage

Reviewed 2026-10-09 against code baseline `d72b9604` and supplied ECMA-376
Part 1 §17.13.4/§17.13.5 schemas. This inventories 15 named types' direct
children and owning attributes in Strict and Transitional WML, including
inherited attributes. It contributes to A01, not full annotation-story,
range grammar, tracked content or vendor extension coverage. The current
reader expects Transitional WML; inventory does not prove Strict import.

Evidence: [docx-comments.js](../src/engine/docx-comments.js),
[comments.js](../src/engine/comments.js), [docx.js](../src/engine/docx.js),
[revisions.js](../src/engine/revisions.js), [model.js](../src/engine/model.js),
[docx-tables.js](../src/engine/docx-tables.js),
[settings ledger](settings-property-coverage.md) and
[table ledger](table-property-coverage.md).

Existing body comment anchors move with text/bookmark edits. The model supports
plain comment text, replies, resolved state and retained unchanged source.
Supported text insertions/deletions and paragraph marks have review modes,
accept/reject and export. These subsets do not establish full annotation support.

## Comments part

`CT_Comments`. Direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `comment` | Partial: import identity, author/date/initials, plain paragraph text and optional reply/resolved companions; unchanged parts preserved. Complete comment-story formatting/content remains missing. |

No owning attributes.

## Comment body

`CT_Comment`. Direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `customXml` | No structured comment-body consumer; source retained when unchanged. |
| `sdt` | No structured-control comment-body consumer; direct paragraph projection does not traverse this wrapper. |
| `p` | Partial: direct paragraphs projected as plain text with tabs/breaks; no rich comment formatting/editor. Changed comment text writes new plain paragraphs. |
| `tbl` | No table body presentation/editing: only direct paragraphs are read into comment text; retained source can survive unchanged text. |
| `proofErr` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `permStart` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `permEnd` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `bookmarkStart` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `bookmarkEnd` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `moveFromRangeStart` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `moveFromRangeEnd` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `moveToRangeStart` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `moveToRangeEnd` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `commentRangeStart` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `commentRangeEnd` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `customXmlInsRangeStart` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `customXmlInsRangeEnd` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `customXmlDelRangeStart` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `customXmlDelRangeEnd` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `customXmlMoveFromRangeStart` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `customXmlMoveFromRangeEnd` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `customXmlMoveToRangeStart` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `customXmlMoveToRangeEnd` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `ins` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `del` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `moveFrom` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `moveTo` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `oMathPara` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `oMath` | Retained comment source when unchanged; no independent rich comment-story interpretation/editing for this declaration. Plain text projection may omit it or traverse visible text only inside direct paragraphs. |
| `altChunk` | No alternative-format comment-body import or editing. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | Numeric identity read and duplicate IDs rejected; source identity retained. |
| `@author` | required | Read/stored/written; missing required author currently defaults to empty on import. |
| `@date` | optional | Read/stored/written as a string; complete date lexical/value validation remains open. |
| `@initials` | optional | Read/stored/written; new comments derive initials from author. |

## Reference identity

`CT_Markup`. No direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | Comment references/ranges parse numeric id and associate known comments; singleton references synthesize point anchors. Other uses of this shared type need separate context audits. |

## Range marker

`CT_MarkupRange`. No direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | Comment references/ranges parse numeric id and associate known comments; singleton references synthesize point anchors. Other uses of this shared type need separate context audits. |
| `@displacedByCustomXml` | optional | No displacement consumer. Comment marker reader extracts id only; move range markers are skipped. Implement custom XML displacement and range ordering. |

## Revision metadata

`CT_TrackChange`. No direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | Revision wrapper reader does not retain original revision id in its run/mark record; writers generate IDs. Retained formatting XML may retain source IDs; complete identity/grouping remains open. |
| `@author` | required | Read for supported wrappers/retained formatting records; original date validation and full structural revision metadata remain open. |
| `@date` | optional | Read for supported wrappers/retained formatting records; original date validation and full structural revision metadata remain open. |

## Revision range

`CT_TrackChangeRange`. No direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | Revision wrapper reader does not retain original revision id in its run/mark record; writers generate IDs. Retained formatting XML may retain source IDs; complete identity/grouping remains open. |
| `@author` | required | Read for supported wrappers/retained formatting records; original date validation and full structural revision metadata remain open. |
| `@date` | optional | Read for supported wrappers/retained formatting records; original date validation and full structural revision metadata remain open. |
| `@displacedByCustomXml` | optional | No displacement consumer. Comment marker reader extracts id only; move range markers are skipped. Implement custom XML displacement and range ordering. |

## Cell merge revision

`CT_CellMergeTrackChange`. No direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | Revision wrapper reader does not retain original revision id in its run/mark record; writers generate IDs. Retained formatting XML may retain source IDs; complete identity/grouping remains open. |
| `@author` | required | Read for supported wrappers/retained formatting records; original date validation and full structural revision metadata remain open. |
| `@date` | optional | Read for supported wrappers/retained formatting records; original date validation and full structural revision metadata remain open. |
| `@vMerge` | optional | No cell merge review/restore consumer; implement original/current merge semantics. |
| `@vMergeOrig` | optional | No cell merge review/restore consumer; implement original/current merge semantics. |

## Review display settings

`CT_TrackChangesView`. No direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@markup` | optional | No consumer of this individual document revisionView flag; app review modes are separate state. Implement persisted flag semantics and defaults. |
| `@comments` | optional | No consumer of this individual document revisionView flag; app review modes are separate state. Implement persisted flag semantics and defaults. |
| `@insDel` | optional | No consumer of this individual document revisionView flag; app review modes are separate state. Implement persisted flag semantics and defaults. |
| `@formatting` | optional | No consumer of this individual document revisionView flag; app review modes are separate state. Implement persisted flag semantics and defaults. |
| `@inkAnnotations` | optional | No consumer of this individual document revisionView flag; app review modes are separate state. Implement persisted flag semantics and defaults. |

## Cell property change

`CT_TcPrChange`. Direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `tcPr` | No cell formatting revision restore/review model; table property support and recovery are bounded separately. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | Revision wrapper reader does not retain original revision id in its run/mark record; writers generate IDs. Retained formatting XML may retain source IDs; complete identity/grouping remains open. |
| `@author` | required | Read for supported wrappers/retained formatting records; original date validation and full structural revision metadata remain open. |
| `@date` | optional | Read for supported wrappers/retained formatting records; original date validation and full structural revision metadata remain open. |

## Row property change

`CT_TrPrChange`. Direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `trPr` | No row formatting revision restore/review model; table property support and recovery are bounded separately. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | Revision wrapper reader does not retain original revision id in its run/mark record; writers generate IDs. Retained formatting XML may retain source IDs; complete identity/grouping remains open. |
| `@author` | required | Read for supported wrappers/retained formatting records; original date validation and full structural revision metadata remain open. |
| `@date` | optional | Read for supported wrappers/retained formatting records; original date validation and full structural revision metadata remain open. |

## Table property change

`CT_TblPrChange`. Direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `tblPr` | No table formatting revision restore/review model; table property support and recovery are bounded separately. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | Revision wrapper reader does not retain original revision id in its run/mark record; writers generate IDs. Retained formatting XML may retain source IDs; complete identity/grouping remains open. |
| `@author` | required | Read for supported wrappers/retained formatting records; original date validation and full structural revision metadata remain open. |
| `@date` | optional | Read for supported wrappers/retained formatting records; original date validation and full structural revision metadata remain open. |

## Section property change

`CT_SectPrChange`. Direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `sectPr` | No section formatting revision restore/review model; retained history is not original-view geometry support. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | Revision wrapper reader does not retain original revision id in its run/mark record; writers generate IDs. Retained formatting XML may retain source IDs; complete identity/grouping remains open. |
| `@author` | required | Read for supported wrappers/retained formatting records; original date validation and full structural revision metadata remain open. |
| `@date` | optional | Read for supported wrappers/retained formatting records; original date validation and full structural revision metadata remain open. |

## Paragraph property change

`CT_PPrChange`. Direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `pPr` | Partial retained formatting history, listing and acceptance; rejection explicitly skips restoring old paragraph properties. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | Revision wrapper reader does not retain original revision id in its run/mark record; writers generate IDs. Retained formatting XML may retain source IDs; complete identity/grouping remains open. |
| `@author` | required | Read for supported wrappers/retained formatting records; original date validation and full structural revision metadata remain open. |
| `@date` | optional | Read for supported wrappers/retained formatting records; original date validation and full structural revision metadata remain open. |

## Run property change

`CT_RPrChange`. Direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `rPr` | Partial retained formatting history, listing and acceptance; rejection explicitly skips restoring old run properties. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | Revision wrapper reader does not retain original revision id in its run/mark record; writers generate IDs. Retained formatting XML may retain source IDs; complete identity/grouping remains open. |
| `@author` | required | Read for supported wrappers/retained formatting records; original date validation and full structural revision metadata remain open. |
| `@date` | optional | Read for supported wrappers/retained formatting records; original date validation and full structural revision metadata remain open. |

## Paragraph mark property change

`CT_ParaRPrChange`. Direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `rPr` | Paragraph-mark formatting history contributes to format-change discovery/acceptance; previous-property restore remains missing. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@id` | required | Revision wrapper reader does not retain original revision id in its run/mark record; writers generate IDs. Retained formatting XML may retain source IDs; complete identity/grouping remains open. |
| `@author` | required | Read for supported wrappers/retained formatting records; original date validation and full structural revision metadata remain open. |
| `@date` | optional | Read for supported wrappers/retained formatting records; original date validation and full structural revision metadata remain open. |

## Range, content and editing gaps

- Preserve linked move identity and ranges. Import maps `moveTo` to insertion
  and `moveFrom` to deletion, skips move range markers, and writes supported
  run/mark revision records as `ins`/`del`. This is not full move round-trip,
  original/current linking or a dedicated move review model.
- Restore previous run/paragraph/paragraph-mark properties when rejecting
  formatting changes; the current model sets `formatRejectSkipped`. Original
  display of text revisions is not proof of original formatting/layout.
  Complete table, row, cell, section and numbering structural revisions separately.
- Support richer comment stories, including formatted text, tables, controls,
  fields, math and other valid content. Direct-paragraph plain projection can
  omit legal content. Changing text rebuilds a plain comment; unchanged text
  retains source nodes. Preserve unsupported content before claiming safe rich
  comment editing. Fully unchanged comment records leave their parts untouched;
  once records change, preserved nodes may be reserialized with the part.
- Complete story contexts and legal nested revision structures. Comment ranges
  outside the main body and inside body field instructions reject; drawing text
  revisions reject. Main text permits only a bounded insertion/deletion nesting
  pattern, not arbitrary legal tracked content.
- Validate and preserve range/reference semantics without inventing anchors.
  The current model normalizes lone start/end markers to point ranges and swaps
  reversed endpoints; known reference-only comments get point anchors. Markers
  for unknown comment IDs are removed from the editable paragraph model.
  Duplicate, displaced, cross-container and orphan identities need focused controls.
- Complete revision identity/author/date validation and grouping. Imported text
  revisions store type/author/date but not original IDs; adjacent matching records
  can share a wrapper on export. Do not claim original change grouping preserved.
- Audit comment companions and annotation UI separately. Current W15 replies and
  resolved state are partial support, not a complete W14/W15/W16 identity/person/
  durable-ID extension inventory. Optional companion read failures are ignored;
  preservation and disclosure need checks for malformed or unsupported companions.
- Implement document review-display flags and tracking preferences, including
  format/move tracking controls. App review modes and imported trackRevisions
  are not all settings semantics. See the settings ledger for the wider scope.

## Inventory boundary and evidence

`CT_RunTrackChange` content is not enumerated here: its content group reaches
imported Office Math groups, which the local-schema inventory tool cannot resolve.
Do not strip imported declarations or invent completeness. Resolve that content
model, all legal revision wrappers and contexts in a separate cross-schema audit.
The 30 direct comment declarations likewise do not classify every nested type,
occurrence, ordering constraint or runtime parser path.

Both supplied WML variants have the same declarations for these 15 types.
Schema SHA-256: Strict
`44fc2233c5df2cfbe0b3b50e7024bd8412ec99dfe7176313ef58845fdec5498d`;
Transitional
`0f7784b36ddc42950e5ff354cd608b83b60e4de39325d5568913f1225365029b`.
Use [audit-section-schema.py](../tools/audit-section-schema.py) with
`--direct-only --type TYPE --ledger docs/comment-revision-property-coverage.md
--ledger-section TITLE` to verify each section's child rows. Owning attribute
names/use are checked separately against the inventory, not by the child-row CLI.

Existing controls: [comment-docx.test.js](../tests/comment-docx.test.js),
[comments.test.js](../tests/comments.test.js) and
[tracked-changes.test.js](../tests/tracked-changes.test.js).
This documentation checkpoint adds no runtime or native-reference compatibility claim.
