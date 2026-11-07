/**
 * Turning a spreadsheet into records: which column is which, what each
 * row would create, and what is wrong with the rows that would not work.
 *
 * Everything here is pure and additive. This is not the destructive
 * replace that a JSON restore performs: an import only ever adds, and a
 * row that cannot be read is reported and skipped rather than stopping
 * the rows that can.
 */
import { isValidDate, isValidTime, toHHMM } from '../lib/time.js';
import { validateShift } from './scheduling.js';
import { cleanCell } from './csv.js';

/** Compares headers and aliases without punctuation or case getting in the way. */
const normalizeHeader = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const EMPLOYEE_FIELDS = [
  { key: 'name', label: 'Name', required: true, aliases: ['name', 'employee', 'employee name', 'full name', 'person', 'staff'] },
  { key: 'role', label: 'Role', aliases: ['role', 'position', 'job', 'job title', 'title', 'department'] },
  { key: 'email', label: 'Email', aliases: ['email', 'e mail', 'email address', 'mail'] },
  { key: 'phone', label: 'Phone', aliases: ['phone', 'phone number', 'mobile', 'cell', 'telephone', 'tel'] },
  { key: 'targetHours', label: 'Target hours / week', aliases: ['target hours', 'target', 'weekly target', 'contracted hours', 'target hours week'] },
  { key: 'maxHours', label: 'Max hours / week', aliases: ['max hours', 'maximum hours', 'max', 'weekly max', 'max hours week'] },
  { key: 'hourlyRate', label: 'Hourly rate', aliases: ['hourly rate', 'rate', 'pay rate', 'wage', 'hourly', 'pay'] },
];

export const SHIFT_FIELDS = [
  { key: 'date', label: 'Date', required: true, aliases: ['date', 'day', 'shift date', 'start date'] },
  { key: 'start', label: 'Start time', required: true, aliases: ['start', 'start time', 'from', 'begins', 'scheduled start', 'in', 'clock in'] },
  { key: 'end', label: 'End time', required: true, aliases: ['end', 'end time', 'to', 'finish', 'ends', 'scheduled end', 'out', 'clock out'] },
  { key: 'role', label: 'Role / label', aliases: ['role', 'position', 'job', 'label', 'task', 'area', 'shift'] },
  { key: 'assignee', label: 'Assigned to', aliases: ['employee', 'assignee', 'name', 'staff', 'person', 'assigned to', 'who'] },
  { key: 'breakMinutes', label: 'Unpaid break (min)', aliases: ['break', 'break minutes', 'unpaid break', 'break min', 'break mins'] },
  { key: 'note', label: 'Note', aliases: ['note', 'notes', 'comment', 'comments'] },
];

/**
 * Which column each field should read, by header name. Exact alias
 * matches win; a header that merely contains an alias is the fallback,
 * so "Scheduled start" finds Start without "Start date" stealing Date.
 * A column is only ever claimed once.
 */
export function detectMapping(headers, fields) {
  const normalized = headers.map(normalizeHeader);
  const taken = new Set();
  const mapping = {};

  for (const field of fields) {
    mapping[field.key] = null;
    const exact = normalized.findIndex(
      (header, i) => !taken.has(i) && header && field.aliases.includes(header)
    );
    if (exact !== -1) {
      mapping[field.key] = exact;
      taken.add(exact);
    }
  }
  for (const field of fields) {
    if (mapping[field.key] !== null) continue;
    const loose = normalized.findIndex(
      (header, i) =>
        !taken.has(i) && header && field.aliases.some((alias) => header.includes(alias))
    );
    if (loose !== -1) {
      mapping[field.key] = loose;
      taken.add(loose);
    }
  }
  return mapping;
}

const cellAt = (row, index) => (index === null || index === undefined ? '' : cleanCell(row[index]));

/**
 * '' -> null; a number (currency symbols and thousands commas taken off)
 * where there is one; NaN where the cell holds something else. The
 * difference matters: an empty cell means "not given", while "fifty"
 * means a row the import should report rather than quietly blank out.
 */
function parseNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const text = raw.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  if (!text) return NaN;
  const n = Number(text);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * A date cell as an ISO date, or null. ISO is taken as it stands;
 * slash- and dot-separated dates follow `order` ('mdy' or 'dmy'),
 * because 03/04/2026 means different months either side of the Atlantic
 * and guessing is how an import quietly lands a week off.
 */
