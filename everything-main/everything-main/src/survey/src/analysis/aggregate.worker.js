/**
 * Runs summarize() off the main thread, so a survey with tens of thousands
 * of responses never freezes the page while its summaries are computed.
 */
import { summarize } from './aggregate.js';

self.onmessage = (e) => {
  const { id, survey, responses } = e.data || {};
  try {
    self.postMessage({ id, result: summarize(survey, responses) });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
