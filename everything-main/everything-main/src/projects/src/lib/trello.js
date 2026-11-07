/**
 * Trello board JSON → a project document.
 *
 * Only what this app already models is carried across: lists become columns,
 * cards become tasks, labels and members come along, checklists flatten into
 * the one checklist a task has, card comments become comments, and archived
 * cards land in the archive rather than on the board. Everything else — votes,
 * covers, custom fields, power-ups, card positions inside swimlanes — is
 * counted and reported, because silently dropping a field is worse than
 * refusing the file.
 *
 * Pure: the store's own `prepareImportedProject` is what writes it, so every
 * id here is regenerated on the way in.
 */

import { uid } from './util.js';
import { LABEL_COLORS, PROJECT_COLORS } from './store.js';
import { safeHref } from './markdown.js';

/** Trello's colour names, mapped onto this app's label palette. */
const LABEL_COLOR_MAP = {
  green: '#5f7d2f', lime: '#5f7d2f', yellow: '#d97706', orange: '#b4552e',
  red: '#dc4b6a', pink: '#dc4b6a', purple: '#7c53c9', blue: '#2382c4',
  sky: '#2382c4', teal: '#0d9488', black: '#64748b', grey: '#64748b', gray: '#64748b',
};

const DONE_NAMES = /^(done|complete|completed|shipped|closed|finished|live)$/i;

/** Enough of a Trello board to be worth trying. */
export function looksLikeTrello(data) {
  return !!data && typeof data === 'object' && !Array.isArray(data)
    && Array.isArray(data.lists) && Array.isArray(data.cards);
}

const byPos = (a, b) => (Number(a?.pos) || 0) - (Number(b?.pos) || 0);

