# Email composer audit

Reviewed 2026-09-08. Scope: recipient entry, editing, MIME serialization, attachments, draft storage, send/Undo lifecycle, keyboard access, and responsive layout.

## Assessment

The composer is materially more capable and safer after this change, but **it does not yet meet or exceed Gmail across the complete feature set**. Several gaps need server capabilities absent from this repository; others remain client work. No live email was sent during this review. The backend behavior described below is the contract documented by this repository, not a new production-server verification.

The most valuable existing strengths are local contact completion without a separate sync request, explicit recipient validation, sanitized outgoing markup, readable plain-text alternatives, Puter file attachments, and accessible recipient editing. These are useful product strengths, not evidence of blanket superiority to Gmail.

## Capability comparison

| Capability | Result of this review |
| --- | --- |
| To/Cc chips, pasted address lists, contact completion | Existing; fixed duplicate recipients across To and Cc. Completion still requires explicit selection. |
| Address and header validation | Tightened bare mailbox validation; rejects CR/LF/null header injection at serialization, including reply metadata. International SMTPUTF8 mailbox support remains unverified. |
| Bcc | **Blocked by documented transport.** `/email/send` derives delivery recipients from message headers and copies message bytes to recipients. Adding a Bcc header would expose it. |
| Text styles, fonts, sizes, colours, lists, quotes | Existing; retained. |
| Custom links | Added insert/edit/remove UI and ⌘/Ctrl+K. Validates URLs, preserves custom link text in HTML, and uses native browser undo. |
| Alignment and highlighting | Added toolbar controls; verified persistence through reload. |
| Plain text | Plain unformatted messages send as text; formatted messages include a text alternative. An explicit force-plain-text mode remains missing. |
| Inline images | **Missing.** Pasted screenshots are attachments. Needs editor image support, sanitized CID references, multipart/related composition, and resizing/alt-text UI. |
| Tables | **Missing.** Pasted tables retain text/block content rather than layout. |
| Draft autosave | Text saves on debounce, close, page hide, and backgrounding. Status distinguishes saving, saved, and failed states. Separate app instances merge current stored drafts when saving unrelated messages. Same-draft cross-window conflict resolution remains missing. |
| Attachment drafts | Added account-scoped IndexedDB byte storage, reload recovery, file-only draft preservation, removal cleanup, and Undo discard snapshots. Storage failure warns before close. |
| Draft sync across devices | **Missing.** Text and attachment drafts are local to this browser and can be removed by browser storage clearing/eviction. |
| Local and Puter attachments | Existing; oversized files with known sizes are rejected before reading. The client retains its conservative 18 MiB attachment cap; Gmail documents 25 MB for personal accounts and Drive fallback. |
| Missing-attachment reminder | Added a conservative English phrase check, excluding quoted replies, signatures, and forwarded content. Missing stored files also require explicit acknowledgement before sending. This is not multilingual semantic detection. |
| Send safety | Duplicate submit events and reopening a pending draft are guarded in this app session. Fields and attachment controls lock during delivery. The text draft is flushed before the request. |
| Failed send recovery | Draft remains available. A failure after close offers to reopen the message with its in-memory files, including when file storage failed. |
| Undo Send | 0/5/10/20/30 seconds. Undo restores text and files. Leaving the page during the hold cancels delivery and retains the draft rather than attempting an ambiguous early unload-time request. |
| Schedule send | **Blocked by absent durable server queue.** A browser timer cannot provide Gmail's delivery-while-closed behavior. |
| Confidential mode | **Missing; service work.** Needs hosted access-controlled content, expiry/revocation, and recipient authentication; a composer toggle alone cannot provide it. |
| Signatures | Existing single plain-text signature, editable as rich text per message. Named rich signature presets remain missing. |
| Templates / snippets | **Missing.** Needs account-scoped named templates, insert/update/delete UI, and clear treatment of subjects, signatures, and recipients. |
| AI writing / Smart Compose | **Missing.** Needs an actual inference integration, clear data handling, cancellation, and an explicit apply step. No placeholder AI control was added. |
| Larger writing surface | Expand/restore and minimize to a draft bar. Minimized drafts release the inbox and restore the same editor, files, selection, and native Undo history. Recipient controls keep a consistent height, focus indicators stay inside scrolling bounds, and the footer cannot cover the editor. Independent pop-out windows remain missing. |
| Keyboard and accessibility | Added link shortcut, IME-safe Enter/Escape behavior, proper toolbar tab-stop filtering in the modal trap, and topmost-only modal interaction. Desktop, phone-sized, and short dark-window smoke checks pass. |

