/**
 * Records every company needs before it can record money: the default chart
 * of accounts. Accounts have fixed ids, so two devices doing this at the
 * same time write the same records.
 */
import { defaultAccounts } from './accounts.js';

export function ensureDefaults(store) {
  if (!store.state.synced) return false;
  const have = new Set(store.all('accounts').map((a) => a.id));
  const missing = defaultAccounts().filter((a) => a.system && !have.has(a.id));
  // A brand new company gets the whole default chart; an existing one only
  // gets back the accounts the app posts to, if any went missing.
  const add = have.size ? missing : defaultAccounts();
  if (add.length) store.bulkPut('accounts', add);
  return add.length > 0;
}
