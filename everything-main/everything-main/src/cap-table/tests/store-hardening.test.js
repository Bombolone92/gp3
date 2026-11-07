import { beforeEach, describe, expect, it } from 'vitest';
import { Store, ListFullError, MAX_STAKEHOLDERS } from '../src/lib/store.js';
import { certifiedByGrant, certifiedByRsu, fullyDiluted, grantExercised, modelRound, rsuSettled } from '../src/lib/captable.js';
import { puterBackend } from './helpers/puter-kv.js';

/**
 * Writes the forms never make but a backup or the API can: the store is the
 * last place they can be refused, and the sanitizer, written for stored
 * records, was reading them in.
 */

let store, holder, common;
beforeEach(async () => {
  puterBackend().install(); store = new Store(); await store.init();
  common = await store.addClass({ name: 'Common', kind: 'common' });
  holder = await store.addStakeholder({ name: 'Employee' });
});
const cert = (extra = {}) => store.addSecurity({
  kind: 'shares', stakeholderId: holder.id, classId: common.id, quantity: 100, pricePerShare: 1, date: '2024-02-01', ...extra,
});

describe('certificates and counters bound each other', () => {
  it('holds an exercise to the certificates already issued out of the grant', async () => {
    const grant = await store.addSecurity({
      kind: 'option', stakeholderId: holder.id, classId: common.id, quantity: 4800, strike: 1,
      date: '2024-01-01', vestingMonths: 48, cliffMonths: 12, earlyExercise: true,
    });
    // A certificate naming the grant is an exercise the counter never saw.
    await cert({ quantity: 2000, fromOptionId: grant.id });
    expect(grantExercised(store.security(grant.id))).toBe(2000);
    await expect(store.exerciseOption(grant.id, { quantity: 4800, date: '2024-03-01', classId: common.id }))
      .rejects.toThrow(/more than this grant has left to exercise/);
    await store.exerciseOption(grant.id, { quantity: 2800, date: '2024-03-01', classId: common.id });
    expect(certifiedByGrant(store.securities).get(grant.id)).toBe(4800);
    expect(grantExercised(store.security(grant.id))).toBe(4800);
    expect(fullyDiluted(store.securities, store.company)).toBe(4800);
    await expect(cert({ quantity: 1, date: '2024-04-01', fromOptionId: grant.id }))
      .rejects.toThrow(/holds 4,800 options, but 4,801 shares would be certified out of it/);
    expect(store.securities).toHaveLength(3);
  });

  it('holds a settlement to the certificates already issued out of the award', async () => {
    const award = await store.addSecurity({
      kind: 'rsu', stakeholderId: holder.id, classId: common.id, quantity: 100, date: '2024-01-01', vestingMonths: 0,
    });
    await cert({ quantity: 60, pricePerShare: 0, fromRsuId: award.id });
    expect(rsuSettled(store.security(award.id))).toBe(60);
    await expect(store.settleRSU(award.id, { quantity: 50, date: '2024-03-01' }))
      .rejects.toThrow(/more than this award has left to settle/);
    await store.settleRSU(award.id, { quantity: 40, date: '2024-03-01' });
    expect(certifiedByRsu(store.securities).get(award.id)).toBe(100);
    expect(fullyDiluted(store.securities, store.company)).toBe(100);
  });

  it('leaves a certificate already past its award editable, and shrinkable', async () => {
    /* A backup can carry certificates that outrun their grant: the sanitizer
       clamps the counter, not the certificates. Every edit of such a
       certificate was refused for the total it did not touch, which also
       blocked the shrink that repairs the table. */
    const backup = store.exportAll();
    await store.importAll({
      ...backup,
      securities: [
        { id: 'g', kind: 'option', label: 'OPT-1', stakeholderId: holder.id, classId: common.id, quantity: 100, strike: 1, date: '2024-01-01', vestingMonths: 0, exercised: 100 },
        { id: 'a', kind: 'shares', label: 'CS-1', stakeholderId: holder.id, classId: common.id, quantity: 60, pricePerShare: 1, date: '2024-02-01', fromOptionId: 'g' },
        { id: 'b', kind: 'shares', label: 'CS-2', stakeholderId: holder.id, classId: common.id, quantity: 60, pricePerShare: 1, date: '2024-03-01', fromOptionId: 'g' },
      ],
    }, { label: 'x' });
    expect(certifiedByGrant(store.securities).get('g')).toBe(120);
    await store.updateSecurity('a', { pricePerShare: 2 });
    await store.updateSecurity('a', { date: '2024-02-15' });
    expect(store.security('a')).toMatchObject({ pricePerShare: 2, date: '2024-02-15', quantity: 60 });
    await store.updateSecurity('a', { quantity: 40 });
    expect(certifiedByGrant(store.securities).get('g')).toBe(100);
    // Growing it is still held to the grant.
    await expect(store.updateSecurity('a', { quantity: 50 })).rejects.toThrow(/holds 100 options, but 110 shares would be certified/);
    expect(store.security('a').quantity).toBe(40);
  });

  it('refuses growing a certificate past the award it names', async () => {
    const grant = await store.addSecurity({
      kind: 'option', stakeholderId: holder.id, classId: common.id, quantity: 100, strike: 1, date: '2024-01-01', vestingMonths: 0,
    });
    const issued = await store.exerciseOption(grant.id, { quantity: 60, date: '2024-03-01', classId: common.id });
    await expect(store.updateSecurity(issued.id, { quantity: 101 })).rejects.toThrow(/left to exercise/);
    expect(store.security(issued.id).quantity).toBe(60);
  });
});

