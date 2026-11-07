/**
 * Leasing logic shared by listings, applicants and renewals. The functions
 * that take plain data are pure and unit tested.
 */
import { addDays, diffDays } from '../../core/dates.js';
import { daysLeft, effectiveEnd, leaseStatus, monthlyRent, renewalStatus } from '../../core/leases.js';

/**
 * Units that need a tenant: vacant today (and not already leased to someone
 * moving in), or occupied by a lease that is ending (move-out recorded or
 * renewal declined).
 * Returns [{ unit, property, lease, state: 'vacant'|'leaving', availableFrom,
 *   daysVacant, rent, listed, applicants }].
 */
export function listingCandidates({ units, properties, leases, applicants = [], today }) {
  const propsById = new Map(properties.map((p) => [p.id, p]));
  const byUnit = new Map();
  for (const l of leases) {
    if (l.draft) continue;
    if (!byUnit.has(l.unitId)) byUnit.set(l.unitId, []);
    byUnit.get(l.unitId).push(l);
  }
  const openApplicants = new Map();
  for (const a of applicants) {
    if (!a.unitId || !['new', 'screening', 'approved'].includes(a.status)) continue;
    openApplicants.set(a.unitId, (openApplicants.get(a.unitId) || 0) + 1);
  }
  const out = [];
  for (const unit of units) {
    const property = propsById.get(unit.propertyId);
    if (!property || property.active === false) continue;
    const ls = byUnit.get(unit.id) || [];
    const active = ls.find((l) => leaseStatus(l, today) === 'active');
    const future = ls.find((l) => leaseStatus(l, today) === 'future');
    let state = null;
    let availableFrom = today;
    let daysVacant = null;
    if (!active) {
      if (future) continue; // already leased to someone moving in
      state = 'vacant';
      const ends = ls.map((l) => effectiveEnd(l) || l.end).filter((d) => d && d < today).sort();
      const lastEnd = ends[ends.length - 1];
      if (lastEnd) daysVacant = diffDays(lastEnd, today);
    } else {
      const end = effectiveEnd(active);
      const leaving = active.moveOut?.date || renewalStatus(active) === 'declined';
      if (!leaving || future) continue;
      state = 'leaving';
      availableFrom = addDays(end || active.end || today, 1);
    }
    if (unit.listing?.available && unit.listing.available > availableFrom) availableFrom = unit.listing.available;
    out.push({
      unit,
      property,
      lease: active || null,
      state,
      availableFrom,
      daysVacant,
      rent: unit.listing?.rent || unit.marketRent || 0,
      listed: !!unit.listing?.listed,
      applicants: openApplicants.get(unit.id) || 0,
    });
  }
  return out;
}

export function listingStats(candidates) {
  const vacant = candidates.filter((c) => c.state === 'vacant');
  const withDays = vacant.filter((c) => c.daysVacant !== null);
  return {
    vacant: vacant.length,
    leaving: candidates.length - vacant.length,
    listed: candidates.filter((c) => c.listed).length,
    avgDaysVacant: withDays.length ? Math.round(withDays.reduce((s, c) => s + c.daysVacant, 0) / withDays.length) : null,
    rentLost: vacant.reduce((s, c) => s + (c.rent || 0), 0),
  };
}

/** Income-to-rent ratio, e.g. 3.2, or null when either is missing. */
export function incomeRatio(income, rent) {
  if (!income || !rent) return null;
  return Math.round((income / rent) * 10) / 10;
}

/** good (3x or more), fair (2.5x to 3x), low (under 2.5x) */
export function ratioTone(ratio) {
  if (ratio === null) return null;
  return ratio >= 3 ? 'good' : ratio >= 2.5 ? 'fair' : 'low';
}

export const SCREENING_ITEMS = [
  { id: 'creditChecked', label: 'Credit check' },
  { id: 'backgroundChecked', label: 'Background check' },
  { id: 'incomeVerified', label: 'Income verified' },
  { id: 'referencesChecked', label: 'References checked' },
];

