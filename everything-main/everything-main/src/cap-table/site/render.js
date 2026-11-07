import { readFileSync } from 'node:fs';
import { APP_URL, SITE_URL, articles, articlePath, collections } from './content.js';

export const publicPaths = Object.keys(collections).flatMap((key) => [`/${key}/`, ...articles.filter((a) => a.collection === key).map(articlePath)]);
export const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const json = (data) => JSON.stringify(data).replace(/</g, '\\u003c');
const labelFor = (key) => collections[key].label;
const asset = (name) => new URL(name, import.meta.url);
const analytics = readFileSync(asset('./analytics.html'), 'utf8');

function chrome(collection) {
  const source = readFileSync(asset('../src/views/landing.html'), 'utf8');
  const absoluteLinks = (html) => html.replaceAll('href="#landing-top"', 'href="/"').replaceAll('href="#', 'href="/#').replaceAll('src="./', 'src="/');
  let header = absoluteLinks(source.match(/<header class="lp-header">[\s\S]*?<\/header>/)[0]);
  header = header.replace(/<button class="lp-open" data-sign-in(?: disabled)?>[\s\S]*?<\/button>/, `<a class="lp-open" href="${APP_URL}">Open Cap Table ›</a>`);
  if (collection) header = header.replace(`href="/${collection}/"`, `href="/${collection}/" aria-current="page"`);
  const footer = absoluteLinks(source.match(/<footer class="lp-footer">[\s\S]*?<\/footer>/)[0]);
  return { header, footer };
}