describe('input the forms never send is refused, not rounded', () => {
  it('refuses fractional, zero and unreadable quantities', async () => {
    await expect(cert({ quantity: 100.6 })).rejects.toThrow('Enter the quantity in whole shares.');
    await expect(cert({ quantity: '12.5' })).rejects.toThrow('Enter the quantity in whole shares.');
    await expect(cert({ quantity: 0 })).rejects.toThrow('Enter the quantity in whole shares.');
    expect(store.securities).toHaveLength(0);
  });

  it('refuses negative money instead of flooring it at zero', async () => {
    await expect(cert({ pricePerShare: -5 })).rejects.toThrow('The price per share can’t be negative.');
    await expect(store.addSecurity({ kind: 'option', stakeholderId: holder.id, classId: common.id, quantity: 10, strike: -1, date: '2024-01-01' }))
      .rejects.toThrow('The strike price can’t be negative.');
    await expect(store.addSecurity({ kind: 'note', stakeholderId: holder.id, principal: 1000, interestRate: 'eight', date: '2024-01-01' }))
      .rejects.toThrow('Enter the interest rate as a number.');
    expect(store.securities).toHaveLength(0);
  });

  it('refuses a missing or impossible date', async () => {
    await expect(cert({ date: '' })).rejects.toThrow('Pick a date.');
    await expect(cert({ date: undefined })).rejects.toThrow('Pick a date.');
    await expect(cert({ date: '2024-13-45' })).rejects.toThrow('Pick a valid date.');
    await expect(cert({ date: '2024-02-30' })).rejects.toThrow('Pick a valid date.');
    const issued = await cert();
    await expect(store.updateSecurity(issued.id, { date: '' })).rejects.toThrow('Pick a date.');
    await expect(store.updateSecurity(issued.id, { vestingStart: 'soon', vestingMonths: 12 })).rejects.toThrow('Pick a valid vesting start date.');
    expect(store.security(issued.id)).toMatchObject({ date: '2024-02-01', quantity: 100 });
  });

  it('refuses a malformed date on every dated write, not only on add and edit', async () => {
    const issued = await cert();
    const grant = await store.addSecurity({ kind: 'option', stakeholderId: holder.id, quantity: 100, strike: 1,
      grantDate: '2024-01-01', vestingMonths: 0, cliffMonths: 0 });
    const award = await store.addSecurity({ kind: 'rsu', stakeholderId: holder.id, classId: common.id, quantity: 100,
      grantDate: '2024-01-01', vestingMonths: 0, cliffMonths: 0 });
    const plan = await store.addPlan({ name: 'Plan', adopted: '2024-01-01', classId: common.id, reserve: 1000 });
    const other = await store.addPlan({ name: 'Other', adopted: '2024-01-01', classId: common.id, reserve: 0 });
    await store.exerciseOption(grant.id, { quantity: 10, date: '2024-06-01' });
    for (const bad of ['next tuesday', '2024-13-45', '2024-02-30', '20240601']) {
      await expect(store.exerciseOption(grant.id, { quantity: 1, date: bad, classId: common.id })).rejects.toThrow('Pick a valid exercise date.');
      await expect(store.certifyExercise(grant.id, { quantity: 1, date: bad, classId: common.id })).rejects.toThrow('Pick a valid exercise date.');
      await expect(store.settleRSU(award.id, { quantity: 1, date: bad })).rejects.toThrow('Pick a valid settlement date.');
      await expect(store.transferShares(issued.id, { quantity: 1, date: bad, to: 'company' })).rejects.toThrow('Pick a valid transfer date.');
      await expect(store.markDeparted(holder.id, { date: bad, grants: [] })).rejects.toThrow('Pick a valid termination date.');
      await expect(store.recordSplit({ num: 2, den: 1, date: bad })).rejects.toThrow('Pick a valid effective date.');
      await expect(store.resizePlanReserve(plan.id, { size: 500, date: bad })).rejects.toThrow('Pick a valid effective date.');
      await expect(store.transferReserve({ fromPlanId: plan.id, toPlanId: other.id, quantity: 1, date: bad })).rejects.toThrow('Pick a valid transfer date.');
      await expect(store.retirePlan(plan.id, { date: bad })).rejects.toThrow('Pick a valid retirement date.');
      await expect(store.addPlan({ name: 'Bad', adopted: bad, classId: common.id, reserve: 0 })).rejects.toThrow('Pick a valid adoption date.');
      await expect(store.updatePlan(plan.id, { expires: bad })).rejects.toThrow('Pick a valid expiration date.');
    }
    await expect(store.markDeparted(holder.id, { date: '2025-01-01', grants: [{ id: grant.id, cancelQty: 0, exerciseBy: 'soon' }] }))
      .rejects.toThrow('Pick a valid exercise deadline.');
    expect(store.company.splits).toEqual([]);
    expect(store.stakeholder(holder.id).departed).toBeUndefined();
    expect(store.securities.filter((s) => s.kind === 'shares')).toEqual([issued]);
  });

  it('takes a grant date as an award’s date', async () => {
    const grant = await store.addSecurity({ kind: 'option', stakeholderId: holder.id, classId: common.id, quantity: 10, strike: 1, grantDate: '2024-01-01' });
    expect(grant.grantDate).toBe('2024-01-01');
  });

  it('refuses fractional lifecycle quantities', async () => {
    const grant = await store.addSecurity({ kind: 'option', stakeholderId: holder.id, classId: common.id, quantity: 100, strike: 1, date: '2024-01-01', vestingMonths: 0 });
    await expect(store.exerciseOption(grant.id, { quantity: 10.5, date: '2024-03-01', classId: common.id })).rejects.toThrow('Enter the quantity in whole shares.');
    expect(grantExercised(store.security(grant.id))).toBe(0);
    const issued = await cert({ quantity: 900 });
    await expect(store.transferShares(issued.id, { date: '2024-03-01', quantity: 10.4, to: 'company' })).rejects.toThrow('Enter the quantity in whole shares.');
    expect(store.security(issued.id).closedAt).toBeUndefined();
    expect(store.securities).toHaveLength(2);
  });
});

