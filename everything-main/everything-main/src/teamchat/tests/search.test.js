/**
 * Search, the pure parts: tokenizing, sharding, postings, query parsing,
 * and snippet highlighting. The index itself is exercised end to end in
 * worker.test.js.
 */
import { describe, it, expect } from 'vitest';
import {
  tokenize, words, indexTokens, shardOf, encodePosting, decodePosting, parseQuery, matchesWords,
  bucketOf, isBucket, scopedToken, legacyTerm, authorToken,
  SEARCH_SHARDS, SEARCH_TOKENS_PER_MESSAGE, TOKEN_FILE, TOKEN_LINK,
} from '../src/shared/search.js';
import { highlightSnippet } from '../src/lib/format.js';
import { parseHash, buildHash } from '../src/lib/router.js';

describe('tokenize', () => {
  it('lowercases, strips accents and punctuation, dedupes, drops stopwords', () => {
    expect(tokenize('The Deploy went out; DEPLOY again, café résumé!')).toEqual(['deploy', 'went', 'out', 'again', 'cafe', 'resume']);
    expect(tokenize('a I to of')).toEqual([]);
    expect(words('a I to of x')).toEqual(['to', 'of']); // words keeps stopwords, still drops one-letter tokens
  });

  it('keeps digits and unicode letters, bounds token length', () => {
    // A run of ideographs or kana is a clause, indexed by its pairs of characters rather than whole (see worker-c-pass12).
    expect(tokenize('v2 release 2026 日本語 テスト')).toEqual(['v2', 'release', '2026', '日本', '本語', 'テス', 'スト']);
    expect(tokenize('x'.repeat(30))).toEqual([]);
    expect(tokenize('ok')).toEqual(['ok']);
  });

  it('keeps words whose letters carry combining marks, and reads pointed Arabic and Hebrew as bare', () => {
    // A vowel sign or a virama is a mark, not a letter: split on marks, Hindi fell into single letters and indexed nothing.
    expect(tokenize('हिन्दी')).toEqual(['हिन्दी']);
    expect(tokenize('नमस्ते दुनिया')).toEqual(['नमस्ते', 'दुनिया']);
    expect(tokenize('สวัสดีครับ')).toEqual(['สวัสดีครับ']);
    // Optional pointing goes the way Latin accents do, so the bare spelling most people type finds the pointed one.
    expect(tokenize('مَرْحَبًا بالعالم')).toEqual(['مرحبا', 'بالعالم']);
    expect(tokenize('مرحبا')).toEqual(['مرحبا']);
    expect(tokenize('שָׁלוֹם עוֹלָם')).toEqual(['שלום', 'עולם']);
    expect(tokenize('Привет мир')).toEqual(['привет', 'мир']);
  });

  it('caps the words indexed per message and adds has: pseudo-tokens', () => {
    const many = Array.from({ length: SEARCH_TOKENS_PER_MESSAGE + 40 }, (_, i) => `word${i}`).join(' ');
    const t = indexTokens(many, { attachments: 1 });
    expect(t).toHaveLength(SEARCH_TOKENS_PER_MESSAGE + 1);
    expect(t.at(-1)).toBe(TOKEN_FILE);
    expect(indexTokens('see https://example.com/x')).toEqual(['see', 'https', 'example', 'com', TOKEN_LINK]);
    expect(indexTokens('')).toEqual([]);
    // An address in a code span is not a link (the renderer draws none); one in bold is.
    expect(indexTokens('code `https://a.io/x` here')).toEqual(['code', 'https', 'io', 'here']);
    expect(indexTokens('**https://a.io/x**')).toEqual(['https', 'io', TOKEN_LINK]);
  });
});

describe('shards and postings', () => {
  it('maps tokens to a stable shard in range', () => {
    for (const t of ['deploy', 'hello', '2026', 'テスト', TOKEN_FILE]) {
      const n = shardOf(t);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(SEARCH_SHARDS);
      expect(shardOf(t)).toBe(n);
    }
    expect(shardOf('deploy')).not.toBe(shardOf('deployed'));
  });

  it('buckets a timestamp by its UTC month', () => {
    expect(bucketOf(Date.UTC(2026, 7, 28, 12))).toBe('202608');
    expect(bucketOf(Date.UTC(2026, 0, 1, 0, 0, 0))).toBe('202601');
    expect(bucketOf(Date.UTC(2025, 11, 31, 23, 59, 59))).toBe('202512');
    expect(bucketOf('nope')).toBe('000000');
    expect(isBucket('202608')).toBe(true);
    expect(isBucket('legacy')).toBe(false);
    expect(isBucket('2026081')).toBe(false);
  });

  it('scopes pseudo-tokens to a conversation, threads under their parent, and maps them back', () => {
    expect(scopedToken(TOKEN_FILE, 'abc123')).toBe('_file@abc123');
    expect(scopedToken(TOKEN_LINK, 'abc123_t7')).toBe('_link@abc123');
    expect(legacyTerm('_file@abc123')).toBe(TOKEN_FILE);
    expect(legacyTerm(`${authorToken('u-1')}@abc123`)).toBe(authorToken('u-1'));
    expect(legacyTerm('deploy')).toBe('deploy');
    expect(legacyTerm('email@work')).toBe('email@work'); // a word is never a pseudo-token
    const t = indexTokens('see https://example.com/x', { attachments: 1, author: 'u-1', conv: 'abc123_t7' });
    expect(t).toEqual(['see', 'https', 'example', 'com', TOKEN_FILE, TOKEN_LINK, authorToken('u-1'), '_file@abc123', '_link@abc123', `${authorToken('u-1')}@abc123`]);
    expect(indexTokens('plain words', { conv: 'abc123' })).toEqual(['plain', 'words']);
  });

  it('round-trips postings, including thread ids', () => {
    const ts = 1756220000000;
    const p = encodePosting('abcdef1234_t7', 42, ts);
    expect(decodePosting(p)).toEqual({ conv: 'abcdef1234_t7', seq: 42, ts });
    expect(decodePosting('garbage')).toBeNull();
    expect(decodePosting('a:b:c')).toBeNull();
  });
});

