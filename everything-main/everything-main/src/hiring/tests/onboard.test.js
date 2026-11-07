import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ONBOARDING_TASKS,
  DEFAULT_TEMPLATE,
  buildOnboardingPlan,
  dueOnboardingTasks,
  groupTasks,
  hireStartDate,
  normalizeOnboardingTemplates,
  offsetLabel,
  offsetShort,
  onboardingProgress,
  onboardingTemplates,
  taskDueDate,
  templateForJob,
} from '../src/core/onboard.js';

describe('buildOnboardingPlan', () => {
  it('creates one open task per template entry, with unique ids', () => {
    const plan = buildOnboardingPlan();
    expect(plan).toHaveLength(DEFAULT_ONBOARDING_TASKS.length);
    expect(plan.every((t) => t.done === false)).toBe(true);
    expect(new Set(plan.map((t) => t.id)).size).toBe(plan.length);
  });

  it('accepts an injectable id factory', () => {
    let n = 0;
    const plan = buildOnboardingPlan(null, () => `t${n++}`);
    expect(plan[0].id).toBe('t0');
  });

  it('stamps a custom template, keeping its order, categories, and offsets', () => {
    const template = {
      id: 'sales',
      name: 'Sales onboarding',
      tasks: [
        { title: 'CRM access', category: 'IT & access', offsetDays: -2 },
        { title: 'Territory handover', category: 'Team' },
      ],
    };
    let n = 0;
    const plan = buildOnboardingPlan(template, () => `t${n++}`);
    expect(plan).toEqual([
      { id: 't0', title: 'CRM access', category: 'IT & access', offsetDays: -2, done: false },
      { id: 't1', title: 'Territory handover', category: 'Team', done: false },
    ]);
  });

  it('falls back to the shipped tasks for an empty template', () => {
    expect(buildOnboardingPlan({ id: 'x', name: 'Empty', tasks: [] })).toHaveLength(DEFAULT_ONBOARDING_TASKS.length);
  });
});

describe('onboardingProgress', () => {
  it('computes done, total, and a rounded percentage', () => {
    const tasks = [{ done: true }, { done: true }, { done: false }];
    expect(onboardingProgress(tasks)).toEqual({ done: 2, total: 3, pct: 67 });
  });

  it('is all zeroes for an empty or missing plan', () => {
    expect(onboardingProgress([])).toEqual({ done: 0, total: 0, pct: 0 });
    expect(onboardingProgress(undefined)).toEqual({ done: 0, total: 0, pct: 0 });
  });
});

describe('groupTasks', () => {
  it('groups by category in the order the plan lists them', () => {
    // A plan is stamped from a template, so first appearance *is* the
    // template's order — and a custom template's first category must not
    // be reshuffled under the shipped one's.
    const tasks = [
      { id: '1', title: 'A', category: 'Team' },
      { id: '2', title: 'B', category: 'Paperwork' },
      { id: '3', title: 'C', category: 'Custom' },
      { id: '4', title: 'D', category: 'Paperwork' },
    ];
    const groups = groupTasks(tasks);
    expect(groups.map(([name]) => name)).toEqual(['Team', 'Paperwork', 'Custom']);
    expect(groups[1][1].map((t) => t.id)).toEqual(['2', '4']);
  });

  it('buckets uncategorized tasks under Other', () => {
    const groups = groupTasks([{ id: '1', title: 'A' }]);
    expect(groups[0][0]).toBe('Other');
  });
});

