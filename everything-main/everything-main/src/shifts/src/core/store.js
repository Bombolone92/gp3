/**
 * Application store: holds all collections in memory, exposes actions that
 * mutate state, persists the affected collection through the backend
 * adapter, and notifies subscribers after every change.
 */
import { uid } from '../lib/id.js';
import { addDays, dayOfWeek, isValidDate, isValidTime, isoToday, startOfWeek, weekDates } from '../lib/time.js';
import { validateBackup } from './backup.js';
import { defaultAvailability, validateShift } from './scheduling.js';
import { applySwap, createSwapRequest, resolveSwap, SWAP_STATUS } from './swaps.js';
import { isValidAttendanceStatus } from './attendance.js';
import { EMPTY_RULES } from './rules.js';

const DATA_COLLECTIONS = ['employees', 'shifts', 'availability', 'swaps', 'attendance'];
const COLLECTIONS = [...DATA_COLLECTIONS, 'settings'];

const DEFAULT_SETTINGS = {
  onboarded: false,
  sampleData: false,
  coverage: [],
  currency: 'USD',
  roles: [],
  // Minutes past the scheduled start that a clock-in still counts as on
  // time. Absent or null means none: a minute late is late.
  graceMinutes: null,
  // Weekly labor budget and the optional overtime rule, in the currency
  // above. All absent by default: a team that does not track cost sees
  // no change anywhere.
  laborBudget: null,
  overtimeThresholdHours: null,
  overtimeMultiplier: null,
  // Optional working-time limits, all off (see core/rules.js).
  rules: { ...EMPTY_RULES },
};

/** Longest span a repeating shift may materialize upfront. */
export const REPEAT_MAX_WEEKS = 12;

export const EMPLOYEE_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#14b8a6', '#f97316', '#ec4899', '#84cc16',
];

/**
 * Distinct trimmed role strings already present in the data, as managed
 * role entries. Used to soft-migrate datasets created before roles were
 * managed, so nothing breaks and no records need rewriting.
 */
function deriveRoles(state) {
  const seen = new Map();
  const collect = (value) => {
    const name = String(value ?? '').trim();
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  };
  for (const s of state.shifts) collect(s.role);
  for (const e of state.employees) collect(e.role);
  for (const c of state.settings.coverage ?? []) collect(c.role);
  return [...seen.values()]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ id: uid('role'), name, color: null }));
}

