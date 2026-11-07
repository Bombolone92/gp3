/**
 * Search results in the main column. The query lives in the route
 * (#/ws/:ref/search/:query) so results are shareable and the back button
 * works; typing runs a new search on Enter. Filters are parsed client-side
 * (in:#channel, from:@person, has:file, before:/after:) and resolved against
 * the workspace before the worker is asked, so a typo in a channel name is
 * reported here rather than answered with nothing.
 */
import { el, fieldId, listKeyNav, rerenderTabs, keepFocus, focusMemo, clearOnEscape, composing } from './dom.js';
import { icon, channelIcon } from './icons.js';
import { avatar, statusChip, rolePill, personLabel } from './avatar.js';
import { store } from '../lib/store.js';
import { api, isOldServer } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { highlightSnippet } from '../lib/format.js';
import { appLinkWords } from './applink.js';
import { relativeLong, fullDateTime } from '../lib/time.js';
import { parseQuery, words as queryWords, normalize } from '../shared/search.js';
import { parentOfThread } from '../shared/blocks.js';
import { searchIndexDialog, showMemberCard, openDmWith } from './dialogs.js';
import { toast } from './toast.js';

const TIPS = [
  ['in:#channel', 'only one channel'],
  ['in:@person', 'only your conversation with them'],
  ['from:@person', 'only their messages'],
  ['has:file', 'messages with attachments'],
  ['has:link', 'messages with a link'],
  ['before:2026-03-01', 'or after:, by date'],
];