describe('a record with no name is refused, not appended as a hole', () => {
  it('refuses a blank class or stakeholder name and leaves the lists whole', async () => {
    for (const name of ['', '   ', null, undefined]) {
      await expect(store.addClass({ name, kind: 'common' })).rejects.toThrow('Give the share class a name.');
      await expect(store.addStakeholder({ name })).rejects.toThrow('Give the stakeholder a name.');
    }
    expect(store.classes).toEqual([common]);
    expect(store.stakeholders).toEqual([holder]);
    // The lookups that tripped over the hole still work.
    expect(store.shareClass(common.id)).toEqual(common);
    expect(() => store.stakeholderDeleteRefusal(holder.id)).not.toThrow();
  });
});

describe('every path that creates a record honours the company ceilings', () => {
  it('refuses a transfer to a new holder once the company holds its most', async () => {
    const issued = await cert();
    const filler = Array.from({ length: MAX_STAKEHOLDERS - store.stakeholders.length }, (_, i) => ({ id: `p${i}`, name: `Person ${i}`, kind: 'employee' }));
    store.stakeholders = Store.sanitizeStakeholders([...store.stakeholders, ...filler]);
    await expect(store.transferShares(issued.id, { date: '2024-03-01', quantity: 10, to: { newHolder: { name: 'Buyer', kind: 'investor' } } }))
      .rejects.toThrow(ListFullError);
    expect(store.security(issued.id).closedAt).toBeUndefined();
    expect(store.stakeholders).toHaveLength(MAX_STAKEHOLDERS);
    // A transfer to a holder already on file still goes through.
    await store.transferShares(issued.id, { date: '2024-03-01', quantity: 10, to: { stakeholderId: 'p0' } });
    expect(store.security(issued.id).closedAt).toBe('2024-03-01');
  });
});

