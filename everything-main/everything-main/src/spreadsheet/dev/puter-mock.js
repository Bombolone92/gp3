/**
 * Dev-only in-memory mock of the Puter SDK, used by /mock.html. Files and
 * settings persist in sessionStorage so a reload keeps state; nothing here
 * ships in the production build (Vite only builds index.html).
 *
 * Query flags: ?env=app simulates running inside the Puter desktop;
 * ?signedout starts signed out.
 */
(() => {
  const params = new URLSearchParams(location.search);
  const LS = 'spreadsheet-mock-state';
  const state = (() => {
    try { return JSON.parse(sessionStorage.getItem(LS)) || { kv: {}, fs: {} }; } catch { return { kv: {}, fs: {} }; }
  })();
  let signedIn = !params.has('signedout');
  const persist = () => { try { sessionStorage.setItem(LS, JSON.stringify(state)); } catch {} };
  const delay = (ms = 60) => new Promise((r) => setTimeout(r, ms));

  const b64 = (buf) => {
    // Spreading a big buffer into fromCharCode overflows the stack; go in chunks.
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
  const norm = (p) => String(p).replace(/^\/+/, '').replace(/\/+$/, '');
  // A file keeps its id across rewrites and renames, as on the drive; records from before ids were kept are known by their path.
  const item = (path, f) => ({
    path, name: path.split('/').pop(), is_dir: !f, size: f?.size ?? null,
    modified: f?.modified ?? Math.floor(Date.now() / 1000), created: f?.created ?? Math.floor(Date.now() / 1000), uid: f?.uid ?? `uid-${path}`,
  });
  const notFound = (p) => Object.assign(new Error(`${p} does not exist`), { code: 'subject_does_not_exist' });
  const dirs = new Set(Object.keys(state.fs).map((p) => p.split('/').slice(0, -1).join('/')).filter(Boolean));

  /** The scripted assistant: one step per request, decided by how far into the turn the transcript is. */
  function mockAgent(messages) {
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') { lastUser = i; break; }
    // A message with files attached is a list of parts: its text first, then each file's.
    const content = messages[lastUser]?.content;
    const parts0 = Array.isArray(content) ? content : [{ type: 'text', text: String(content || '') }];
    const ask = String(parts0[0]?.text || '').replace(/^<workbook_state>[\s\S]*?<\/workbook_state>\s*/, '');
    const files = parts0.filter((p) => p.type === 'image' || p.type === 'document' || /^<attached_file/.test(p.text || ''));
    const results = messages.slice(lastUser + 1).filter((m) => m.role === 'tool').map((m) => String(m.content));
    const call = (name, input) => ({ type: 'tool_use', id: `mock_${Math.random().toString(36).slice(2)}`, name, input });
    const say = (text) => text.match(/\S+\s*/g).map((w) => ({ type: 'text', text: w }));
    let parts;
    const info = (() => { try { return JSON.parse(results[0] || 'null'); } catch { return null; } })();
    const sheet = info?.sheets?.find((s) => s.name === info.active_sheet);
    const data = sheet && sheet.data !== 'empty' ? sheet.data : null;
    const quoted = (name) => (/^[A-Za-z_][\w.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);
    if (files.length && results.length === 0) {
      const kinds = files.map((p) => (p.type === 'image' ? `an image (${p.source.media_type}, ${Math.round(p.source.data.length * 0.75 / 1024)} KB)` : p.type === 'document' ? `a PDF (${Math.round(p.source.data.length * 0.75 / 1024)} KB)` : `a text file (${p.text.length.toLocaleString()} characters)`));
      parts = say(`Mock: I received ${kinds.join(', ')}. A real model would read ${files.length === 1 ? 'it' : 'them'} and fill in the sheet.`);
    } else if (results.length === 0) parts = [...say('Let me look at the workbook first.'), call('get_workbook_info', {})];
    else if (results.length === 1) {
      parts = data ? [call('read_range', { range: `${quoted(sheet.name)}!${data}` })] : say('This sheet is empty. Tell me what to build, for example "a monthly budget", and I will lay it out.');
    } else if (results.length === 2 && data) {
      const [start, end] = data.split(':');
      const col = (ref) => ref.replace(/\d+/g, '');
      const row = (ref) => Number(ref.replace(/\D+/g, ''));
      const lines = results[1].split('\n').filter((l) => /^\d+\t/.test(l));
      const first = lines[1]?.split('\t') || [];
      const cols = results[1].split('\n')[1]?.split('\t').slice(1) || [];
      if (/\b(chart|graph|plot)\b/i.test(ask)) parts = [...say('I will chart it.'), call('create_chart', { data_range: `${quoted(sheet.name)}!${data}`, type: 'column', title: 'Overview' })];
      else if (/\b(totals?|sum)\b/i.test(ask)) {
        const r2 = row(end || start);
        const values = [cols.map((c, i) => (i === 0 ? 'Total' : Number.isFinite(parseFloat(String(first[i + 1] || '').replace(/[^\d.-]/g, ''))) ? `=SUM(${c}${row(start) + 1}:${c}${r2})` : null))];
        parts = [...say('Adding a totals row with SUM formulas.'), call('write_cells', { start_cell: `${quoted(sheet.name)}!${col(start)}${r2 + 1}`, values })];
      } else if (/\b(bold|format|header|style)\b/i.test(ask)) parts = [call('format_cells', { range: `${quoted(sheet.name)}!${start}:${col(end || start)}${row(start)}`, bold: true, fill_color: '#e3f5e1', borders: 'outer' })];
      else if (/\b(clear|delete|remove)\b/i.test(ask)) parts = [call('clear_range', { range: `${quoted(sheet.name)}!${col(start)}${row(end || start)}:${end || start}` })];
      else {
        parts = say(`**${sheet.name}** holds data in ${data}: ${lines.length - 1} rows under a header of ${cols.length} columns.\n\n| Column | First value |\n|---|---|\n${(results[1].split('\n').find((l) => /^\d+\t/.test(l)) || '').split('\t').slice(1).map((h, i) => `| ${h || cols[i]} | ${first[i + 1] ?? ''} |`).join('\n')}\n\n- Ask me to *add totals*, *make a chart*, or *format the header*.\n- Click a reference such as ${data} to select it.`);
      }
    } else {
      const last = results.at(-1);
      parts = say(/^Error/.test(last) ? `That did not work: ${last.replace(/^Error:\s*/, '')}` : /declined/.test(last) ? 'Understood, I left it as it was.' : `Done. ${last.length < 200 ? `(${last})` : ''}`);
    }
    return (async function* stream() {
      for (const part of parts) { await delay(part.type === 'text' ? 25 : 250); yield part; }
    })();
  }

  window.puter = {
    env: params.get('env') || 'web',
    appID: 'mock-app',
    auth: {
      isSignedIn: () => signedIn,
      async signIn() { await delay(200); signedIn = true; return true; },
      signOut() { signedIn = false; },
      async getUser() { await delay(); return signedIn ? { username: 'demo', uuid: 'mock-uuid', email: 'demo@example.com' } : null; },
    },
    kv: {
      async get(key) { await delay(); return key in state.kv ? state.kv[key] : null; },
      async set(key, value) { await delay(); state.kv[key] = value; persist(); return true; },
      async del(key) { await delay(); delete state.kv[key]; persist(); return true; },
    },
    net: {
      // A stand-in for puter.net.fetch: a small CSV for any URL mentioning "csv", else the real fetch.
      async fetch(url) {
        if (/csv/i.test(String(url))) {
          await delay(300);
          return { ok: true, async text() { return 'City,Population\nParis,2148000\nBerlin,3645000\nMadrid,3223000\n'; } };
        }
        if (/\.xml$/i.test(String(url))) {
          await delay(300);
          return { ok: true, async text() { return '<catalog><book id="1"><title>Dune</title><price>9.99</price></book><book id="2"><title>Emma</title><price>4.5</price></book></catalog>'; } };
        }
        if (/html?$/i.test(String(url))) {
          await delay(300);
          return { ok: true, async text() { return '<html><body><h1>Mock page</h1><table><tr><th>Country</th><th>Capital</th></tr><tr><td>France</td><td>Paris</td></tr><tr><td>Spain</td><td>Madrid</td></tr></table><ul><li>alpha</li><li>beta</li></ul></body></html>'; } };
        }
        return fetch(url);
      },
    },
    ai: {
      // A stand-in for puter.ai.chat: echoes the question after a short wait. The assistant panel's
      // requests (a conversation with tools, streamed) get a small scripted agent instead: it looks the
      // workbook over, reads the data, then answers or makes one change the message asks for.
      async chat(prompt, ...rest) {
        const options = rest.find((o) => o && typeof o === 'object') || {};
        if (Array.isArray(prompt) && options.tools && options.stream) return mockAgent(prompt);
        await delay(500);
        const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
        // The formula helper's prompts get a plausible formula back; explanations get a sentence.
        if (/Reply with exactly one line containing only the formula/.test(text)) {
          const range = /Data occupies ([A-Z]+\d+:[A-Z]+\d+)/.exec(text)?.[1] || 'A1:A10';
          return { message: { role: 'assistant', content: `=SUM(${range})` } };
        }
        if (/explain spreadsheet formulas/i.test(text)) {
          const f = /Formula: (=.*)/.exec(text)?.[1] || '';
          return { message: { role: 'assistant', content: `Mock explanation: ${f} adds up or looks up the cells it names and shows the result here.` } };
        }
        const m = /(-?\d+(?:\.\d+)?)\s*[+*]\s*(-?\d+(?:\.\d+)?)/.exec(text);
        const answer = m ? String(text.includes('*') ? Number(m[1]) * Number(m[2]) : Number(m[1]) + Number(m[2])) : `Mock answer: ${text.split('\n')[0].slice(0, 60)}`;
        return { message: { role: 'assistant', content: answer } };
      },
    },
    fs: {
      async mkdir(path) { await delay(); dirs.add(norm(path)); return item(norm(path)); },
      async readdir(path) {
        await delay();
        const p = norm(path);
        if (!dirs.has(p) && !Object.keys(state.fs).some((k) => k.startsWith(`${p}/`))) throw notFound(p);
        return Object.entries(state.fs).filter(([k]) => k.startsWith(`${p}/`) && !k.slice(p.length + 1).includes('/')).map(([k, f]) => item(k, f));
      },
      async read(path) {
        await delay();
        const f = state.fs[norm(path)];
        if (!f) throw notFound(path);
        return new Blob([fromB64(f.b64)], { type: f.type });
      },
      async write(path, data, opts = {}) {
        await delay(120);
        let p = norm(path);
        if (opts.dedupeName && state.fs[p]) {
          const stem = p.replace(/\.[^.]+$/, '');
          const ext = p.slice(stem.length);
          let n = 1;
          while (state.fs[`${stem} (${n})${ext}`]) n++;
          p = `${stem} (${n})${ext}`;
        }
        const blob = data instanceof Blob ? data : new Blob([data ?? '']);
        const buf = await blob.arrayBuffer();
        const now = Math.floor(Date.now() / 1000);
        state.fs[p] = { b64: b64(buf), type: blob.type, size: buf.byteLength, modified: now, created: state.fs[p]?.created ?? now, uid: state.fs[p]?.uid ?? `uid-${Math.random().toString(36).slice(2)}` };
        dirs.add(p.split('/').slice(0, -1).join('/'));
        persist();
        console.log(`[puter-mock] wrote ${p} (${buf.byteLength} bytes)`);
        return item(p, state.fs[p]);
      },
      async delete(path) { await delay(); delete state.fs[norm(path)]; persist(); },
      async rename(path, newName) {
        await delay();
        const p = norm(path);
        const f = state.fs[p];
        if (!f) throw notFound(p);
        const target = `${p.split('/').slice(0, -1).join('/')}/${newName}`;
        delete state.fs[p];
        // Like the server: a rename or move stamps the file as modified, though its bytes are the same.
        state.fs[target] = { ...f, modified: Math.floor(Date.now() / 1000) };
        persist();
        return item(target, state.fs[target]);
      },
      async stat(path) {
        await delay(20);
        // Like the SDK: a file can be asked for by its id, wherever it is now.
        if (path && typeof path === 'object') {
          const found = Object.entries(state.fs).find(([, f]) => path.uid != null && f.uid === path.uid);
          if (!found) throw notFound(path.uid);
          return item(found[0], found[1]);
        }
        const p = norm(path);
        if (state.fs[p]) return item(p, state.fs[p]);
        if (dirs.has(p)) return item(p);
        throw notFound(p);
      },
      // Sharing, kept per file: "nobody" is a username with no account, and an unknown address is invited.
      async share(path, recipient, mode = 'read') {
        await delay();
        const p = norm(path);
        const f = state.fs[p];
        if (!f) throw notFound(p);
        const who = String(recipient).trim();
        if (who === 'demo' || who === 'demo@example.com') throw Object.assign(new Error('Cannot share with yourself'), { code: 'cannot_share_with_self' });
        if (who === 'nobody') throw Object.assign(new Error('No such user'), { code: 'user_does_not_exist' });
        const pending = who.includes('@') && !who.endsWith('@puter.com');
        const holder = pending ? null : who.replace(/@puter\.com$/, '');
        const shares = (state.shares ??= {})[f.uid] ??= [];
        const at = shares.findIndex((s) => (pending ? s.recipientEmail === who : s.holder === holder));
        const share = { uid: `share-${Math.random().toString(36).slice(2)}`, mode, path: p, name: p.split('/').pop(), entryUid: f.uid, isDir: false, issuer: 'demo', holder, inheritedFrom: null, issuedByApp: 'mock-app', ...(pending ? { pending: true, recipientEmail: who } : {}) };
        if (at >= 0) shares[at] = { ...share, uid: shares[at].uid }; else shares.push(share);
        persist();
        return [{ ...share, isNew: at < 0 }];
      },
      async unshare(path, recipient) {
        await delay();
        const f = state.fs[norm(path)];
        const shares = f ? state.shares?.[f.uid] || [] : [];
        const kept = shares.filter((s) => s.holder !== recipient && s.recipientEmail !== recipient);
        if (f) (state.shares ??= {})[f.uid] = kept;
        persist();
        return { revoked: shares.length - kept.length };
      },
      async getShares(path) {
        await delay();
        const f = state.fs[norm(path)];
        if (!f) throw notFound(path);
        return state.shares?.[f.uid] || [];
      },
      async listShared() { await delay(); return { items: [] }; },
      async getShareLink(path) {
        const f = state.fs[norm(path)];
        if (!f) throw notFound(path);
        return `https://puter.com/app/spreadsheet?file=${encodeURIComponent(f.uid)}`;
      },
    },
    ui: {
      setWindowTitle(t) { document.title = t; },
      onLaunchedWithItems() {},
      async showOpenFilePicker() {
        await delay();
        const names = Object.keys(state.fs).sort();
        if (!names.length) throw new Error('cancelled');
        const p = names[0];
        console.log(`[puter-mock] open picker → ${p}`);
        return item(p, state.fs[p]);
      },
      async showSaveFilePicker(data, suggestedName) {
        const p = `Desktop/${suggestedName || `export-${Date.now()}`}`;
        const it = await window.puter.fs.write(p, data);
        console.log(`[puter-mock] save picker → ${p}`);
        return it;
      },
    },
  };
})();
