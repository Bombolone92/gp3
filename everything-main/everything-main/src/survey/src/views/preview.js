/**
 * Preview: the survey exactly as respondents get it (same renderer), in a
 * full-screen dialog with phone, tablet and desktop widths. Answers are never
 * sent anywhere.
 */
import '../styles/respond.css';
import '../styles/preview.css';
import { h, replace } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { openDialog } from '../lib/ui.js';
import { publicSnapshot } from '../model/survey.js';
import { mountSurvey } from '../respond/render.js';

const DEVICES = [
  { id: 'desktop', label: 'Desktop', icon: 'laptop', width: '100%' },
  { id: 'tablet', label: 'Tablet', icon: 'tablet', width: '820px' },
  { id: 'phone', label: 'Phone', icon: 'phone', width: '390px' },
];

export function openPreview(survey, { startPage = 0 } = {}) {
  const snap = publicSnapshot(survey);
  let device = (() => {
    try {
      return localStorage.getItem('sv:preview-device') || 'desktop';
    } catch {
      return 'desktop';
    }
  })();
  let page = startPage;
  return openDialog({
    title: 'Preview',
    full: true,
    className: 'preview-dialog',
    build: () => {
      const stage = h('div', { class: 'preview-stage' });
      const screen = h('div', { class: 'preview-screen scroll' });
      stage.append(screen);
      const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Screen size' });
      const restart = () => {
        const host = h('div');
        replace(screen, host);
        mountSurvey(host, { survey: snap, preview: true, startPage: page });
      };
      const drawSeg = () => {
        replace(
          seg,
          DEVICES.map((d) =>
            h(
              'button',
              {
                type: 'button',
                role: 'radio',
                // Named without the text, which narrow screens hide.
                'aria-label': d.label,
                'aria-checked': String(d.id === device),
                onclick: () => {
                  device = d.id;
                  try {
                    localStorage.setItem('sv:preview-device', device);
                  } catch {
                    /* ignore */
                  }
                  drawSeg();
                  size();
                },
              },
              icon(d.icon, { size: 14 }),
              h('span', { class: 'seg-label' }, d.label),
            ),
          ),
        );
      };
      const size = () => {
        const d = DEVICES.find((x) => x.id === device) || DEVICES[0];
        screen.style.width = d.width;
        screen.dataset.device = d.id;
      };
      const pageSelect = snap.pages.length > 1
        ? h(
            'select',
            {
              class: 'select select-sm',
              'aria-label': 'Start at page',
              onchange: (e) => {
                page = Number(e.target.value);
                restart();
              },
            },
            snap.pages.map((p, i) => h('option', { value: i, selected: i === page }, `Page ${i + 1}${p.title ? `: ${p.title}` : ''}`)),
          )
        : null;
      drawSeg();
      size();
      restart();
      return {
        body: h(
          'div',
          { class: 'preview' },
          h('div', { class: 'preview-bar' }, seg, h('span', { class: 'grow' }), pageSelect,
            h('button', { type: 'button', class: 'btn btn-sm', onclick: restart }, icon('refresh', { size: 14 }), 'Restart')),
          stage,
        ),
      };
    },
  });
}