describe('onboarding templates', () => {
  const sales = {
    id: 'sales',
    name: 'Sales onboarding',
    tasks: [{ title: 'CRM access', category: 'IT & access', offsetDays: -2 }],
    jobIds: ['job_ae'],
    departments: ['Go-to-market'],
  };

  it('cleans stored templates and drops what cannot be used', () => {
    expect(normalizeOnboardingTemplates([sales])).toEqual([sales]);
    expect(normalizeOnboardingTemplates(null)).toEqual([]);
    expect(normalizeOnboardingTemplates([{ ...sales, id: '../x' }])).toEqual([]);
    expect(normalizeOnboardingTemplates([{ ...sales, name: '  ' }])).toEqual([]);
    expect(normalizeOnboardingTemplates([{ ...sales, tasks: [{ title: '  ' }] }])).toEqual([]);
    // An unsafe job id would be matched against a real one; a fractional
    // offset is not a day.
    const [clean] = normalizeOnboardingTemplates([
      { ...sales, jobIds: ['job_ae', '../x'], tasks: [{ title: 'X', offsetDays: 1.5 }, { title: 'Y', offsetDays: -900 }] },
    ]);
    expect(clean.jobIds).toEqual(['job_ae']);
    expect(clean.tasks).toEqual([
      { title: 'X', category: 'Other' },
      { title: 'Y', category: 'Other' },
    ]);
  });

  it('falls back to the shipped template when an account has none', () => {
    expect(onboardingTemplates({})).toEqual([DEFAULT_TEMPLATE]);
    expect(onboardingTemplates({ onboardingTemplates: [] })[0].name).toBe('Standard onboarding');
    expect(onboardingTemplates({ onboardingTemplates: [sales] })).toEqual([sales]);
  });

  it('picks a template by job, then department, then the general one', () => {
    const general = { id: 'gen', name: 'General', tasks: [{ title: 'Anything' }], jobIds: [], departments: [] };
    const settings = { onboardingTemplates: [sales, general] };
    expect(templateForJob(settings, { id: 'job_ae', department: 'Engineering' }).id).toBe('sales');
    expect(templateForJob(settings, { id: 'job_x', department: 'go-to-market' }).id).toBe('sales');
    expect(templateForJob(settings, { id: 'job_x', department: 'Engineering' }).id).toBe('gen');
    expect(templateForJob(settings, null).id).toBe('gen');
    // With no general template, the first one stands rather than nothing.
    expect(templateForJob({ onboardingTemplates: [sales] }, { id: 'job_x' }).id).toBe('sales');
    expect(templateForJob({}, { id: 'job_x' }).id).toBe('default');
  });
});

describe('task due dates', () => {
  it('counts days either side of the start date', () => {
    expect(taskDueDate({ offsetDays: -7 }, '2026-09-14')).toBe('2026-09-07');
    expect(taskDueDate({ offsetDays: 0 }, '2026-09-14')).toBe('2026-09-14');
    expect(taskDueDate({ offsetDays: 7 }, '2026-09-14')).toBe('2026-09-21');
  });

  it('has no date without an offset or a start date', () => {
    expect(taskDueDate({}, '2026-09-14')).toBeNull();
    expect(taskDueDate({ offsetDays: -1 }, '')).toBeNull();
    expect(taskDueDate({ offsetDays: -1 }, 'soon')).toBeNull();
  });

  it('reads an offset in words, long and short', () => {
    expect(offsetShort(-7)).toBe('7d before');
    expect(offsetShort(0)).toBe('Start date');
    expect(offsetShort(3)).toBe('3d after');
    expect(offsetShort(null)).toBe('No date');
    expect(offsetLabel(-7)).toBe('7 days before the start date');
    expect(offsetLabel(-1)).toBe('1 day before the start date');
    expect(offsetLabel(0)).toBe('On the start date');
    expect(offsetLabel(3)).toBe('3 days after the start date');
    expect(offsetLabel(undefined)).toBe('No date');
  });
});