export function screeningProgress(applicant) {
  const s = applicant.screening || {};
  return { done: SCREENING_ITEMS.filter((i) => s[i.id]).length, total: SCREENING_ITEMS.length };
}

export const BOARD_STATUSES = ['new', 'screening', 'approved', 'rejected'];

export const RENEWAL_COLUMNS = ['not-started', 'offered', 'accepted', 'declined'];

/**
 * Leases that need a renewal decision, bucketed by renewal status:
 *   { columns: { 'not-started': [...], offered, accepted, declined },
 *     monthToMonth: [...] }
 * Rows: { lease, daysLeft, rent, offerRent, expiringSoon, renewed }.
 * A lease with a move-out recorded counts as moving out; a lease that
 * already has a renewal lease counts as renewing.
 */
export function renewalBuckets(leases, today, { windowDays = 120, noticeDays = 60 } = {}) {
  const renewedBy = new Map();
  // A draft renewal is not a decision yet: the lease stays where it is.
  for (const l of leases) if (l.renewsLeaseId && !l.draft) renewedBy.set(l.renewsLeaseId, l);
  const columns = Object.fromEntries(RENEWAL_COLUMNS.map((c) => [c, []]));
  const monthToMonth = [];
  for (const lease of leases) {
    if (lease.draft || leaseStatus(lease, today) !== 'active') continue;
    const rent = monthlyRent(lease, today);
    const renewal = renewedBy.get(lease.id) || null;
    const rolledOver = lease.type === 'at-will' || (lease.type === 'fixed-rollover' && lease.end && lease.end < today);
    if (rolledOver && !lease.moveOut?.date) {
      monthToMonth.push({ lease, rent, since: lease.type === 'at-will' ? lease.start : addDays(lease.end, 1) });
      continue;
    }
    const end = lease.moveOut?.date || lease.end;
    if (!end || end < today) continue;
    const left = lease.moveOut?.date ? diffDays(today, lease.moveOut.date) : daysLeft(lease, today);
    if (left === null || left > windowDays) continue;
    let status = renewalStatus(lease);
    if (lease.moveOut?.date) status = 'declined';
    else if (renewal) status = 'accepted';
    columns[status]?.push({ lease, daysLeft: left, rent, offerRent: lease.renewal?.offerRent || null, expiringSoon: left <= noticeDays, renewed: renewal });
  }
  for (const c of RENEWAL_COLUMNS) columns[c].sort((a, b) => a.daysLeft - b.daysLeft);
  monthToMonth.sort((a, b) => (a.since < b.since ? -1 : 1));
  return { columns, monthToMonth };
}

/** Rent after a percentage increase, rounded to the nearest dollar. */
export function raiseRent(cents, pct) {
  return Math.round((cents * (1 + (Number(pct) || 0) / 100)) / 100) * 100;
}

/** Plain-text listing for pasting into listing sites. */
export function listingText({ unit, property, rent, availableFrom }, { money, date }) {
  const a = property.address || {};
  const lines = [
    `${property.name}${property.singleUnit ? '' : `, unit ${unit.name}`}`,
    [a.street, a.city, a.state].filter(Boolean).join(', '),
    '',
    [unit.beds ? `${unit.beds} bed` : unit.beds === 0 ? 'Studio or open plan' : '', unit.baths ? `${unit.baths} bath` : '', unit.sqft ? `${unit.sqft} sq ft` : ''].filter(Boolean).join(' · '),
    `Rent: ${money(rent)} per month`,
    `Available: ${availableFrom ? date(availableFrom) : 'Now'}`,
  ];
  const desc = unit.listing?.description || property.description;
  if (desc) lines.push('', desc);
  if (property.amenities?.length) lines.push('', `Amenities: ${property.amenities.join(', ')}`);
  return lines.join('\n');
}
