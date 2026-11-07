# Verified WCAG fix commits

The [verification log](wcag-2.2-audit.md) records the reproduced problems and bounded checks. These commits track fixes; their existence does not establish complete WCAG 2.2 AA conformance.

The first 65 entries are the separately committed fixes prepared after `045ddf8`. Documentation updates have their own commits. Subsequent verified fixes are appended in order.

| Fix | Issue                            | Commit    | Change                                                          |
| --- | -------------------------------- | --------- | --------------------------------------------------------------- |
| 1   | short-height                     | `1b9664a` | Keep table controls visible on short screens                    |
| 2   | comment-language                 | `25cf7ac` | Preserve authored languages in comments                         |
| 3   | object-relationships             | `d6b4e15` | Describe canvas object relationships accessibly                 |
| 4   | frame-language                   | `309104e` | Preserve authored frame label languages                         |
| 5   | table-contrast                   | `ee5db39` | Increase contrast of selected table cells                       |
| 6   | mind-parent-language             | `efce1a6` | Preserve languages in mind-map parent choices                   |
| 7   | frame-choices-language           | `7ab36c8` | Preserve languages in frame choices                             |
| 8   | endpoint-language                | `7d4a78d` | Preserve languages in connector endpoint choices                |
| 9   | property-language                | `f199e49` | Preserve authored languages in object properties                |
| 10  | label-editor-language            | `3258ee1` | Preserve languages in object label editors                      |
| 11  | table-dialog-language            | `d5a5c25` | Preserve languages in table property dialogs                    |
| 12  | csv-language                     | `55f61d4` | Preserve table header languages in CSV export choices           |
| 13  | image-replacement-language       | `da5224d` | Preserve alternative-text languages when replacing images       |
| 14  | facilitation-frame-language      | `f61166d` | Preserve frame languages in facilitation controls               |
| 15  | alt-suggestion-language          | `6d81e5d` | Declare requested languages for suggested alternative text      |
| 16  | embed-title-language             | `ee81433` | Preserve authored languages in embed title editors              |
| 17  | plain-editor-ranges              | `757523e` | Preserve passage language ranges in plain text editors          |
| 18  | template-language                | `3df16dc` | Preserve declared languages in reusable templates               |
| 19  | facilitation-object-language     | `6285424` | Preserve object languages in facilitation results               |
| 20  | quick-connect-language           | `de7afa3` | Preserve object languages in Quick connect descriptions         |
| 21  | facilitation-history-language    | `27110a9` | Preserve authored languages in facilitation history             |
| 22  | concealed-language               | `cf0650a` | Preserve languages in concealed object descriptions             |
| 23  | mind-drop-language               | `bea0ef9` | Preserve languages in mind-map drop feedback                    |
| 24  | vote-title-language              | `3c28e36` | Preserve languages in captured vote titles                      |
| 25  | authored-vote-language           | `a2ca2ce` | Allow language declarations for authored voting titles          |
| 26  | poll-question-language           | `f97231e` | Allow language declarations for poll questions                  |
| 27  | poll-answer-language             | `1e21010` | Allow language declarations for poll answers                    |
| 28  | agenda-instruction-language      | `4f63e5b` | Allow language declarations for agenda instructions             |
| 29  | audit-title-language             | `0d10501` | Preserve board title languages in audit views                   |
| 30  | feedback-language                | `5b5082a` | Preserve authored feedback languages through review             |
| 31  | table-cell-language              | `5892417` | Support table cell and passage language declarations            |
| 32  | library-description-language     | `a891307` | Support language declarations for library descriptions          |
| 33  | comment-notification-language    | `5b0d985` | Preserve languages in comment notification snapshots            |
| 34  | assignment-notification-language | `b5616a9` | Preserve languages in assignment notification snapshots         |
| 35  | task-views-language              | `763caa3` | Preserve authored title languages in task views                 |
| 36  | task-frame-language              | `9dfce7f` | Preserve frame languages in planning filters                    |
| 37  | placed-timeline-language         | `9bef6e6` | Capture source languages in placed timelines                    |
| 38  | generated-mind-language          | `9bb86af` | Declare source languages for generated mind-map labels          |
| 39  | generated-icon-language          | `357e17d` | Declare source languages for generated icon descriptions        |
| 40  | generated-cluster-language       | `dea314e` | Capture source languages for generated cluster captions         |
| 41  | ai-summary-language              | `b697218` | Support explicit language declarations in AI summaries          |
| 42  | language-tag-overflow            | `19736d4` | Reject language tags that exceed normalized length limits       |
| 43  | ai-notes-language                | `b58c3ed` | Support explicit language declarations in AI note reviews       |
| 44  | ai-theme-language                | `ecdd2d9` | Support explicit language declarations in AI theme reviews      |
| 45  | named-cluster-language           | `d7b5ca7` | Support explicit language declarations for named clusters       |
| 46  | live-embed-language              | `7f8ccd9` | Preserve title languages in live embed captions                 |
| 47  | shape-contrast                   | `401080a` | Increase contrast of meaningful shape contours                  |
| 48  | point-creation-cancellation      | `17f04b8` | Complete point-tool creation on pointer release                 |
| 49  | point-placeholder-language       | `7fdba14` | Declare source languages for generated text placeholders        |
| 50  | editor-content-translation       | `8dd6d25` | Preserve authored editor text during interface translation      |
| 51  | link-validation-timing           | `597cf1f` | Keep link validation errors visible until correction            |
| 52  | presentation-validation-timing   | `69815e1` | Keep presentation validation errors visible until correction    |
| 53  | export-error-timing              | `dbf12b9` | Keep export errors visible until correction                     |
| 54  | resize-feedback-timing           | `1b85dc4` | Keep resize validation errors visible until correction          |
| 55  | rotation-feedback-timing         | `e75a910` | Keep rotation validation errors visible until correction        |
| 56  | connection-validation-timing     | `6fbf6e0` | Associate persistent errors with connection choices             |
| 57  | connection-visibility-timing     | `de99556` | Keep unavailable connection feedback visible                    |
| 58  | properties-conflict-timing       | `8699d33` | Keep object property conflict errors visible                    |
| 59  | link-conflict-timing             | `9aa522e` | Keep link conflict errors associated with their forms           |
| 60  | file-conflict-timing             | `5822e18` | Keep attachment label conflict errors visible                   |
| 61  | embed-conflict-timing            | `4cbe0bf` | Keep embed title conflict errors visible                        |
| 62  | toast-language-switch            | `37b965f` | Translate visible notifications when interface language changes |
| 63  | table-conflict-timing            | `799e001` | Keep table property conflict errors visible                     |
| 64  | table-paste-feedback-timing      | `1dfec80` | Keep table paste refusal errors visible                         |
| 65  | table-size-feedback-timing       | `7919e8f` | Keep table size refusal errors visible                          |
| 66  | cluster-preview-keyboard         | `17f15da` | Allow cluster previews to be scrolled with the keyboard         |
| 67  | audit-table-keyboard             | `8af5155` | Make audit tables scrollable with the keyboard                  |
| 68  | contribution-table-keyboard      | `de064dd` | Make workshop contribution tables keyboard scrollable           |
| 69  | quick-connect-preview-keyboard   | `c2da361` | Support keyboard scrolling of Quick connect previews            |
| 70  | tasks-table-keyboard             | `3b056ec` | Make Tasks tables scrollable with the keyboard                  |
| 71  | timeline-preview-keyboard        | `f82f2d5` | Keep Timeline previews reachable during keyboard navigation     |
| 72  | canvas-focus-visible             | `b39b3c3` | Keep the canvas keyboard focus indicator inside its viewport    |
| 73  | outline-tour-obscured            | `bca9a0d` | Reveal keyboard-focused canvas objects above the tour offer     |
| 74  | minimap-controls-obscured        | `293a8e8` | Keep minimap controls visible on short canvases                 |
| 75  | timeline-preview-resize          | `83de354` | Keep Timeline previews open through viewport changes            |
| 76  | presentation-focus-visible       | `377d437` | Keep presentation keyboard focus visible inside the slide stage |