function breadcrumbs(collection, article) {
  const crumbs = [{ name: 'Cap Table', path: '/' }];
  if (collection) crumbs.push({ name: labelFor(collection), path: `/${collection}/` });
  if (article) crumbs.push({ name: article.title, path: articlePath(article) });
  return {
    html: `<nav class="site-breadcrumbs" aria-label="Breadcrumb"><ol>${crumbs.map((c, i) => `<li>${i === crumbs.length - 1 ? `<span aria-current="page">${escapeHTML(c.name)}</span>` : `<a href="${c.path}">${escapeHTML(c.name)}</a>`}</li>`).join('')}</ol></nav>`,
    schema: { '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: SITE_URL + c.path })) },
  };
}
const readingTime = (article) => Math.max(1, Math.ceil(article.sections.map((s) => s.html.replace(/<[^>]*>/g, ' ')).join(' ').split(/\s+/).length / 220));
const card = (article, n) => `<a class="site-resource" href="${articlePath(article)}" data-resource><span class="site-resource-number" aria-hidden="true">${String(n + 1).padStart(2, '0')}</span><div><h3>${escapeHTML(article.title)}</h3><p>${escapeHTML(article.summary)}</p><span class="site-resource-meta">${readingTime(article)} min read</span></div><span class="site-arrow" aria-hidden="true">↗</span></a>`;

function hub(collection) {
  const config = collections[collection];
  const items = articles.filter((a) => a.collection === collection);
  const groups = [...new Set(items.map((a) => a.category))];
  return `<main id="site-main" class="site-hub lp-wrap">
    ${breadcrumbs(collection).html}
    <div class="site-hub-intro"><div><p class="lp-eyebrow">${config.eyebrow}</p><h1>${config.title}</h1><p class="site-lead">${config.description}</p></div><div class="site-hub-aside"><span class="site-book-mark" aria-hidden="true">${collection === 'docs' ? '01' : '02'}</span><p>${collection === 'docs' ? 'Learn the workflows.<br />Keep your records connected.' : 'Start with the basics.<br />Follow the worked examples.'}</p></div></div>
    <div class="site-hub-body"><aside class="site-hub-sidebar"><h2>Explore the library</h2><a href="/docs/" ${collection === 'docs' ? 'aria-current="page"' : ''}>Documentation <span>${articles.filter((a) => a.collection === 'docs').length}</span></a><a href="/guides/" ${collection === 'guides' ? 'aria-current="page"' : ''}>Guides <span>${articles.filter((a) => a.collection === 'guides').length}</span></a><p>${collection === 'docs' ? 'Looking for an explanation? The guides cover ownership, dilution, and vesting.' : 'Ready to enter your records? The documentation walks through the app.'}</p></aside>
    <div class="site-library"><div class="site-search"><label for="resource-search">Find a topic</label><input id="resource-search" type="search" data-resource-search placeholder="Search ${config.label.toLowerCase()}…" autocomplete="off" /><p data-search-status role="status" aria-live="polite">${items.length} articles in this section</p></div>
    ${groups.map((group) => `<section class="site-resource-group" data-resource-group><h2>${group}</h2>${items.filter((a) => a.category === group).map((a) => card(a, items.indexOf(a))).join('')}</section>`).join('')}
    <div class="site-search-empty" data-search-empty hidden><h2>No matching articles</h2><p>Try a broader term such as shares, import, or vesting.</p><button class="site-link-button" data-search-clear>Clear search</button></div></div></div>
    <div class="site-bottom-banner"><div><p class="lp-eyebrow">Your equity, clearly</p><h2>Put the reading into practice.</h2><p>Explore the sample company or continue with your own records.</p></div><a class="lp-button" href="${APP_URL}">Open Cap Table <span aria-hidden="true">→</span></a></div>
  </main>`;
}

function articleNavigation(article) {
  return Object.entries(collections).map(([key, collection]) => `<div class="site-sidebar-group"><a class="site-sidebar-heading" href="/${key}/">${collection.label}</a>${collection.categories.map(category => `<details class="site-nav-category" ${article.collection === key && article.category === category ? 'open' : ''}><summary>${escapeHTML(category)}</summary>${articles.filter(a => a.collection === key && a.category === category).map(a => `<a href="${articlePath(a)}" ${a.slug === article.slug ? 'aria-current="page"' : ''}>${escapeHTML(a.title)}</a>`).join('')}</details>`).join('')}</div>`).join('');
}
function articleBody(article) {
  const nav = articleNavigation(article);
  const toc = `<ol>${article.sections.map((s) => `<li><a href="#${s.id}">${escapeHTML(s.title)}</a></li>`).join('')}</ol>`;
  const related = article.related.map((slug) => articles.find((a) => a.slug === slug));
  return `<main id="site-main" class="site-docs lp-wrap">
    ${breadcrumbs(article.collection, article).html}
    <details class="site-mobile-navigation"><summary>Browse the library</summary><nav aria-label="Library navigation">${nav}</nav></details>
    <div class="site-article-grid"><aside class="site-sidebar"><nav aria-label="Library navigation">${nav}</nav><div class="site-sidebar-cta"><p>Try it with sample data.</p><a href="${APP_URL}">Open Cap Table <span aria-hidden="true">↗</span></a></div></aside>
    <article class="site-article"><header class="site-article-header"><p class="lp-eyebrow">${escapeHTML(article.category)}</p><h1>${escapeHTML(article.title)}</h1><p class="site-lead">${escapeHTML(article.description)}</p><div class="site-article-meta"><a href="https://puter.com">Puter</a><span aria-hidden="true">·</span><span>${article.collection === 'docs' ? 'Product documentation' : 'Concept guide'}</span><span aria-hidden="true">·</span><span>${readingTime(article)} min read</span></div></header>
    <details class="site-mobile-toc"><summary>On this page</summary><nav aria-label="On this page">${toc}</nav></details>
    <div class="site-prose">${article.sections.map((s) => `<section aria-labelledby="${s.id}"><h2 id="${s.id}">${escapeHTML(s.title)}</h2>${s.html}</section>`).join('')}</div>
    <section class="site-related" aria-labelledby="related-title"><p class="lp-eyebrow">Keep exploring</p><h2 id="related-title">Continue reading</h2>${related.map((a) => `<a href="${articlePath(a)}"><span><small>${labelFor(a.collection)}</small>${escapeHTML(a.title)}</span><span aria-hidden="true">→</span></a>`).join('')}</section>
    </article><aside class="site-toc"><nav aria-label="On this page"><p>On this page</p>${toc}</nav><a class="site-back-top" href="#site-main">Back to top ↑</a></aside></div>
  </main>`;
}

export function renderPage(path, { css = '/site/assets/styles.css', js = '/site/assets/client.js' } = {}) {
  const article = articles.find((a) => articlePath(a) === path);
  const collection = article?.collection || Object.keys(collections).find((key) => path === `/${key}/`);
  const notFound = !collection;
  const title = article ? `${article.title} | Cap Table ${collection === 'docs' ? 'Docs' : 'Guides'}` : notFound ? 'Page not found | Cap Table' : `${labelFor(collection)} | Cap Table Software by Puter`;
  const description = article?.description || collections[collection]?.description || 'Find Cap Table documentation, guides, and product information.';
  const url = SITE_URL + path;
  const { header, footer } = chrome(collection);
  const graph = notFound ? [] : [
    { '@type': article ? 'WebPage' : 'CollectionPage', '@id': url, url, name: title, description, isPartOf: { '@id': `${SITE_URL}/#website` }, inLanguage: 'en' },
    breadcrumbs(collection, article).schema,
  ];
  if (article) graph.push({ '@type': collection === 'docs' ? 'TechArticle' : 'Article', '@id': `${url}#article`, headline: article.title, description, mainEntityOfPage: { '@id': url }, inLanguage: 'en', author: { '@type': 'Organization', name: 'Puter', url: 'https://puter.com' }, publisher: { '@type': 'Organization', name: 'Puter Technologies Inc.', url: 'https://puter.com', logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon-512.png` } }, articleSection: labelFor(collection) });
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>${escapeHTML(title)}</title><meta name="description" content="${escapeHTML(description)}" /><meta name="robots" content="${notFound ? 'noindex, follow' : 'index, follow, max-image-preview:large'}" />
${notFound ? '' : `<link rel="canonical" href="${url}" />`}
<meta property="og:type" content="${article ? 'article' : 'website'}" /><meta property="og:url" content="${url}" /><meta property="og:title" content="${escapeHTML(title)}" /><meta property="og:description" content="${escapeHTML(description)}" /><meta property="og:site_name" content="Cap Table" />
<meta property="og:image" content="${SITE_URL}/social/cap-table-og-v1.jpg" /><meta property="og:image:type" content="image/jpeg" /><meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" /><meta property="og:image:alt" content="Cap Table by Puter. Every share accounted for. Free cap table software, illustrated with a teal ownership pie chart." />
<meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${escapeHTML(title)}" /><meta name="twitter:description" content="${escapeHTML(description)}" /><meta name="twitter:image" content="${SITE_URL}/social/cap-table-og-v1.jpg" /><meta name="twitter:image:alt" content="Cap Table by Puter. Every share accounted for. Free cap table software, illustrated with a teal ownership pie chart." />
<meta name="theme-color" content="#f7f7f8" media="(prefers-color-scheme: light)" /><meta name="theme-color" content="#0e0f11" media="(prefers-color-scheme: dark)" /><link rel="icon" href="/favicon.ico" /><link rel="apple-touch-icon" href="/apple-touch-icon.png" /><link rel="stylesheet" href="${css}" />
${graph.length ? `<script type="application/ld+json">${json({ '@context': 'https://schema.org', '@graph': graph })}</script>` : ''}
${analytics}
<script>document.documentElement.classList.add('js');(()=>{try{const t=localStorage.getItem('captable:theme');if(t!=='light'&&t!=='dark')return;document.documentElement.dataset.theme=t;for(const m of document.querySelectorAll('meta[name="theme-color"]'))m.setAttribute('content',t==='dark'?'#0e0f11':'#f7f7f8');}catch{}})();</script><script type="module" src="${js}"></script></head>
<body class="site-body"><div class="landing site-public" id="landing-top"><a class="lp-skip" href="#site-main">Skip to content</a>${header}${notFound ? `<main id="site-main" class="site-not-found lp-wrap"><p class="lp-eyebrow">404 · Page not found</p><h1>Let’s find the right page.</h1><p>This address does not match a page in the library.</p><h2>Start from a hub</h2><div class="lp-actions"><a class="lp-button" href="/docs/">Browse documentation</a><a class="lp-text-link" href="/guides/">Read the guides →</a></div></main>` : article ? articleBody(article) : hub(collection)}${footer}</div></body></html>`;
}

export function renderSitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['/', ...publicPaths].map((path) => `  <url><loc>${SITE_URL}${path}</loc></url>`).join('\n')}\n</urlset>\n`;
}