export function createStore(
  backend,
  { now = () => new Date().toISOString(), today = isoToday, beforeReplace = null } = {}
) {
  const state = {
    employees: [],
    shifts: [],
    availability: {},
    swaps: [],
    attendance: {},
    settings: { ...DEFAULT_SETTINGS },
    loaded: false,
  };

  const listeners = new Set();

  function notify() {
    for (const fn of listeners) fn(state);
  }

  async function persist(...collections) {
    await Promise.all(collections.map((c) => backend.save(c, state[c])));
  }

  function requireEmployee(id) {
    const employee = state.employees.find((e) => e.id === id);
    if (!employee) throw new Error('Employee not found.');
    return employee;
  }

  /**
   * An employee who can be handed a shift: on the team and not archived.
   * Archiving takes somebody off the rota (their upcoming shifts open,
   * the suggestions and the fill pass skip them, copyWeek drops them),
   * so a new assignment to them is refused here, whichever dialog asks.
   * Shifts they already hold keep them: those are history, not a rota.
   */
  function requireActiveEmployee(id) {
    const employee = requireEmployee(id);
    if (!employee.active) {
      throw new Error(`${employee.name} is archived. Restore them before scheduling them.`);
    }
    return employee;
  }

  function requireShift(id) {
    const shift = state.shifts.find((s) => s.id === id);
    if (!shift) throw new Error('Shift not found.');
    return shift;
  }

  function assertValidShift(data) {
    const errors = validateShift(data);
    if (errors.length > 0) throw new Error(errors.join(' '));
  }

  /**
   * A move or a copy sets the day and the assignee and takes the times,
   * role, break, and note from a shift already on record, so the day is
   * the only thing there is to check.
   *
   * Re-running the whole validator instead refused any shift carrying no
   * role label, which is what deleting a managed role with "clear
   * everywhere" leaves behind: the grid, the reports, the calendar
   * export, and copyWeek all read those as "No role", but a drag across
   * the week died on "A role or label is required", and only after
   * evaluateMove had already painted the drop as clean.
   */
  function assertValidDate(date) {
    if (!isValidDate(date ?? '')) throw new Error('A valid date is required.');
  }

  /** '' or nullish -> 0; otherwise whole minutes of unpaid break. */
  function normalizeBreak(value) {
    if (value === null || value === undefined || value === '') return 0;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error('The unpaid break must be zero or more minutes.');
    }
    return Math.round(n);
  }

  /** '' or nullish -> null; otherwise a number of weekly hours in [0, 168]. */
  function normalizeHours(value, label) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 168) {
      throw new Error(`${label} must be between 0 and 168 hours.`);
    }
    return n;
  }

  /**
   * Contact details are optional, local, and only ever used to build a
   * mailto:, tel:, or sms: link, so they are trimmed and sanity-checked
   * rather than verified. An empty value means "not recorded".
   */
  function normalizeEmail(value) {
    const email = String(value ?? '').trim();
    if (!email) return '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('That email address doesn’t look right.');
    }
    return email;
  }

  function normalizePhone(value) {
    const phone = String(value ?? '').trim();
    if (!phone) return '';
    if (phone.length > 32 || !/^\+?[\d\s().-]+$/.test(phone)) {
      throw new Error('A phone number can hold digits, spaces, and + ( ) - . only.');
    }
    return phone;
  }

  /** '' or nullish -> null; otherwise a non-negative hourly pay rate. */
  function normalizeRate(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error('Hourly rate must be zero or more.');
    }
    return n;
  }

  function assertHourLimits(targetHours, maxHours) {
    if (targetHours != null && maxHours != null && maxHours < targetHours) {
      throw new Error('Max hours cannot be below target hours.');
    }
  }

  /**
   * Called immediately before an action replaces the whole dataset, so
   * the app can take a restore point of what is about to go (see
   * core/snapshots.js). Every wholesale replacement goes through here,
   * which is where a future bulk operation should hook in too. Failures
   * are swallowed on purpose: a missing restore point must never stop
   * the action it was meant to protect.
   */
  async function snapshotBefore(reason) {
    if (!beforeReplace) return;
    try {
      await beforeReplace(reason, state);
    } catch (err) {
      console.error('Restore point before ' + reason + ' failed', err);
    }
  }

  /**
   * Single-level undo. A destructive action captures what it removed in a
   * restore closure and returns a function that puts it back; the next
   * destructive action (or a bulk data replacement) invalidates it.
   */
  let lastUndo = null;

  function registerUndo(restore) {
    const entry = {
      async apply() {
        if (lastUndo !== entry) throw new Error('This can no longer be undone.');
        lastUndo = null;
        await restore();
        notify();
      },
    };
    lastUndo = entry;
    return () => entry.apply();
  }

  return {
    state,

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    async init() {
      const loaded = await Promise.all(COLLECTIONS.map((c) => backend.load(c)));
      COLLECTIONS.forEach((c, i) => {
        if (loaded[i] !== null && loaded[i] !== undefined) state[c] = loaded[i];
      });
      const rawSettings = loaded[COLLECTIONS.indexOf('settings')];
      state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
      // Datasets from before managed roles get theirs seeded from the
      // distinct strings already in the data (one-time soft migration).
      if (rawSettings?.roles === undefined) {
        const seeded = deriveRoles(state);
        if (seeded.length > 0) {
          state.settings = { ...state.settings, roles: seeded };
          await persist('settings');
        }
      }
      state.loaded = true;
      notify();
    },

    // ---- Settings -------------------------------------------------------

    async updateSettings(patch) {
      state.settings = { ...state.settings, ...patch };
      await persist('settings');
      notify();
      return state.settings;
    },

    /**
     * Sets the optional working-time limits: minimum rest between
     * shifts, maximum hours in a day, maximum consecutive days. Each is
     * a plain number of hours or days, and '' (or null) turns it off.
     * Nothing here blocks a save; the numbers only drive warnings.
     */
    async updateRules(patch) {
      const limits = { minRestHours: 24, maxDailyHours: 24, maxConsecutiveDays: 60 };
      const labels = {
        minRestHours: 'Minimum rest',
        maxDailyHours: 'Maximum hours in a day',
        maxConsecutiveDays: 'Maximum consecutive days',
      };
      const next = { ...EMPTY_RULES, ...(state.settings.rules ?? {}) };
      for (const [key, value] of Object.entries(patch ?? {})) {
        if (!(key in limits)) throw new Error(`Unknown rule: ${key}`);
        if (value === null || value === undefined || value === '') {
          next[key] = null;
          continue;
        }
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0 || n > limits[key]) {
          throw new Error(`${labels[key]} must be between 1 and ${limits[key]}, or blank for off.`);
        }
        next[key] = n;
      }
      state.settings = { ...state.settings, rules: next };
      await persist('settings');
      notify();
      return next;
    },

    /**
     * The weekly labor budget and the optional overtime rule. Each is a
     * plain number and '' (or null) turns it off. A threshold without a
     * multiplier, or the other way round, simply does nothing: both are
     * needed before overtime is priced.
     */
    async updateCosting(patch) {
      const limits = {
        laborBudget: { max: 100000000, label: 'The weekly budget', integer: false },
        overtimeThresholdHours: { max: 168, label: 'The overtime threshold', integer: false },
        overtimeMultiplier: { max: 5, label: 'The overtime multiplier', integer: false, min: 1 },
      };
      const next = {};
      for (const [key, value] of Object.entries(patch ?? {})) {
        const limit = limits[key];
        if (!limit) throw new Error(`Unknown cost setting: ${key}`);
        if (value === null || value === undefined || value === '') {
          next[key] = null;
          continue;
        }
        const n = Number(value);
        const min = limit.min ?? 0;
        if (!Number.isFinite(n) || n < min || n > limit.max) {
          throw new Error(`${limit.label} must be between ${min} and ${limit.max}, or blank for off.`);
        }
        next[key] = n;
      }
      state.settings = { ...state.settings, ...next };
      await persist('settings');
      notify();
      return state.settings;
    },

    /**
     * Lateness grace period in minutes: how long after the scheduled
     * start a clock-in still counts as on time. '' or null turns it off.
     */
    async setGraceMinutes(value) {
      let minutes = null;
      if (value !== null && value !== undefined && value !== '') {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0 || n > 120) {
          throw new Error('The grace period must be a whole number of minutes from 0 to 120.');
        }
        minutes = n;
      }
      state.settings = { ...state.settings, graceMinutes: minutes };
      await persist('settings');
      notify();
      return minutes;
    },

    // ---- Employees ----------------------------------------------------

    async addEmployee({
      name,
      role = '',
      color,
      targetHours = null,
      maxHours = null,
      hourlyRate = null,
      email = '',
      phone = '',
    }) {
      const trimmed = String(name ?? '').trim();
      if (!trimmed) throw new Error('A name is required.');
      const target = normalizeHours(targetHours, 'Target hours');
      const max = normalizeHours(maxHours, 'Max hours');
      assertHourLimits(target, max);
      const employee = {
        id: uid('emp'),
        name: trimmed,
        role: String(role).trim(),
        color: color ?? EMPLOYEE_COLORS[state.employees.length % EMPLOYEE_COLORS.length],
        targetHours: target,
        maxHours: max,
        hourlyRate: normalizeRate(hourlyRate),
        email: normalizeEmail(email),
        phone: normalizePhone(phone),
        active: true,
        createdAt: now(),
      };
      state.employees.push(employee);
      state.availability[employee.id] = defaultAvailability();
      await persist('employees', 'availability');
      notify();
      return employee;
    },

    async updateEmployee(id, patch) {
      const employee = requireEmployee(id);
      const next = { ...patch };
      if (next.name !== undefined) {
        if (!String(next.name).trim()) throw new Error('A name is required.');
        next.name = String(next.name).trim();
      }
      if ('targetHours' in next) next.targetHours = normalizeHours(next.targetHours, 'Target hours');
      if ('maxHours' in next) next.maxHours = normalizeHours(next.maxHours, 'Max hours');
      if ('hourlyRate' in next) next.hourlyRate = normalizeRate(next.hourlyRate);
      if ('email' in next) next.email = normalizeEmail(next.email);
      if ('phone' in next) next.phone = normalizePhone(next.phone);
      assertHourLimits(
        'targetHours' in next ? next.targetHours : employee.targetHours,
        'maxHours' in next ? next.maxHours : employee.maxHours
      );
      Object.assign(employee, next);
      await persist('employees');
      notify();
      return employee;
    },

    /**
     * Takes an employee out of day-to-day scheduling while keeping their
     * profile, availability, color, and full history. Upcoming shifts
     * without an attendance record become open and pending swaps
     * involving them are cancelled, exactly like deletion; unlike
     * deletion the person can be restored any time. Returns an undo
     * function that also puts the opened shifts back.
     */
    async archiveEmployee(id) {
      const employee = requireEmployee(id);
      if (!employee.active) throw new Error('This employee is already archived.');
      const cutoff = today();
      const openedShiftIds = state.shifts
        .filter((s) => s.assigneeId === id && s.date >= cutoff && !state.attendance[s.id])
        .map((s) => s.id);
      const cancelledSwaps = state.swaps.filter(
        (s) => s.status === SWAP_STATUS.PENDING && (s.fromEmployeeId === id || s.toEmployeeId === id)
      );

      employee.active = false;
      const opened = new Set(openedShiftIds);
      state.shifts = state.shifts.map((s) => (opened.has(s.id) ? { ...s, assigneeId: null } : s));
      state.swaps = state.swaps.map((s) =>
        s.status === SWAP_STATUS.PENDING && (s.fromEmployeeId === id || s.toEmployeeId === id)
          ? { ...s, status: SWAP_STATUS.CANCELLED, resolvedAt: now() }
          : s
      );
      await persist('employees', 'shifts', 'swaps');
      notify();

      return registerUndo(async () => {
        const emp = state.employees.find((e) => e.id === id);
        if (emp) emp.active = true;
        state.shifts = state.shifts.map((s) => (opened.has(s.id) ? { ...s, assigneeId: id } : s));
        const swapById = new Map(cancelledSwaps.map((s) => [s.id, s]));
        state.swaps = state.swaps.map((s) => swapById.get(s.id) ?? s);
        await persist('employees', 'shifts', 'swaps');
      });
    },

    /** Brings an archived employee back into scheduling. */
    async unarchiveEmployee(id) {
      const employee = requireEmployee(id);
      if (employee.active) throw new Error('This employee is not archived.');
      employee.active = true;
      await persist('employees');
      notify();
      return employee;
    },

    /**
     * Permanently removes an employee. Shifts that still need staffing
     * (upcoming, no attendance taken) become open; past shifts and any
     * with an attendance record keep the assignment so timesheets and
     * attendance history survive (reports label them "Former employee").
     * Pending swap requests involving the employee are cancelled.
     * Returns an undo function that restores all of it.
     */
    async deleteEmployee(id) {
      const employee = requireEmployee(id);
      const index = state.employees.indexOf(employee);
      const availabilityRecord = state.availability[id];
      const cutoff = today();
      const openedShiftIds = state.shifts
        .filter((s) => s.assigneeId === id && s.date >= cutoff && !state.attendance[s.id])
        .map((s) => s.id);
      const cancelledSwaps = state.swaps.filter(
        (s) => s.status === SWAP_STATUS.PENDING && (s.fromEmployeeId === id || s.toEmployeeId === id)
      );

      state.employees = state.employees.filter((e) => e.id !== id);
      delete state.availability[id];
      state.shifts = state.shifts.map((s) =>
        s.assigneeId === id && s.date >= cutoff && !state.attendance[s.id]
          ? { ...s, assigneeId: null }
          : s
      );
      state.swaps = state.swaps.map((s) =>
        s.status === SWAP_STATUS.PENDING && (s.fromEmployeeId === id || s.toEmployeeId === id)
          ? { ...s, status: SWAP_STATUS.CANCELLED, resolvedAt: now() }
          : s
      );
      await persist('employees', 'availability', 'shifts', 'swaps');
      notify();

      return registerUndo(async () => {
        const at = Math.min(index, state.employees.length);
        state.employees = [...state.employees.slice(0, at), employee, ...state.employees.slice(at)];
        if (availabilityRecord !== undefined) state.availability[id] = availabilityRecord;
        const opened = new Set(openedShiftIds);
        state.shifts = state.shifts.map((s) => (opened.has(s.id) ? { ...s, assigneeId: id } : s));
        const swapById = new Map(cancelledSwaps.map((s) => [s.id, s]));
        state.swaps = state.swaps.map((s) => swapById.get(s.id) ?? s);
        await persist('employees', 'availability', 'shifts', 'swaps');
      });
    },

    // ---- Availability -------------------------------------------------

    async setAvailability(employeeId, days) {
      requireEmployee(employeeId);
      if (!Array.isArray(days) || days.length !== 7) {
        throw new Error('Availability must cover all seven days.');
      }
      const current = state.availability[employeeId] ?? defaultAvailability();
      state.availability[employeeId] = { ...current, days };
      await persist('availability');
      notify();
    },

    /** Adds an inclusive date-range time-off entry for an employee. */
    async addTimeOff(employeeId, { from, to, note = '' }) {
      requireEmployee(employeeId);
      if (!isValidDate(from ?? '') || !isValidDate(to ?? '')) {
        throw new Error('Valid start and end dates are required.');
      }
      if (to < from) throw new Error('Time off must end on or after the day it starts.');
      const entry = { id: uid('off'), from, to, note: String(note).trim() };
      const current = state.availability[employeeId] ?? defaultAvailability();
      state.availability[employeeId] = {
        ...current,
        exceptions: [...(current.exceptions ?? []), entry].sort((a, b) => a.from.localeCompare(b.from)),
      };
      await persist('availability');
      notify();
      return entry;
    },

    /** Removes a time-off entry. Returns an undo function that re-adds it. */
    async removeTimeOff(employeeId, entryId) {
      requireEmployee(employeeId);
      const current = state.availability[employeeId];
      const entry = current?.exceptions?.find((x) => x.id === entryId);
      if (!entry) throw new Error('Time-off entry not found.');
      state.availability[employeeId] = {
        ...current,
        exceptions: current.exceptions.filter((x) => x.id !== entryId),
      };
      await persist('availability');
      notify();

      return registerUndo(async () => {
        const record = state.availability[employeeId] ?? defaultAvailability();
        state.availability[employeeId] = {
          ...record,
          exceptions: [...(record.exceptions ?? []), entry].sort((a, b) => a.from.localeCompare(b.from)),
        };
        await persist('availability');
      });
    },

    // ---- Shifts --------------------------------------------------------

    async addShift({ date, start, end, role, assigneeId = null, note = '', breakMinutes = 0 }) {
      const shift = {
        id: uid('shf'),
        date,
        start,
        end,
        role: String(role ?? '').trim(),
        assigneeId,
        note: String(note).trim(),
        breakMinutes: normalizeBreak(breakMinutes),
        createdAt: now(),
      };
      assertValidShift(shift);
      if (assigneeId) requireActiveEmployee(assigneeId);
      state.shifts.push(shift);
      await persist('shifts');
      notify();
      return shift;
    },

    /**
     * Creates one plain shift per matching date from the template's own
     * date through `until` (inclusive), on the given weekdays. There is
     * no series link: every created shift is edited or deleted
     * individually afterwards. Exact duplicates (same date, times, role,
     * assignee) are skipped, mirroring copyWeek. The horizon is capped
     * at REPEAT_MAX_WEEKS. Returns { created, skipped }.
     */
    async addRepeatingShifts(
      { date, start, end, role, assigneeId = null, note = '', breakMinutes = 0 },
      { weekdays, until }
    ) {
      const template = {
        date,
        start,
        end,
        role: String(role ?? '').trim(),
        assigneeId,
        note: String(note).trim(),
        breakMinutes: normalizeBreak(breakMinutes),
      };
      assertValidShift(template);
      if (assigneeId) requireActiveEmployee(assigneeId);
      const days = [...new Set(weekdays ?? [])].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
      if (days.length === 0) throw new Error('Pick at least one weekday to repeat on.');
      if (!isValidDate(until ?? '')) throw new Error('A valid repeat end date is required.');
      if (until < date) throw new Error('The repeat end date must be on or after the shift date.');
      if (until > addDays(date, REPEAT_MAX_WEEKS * 7)) {
        throw new Error(`Repeats are capped at ${REPEAT_MAX_WEEKS} weeks ahead.`);
      }

      const keyOf = (s) => `${s.date}|${s.start}|${s.end}|${s.role}|${s.assigneeId ?? ''}`;
      const existing = new Set(state.shifts.map(keyOf));
      let created = 0;
      let skipped = 0;
      for (let day = date; day <= until; day = addDays(day, 1)) {
        if (!days.includes(dayOfWeek(day))) continue;
        const shift = { id: uid('shf'), ...template, date: day, createdAt: now() };
        if (existing.has(keyOf(shift))) {
          skipped += 1;
          continue;
        }
        existing.add(keyOf(shift));
        state.shifts.push(shift);
        created += 1;
      }
      if (created > 0) await persist('shifts');
      notify();
      return { created, skipped };
    },

    async updateShift(id, patch) {
      const shift = requireShift(id);
      const next = { ...shift, ...patch };
      if ('breakMinutes' in patch) next.breakMinutes = normalizeBreak(patch.breakMinutes);
      assertValidShift(next);
      // Only a *changed* assignee has to exist. A worked shift keeps the id
      // of a deleted employee so timesheets and attendance history survive,
      // and re-sending that id (the editor does, to avoid silently
      // unassigning) must not block editing the rest of the shift.
      if (next.assigneeId && next.assigneeId !== shift.assigneeId) {
        requireActiveEmployee(next.assigneeId);
      }
      Object.assign(shift, next);
      await persist('shifts');
      notify();
      return shift;
    },

    /**
     * Moves a shift onto another date and/or another assignee in one
     * write: what a drag across the week grid asks for, and what the
     * "Move shift" dialog behind it does for keyboards and phones.
     * Times, role, break, and note are untouched. Returns
     * { shift, undo }; undo puts the day and the assignee back.
     */
    async moveShift(id, { date, assigneeId = null }) {
      const shift = requireShift(id);
      const previous = { date: shift.date, assigneeId: shift.assigneeId ?? null };
      const next = { ...shift, date, assigneeId: assigneeId || null };
      assertValidDate(next.date);
      if (next.assigneeId && next.assigneeId !== shift.assigneeId) requireActiveEmployee(next.assigneeId);
      Object.assign(shift, { date: next.date, assigneeId: next.assigneeId });
      await persist('shifts');
      notify();

      return {
        shift,
        undo: registerUndo(async () => {
          const current = state.shifts.find((s) => s.id === id);
          if (!current) throw new Error('That shift no longer exists.');
          Object.assign(current, previous);
          await persist('shifts');
        }),
      };
    },

    /**
     * Staffs several shifts at once: the write behind filling a week's
     * open shifts. Either every assignment lands or none does, and the
     * whole pass is one undo rather than one per shift. Assignments are
     * { shiftId, assigneeId } pairs; the ranking that produced them
     * already ruled out overlaps (see core/fill.js). Returns
     * { filled, undo }.
     */
    async assignShifts(assignments) {
      const list = assignments ?? [];
      if (list.length === 0) throw new Error('There is nothing to assign.');
      // Check everything before touching anything: a half-applied batch
      // would leave the review list the user just approved half true.
      const previous = new Map();
      for (const { shiftId, assigneeId } of list) {
        const shift = requireShift(shiftId);
        requireActiveEmployee(assigneeId);
        previous.set(shiftId, shift.assigneeId ?? null);
      }
      for (const { shiftId, assigneeId } of list) {
        state.shifts.find((s) => s.id === shiftId).assigneeId = assigneeId;
      }
      await persist('shifts');
      notify();

      return {
        filled: list.length,
        undo: registerUndo(async () => {
          for (const [shiftId, assigneeId] of previous) {
            const shift = state.shifts.find((s) => s.id === shiftId);
            if (shift) shift.assigneeId = assigneeId;
          }
          await persist('shifts');
        }),
      };
    },

    /**
     * Duplicates a shift onto another date and/or assignee, keeping its
     * times, role, break, and note; attendance and swaps stay with the
     * original. This is "same shift, next day" without retyping it.
     * Returns { shift, undo }; undo removes the copy.
     */
    async copyShift(id, { date, assigneeId = null }) {
      const source = requireShift(id);
      const copy = {
        id: uid('shf'),
        date,
        start: source.start,
        end: source.end,
        role: source.role,
        assigneeId: assigneeId || null,
        note: source.note ?? '',
        breakMinutes: source.breakMinutes ?? 0,
        createdAt: now(),
      };
      assertValidDate(copy.date);
      if (copy.assigneeId) requireActiveEmployee(copy.assigneeId);
      state.shifts.push(copy);
      await persist('shifts');
      notify();

      return {
        shift: copy,
        undo: registerUndo(async () => {
          state.shifts = state.shifts.filter((s) => s.id !== copy.id);
          await persist('shifts');
        }),
      };
    },

    /**
     * Clones one week's shifts onto another week, keeping weekday, times,
     * role, assignee, and note. Attendance is never copied. Existing
     * shifts in the target week stay; exact duplicates (same day, times,
     * role, and assignee) are skipped, and shifts whose employee no
     * longer exists or is archived arrive unassigned. Returns
     * { copied, skipped }.
     */
    async copyWeek(fromDate, toDate) {
      if (!isValidDate(fromDate ?? '') || !isValidDate(toDate ?? '')) {
        throw new Error('Invalid week.');
      }
      const fromDates = weekDates(startOfWeek(fromDate));
      const toDates = weekDates(startOfWeek(toDate));
      if (fromDates[0] === toDates[0]) throw new Error('That is the same week.');

      const source = state.shifts.filter((s) => fromDates.includes(s.date));
      if (source.length === 0) throw new Error('There are no shifts in that week to copy.');

      const employeeIds = new Set(state.employees.filter((e) => e.active).map((e) => e.id));
      const keyOf = (s) => `${s.date}|${s.start}|${s.end}|${s.role}|${s.assigneeId ?? ''}`;
      const existing = new Set(
        state.shifts.filter((s) => toDates.includes(s.date)).map(keyOf)
      );

      let copied = 0;
      let skipped = 0;
      for (const s of source) {
        const clone = {
          id: uid('shf'),
          date: toDates[fromDates.indexOf(s.date)],
          start: s.start,
          end: s.end,
          role: s.role,
          assigneeId: s.assigneeId && employeeIds.has(s.assigneeId) ? s.assigneeId : null,
          note: s.note ?? '',
          breakMinutes: s.breakMinutes ?? 0,
          createdAt: now(),
        };
        if (existing.has(keyOf(clone))) {
          skipped += 1;
          continue;
        }
        existing.add(keyOf(clone));
        state.shifts.push(clone);
        copied += 1;
      }
      if (copied > 0) await persist('shifts');
      notify();
      return { copied, skipped };
    },

    /**
     * Deletes a shift plus its attendance record and pending swap
     * requests. Returns an undo function that restores all three.
     */
    async deleteShift(id) {
      const shift = requireShift(id);
      const attendanceRecord = state.attendance[id];
      const cancelledSwaps = state.swaps.filter(
        (s) => s.shiftId === id && s.status === SWAP_STATUS.PENDING
      );

      state.shifts = state.shifts.filter((s) => s.id !== id);
      delete state.attendance[id];
      state.swaps = state.swaps.map((s) =>
        s.shiftId === id && s.status === SWAP_STATUS.PENDING
          ? { ...s, status: SWAP_STATUS.CANCELLED, resolvedAt: now() }
          : s
      );
      await persist('shifts', 'attendance', 'swaps');
      notify();

      return registerUndo(async () => {
        state.shifts = [...state.shifts, shift];
        if (attendanceRecord !== undefined) state.attendance[id] = attendanceRecord;
        const swapById = new Map(cancelledSwaps.map((s) => [s.id, s]));
        state.swaps = state.swaps.map((s) => swapById.get(s.id) ?? s);
        await persist('shifts', 'attendance', 'swaps');
      });
    },

    // ---- Swaps ---------------------------------------------------------

    async requestSwap({ shiftId, toEmployeeId, reason }) {
      const shift = requireShift(shiftId);
      requireEmployee(toEmployeeId);
      const duplicate = state.swaps.some(
        (s) => s.shiftId === shiftId && s.status === SWAP_STATUS.PENDING
      );
      if (duplicate) throw new Error('This shift already has a pending swap request.');
      const swap = createSwapRequest({ shift, toEmployeeId, reason, id: uid('swp'), now: now() });
      state.swaps.push(swap);
      await persist('swaps');
      notify();
      return swap;
    },

    /** Approves a pending swap and reassigns its shift. */
    async approveSwap(id) {
      const swap = state.swaps.find((s) => s.id === id);
      if (!swap) throw new Error('Swap request not found.');
      // Check the request first. resolveSwap rejects one that is already
      // resolved, and a declined request still points at its original
      // assignee, so applySwap would happily move the shift and only then
      // hit the rejection: the reassignment would sit in memory, never
      // persisted, until a reload quietly undid it.
      const resolved = resolveSwap(swap, SWAP_STATUS.APPROVED, now());
      state.shifts = applySwap(swap, state.shifts);
      state.swaps = state.swaps.map((s) => (s.id === id ? resolved : s));
      await persist('shifts', 'swaps');
      notify();
      return resolved;
    },

    async declineSwap(id) {
      return this._closeSwap(id, SWAP_STATUS.DECLINED);
    },

    async cancelSwap(id) {
      return this._closeSwap(id, SWAP_STATUS.CANCELLED);
    },

    async _closeSwap(id, status) {
      const swap = state.swaps.find((s) => s.id === id);
      if (!swap) throw new Error('Swap request not found.');
      const resolved = resolveSwap(swap, status, now());
      state.swaps = state.swaps.map((s) => (s.id === id ? resolved : s));
      await persist('swaps');
      notify();
      return resolved;
    },

    // ---- Attendance ----------------------------------------------------

    async recordAttendance(shiftId, { status, clockIn = '', clockOut = '', note = '' }) {
      requireShift(shiftId);
      if (!isValidAttendanceStatus(status)) throw new Error(`Invalid status: ${status}`);
      state.attendance[shiftId] = {
        status,
        clockIn,
        clockOut,
        note: String(note).trim(),
        recordedAt: now(),
      };
      await persist('attendance');
      notify();
      return state.attendance[shiftId];
    },

    /**
     * Clears a shift's attendance record. Returns an undo function that
     * restores it, or null when there was nothing to clear.
     */
    async clearAttendance(shiftId) {
      const record = state.attendance[shiftId];
      delete state.attendance[shiftId];
      await persist('attendance');
      notify();

      if (record === undefined) return null;
      return registerUndo(async () => {
        state.attendance[shiftId] = record;
        await persist('attendance');
      });
    },

    // ---- Coverage requirements -------------------------------------------

    /** Adds a minimum-headcount requirement for a role on given weekdays. */
    async addCoverage({ role, days, count, start = null, end = null }) {
      const trimmedRole = String(role ?? '').trim();
      if (!trimmedRole) throw new Error('A role is required.');
      const dayList = [...new Set(days ?? [])]
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        .sort((a, b) => a - b);
      if (dayList.length === 0) throw new Error('Pick at least one day.');
      const n = Number(count);
      if (!Number.isInteger(n) || n < 1 || n > 50) {
        throw new Error('Headcount must be a whole number between 1 and 50.');
      }
      if (Boolean(start) !== Boolean(end)) {
        throw new Error('Set both window times, or neither for the whole day.');
      }
      if (start && !(isValidTime(start) && isValidTime(end) && start < end)) {
        throw new Error('The window end must be after its start.');
      }
      const entry = {
        id: uid('cov'),
        role: trimmedRole,
        days: dayList,
        count: n,
        start: start || null,
        end: end || null,
      };
      state.settings = { ...state.settings, coverage: [...(state.settings.coverage ?? []), entry] };
      await persist('settings');
      notify();
      return entry;
    },

    async removeCoverage(id) {
      const coverage = state.settings.coverage ?? [];
      if (!coverage.some((c) => c.id === id)) throw new Error('Requirement not found.');
      state.settings = { ...state.settings, coverage: coverage.filter((c) => c.id !== id) };
      await persist('settings');
      notify();
    },

    // ---- Managed roles ---------------------------------------------------

    /** Adds a role (name plus optional color) to the managed list. */
    async addRole({ name, color = null }) {
      const trimmed = String(name ?? '').trim();
      if (!trimmed) throw new Error('A role name is required.');
      const roles = state.settings.roles ?? [];
      if (roles.some((r) => r.name.toLowerCase() === trimmed.toLowerCase())) {
        throw new Error('That role already exists.');
      }
      const role = { id: uid('role'), name: trimmed, color };
      state.settings = {
        ...state.settings,
        roles: [...roles, role].sort((a, b) => a.name.localeCompare(b.name)),
      };
      await persist('settings');
      notify();
      return role;
    },

    /**
     * Makes sure a label used on a record exists in the managed list;
     * returns the existing or newly added role, or null for blank input.
     */
    async ensureRole(name) {
      const trimmed = String(name ?? '').trim();
      if (!trimmed) return null;
      const existing = (state.settings.roles ?? []).find(
        (r) => r.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (existing) return existing;
      return this.addRole({ name: trimmed });
    },

    /**
     * Renames a role and/or changes its color. A rename cascades in one
     * action across shifts, employee roles, and coverage requirements
     * that carry the old label (matched case-insensitively).
     */
    async updateRole(id, { name, color } = {}) {
      const roles = state.settings.roles ?? [];
      const role = roles.find((r) => r.id === id);
      if (!role) throw new Error('Role not found.');
      const nextName = name !== undefined ? String(name).trim() : role.name;
      if (!nextName) throw new Error('A role name is required.');
      if (roles.some((r) => r.id !== id && r.name.toLowerCase() === nextName.toLowerCase())) {
        throw new Error('That role already exists.');
      }
      const oldName = role.name;
      const matches = (v) => String(v ?? '').trim().toLowerCase() === oldName.toLowerCase();
      const updated = { ...role, name: nextName, ...(color !== undefined ? { color } : {}) };

      state.settings = {
        ...state.settings,
        roles: roles.map((r) => (r.id === id ? updated : r)).sort((a, b) => a.name.localeCompare(b.name)),
      };
      const collections = ['settings'];
      if (nextName !== oldName) {
        if (state.shifts.some((s) => matches(s.role))) {
          state.shifts = state.shifts.map((s) => (matches(s.role) ? { ...s, role: nextName } : s));
          collections.push('shifts');
        }
        if (state.employees.some((e) => matches(e.role))) {
          state.employees = state.employees.map((e) => (matches(e.role) ? { ...e, role: nextName } : e));
          collections.push('employees');
        }
        const coverage = state.settings.coverage ?? [];
        if (coverage.some((c) => matches(c.role))) {
          state.settings = {
            ...state.settings,
            coverage: coverage.map((c) => (matches(c.role) ? { ...c, role: nextName } : c)),
          };
        }
      }
      await persist(...collections);
      notify();
      return updated;
    },

    /**
     * Removes a role from the managed list. With `clearRecords`, the
     * label is also cleared from shifts and employees and matching
     * coverage requirements are removed; otherwise every record keeps
     * its label as plain text.
     */
    async deleteRole(id, { clearRecords = false } = {}) {
      const roles = state.settings.roles ?? [];
      const role = roles.find((r) => r.id === id);
      if (!role) throw new Error('Role not found.');
      const matches = (v) => String(v ?? '').trim().toLowerCase() === role.name.toLowerCase();

      state.settings = { ...state.settings, roles: roles.filter((r) => r.id !== id) };
      const collections = ['settings'];
      if (clearRecords) {
        if (state.shifts.some((s) => matches(s.role))) {
          state.shifts = state.shifts.map((s) => (matches(s.role) ? { ...s, role: '' } : s));
          collections.push('shifts');
        }
        if (state.employees.some((e) => matches(e.role))) {
          state.employees = state.employees.map((e) => (matches(e.role) ? { ...e, role: '' } : e));
          collections.push('employees');
        }
        state.settings = {
          ...state.settings,
          coverage: (state.settings.coverage ?? []).filter((c) => !matches(c.role)),
        };
      }
      await persist(...collections);
      notify();
    },

    // ---- CSV import ------------------------------------------------------

    /**
     * Adds people and shifts from a spreadsheet in one write, with one
     * undo. Additive on purpose: unlike importData this replaces nothing,
     * and anything already here is left exactly as it was.
     *
     * `employees` are created first, so a shift can name somebody in the
     * same file: each shift's optional `assigneeName` is matched, case
     * insensitively, against the team plus whoever was just created, and
     * a name nobody answers to leaves the shift open. Role labels are
     * added to the managed list, the way ensureRole does elsewhere.
     *
     * Returns { employeesAdded, shiftsAdded, rolesAdded, openedShifts,
     * undo }.
     */
    async importRecords({ employees = [], shifts = [], roles = [] } = {}) {
      if (employees.length === 0 && shifts.length === 0) {
        throw new Error('There is nothing to import.');
      }

      // Build everything before touching state: a spreadsheet with one
      // bad row in it should fail as a whole rather than land half in.
      const createdEmployees = employees.map((entry, index) => {
        const name = String(entry.name ?? '').trim();
        if (!name) throw new Error('An imported employee has no name.');
        const target = normalizeHours(entry.targetHours, 'Target hours');
        const max = normalizeHours(entry.maxHours, 'Max hours');
        assertHourLimits(target, max);
        return {
          id: uid('emp'),
          name,
          role: String(entry.role ?? '').trim(),
          color: EMPLOYEE_COLORS[(state.employees.length + index) % EMPLOYEE_COLORS.length],
          targetHours: target,
          maxHours: max,
          hourlyRate: normalizeRate(entry.hourlyRate),
          email: normalizeEmail(entry.email),
          phone: normalizePhone(entry.phone),
          active: true,
          createdAt: now(),
        };
      });

      // Only people on the rota answer to a name: a row naming somebody
      // archived leaves its shift open, the same as a name nobody has.
      const byName = new Map(
        [...state.employees.filter((e) => e.active), ...createdEmployees].map((e) => [
          e.name.trim().toLowerCase(),
          e.id,
        ])
      );
      let openedShifts = 0;
      const createdShifts = shifts.map((entry) => {
        let assigneeId = entry.assigneeId ?? null;
        if (assigneeId) {
          // An id can only come from the existing team; the ids of
          // people created just above are minted here, so a file refers
          // to them by name.
          requireActiveEmployee(assigneeId);
        } else {
          const named = String(entry.assigneeName ?? '').trim().toLowerCase();
          if (named) {
            assigneeId = byName.get(named) ?? null;
            if (!assigneeId) openedShifts += 1;
          }
        }
        const shift = {
          id: uid('shf'),
          date: entry.date,
          start: entry.start,
          end: entry.end,
          role: String(entry.role ?? '').trim(),
          assigneeId,
          note: String(entry.note ?? '').trim(),
          breakMinutes: normalizeBreak(entry.breakMinutes),
          createdAt: now(),
        };
        assertValidShift(shift);
        return shift;
      });

      const known = new Set((state.settings.roles ?? []).map((r) => r.name.toLowerCase()));
      const addedRoles = [];
      for (const label of [
        ...roles,
        ...createdEmployees.map((e) => e.role),
        ...createdShifts.map((s) => s.role),
      ]) {
        const name = String(label ?? '').trim();
        if (!name || known.has(name.toLowerCase())) continue;
        known.add(name.toLowerCase());
        addedRoles.push({ id: uid('role'), name, color: null });
      }

      const previousAvailability = { ...state.availability };
      state.employees = [...state.employees, ...createdEmployees];
      for (const employee of createdEmployees) {
        state.availability[employee.id] = defaultAvailability();
      }
      state.shifts = [...state.shifts, ...createdShifts];
      if (addedRoles.length > 0) {
        state.settings = {
          ...state.settings,
          roles: [...(state.settings.roles ?? []), ...addedRoles].sort((a, b) =>
            a.name.localeCompare(b.name)
          ),
        };
      }
      await persist('employees', 'availability', 'shifts', 'settings');
      notify();

      const employeeIds = new Set(createdEmployees.map((e) => e.id));
      const shiftIds = new Set(createdShifts.map((s) => s.id));
      const roleIds = new Set(addedRoles.map((r) => r.id));
      return {
        employeesAdded: createdEmployees.length,
        shiftsAdded: createdShifts.length,
        rolesAdded: addedRoles.length,
        openedShifts,
        undo: registerUndo(async () => {
          state.employees = state.employees.filter((e) => !employeeIds.has(e.id));
          state.shifts = state.shifts.filter((s) => !shiftIds.has(s.id));
          for (const id of employeeIds) {
            if (previousAvailability[id] === undefined) delete state.availability[id];
            else state.availability[id] = previousAvailability[id];
          }
          state.settings = {
            ...state.settings,
            roles: (state.settings.roles ?? []).filter((r) => !roleIds.has(r.id)),
          };
          await persist('employees', 'availability', 'shifts', 'settings');
        }),
      };
    },

    // ---- Backup import ---------------------------------------------------

    /**
     * Replaces every collection with the contents of a validated backup.
     * Settings from the file are applied except the share-site pointer,
     * which stays with the account it belongs to; onboarding never
     * re-triggers after an import.
     */
    async importData(data, { reason = 'import' } = {}) {
      const errors = validateBackup(data);
      if (errors.length > 0) throw new Error(errors[0]);
      await snapshotBefore(reason);
      lastUndo = null; // restoring records into a replaced dataset would corrupt it
      for (const c of DATA_COLLECTIONS) state[c] = data[c];
      const { shareSite, ...imported } = data.settings ?? {};
      state.settings = {
        ...DEFAULT_SETTINGS,
        ...imported,
        onboarded: true,
        shareSite: state.settings.shareSite ?? null,
      };
      // Backups from before managed roles get theirs derived on the spot.
      if (imported.roles === undefined) {
        state.settings = { ...state.settings, roles: deriveRoles(state) };
      }
      await persist(...COLLECTIONS);
      notify();
    },

    // ---- Sample data -----------------------------------------------------

    /**
     * Installs a sample dataset and flags it, so the shell can show a
     * persistent "sample data" banner with a one-tap wipe. Also marks
     * onboarding as done.
     */
    async loadSampleData(dataset) {
      await snapshotBefore('sample');
      lastUndo = null;
      for (const c of DATA_COLLECTIONS) {
        if (dataset[c] !== undefined) state[c] = dataset[c];
      }
      state.settings = {
        ...state.settings,
        sampleData: true,
        onboarded: true,
        ...(dataset.coverage !== undefined ? { coverage: dataset.coverage } : {}),
        ...(dataset.roles !== undefined ? { roles: dataset.roles } : {}),
      };
      await persist(...COLLECTIONS);
      notify();
    },

    /** Removes every record so the user can start from scratch. */
    async wipeSampleData() {
      await snapshotBefore('wipe');
      lastUndo = null;
      state.employees = [];
      state.shifts = [];
      state.availability = {};
      state.swaps = [];
      state.attendance = {};
      state.settings = { ...state.settings, sampleData: false, coverage: [], roles: [] };
      await persist(...COLLECTIONS);
      notify();
    },
  };
}
