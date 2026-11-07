import { describe, it, expect } from 'vitest';
import {
  applySwap,
  createSwapRequest,
  evaluateSwap,
  resolveSwap,
  SWAP_STATUS,
} from '../src/core/swaps.js';
import { defaultAvailability } from '../src/core/scheduling.js';

const shift = (overrides = {}) => ({
  id: 's1',
  date: '2026-08-04',
  start: '09:00',
  end: '17:00',
  role: 'Floor',
  assigneeId: 'emp1',
  ...overrides,
});

describe('createSwapRequest', () => {
  it('creates a pending request with a shift snapshot', () => {
    const swap = createSwapRequest({ shift: shift(), toEmployeeId: 'emp2', reason: 'Trip', id: 'w1' });
    expect(swap.status).toBe(SWAP_STATUS.PENDING);
    expect(swap.fromEmployeeId).toBe('emp1');
    expect(swap.toEmployeeId).toBe('emp2');
    expect(swap.shiftSnapshot).toEqual({ date: '2026-08-04', start: '09:00', end: '17:00', role: 'Floor' });
  });

  it('rejects unassigned shifts and self-swaps', () => {
    expect(() => createSwapRequest({ shift: shift({ assigneeId: null }), toEmployeeId: 'emp2' })).toThrow();
    expect(() => createSwapRequest({ shift: shift(), toEmployeeId: 'emp1' })).toThrow();
  });
});

describe('evaluateSwap', () => {
  it('is clean when the target is free and available', () => {
    const result = evaluateSwap({
      shift: shift(),
      toEmployeeId: 'emp2',
      shifts: [shift()],
      availability: { emp2: defaultAvailability() },
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('warns when the receiving employee would exceed their weekly max', () => {
    const existing = shift({ id: 's2', date: '2026-08-03', assigneeId: 'emp2' }); // 8h Monday
    const result = evaluateSwap({
      shift: shift(), // 8h Tuesday, same week
      toEmployeeId: 'emp2',
      shifts: [shift(), existing],
      availability: { emp2: defaultAvailability() },
      employees: [{ id: 'emp2', name: 'Liam', maxHours: 10 }],
    });
    expect(result.ok).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/over their 10h max/);
  });

  it('warns when approving would hand over attendance already recorded', () => {
    // Nothing expires a pending request, so the shift it names can be
    // worked and clocked before anybody reviews it. Approving reassigns
    // the shift, and the record is keyed by shift, so the clock times and
    // the pay they produce go with it.
    const result = evaluateSwap({
      shift: shift(),
      toEmployeeId: 'emp2',
      shifts: [shift()],
      availability: { emp2: defaultAvailability() },
      employees: [{ id: 'emp2', name: 'Liam' }],
      attendance: { s1: { status: 'late', clockIn: '09:45', clockOut: '17:00' } },
    });
    expect(result.ok).toBe(false);
    expect(result.warnings).toContain(
      'The attendance already recorded for this shift becomes Liam’s.'
    );

    // A shift nobody has taken attendance for says nothing about it.
    const clean = evaluateSwap({
      shift: shift(),
      toEmployeeId: 'emp2',
      shifts: [shift()],
      availability: { emp2: defaultAvailability() },
      attendance: {},
    });
    expect(clean.warnings).toEqual([]);
  });

  it('warns about conflicts and unavailability', () => {
    const busy = shift({ id: 's2', assigneeId: 'emp2', start: '10:00', end: '12:00' });
    const offAllWeek = { days: Array.from({ length: 7 }, () => ({ off: true, start: '09:00', end: '17:00' })) };
    const result = evaluateSwap({
      shift: shift(),
      toEmployeeId: 'emp2',
      shifts: [shift(), busy],
      availability: { emp2: offAllWeek },
    });
    expect(result.ok).toBe(false);
    expect(result.warnings).toHaveLength(2);
  });
});

describe('resolveSwap', () => {
  const pending = () => createSwapRequest({ shift: shift(), toEmployeeId: 'emp2', id: 'w1' });

  it('resolves a pending swap without mutating the original', () => {
    const swap = pending();
    const resolved = resolveSwap(swap, SWAP_STATUS.APPROVED, 't');
    expect(resolved.status).toBe(SWAP_STATUS.APPROVED);
    expect(resolved.resolvedAt).toBe('t');
    expect(swap.status).toBe(SWAP_STATUS.PENDING);
  });

  it('refuses to resolve twice or to a bogus status', () => {
    const approved = resolveSwap(pending(), SWAP_STATUS.APPROVED);
    expect(() => resolveSwap(approved, SWAP_STATUS.DECLINED)).toThrow();
    expect(() => resolveSwap(pending(), 'pending')).toThrow();
  });
});

describe('applySwap', () => {
  it('reassigns the shift to the target employee', () => {
    const swap = createSwapRequest({ shift: shift(), toEmployeeId: 'emp2', id: 'w1' });
    const next = applySwap(swap, [shift(), shift({ id: 's2' })]);
    expect(next.find((s) => s.id === 's1').assigneeId).toBe('emp2');
    expect(next.find((s) => s.id === 's2').assigneeId).toBe('emp1');
  });

  it('fails when the shift was deleted or reassigned meanwhile', () => {
    const swap = createSwapRequest({ shift: shift(), toEmployeeId: 'emp2', id: 'w1' });
    expect(() => applySwap(swap, [])).toThrow(/no longer exists/);
    expect(() => applySwap(swap, [shift({ assigneeId: 'emp3' })])).toThrow(/reassigned/);
  });
});