Google's current documentation establishes the comparison baseline: [writing and sending](https://support.google.com/mail/answer/9259768?hl=en), [formatting and links](https://support.google.com/mail/answer/8260?hl=en), [attachments](https://support.google.com/mail/answer/6584?hl=en), [Undo Send](https://support.google.com/mail/answer/2819488?hl=en), [scheduling](https://support.google.com/mail/answer/9214606?hl=en), [templates](https://support.google.com/mail/answer/14864208?hl=en), and [confidential mode](https://support.google.com/mail/answer/7674059?hl=en). Feature availability varies by account and platform; AI features were not independently benchmarked.

## Defects fixed

1. The disabled Send button did not stop a second form submit event from posting the message again.
2. The same mailbox in To and Cc could be delivered to twice.
3. Fields stayed editable during delivery; edits could disappear when the earlier message succeeded and removed the draft.
4. Files were lost on ordinary draft close/reopen, and a file-only draft could be classified as empty.
5. The final debounce window could lose text on reload/backgrounding.
6. An older attachment save could incorrectly mark a newly added pending file as saved; save revisions now guard this race.
7. Custom links had no editing UI and link-only markup did not trigger an HTML alternative.
8. Recipient Enter handling could interfere with IME character composition.
9. The modal focus trap included controls deliberately removed from the tab order and allowed stacked dialogs to answer the same key.
10. Independent draft store instances could overwrite unrelated drafts from another app window.
11. A tab close shortened Undo Send and attempted a request whose delivery could not be reliably observed.
12. Late attachment completion could overwrite newer text after reopening a draft; closed composers no longer resave their text.
13. Returning focus from a link input could replace the intended selection with a temporary caret; the editor now preserves a separate range before focusing.
14. Oversized files were read before their size was rejected, and file-drop cleanup could erase an immediate attachment error.
15. Replies were saved in Sent but absent from the open conversation. The reader now includes related Inbox/Sent/Archive history, updates after filing a reply, and preserves the open thread when its newest message changes. Regression tests cover sending from Inbox and Sent, reopening, archive behavior, duplicate copies, unrelated subjects, and navigation during filing.

## Work required before claiming complete parity

**First: delivery contract.** Add a separate envelope-recipient list, strip Bcc from recipient-visible MIME, validate the complete envelope before delivery, and return a durable send identifier. Add idempotency keys and documented partial-delivery results. Acceptance: a mixed To/Cc/Bcc message reaches each address once, no recipient can recover the blind list from raw headers, and retrying an ambiguous request cannot duplicate delivery.

**Second: durable drafts and scheduling.** Store draft revisions and attachments in account storage, with conflict detection and recovery, then provide a durable scheduled-message queue with timezone-aware timestamps, cancel/edit operations, and send-state reconciliation. Acceptance: drafts survive switching devices; scheduled delivery works after the browser is closed; cancel races have an explicit outcome. Do not simulate this with frontend timers.

**Third: composition feature breadth.** Implement inline images with related MIME parts, named templates, rich signature presets, explicit plain-text mode, and independent pop-out windows. Cover insertion, editing, paste, undo, draft restore, text fallback, and sent MIME in each case. Add AI assistance only with a real service and explicit insertion controls.

**Then: evidence for superiority.** Benchmark common tasks against Gmail with users: time to address a group, recover a draft with files, fix a malformed recipient, format and link a message, and recover from failed delivery. Extend assistive-technology and browser coverage. Code inspection and the Chromium smoke checks are not a usability benchmark or email-client interoperability certification.

## Validation

Completed: **819 unit/DOM tests across 50 files, 12 Chromium tests, and the production build passed.** Follow-up checks cover minimize/restore with files, selection and Undo history; stable recipient heights with mouse and touch input; and focus rings clear of the footer.

- `npm test -- --maxWorkers=4`: unit and DOM regression suite, including real IndexedDB semantics through fake-indexeddb, draft races, missing attachments, send locking, header validation, IME input, and URL handling.
- `npm run build`: production Vite build.
- `npx playwright install chromium` then `npm run test:browser`: real Chromium editing/undo, unsafe link rejection, attachment bytes after an actual reload, mocked multipart delivery, formatting persistence, and desktop/phone/short-dark layouts. Test fixture uses a fake account and intercepted delivery; it cannot send real mail.
- Screenshots are written under ignored `test-results/`. Browser tests import production composer modules through a test-only Vite fixture; the fixture is not an entry point in the production build.

Limitations: no live Puter delivery, cross-client Gmail/Outlook rendering, Safari/Firefox, real mobile keyboards, screen-reader session, or cross-device sync test was performed. `document.execCommand` remains deprecated; Chromium behavior was verified, but replacing the editing engine requires a separate migration plan. Network loss after server acceptance remains ambiguous until the backend supports idempotency and send reconciliation.
