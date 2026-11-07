/**
 * Starter bases. Each template is described by name and built through the
 * regular base operations, so links, inverse fields and formulas come out
 * exactly as if someone had set them up by hand.
 */
import { Base, makeChoice } from './base.js';
import { fromDisplay } from './formula.js';
import { newId } from '../lib/ids.js';

const sel = (...names) => names.map((n) => (Array.isArray(n) ? n : [n, null]));

export const TEMPLATES = [
  {
    id: 'projects',
    name: 'Project tracker',
    description: 'Projects with owners, budgets and deadlines, and the tasks that make them up.',
    color: 'blue',
    icon: 'rocket',
    tables: [
      {
        name: 'Projects',
        fields: [
          { name: 'Name', type: 'text' },
          { name: 'Status', type: 'singleSelect', choices: sel(['Planning', 'gray'], ['In progress', 'blue'], ['Blocked', 'red'], ['Done', 'green']) },
          { name: 'Owner', type: 'text' },
          { name: 'Start', type: 'date' },
          { name: 'Due', type: 'date' },
          { name: 'Budget', type: 'currency', options: { symbol: '$', precision: 0 } },
          { name: 'Notes', type: 'longText' },
        ],
        rows: [
          { Name: 'Website refresh', Status: 'In progress', Owner: 'Maya', Start: -20, Due: 25, Budget: 18000, Notes: 'New landing pages and a lighter design system.' },
          { Name: 'Mobile app beta', Status: 'Planning', Owner: 'Theo', Start: 10, Due: 70, Budget: 42000 },
          { Name: 'Customer survey', Status: 'Done', Owner: 'Ines', Start: -60, Due: -15, Budget: 3500, Notes: 'Results shared with the team.' },
          { Name: 'Office move', Status: 'Blocked', Owner: 'Sam', Start: -5, Due: 40, Budget: 9000, Notes: 'Waiting on the lease.' },
        ],
        views: [
          { type: 'kanban', name: 'By status', stack: 'Status' },
          { type: 'calendar', name: 'Deadlines', date: 'Due' },
          { type: 'timeline', name: 'Timeline', date: 'Start', end: 'Due' },
        ],
      },
      {
        name: 'Tasks',
        fields: [
          { name: 'Task', type: 'text' },
          { name: 'Done', type: 'checkbox' },
          { name: 'Due', type: 'date' },
          { name: 'Estimate', type: 'duration', options: { format: 'h:mm' } },
          { name: 'Priority', type: 'singleSelect', choices: sel(['High', 'red'], ['Medium', 'yellow'], ['Low', 'gray']) },
        ],
        rows: [
          { Task: 'Write page copy', Done: true, Due: -3, Estimate: 4 * 3600, Priority: 'High', Project: ['Website refresh'] },
          { Task: 'Design hero section', Due: 4, Estimate: 6 * 3600, Priority: 'High', Project: ['Website refresh'] },
          { Task: 'Set up analytics', Due: 12, Estimate: 2 * 3600, Priority: 'Medium', Project: ['Website refresh'] },
          { Task: 'Recruit beta testers', Due: 20, Estimate: 3 * 3600, Priority: 'Medium', Project: ['Mobile app beta'] },
          { Task: 'Draft questions', Done: true, Due: -40, Estimate: 2 * 3600, Priority: 'Low', Project: ['Customer survey'] },
          { Task: 'Collect quotes from movers', Due: 7, Estimate: 3600, Priority: 'Medium', Project: ['Office move'] },
        ],
        views: [{ type: 'grid', name: 'Open tasks', filter: [['Done', 'is', false]], sort: [['Due', 'asc']] }],
      },
    ],
    links: [{ from: 'Tasks', name: 'Project', to: 'Projects', inverse: 'Tasks' }],
    computed: [
      { table: 'Projects', name: 'Tasks done', type: 'rollup', link: 'Tasks', target: 'Done', fn: 'sum' },
      { table: 'Projects', name: 'Task count', type: 'count', link: 'Tasks' },
      { table: 'Projects', name: 'Progress', type: 'formula', formula: 'IF({Task count} > 0, ROUND({Tasks done} / {Task count} * 100) & "%", "")' },
    ],
  },
  {
    id: 'content',
    name: 'Content calendar',
    description: 'Plan posts across channels, track drafts and see what goes out when.',
    color: 'pink',
    icon: 'megaphone',
    tables: [
      {
        name: 'Posts',
        fields: [
          { name: 'Title', type: 'text' },
          { name: 'Status', type: 'singleSelect', choices: sel(['Idea', 'gray'], ['Drafting', 'yellow'], ['In review', 'purple'], ['Scheduled', 'blue'], ['Published', 'green']) },
          { name: 'Channels', type: 'multipleSelect', choices: sel(['Blog', 'blue'], ['Newsletter', 'teal'], ['Social', 'pink'], ['Video', 'orange']) },
          { name: 'Publish on', type: 'date' },
          { name: 'Author', type: 'text' },
          { name: 'Draft', type: 'url' },
          { name: 'Images', type: 'attachment' },
        ],
        rows: [
          { Title: 'Ten tips for remote teams', Status: 'Published', Channels: ['Blog', 'Social'], 'Publish on': -8, Author: 'Ari' },
          { Title: 'October product update', Status: 'Scheduled', Channels: ['Newsletter'], 'Publish on': 3, Author: 'Jo' },
          { Title: 'Behind the scenes', Status: 'Drafting', Channels: ['Video', 'Social'], 'Publish on': 12, Author: 'Kai' },
          { Title: 'Customer story: a small bakery', Status: 'In review', Channels: ['Blog'], 'Publish on': 6, Author: 'Ari' },
          { Title: 'Holiday hours', Status: 'Idea', Channels: ['Social'], Author: 'Jo' },
        ],
        views: [
          { type: 'calendar', name: 'Calendar', date: 'Publish on' },
          { type: 'kanban', name: 'Pipeline', stack: 'Status' },
          { type: 'gallery', name: 'Gallery', cover: 'Images' },
        ],
      },
    ],
  },
  {
    id: 'crm',
    name: 'Sales pipeline',
    description: 'Companies, contacts and deals, with weighted forecasts.',
    color: 'green',
    icon: 'briefcase',
    tables: [
      {
        name: 'Deals',
        fields: [
          { name: 'Deal', type: 'text' },
          { name: 'Stage', type: 'singleSelect', choices: sel(['Lead', 'gray'], ['Qualified', 'cyan'], ['Proposal', 'blue'], ['Negotiation', 'purple'], ['Won', 'green'], ['Lost', 'red']) },
          { name: 'Value', type: 'currency', options: { symbol: '$', precision: 0 } },
          { name: 'Probability', type: 'percent', options: { precision: 0 } },
          { name: 'Close date', type: 'date' },
        ],
        rows: [
          { Deal: 'Northwind annual plan', Stage: 'Negotiation', Value: 48000, Probability: 0.7, 'Close date': 14, Company: ['Northwind Supply'] },
          { Deal: 'Lumen pilot', Stage: 'Proposal', Value: 12000, Probability: 0.4, 'Close date': 30, Company: ['Lumen Studio'] },
          { Deal: 'Harbor expansion', Stage: 'Won', Value: 26000, Probability: 1, 'Close date': -10, Company: ['Harbor Freight Co'] },
          { Deal: 'Lumen add-on seats', Stage: 'Lead', Value: 5000, Probability: 0.1, 'Close date': 60, Company: ['Lumen Studio'] },
        ],
        views: [{ type: 'kanban', name: 'Pipeline', stack: 'Stage' }],
      },
      {
        name: 'Companies',
        fields: [
          { name: 'Company', type: 'text' },
          { name: 'Industry', type: 'singleSelect', choices: sel(['Retail', 'orange'], ['Design', 'pink'], ['Logistics', 'teal'], ['Software', 'blue']) },
          { name: 'Website', type: 'url' },
        ],
        rows: [
          { Company: 'Northwind Supply', Industry: 'Retail', Website: 'https://example.com/northwind' },
          { Company: 'Lumen Studio', Industry: 'Design', Website: 'https://example.com/lumen' },
          { Company: 'Harbor Freight Co', Industry: 'Logistics', Website: 'https://example.com/harbor' },
        ],
      },
      {
        name: 'Contacts',
        fields: [
          { name: 'Name', type: 'text' },
          { name: 'Email', type: 'email' },
          { name: 'Phone', type: 'phone' },
          { name: 'Role', type: 'text' },
        ],
        rows: [
          { Name: 'Priya Natarajan', Email: 'priya@example.com', Phone: '(555) 010-2231', Role: 'Head of operations', Company: ['Northwind Supply'] },
          { Name: 'Leo Martins', Email: 'leo@example.com', Phone: '(555) 010-4410', Role: 'Founder', Company: ['Lumen Studio'] },
          { Name: 'Grace Okafor', Email: 'grace@example.com', Role: 'Procurement', Company: ['Harbor Freight Co'] },
        ],
      },
    ],
    links: [
      { from: 'Deals', name: 'Company', to: 'Companies', inverse: 'Deals' },
      { from: 'Contacts', name: 'Company', to: 'Companies', inverse: 'Contacts' },
    ],
    computed: [
      { table: 'Deals', name: 'Weighted', type: 'formula', formula: '{Value} * {Probability}', format: 'currency', precision: 0 },
      { table: 'Companies', name: 'Pipeline value', type: 'rollup', link: 'Deals', target: 'Value', fn: 'sum' },
      { table: 'Companies', name: 'Open deals', type: 'count', link: 'Deals' },
    ],
  },
  {
    id: 'inventory',
    name: 'Inventory',
    description: 'Products, stock levels and reorder points, with stock value.',
    color: 'orange',
    icon: 'package',
    tables: [
      {
        name: 'Products',
        fields: [
          { name: 'Product', type: 'text' },
          { name: 'SKU', type: 'barcode' },
          { name: 'Category', type: 'singleSelect', choices: sel(['Stationery', 'blue'], ['Kitchen', 'orange'], ['Outdoor', 'green']) },
          { name: 'In stock', type: 'number' },
          { name: 'Reorder at', type: 'number' },
          { name: 'Unit cost', type: 'currency', options: { symbol: '$', precision: 2 } },
          { name: 'Rating', type: 'rating', options: { max: 5, icon: 'star', color: 'yellow' } },
          { name: 'Photo', type: 'attachment' },
        ],
        rows: [
          { Product: 'Dot grid notebook', SKU: 'ST-1001', Category: 'Stationery', 'In stock': 140, 'Reorder at': 50, 'Unit cost': 4.2, Rating: 5 },
          { Product: 'Gel pens, 10 pack', SKU: 'ST-1002', Category: 'Stationery', 'In stock': 35, 'Reorder at': 40, 'Unit cost': 6.5, Rating: 4 },
          { Product: 'Ceramic mug', SKU: 'KT-2001', Category: 'Kitchen', 'In stock': 60, 'Reorder at': 20, 'Unit cost': 3.1, Rating: 4 },
          { Product: 'Water bottle', SKU: 'OD-3001', Category: 'Outdoor', 'In stock': 12, 'Reorder at': 25, 'Unit cost': 7.8, Rating: 3 },
          { Product: 'Picnic blanket', SKU: 'OD-3002', Category: 'Outdoor', 'In stock': 18, 'Reorder at': 10, 'Unit cost': 14, Rating: 5 },
        ],
        views: [{ type: 'grid', name: 'By category', group: ['Category'] }, { type: 'gallery', name: 'Catalog', cover: 'Photo' }],
      },
    ],
    computed: [
      { table: 'Products', name: 'Stock value', type: 'formula', formula: '{In stock} * {Unit cost}', format: 'currency', precision: 2 },
      { table: 'Products', name: 'Reorder', type: 'formula', formula: 'IF({In stock} <= {Reorder at}, "Reorder", "")' },
    ],
  },
  {
    id: 'events',
    name: 'Event planning',
    description: 'Events, guest lists and RSVPs in one place.',
    color: 'purple',
    icon: 'calendar',
    tables: [
      {
        name: 'Events',
        fields: [
          { name: 'Event', type: 'text' },
          { name: 'Date', type: 'date', options: { includeTime: true } },
          { name: 'Venue', type: 'text' },
          { name: 'Capacity', type: 'number' },
        ],
        rows: [
          { Event: 'Team offsite', Date: 21, Venue: 'Lakeside lodge', Capacity: 40 },
          { Event: 'Product launch party', Date: 45, Venue: 'Rooftop terrace', Capacity: 120 },
        ],
        views: [{ type: 'calendar', name: 'Calendar', date: 'Date' }],
      },
      {
        name: 'Guests',
        fields: [
          { name: 'Guest', type: 'text' },
          { name: 'Email', type: 'email' },
          { name: 'RSVP', type: 'singleSelect', choices: sel(['Invited', 'gray'], ['Going', 'green'], ['Maybe', 'yellow'], ['Not going', 'red']) },
          { name: 'Plus ones', type: 'number' },
        ],
        rows: [
          { Guest: 'Alex Kim', Email: 'alex@example.com', RSVP: 'Going', 'Plus ones': 1, Event: ['Team offsite'] },
          { Guest: 'Bea Lund', Email: 'bea@example.com', RSVP: 'Maybe', Event: ['Team offsite', 'Product launch party'] },
          { Guest: 'Chris Diaz', Email: 'chris@example.com', RSVP: 'Invited', Event: ['Product launch party'] },
        ],
        views: [{ type: 'form', name: 'RSVP form' }, { type: 'kanban', name: 'RSVPs', stack: 'RSVP' }],
      },
    ],
    links: [{ from: 'Guests', name: 'Event', to: 'Events', inverse: 'Guests' }],
    computed: [{ table: 'Events', name: 'Guest count', type: 'count', link: 'Guests' }],
  },
  {
    id: 'bugs',
    name: 'Bug tracker',
    description: 'Report, triage and fix issues, grouped by severity.',
    color: 'red',
    icon: 'wrench',
    tables: [
      {
        name: 'Issues',
        fields: [
          { name: 'Summary', type: 'text' },
          { name: 'ID', type: 'autonumber' },
          { name: 'Severity', type: 'singleSelect', choices: sel(['Critical', 'red'], ['Major', 'orange'], ['Minor', 'yellow'], ['Trivial', 'gray']) },
          { name: 'Status', type: 'singleSelect', choices: sel(['New', 'blue'], ['Triaged', 'purple'], ['In progress', 'yellow'], ['Fixed', 'green'], ["Won't fix", 'gray']) },
          { name: 'Assignee', type: 'text' },
          { name: 'Steps to reproduce', type: 'longText' },
          { name: 'Reported', type: 'createdTime' },
        ],
        rows: [
          { Summary: 'Login button unresponsive on small screens', Severity: 'Major', Status: 'In progress', Assignee: 'Dana', 'Steps to reproduce': '1. Open the app on a phone\n2. Tap Login' },
          { Summary: 'Typo in the welcome email', Severity: 'Trivial', Status: 'Fixed', Assignee: 'Omar' },
          { Summary: 'Export fails for large files', Severity: 'Critical', Status: 'Triaged', Assignee: 'Dana' },
          { Summary: 'Dark mode contrast on badges', Severity: 'Minor', Status: 'New' },
        ],
        views: [{ type: 'grid', name: 'By severity', group: ['Severity'] }, { type: 'kanban', name: 'Board', stack: 'Status' }, { type: 'form', name: 'Report a bug' }],
      },
    ],
  },
];

