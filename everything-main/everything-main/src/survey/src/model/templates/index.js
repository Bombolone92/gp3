/**
 * The template gallery. Each entry is a definition (see dsl.js); call
 * buildTemplate(def) for a fresh survey. Listing metadata (question count,
 * minutes) comes from one cached build per template.
 */
import customer from './customer.js';
import employees from './employees.js';
import events from './events.js';
import education from './education.js';
import research from './research.js';
import community from './community.js';
import everyday from './everyday.js';
import { buildTemplate, estimateMinutes } from './dsl.js';
import { questionCount } from '../survey.js';

export const CATEGORIES = [
  { id: 'customer', label: 'Customer feedback' },
  { id: 'employees', label: 'Employees' },
  { id: 'events', label: 'Events' },
  { id: 'education', label: 'Education' },
  { id: 'research', label: 'Market research' },
  { id: 'community', label: 'Health and community' },
  { id: 'everyday', label: 'Everyday' },
];

export const TEMPLATES = [...customer, ...employees, ...events, ...education, ...research, ...community, ...everyday];

const cache = new Map();

/** A built survey for previews and counts. Do not save it: use
 *  buildTemplate() for a survey with fresh ids. */
export function sampleOf(def) {
  if (!cache.has(def.id)) cache.set(def.id, buildTemplate(def));
  return cache.get(def.id);
}

export function templateInfo(def) {
  const s = sampleOf(def);
  return { questions: questionCount(s), pages: s.pages.length, minutes: estimateMinutes(s) };
}

/** Case-insensitive search over names, summaries and question text. */
export function searchTemplates(query, category = '') {
  const q = String(query || '').trim().toLowerCase();
  return TEMPLATES.filter((t) => !category || t.category === category).filter((t) => {
    if (!q) return true;
    if (t.name.toLowerCase().includes(q) || t.summary.toLowerCase().includes(q)) return true;
    const s = sampleOf(t);
    return s.pages.some((p) => p.questions.some((x) => x.title.toLowerCase().includes(q)));
  });
}

export { buildTemplate };
