/**
 * Starting points for new pages, and the pages a new workspace begins with.
 * Blocks are plain specs for insertBlocks(); databases list their
 * properties, views and rows.
 */
const t = (text, extra = {}) => ({ type: 'paragraph', text, ...extra });
const h = (n, text) => ({ type: `h${n}`, text });
const todo = (text, checked = false, indent = 0) => ({ type: 'todo', text, checked, indent });
const bullet = (text, indent = 0) => ({ type: 'bulleted', text, indent });

export const TEMPLATES = [
  {
    id: 'meeting',
    name: 'Meeting notes',
    description: 'Agenda, notes and action items',
    icon: { name: 'users', color: 'blue' },
    blocks: () => [
      { type: 'callout', icon: 'calendar', bg: 'blue', delta: [{ insert: 'Date: ' }, { insert: new Date().toLocaleDateString(undefined, { dateStyle: 'long' }), attributes: { bold: true } }] },
      h(2, 'Attendees'),
      bullet(''),
      h(2, 'Agenda'),
      { type: 'numbered', text: '' },
      h(2, 'Notes'),
      t(''),
      h(2, 'Action items'),
      todo(''),
    ],
  },
  {
    id: 'brief',
    name: 'Project brief',
    description: 'Goals, scope and milestones',
    icon: { name: 'target', color: 'red' },
    blocks: () => [
      { type: 'callout', icon: 'lightbulb', bg: 'yellow', text: 'One sentence that explains why this project matters.' },
      h(2, 'Goals'),
      bullet(''),
      h(2, 'Out of scope'),
      bullet(''),
      h(2, 'Milestones'),
      todo('Kickoff'),
      todo('First review'),
      todo('Launch'),
      h(2, 'Open questions'),
      { type: 'toggle', text: 'Question' },
      t('', { indent: 1 }),
    ],
  },
  {
    id: 'weekly',
    name: 'Weekly plan',
    description: 'Priorities and a day-by-day list',
    icon: { name: 'calendarDays', color: 'green' },
    blocks: () => [
      h(2, 'Top priorities'),
      { type: 'numbered', text: '' },
      ...['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].flatMap((d) => [h(3, d), todo('')]),
      h(2, 'Notes'),
      t(''),
    ],
  },
  {
    id: 'tasks',
    name: 'Task board',
    description: 'A database with board and table views',
    icon: { name: 'kanban', color: 'purple' },
    database: {
      props: [
        { name: 'Status', type: 'status' },
        { name: 'Assignee', type: 'text' },
        { name: 'Due', type: 'date' },
      ],
      views: ['board', 'table'],
      rows: [
        { title: 'Write the project brief', status: 2 },
        { title: 'Review designs', status: 1 },
        { title: 'Plan the launch', status: 0 },
      ],
    },
  },
  {
    id: 'reading',
    name: 'Reading list',
    description: 'Books and articles to get to',
    icon: { name: 'bookOpen', color: 'orange' },
    database: {
      props: [
        { name: 'Type', type: 'select', options: ['Book', 'Article', 'Paper'] },
        { name: 'Author', type: 'text' },
        { name: 'Finished', type: 'checkbox' },
        { name: 'Link', type: 'url' },
      ],
      views: ['table', 'gallery'],
      rows: [],
    },
  },
];

export function templateById(id) {
  return TEMPLATES.find((x) => x.id === id) || null;
}

/** The first page in a brand new workspace. */
export function welcomeBlocks() {
  return [
    { type: 'callout', icon: 'sparkles', bg: 'purple', text: 'Welcome to your wiki. Everything here is saved as files in your own Puter cloud.' },
    h(2, 'Write'),
    t('Click anywhere and start typing. Type / for headings, lists, to-dos, toggles, quotes, code, images, tables and more.'),
    bullet('Markdown shortcuts work too: # for a heading, - for a list, [] for a to-do, > for a toggle, ``` for code.'),
    bullet('Select text to make it bold, italic, a link or a color.'),
    bullet('Drag the handle to the left of a block to move it, or click it for more options.'),
    h(2, 'Organize'),
    todo('Add a page from the sidebar with the + button', true),
    todo('Nest pages by dragging them onto each other in the sidebar'),
    todo('Star a page to keep it under Favorites'),
    { type: 'toggle', text: 'Keyboard shortcuts' },
    bullet('Search: Ctrl/Cmd + K', 1),
    bullet('New page: Ctrl/Cmd + Alt + N', 1),
    bullet('Move a block: Ctrl/Cmd + Shift + Up or Down', 1),
    bullet('Indent and outdent: Tab and Shift + Tab', 1),
    h(2, 'Share'),
    t('Use Share at the top right to invite people to a page and everything under it. They can view, comment or edit, and you see who is looking at the same page.'),
    { type: 'quote', text: 'Tip: pages can be databases too. Open Tasks in the sidebar to see a board.' },
  ];
}
