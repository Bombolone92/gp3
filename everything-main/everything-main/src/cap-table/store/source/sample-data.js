// Fictional, deterministic marketing data. Used only by the local asset renderer.
// No account, network storage, personal contact information or production writes.
export function marketingData() {
  const createdAt = Date.parse('2026-09-05T12:00:00Z');
  return {
    company: {
      name: 'Northstar Robotics', entityType: 'C-Corp', jurisdiction: 'Delaware',
      currency: 'USD', incorporated: '2023-05-15', poolAuthorized: 1_000_000,
      valuations: [{ id: 'v1', date: '2026-07-01', fmvPerShare: 0.42, note: 'Annual valuation' }],
      reporting: { volatility: 65, riskFreeRate: 4.2, expectedTermYears: 0, attribution: 'straight', fiscalYearEnd: 12, totalAssets: 2_500_000 },
    },
    classes: [
      { id: 'common', name: 'Common Stock', kind: 'common', authorized: 12_000_000, pricePerShare: 0.0001, liquidationMultiple: 0, participating: false, seniority: 0, createdAt },
      { id: 'seed', name: 'Seed Preferred', kind: 'preferred', authorized: 3_000_000, pricePerShare: 1.2, liquidationMultiple: 1, participating: false, seniority: 1, createdAt },
    ],
    stakeholders: [
      { id: 'ada', name: 'Ada Chen', kind: 'founder', createdAt },
      { id: 'grace', name: 'Grace Okafor', kind: 'founder', createdAt },
      { id: 'nova', name: 'Nova Ventures', kind: 'investor', createdAt },
      { id: 'beacon', name: 'Beacon Angels', kind: 'investor', createdAt },
      { id: 'sam', name: 'Sam Rivera', kind: 'employee', createdAt },
      { id: 'priya', name: 'Priya Nair', kind: 'employee', createdAt },
    ],
    securities: [
      { id: 'cs1', kind: 'shares', label: 'CS-1', stakeholderId: 'ada', classId: 'common', quantity: 4_000_000, pricePerShare: 0.0001, date: '2023-05-20', vestingMonths: 48, cliffMonths: 12, vestingStart: '2023-05-20', filed83b: '2023-06-01', createdAt },
      { id: 'cs2', kind: 'shares', label: 'CS-2', stakeholderId: 'grace', classId: 'common', quantity: 3_000_000, pricePerShare: 0.0001, date: '2023-05-20', vestingMonths: 48, cliffMonths: 12, vestingStart: '2023-05-20', filed83b: '2023-06-01', createdAt },
      { id: 'ss1', kind: 'shares', label: 'SS-1', stakeholderId: 'nova', classId: 'seed', quantity: 1_500_000, pricePerShare: 1.2, date: '2024-06-10', createdAt },
      { id: 'ss2', kind: 'shares', label: 'SS-2', stakeholderId: 'beacon', classId: 'seed', quantity: 500_000, pricePerShare: 1.2, date: '2024-06-10', createdAt },
      { id: 'opt1', kind: 'option', label: 'OPT-1', stakeholderId: 'sam', quantity: 250_000, strike: 0.18, date: '2025-03-01', grantDate: '2025-03-01', vestingMonths: 48, cliffMonths: 12, optionType: 'iso', expires: '2035-03-01', exercised: 0, createdAt },
      { id: 'opt2', kind: 'option', label: 'OPT-2', stakeholderId: 'priya', quantity: 150_000, strike: 0.18, date: '2025-06-01', grantDate: '2025-06-01', vestingMonths: 48, cliffMonths: 12, optionType: 'iso', expires: '2035-06-01', exercised: 0, createdAt },
      { id: 'safe1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'beacon', principal: 250_000, valuationCap: 10_000_000, discount: 20, safeType: 'post', date: '2026-03-01', createdAt },
      { id: 'note1', kind: 'note', label: 'CN-1', stakeholderId: 'nova', principal: 150_000, valuationCap: 12_000_000, discount: 15, interestRate: 8, date: '2026-02-01', maturityDate: '2027-08-01', createdAt },
    ],
    scenarios: [{ id: 'series-a', name: 'Series A', preMoney: 18_000_000, investment: 5_000_000, poolPct: 0.1, updatedAt: createdAt }],
    exits: [{ id: 'acquisition', name: 'Acquisition', exitValue: 60_000_000, unvestedOptions: 'participate', changeOfControl: false, updatedAt: createdAt }],
    hiring: [
      { id: 'h1', role: 'Senior engineer', headcount: 3, sizeMode: 'shares', shares: 100_000, startMonth: '2026-10' },
      { id: 'h2', role: 'Product designer', headcount: 2, sizeMode: 'shares', shares: 75_000, startMonth: '2027-01' },
      { id: 'h3', role: 'Head of sales', headcount: 1, sizeMode: 'shares', shares: 200_000, startMonth: '2027-03' },
      { id: 'h4', role: 'Software engineer', headcount: 2, sizeMode: 'shares', shares: 75_000, startMonth: '2027-06' },
    ],
    activity: [],
  };
}
