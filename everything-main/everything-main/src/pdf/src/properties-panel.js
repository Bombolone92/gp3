import { el, icon } from './lib/ui.js';

/** A stable home for selection settings, independent of page coordinates and zoom. */
export function createPropertiesPanel() {
  let owner = null;
  let layoutHolds = 0;
  const title = el('h2', {}, 'Properties');
  const empty = el(
    'p',
    { class: 'properties-empty' },
    'Select text, an image, a shape, or a comment to edit its properties.',
  );
  const content = el('div', { class: 'properties-content' }, empty);
  const root = el(
    'aside',
    { class: 'properties-sidebar is-empty', 'aria-label': 'Selection properties' },
    el('div', { class: 'properties-heading' }, icon('Settings2', 16), title),
    content,
  );
  return {
    root,
    get active() {
      return owner !== null || layoutHolds > 0;
    },
    get switching() {
      return layoutHolds > 0;
    },
    /** Keep an open dock's height through an asynchronous selection handoff. */
    preserveLayout() {
      if (owner === null && !layoutHolds) return () => {};
      if (layoutHolds === 0) {
        root.style.setProperty(
          '--properties-transition-height',
          `${root.getBoundingClientRect().height}px`,
        );
        root.classList.add('is-switching');
      }
      layoutHolds++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--layoutHolds) return;
        root.classList.remove('is-switching');
        root.style.removeProperty('--properties-transition-height');
      };
    },
    show(key, label, panel) {
      const replacing = owner !== key || content.firstChild !== panel;
      owner = key;
      title.textContent = label;
      root.classList.remove('is-empty');
      // Refreshed controls in the same panel must keep their visible scroll position.
      if (replacing) {
        content.replaceChildren(panel);
        content.scrollTop = 0;
      }
    },
    clear(key) {
      if (owner !== key) return;
      owner = null;
      title.textContent = 'Properties';
      root.classList.add('is-empty');
      content.replaceChildren(empty);
    },
  };
}
