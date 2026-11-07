/**
 * Sample dataset for "explore with sample data": a believable seed-stage
 * startup, shaped exactly like an export so store.importAll() installs it -
 * and wipes it - through the normal, already-hardened path.
 */

import { uid } from './util.js';

export function sampleDataset() {
  // Named ahead of the awards below, which draw from it.
  const planId = uid();
  const classes = {
    common: { id: uid(), name: 'Common Stock', kind: 'common', authorized: 10_000_000, pricePerShare: 0.0001, liquidationMultiple: 0, participating: false, seniority: 0, createdAt: Date.now() },
    seed: { id: uid(), name: 'Series Seed Preferred', kind: 'preferred', authorized: 2_500_000, pricePerShare: 0.85, liquidationMultiple: 1, participating: false, seniority: 1, createdAt: Date.now() },
  };
  const holders = {
    ada: { id: uid(), name: 'Ada Chen', email: 'ada@acmerobotics.example', kind: 'founder', createdAt: Date.now() },
    grace: { id: uid(), name: 'Grace Okafor', email: 'grace@acmerobotics.example', kind: 'founder', createdAt: Date.now() },
    sam: { id: uid(), name: 'Sam Rivera', email: 'sam@acmerobotics.example', kind: 'employee', createdAt: Date.now() },
    priya: { id: uid(), name: 'Priya Nair', email: 'priya@acmerobotics.example', kind: 'employee', createdAt: Date.now() },
    lin: { id: uid(), name: 'Dr. Lin Wu', email: 'lin@example.com', kind: 'advisor', createdAt: Date.now() },
    nova: { id: uid(), name: 'Nova Ventures', email: 'deals@novavc.example', kind: 'investor', createdAt: Date.now() },
    beacon: { id: uid(), name: 'Beacon Angels', email: 'invest@beacon.example', kind: 'investor', createdAt: Date.now() },
    harbor: { id: uid(), name: 'Harbor Credit', email: 'notices@harborcredit.example', kind: 'entity', createdAt: Date.now() },
  };

  // Named ahead of the list: Sam's exercise certificate below points back at it.
  const opt1 = uid();
  const securities = [
    // Founder common at incorporation, reverse-vesting 4 years with a 1-year cliff.
    { id: uid(), kind: 'shares', label: 'CS-1', stakeholderId: holders.ada.id, classId: classes.common.id, quantity: 3_800_000, pricePerShare: 0.0001, date: '2023-05-20', vestingMonths: 48, cliffMonths: 12, vestingStart: '2023-05-20', filed83b: '2023-06-02', createdAt: Date.now() },
    { id: uid(), kind: 'shares', label: 'CS-2', stakeholderId: holders.grace.id, classId: classes.common.id, quantity: 3_400_000, pricePerShare: 0.0001, date: '2023-05-20', vestingMonths: 48, cliffMonths: 12, vestingStart: '2023-08-01', filed83b: '2023-06-05', createdAt: Date.now() },
    // Seed round, priced at $0.85.
    { id: uid(), kind: 'shares', label: 'SS-1', stakeholderId: holders.nova.id, classId: classes.seed.id, quantity: 1_470_588, pricePerShare: 0.85, date: '2024-06-10', createdAt: Date.now() },
    { id: uid(), kind: 'shares', label: 'SS-2', stakeholderId: holders.beacon.id, classId: classes.seed.id, quantity: 588_235, pricePerShare: 0.85, date: '2024-06-10', createdAt: Date.now() },
    // Team option grants out of the 1.5M pool (4y monthly, 1y cliff). Sam's is
    // an ISO with a ten-year term, and 10,000 of it has been exercised into
    // CS-3 - which is what gives the reports a Form 3921 row to show.
    { id: opt1, kind: 'option', label: 'OPT-1', stakeholderId: holders.sam.id, planId, quantity: 120_000, strike: 0.09, grantDate: '2024-07-01', date: '2024-07-01', vestingMonths: 48, cliffMonths: 12, exercised: 10_000, expires: '2034-07-01', optionType: 'iso', createdAt: Date.now() },
    { id: uid(), kind: 'shares', label: 'CS-3', stakeholderId: holders.sam.id, classId: classes.common.id, quantity: 10_000, pricePerShare: 0.09, date: '2026-01-20', fromOptionId: opt1, createdAt: Date.now() },
    { id: uid(), kind: 'option', label: 'OPT-2', stakeholderId: holders.priya.id, planId, quantity: 90_000, strike: 0.09, grantDate: '2024-09-15', date: '2024-09-15', vestingMonths: 48, cliffMonths: 12, exercised: 0, createdAt: Date.now() },
    { id: uid(), kind: 'option', label: 'OPT-3', stakeholderId: holders.lin.id, planId, quantity: 50_000, strike: 0.09, grantDate: '2024-08-01', date: '2024-08-01', vestingMonths: 24, cliffMonths: 0, exercised: 0, createdAt: Date.now() },
    // Venture-debt warrant from the equipment line - dilutive, but not the pool's problem.
    { id: uid(), kind: 'warrant', label: 'WNT-1', stakeholderId: holders.harbor.id, classId: classes.seed.id, quantity: 60_000, strike: 0.85, date: '2025-03-18', expires: '2035-03-18', createdAt: Date.now() },
    // Bridge financing ahead of the A.
    { id: uid(), kind: 'safe', label: 'SAFE-1', stakeholderId: holders.beacon.id, principal: 250_000, valuationCap: 8_000_000, discount: 20, safeType: 'post', date: '2025-11-05', createdAt: Date.now() },
    { id: uid(), kind: 'note', label: 'CN-1', stakeholderId: holders.nova.id, principal: 150_000, valuationCap: 10_000_000, discount: 15, interestRate: 8, date: '2026-02-01', maturityDate: '2027-08-01', createdAt: Date.now() },
  ];

  const now = Date.now();
  const activity = [
    { id: uid(), at: now - 2 * 86400e3, text: 'Convertible note CN-1 issued to Nova Ventures ($150,000)', icon: 'file-text' },
    { id: uid(), at: now - 8 * 86400e3, text: 'Sam Rivera exercised 10,000 options from OPT-1 into CS-3', icon: 'check' },
    { id: uid(), at: now - 12 * 86400e3, text: 'SAFE-1 issued to Beacon Angels ($250,000, $8M cap)', icon: 'file-text' },
    { id: uid(), at: now - 30 * 86400e3, text: 'Option grant OPT-2 issued to Priya Nair (90,000 shares)', icon: 'clock' },
    { id: uid(), at: now - 45 * 86400e3, text: 'Series Seed closed: $1.75M at $0.85 per share', icon: 'trending-up' },
  ];

  return {
    company: {
      name: 'Acme Robotics, Inc.',
      entityType: 'C-Corp',
      jurisdiction: 'Delaware',
      incorporated: '2023-05-15',
      /* One plan, adopted with the seed round and reserved that day, so the
         founders' 2023 table has no pool on it. The pool fields carry the
         plan's aggregate, as the store keeps them. */
      plans: [{
        id: planId, name: '2024 Equity Incentive Plan', adopted: '2024-06-10', classId: classes.common.id,
        status: 'active', awardTypes: ['option', 'rsu'], reserve: 1_500_000,
        reserveHistory: [{ date: '2024-06-10', before: 0, after: 1_500_000, seq: 1, kind: 'adoption' }],
        recycling: { cancellation: 'return', expiration: 'return', exercise: 'retire', settlement: 'retire', repurchase: 'retire', transfer: 'retire' },
        createdAt: Date.now(),
      }],
      poolAuthorized: 1_500_000,
      poolHistory: [{ date: '2024-06-10', before: 0, after: 1_500_000, seq: 1 }],
      valuations: [
        { id: uid(), date: '2025-07-15', fmvPerShare: 0.31, note: 'Annual refresh 409A' },
        { id: uid(), date: '2024-07-01', fmvPerShare: 0.09, note: 'Post-Seed 409A' },
        { id: uid(), date: '2023-06-01', fmvPerShare: 0.02, note: 'Formation 409A' },
      ],
      // What the Reports view values options with and measures Rule 701 against.
      reporting: { volatility: 65, riskFreeRate: 4.2, expectedTermYears: 0, attribution: 'straight', fiscalYearEnd: 12, totalAssets: 2_100_000 },
    },
    classes: [classes.common, classes.seed],
    stakeholders: Object.values(holders),
    securities,
    scenarios: [{
      id: uid(), name: 'Series A (draft)', preMoney: 18_000_000, investment: 5_000_000, poolPct: 0.1, updatedAt: now,
    }],
    activity,
  };
}

/** Remove the sample dataset and return to a clean slate. */
export async function wipeSampleData(store) {
  await store.importAll({}, {
    label: 'Before wiping sample data',
    /* Named for what it is in the permanent history. Left to importAll's
       default, the wipe was journaled as "Replace all data" beside the
       "Load sample data" entry it undoes. */
    operation: 'wipeSampleData',
    settings: { sampleData: false, onboarded: false },
  });
}