/** Trello dates are instants; this app's are days. */
const dayOf = (value) => {
  const text = String(value ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
};

/**
 * trelloToProject(data) → { doc, report }
 */
export function trelloToProject(data, { now = Date.now() } = {}) {
  const report = {
    tasks: 0,
    archived: 0,
    comments: 0,
    checklistItems: 0,
    attachments: 0,
    skippedAttachments: 0,
    notes: [],
  };

  const labels = (data.labels ?? [])
    .filter((l) => l && (l.name || l.color))
    .map((label, i) => ({
      id: uid(),
      trelloId: label.id,
      name: String(label.name || label.color || `Label ${i + 1}`),
      color: LABEL_COLOR_MAP[String(label.color ?? '').replace(/_(dark|light)$/, '')]
        ?? LABEL_COLORS[i % LABEL_COLORS.length],
    }));
  const labelByTrello = new Map(labels.map((l) => [l.trelloId, l.id]));

  const members = (data.members ?? []).map((member, i) => ({
    id: uid(),
    trelloId: member?.id,
    name: String(member?.fullName || member?.username || `Member ${i + 1}`),
    color: PROJECT_COLORS[i % PROJECT_COLORS.length],
  }));
  const memberByTrello = new Map(members.map((m) => [m.trelloId, m.id]));

  const openLists = (data.lists ?? []).filter((l) => l && !l.closed).sort(byPos);
  const closedLists = (data.lists ?? []).filter((l) => l && l.closed);
  const columns = openLists.map((list) => ({
    id: uid(),
    trelloId: list.id,
    name: String(list.name || 'List'),
    // Trello has no notion of a done list, so the name is the only clue —
    // and the board says what it decided in the report.
    done: DONE_NAMES.test(String(list.name || '').trim()),
  }));
  const columnByTrello = new Map(columns.map((c) => [c.trelloId, c.id]));
  if (!columns.length) columns.push({ id: uid(), name: 'Imported', done: false });

  const donePicked = columns.filter((c) => c.done).map((c) => c.name);
  if (donePicked.length) {
    report.notes.push(`${donePicked.join(', ')} treated as done column`
      + `${donePicked.length === 1 ? '' : 's'}, from the name`);
  }
  if (closedLists.length) {
    const one = closedLists.length === 1;
    report.notes.push(`${closedLists.length} archived list${one ? '' : 's'}: `
      + `${one ? 'its' : 'their'} cards went to the archive`);
  }

  /* Checklists arrive as their own top-level objects, keyed by card. This app
     gives a task one flat checklist, so several are merged — with their names
     kept as a prefix, since "Design: sign-off" is worth more than "sign-off". */
  const checklistsByCard = new Map();
  for (const checklist of (data.checklists ?? [])) {
    if (!checklist?.idCard) continue;
    if (!checklistsByCard.has(checklist.idCard)) checklistsByCard.set(checklist.idCard, []);
    checklistsByCard.get(checklist.idCard).push(checklist);
  }
  let mergedChecklists = 0;

  /* Comments live in the action log rather than on the card. */
  const commentsByCard = new Map();
  for (const action of (data.actions ?? [])) {
    if (action?.type !== 'commentCard') continue;
    const cardId = action.data?.card?.id;
    const text = String(action.data?.text ?? '').trim();
    if (!cardId || !text) continue;
    if (!commentsByCard.has(cardId)) commentsByCard.set(cardId, []);
    commentsByCard.get(cardId).push({
      id: uid(),
      author: String(action.memberCreator?.fullName || action.memberCreator?.username || 'Trello'),
      text,
      createdAt: Date.parse(action.date) || now,
    });
  }
  // Trello writes newest first; a conversation reads the other way round.
  for (const list of commentsByCard.values()) list.sort((a, b) => a.createdAt - b.createdAt);

  const seen = { unusedFields: new Set() };

  function convert(card, index) {
    const checklists = (checklistsByCard.get(card.id) ?? []).sort(byPos);
    if (checklists.length > 1) mergedChecklists++;
    const checklist = checklists.flatMap((list) => (list.checkItems ?? []).sort(byPos)
      .map((item) => ({
        id: uid(),
        text: checklists.length > 1 && list.name
          ? `${list.name}: ${item.name ?? ''}`
          : String(item.name ?? ''),
        done: item.state === 'complete',
      })));
    report.checklistItems += checklist.length;

    const comments = commentsByCard.get(card.id) ?? [];
    report.comments += comments.length;

    /* Trello attachments are URLs on someone else's CDN. They come across as
       links rather than copies: downloading another service's files into a
       user's Drive is not this importer's business, and a link that breaks
       says so (#19). */
    const attachments = [];
    for (const att of (card.attachments ?? [])) {
      const url = safeHref(att?.url);
      if (!url) { report.skippedAttachments++; continue; }
      attachments.push({
        id: uid(),
        kind: 'url',
        url,
        name: String(att?.name || url.split('/').pop() || 'Attachment').slice(0, 120),
        size: 0,
        type: '',
        createdAt: Date.parse(att?.date) || now,
      });
      report.attachments++;
    }

    if (card.due && card.dueComplete) seen.unusedFields.add('due complete');
    if (card.idMembers?.some((id) => !memberByTrello.has(id))) seen.unusedFields.add('unknown members');
    if (card.cover?.idAttachment || card.cover?.color) seen.unusedFields.add('card covers');
    if (card.badges?.votes) seen.unusedFields.add('votes');
    if (Array.isArray(card.customFieldItems) && card.customFieldItems.length) {
      seen.unusedFields.add('custom fields');
    }

    return {
      id: uid(),
      title: String(card.name ?? '').trim().slice(0, 200) || 'Untitled card',
      description: String(card.desc ?? '').trim(),
      columnId: columnByTrello.get(card.idList) ?? columns[0].id,
      order: (index + 1) * 1024,
      assigneeIds: (card.idMembers ?? []).map((id) => memberByTrello.get(id)).filter(Boolean),
      labelIds: (card.idLabels ?? []).map((id) => labelByTrello.get(id)).filter(Boolean),
      priority: null,
      startDate: dayOf(card.start),
      dueDate: dayOf(card.due),
      milestoneId: null,
      checklist,
      comments,
      attachments,
      createdAt: Date.parse(card.dateLastActivity) || now,
      updatedAt: Date.parse(card.dateLastActivity) || now,
    };
  }

  const closedListIds = new Set(closedLists.map((l) => l.id));
  const cards = (data.cards ?? []).filter(Boolean).sort(byPos);
  const live = [];
  const archive = [];

  cards.forEach((card, index) => {
    const task = convert(card, index);
    if (card.closed || closedListIds.has(card.idList)) {
      archive.push({ ...task, archivedAt: now });
      report.archived++;
    } else {
      live.push(task);
      report.tasks++;
    }
  });

  if (mergedChecklists) {
    report.notes.push(`${mergedChecklists} card${mergedChecklists === 1 ? '' : 's'} had more than `
      + 'one checklist; the items were merged into one, keeping the checklist name');
  }
  if (report.attachments) {
    report.notes.push(report.attachments === 1
      ? '1 attachment came across as a link to Trello, not a copy'
      : `${report.attachments} attachments came across as links to Trello, not copies`);
  }
  if (report.skippedAttachments) {
    const one = report.skippedAttachments === 1;
    report.notes.push(`${report.skippedAttachments} attachment${one ? '' : 's'} had no usable `
      + `web address and ${one ? 'was' : 'were'} skipped`);
  }
  if (seen.unusedFields.size) {
    report.notes.push(`Not imported: ${[...seen.unusedFields].join(', ')}`);
  }
  report.notes.push('Trello has no priorities or milestones, so those are empty');

  return {
    doc: {
      v: 1,
      id: uid(),
      name: String(data.name ?? 'Imported board').slice(0, 60),
      color: PROJECT_COLORS[0],
      brief: String(data.desc ?? '').trim(),
      members: members.map(({ trelloId, ...m }) => m),
      labels: labels.map(({ trelloId, ...l }) => l),
      columns: columns.map(({ trelloId, ...c }) => c),
      tasks: live,
      milestones: [],
      archive,
      trash: [],
    },
    report: {
      ...report,
      columns: columns.length,
      labels: labels.length,
      members: members.length,
    },
  };
}