describe('records other records depend on', () => {
  it('refuses deleting the class a plan settles into', async () => {
    await store.addPlan({ name: '2024 Plan', adopted: '2024-01-01', classId: common.id, reserve: 100 });
    await expect(store.deleteClass(common.id)).rejects.toThrow('An equity plan settles its awards into this class.');
    expect(store.shareClass(common.id)).not.toBeNull();
  });

  it('refuses lapsing a grant whose window has not closed', async () => {
    const grant = await store.addSecurity({
      kind: 'option', stakeholderId: holder.id, classId: common.id, quantity: 100, strike: 1, date: '2024-01-01', vestingMonths: 48, cliffMonths: 12,
    });
    await expect(store.cancelLapsedGrants([grant.id])).rejects.toThrow(/OPT-1 has no expiration or exercise deadline, so it has not lapsed/);
    expect(store.security(grant.id).cancelled).toBeUndefined();
    // One whose term has run still lapses on the day it closed.
    await store.updateSecurity(grant.id, { expires: '2025-01-01' });
    await store.cancelLapsedGrants([grant.id]);
    expect(store.security(grant.id)).toMatchObject({ cancelled: 100, cancelledDate: '2025-01-01' });
  });
});

describe('a dated reserve change names the day it is short on', () => {
  it('says so in words when the draw has no date', async () => {
    /* A grant kept from before dates were required draws before every
       recorded day. Once a dated cancellation lowers today's floor, the sweep
       is what refuses the resize, and it used to name the day as "on ,". */
    const backup = store.exportAll();
    await store.importAll({
      ...backup,
      company: { ...backup.company, poolAuthorized: 100, poolHistory: [{ date: '2024-01-01', before: 0, after: 100 }] },
      securities: [{ id: 'g', kind: 'option', label: 'OPT-1', stakeholderId: holder.id, classId: common.id, quantity: 80, strike: 1, vestingMonths: 0 }],
    }, { label: 'x' });
    await store.updateSecurity('g', { cancellations: [{ quantity: 50, date: '2025-03-01' }] });
    await expect(store.resizePool({ size: 40, date: '2024-06-01' }))
      .rejects.toThrow('The pool had 80 shares granted from it with no recorded date, so it can’t be smaller than that on any day.');
    await expect(store.resizePlanReserve(store.company.plans[0].id, { size: 40, date: '2024-06-01' }))
      .rejects.toThrow('had 80 shares committed under it with no recorded date, so its reserve can’t be smaller than that on any day.');
    // A dated draw still names its day.
    await store.updateSecurity('g', { date: '2024-03-01' });
    await expect(store.resizePool({ size: 40, date: '2024-06-01' }))
      .rejects.toThrow('The pool had 80 shares granted from it on 2024-06-01, so it can’t be smaller than that as of that day.');
  });
});

describe('a backup that would lose records is refused', () => {
  it('names the securities whose holder or class the file does not carry', async () => {
    await cert();
    const backup = store.exportAll();
    const before = structuredClone(store.db);
    await expect(store.importAll({ ...backup, stakeholders: [] }))
      .rejects.toThrow('CO-1 names a stakeholder or share class the file does not include. Add them to the file, or remove the securities, and import again. No data was imported.');
    await expect(store.importAll({ ...backup, classes: [] })).rejects.toThrow(/CO-1 names a stakeholder or share class/);
    expect(store.db).toEqual(before);
    // A consistent file still imports, and so does an empty one (a wipe).
    await store.importAll(backup, { label: 'again' });
    expect(store.securities.map((s) => s.label)).toEqual(['CO-1']);
    await store.importAll({}, { label: 'wipe' });
    expect(store.securities).toEqual([]);
  });

  it('can be judged before anything is created for it', async () => {
    /* The import dialog creates the new company a file goes into before the
       import runs, so the file has to be refusable on its own: created first,
       a refused file left an empty company behind, switched to. */
    await cert();
    const backup = store.exportAll();
    expect(() => Store.prepareImport({ ...backup, stakeholders: [] }))
      .toThrow(/CO-1 names a stakeholder or share class the file does not include/);
    expect(() => Store.prepareImport({ ...backup, auditArchive: { app: 'other' } }))
      .toThrow('This audit archive format is not supported. No data was imported.');
    const prepared = Store.prepareImport(backup);
    expect(prepared.securities.map((s) => s.label)).toEqual(['CO-1']);
    expect(prepared.stakeholders).toHaveLength(1);
    expect(prepared.company.name).toBe(backup.company.name);
    // Judging a file writes nothing and creates no company.
    expect(store.companies).toHaveLength(1);
    expect(store.db.securities.map((s) => s.label)).toEqual(['CO-1']);
  });

  it('counts the records past the first three', async () => {
    await cert();
    const backup = store.exportAll();
    const many = Array.from({ length: 5 }, (_, i) => ({ ...backup.securities[0], id: `x${i}`, label: `CO-${i + 2}`, stakeholderId: 'nobody' }));
    await expect(store.importAll({ ...backup, securities: [...backup.securities, ...many] }))
      .rejects.toThrow(/^CO-2, CO-3, CO-4 and 2 more name a stakeholder/);
  });
});

