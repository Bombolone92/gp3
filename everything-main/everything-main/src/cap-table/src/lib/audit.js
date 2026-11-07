/**
 * Permanent company journal. An immutable intent is indexed BEFORE any business
 * publication. Each touched key has a preallocated revision, allowing recovery
 * to fence a delayed writer without confusing identical data from another writer.
 * The decision is conditional: completion and compensation cannot both win.
 * No leases, timers, kv.list scans, or browser-local locks are required.
 *
 * This is an application audit trail in the account owner's storage, not a
 * tamper-proof record against that owner. No document bytes or credentials enter it.
 *
 * Every round trip on the save path is paid by the user waiting on a sheet, so
 * an entry's parts - its payload, its first decision and its index node - are
 * written together, and only the publication that names the entry in the head
 * is conditional. Nothing reads any of them before that publication, so their
 * order among themselves does not matter, and a failed one is removed unnamed.
 */
import { readKV, compareAndSetKV, KVConflictError, deleteKV, INITIAL } from './kv.js';
import { toCSV } from './util.js';

export const AUDIT_FIELDS = ['company', 'classes', 'stakeholders', 'securities', 'scenarios', 'exits', 'hiring'];
/** How many of the latest entries the head lists, so a page reads them together rather than one hop at a time. */
const RECENT = 100;
/** Entries read in one batch when the head lists them, or a page's payloads are exported. */
const BATCH = 25;
/* Operations whose name would read wrong split into words. */
const ACTION_LABELS = {
  baseline: 'Initial baseline', wipeAll: 'Delete all data', importAll: 'Replace all data',
  restoreFromPoint: 'Restore from snapshot', importCSV: 'Import from CSV', certifyExercise: 'Record exercise certificate',
};
/** "updateStakeholder" reads "Update stakeholder"; "undo.deleteSecurity" reads "Undo: delete security". */
export function auditActionLabel(operation) {
  const name = String(operation || 'change');
  const undone = name.startsWith('undo.');
  const bare = undone ? name.slice(5) : name;
  const words = ACTION_LABELS[bare] || bare.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ')
    .map((word, i) => (word === word.toUpperCase() ? word : i ? word.toLowerCase() : word)).join(' ');
  const text = undone ? `Undo: ${words.charAt(0).toLowerCase()}${words.slice(1)}` : words;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const decode = (v) => typeof v === 'string' ? JSON.parse(v) : v;
const idOK = (id) => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
const EFFECTIVE_FIELDS = new Set(['date', 'grantDate', 'closedAt', 'convertedAt', 'cancelledDate', 'departed', 'filed83b', 'maturedAt']);
const dateOf = (record) => record?.closedAt || record?.convertedAt || record?.cancelledDate
  || record?.departed || record?.filed83b || record?.grantDate || record?.date || null;
const TERMINAL = ['completed', 'compensated', 'rejected'];
/** The decision an entry is created with: written plainly, since only its writer knows the key yet. */
const firstDecision = (event, pending) => ({ status: pending ? 'pending' : 'completed', at: event.recordedAt });

export class AuditRecoveryError extends Error {
  constructor(message = 'A previous change needs recovery. Reload before editing this company.') {
    super(message); this.name = 'AuditRecoveryError'; this.refused = true;
  }
}

/** Structured record changes, preserving deleted records and linked holders. */
export function auditChanges(before, after) {
  const changes = [];
  for (const field of AUDIT_FIELDS) {
    if (!(field in after) || same(before[field], after[field])) continue;
    const old = field === 'company' ? [before[field]] : before[field] || [];
    const next = field === 'company' ? [after[field]] : after[field] || [];
    const a = new Map(old.filter(Boolean).map((r) => [r.id || 'company', r]));
    const b = new Map(next.filter(Boolean).map((r) => [r.id || 'company', r]));
    for (const id of new Set([...a.keys(), ...b.keys()])) {
      const previous = a.get(id) || null, current = b.get(id) || null;
      if (same(previous, current)) continue;
      const changedDates = current && previous ? Object.entries(current)
        .filter(([key, value]) => value !== previous[key] && EFFECTIVE_FIELDS.has(key)
          && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)).map(([, value]) => value) : [];
      for (const key of ['poolHistory', 'splits', 'valuations', 'cancellations']) {
        const earlier = new Set((previous?.[key] || []).map((entry) => JSON.stringify(entry)));
        for (const entry of current?.[key] || []) {
          if (!earlier.has(JSON.stringify(entry)) && entry.date) changedDates.push(entry.date);
        }
      }
      // A plan's reserve changes and its retirement date the change it sits inside.
      const earlierPlans = new Map((previous?.plans || []).map((plan) => [plan.id, plan]));
      for (const plan of current?.plans || []) {
        const was = earlierPlans.get(plan.id);
        const seen = new Set((was?.reserveHistory || []).map((entry) => JSON.stringify(entry)));
        for (const entry of plan.reserveHistory || []) {
          if (!seen.has(JSON.stringify(entry)) && entry.date) changedDates.push(entry.date);
        }
        if (plan.retiredAt && plan.retiredAt !== was?.retiredAt) changedDates.push(plan.retiredAt);
        if (!was && plan.adopted) changedDates.push(plan.adopted);
      }
      if (!previous && dateOf(current)) changedDates.push(dateOf(current));
      const effectiveDates = [...new Set(changedDates)];
      changes.push({ field, recordId: id, action: !previous ? 'create' : !current ? 'delete' : 'update',
        // A hiring row has a role where other records have a name or a label.
        label: current?.name || current?.label || current?.role || previous?.name || previous?.label || previous?.role || field,
        holderIds: [...new Set([previous?.stakeholderId, current?.stakeholderId,
          field === 'stakeholders' ? id : null].filter(Boolean))],
        effectiveDate: effectiveDates.length === 1 ? effectiveDates[0] : null, effectiveDates,
        before: previous, after: current });
    }
  }
  return clone(changes);
}

