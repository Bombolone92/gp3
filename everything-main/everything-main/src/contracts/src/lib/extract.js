/**
 * AI obligation extraction. The model is asked for strict JSON; parsing is
 * defensive anyway because models decorate output with prose and fences.
 * Everything returned is a *suggestion* — the user reviews each obligation
 * before it is saved.
 */

import { isValidISO } from './dates.js';

export const OWNERS = ['us', 'them', 'mutual'];

/** Cadences an obligation can carry; anything else is treated as one-off. */
export const REPEATS = ['monthly', 'quarterly', 'annually'];

/** Cap pasted contract text so a full MSA doesn't blow the context window. */
export const MAX_EXTRACT_CHARS = 60000;

export function buildExtractionPrompt(text) {
  const clipped = String(text).slice(0, MAX_EXTRACT_CHARS);
  return [
    'You are a contract analyst. Read the agreement text below and list the concrete obligations it creates.',
    'Respond with ONLY a JSON array, no prose, no code fences. Each element:',
    '{"text": "<one-sentence obligation, imperative, max 140 chars>",',
    ' "owner": "us" | "them" | "mutual",',
    ' "due": "YYYY-MM-DD" | null,',
    ' "repeat": "none" | "monthly" | "quarterly" | "annually"}',
    'Rules:',
    '- "us" is the party receiving services/goods or paying; "them" is the counterparty. Use "mutual" when both are bound.',
    '- Only include a due date the text states explicitly or that can be derived from an explicit date. Otherwise use null.',
    '- Use "repeat" when the text says the duty recurs ("each month", "quarterly", "annually"); otherwise "none".',
    '- Include payment schedules, deliverables, notice requirements, confidentiality duties, insurance/compliance requirements, and reporting duties.',
    '- 3 to 15 obligations. Skip boilerplate that creates no concrete duty.',
    '',
    'AGREEMENT TEXT:',
    '"""',
    clipped,
    '"""',
  ].join('\n');
}

/**
 * Parse whatever the model produced into clean obligation objects.
 * Accepts a bare array, an object wrapping one ({obligations: [...]}), and
 * fenced/prefixed variants of both. Returns [] when nothing salvageable.
 */
export function parseObligations(raw) {
  if (Array.isArray(raw)) return sanitize(raw);
  let text = String(raw ?? '').trim();
  if (!text) return [];
  // Strip markdown fences (```json ... ```).
  text = text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();

  const candidates = [];
  try {
    candidates.push(JSON.parse(text));
  } catch {
    // Fall back to the first bracketed span that parses.
    const start = text.search(/[[{]/);
    if (start !== -1) {
      const open = text[start];
      const close = open === '[' ? ']' : '}';
      const end = text.lastIndexOf(close);
      if (end > start) {
        try {
          candidates.push(JSON.parse(text.slice(start, end + 1)));
        } catch { /* nothing salvageable */ }
      }
    }
  }

  for (const c of candidates) {
    if (Array.isArray(c)) return sanitize(c);
    if (c && typeof c === 'object') {
      const arr = Object.values(c).find(Array.isArray);
      if (arr) return sanitize(arr);
    }
  }
  return [];
}

function sanitize(list) {
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const text = String(item.text ?? item.obligation ?? item.description ?? '').trim();
    if (!text) continue;
    const owner = OWNERS.includes(item.owner) ? item.owner : 'us';
    const due = isValidISO(item.due) ? item.due : null;
    // A cadence is kept as a plain string here; it only becomes a schedule
    // once the user confirms the first due date it should count from.
    const raw = String(item.repeat ?? item.recurrence ?? item.frequency ?? '').trim().toLowerCase();
    const repeat = REPEATS.includes(raw) ? raw
      : raw === 'yearly' ? 'annually'
        : raw === 'quarter' ? 'quarterly'
          : raw === 'month' || raw === 'per month' ? 'monthly' : null;
    out.push({ text: text.slice(0, 200), owner, due, repeat });
    if (out.length >= 25) break;
  }
  return out;
}

/**
 * Ask Puter AI for the obligations in `text`.
 * Throws on transport errors; resolves [] when the model finds none.
 */
export async function extractObligations(text) {
  const response = await puter.ai.chat(buildExtractionPrompt(text));
  const content = typeof response === 'string' ? response : response?.message?.content;
  // Some providers return content as an array of blocks.
  const flat = Array.isArray(content)
    ? content.map((b) => (typeof b === 'string' ? b : b?.text || '')).join('\n')
    : content;
  return parseObligations(flat);
}