describe('a close is held to the table on its date', () => {
  it('refuses closing a round dated before a recorded split, modeled or not', async () => {
    await cert({ quantity: 1_000_000, pricePerShare: 0.01, date: '2024-01-01' });
    await store.recordSplit({ num: 2, den: 1, date: '2025-01-01' });
    /* The base model reads the table as of its date, so dated before the
       split it prices in pre-split units: 1,000,000 shares, $10 a share, and
       200,000 investor shares for $2M on $10M pre - half the 400,000 the same
       money buys of the restated table. Written as modeled they were 9% of
       the company instead of 16.7%. */
    const m = modelRound(store.db, { preMoney: 10_000_000, investment: 2_000_000, asOf: '2024-06-01' });
    expect(m.fdPre).toBe(1_000_000);
    const before = structuredClone(store.db);
    const close = (date) => store.closeRound({
      date, newClass: { name: 'Series A Preferred', kind: 'preferred', liquidationMultiple: 1, seniority: 1 },
      investors: [{ newHolder: { name: 'VC', kind: 'investor' }, quantity: m.investorShares, pricePerShare: m.pps }],
    });
    await expect(close('2024-06-01')).rejects.toThrow(/before a recorded stock split/);
    expect(store.db).toEqual(before);
    // On or after the split the model and the table share their units.
    const after = modelRound(store.db, { preMoney: 10_000_000, investment: 2_000_000, asOf: '2025-01-01' });
    expect(after.fdPre).toBe(2_000_000);
    await store.closeRound({
      date: '2025-01-01', newClass: { name: 'Series A Preferred', kind: 'preferred', liquidationMultiple: 1, seniority: 1 },
      investors: [{ newHolder: { name: 'VC', kind: 'investor' }, quantity: after.investorShares, pricePerShare: after.pps }],
    });
    expect(store.securities.find((s) => s.classId !== common.id).quantity).toBe(400_000);
  });

  it('refuses a conversion the model reopened from a round recorded after the closing date', async () => {
    await cert({ quantity: 1_000_000, pricePerShare: 0.01, date: '2024-01-01' });
    const note = await store.addSecurity({
      kind: 'note', stakeholderId: holder.id, principal: 100_000, interestRate: 0, valuationCap: 0, discount: 20, date: '2024-06-01',
    });
    const closeWith = (m, date, name) => store.closeRound({
      date, newClass: { name, kind: 'preferred', liquidationMultiple: 1, seniority: 1 },
      investors: [{ newHolder: { name: `${name} lead`, kind: 'investor' }, quantity: m.investorShares, pricePerShare: m.pps }],
      conversions: m.conversions.map((c) => ({ securityId: c.securityId, quantity: c.shares, pricePerShare: c.price })),
    });
    const seed = modelRound(store.db, { preMoney: 4_000_000, investment: 1_000_000, asOf: '2025-03-01' });
    await closeWith(seed, '2025-03-01', 'Seed Preferred');
    expect(store.security(note.id).convertedAt).toBe('2025-03-01');
    /* Dated before the seed, the model reads the note as live again and
       prices the new money over the shares it would convert into. The close
       wrote the investor those shares and left the note as it was: converted
       once, in March, into a different count at a different price. */
    const earlier = modelRound(store.db, { preMoney: 2_000_000, investment: 500_000, asOf: '2025-01-01' });
    expect(earlier.conversions.map((c) => c.securityId)).toEqual([note.id]);
    const before = structuredClone(store.db);
    await expect(closeWith(earlier, '2025-01-01', 'Pre-Seed Preferred'))
      .rejects.toThrow(/CN-1 converted on 2025-03-01, after this closing date/);
    expect(store.db).toEqual(before);
    // A close dated on or after the conversion still leaves it be, as a re-run always has.
    await closeWith(seed, '2025-04-01', 'Seed Extension');
    expect(store.securities.filter((s) => s.fromConvertibleId === note.id)).toHaveLength(1);
  });
});