describe('dueOnboardingTasks', () => {
  const NOW = new Date('2026-09-10T10:00:00');
  const state = (over = {}) => ({
    offers: [{ candidateId: 'c1', status: 'signed', startDate: '2026-09-14' }],
    onboarding: {
      c1: {
        tasks: [
          { id: 't1', title: 'Order laptop', offsetDays: -7, done: false },
          { id: 't2', title: 'Accounts', offsetDays: -3, done: false },
          { id: 't3', title: 'Buddy', offsetDays: -1, done: false },
          { id: 't4', title: '30/60/90', offsetDays: 7, done: false },
          { id: 't5', title: 'Payroll', done: false },
          { id: 't6', title: 'Contract', offsetDays: -7, done: true },
        ],
      },
    },
    ...over,
  });

  it('lists overdue and imminent tasks, soonest first', () => {
    // Overdue (t1), plus everything due inside the three-day window: t2 on
    // the 11th and t3 on the 13th. t4 is a fortnight out, t5 has no date.
    const due = dueOnboardingTasks(state(), { now: NOW });
    expect(due.map((d) => d.task.id)).toEqual(['t1', 't2', 't3']);
    expect(due[0]).toMatchObject({ candidateId: 'c1', dueDate: '2026-09-07', overdue: true });
    expect(due[1]).toMatchObject({ dueDate: '2026-09-11', overdue: false, daysLeft: 1 });
  });

  it('says nothing without a signed offer to date it from', () => {
    expect(dueOnboardingTasks(state({ offers: [] }), { now: NOW })).toEqual([]);
    expect(dueOnboardingTasks(state({ offers: [{ candidateId: 'c1', status: 'sent', startDate: '2026-09-14' }] }), { now: NOW })).toEqual([]);
  });

  it('widens with the window', () => {
    expect(dueOnboardingTasks(state(), { now: NOW, withinDays: 30 }).map((d) => d.task.id)).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('dates a re-signed hire against the latest signature, wherever it sits in storage', () => {
    // Terms redone after the first signature: the superseded offer is kept
    // as a record, and its January start must not date anything.
    const offers = [
      { candidateId: 'c1', status: 'signed', startDate: '2026-01-15', signedAt: '2026-01-02T09:00:00.000Z' },
      { candidateId: 'c1', status: 'signed', startDate: '2026-09-14', signedAt: '2026-08-20T09:00:00.000Z' },
    ];
    expect(dueOnboardingTasks(state({ offers }), { now: NOW }).map((d) => d.task.id)).toEqual(['t1', 't2', 't3']);
    // The same answer with the newer offer stored first.
    expect(dueOnboardingTasks(state({ offers: [...offers].reverse() }), { now: NOW }).map((d) => d.task.id)).toEqual([
      't1',
      't2',
      't3',
    ]);
  });
});

describe('hireStartDate', () => {
  it('reads the start date off the signed offer', () => {
    const offers = [{ candidateId: 'c1', status: 'signed', startDate: '2026-09-14' }];
    expect(hireStartDate(offers, 'c1')).toBe('2026-09-14');
  });

  it('ignores offers that were never signed, and other candidates', () => {
    const offers = [
      { candidateId: 'c1', status: 'sent', startDate: '2026-09-14' },
      { candidateId: 'c2', status: 'signed', startDate: '2026-10-01' },
    ];
    expect(hireStartDate(offers, 'c1')).toBeNull();
    expect(hireStartDate([], 'c1')).toBeNull();
    expect(hireStartDate(undefined, 'c1')).toBeNull();
  });

  it('takes the most recent signature when a candidate has more than one', () => {
    const older = { candidateId: 'c1', status: 'signed', startDate: '2026-01-15', signedAt: '2026-01-02T09:00:00.000Z' };
    const newer = { candidateId: 'c1', status: 'signed', startDate: '2026-09-14', signedAt: '2026-08-20T09:00:00.000Z' };
    expect(hireStartDate([older, newer], 'c1')).toBe('2026-09-14');
    expect(hireStartDate([newer, older], 'c1')).toBe('2026-09-14');
  });

  it('falls back to storage order when no signature timestamp was recorded', () => {
    const offers = [
      { candidateId: 'c1', status: 'signed', startDate: '2026-01-15' },
      { candidateId: 'c1', status: 'signed', startDate: '2026-09-14' },
    ];
    expect(hireStartDate(offers, 'c1')).toBe('2026-09-14');
  });
});
