// Bump whenever src/worker/collector.js or src/shared/runtime.js changes in a
// way deployed workers must pick up. ensureWorker() then rewrites the
// deployed source in place: same URL, so links already shared keep working.
// Kept apart from worker-source.js so the app can check versions without
// bundling the worker's source text into the first load.
// '2': answers accepted along the path only, stricter values, password
//      attempt limits, byte-based size limits.
// '3': a resent submission (same rid) is stored once, under the id its first
//      attempt chose; password attempts are
//      counted atomically; surveys up to MAX_SURVEY publish, and oversized
//      bodies get 413; deleting a survey removes responses in batches.
// '4': unlocking a password link returns a pass that lets the respondent
//      submit even while the link is locked by others' wrong guesses;
//      bodies declared too large are refused before being read.
// '5': /admin/stats?sid= reads just that survey's response count; copies of
//      one submission sent at once are stored once, and a resend of a
//      stored response is acknowledged after the link filled or closed.
export const WORKER_VERSION = '5';