function isoDay(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Build a template into { doc, records } ready for Store.createBase. */
export function buildTemplate(tpl, { user = '' } = {}) {
  const doc = { v: 1, id: newId('app'), name: tpl.name, color: tpl.color, icon: tpl.icon, tables: [] };
  const base = new Base(doc, {}, { user });
  const tables = new Map();
  const fieldOf = (tname, fname) => {
    const t = base.table(tables.get(tname));
    return t.fieldByName(fname);
  };
  for (const t of tpl.tables) {
    const fields = t.fields.map((f) => {
      const options = { ...(f.options || {}) };
      if (f.choices) {
        const choices = [];
        for (const [name, color] of f.choices) {
          const c = makeChoice(name, choices);
          if (color) c.color = color;
          choices.push(c);
        }
        options.choices = choices;
      }
      return { name: f.name, type: f.type, options };
    });
    const id = base.addTable(t.name, { fields: fields.slice(0, 1) });
    tables.set(t.name, id);
    for (const f of fields.slice(1)) base.addField(id, f);
  }
  for (const l of tpl.links || []) {
    const fid = base.addField(tables.get(l.from), { name: l.name, type: 'link', options: { tableId: tables.get(l.to) } });
    const inv = base.table(tables.get(l.from)).field(fid).options.inverseId;
    if (inv && l.inverse) base.updateField(tables.get(l.to), inv, { name: l.inverse });
  }
  // Rows (links are filled in once every record exists).
  const ids = new Map();
  const pendingLinks = [];
  for (const t of tpl.tables) {
    const tid = tables.get(t.name);
    const table = base.table(tid);
    const cellsList = (t.rows || []).map((row) => {
      const cells = {};
      for (const [k, v] of Object.entries(row)) {
        const f = table.fieldByName(k);
        if (!f) continue;
        if (f.type === 'link') {
          pendingLinks.push({ tid, rowName: row[table.primary.name], field: f, names: v });
          continue;
        }
        if (f.type === 'singleSelect') cells[f.id] = f.options.choices.find((c) => c.name === v)?.id;
        else if (f.type === 'multipleSelect') cells[f.id] = v.map((n) => f.options.choices.find((c) => c.name === n)?.id).filter(Boolean);
        else if (f.type === 'date' && typeof v === 'number') cells[f.id] = f.options.includeTime ? new Date(`${isoDay(v)}T18:00:00`).toISOString() : isoDay(v);
        else cells[f.id] = v;
      }
      return cells;
    });
    const created = base.createRecords(tid, cellsList);
    created.forEach((rid, i) => ids.set(`${t.name}:${t.rows[i][table.primary.name]}`, rid));
  }
  for (const p of pendingLinks) {
    const toName = [...tables].find(([, id]) => id === p.field.options.tableId)[0];
    const targets = p.names.map((n) => ids.get(`${toName}:${n}`)).filter(Boolean);
    const tname = [...tables].find(([, id]) => id === p.tid)[0];
    base.setCell(p.tid, ids.get(`${tname}:${p.rowName}`), p.field.id, targets);
  }
  for (const c of tpl.computed || []) {
    const tid = tables.get(c.table);
    const table = base.table(tid);
    if (c.type === 'formula') {
      base.addField(tid, { name: c.name, type: 'formula', options: { formula: fromDisplay(c.formula, table.fields), format: c.format || 'auto', precision: c.precision ?? 2 } });
    } else {
      const link = table.fieldByName(c.link);
      const target = c.target ? base.table(link.options.tableId).fieldByName(c.target) : null;
      base.addField(tid, { name: c.name, type: c.type, options: { linkFieldId: link.id, targetFieldId: target?.id || null, fn: c.fn || 'sum', precision: 0 } });
    }
  }
  // Extra views.
  for (const t of tpl.tables) {
    const tid = tables.get(t.name);
    for (const v of t.views || []) {
      const vid = base.addView(tid, v.type, v.name);
      const patch = {};
      if (v.stack) patch.stackFieldId = fieldOf(t.name, v.stack).id;
      if (v.date) patch.dateFieldId = fieldOf(t.name, v.date).id;
      if (v.end) patch.endFieldId = fieldOf(t.name, v.end).id;
      if (v.cover) patch.coverFieldId = fieldOf(t.name, v.cover).id;
      if (v.group) patch.groups = v.group.map((n) => ({ fieldId: fieldOf(t.name, n).id, dir: 'asc' }));
      if (v.sort) patch.sorts = v.sort.map(([n, dir]) => ({ fieldId: fieldOf(t.name, n).id, dir }));
      if (v.filter) patch.filters = { conjunction: 'and', conditions: v.filter.map(([n, op, value]) => ({ id: newId('flt'), fieldId: fieldOf(t.name, n).id, op, value })) };
      if (Object.keys(patch).length) base.updateView(tid, vid, patch);
    }
  }
  const records = {};
  for (const [, tid] of tables) records[tid] = [...base.table(tid).records.values()];
  return { doc: base.doc, records };
}
