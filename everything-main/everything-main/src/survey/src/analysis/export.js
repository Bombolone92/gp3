/**
 * Exports of responses: CSV for spreadsheets, JSON for everything else.
 *
 * CSV layout: one row per response, fixed columns first (id, link, times,
 * device, outcome), then one or more columns per question:
 *   choice questions   chosen labels joined by "; ", plus an "(Other)"
 *                      column holding the typed text when Other is enabled
 *   rating, 0-10,
 *   slider             the number
 *   grid               one column per row
 *   ranking            one column per item, holding its rank (1 = top)
 *   multiple boxes,
 *   contact            one column per box
 *   text, date         the text
 * Files start with a UTF-8 byte order mark so Excel reads accents right,
 * and any cell starting like a formula is defused with a leading quote.
 */
import { OTHER_ID, CONTACT_FIELDS, questionNumbers, fieldsOf, isAnswerable } from '../shared/runtime.js';
import { allQuestions } from '../model/survey.js';
import { choiceLabel, pickedIds, listLabel, fitsType, answerText, REMOVED_CHOICE, REMOVED_ROW } from './answers.js';
import { DEVICE_LABELS, OUTCOME_LABELS } from './filters.js';

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** One CSV cell, quoted per RFC 4180, with formula injection neutralized. */
export function csvCell(value) {
  if (value == null) return '';
  let s = typeof value === 'number' ? String(value) : String(value);
  // A cell beginning with = + - @ (or a tab or CR, which some spreadsheet
  // apps strip first) would run as a formula when opened. Respondents type
  // these answers, so they are untrusted. Plain numbers are left alone.
  // A typed number ("-3", "+2.5") cannot run, and stays as typed.
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(s) && !/^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(cells) {
  return cells.map(csvCell).join(',');
}

function iso(t) {
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : '';
}

/** Column definitions: { header, get(response) }. */
export function csvColumns(survey, collectors = {}, responses = []) {
  const nums = questionNumbers(survey);
  const cols = [
    { header: 'Response ID', get: (r) => r.id || r.key },
    { header: 'Collector', get: (r) => (collectors[r.cid] && collectors[r.cid].name) || r.cid || '' },
    { header: 'Started', get: (r) => iso(r.st) },
    { header: 'Submitted', get: (r) => iso(r.at) },
    { header: 'Time taken (s)', get: (r) => (r.st && r.at >= r.st ? Math.round((r.at - r.st) / 1000) : '') },
    { header: 'Device', get: (r) => DEVICE_LABELS[(r.meta && r.meta.device) || 'unknown'] || '' },
    { header: 'Outcome', get: (r) => OUTCOME_LABELS[r.outcome || 'complete'] || r.outcome },
  ];
  for (const q of allQuestions(survey)) {
    if (!isAnswerable(q)) continue;
    const title = `Q${nums[q.id]}. ${(q.title || 'Untitled question').replace(/\s+/g, ' ').trim()}`;
    const val = (r) => (r.answers ? r.answers[q.id] : undefined);
    // An answer from before the question's type changed, as plain text, in
    // the question's first column.
    const loose = (r) => {
      const v = val(r);
      return v != null && !fitsType(q, v) ? answerText(q, v) : null;
    };
    // Keys answered in some response, for parts of the question removed or
    // turned off since: their answers still get a column. Answers of
    // another type are in the first column instead.
    const answeredKeys = () => {
      const keys = new Set();
      for (const r of responses) if (isObj(val(r)) && fitsType(q, val(r))) for (const k of Object.keys(val(r))) keys.add(k);
      return keys;
    };
    const start = cols.length;
    switch (q.type) {
      case 'single':
      case 'dropdown':
      case 'multi': {
        cols.push({ header: title, get: (r) => loose(r) ?? pickedIds(val(r)).map((id) => choiceLabel(q, id)).join('; ') });
        if ((q.other && q.other.enabled) || responses.some((r) => pickedIds(val(r)).includes(OTHER_ID) && val(r).t)) {
          cols.push({ header: `${title} (Other)`, get: (r) => (pickedIds(val(r)).includes(OTHER_ID) && val(r).t) || '' });
        }
        break;
      }
      case 'rating':
      case 'nps':
      case 'slider':
        // Numbers kept as text (a question that was text before) count too.
        cols.push({ header: title, get: (r) => loose(r) ?? (val(r) != null ? Number(val(r)) : '') });
        break;
      case 'matrix': {
        const shown = (q.rows || []).filter((x) => (x.label || '').trim());
        const listed = new Set(shown.map((x) => x.id));
        const extra = [...answeredKeys()].filter((id) => !listed.has(id));
        const rows = [...shown, ...extra.map((id) => ({ id, label: listLabel(q.rows, id, REMOVED_ROW) }))];
        for (const row of rows) {
          cols.push({
            header: `${title}: ${row.label}`,
            get: (r) => {
              const v = val(r);
              if (!isObj(v) || v[row.id] == null) return '';
              return (Array.isArray(v[row.id]) ? v[row.id] : [v[row.id]]).map((c) => listLabel(q.columns, c, REMOVED_CHOICE)).join('; ');
            },
          });
        }
        break;
      }
      case 'ranking': {
        // Choices ranked but no longer listed (removed, or label cleared)
        // keep a column too.
        const shown = (q.choices || []).filter((x) => (x.label || '').trim());
        const listed = new Set(shown.map((x) => x.id));
        const ranked = new Set();
        for (const r of responses) if (Array.isArray(val(r))) for (const id of val(r)) ranked.add(id);
        const items = [...shown, ...[...ranked].filter((id) => !listed.has(id)).map((id) => ({ id, label: choiceLabel(q, id) }))];
        for (const c of items) {
          cols.push({
            header: `${title}: ${c.label}`,
            get: (r) => {
              const v = val(r);
              const i = Array.isArray(v) ? v.indexOf(c.id) : -1;
              return i >= 0 ? i + 1 : '';
            },
          });
        }
        break;
      }
      case 'multitext':
      case 'contact': {
        const fields = fieldsOf(q);
        const listed = new Set(fields.map((f) => f.id));
        const conf = (q.type === 'contact' && q.fields) || {};
        for (const id of answeredKeys()) {
          if (listed.has(id)) continue;
          const known = q.type === 'contact' && CONTACT_FIELDS.find(([fid]) => fid === id);
          fields.push({ id, label: known ? (conf[id] && conf[id].label) || known[1] : '(removed field)' });
        }
        for (const f of fields) {
          cols.push({ header: `${title}: ${f.label}`, get: (r) => (isObj(val(r)) && val(r)[f.id]) || '' });
        }
        break;
      }
      default:
        cols.push({ header: title, get: (r) => loose(r) ?? (val(r) != null ? String(val(r)) : '') });
    }
    // Questions with a column per part (grid rows, ranked choices, boxes):
    // an answer of another shape goes in the first, as for the others.
    if (cols.length === start) {
      if (responses.some((r) => loose(r) != null)) cols.push({ header: title, get: (r) => loose(r) ?? '' });
    } else if (['matrix', 'ranking', 'multitext', 'contact'].includes(q.type)) {
      const first = cols[start].get;
      cols[start] = { ...cols[start], get: (r) => loose(r) ?? first(r) };
    }
  }
  return cols;
}

export function toCsv(survey, responses, collectors = {}) {
  const cols = csvColumns(survey, collectors, responses);
  const lines = [csvRow(cols.map((c) => c.header))];
  for (const r of responses) lines.push(csvRow(cols.map((c) => c.get(r))));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Everything, ids and labels both, for programmatic use. */
export function toJson(survey, responses, collectors = {}) {
  return JSON.stringify(
    {
      format: 'puter-survey-responses',
      version: 1,
      exportedAt: new Date().toISOString(),
      survey: { id: survey.id, title: survey.title, pages: survey.pages },
      collectors: Object.fromEntries(Object.entries(collectors).map(([id, c]) => [id, { id, name: c.name }])),
      responses: responses.map((r) => ({
        id: r.id || r.key,
        collector: r.cid,
        startedAt: iso(r.st),
        submittedAt: iso(r.at),
        outcome: r.outcome || 'complete',
        device: (r.meta && r.meta.device) || 'unknown',
        answers: r.answers || {},
      })),
    },
    null,
    2,
  );
}