export function parseImportDate(value, order = 'mdy') {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const candidate = `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
    return isValidDate(candidate) ? candidate : null;
  }
  const parts = text.match(/^(\d{1,4})[/.\- ](\d{1,2})[/.\- ](\d{1,4})$/);
  if (!parts) return null;
  let year;
  let month;
  let day;
  if (parts[1].length === 4) {
    [, year, month, day] = parts;
  } else if (order === 'dmy') {
    [, day, month, year] = parts;
  } else {
    [, month, day, year] = parts;
  }
  if (String(year).length === 2) year = `20${year}`;
  const candidate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidDate(candidate) ? candidate : null;
}

/**
 * A time cell as 'HH:MM', or null. Accepts 24-hour and 12-hour clocks
 * with or without minutes, and the bare four digits a spreadsheet
 * sometimes leaves behind ("0900").
 */
export function parseImportTime(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (isValidTime(text)) return text;

  const twelve = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (twelve) {
    let hour = Number(twelve[1]);
    const minute = Number(twelve[2] ?? 0);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    if (twelve[3] === 'pm' && hour !== 12) hour += 12;
    if (twelve[3] === 'am' && hour === 12) hour = 0;
    return toHHMM(hour * 60 + minute);
  }
  const clock = text.match(/^(\d{1,2}):(\d{2})$/);
  if (clock) {
    const hour = Number(clock[1]);
    const minute = Number(clock[2]);
    return hour <= 23 && minute <= 59 ? toHHMM(hour * 60 + minute) : null;
  }
  const digits = text.match(/^(\d{1,2})(\d{2})$/);
  if (digits) {
    const hour = Number(digits[1]);
    const minute = Number(digits[2]);
    return hour <= 23 && minute <= 59 ? toHHMM(hour * 60 + minute) : null;
  }
  const hourOnly = text.match(/^(\d{1,2})$/);
  if (hourOnly && Number(hourOnly[1]) <= 23) return toHHMM(Number(hourOnly[1]) * 60);
  return null;
}

/** Names one per line, for the paste shortcut. Blank lines and duplicates go. */
export function parseNameList(text) {
  const seen = new Set();
  const names = [];
  for (const line of String(text ?? '').split(/\r\n|[\r\n]/)) {
    // A pasted column sometimes arrives with a role or an email beside
    // it; the name is the first field either way.
    const name = cleanCell(line.split(/[\t,;]/)[0]);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/**
 * What an employees CSV would create. One entry per data row:
 *
 *   { line, data, problems, duplicate }
 *
 * `problems` is human-readable and empty for a usable row; `duplicate`
 * flags a name the team already has, which is skipped rather than
 * creating a second person with the same name.
 */
export function planEmployeeImport({ rows, lineNumbers }, mapping, state) {
  const existing = new Set(state.employees.map((e) => e.name.trim().toLowerCase()));
  const seen = new Set();
  const entries = [];

  rows.forEach((row, index) => {
    const name = cellAt(row, mapping.name);
    const problems = [];
    if (!name) problems.push('No name in this row.');

    const numbers = {};
    for (const [key, label, max] of [
      ['targetHours', 'Target hours', 168],
      ['maxHours', 'Max hours', 168],
      ['hourlyRate', 'Hourly rate', Infinity],
    ]) {
      const raw = cellAt(row, mapping[key]);
      const value = raw === '' ? null : parseNumber(raw);
      if (value !== null && (Number.isNaN(value) || value < 0 || value > max)) {
        problems.push(`${label} “${raw}” is not a number this can use.`);
        numbers[key] = null;
      } else {
        numbers[key] = value;
      }
    }
    if (
      numbers.targetHours != null &&
      numbers.maxHours != null &&
      numbers.maxHours < numbers.targetHours
    ) {
      problems.push('Max hours is below target hours.');
    }

    const email = cellAt(row, mapping.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      problems.push(`“${email}” does not look like an email address.`);
    }
    const phone = cellAt(row, mapping.phone);
    if (phone && !/^\+?[\d\s().-]+$/.test(phone)) {
      problems.push(`“${phone}” does not look like a phone number.`);
    }

    const key = name.toLowerCase();
    const duplicate = Boolean(name) && (existing.has(key) || seen.has(key));
    if (name) seen.add(key);

    entries.push({
      line: lineNumbers[index],
      duplicate,
      problems,
      data: {
        name,
        role: cellAt(row, mapping.role),
        email: email && problems.length === 0 ? email : '',
        phone: phone && problems.length === 0 ? phone : '',
        targetHours: numbers.targetHours,
        maxHours: numbers.maxHours,
        hourlyRate: numbers.hourlyRate,
      },
    });
  });

  const usable = entries.filter((e) => e.problems.length === 0 && !e.duplicate);
  return {
    entries,
    usable,
    roles: newRoles(usable.map((e) => e.data.role), state),
  };
}

/** Role labels in an import that the managed list does not have yet. */
function newRoles(labels, state) {
  const known = new Set((state.settings?.roles ?? []).map((r) => r.name.trim().toLowerCase()));
  const found = new Map();
  for (const label of labels) {
    const name = String(label ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (known.has(key) || found.has(key)) continue;
    found.set(key, name);
  }
  return [...found.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * What a shifts CSV would create. Each entry carries the shift it would
 * add, the problems that would stop it, and how its assignee was
 * resolved: an employee the team already has, somebody archived (the
 * shift stays open), a name nobody recognises, or nobody at all (an
 * open shift).
 *
 * `createMissing` decides what an unrecognised name means: a new
 * employee to create alongside the shift, or an open shift.
 *
 * `unknownNames` only ever gathers names from rows that would actually
 * come in. A name on a row the import is going to skip has no shift to
 * arrive with, and creating an employee for it would leave somebody in
 * the team who was never asked for.
 */
export function planShiftImport(
  { rows, lineNumbers },
  mapping,
  state,
  { dateOrder = 'mdy', createMissing = false } = {}
) {
  // Archived people are off the rota, so a row naming one is left open
  // rather than scheduling them, and is never taken for an unknown name
  // either: with "add people this file names" on, that would create a
  // second person by the same name. Where an archived and an active
  // person share a name, the active one answers to it.
  const byName = new Map(
    [...state.employees]
      .sort((a, b) => Number(Boolean(a.active)) - Number(Boolean(b.active)))
      .map((e) => [e.name.trim().toLowerCase(), e])
  );
  const entries = [];

  rows.forEach((row, index) => {
    const problems = [];
    const rawDate = cellAt(row, mapping.date);
    const rawStart = cellAt(row, mapping.start);
    const rawEnd = cellAt(row, mapping.end);
    const date = parseImportDate(rawDate, dateOrder);
    const start = parseImportTime(rawStart);
    const end = parseImportTime(rawEnd);
    if (!date) problems.push(rawDate ? `“${rawDate}” is not a date this can read.` : 'No date in this row.');
    if (!start) problems.push(rawStart ? `“${rawStart}” is not a time this can read.` : 'No start time.');
    if (!end) problems.push(rawEnd ? `“${rawEnd}” is not a time this can read.` : 'No end time.');

    const rawBreak = cellAt(row, mapping.breakMinutes);
    let breakMinutes = rawBreak === '' ? 0 : parseNumber(rawBreak);
    if (breakMinutes === null || Number.isNaN(breakMinutes) || breakMinutes < 0) {
      if (rawBreak !== '') problems.push(`Break “${rawBreak}” is not a number of minutes.`);
      breakMinutes = 0;
    }

    const assigneeName = cellAt(row, mapping.assignee);
    const match = assigneeName ? (byName.get(assigneeName.toLowerCase()) ?? null) : null;
    let assignee = null;
    if (match?.active) {
      assignee = { kind: 'existing', id: match.id, name: match.name };
    } else if (match) {
      assignee = { kind: 'archived', id: match.id, name: match.name };
    } else if (assigneeName) {
      assignee = { kind: createMissing ? 'new' : 'open', name: assigneeName };
    }

    const shift = {
      date: date ?? '',
      start: start ?? '',
      end: end ?? '',
      role: cellAt(row, mapping.role),
      note: cellAt(row, mapping.note),
      breakMinutes: Math.round(breakMinutes),
    };
    // The same checks the editor runs, so the preview reports what the
    // app would have said anyway. Only worth asking once the pieces
    // parsed; otherwise it repeats what is already listed above.
    if (problems.length === 0) problems.push(...validateShift(shift));

    entries.push({
      line: lineNumbers[index],
      problems,
      assignee,
      data: shift,
    });
  });

  const usable = entries.filter((e) => e.problems.length === 0);
  const unknown = new Map();
  for (const entry of usable) {
    if (!entry.assignee || entry.assignee.kind === 'existing' || entry.assignee.kind === 'archived') {
      continue;
    }
    const key = entry.assignee.name.toLowerCase();
    if (!unknown.has(key)) unknown.set(key, entry.assignee.name);
  }
  return {
    entries,
    usable,
    unknownNames: [...unknown.values()].sort((a, b) => a.localeCompare(b)),
    roles: newRoles(usable.map((e) => e.data.role), state),
  };
}

/** "12 shifts, 3 rows skipped" for a preview line. */
export function describeImport(plan, noun) {
  const good = plan.usable.length;
  const skipped = plan.entries.length - good;
  const parts = [`${good} ${good === 1 ? noun : `${noun}s`}`];
  if (skipped > 0) parts.push(`${skipped} row${skipped === 1 ? '' : 's'} skipped`);
  return parts.join(', ');
}
