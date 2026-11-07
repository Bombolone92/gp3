/**
 * Publishing: what respondents see is a snapshot of the survey sent to the
 * collector worker. Edits after that stay private until the creator
 * publishes again, so a half-finished change never reaches respondents.
 */
import { publicSnapshot } from '../model/survey.js';

/** True once the survey has been published at least once. */
export const isPublished = (meta) => !!(meta && meta.publishedAt);

/** True when the live version is older than the current draft. */
export function hasUnpublishedChanges(session) {
  const meta = session.meta || {};
  return isPublished(meta) && (session.survey.updatedAt || 0) > (meta.publishedVersion || 0);
}

/** Send the current survey to the collector and record the publish. */
export async function publishSurvey(app, session) {
  await session.flush();
  const survey = session.survey;
  await app.client.publish(publicSnapshot(survey));
  const patch = { publishedAt: Date.now(), publishedVersion: survey.updatedAt };
  await app.repo.patchMeta(survey.id, patch);
  session.setMeta(patch);
  return patch;
}

/**
 * A survey's list status from its links: draft until shared, then open
 * while any link takes responses (not closed, not past its close date),
 * else closed. `openUntil` is when the last open link closes on its own
 * (0 if one never does), so lists can tell once that time has passed.
 */
export function collectorsStatus(collectors, now = Date.now()) {
  const list = Object.values(collectors || {});
  if (!list.length) return { status: 'draft', openUntil: 0 };
  const live = list.filter((c) => c.status === 'open' && !(c.closeAt && now >= c.closeAt));
  if (!live.length) return { status: 'closed', openUntil: 0 };
  return { status: 'open', openUntil: live.some((c) => !c.closeAt) ? 0 : Math.max(...live.map((c) => c.closeAt)) };
}

/** The status to show for a survey's index entry, right now. */
export function surveyStatus(meta, now = Date.now()) {
  const status = (meta && meta.status) || 'draft';
  return status === 'open' && meta.openUntil && now >= meta.openUntil ? 'closed' : status;
}

/** Recompute a survey's list status and collector count after collector
 *  changes, and store them in the index. */
export async function syncStatus(app, session, collectors) {
  const { status, openUntil } = collectorsStatus(collectors);
  const patch = { status, openUntil, collectors: Object.keys(collectors || {}).length };
  const meta = session.meta || {};
  if (meta.status !== patch.status || (meta.openUntil || 0) !== patch.openUntil || meta.collectors !== patch.collectors) {
    await app.repo.patchMeta(session.survey.id, patch);
    session.setMeta(patch);
  }
  return status;
}
