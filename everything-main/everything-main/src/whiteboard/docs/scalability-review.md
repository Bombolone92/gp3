# UI scalability review

Scope: usability and rendering cost with 500 or more organization members.
This review remains in progress; it does not establish that every surface or
real network session is scalable.

Generate offline sample data with:

```sh
node scripts/generate-scale-data.mjs
npm run dev:scale
```

The default output is `tmp/scale/organization.json`: 500 deterministic sample
identities, 20 teams, 1,500 board records, 5,000 activity records, 500 shared
templates, and a validated 5,000-note workshop. Email addresses use the reserved
`.test` domain. The script makes no cloud requests and creates no real accounts.
Import `scaleData` from the script for component tests; pass a user count and an
output path on the command line to generate another workload.

Open `/tmp/scale/preview.html` on the dev server to inspect the real People,
Boards, Reports, Audit log and Organization library components and pan/zoom the
sample workshop. These panels call the real organization worker using the
integration tests' in-memory Puter SDK. There is no live organization connection.
Changes reset on reload. Directory boards open the same sample workshop canvas;
this fixture does not simulate their individual collaborative documents or
500 simultaneous network connections.

## Confirmed issues

### People directory renders all members

Before: the 500-member component diagnostic rendered 500 rows and 975 native
select controls. Chrome measured a 24,500-pixel table body. Repeating a search
rebuilt all matching rows and their action handlers; teams followed the entire
directory.

Fix: render at most 50 members per page, search the complete directory, announce
the current range, retain search/page on tab reload, and keep keyboard focus on
an enabled paging control. CSV export still includes all members. Pending edits
remain disabled when a person is revisited and synchronize the visible controls
after success or failure.

Verification: the original bounded-row diagnostic failed with `500 !== 50`.
The fixed component reaches all 500 identities with one list request. Focus at
both page boundaries, last-member search, empty results, French summaries, full
CSV export, and navigation during a pending edit have regression checks. Existing
admin UI and action lifecycle checks pass. Chrome measures 50 rows, 98 selects,
and a 2,450-pixel table body; Next and search for member 500 work in the real UI.

### Team editor lists every eligible member without search

Before: the default workload rendered 478 eligible-member checkboxes, and Chrome
measured a 1,855-pixel member list. Finding a person required scanning the list.
The bounded-checkbox diagnostic failed with `478 !== 50` before changes.

Fix: searchable 50-member pages with a 300-pixel scrolling list. Each choice
shows the name and email, and a draft selection set retains choices across pages
and searches. Saving retains deactivated and unknown existing members. Pending
saves disable draft edits; a rejected save retains and re-enables the draft.

Verification: all 61 directory/admin UI/lifecycle checks pass, including adding
and removing members across pages, preserving unseen members, French summaries,
boundary focus, duplicate-submit prevention and save failures. Chrome renders
50 checkboxes in the bounded list. At 360 × 740, English/light and French/dark
search for member 500, display the full email, select the member and expose Save
and Cancel without horizontal scrolling in the form.

### Shared template library renders all matching templates

Before: Chrome and the unchanged component rendered 500 template rows and 1,050
action buttons. The bounded-row diagnostic failed with `500 !== 50`.

Fix: searchable 50-item pages with range announcements and keyboard focus at
page boundaries. An item with an outstanding action stays disabled when revisited.
Approvals/removals update the current view, preserve another row's keyboard focus,
and do not move focus away from a newer search. Removing the only row on the last
page clamps the page safely.

Verification: all 54 library/language/admin checks pass. Tests reach every template
without refetching, use a template outside the original page through the real
worker, retain description language, handle approval failures and concurrent
navigation, and preserve last-page reachability after removal. Chrome renders
50 rows and at most 150 buttons and announces the next range in French.

### Current board filter includes archived records

Before: the actual worker-to-console diagnostic displayed 15 archived boards
among the first 200 results while State said Current. Omitting the archive filter
also mixed these records into full CSV exports.

Fix: Current explicitly excludes archived records; Archived explicitly selects
them. Deleted leaves the archive filter unset, so a deleted board that was also
archived remains recoverable.

Verification: all 63 scale/admin UI/lifecycle checks pass. The actual worker
diagnostic checks the three states, return to Current, and complete CSV counts.
Chrome shows zero archived rows and 1,383 matching Current boards, then all 117
Archived boards with no Current rows.

### Participant controls retain stale roster metadata

Before: with 500 participants, changing a participant's session while keeping
their name and role left Follow pointing at the departed session. Changing only
guest status did not update the Guest badge. Both regressions failed against the
unchanged component and were reproduced in Chrome.

