/**
 * Everything that appears on the calendar, flattened into one shape:
 * job visits, request assessments, tasks and events.
 *
 * { key, kind, date, start, end, title, clientId, propertyId, assignees,
 *   completed, jobId?, visitId?, requestId?, eventId? }
 */
export function agendaItems(store, { from = null, to = null, includeUndated = false } = {}) {
  const inRange = (d) => (d ? (!from || d >= from) && (!to || d <= to) : includeUndated);
  const out = [];
  for (const job of store.all('jobs')) {
    if (job.archived) continue;
    for (const v of job.visits || []) {
      if (!inRange(v.date)) continue;
      out.push({
        key: `v:${job.id}:${v.id}`,
        kind: 'visit',
        date: v.date,
        start: v.start || '',
        end: v.end || '',
        title: v.title || job.title || `Job #${job.number}`,
        clientId: job.clientId,
        propertyId: job.propertyId,
        assignees: v.assignees || job.assignees || [],
        completed: !!v.completedAt,
        jobId: job.id,
        visitId: v.id,
        number: job.number,
      });
    }
  }
  for (const req of store.all('requests')) {
    const a = req.assessment;
    if (!a || req.archived || !inRange(a.date)) continue;
    out.push({
      key: `a:${req.id}`,
      kind: 'assessment',
      date: a.date,
      start: a.start || '',
      end: a.end || '',
      title: `Assessment: ${req.title || 'Request'}`,
      clientId: req.clientId,
      propertyId: req.propertyId,
      assignees: a.assignees || [],
      completed: !!a.completedAt,
      requestId: req.id,
    });
  }
  for (const ev of store.all('events')) {
    if (!inRange(ev.date)) continue;
    out.push({
      key: `e:${ev.id}`,
      kind: ev.kind === 'event' ? 'event' : 'task',
      date: ev.date,
      start: ev.start || '',
      end: ev.end || '',
      title: ev.title || (ev.kind === 'event' ? 'Event' : 'Task'),
      clientId: ev.clientId || null,
      propertyId: null,
      assignees: ev.assignees || [],
      completed: !!ev.completedAt,
      eventId: ev.id,
    });
  }
  return out.sort(compareAgenda);
}

export function compareAgenda(a, b) {
  return (a.date || '').localeCompare(b.date || '') || (a.start || '99').localeCompare(b.start || '99') || a.title.localeCompare(b.title);
}

export function filterByMembers(items, memberIds) {
  if (!memberIds || !memberIds.length) return items;
  const set = new Set(memberIds);
  return items.filter((it) => (memberIds.includes('unassigned') && !it.assignees.length) || it.assignees.some((a) => set.has(a)));
}

/** Mark any agenda item done or not done. */
export function setAgendaComplete(store, item, done) {
  const stamp = done ? new Date().toISOString() : null;
  if (item.kind === 'visit') {
    return store.patch('jobs', item.jobId, (j) => {
      j.visits = (j.visits || []).map((v) => (v.id === item.visitId ? { ...v, completedAt: stamp } : v));
      return j;
    });
  }
  if (item.kind === 'assessment') {
    return store.patch('requests', item.requestId, (r) => {
      r.assessment = { ...r.assessment, completedAt: stamp };
      return r;
    });
  }
  return store.patch('events', item.eventId, { completedAt: stamp });
}

/** Move an agenda item to a new date/time (drag and drop on the calendar). */
export function moveAgendaItem(store, item, { date, start, end }) {
  const changes = { date, start: start ?? item.start, end: end ?? item.end };
  if (item.kind === 'visit') {
    return store.patch('jobs', item.jobId, (j) => {
      j.visits = (j.visits || []).map((v) => (v.id === item.visitId ? { ...v, ...changes } : v));
      return j;
    });
  }
  if (item.kind === 'assessment') {
    return store.patch('requests', item.requestId, (r) => {
      r.assessment = { ...r.assessment, ...changes };
      return r;
    });
  }
  return store.patch('events', item.eventId, changes);
}

export function agendaHref(item) {
  if (item.kind === 'visit') return `#/jobs/${item.jobId}`;
  if (item.kind === 'assessment') return `#/requests/${item.requestId}`;
  return null;
}
