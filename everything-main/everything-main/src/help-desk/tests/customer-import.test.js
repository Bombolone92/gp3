import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../src/app.js';
import { mount } from '../src/views/customers.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
class FakeReplica extends EventTarget {
  constructor() { super(); this.tickets = new Map(); this.users = new Map(); this.orgs = new Map(); this.members = {}; this.me = { role: 'owner' }; this.cfg = {}; this.meta = { name: 'A' }; }
  isAdmin() { return true; }
  agents() { return []; }
  upsert(kind, r) { this.users.set(r.id, r); this.dispatchEvent(new CustomEvent('change', { detail: { kinds: new Set(['u']) } })); }
  upsertMany(kind, list) { for (const r of list) this.users.set(r.id, r); this.dispatchEvent(new CustomEvent('change', { detail: { kinds: new Set(['u']) } })); }
}

afterEach(() => { document.body.textContent = ''; });

async function openImport() {
  app.replica = new FakeReplica();
  const posts = [];
  app.api = { post: async (path, body) => { posts.push(body); return { created: (body.rows || []).map((r, i) => ({ id: posts.length * 1000 + i, ...r })), skipped: 0 }; } };
  history.replaceState(null, '', '#/customers');
  const main = document.createElement('main');
  document.body.append(main);
  mount(main, { route: { query: {} } });
  main.querySelector('.people-empty .btn').click();
  const dlg = document.querySelector('dialog');
  const pick = async (text) => {
    const input = dlg.querySelector('input[type=file]');
    Object.defineProperty(input, 'files', { value: [new File([text], 'a.csv', { type: 'text/csv' })], configurable: true });
    input.dispatchEvent(new Event('change'));
    await tick(30);
  };
  return { dlg, pick, posts };
}

describe('customer import', () => {
  it('disables Import again after "Choose another file"', async () => {
    const { dlg, pick } = await openImport();
    await pick('Name,Email\nAna,ana@x.io\n');
    const btn = dlg.querySelector('.dialog-foot .btn-primary');
    expect(btn.disabled).toBe(false);
    dlg.querySelector('.import-file .link-btn').click();
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Import');
    expect(dlg.querySelector('input[type=file]').value).toBe('');
  });

  it('adds each batch of imported customers in one update', async () => {
    const { dlg, pick } = await openImport();
    let changes = 0;
    app.replica.addEventListener('change', () => { changes++; });
    await pick(`Name,Email\n${Array.from({ length: 250 }, (_, i) => `P${i},p${i}@x.io`).join('\n')}\n`);
    dlg.querySelector('.dialog-foot .btn-primary').click();
    await tick(50);
    expect(app.replica.users.size).toBe(250);
    expect(changes).toBe(2);
  });
});

describe('customer import encodings', () => {
  it('reads a CSV saved by Excel in Windows-1252, keeping accented names', async () => {
    const { dlg, pick, posts } = await openImport();
    // "Name,Email\nJosé Núñez,jose@x.io\n" in Windows-1252.
    await pick(new Uint8Array([...'Name,Email\nJos'].map((c) => c.charCodeAt(0)).concat([0xe9, 0x20, 0x4e, 0xfa, 0xf1, 0x65, 0x7a], [...',jose@x.io\n'].map((c) => c.charCodeAt(0)))));
    dlg.querySelector('.dialog-foot .btn-primary').click();
    await tick(50);
    expect(posts.at(-1).rows[0].name).toBe('José Núñez');
  });

  it('reads UTF-8 and Excel\'s UTF-16 "Unicode Text"', async () => {
    const { decodeCsv } = await import('../src/views/people-data.js');
    expect(decodeCsv(new TextEncoder().encode('Name\nZoë'))).toBe('Name\nZoë');
    const utf16 = new Uint8Array([0xff, 0xfe, ...[...'Name\tEmail'].flatMap((c) => [c.charCodeAt(0), 0])]);
    expect(decodeCsv(utf16)).toBe('Name\tEmail');
  });
});

describe('customer export', () => {
  it('marks the CSV as UTF-8 for spreadsheets', async () => {
    const { downloadText } = await import('../src/views/people-ui.js');
    let blob = null;
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = (b) => { blob = b; return 'blob:x'; };
    URL.revokeObjectURL = () => {};
    try {
      downloadText('customers.csv', 'Name\nZoë');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    } finally {
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
    }
  });
});