async function digest(text) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export class AuditJournal {
  /**
   * The head as this instance last read or published it. A commit reads the
   * head once and every step after that - the entry's publication, the
   * release of its pending mark - publishes against what it already holds;
   * a conflict re-reads. An instance lives for one commit or one page.
   */
  #head = null;
  /** How many parts each intent this instance wrote has, so discarding it needs no read. */
  #intents = new Map();

  constructor(companyId) {
    this.companyId = companyId;
    this.prefix = `captable:${companyId}:audit:v1`;
  }
  key(id, suffix) {
    if (!idOK(id)) throw new AuditRecoveryError('The audit history contains an invalid transaction ID.');
    return `${this.prefix}:${id}:${suffix}`;
  }
  async head({ cached = false } = {}) {
    if (cached && this.#head) return this.#head;
    const expected = await readKV(this.prefix);
    const value = decode(expected.raw);
    if (expected.deleted) throw new AuditRecoveryError('This company has been deleted.');
    if (value && (value.version !== 1 || !idOK(value.latest) || !Array.isArray(value.pending)
      || value.pending.some((id) => !idOK(id)) || !Number.isSafeInteger(value.count))) {
      throw new AuditRecoveryError('The audit index is damaged. Restore access to its stored data before editing.');
    }
    // The list of latest entries is a reading aid; a head without one, or with a damaged one, reads by the chain.
    const recent = Array.isArray(value?.recent) && value.recent.every(idOK) && value.recent[0] === value.latest ? value.recent : [];
    this.#head = { expected, value: value ? { ...value, recent } : { version: 1, latest: null, count: 0, pending: [], recent: [] } };
    return this.#head;
  }
  #published(result, value) {
    this.#head = { expected: { raw: result.raw, revision: result.revision }, value };
  }
  async putBlob(id, value, name = 'blob') {
    const text = JSON.stringify(value), parts = [];
    // At most 320KB in UTF-8 per part, with no surrogate pair split.
    let part = '';
    for (const char of text) {
      part += char;
      if (part.length >= 80_000) { parts.push(part); part = ''; }
    }
    if (part) parts.push(part);
    const results = await Promise.allSettled(parts.map((p, i) => puter.kv.set(this.key(id, `${name}:part:${i}`), p)));
    const failed = results.find((r) => r.status === 'rejected');
    try {
      if (failed) throw failed.reason;
      await puter.kv.set(this.key(id, name), JSON.stringify({ parts: parts.length, digest: await digest(text) }));
    } catch (err) {
      // The caller has not published a pointer to these parts yet.
      await Promise.allSettled([name, ...parts.map((_, i) => `${name}:part:${i}`)]
        .map((suffix) => Promise.resolve().then(() => puter.kv.del?.(this.key(id, suffix)))));
      throw err;
    }
    return parts.length;
  }
  async blob(id, name = 'blob', { optional = false } = {}) {
    const manifest = decode(await puter.kv.get(this.key(id, name)));
    if (!manifest && optional) return null;
    if (!manifest || !Number.isSafeInteger(manifest.parts) || manifest.parts < 1) throw new AuditRecoveryError('An audit transaction is missing.');
    const parts = await Promise.all(Array.from({ length: manifest.parts }, (_, i) => puter.kv.get(this.key(id, `${name}:part:${i}`))));
    if (parts.some((p) => typeof p !== 'string')) throw new AuditRecoveryError('An audit transaction is incomplete.');
    const text = parts.join('');
    if (await digest(text) !== manifest.digest) throw new AuditRecoveryError('An audit transaction failed its integrity check.');
    return JSON.parse(text);
  }
  async node(id) {
    const raw = decode(await puter.kv.get(this.key(id, 'node')));
    const node = raw?.parts ? await this.blob(id, 'node') : raw;
    if (!node || node.id !== id || node.companyId !== this.companyId
      || (node.previous && !idOK(node.previous))) throw new AuditRecoveryError('An audit index entry is missing or damaged.');
    return node;
  }
  /**
   * An unfinished entry with its recovery intent - the before-state of every
   * collection it writes and the revision each write was allocated. Null once
   * the decision is terminal and the intent has been discarded; an intent
   * that cannot be read while the decision is still open is damage.
   */
  async pending(id) {
    const [event, intent] = await Promise.all([this.blob(id), this.blob(id, 'intent', { optional: true }).catch((err) => err)]);
    if (intent && !(intent instanceof Error)) return { ...event, writes: intent.writes };
    if (TERMINAL.includes((await this.decision(id)).value?.status)) return null;
    throw intent instanceof Error ? intent : new AuditRecoveryError('An audit transaction is incomplete.');
  }
  /**
   * Remove an entry's intent once its decision is terminal. The intent is
   * the bulk of an entry - whole collections as they stood - and outlives its
   * use the moment the transaction is decided: a completed one is read back
   * from the collections themselves, a compensated one has put them back.
   * Kept for good, every save stored another copy of everything it wrote.
   * Best-effort, and in one round: a reader that finds the manifest without
   * its parts asks the decision, which is terminal by now (see pending).
   */
  async discardIntent(id) {
    let parts = this.#intents.get(id);
    if (parts === undefined) {
      const manifest = decode(await puter.kv.get(this.key(id, 'intent')).catch(() => null));
      if (!manifest) return;
      parts = manifest.parts || 0;
    }
    this.#intents.delete(id);
    /* Parts first, the manifest last: the manifest is the only way back to
       the parts, so deleted alongside them one failed part delete left that
       part - a copy of every collection the save touched - with nothing
       naming it, for good. With the manifest still standing the next
       discard finds the count and tries again. */
    const gone = await Promise.allSettled(Array.from({ length: parts }, (_, i) => `intent:part:${i}`)
      .map((suffix) => Promise.resolve().then(() => puter.kv.del?.(this.key(id, suffix)))));
    if (gone.every((r) => r.status === 'fulfilled')) await puter.kv.del?.(this.key(id, 'intent')).catch(() => {});
  }
  async decision(id) {
    const expected = await readKV(this.key(id, 'decision'));
    return { expected, value: decode(expected.raw) };
  }
  /**
   * Move a decision from one status to another, conditionally. `known` is the
   * decision as the caller last wrote it, so the first attempt needs no read;
   * a conflict re-reads, and a status already moved elsewhere is returned as
   * it stands.
   */
  async decide(id, from, to, extra = {}, known = null) {
    for (let current = known; ; current = null) {
      const { expected, value } = current || await this.decision(id);
      if (value?.status !== from) return value;
      const next = { status: to, at: new Date().toISOString(), ...extra };
      try {
        await compareAndSetKV(this.key(id, 'decision'), expected, JSON.stringify(next));
        return next;
      } catch (err) {
        if (err instanceof KVConflictError) continue;
        // An acknowledgement can be lost after the decision became durable.
        const landed = (await this.decision(id)).value;
        if (same(landed, next)) return landed;
        throw err;
      }
    }
  }
  async release(id) {
    for (let fresh = false; ; fresh = true) {
      const { expected, value } = await this.head({ cached: !fresh });
      if (!value.pending.includes(id)) return;
      const next = { ...value, pending: value.pending.filter((x) => x !== id) };
      try {
        this.#published(await compareAndSetKV(this.prefix, expected, JSON.stringify(next)), next);
        return;
      } catch (err) { if (!(err instanceof KVConflictError)) throw err; }
    }
  }
  async append(event, { pending = false, baseline = false } = {}) {
    const { changes, writes = [], sourceArchive, legacyActivity, ...metadata } = event;
    /* The entry's permanent record carries what changed; what a recovery
       needs to undo it - the collections as they stood, and the revision
       each write was allocated - is the intent, kept only until the
       decision is terminal. The bytes a write expected to replace are not
       stored at all: recovery reads the key afresh and compares revisions. */
    const record = { ...metadata, changes, ...(sourceArchive ? { sourceArchive } : {}), ...(legacyActivity ? { legacyActivity } : {}) };
    const intent = writes.length ? { writes: writes.map(({ key, field, revision, before, expected }) => (
      { key, field, revision, before, expected: { revision: expected.revision, ...(expected.deleted ? { deleted: true } : {}) } })) } : null;
    const summary = { ...metadata, changeCount: changes.length,
      records: [...new Set(changes.flatMap((c) => [c.recordId, ...c.holderIds]))],
      effectiveDates: [...new Set(changes.flatMap((c) => c.effectiveDates || [c.effectiveDate]).filter(Boolean))] };
    const writeNode = async (previous) => {
      const node = { ...summary, previous };
      if (new TextEncoder().encode(JSON.stringify(node)).length > 350_000) await this.putBlob(event.id, node, 'node');
      else await puter.kv.set(this.key(event.id, 'node'), JSON.stringify(node));
    };
    let head;
    try {
      head = await this.head({ cached: true });
      /* The entry's parts go together: nothing reads any of them before the
         head names the entry. The node is written against the head as read,
         and rewritten below should that head have moved meanwhile. */
      await Promise.all([
        this.putBlob(event.id, record),
        intent ? this.putBlob(event.id, intent, 'intent').then((parts) => this.#intents.set(event.id, parts)) : null,
        puter.kv.set(this.key(event.id, 'decision'), JSON.stringify(firstDecision(event, pending))),
        writeNode(head.value.latest),
      ]);
    } catch (err) {
      // No index publication has been attempted: remove the unnamed candidate without touching business data.
      await this.removeEntry(event.id).catch(() => {});
      throw err;
    }
    for (let attempt = 0; ; attempt++) {
      if (attempt) {
        try { head = await this.head(); }
        catch (err) { await this.removeEntry(event.id).catch(() => {}); throw err; }
      }
      const { expected, value } = head;
      if (baseline && value.latest) { await this.removeEntry(event.id); return null; }
      if (value.pending.length >= 100) { await this.removeEntry(event.id); throw new AuditRecoveryError(); }
      if (attempt) await writeNode(value.latest);
      const next = { version: 1, latest: event.id, count: value.count + 1,
        pending: pending ? [...value.pending, event.id] : value.pending,
        recent: [event.id, ...value.recent].slice(0, RECENT) };
      try {
        this.#published(await compareAndSetKV(this.prefix, expected, JSON.stringify(next)), next);
        return event;
      } catch (err) {
        if (err instanceof KVConflictError) continue;
        const current = (await this.head()).value;
        if (current.latest === event.id || current.pending.includes(event.id)) return event;
        throw err;
      }
    }
  }
  async baseline(snapshot, actor, legacyActivity = []) {
    if ((await this.head()).value.latest) return;
    await this.append({ version: 1, id: crypto.randomUUID(), companyId: this.companyId,
      recordedAt: new Date().toISOString(), effectiveDate: null, operation: 'baseline', source: 'migration', actor,
      explanation: 'Initial observed state. Earlier changes and actors are unknown; legacy activity is incomplete.',
      changes: auditChanges({}, snapshot), legacyActivity: clone(legacyActivity), writes: [] }, { baseline: true });
  }
  async prepare({ before, after, actor, operation, writes, explanation = '', source = 'app', sourceArchive = null }) {
    const changes = auditChanges(before, after);
    const dates = [...new Set(changes.flatMap((c) => c.effectiveDates).filter(Boolean))];
    const event = { version: 1, id: crypto.randomUUID(), companyId: this.companyId,
      recordedAt: new Date().toISOString(), effectiveDate: dates.length === 1 ? dates[0] : null,
      operation, source, actor, explanation, changes, writes, ...(sourceArchive ? { sourceArchive } : {}) };
    return this.append(event, { pending: true });
  }
  async complete(event) {
    // Against the decision this commit wrote, so completion needs no read of its own.
    const first = firstDecision(event, true);
    const known = { expected: { raw: JSON.stringify(first), revision: INITIAL }, value: first };
    const decision = await this.decide(event.id, 'pending', 'completed', {}, known);
    if (decision?.status !== 'completed') throw new AuditRecoveryError();
    // The completed decision is durable. A failed index cleanup is safe to
    // finish on reload; it must not cause a completed transaction to roll back.
    // The intent has no reader left either; the two cleanups go together.
    await Promise.all([this.release(event.id).catch(() => {}), this.discardIntent(event.id)]);
  }
  async recover(event, restore, reason = 'Interrupted operation recovered on reload') {
    let decision = await this.decide(event.id, 'pending', 'compensating', { reason });
    if (decision?.status === 'compensating') {
      let published = false;
      for (const write of event.writes) {
        if ((await readKV(write.key)).revision === write.revision && !decision.hadPublications) {
          decision = await this.decide(event.id, 'compensating', 'compensating', { reason, hadPublications: true });
        }
        // Even a key still at its original revision gets fenced. A delayed
        // publication can then never land after compensation has finished.
        published = (await restore(write)) || published;
      }
      decision = await this.decide(event.id, 'compensating', decision.hadPublications || published ? 'compensated' : 'rejected', { reason });
    }
    if (!TERMINAL.includes(decision?.status)) throw new AuditRecoveryError();
    await Promise.all([this.release(event.id), this.discardIntent(event.id)]);
  }
  async recoverPending(restore) {
    const { value } = await this.head();
    for (const id of value.pending) {
      const event = await this.pending(id);
      if (event) await this.recover(event, restore);
      else await this.release(id);
    }
  }
  /**
   * Index nodes from `id` back along the chain, in order. Where the head's
   * list of latest entries covers the way ahead, a batch is read together;
   * past it, one hop at a time. The list is a cache of the chain: where the
   * two disagree, the chain is followed.
   */
  async *walk(id, recent = []) {
    const visited = new Set();
    let queue = [];
    while (id) {
      if (visited.has(id)) throw new AuditRecoveryError('The audit index contains a cycle.');
      visited.add(id);
      if (queue.length && queue[0].id !== id) queue = [];
      if (!queue.length) {
        const at = recent.indexOf(id);
        const ids = at >= 0 ? recent.slice(at, at + BATCH) : [id];
        const nodes = await Promise.allSettled(ids.map((x) => this.node(x)));
        if (nodes[0].status === 'rejected') throw nodes[0].reason;
        for (let i = 0; i < nodes.length && nodes[i].status === 'fulfilled'; i++) {
          queue.push(nodes[i].value);
          if (i + 1 < ids.length && nodes[i].value.previous !== ids[i + 1]) break;
        }
      }
      const node = queue.shift();
      id = node.previous;
      yield node;
    }
  }
  static #matches(node, { record = '', actor = '', operation = '', from = '', to = '', transaction = '' }) {
    if (record && !node.records.includes(record)) return false;
    if (actor && !`${node.actor?.id || ''} ${node.actor?.name || ''}`.toLowerCase().includes(actor.toLowerCase())) return false;
    if (operation && !`${node.operation} ${auditActionLabel(node.operation)}`.toLowerCase().includes(operation.toLowerCase())) return false;
    if (transaction && node.id !== transaction) return false;
    if (from && node.recordedAt.slice(0, 10) < from || to && node.recordedAt.slice(0, 10) > to) return false;
    return true;
  }
  async page({ cursor, limit = 25, ...filters } = {}) {
    const { value } = await this.head();
    const walk = this.walk(cursor === undefined ? value.latest : cursor, value.recent);
    const matches = [];
    let scanned = 0, next = null;
    while (matches.length < Math.max(1, Math.min(100, limit)) && scanned < 100) {
      const step = await walk.next();
      if (step.done) { next = null; break; }
      scanned += 1;
      next = step.value.previous;
      if (AuditJournal.#matches(step.value, filters)) matches.push(step.value);
    }
    // The outcomes of a page together, not one after the other.
    const outcomes = await Promise.all(matches.map((node) => this.decision(node.id)));
    return { entries: matches.map((node, i) => ({ ...node, outcome: outcomes[i].value })), cursor: next || null };
  }
  /**
   * Every event with its outcome, newest first. The chain is walked for its
   * nodes first, then the payloads are read a batch at a time; `onProgress`
   * hears how far along both are, since a long history takes a while.
   */
  async export({ onProgress = null } = {}) {
    const { value } = await this.head();
    const nodes = [];
    for await (const node of this.walk(value.latest, value.recent)) {
      nodes.push(node);
      onProgress?.({ read: nodes.length, loaded: 0, total: value.count });
    }
    const events = [];
    for (let i = 0; i < nodes.length; i += BATCH) {
      events.push(...await Promise.all(nodes.slice(i, i + BATCH).map(async (node) => {
        const [event, decision] = await Promise.all([this.blob(node.id), this.decision(node.id)]);
        return { ...event, outcome: decision.value };
      })));
      onProgress?.({ read: nodes.length, loaded: events.length, total: value.count });
    }
    return { app: 'captable-audit', version: 1, companyId: this.companyId,
      exportedAt: new Date().toISOString(), events };
  }
  async removeEntry(id) {
    const manifests = Object.fromEntries(await Promise.all(['blob', 'intent', 'node']
      .map(async (name) => [name, decode(await puter.kv.get(this.key(id, name)))])));
    await deleteKV(this.key(id, 'decision'));
    const keys = ['blob', 'intent', 'node'].flatMap((name) => [name,
      ...Array.from({ length: manifests[name]?.parts || 0 }, (_, i) => `${name}:part:${i}`)]);
    await Promise.all(keys.map((suffix) => puter.kv.del?.(this.key(id, suffix))));
  }
  async purge() {
    let id;
    // Capture exactly the head the deletion replaces. A racing append must
    // either join this cleanup or lose to its tombstone, including empty heads.
    for (;;) {
      const { expected, value } = await this.head();
      try {
        await compareAndSetKV(this.prefix, expected, null);
        id = value.latest;
        break;
      } catch (err) { if (!(err instanceof KVConflictError)) throw err; }
    }
    /* The head is gone, so a second walk could never find these entries:
       one that will not go must not stop the rest from going. A node that
       cannot be read ends the walk, since it names the next one. */
    const visited = new Set();
    while (id && !visited.has(id)) {
      visited.add(id);
      let node;
      try { node = await this.node(id); } catch { return; }
      await this.removeEntry(id).catch(() => {});
      id = node.previous;
    }
  }
}

/**
 * The provenance an import keeps of the history a backup came with: the
 * events of that history this company's own journal does not already hold,
 * each once. Kept whole, a backup exported from this company and imported
 * back into it repeated every event of its own history inside the import
 * event, and the next export carried the history twice; the export after
 * that four times. Nine round trips took a 31 KB sample backup past the 20 MB
 * an import accepts. So an event this company recorded itself is not
 * repeated (it is in the journal, and the file's copy is not the record),
 * and one already kept at a shallower depth is not repeated below it. The
 * archives of other companies are kept as they came, minus the same repeats.
 * Reports how many events went, so the import event can say so.
 */
export function pruneProvenance(archive, companyId, seen = new Set()) {
  if (!archive || typeof archive !== 'object' || !Array.isArray(archive.events)) return { archive, dropped: 0 };
  let dropped = 0;
  /* Marked before any nested archive is visited, so the copy that survives
     is the one closest to the top: visited depth first, a nested copy of an
     earlier event would have claimed the id before the top-level record. */
  const kept = [];
  for (const event of archive.events) {
    if (!event || typeof event !== 'object' || event.companyId === companyId || (idOK(event.id) && seen.has(event.id))) {
      dropped += 1;
      continue;
    }
    if (idOK(event.id)) seen.add(event.id);
    kept.push(event);
  }
  const events = kept.map((event) => {
    if (!event.sourceArchive) return event;
    const nested = pruneProvenance(event.sourceArchive, companyId, seen);
    dropped += nested.dropped;
    return { ...event, sourceArchive: nested.archive };
  });
  return { archive: { ...archive, events }, dropped };
}

export function auditCSV(archive) {
  const rows = [['Schema', 'Company ID', 'Transaction ID', 'Recorded at', 'Effective date', 'Actor ID', 'Actor',
    'Operation', 'Source', 'Outcome', 'Explanation', 'Collection', 'Record ID', 'Action', 'Before', 'After']];
  for (const event of archive.events) {
    for (const change of event.changes.length ? event.changes : [{}]) {
      rows.push([event.version, event.companyId, event.id, event.recordedAt, change.effectiveDate || event.effectiveDate || '',
        event.actor?.id || '', event.actor?.name || '', event.operation, event.source, event.outcome?.status || 'unknown',
        event.explanation, change.field || '', change.recordId || '', change.action || '',
        JSON.stringify(change.before ?? null), JSON.stringify(change.after ?? null)]);
    }
  }
  return toCSV(rows);
}
