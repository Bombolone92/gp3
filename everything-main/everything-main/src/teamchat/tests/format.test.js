import { describe, it, expect } from 'vitest';
import { formatMessage, previewText, initials, formatBytes, escapeHtml, safeHref } from '../src/lib/format.js';

const members = { alice: { uuid: 'u1', name: 'Alice A' }, bob: { uuid: 'u2', name: 'Bob' } };

describe('formatMessage', () => {
  it('escapes HTML so user text can never inject markup', () => {
    expect(formatMessage('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(formatMessage('a & b "c"')).toBe('a &amp; b &quot;c&quot;');
  });

  it('does not let text impersonate a lifted code span', () => {
    // The formatter parks inline code behind a private-use character while it
    // applies the rest; text that carries that character must not come back
    // as a copy of someone else's code.
    const ph = '\uE000';
    expect(formatMessage(`\`code\` ${ph}0${ph}`)).toBe('<code class="code-inline">code</code> 0');
    expect(formatMessage(`${ph}7${ph}`)).toBe('7');
  });

  it('renders the inline subset', () => {
    expect(formatMessage('**bold** and _italic_ and ~gone~')).toBe('<strong>bold</strong> and <em>italic</em> and <s>gone</s>');
    expect(formatMessage('snake_case_name stays')).toBe('snake_case_name stays');
    expect(formatMessage('line one\nline two')).toBe('line one<br>line two');
  });

  it('leaves code untouched, including markup and formatting characters', () => {
    expect(formatMessage('use `<b>**x**</b>` here')).toBe('use <code class="code-inline">&lt;b&gt;**x**&lt;/b&gt;</code> here');
    expect(formatMessage('```js\nconst a = "<x>";\n```')).toBe('<pre class="code-block" data-lang="js"><code>const a = &quot;&lt;x&gt;&quot;;</code></pre>');
    expect(formatMessage('```\n**not bold**\n```')).toContain('**not bold**');
  });

  it('links URLs safely and trims trailing punctuation', () => {
    const out = formatMessage('see https://example.com/a?b=1&c=2. ok');
    expect(out).toBe('see <a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer nofollow">https://example.com/a?b=1&amp;c=2</a>. ok');
    expect(formatMessage('javascript:alert(1)')).not.toContain('<a');
    expect(formatMessage('(https://x.io/path)')).toContain('href="https://x.io/path"');
    // Quotes and angle brackets around a link (pasted from mail) are not part of it.
    expect(formatMessage('see <https://example.com> ok')).toBe('see &lt;<a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">https://example.com</a>&gt; ok');
    expect(formatMessage('"https://example.com/a" said')).toContain('href="https://example.com/a"');
    expect(formatMessage("'https://example.com/b'")).toContain('href="https://example.com/b"');
  });

  it('keeps a bracket pair inside an address, ends at a lone closing bracket or a code span, and takes any case of scheme', () => {
    const A = 'target="_blank" rel="noopener noreferrer nofollow"';
    expect(formatMessage('https://en.wikipedia.org/wiki/Foo_(bar) x')).toBe(`<a href="https://en.wikipedia.org/wiki/Foo_(bar)" ${A}>https://en.wikipedia.org/wiki/Foo_(bar)</a> x`);
    // A quote inside a bracket group ends the address as it does outside one, rather than putting its entity in the href.
    expect(formatMessage("https://a.io/(it's)")).toBe(`<a href="https://a.io/(it" ${A}>https://a.io/(it</a>&#39;s)`);
    expect(formatMessage('https://a.io/x?q=[1] y')).toContain('href="https://a.io/x?q=[1]"');
    expect(formatMessage('https://a.io/x?y=(a)(b)')).toContain('href="https://a.io/x?y=(a)(b)"');
    expect(formatMessage('(see https://a.io/b) ok')).toBe(`(see <a href="https://a.io/b" ${A}>https://a.io/b</a>) ok`);
    expect(formatMessage('[see](https://a.io/b) ok')).toContain('href="https://a.io/b"');
    expect(formatMessage('https://a.io/(open x')).toContain('href="https://a.io/(open"');
    // A URL ending in an ampersand keeps it, and nothing else (it used to grow an "amp").
    expect(formatMessage('https://a.io/?a=1& ok')).toBe(`<a href="https://a.io/?a=1&amp;" ${A}>https://a.io/?a=1&amp;</a> ok`);
    // Inline code right after a link is code, not part of the address.
    expect(formatMessage('see https://a.io/`code` here')).toBe(`see <a href="https://a.io/" ${A}>https://a.io/</a><code class="code-inline">code</code> here`);
    expect(formatMessage('HTTPS://EXAMPLE.COM/x')).toContain('href="HTTPS://EXAMPLE.COM/x"');
  });

  it('never carries emphasis markup or a code span into an address', () => {
    // The emphasis rules run before links are lifted; a bracket group that
    // now holds a tag is not part of the address.
    const em = formatMessage('https://x.io/(_foo_) ok');
    expect(em).toContain('<a href="https://x.io/" ');
    expect(em).not.toContain('href="https://x.io/(<');
    expect(em).toContain('<em>foo</em>');
    const code = formatMessage('https://x.io/a(`code`) ok');
    expect(code).toContain('<a href="https://x.io/a" ');
    expect(code).toContain('<code class="code-inline">code</code>');
    expect(code).not.toMatch(/\uE000/);
  });

  it('never rewrites the inside of a link', () => {
    const members = { alice: { uuid: 'u1', name: 'Alice' } };
    // A handle in a URL is a path segment, not a mention.
    const out = formatMessage('see https://github.com/@alice now', { members, me: 'u1' });
    expect(out).toBe('see <a href="https://github.com/@alice" target="_blank" rel="noopener noreferrer nofollow">https://github.com/@alice</a> now');
    // A shortcode-shaped path, and emphasis markers, stay literal inside a link.
    expect(formatMessage('https://x.io/:tada:/a_b_c')).toContain('href="https://x.io/:tada:/a_b_c"');
    expect(formatMessage('**https://x.io/z**')).toBe('<strong><a href="https://x.io/z" target="_blank" rel="noopener noreferrer nofollow">https://x.io/z</a></strong>');
  });

  it('renders quotes as a block', () => {
    expect(formatMessage('> quoted\n> more\nafter')).toBe('<blockquote class="quote">quoted<br>more</blockquote>after');
  });

  it('turns known @mentions into chips and highlights mine', () => {
    const out = formatMessage('hi @alice, @bob and @nobody', { members, me: 'u1' });
    expect(out).toContain('<span class="mention mention-me" data-uuid="u1">@Alice A</span>');
    expect(out).toContain('<span class="mention" data-uuid="u2">@Bob</span>');
    expect(out).toContain('@nobody');
    expect(formatMessage('mail me@alice.com', { members })).not.toContain('mention');
    // Quoted or bracketed, the mention still counts (the worker notifies it): it renders as one too.
    expect(formatMessage('"@alice" owns this', { members, me: 'u1' })).toBe('&quot;<span class="mention mention-me" data-uuid="u1">@Alice A</span>&quot; owns this');
    expect(formatMessage('(@bob)', { members })).toContain('data-uuid="u2"');
    // A word that is a property of every object is not a member.
    expect(formatMessage('call @constructor and @toString', { members })).toBe('call @constructor and @toString');
  });

  it('styles @channel, @here and @everyone as broadcasts, never as people', () => {
    const out = formatMessage('hey @channel and @here, also @everyone', { members: { channel: { uuid: 'x', name: 'Fake' } }, me: 'u1' });
    expect(out).toBe('hey <span class="mention mention-broadcast">@channel</span> and <span class="mention mention-broadcast">@here</span>, also <span class="mention mention-broadcast">@everyone</span>');
    expect(formatMessage('@channels is a word')).toBe('@channels is a word');
  });
});

describe('helpers', () => {
  it('previewText flattens formatting', () => {
    expect(previewText('**hi**\n```code```\nthere')).toBe('hi [code] there');
    expect(previewText('x'.repeat(100), 10)).toHaveLength(10);
  });
  it('initials', () => {
    expect(initials('🚀 Rocket Team')).toBe('🚀T');
    expect(initials('🚀team')).toBe('🚀T');
    expect(initials('Ava Chen')).toBe('AC');
    expect(initials('alice')).toBe('AL');
    expect(initials('Jean Luc Picard')).toBe('JP');
    expect(initials('')).toBe('?');
  });
  it('formatBytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
  it('safeHref admits http(s) alone', () => {
    expect(safeHref('https://a.io/x?y=1')).toBe('https://a.io/x?y=1');
    expect(safeHref('HTTP://a.io')).toBe('HTTP://a.io');
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'vbscript:x', 'file:///etc', '//a.io', '', null, undefined, { toString: () => 'javascript:1' }]) expect(safeHref(bad)).toBeNull();
  });
  it('escapeHtml', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
