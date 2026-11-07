import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { REPORTS, GROUPS } from './report-defs.js';

export function render() {
  return {
    node: h(
      'div.page',
      h('header.page-header', h('div.titles', h('h1', 'Reports'), h('div.subtitle', 'Standard reports across costs, fuel, maintenance, inspections, and inventory. Every report exports to CSV and prints.'))),
      h(
        'div.report-groups',
        GROUPS.map((g) =>
          h(
            'section.report-group',
            { 'aria-label': g.title },
            h('h2.report-group-title', g.title),
            h(
              'ul.report-cards',
              g.items.map((id) => {
                const r = REPORTS[id];
                return h('li', h('a.report-card', { href: `#/reports/${id}` }, h('span.report-icon', icon(r.icon, 20)), h('span.grow', h('span.report-title', r.title), h('span.report-desc', r.description)), icon('chevron-right', 16)));
              }),
            ),
          ),
        ),
      ),
    ),
    title: 'Reports',
  };
}
