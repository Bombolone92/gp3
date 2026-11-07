// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import landingHTML from '../src/views/landing.html?raw';
import { articles, articlePath, collections, SITE_URL } from '../site/content.js';
import { publicPaths, renderPage, renderSitemap } from '../site/render.js';
import { initResourceSearch } from '../site/client.js';

const parse = (html) => new DOMParser().parseFromString(html, 'text/html');
afterEach(() => { document.body.replaceChildren(); });

describe('public documentation and guides', () => {
  it('renders complete indexable pages with consistent metadata and no app runtime', () => {
    const titles = new Set();
    const descriptions = new Set();
    for (const path of publicPaths) {
      const html = renderPage(path);
      const doc = parse(html);
      expect(doc.querySelectorAll('h1')).toHaveLength(1);
      expect(doc.querySelector('main').textContent.length).toBeGreaterThan(400);
      expect(doc.querySelector('link[rel="canonical"]').getAttribute('href')).toBe(SITE_URL + path);
      expect(doc.querySelector('meta[property="og:url"]').content).toBe(SITE_URL + path);
      expect(doc.querySelector('meta[name="robots"]').content).toContain('index, follow');
      expect(html).not.toContain('js.puter.com');
      expect(html).not.toContain('puter.com/app/cap-table');
      expect(html).not.toContain('—');
      expect(doc.querySelector('.lp-open').getAttribute('href')).toBe('/');
      const schema = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent);
      const crumbs = schema['@graph'].find((item) => item['@type'] === 'BreadcrumbList');
      expect(crumbs.itemListElement.at(-1).item).toBe(SITE_URL + path);
      titles.add(doc.title);
      descriptions.add(doc.querySelector('meta[name="description"]').content);
    }
    expect(titles.size).toBe(publicPaths.length);
    expect(descriptions.size).toBe(publicPaths.length);
  });

  it('resolves every local content link, anchor, image, and related article', () => {
    const homepage = parse(landingHTML);
    // The wrapper is added by the homepage's build transform.
    const top = homepage.createElement('div');
    top.id = 'landing-top';
    homepage.body.append(top);
    for (const path of publicPaths) {
      const doc = parse(renderPage(path));
      const ids = [...doc.querySelectorAll('[id]')].map((node) => node.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const link of doc.querySelectorAll('a[href]')) {
        const url = new URL(link.getAttribute('href'), SITE_URL + path);
        if (url.origin !== SITE_URL) continue;
        expect(['/', ...publicPaths]).toContain(url.pathname);
        if (url.hash) {
          const target = url.pathname === '/' ? homepage : doc;
          expect(target.getElementById(url.hash.slice(1)), link.outerHTML).not.toBeNull();
        }
      }
      for (const image of doc.querySelectorAll('img')) {
        expect(existsSync(resolve('public', image.getAttribute('src').slice(1)))).toBe(true);
      }
    }
    for (const article of articles) {
      expect(publicPaths).toContain(articlePath(article));
      expect(article.related.every((slug) => articles.some((a) => a.slug === slug))).toBe(true);
    }
  });

  it('lists all public canonical pages in the generated sitemap', () => {
    const xml = new DOMParser().parseFromString(renderSitemap(), 'text/xml');
    expect(xml.querySelector('parsererror')).toBeNull();
    expect([...xml.querySelectorAll('loc')].map((node) => node.textContent)).toEqual(['/', ...publicPaths].map((path) => SITE_URL + path));
  });

  it('marks the fallback page noindex without a misleading canonical', () => {
    const doc = parse(renderPage('/404.html'));
    expect(doc.querySelector('meta[name="robots"]').content).toBe('noindex, follow');
    expect(doc.querySelector('link[rel="canonical"]')).toBeNull();
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
  });

  it('keeps the coverage inventory complete and the current navigation category open', () => {
    const inventory = readFileSync('docs/CONTENT_COVERAGE.md', 'utf8');
    const paths = [...inventory.matchAll(/\]\((\/(?:docs|guides)\/[^)]+)\)/g)].map(match => match[1]);
    expect(paths.every(path => publicPaths.includes(path))).toBe(true);
    expect(new Set(articles.map(articlePath)).size).toBe(articles.length);
    for (const article of articles) {
      expect(paths).toContain(articlePath(article));
      expect(collections[article.collection].categories).toContain(article.category);
      const page = parse(renderPage(articlePath(article)));
      for (const link of page.querySelectorAll('.site-nav-category a[aria-current="page"]')) {
        expect(link.closest('details').hasAttribute('open')).toBe(true);
        expect(link.getAttribute('href')).toBe(articlePath(article));
      }
      expect(page.querySelectorAll('.site-sidebar .site-nav-category a')).toHaveLength(articles.length);
    }
  });

  it('includes the supplied analytics exactly once in each generated head', () => {
    for (const path of [...publicPaths, '/404.html']) {
      const page = parse(renderPage(path));
      const scripts = page.head.querySelectorAll('script[src^="https://plausible.io/"]');
      expect(scripts).toHaveLength(1);
      expect(scripts[0].getAttribute('src')).toBe('https://plausible.io/js/pa-Yvu1fK54xHfv07xrDKYeu.js');
      expect(scripts[0].hasAttribute('async')).toBe(true);
      expect(page.head.textContent.match(/plausible\.init\(\)/g)).toHaveLength(1);
    }
  });
});

describe('resource search', () => {
  it('filters topics, announces results, and restores the library from an empty result', () => {
    document.body.innerHTML = parse(renderPage('/docs/')).body.innerHTML;
    initResourceSearch(document.body);
    const input = document.querySelector('[data-resource-search]');
    const search = (query) => { input.value = query; input.dispatchEvent(new Event('input')); };
    search('cap table from CSV');
    const visible = [...document.querySelectorAll('[data-resource]')].filter((node) => !node.hidden);
    expect(visible).toHaveLength(1);
    expect(visible[0].getAttribute('href')).toBe('/docs/importing-a-cap-table/');
    expect(document.querySelector('[data-search-status]').textContent).toBe('1 article found');
    search('unmatchedword');
    expect(document.querySelector('[data-search-empty]').hidden).toBe(false);
    document.querySelector('[data-search-clear]').click();
    expect([...document.querySelectorAll('[data-resource]')].every((node) => !node.hidden)).toBe(true);
    expect(document.querySelector('[data-search-empty]').hidden).toBe(true);
    expect(document.activeElement).toBe(input);
  });
});