describe('parseQuery', () => {
  it('separates words from filters', () => {
    const q = parseQuery('deploy notes in:#general from:@Ana has:file has:link before:2026-03-01 after:2025-12');
    expect(q.text).toBe('deploy notes');
    expect(q.words).toEqual(['deploy', 'notes']);
    expect(q.in).toBe('general');
    expect(q.from).toBe('ana');
    expect(q.has).toEqual(['file', 'link']);
    expect(q.before).toBe(new Date(2026, 2, 2).getTime() - 1);
    expect(q.after).toBe(new Date(2025, 11, 1).getTime());
    expect(q.bad).toEqual([]);
  });

  it('keeps @ for in:@person and reports filters it cannot read', () => {
    expect(parseQuery('in:@bob hi').in).toBe('@bob');
    const q = parseQuery('x has:video before:yesterday after:2026-13-01');
    expect(q.bad).toEqual(['has:video', 'before:yesterday', 'after:2026-13-01']);
    expect(parseQuery('   ').words).toEqual([]);
  });
});

describe('matchesWords', () => {
  it('requires every query word in the current text, stopwords included', () => {
    expect(matchesWords('The deploy went out', ['deploy', 'the'])).toBe(true);
    expect(matchesWords('The release went out', ['deploy'])).toBe(false);
    expect(matchesWords('anything', [])).toBe(true);
  });
});

describe('highlightSnippet', () => {
  it('marks a word whatever its accents or case, as the index matched it', () => {
    expect(highlightSnippet('a café here', ['cafe'])).toBe('a <mark>café</mark> here');
    expect(highlightSnippet('a cafe here', ['café'])).toBe('a <mark>cafe</mark> here');
    expect(highlightSnippet('Hello world', ['world'])).toBe('Hello <mark>world</mark>');
    expect(highlightSnippet('नमस्ते दुनिया', ['दुनिया'])).toBe('नमस्ते <mark>दुनिया</mark>'); // a word with vowel signs is marked whole
    expect(highlightSnippet('worldly', ['world'])).toBe('worldly');
  });
  it('marks whole words only and escapes everything else', () => {
    expect(highlightSnippet('Deploy <b>the</b> deployment', ['deploy'])).toBe('<mark>Deploy</mark> &lt;b&gt;the&lt;/b&gt; deployment');
  });

  it('never marks inside an entity', () => {
    expect(highlightSnippet('a & b, amp it up', ['amp'])).toBe('a &amp; b, <mark>amp</mark> it up');
  });

  it('windows long text around the first match', () => {
    const text = `${'filler '.repeat(40)}needle here ${'tail '.repeat(40)}`;
    const out = highlightSnippet(text, ['needle']);
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
    expect(out).toContain('<mark>needle</mark>');
    expect(out.length).toBeLessThan(260);
  });

  it('keeps code (it is indexed) and drops the fences and stray marker characters', () => {
    expect(highlightSnippet('see ```js\nconst a = 1;\n``` \uE001evil\uE002', ['const'])).toBe('see <mark>const</mark> a = 1; evil');
  });
});

describe('permalink and search routes', () => {
  it('round-trip through the router', () => {
    const cases = [
      { ws: 'a@b', conv: 'c1', message: 12 },
      { ws: 'a@b', conv: 'c1', thread: 4, message: 2 },
      { ws: 'a@b', conv: 'c1', thread: 4 },
      { ws: 'a@b', query: 'deploy in:#general' },
      { ws: 'a@b', query: '' },
    ];
    for (const c of cases) {
      const r = parseHash(buildHash(c));
      expect(r.ws).toBe(c.ws);
      if (c.query != null) {
        expect(r.name).toBe('search');
        expect(r.query).toBe(c.query);
      } else {
        expect(r.conv).toBe(c.conv);
        expect(r.thread).toBe(c.thread ?? null);
        expect(r.message).toBe(c.message ?? null);
      }
    }
    expect(buildHash({ ws: 'a@b', conv: 'c1', message: 12 })).toBe('#/ws/a%40b/c/c1/m/12');
    expect(buildHash({ ws: 'a@b', conv: 'c1', thread: 4, message: 2 })).toBe('#/ws/a%40b/c/c1/t/4/m/2');
    expect(parseHash('#/ws/a/c/b/m/notanumber').message).toBeNull();
    // A message link never also opens details.
    expect(parseHash(buildHash({ ws: 'a', conv: 'c', message: 3, details: true }))).toMatchObject({ message: 3, details: false });
  });
});
