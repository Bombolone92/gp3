/**
 * Turning received email into tickets. The owner's browser reads their
 * Puter mailbox and hands each new message to the import route; this module
 * decides whether it continues an existing request (the subject carries
 * the request number, as every notification email does) or starts a new one.
 */
import { normEmail, cleanLine, cleanText } from '../shared/model.js';

/** "[#123]" or "Request #123" in a subject, the way notifications are tagged. */
export function ticketNumberFrom(subject) {
  const m = /\[#(\d{1,9})\]/.exec(String(subject || '')) || /\brequest #(\d{1,9})\b/i.exec(String(subject || ''));
  return m ? Number(m[1]) : null;
}

/** The subject without reply prefixes and the request number tag. */
export function cleanSubject(subject) {
  let s = String(subject || '').replace(/\s*\[#\d+\]\s*/g, ' ');
  for (let i = 0; i < 5; i++) s = s.replace(/^\s*(re|fw|fwd|aw|sv|antw)\s*:\s*/i, '');
  return cleanLine(s, 200) || '(no subject)';
}

/**
 * Drop the quoted history most mail clients add under a reply, so a ticket
 * shows what the customer actually wrote.
 */
export function stripQuoted(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] || '';
    if (/^\s*>/.test(line)) break;
    if (/^\s*On .{3,200}wrote:\s*$/i.test(line)) break;
    if (/^\s*On .{3,200}$/i.test(line) && /wrote:\s*$/i.test(next)) break;
    if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    if (/^\s*_{10,}\s*$/.test(line) && /^\s*From:/i.test(next)) break;
    if (/^\s*From:\s.+$/i.test(line) && /^\s*(Sent|Date):\s/i.test(next)) break;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Validate one message handed over by the browser. */
export function cleanMessage(m) {
  if (!m || typeof m !== 'object') return null;
  const from = normEmail(m.from?.address);
  if (!from) return null;
  const id = cleanLine(m.messageId || m.id, 300);
  if (!id) return null;
  const body = stripQuoted(cleanText(m.text || '', 60000));
  return {
    id,
    from,
    name: cleanLine(m.from?.name, 120) || from.split('@')[0],
    subject: cleanLine(m.subject, 300),
    text: body || '(empty message)',
    cc: (Array.isArray(m.cc) ? m.cc : []).map((c) => normEmail(c?.address || c)).filter(Boolean).slice(0, 9),
    attachments: Array.isArray(m.attachments) ? m.attachments : [],
    date: Date.parse(m.date) || null,
  };
}
