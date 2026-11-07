/** Add or remove the sample fleet in a real account. Sample records are marked. */
import { app } from '../app.js';
import { buildSampleData } from '../core/sample.js';
import { COLLECTIONS, NUMBERED } from '../core/schema.js';

export function loadSampleData() {
  const store = app.store;
  const data = buildSampleData(app.today());
  for (const coll of COLLECTIONS) {
    const recs = data.collections[coll] || [];
    if (!recs.length) continue;
    // Sample issues, work orders, and purchase orders are numbered after
    // the fleet's own, so no two share a number.
    const offset = NUMBERED[coll] ? Math.max(0, ...store.all(coll).map((r) => Number(r.number) || 0)) : 0;
    store.bulkPut(coll, recs.map((r) => ({ ...r, ...(offset && r.number != null ? { number: Number(r.number) + offset } : {}), sample: true })));
  }
  const s = store.state.settings;
  const groups = [...(s.groups || [])];
  for (const g of data.settings.groups) if (!groups.some((x) => x.id === g.id)) groups.push(g);
  store.saveSettings({ groups, company: { name: s.company.name || data.settings.company.name } });
}

export function sampleCount() {
  let n = 0;
  for (const coll of COLLECTIONS) for (const r of app.store.all(coll)) if (r.sample) n++;
  return n;
}

export function removeSampleData() {
  const store = app.store;
  for (const coll of COLLECTIONS) {
    const ids = store.all(coll).filter((r) => r.sample).map((r) => r.id);
    if (ids.length) store.bulkRemove(coll, ids);
  }
  // Take back what loading added to settings: the sample groups no
  // remaining vehicle or contact uses, and the sample fleet name.
  const sample = buildSampleData(app.today()).settings;
  const sampleGroups = new Set(sample.groups.map((g) => g.id));
  const used = new Set([...store.all('vehicles'), ...store.all('contacts')].map((r) => r.groupId).filter(Boolean));
  const s = store.state.settings;
  const groups = (s.groups || []).filter((g) => !sampleGroups.has(g.id) || used.has(g.id));
  const changes = {};
  if (groups.length !== (s.groups || []).length) changes.groups = groups;
  if (s.company?.name === sample.company.name) changes.company = { name: '' };
  if (Object.keys(changes).length) store.saveSettings(changes);
}
