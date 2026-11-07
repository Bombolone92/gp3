# Bounded conversation reader — 2026-09-17

Baseline: `f974e34`. This extends the verified work in
[performance-followup.md](performance-followup.md), without changing filesystem
paging, search, or remote storage. The former one-card-per-history-message limit
is now addressed for normal reading.

## Change

The reader keeps the complete ordered conversation metadata, but displays at
most **60 cards**. First/Older/Newer/Latest controls identify the visible range
and full count, and move keyboard focus onto the new page. Off-page cards release
their parsed bodies and DOM. One additional newest card is retained so Reply and
Forward still target the latest message while reading older history. Refreshes
merge into the complete conversation, including off-page messages.

Expand/Collapse explicitly acts on the current page of a long conversation.
Bulk expansion uses four workers; disposed cards cannot start reads or parse
late responses. Already issued SDK reads finish and may populate the existing
bounded byte cache. The latest card retains its expansion state across pages;
other cards are reconstructed on revisiting their page.

The app's Print button waits for complete history, prepares the entire document
in four-message batches, and refuses partial output on a read/history failure.
It reuses already loaded reader bodies, releases temporary parsed bodies after
each batch, and removes the temporary print document afterward. Closing/changing the conversation cancels preparation.
The browser's native print shortcut prints the currently displayed page, with
its range visible; use the app's Print button for the full conversation.

## Paired measurements

`node benchmarks/reader.mjs LABEL` runs actual app code in Chromium with synthetic
1k/10k/100k mailboxes, each containing one 1,000-message conversation. Files are
512 bytes, transport latency is 5 ms, and the cold operation waits for both the
visible body and complete history. Warm means reopening in the same session.
The identical harness ran on the baseline before app edits, then on the changed
app. Raw records: `benchmarks/results/reader-{before,after}.json`.

| Measurement | Before → after |
| --- | ---: |
| Complete cold reader, 1k / 10k / 100k | 807 / 896 / 1,707 → 645 / 695 / 1,631 ms |
| Complete warm reader, 1k / 10k / 100k | 147 / 149 / 161 → 64 / 66 / 60 ms |
| Cold reader DOM nodes, every size | 14,332 → 853 |
| Visible message cards, last page | 1,000 → 40 (60 on a full page) |
| Warm-reader long tasks, 1k / 10k / 100k | 70 / 71 / 74 → none observed |
| Older-page navigation, 1k / 10k / 100k | 45 / 46 / 52 ms after; zero requests/bytes |

Cold request counts are unchanged: 946 / 964 / 1,144, with unchanged payloads of
633,513 / 1,863,030 / 14,878,569 bytes. Warm opens still make one 512-byte body
request: history enrichment has evicted that short message from the header EOF
cache. No network/backend saving is claimed for paging the reader.

Heap snapshots varied rather than uniformly falling: cold 100k was
102.1 → 97.9 MB; warm 100k was 108.0 → 123.0 MB. These include fixtures and GC
variation, not retained app-only or peak memory. The reliable bound is 60 visible
cards plus the newest reply card. Single runs are directional, not latency
percentiles. These are **simulations, not signed-in Puter measurements**.

## Verification

Unit coverage checks all 125 messages in chronological pages, keyboard focus,
latest-message reply targeting from older pages, retaining off-page history after
a sent reply, abandoned expansion, late body responses, full print output,
print failures/retries, and print cancellation. Browser regressions cover 1,000
message pages and cancelled 8 MiB attachment reads. Desktop and 390px layouts
were visually inspected. The existing privacy, accessibility, account isolation,
move/delete/undo, search and retry suites remain part of the full checks.

Checks: **1,041 unit tests across 64 files, 42 Chromium browser tests, production
build, and `git diff --check` passed**. A final print-cache refinement also passed
all 10 focused reader/print unit tests and the complete browser suite.

The existing ten-scenario benchmark matrix was rerun at all three mailbox sizes:
**216 completed operations**, with no page errors, timeouts, or observed long tasks
(`benchmarks/results/reader-regression.json`). This includes dense and sparse
history, 8 MiB files, 40 ms latency, ignored header byte limits, injected failures,
cold/warm searches, catalog paging, and abandoned folder loads. At 100k, ordinary
cold inbox remained 62 requests/108 ms; a sparse page after history used 60 header
reads and zero listings; abandoned-folder work made zero subsequent requests.
These confirm the earlier work remains effective, not new savings from this change.

API review reconfirmed the official [readdir contract](https://docs.puter.com/FS/readdir/)
and [read contract](https://docs.puter.com/FS/read/). Local Puter source inspected
at `0be3bc55c28b125ec42ec85fd4b0c5fa7478a3a9` still uses direct name/id seeks,
recursive ascending-path seeks with depth filtering, per-entry SDK caching,
and SDK `byte_count` query parameters. These costs support retaining the existing
catalog and transport work: reader paging needs no listings, KV scans, remote
cache writes, index assumptions, or backend changes.

## Limits

Complete catalog/history metadata remains O(N); a nonselective cold search still
needs all relevant headers. Large MIME files still transfer in full when opened,
and deployed SDK header byte-limit behavior remains unverified. Parsed reader
memory is bounded by the number of cards, not an absolute byte limit: a single
large message or 60 expanded attachment-heavy messages can still consume substantial
memory. Full printing explicitly materializes O(thread size) inert document nodes,
although parsed export bodies are batched; exceptionally large print jobs remain
expensive. The signed-in deployment and billing limitations in the prior reports
remain unresolved.