Fix: include session and guest metadata in the People tab's render signature.
Cursor and camera movement still leave controls and keyboard focus intact.

Verification: 153 facilitation and roster checks pass, plus the control-stability
check across 20 movement updates. Chrome shows the new session target and Guest
badge after the same fixture actions.

### Facilitation People tab renders the entire live roster

Before: the 501-person Chrome fixture rendered 501 rows, 500 role selectors and
1,000 action buttons in a roughly 50,000-pixel list, without a search field.
The bounded-row regression failed against the unchanged 500-person component
with `500 !== 50`.

Fix: searchable 50-person pages, counting each user once across their sessions.
Search and paging controls stay mounted; unchanged rows retain their DOM and
focus during live roster changes. Paging starts at the top of the new page.
Pending role edits keep their chosen value and remain disabled when revisited.
Replies from a departed board/session cannot alter the current view.

Verification: 23 scale checks and the 151 existing facilitation checks pass.
They cover complete reachability at 501 and 1,001 people, existing role
permissions, escaped names, locale changes, live departures, page clamping,
keyboard focus, failures and stale replies. Axe finds no violations in the
participant view in English/French (contrast requires native inspection).
Chrome shows 50 rows and at most 150 row controls, reaches the last participant,
keeps focus on Previous at the final page, and searches member 500 at 360 × 740
in English/light and French/dark without horizontal overflow.

A local JSDOM diagnostic with three warmups and seven measured runs reduced
median initial participant rendering from 131.26 to 16.67 ms and a metadata
update from 179.78 to 6.18 ms. These measurements exclude native layout and
network latency; they do not simulate concurrent network sessions.

## Large boards and large sessions

Measured on an M-series Mac: boards in headless Chromium with generated content
(frames of notes, shapes, text and connectors), the worker and browser sessions
in Node with the real worker and an in-memory Puter, and rooms with the
capacity simulation in `tests/worker-capacity.test.js` (three worker instances,
Puter's listing quota, storage visible after a delay).

A 5,000-object board opens in about 100 ms and pans in about 2.5 ms per frame
at any zoom. Deleting, undoing or adding one object no longer rewrites the
hidden object outline for screen readers (142 to 66 ms for a delete); undo keeps
unchanged objects' text layouts (111 to 17 ms at 18% zoom); a board of drawings
writes each edit in half the time; and the library paints large boards'
thumbnails without laying out text too small to see (2.3 to 0.4 seconds for six
5,000-object boards).

On a shared 5,000-object board the worker checks a one-object save in about
2.3 ms rather than 6.1 (15.5 rather than 33.6 at 20,000 objects), and hands the
same encoded state to everyone joining. A browser writes a local edit into the
shared document in about 3.5 ms rather than 14, and a synchronization that
brings nothing costs about 3 ms rather than 16.

With 100 of 150 people editing on the paid listing quota, uploads paced to keep
the room near eight saves a second take the worker from 240 listings a minute
(its whole quota), 57 writes a second and 3,273 retries to 143 listings, 20
writes a second and none, and saves from 10.5 seconds at the 95th percentile to
63 ms. Checkpoints are written once across instances, at most every five
minutes, instead of about 18 a minute. An edit the worker keeps refusing as out
of order is made again on its state rather than dropped. With 150 people moving
cursors, a relay sends about half the bytes it did (2.4 rather than 4.7 MB a
second). A hundred-person discussion's 98th reply saves in 0.28 rather than 2.2
seconds.

A device that cannot keep its copy of the board, as when its storage is full,
keeps saving to the shared board; images past the per-minute upload limit say
they are waiting rather than "Offline"; and large offline backlogs go up over
slow connections in smaller batches.

The 5,000-object limit is unchanged. At 10,000 objects a frame still pans in
about 4 ms, but a local edit on a shared board takes about 39 ms (27 at 5,000
before these changes) and incoming edits and the device copy cost twice as
much, as the browser still copies and compares the whole board for each edit.

## Regression gates

The full suite passed all 2,807 tests for the first six commits, as did the full
format check and production build. New fixes require their own checks; these
results do not establish completion of the remaining review.

## Remaining review

- Organization board directory and home library.
- Other facilitation views, task views, comments, activity and notifications.
- Rendering and interaction under dense concurrent activity; existing 5,000-item
  tests are useful evidence but do not prove 500-person workshop usability.
- Full regression suite, responsive rendering, performance measurements, and
  security checks relevant to the newly introduced navigation paths.
