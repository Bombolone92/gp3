/**
 * Starting points for a new document. A template is a list of blocks the
 * Document API can create on a blank document: styled paragraphs, headings,
 * lists, and tables. Square-bracketed text marks what to replace.
 */

/** Today's date the way a letter would carry it, in the user's locale. */
export const today = (date = new Date()) => date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

const p = (text = '') => ({ kind: 'paragraph', text });
const h = (level, text) => ({ kind: 'heading', level, text });
const title = (text) => ({ kind: 'title', text });
const subtitle = (text) => ({ kind: 'subtitle', text });
const bullets = (...items) => ({ kind: 'bullets', items });
const numbers = (...items) => ({ kind: 'numbers', items });
const table = (rows) => ({ kind: 'table', rows });

export const TEMPLATES = [
  {
    id: 'letter', name: 'Letter', icon: 'brand', description: 'Sender, date, greeting, body, and sign-off',
    blocks: () => [
      p('[Your name]'), p('[Street address]'), p('[City, State ZIP]'), p(''),
      p(today()), p(''),
      p('[Recipient name]'), p('[Company]'), p('[Street address]'), p('[City, State ZIP]'), p(''),
      p('Dear [Recipient name],'), p(''),
      p('[Open with the reason you are writing. Keep the first paragraph to two or three sentences.]'), p(''),
      p('[Add the details in the second paragraph: what happened, what you need, or what you are offering.]'), p(''),
      p('[Close with the next step and a thank-you.]'), p(''),
      p('Sincerely,'), p(''), p('[Your name]'),
    ],
  },
  {
    id: 'meeting', name: 'Meeting notes', icon: 'clock', description: 'Attendees, agenda, notes, and action items',
    blocks: () => [
      title('Meeting notes'), subtitle(today()),
      h(2, 'Attendees'), bullets('[Name]', '[Name]', '[Name]'),
      h(2, 'Agenda'), numbers('[First topic]', '[Second topic]', '[Third topic]'),
      h(2, 'Notes'), p('[Decisions made and points raised.]'),
      h(2, 'Action items'), table([['Owner', 'Action', 'Due'], ['[Name]', '[What]', '[When]'], ['[Name]', '[What]', '[When]']]),
    ],
  },
  {
    id: 'report', name: 'Report', icon: 'outline', description: 'Title page, summary, and numbered sections',
    blocks: () => [
      title('[Report title]'), subtitle('[Subtitle or author] · ' + today()),
      h(1, 'Summary'), p('[One paragraph that states the question, the finding, and the recommendation.]'),
      h(1, 'Background'), p('[Why this matters and what was already known.]'),
      h(1, 'Findings'), h(2, '[First finding]'), p('[Evidence and discussion.]'), h(2, '[Second finding]'), p('[Evidence and discussion.]'),
      h(1, 'Recommendations'), numbers('[First recommendation]', '[Second recommendation]'),
      h(1, 'Appendix'), p('[Sources, data, and methods.]'),
    ],
  },
  {
    id: 'resume', name: 'Résumé', icon: 'edit', description: 'Contact details, experience, education, skills',
    blocks: () => [
      title('[Your name]'), subtitle('[City] · [Phone] · [Email] · [Website]'),
      h(2, 'Summary'), p('[Two or three sentences on what you do and what you are looking for.]'),
      h(2, 'Experience'), h(3, '[Job title], [Company] — [Start] to [End]'), bullets('[Achievement with a number]', '[Responsibility that shows scope]', '[Skill or tool used]'),
      h(3, '[Job title], [Company] — [Start] to [End]'), bullets('[Achievement with a number]', '[Responsibility that shows scope]'),
      h(2, 'Education'), p('[Degree], [School] — [Year]'),
      h(2, 'Skills'), p('[Skill] · [Skill] · [Skill] · [Skill]'),
    ],
  },
  {
    id: 'essay', name: 'Essay', icon: 'text', description: 'Title, thesis, body paragraphs, conclusion',
    blocks: () => [
      title('[Essay title]'), subtitle('[Your name] · [Course] · ' + today()),
      p('[Introduction: set the scene and end with the thesis in one sentence.]'),
      p('[First body paragraph: one claim, the evidence for it, and why it matters.]'),
      p('[Second body paragraph.]'),
      p('[Third body paragraph.]'),
      p('[Conclusion: restate the thesis in new words and say what follows from it.]'),
      h(2, 'References'), p('[Author, Title, Year.]'),
    ],
  },
];

export function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}

const ok = (r, what) => {
  if (r == null || (r.success === false && r.failure?.code !== 'NO_OP')) throw new Error(r?.failure?.message || `${what} failed`);
  return r;
};
const paragraph = (nodeId) => ({ kind: 'block', nodeType: 'paragraph', nodeId });
const end = { kind: 'documentEnd' };

/**
 * Create a template's blocks at the end of the document, then drop the empty
 * paragraph a blank document starts with. Resolves the number of blocks
 * created; throws on the first failure.
 */
export async function applyTemplate(api, template) {
  const before = (await api.blocks.list())?.blocks || [];
  const blocks = typeof template.blocks === 'function' ? template.blocks() : template.blocks;
  let created = 0;
  for (const b of blocks) {
    if (b.kind === 'heading') {
      ok(await api.create.heading({ level: b.level, text: b.text, at: end }), 'Heading');
    } else if (b.kind === 'title' || b.kind === 'subtitle') {
      const r = ok(await api.create.paragraph({ text: b.text, at: end }), 'Paragraph');
      ok(await api.styles.paragraph.setStyle({ target: paragraph(r.paragraph.nodeId), styleId: b.kind === 'title' ? 'Title' : 'Subtitle' }), 'Style');
    } else if (b.kind === 'bullets' || b.kind === 'numbers') {
      for (const item of b.items) {
        const r = ok(await api.create.paragraph({ text: item, at: end }), 'Paragraph');
        ok(await api.lists.apply({ target: paragraph(r.paragraph.nodeId), seed: b.kind === 'bullets' ? 'bullet' : 'ordered' }), 'List');
      }
    } else if (b.kind === 'table') {
      const rows = b.rows.length;
      const columns = Math.max(...b.rows.map((r) => r.length));
      const r = ok(await api.create.table({ rows, columns, at: end }), 'Table');
      const nodeId = r.table?.nodeId;
      if (nodeId && api.tables?.setCellText) {
        for (let i = 0; i < rows; i++) {
          for (let j = 0; j < b.rows[i].length; j++) {
            if (b.rows[i][j]) ok(await api.tables.setCellText({ nodeId, rowIndex: i, columnIndex: j, text: b.rows[i][j] }), 'Cell');
          }
        }
      }
    } else {
      ok(await api.create.paragraph({ text: b.text || '', at: end }), 'Paragraph');
    }
    created += 1;
  }
  // A blank document opens with one empty paragraph ahead of the template.
  if (created && before.length === 1 && before[0].isEmpty && api.blocks.delete) {
    try { await api.blocks.delete({ target: paragraph(before[0].nodeId) }); } catch { /* leave the blank line */ }
  }
  return created;
}
