import { readFileSync } from 'node:fs';
import { publicPaths, renderPage, renderSitemap } from './render.js';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const cssSource = () => ['../src/styles/tokens.css', '../src/styles/base.css', '../src/styles/landing.css', './styles.css'].map(read).join('\n');
const clientSource = () => `${read('./client.js')}\nconst root = document.querySelector('.site-public');\ninitPublicNavigation(root);\ninitResourceSearch(root);\n`;

/** Emit real documents so deep links work on a static host without an SPA rewrite. */
export function publicContentPlugin() {
  return {
    name: 'public-documentation-and-guides',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url, 'http://localhost').pathname;
        const send = (type, content, status = 200) => {
          res.statusCode = status;
          res.setHeader('Content-Type', type);
          res.end(content);
        };
        if (path === '/site/assets/styles.css') return send('text/css; charset=utf-8', cssSource());
        if (path === '/site/assets/client.js') return send('text/javascript; charset=utf-8', clientSource());
        if (path === '/sitemap.xml' && renderSitemap()) return send('application/xml; charset=utf-8', renderSitemap());
        if (path === '/404.html') return send('text/html; charset=utf-8', renderPage('/404.html'), 404);
        if (!/^\/(docs|guides)(\/|$)/.test(path)) return next();
        const canonicalPath = path.replace(/\/index\.html$/, '/').replace(/\/?$/, '/');
        if (publicPaths.includes(canonicalPath)) {
          if (path !== canonicalPath) {
            res.statusCode = 301;
            res.setHeader('Location', canonicalPath + new URL(req.url, 'http://localhost').search);
            return res.end();
          }
          return send('text/html; charset=utf-8', renderPage(canonicalPath));
        }
        send('text/html; charset=utf-8', renderPage('/404.html'), 404);
      });
    },
    generateBundle() {
      const css = '/' + this.getFileName(this.emitFile({ type: 'asset', name: 'library.css', source: cssSource() }));
      const js = '/' + this.getFileName(this.emitFile({ type: 'asset', name: 'library.js', source: clientSource() }));
      for (const path of publicPaths) {
        this.emitFile({ type: 'asset', fileName: path.slice(1) + 'index.html', source: renderPage(path, { css, js }) });
      }
      this.emitFile({ type: 'asset', fileName: '404.html', source: renderPage('/404.html', { css, js }) });
      if (renderSitemap()) this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: renderSitemap() });
    },
  };
}
