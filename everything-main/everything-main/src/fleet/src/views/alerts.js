/**
 * Things that need attention across the fleet: overdue service, renewals,
 * urgent or overdue issues, late work orders, and parts below their reorder
 * point. Records of archived or deleted vehicles and contacts are left out,
 * as on the dashboard. Cached until one of the inputs changes.
 */
import { app, lookup } from '../app.js';
import { reminderState, renewalState } from '../core/reminders.js';
import { issueOverdue } from '../core/status.js';
import { relativeDays } from '../core/dates.js';
import { lowStock } from '../core/actions.js';
import { contactName, vehicleName } from '../core/format.js';

let cache = null;

export function computeAlerts() {
  const s = app.store;
  const today = app.today();
  // Contacts and service tasks give the names shown, so they count too.
  const inputs = [s.all('reminders'), s.all('renewals'), s.all('issues'), s.all('workOrders'), s.all('parts'), s.all('vehicles'), s.all('contacts'), s.all('serviceTasks'), s.state.settings, today];
  if (cache && cache.inputs.every((x, i) => x === inputs[i])) return cache.value;

  const settings = s.state.settings;
  const items = [];
  let overdueReminders = 0;
  let overdueRenewals = 0;
  let openIssues = 0;
  let overdueIssues = 0;
  const activeVehicle = (id) => {
    const v = lookup.vehicle(id);
    return v && !v.archived ? v : null;
  };

  for (const r of s.all('reminders')) {
    if (r.archived) continue;
    const v = lookup.vehicle(r.vehicleId);
    if (!v || v.archived) continue;
    const st = reminderState(r, v, today, settings);
    if (st.status !== 'overdue') continue;
    overdueReminders++;
    items.push({ rank: 2, icon: 'wrench', tone: 'red', title: `${lookup.taskName(r.taskId) || 'Service'} overdue`, sub: `${vehicleName(v)}${st.nextDate ? ` · due ${relativeDays(st.nextDate, today)}` : ''}`, href: `#/reminders/${r.id}` });
  }
  for (const r of s.all('renewals')) {
    if (r.done || r.archived) continue;
    const owner = r.kind === 'contact' ? lookup.contact(r.contactId) : activeVehicle(r.vehicleId);
    if (!owner || owner.archived) continue;
    const st = renewalState(r, today, settings);
    if (st.status !== 'overdue' && st.status !== 'due_soon') continue;
    if (st.status === 'overdue') overdueRenewals++;
    const who = r.kind === 'contact' ? contactName(owner) : vehicleName(owner);
    items.push({
      rank: st.status === 'overdue' ? 1 : 4,
      icon: 'calendar-clock',
      tone: st.status === 'overdue' ? 'red' : 'orange',
      title: `${r.type} ${st.status === 'overdue' ? 'overdue' : 'due soon'}`,
      sub: `${who} · ${relativeDays(r.dueDate, today)}`,
      href: r.kind === 'contact' ? '#/contact-renewals' : '#/renewals',
    });
  }
  for (const i of s.all('issues')) {
    if (i.status !== 'open') continue;
    openIssues++;
    const v = lookup.vehicle(i.vehicleId);
    const late = issueOverdue(i, today, v);
    if (late) overdueIssues++;
    if ((late || i.priority === 'critical' || i.priority === 'high') && activeVehicle(i.vehicleId)) {
      items.push({ rank: i.priority === 'critical' ? 0 : 3, icon: 'warning', tone: i.priority === 'critical' || late ? 'red' : 'orange', title: `#${i.number} ${i.summary}`, sub: `${vehicleName(v)} · ${late ? 'overdue' : `${i.priority} priority`}`, href: `#/issues/${i.id}` });
    }
  }
  for (const w of s.all('workOrders')) {
    if (w.status === 'completed' || w.status === 'cancelled' || !w.dueDate || w.dueDate >= today || !activeVehicle(w.vehicleId)) continue;
    items.push({ rank: 3, icon: 'clipboard', tone: 'orange', title: `Work order #${w.number} past due`, sub: `${vehicleName(lookup.vehicle(w.vehicleId))} · due ${relativeDays(w.dueDate, today)}`, href: `#/work-orders/${w.id}` });
  }
  for (const p of s.all('parts')) {
    if (p.archived || !lowStock(p)) continue;
    items.push({ rank: 5, icon: 'package', tone: 'orange', title: `Low stock: ${p.description || p.number}`, sub: `Part ${p.number}`, href: `#/parts/${p.id}` });
  }
  items.sort((a, b) => a.rank - b.rank);
  const value = { items, overdueReminders, overdueRenewals, openIssues, overdueIssues };
  cache = { inputs, value };
  return value;
}