export function createSearchView(initialQuery, { onQuery }) {
  const inputId = fieldId('search');
  const input = el('input.search-input', {
    id: inputId, type: 'search', value: initialQuery || '', placeholder: 'Search messages',
    'aria-label': 'Search messages', autocomplete: 'off', spellcheck: false, enterkeyhint: 'search',
  });
  const form = el('form.search-form', { role: 'search' },
    el('span.search-form-icon', { html: icon('search', 18, 2) }),
    input,
    el('button.icon-btn.icon-btn-sm.search-clear', {
      type: 'button', html: icon('x', 16, 2.2), 'aria-label': 'Clear search', hidden: !initialQuery,
      onclick: () => { input.value = ''; input.focus(); onQuery(''); },
    }));
  // The page's heading, said and not shown: the results take the main
  // column under a bar that is the search box itself, so the page had no
  // heading for a screen reader to land on, where every other view has its
  // title as one. Named after the words searched (see setQuery).
  const heading = el('h1.visually-hidden', {}, 'Search');
  const header = el('div.conv-header.search-header', {},
    el('button.icon-btn.back', {
      type: 'button', html: icon('arrowLeft', 20), 'aria-label': 'Back to conversations',
      onclick: () => navigate({ ws: store.wsId }),
    }),
    heading,
    form);
  const status = el('div.visually-hidden', { role: 'status', 'aria-live': 'polite' });
  const body = el('div.search-body', { role: 'region', 'aria-label': 'Search results' });
  // What kind of thing the results are, as tabs over the results:
  // messages and files come from the index, channels and people from the
  // workspace itself.
  const TABS = [['messages', 'Messages'], ['files', 'Files'], ['channels', 'Channels'], ['people', 'People']];
  let tab = 'messages';
  const tabs = el('div.conv-tabs.search-tabs', { role: 'tablist', 'aria-label': 'Result types', hidden: true });
  const renderTabs = () => {
    rerenderTabs(tabs, ...TABS.map(([key, label]) => el('button.conv-tab', {
      type: 'button', role: 'tab', 'aria-selected': String(tab === key), tabindex: tab === key ? 0 : -1,
      onclick: () => setTab(key),
    }, el('span', {}, label))));
  };
  tabs.addEventListener('keydown', (e) => {
    // Only the bare arrows are the tablist's: held with Alt, Cmd or Ctrl an
    // arrow is the browser's (Back and Forward, on Windows and in Chrome on
    // a Mac) or a shortcut's, and passes, as it does the lists and the
    // radiogroups; one during an IME composition is the IME's.
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.metaKey || e.ctrlKey || composing(e)) return;
    e.preventDefault();
    const keys = TABS.map(([k]) => k);
    setTab(keys[(keys.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length]);
    tabs.querySelector('[aria-selected="true"]')?.focus();
  });
  function setTab(next) {
    if (tab === next) return;
    tab = next;
    renderTabs();
    if (tab === 'messages' || tab === 'files') run();
    else render();
  }
  renderTabs();
  const root = el('div.main.search-view', {}, header, tabs, body, status);

  let query = initialQuery || '';
  let results = [];
  let cursor = null;
  let hasMore = false;
  let indexed = undefined;
  let failed = 0; // index writes this workspace has lost, as the worker counts them
  let loading = false;
  let paging = false; // the load out is for the next page (see run and draw)
  let error = null;
  let pageError = null; // the next page could not be read; the hits that came stand (see run and nextPage)
  let notice = null;
  let idle = false; // the notice is that there is nothing to look for yet, not that a filter names nothing
  let request = 0;
  let destroyed = false;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    onQuery(input.value.trim());
  });
  input.addEventListener('input', () => {
    form.querySelector('.search-clear').hidden = !input.value;
  });
  // Escape with a query in the box clears it the way the Clear button does,
  // results included, rather than leaving the results of words no longer there.
  clearOnEscape(input, () => onQuery(''));

  /* ---- resolving the query --------------------------------------------- */

  /** Turn typed names into ids; null plus a message when something is unknown. */
  function resolve(q) {
    const parsed = parseQuery(q);
    if (tab === 'files' && !parsed.has.includes('file')) parsed.has.push('file');
    const params = { q: parsed.text, has: parsed.has.join(','), before: parsed.before, after: parsed.after };
    if (parsed.bad.length) {
      // What to type instead, for the kind of filter that could not be read:
      // has: takes two words, before: and after: a date. One hint said how
      // dates look whatever had failed, so has:lnk was answered with a date.
      const hints = [];
      if (parsed.bad.some((p) => /^has:/i.test(p))) hints.push('has: takes file or link.');
      if (parsed.bad.some((p) => /^(before|after):/i.test(p))) hints.push('Dates look like 2026-03-01.');
      return { error: `Could not read ${parsed.bad.join(', ')}. ${hints.join(' ')}` };
    }
    // People are looked up among everyone the store knows, including those
    // met in shared channels, so in:@them and from:@them work for a direct
    // message or a channel that lives on another workspace. Someone who has
    // left keeps their name on what they wrote (the workspace, and each host,
    // keeps a card for them), and the worker filters by uuid, so they are
    // found too, after everyone still here: from:@them reads what they
    // wrote, in:@them the direct message still held with them.
    const people = store.membersByUsername();
    const former = (name) => {
      const cards = [store.ws?.former, ...[...store.links.values()].map((l) => l.ws?.former)];
      for (const list of cards) {
        for (const [uuid, f] of Object.entries(list || {})) if (String(f?.username || '').toLowerCase() === name) return { uuid, name: f.name, gone: true };
      }
      return null;
    };
    const find = (name) => people[name] || former(name);
    // @me is the reader: from:@me reads their own messages (as the README
    // offers), in:@me their own space.
    const me = { uuid: store.uuid };
    if (parsed.in) {
      if (parsed.in.startsWith('@')) {
        const name = parsed.in.slice(1).toLowerCase();
        const person = name === 'me' ? me : find(name);
        if (!person) return { error: `Nobody here is called @${name}` };
        const conv = name === 'me'
          ? store.dms().find((d) => d.others.length === 0)?.id
          : store.dms().find((d) => d.others.length === 1 && d.others[0] === person.uuid)?.id;
        if (!conv) return { error: name === 'me' ? 'You have not written in your own space yet' : `You have no direct messages with @${name} yet` };
        params.in = conv;
      } else {
        // Not a private channel nobody is left in (listed to admins only to be deleted): the worker has nothing to search there.
        const ch = Object.values(store.ws?.channels || {}).find((c) => c.name === parsed.in.toLowerCase() && !c.orphan);
        if (!ch) return { error: `There is no #${parsed.in} here` };
        params.in = ch.id;
      }
    }
    if (parsed.from) {
      const person = parsed.from === 'me' ? me : find(String(parsed.from).toLowerCase());
      if (!person) return { error: `Nobody here is called @${parsed.from}` };
      params.from = person.uuid;
    }
    if (!parsed.words.length && !parsed.has.length && !parsed.from) {
      return { error: parsed.in || parsed.before || parsed.after ? 'Add a word to look for, has:file / has:link, or from:@person' : 'Words need at least two letters', idle: true };
    }
    return { params, words: parsed.words };
  }

  /* ---- fetching -------------------------------------------------------- */

  async function run({ more = false } = {}) {
    const id = ++request;
    if (!more) {
      results = [];
      cursor = null;
      hasMore = false;
      error = null;
      pageError = null;
      notice = null;
    }
    if (!query.trim() || tab === 'channels' || tab === 'people') {
      loading = false;
      // What the region last said was the message count of an earlier
      // query; with nothing searched it says nothing.
      if (!query.trim()) status.textContent = '';
      render();
      return;
    }
    const r = resolve(query);
    if (r.idle || r.error) {
      notice = r.error;
      idle = !!r.idle;
      loading = false;
      // Said aloud as well as shown: the region otherwise kept announcing
      // the previous query's results over a column that reads "Nobody here
      // is called @x".
      status.textContent = notice;
      render();
      return;
    }
    // Where the keyboard is among the results before the wait takes their
    // place (on Try again, pressed): the wait has nothing to hold it, so it
    // fell to the page, and a search that failed again brought the words
    // back with nobody on the button. It comes back to the button then, and
    // lands on the results when they come (the list views do the same).
    const back = more ? null : focusMemo(body);
    loading = true;
    paging = more;
    render();
    try {
      // A conversation that lives on another workspace (a shared channel, a
      // direct message with someone met there) is searched where its
      // messages are; the store brings the ids back as the local ones.
      const { in: scope, ...rest } = r.params;
      const data = scope && store.hostOf(scope).ref !== store.wsId
        ? await store.searchIn(scope, { ...rest, cursor: more ? cursor : null })
        : await api.search(store.wsId, { ...r.params, cursor: more ? cursor : null });
      if (destroyed || id !== request) return;
      results = more ? results.concat(data.results) : data.results;
      cursor = data.cursor;
      hasMore = !!data.hasMore;
      indexed = data.indexed;
      failed = Number(data.failed) || 0;
      pageError = null;
      status.textContent = results.length
        ? `${results.length} result${results.length === 1 ? '' : 's'}${hasMore ? ', more available' : ''}`
        : hasMore ? 'Nothing so far; older months not searched yet' : 'No results';
    } catch (e) {
      if (destroyed || id !== request) return;
      // The next page refused (the network gone for a moment, the worker
      // down): the hits already read stand, and the failure is said under
      // them with a way to ask for that page again (see nextPage). Drawn as
      // the search having failed, the first page went from the screen for
      // "Could not search", and its Try again began the search over from the
      // newest month.
      if (more) {
        pageError = e;
        status.textContent = 'Could not load more results';
      } else {
        error = e;
        status.textContent = isOldServer(e) ? 'Search needs a newer server' : 'Could not search';
      }
    } finally {
      if (!destroyed && id === request) {
        loading = false;
        paging = false;
        render();
        back?.();
      }
    }
  }

  /* ---- rendering ------------------------------------------------------- */

  // The results are redrawn under the keyboard (the workspace changing
  // while a hit is focused, Load more pressed): the control comes back to
  // its place rather than falling to the page, as the Later view keeps its.
  function render() {
    if (destroyed) return;
    keepFocus(body, draw);
  }

  /**
   * What the People or the Channels tab shows, as one string: everyone in
   * the workspace and how they are, or every channel the reader may see and
   * whether they are in it. The two tabs list the workspace itself, so they
   * follow it as it moves (a person renamed, a dot changed, a channel made
   * or joined), compared before each redraw so nothing is drawn again for a
   * move no row shows (a read cursor, a star), as the Directory compares its
   * cards. Null on the tabs the index answers, which are drawn for their
   * hits. Drawn once when opened, the two tabs used to stand as they were
   * until the reader switched tabs or searched again.
   */
  function entitySig() {
    if (tab === 'people') {
      const rows = Object.entries(store.ws?.members || {})
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([uuid, m]) => [uuid, m.name, m.username, m.title || '', m.role || '', m.avatar || '', m.color || 0, m.org?.name || '', store.presenceOf(uuid), store.statusOf(uuid) || null]);
      return JSON.stringify(['people', store.uuid, rows]);
    }
    if (tab === 'channels') {
      const joined = new Set(store.joinedChannels().map((c) => c.id));
      const rows = [...store.joinedChannels(), ...(store.isGuest() ? [] : store.browsableChannels())]
        .map((c) => [c.id, c.name, c.topic || '', !!c.archived, !!c.private, !!c.shared, !!c.lost, c.postPolicy || '', c.count || 0, joined.has(c.id)]);
      return JSON.stringify(['channels', rows]);
    }
    return null;
  }
  let lastEntitySig = null;

  function draw() {
    lastEntitySig = entitySig();
    body.replaceChildren();
    tabs.hidden = !query.trim();
    if (!query.trim()) {
      body.append(tips('Search every channel and conversation you are in.'));
      return;
    }
    if (tab === 'channels') {
      body.append(channelResults());
      return;
    }
    if (tab === 'people') {
      body.append(peopleResults());
      return;
    }
    if (notice) {
      // "Nothing to search yet" fits a query with no words; a filter that
      // names nobody or no channel is a query that cannot run as written,
      // and the heading says what to do about it.
      body.append(el('div.empty', {}, el('div.empty-icon', { html: icon('search', 24) }), el('h3', {}, idle ? 'Nothing to search yet' : 'Check the filter'), el('p', {}, notice)), tips());
      return;
    }
    if (error) {
      body.append(errorState(error));
      return;
    }
    // The wait for a fresh search. Not for the next page asked for under an
    // empty one ("Search older months"): the page's words stay, and the
    // button pressed is drawn busy below, so the keyboard stays on it (see
    // moreButton); drawn as the wait, the button went with the words and the
    // keyboard fell to the page, where the hits that came never found it.
    if (loading && !results.length && !paging) {
      body.append(skeleton());
      return;
    }
    if (!results.length) {
      // The index is read a few months at a time, newest first (or from the
      // month a before: filter names); a page can come back empty with older
      // months still unread, so this is not yet "no results".
      body.append(el('div.empty', { style: { paddingTop: '48px' } },
        el('div.empty-icon', { html: icon(tab === 'files' ? 'files' : 'search', 24) }),
        el('h3', {}, hasMore ? `Nothing so far for “${query}”` : tab === 'files' ? `No files match “${query}”` : `No results for “${query}”`),
        el('p', {}, hasMore ? 'Older months have not been searched yet.' : 'Check the spelling, try fewer words, or widen the filters.')));
      if (hasMore) body.append(nextPage('Search older months'));
      if (indexed === null) body.append(unindexedNotice());
      else if (failed) body.append(failedNotice());
      return;
    }
    if (indexed === null) body.append(unindexedNotice());
    else if (failed) body.append(failedNotice());
    const words = queryWords(parseQuery(query).text);
    const groups = [];
    for (const m of results) {
      const last = groups[groups.length - 1];
      if (last && last.conv === m.conv) last.items.push(m);
      else groups.push({ conv: m.conv, items: [m] });
    }
    const list = el('div.search-results', { role: 'group', 'aria-label': 'Results' });
    for (const g of groups) {
      list.append(groupHeader(g.conv));
      for (const m of g.items) list.append(hit(m, words));
    }
    body.append(list);
    if (hasMore) body.append(nextPage('Load more results'));
    else body.append(el('p.search-end.muted.small', {}, `${results.length} result${results.length === 1 ? '' : 's'}`));
  }

  /**
   * The way to the next page: the button alone, or, after a page that
   * could not be read (see run), why it could not over a Try again that
   * asks for that page again. Under the hits, which stand.
   */
  function nextPage(label) {
    if (!pageError) return moreButton(label);
    return el('div', {},
      el('p.search-more-note.small', {}, `Could not load more results. ${pageError.message}`),
      moreButton('Try again'));
  }

  /**
   * Busy rather than disabled while the next page is read (see pressOnce in
   * dom.js): disabled, the button pressed from the keyboard was out of the
   * tab order, so the redraw put the keyboard on the last hit instead, where
   * it then stayed; busy, the keyboard stays on the button, and lands on
   * the hits that came when they are drawn. One page at a time: a second
   * press while the first is out asks nothing more.
   */
  function moreButton(label) {
    return el('div.search-more', {}, el('button.btn.btn-outline', {
      type: 'button', 'aria-busy': loading ? 'true' : null,
      onclick: () => { if (!loading) run({ more: true }); },
    }, loading ? 'Loading' : label));
  }

  /** The words of the query as typed, minus filters, for matching names. */
  function plainWords() {
    return queryWords(parseQuery(query).text);
  }
  // The query's words arrive normalized (lowercased, accents stripped), so
  // the names are compared the same way: "jose" finds José.
  const nameHit = (name, words) => {
    const n = normalize(String(name || ''));
    return words.length > 0 && words.every((w) => n.includes(w));
  };
  // What the status region says for the Channels and People tabs: their own
  // count, or that nothing matched. Left alone, the region kept the Messages
  // count ("3 results") under a column that reads "Nobody matches". Set only
  // when it changes, so a redraw does not say the same thing again.
  const say = (text) => { if (status.textContent !== text) status.textContent = text; };

  /** Channels whose name or topic carries every word: yours first, then ones you could join. */
  function channelResults() {
    const words = plainWords();
    const joined = new Set(store.joinedChannels().map((c) => c.id));
    const all = [...store.joinedChannels(), ...(store.isGuest() ? [] : store.browsableChannels())]
      .filter((c) => nameHit(`${c.name} ${c.topic || ''}`, words));
    if (!all.length) {
      const heading = `No channels match “${parseQuery(query).text || query}”`;
      say(heading);
      return el('div.empty', { style: { paddingTop: '48px' } },
        el('div.empty-icon', { html: icon('hash', 24) }),
        el('h3', {}, heading),
        el('p', {}, 'Channel names and topics are searched; private channels you are not in never appear.'));
    }
    say(`${all.length} channel${all.length === 1 ? '' : 's'}`);
    const list = el('div.search-results', { role: 'group', 'aria-label': 'Channels' });
    for (const c of all) {
      list.append(el('button.search-hit.search-entity', {
        type: 'button', 'aria-label': `${c.name}${joined.has(c.id) ? '' : ', not joined'}. Open`,
        onclick: () => navigate({ ws: store.wsId, conv: c.id, view: null }),
      },
      el('span.search-entity-icon', { html: icon(channelIcon(c), 18, 2) }),
      el('div.search-hit-body', {},
        el('div.search-hit-head', {}, el('strong', {}, c.name), c.archived && el('span.pill', {}, 'Archived'), !joined.has(c.id) && el('span.pill', {}, 'Not joined')),
        el('div.search-hit-text', {}, c.topic || `${c.count || 0} member${c.count === 1 ? '' : 's'}`)),
      el('span.search-hit-go', { html: icon('chevRight', 16) })));
    }
    return el('div', {}, list, el('p.search-end.muted.small', {}, `${all.length} channel${all.length === 1 ? '' : 's'}`));
  }

  /** People whose name, username, or title carries every word; opens their card. */
  function peopleResults() {
    const words = plainWords();
    const people = Object.entries(store.ws?.members || {})
      .filter(([, m]) => nameHit(`${m.name} ${m.username} ${m.title || ''}`, words))
      .sort(([, a], [, b]) => a.name.localeCompare(b.name));
    if (!people.length) {
      const heading = `Nobody matches “${parseQuery(query).text || query}”`;
      say(heading);
      return el('div.empty', { style: { paddingTop: '48px' } },
        el('div.empty-icon', { html: icon('users', 24) }),
        el('h3', {}, heading),
        el('p', {}, 'Names, usernames, and titles are searched.'));
    }
    say(`${people.length} ${people.length === 1 ? 'person' : 'people'}`);
    const list = el('div.search-results', { role: 'list' });
    for (const [uuid, m] of people) {
      // Named with how the person is (their dot, their status chip), as the
      // Directory's cards are: the label names the whole row to a screen
      // reader, so the chip's words and the dot went unheard (see personLabel).
      const main = el('button.search-hit.search-entity', {
        type: 'button', 'aria-label': personLabel(m.name, uuid, '. Profile'),
        onclick: () => showMemberCard(uuid, main),
      },
      avatar({ ...m, uuid }, { size: 'sm', state: store.presenceOf(uuid) }),
      el('div.search-hit-body', {},
        el('div.search-hit-head', {}, el('strong', {}, el('span', { dir: 'auto' }, m.name, uuid === store.uuid ? ' (you)' : ''), statusChip(uuid, { compact: true })), rolePill(uuid, { compact: true })),
        el('div.search-hit-text', {}, m.title || `@${m.username}`)));
      list.append(el('div.search-person', { role: 'listitem' }, main, uuid !== store.uuid && el('button.btn.btn-sm.btn-outline.search-entity-action', {
        type: 'button', 'aria-label': `Message ${m.name}`, onclick: () => openDmWith(uuid).catch((err) => toast(err.message, { icon: 'alert' })),
      }, 'Message')));
    }
    return el('div', {}, list, el('p.search-end.muted.small', {}, `${people.length} ${people.length === 1 ? 'person' : 'people'}`));
  }

  function groupHeader(conv) {
    const thread = parentOfThread(conv);
    const base = thread ? thread.conv : conv;
    const ch = store.channel(base);
    // The icon says what kind of conversation it is, so the name goes
    // without its hash (the Threads and Activity rows do the same): with
    // both, the heading read "# #general".
    return el('div.search-group', { role: 'presentation' },
      el('span', { html: icon(ch ? (ch.private ? 'lock' : 'hash') : 'message', 15, 2.2) }),
      el('span', { dir: 'auto' }, store.convTitle(base).replace(/^#/, '')),
      thread && el('span.pill', {}, 'Thread'));
  }

  function hit(m, words) {
    const member = store.author(m);
    const thread = parentOfThread(m.conv);
    const route = thread
      ? { ws: store.wsId, conv: thread.conv, thread: thread.seq, message: m.seq }
      : { ws: store.wsId, conv: m.conv, message: m.seq };
    const text = el('div.search-hit-text');
    text.innerHTML = highlightSnippet(m.text, words, 180, { appLink: appLinkWords });
    // A hit by someone who has left says so beside their name (the member
    // card says "No longer in this workspace"): found by from:@them, the
    // rows would otherwise read as a member's.
    const btn = el('button.search-hit', {
      type: 'button',
      'aria-label': `${member.name}${member.gone ? ' (left the workspace)' : ''}, ${relativeLong(m.ts)}, in ${store.convTitle(thread ? thread.conv : m.conv)}. Open message`,
      onclick: () => navigate(route),
    },
    avatar(member, { size: 'sm' }),
    el('div.search-hit-body', {},
      el('div.search-hit-head', {},
        el('strong', {}, el('span', { dir: 'auto' }, member.name), member.gone && el('span.muted.small.search-hit-left', { 'aria-hidden': 'true' }, ' (left)')),
        el('time', { datetime: new Date(m.ts).toISOString(), title: fullDateTime(m.ts) }, relativeLong(m.ts))),
      text,
      m.attachments?.length ? el('div.search-hit-meta', { html: icon('paperclip', 13, 2) }, el('span', {}, `${m.attachments.length} file${m.attachments.length === 1 ? '' : 's'}`)) : null),
    el('span.search-hit-go', { html: icon('chevRight', 16) }));
    return btn;
  }

  function tips(lead) {
    return el('div.search-tips', {},
      lead && el('p', {}, lead),
      el('p.search-tips-title', {}, 'Narrow it down'),
      el('dl', {}, ...TIPS.flatMap(([k, v]) => [
        el('dt', {}, el('button.search-tip', {
          type: 'button',
          onclick: () => {
            const cur = input.value.trim();
            input.value = `${cur ? `${cur} ` : ''}${k.split(':')[0]}:`;
            input.focus();
            form.querySelector('.search-clear').hidden = false;
          },
        }, k)),
        el('dd', {}, v)])));
  }

  function unindexedNotice() {
    const admin = store.isAdmin();
    return el('div.callout.search-notice', { html: icon('info', 16) },
      el('span', {}, admin
        ? 'Only messages posted since search arrived are indexed. Build the index to search everything.'
        : 'Only messages posted since search arrived are indexed. An admin can build the full index from Workspace settings.'),
      admin && el('button.btn.btn-sm', { type: 'button', onclick: () => searchIndexDialog({ onDone: () => run() }) }, 'Build index'));
  }

  /** The worker counts index writes it lost; past zero, results may be missing something until the index is rebuilt. */
  function failedNotice() {
    const admin = store.isAdmin();
    const n = failed.toLocaleString();
    return el('div.callout.search-notice', { html: icon('alert', 16) },
      el('span', {}, admin
        ? `${n} index ${failed === 1 ? 'write' : 'writes'} could not be stored, so some messages may be missing from results. Rebuild the index to recover them.`
        : `${n} index ${failed === 1 ? 'write' : 'writes'} could not be stored, so some messages may be missing from results. An admin can rebuild the index from Workspace settings.`),
      admin && el('button.btn.btn-sm', { type: 'button', onclick: () => searchIndexDialog({ onDone: () => run() }) }, 'Rebuild index'));
  }

  function errorState(e) {
    const old = isOldServer(e);
    return el('div.empty', { style: { paddingTop: '48px' } },
      el('div.empty-icon', { html: icon(old ? 'cloud' : 'wifiOff', 24) }),
      el('h3', {}, old ? 'Search needs a newer server' : 'Could not search'),
      el('p', {}, old
        ? 'This workspace runs on a server that does not know how to search yet. It updates the next time its owner opens Teamchat.'
        : e.message),
      !old && el('button.btn.mt', { type: 'button', onclick: () => run() }, 'Try again'));
  }

  function skeleton() {
    const box = el('div', { 'aria-busy': 'true', 'aria-label': 'Searching', style: { padding: '12px 20px' } });
    for (let i = 0; i < 5; i++) {
      box.append(el('div', { style: { display: 'grid', gridTemplateColumns: '24px 1fr', gap: '12px', padding: '10px 0' } },
        el('div.skeleton', { style: { width: '24px', height: '24px', borderRadius: '7px' } }),
        el('div', {},
          el('div.skeleton', { style: { width: '140px', height: '12px', marginBottom: '8px' } }),
          el('div.skeleton', { style: { width: `${45 + ((i * 29) % 40)}%`, height: '12px' } }))));
    }
    return box;
  }

  listKeyNav(body, '.search-hit');
  // The Messages and Files tabs are drawn again for the names and faces on
  // their hits; the People and Channels tabs for the workspace they list,
  // when what they show has changed (see entitySig; presence rides on the
  // activity poll, and only the People tab draws it). The keyboard stays
  // where it is across the redraw (see render).
  const listed = () => tab === 'people' || tab === 'channels';
  const offWorkspace = store.on('workspace', () => {
    if (listed()) { if (entitySig() !== lastEntitySig) render(); } else if (results.length) render();
  });
  const offActivity = store.on('activity', () => { if (tab === 'people' && entitySig() !== lastEntitySig) render(); });

  function setQuery(q) {
    const next = q || '';
    if (input.value !== next) input.value = next;
    form.querySelector('.search-clear').hidden = !next;
    heading.textContent = next ? `Search results for “${next}”` : 'Search';
    if (next === query && (results.length || loading || error || notice)) return;
    query = next;
    run();
  }

  setQuery(query);
  // The box takes focus to be typed in: always on a keyboard, and on a touch
  // screen only when there is nothing to search yet, since the keyboard
  // would otherwise come up over the results of a search opened from a link
  // (the rule the composer, the dialogs and the Directory follow).
  if (!query || !matchMedia('(pointer: coarse)').matches) {
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }, 0);
  }

  return {
    el: root,
    setQuery,
    focus: () => input.focus(),
    destroy() {
      destroyed = true;
      offWorkspace();
      offActivity();
    },
  };
}
