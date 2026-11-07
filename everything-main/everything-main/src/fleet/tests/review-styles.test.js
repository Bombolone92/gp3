// @vitest-environment jsdom
/**
 * Stylesheet checks for layout, theming and accessibility fixes that a
 * DOM without layout cannot render. Each test reads the real CSS through
 * the CSSOM and asserts the rule that a fix depends on.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const STYLES = path.resolve(__dirname, '../src/styles');

/** Flat list of style rules in a stylesheet with the media/supports conditions around each. */
function rules(file) {
  const style = document.createElement('style');
  style.textContent = fs.readFileSync(path.join(STYLES, `${file}.css`), 'utf8');
  document.head.append(style);
  const out = [];
  const walk = (list, conds) => {
    for (const r of list) {
      if (r.selectorText !== undefined) out.push({ selector: r.selectorText, style: r.style, conds });
      else if (r.cssRules && !r.name) walk(r.cssRules, [...conds, r.conditionText ?? r.media?.mediaText ?? '']);
    }
  };
  walk(style.sheet.cssRules, []);
  style.remove();
  return out;
}

/** Rules whose selector list contains `selector`, optionally only inside a condition matching `cond`. */
function find(file, selector, cond = null) {
  return rules(file).filter(
    (r) => r.selector.split(',').map((s) => s.trim().replace(/\s+/g, ' ')).includes(selector) && (cond === null ? r.conds.length === 0 : r.conds.some((c) => cond.test(c))),
  );
}

/** The winning value of `prop` among matching rules (last one wins, as in the cascade). */
function value(file, selector, prop, cond = null) {
  const found = find(file, selector, cond).filter((r) => r.style.getPropertyValue(prop));
  const last = found.at(-1);
  return last ? `${last.style.getPropertyValue(prop)}${last.style.getPropertyPriority(prop) ? ' !important' : ''}` : '';
}

/** WCAG contrast ratio of two #rrggbb colors. */
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Token values for the light theme and for each dark block. */
function themes() {
  const tok = rules('tokens').filter((r) => r.style.getPropertyValue('--text'));
  const read = (r) => Object.fromEntries(Array.from({ length: r.style.length }, (_, i) => r.style[i]).filter((p) => p.startsWith('--')).map((p) => [p, r.style.getPropertyValue(p).trim()]));
  const light = read(tok.find((r) => r.selector === ':root'));
  return { light, darks: tok.filter((r) => r.selector !== ':root').map((r) => ({ ...light, ...read(r) })) };
}

describe('reduced motion', () => {
  it('stops infinite animations instead of looping them every frame', () => {
    // A 0.01ms duration alone turns the spinner and skeleton pulse into a
    // flicker that restarts every frame; they must also run only once.
    expect(value('base', '*', 'animation-duration', /prefers-reduced-motion/)).toBe('0.01ms !important');
    expect(value('base', '*', 'animation-iteration-count', /prefers-reduced-motion/)).toBe('1 !important');
  });
});

describe('touch input', () => {
  it('keeps form fields at 16px on touch screens so iOS does not zoom on focus', () => {
    for (const sel of ['.input', '.input.sm', '.select', '.select.sm', '.textarea']) {
      expect(value('components', sel, 'font-size', /pointer: coarse/), sel).toBe('16px');
    }
    // The coarse-pointer rule must come after the small variants it overrides.
    const all = rules('components');
    const sm = all.findIndex((r) => r.conds.length === 0 && r.selector.includes('.input.sm'));
    const coarse = all.findIndex((r) => r.conds.some((c) => /pointer: coarse/.test(c)) && r.selector.includes('.input.sm'));
    expect(coarse).toBeGreaterThan(sm);
  });
});

describe('print', () => {
  it('prints in light colors whatever theme is on screen', () => {
    // The print sheet forces white paper; dark token values would leave
    // near-white text and dark cards on it.
    const dark = rules('tokens').filter((r) => r.style.getPropertyValue('--surface').trim() === '#161a20');
    expect(dark.length).toBe(2);
    for (const r of dark) expect(r.conds.length && r.conds.every((c) => /^screen\b/.test(c)), r.selector).toBeTruthy();
    expect(value('tokens', ':root', '--surface')).toBe('#ffffff');
  });

  it('prints tables, not the phone card lists', () => {
    // Letter and A4 pages are about 690-710 CSS px wide, so the phone
    // breakpoint (max-width: 767px) matches while printing.
    expect(rules('shell').some((r) => r.selector === '.hide-mobile' && r.conds.some((c) => /max-width: 767px/.test(c)))).toBe(true);
    expect(value('print', '.hide-mobile', 'display', /print/)).toBe('revert !important');
    expect(value('print', '.show-mobile', 'display', /print/)).toBe('none !important');
  });
});

describe('toasts', () => {
  it('keeps the error icon and focus ring visible on the inverted toast in both themes', () => {
    const { light, darks } = themes();
    expect(darks.length).toBe(2);
    // Toasts use --text as their background.
    for (const t of [light, ...darks]) {
      expect(t['--toast-danger']).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrast(t['--toast-danger'], t['--text'])).toBeGreaterThanOrEqual(3);
    }
    expect(value('components', '.toast.error .icon', 'color')).toBe('var(--toast-danger)');
    // No theme-specific override that only covers an explicitly chosen dark theme.
    expect(rules('components').some((r) => r.selector.includes('[data-theme') && r.selector.includes('.toast'))).toBe(false);
    // --focus on --text is under 3:1 in both themes; the toast's own text color is not.
    expect(value('components', '.toast :focus-visible', 'outline-color').toLowerCase()).toBe('currentcolor');
  });
});

describe('focus', () => {
  it('shows a focus ring on menu items, not just the faint hover tint', () => {
    const { light, darks } = themes();
    for (const t of [light, ...darks]) expect(contrast(t['--surface-hover'], t['--surface'])).toBeLessThan(1.5);
    expect(value('components', '.menu-item:focus-visible', 'outline')).toBe('2px solid var(--focus)');
    expect(value('components', '.menu-item:focus-visible', 'outline-offset')).toBe('-2px');
  });

  it('draws focus rings inside tabs and rows whose container clips its overflow', () => {
    // overflow-x: auto also clips vertically, and the tabs fill the strip's height.
    expect(value('components', '.tabs', 'overflow-x')).toBe('auto');
    expect(value('views', '.list-tabs', 'overflow-x')).toBe('auto');
    expect(value('views', '.grid-card-wrap', 'overflow')).toBe('hidden');
    expect(value('components', ".tabs [role='tab']:focus-visible", 'outline-offset')).toBe('-2px');
    expect(value('views', ".list-tabs [role='tab']:focus-visible", 'outline-offset')).toBe('-2px');
    expect(value('views', '.grid-card:focus-visible', 'outline-offset')).toBe('-2px');
  });

  it('draws focus rings inside alert rows and the phone filter bar, which scroll', () => {
    expect(value('views', '.alert-list', 'overflow-y')).toBe('auto');
    expect(value('views', '.alert-item:focus-visible', 'outline-offset')).toBe('-2px');
    expect(value('views', '.filter-bar', 'overflow-x', /max-width: 767px/)).toBe('auto');
    expect(value('views', '.filter-bar :focus-visible', 'outline-offset', /max-width: 767px/)).toBe('-2px');
  });
});

describe('long text', () => {
  it('wraps unbroken names in page, dialog and inspection titles', () => {
    // A contact with only an email is named by it ("Edit jane.doe@...").
    // .content hides horizontal overflow, so an unbreakable title was cut off.
    expect(value('shell', '.content', 'overflow-x')).toBe('hidden');
    expect(value('shell', '.page-header h1', 'overflow-wrap')).toBe('anywhere');
    expect(value('components', '.dialog-head h2', 'overflow-wrap')).toBe('anywhere');
    expect(value('components', '.dialog-body > p', 'overflow-wrap')).toBe('anywhere');
    expect(value('views', '.insp-title h1', 'overflow-wrap')).toBe('anywhere');
  });
});

describe('safe areas', () => {
  it('keeps content out of the notch and home indicator areas (viewport-fit=cover)', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
    expect(html).toContain('viewport-fit=cover');
    expect(value('shell', '.app', 'padding-left')).toBe('env(safe-area-inset-left, 0px)');
    expect(value('shell', '.app', 'padding-right')).toBe('env(safe-area-inset-right, 0px)');
    expect(value('shell', '.rail-foot', 'padding')).toContain('env(safe-area-inset-bottom');
    // Phone sheets: the footer already pads for the home indicator; a sheet without one did not.
    expect(value('components', '.dialog-foot', 'padding-bottom', /max-width: 640px/)).toContain('env(safe-area-inset-bottom');
    expect(value('components', '.dialog-body:last-child', 'padding-bottom', /max-width: 640px/)).toContain('env(safe-area-inset-bottom');
    // The full-screen search on phones covers the status bar and home indicator areas.
    const pad = value('components', 'dialog.palette', 'padding', /max-width: 640px/);
    expect(pad).toContain('env(safe-area-inset-top');
    expect(pad).toContain('env(safe-area-inset-bottom');
  });
});

describe('popovers', () => {
  it('fit menus and filters in the visible viewport, not the toolbar-less 100vh', () => {
    // menu.js places popovers with innerHeight; on phones 100vh is taller
    // than that while the browser toolbars show, so a capped popover could
    // still run under the toolbar with its last options out of reach.
    expect(value('components', '.popover', 'max-height')).toBe('min(480px, calc(100dvh - 16px))');
  });
});

describe('forced colors', () => {
  const forced = /forced-colors: active/;
  it('marks selected toggles with system highlight colors', () => {
    for (const sel of [".pf-btn.pass[aria-checked='true']", ".pf-btn.fail[aria-checked='true']", ".choice-btn[aria-checked='true']", ".seg button[aria-checked='true']", ".chip[aria-pressed='true']", '.filter-btn.active']) {
      expect(value('views', sel, 'background', forced), sel).toBe('Highlight');
      expect(value('views', sel, 'forced-color-adjust', forced), sel).toBe('none');
    }
  });

  it('keeps background-only indicators and the switch visible', () => {
    for (const sel of [".tabs [role='tab'][aria-selected='true']::after", ".list-tabs [role='tab'][aria-selected='true']::after", '.progress-fill', ".nav-link[aria-current='page']::before"]) {
      expect(value('views', sel, 'background', forced), sel).toBe('Highlight');
    }
    expect(value('views', '.switch input', 'border', forced)).toBe('1px solid CanvasText');
    expect(value('views', '.switch input::after', 'background', forced)).toBe('CanvasText');
    expect(value('views', ".palette-option[aria-selected='true']", 'outline', forced)).toBe('2px solid');
  });

  it('draws the focus ring in a system color on elements that opt out of forced colors', () => {
    for (const sel of ["[aria-checked='true']:focus-visible", "[aria-pressed='true']:focus-visible", '.filter-btn.active:focus-visible', '.switch input:focus-visible']) {
      expect(value('views', sel, 'outline-color', forced), sel).toBe('CanvasText');
    }
  });
});

describe('switch', () => {
  it('draws the off track with enough contrast to see the switch and its knob', () => {
    const { light, darks } = themes();
    const track = value('components', '.switch input', 'background').match(/var\((--[\w-]+)\)/)?.[1];
    for (const t of [light, ...darks]) {
      expect(contrast(t[track], '#ffffff')).toBeGreaterThanOrEqual(3); // white knob
      expect(contrast(t[track], t['--surface'])).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('unstyled markup', () => {
  it('styles the team member lists and the board column counts', () => {
    // team-access.js renders ul.list.bordered-list; work-orders.js puts a
    // span.tab-count in each board column header.
    expect(value('components', '.bordered-list', 'border')).toBe('1px solid var(--border)');
    expect(value('views', '.board-head .tab-count', 'border-radius')).toBe('999px');
  });
});

describe('phone widths', () => {
  it('lets settings list rows shrink their name field and wrap', () => {
    // A vehicle status row is dot, name, color select, "N vehicles" and a
    // remove button: about 230px besides the name field, in a 250px card
    // body at 320px wide.
    expect(value('views', '.edit-list li', 'flex-wrap')).toBe('wrap');
    expect(value('views', '.edit-list .input', 'min-width')).toBe('0');
    expect(value('views', '.edit-list .input', 'flex')).toBe('1 1 120px');
    expect(value('views', '.edit-list .input', 'max-width')).toBe('340px');
  });
});

describe('report controls', () => {
  it('wraps the custom date range instead of running past the card', () => {
    // report.js: span.row(icon, range select, span.row(from date, "to", to date)).
    expect(value('views', '.report-controls .row', 'flex-wrap')).toBe('wrap');
    // Full-width date inputs would each take a whole line once the row can wrap.
    expect(value('views', '.report-controls .input', 'width')).toBe('auto');
  });
});

describe('sticky bars', () => {
  it('keeps focused fields clear of sticky form headers and inspection bars', () => {
    expect(value('views', '.sticky-header', 'position')).toBe('sticky');
    expect(value('views', '.content:has(.sticky-header)', 'scroll-padding-top')).toBe('100px');
    expect(value('views', '.content:has(.sticky-header)', 'scroll-padding-top', /max-width: 767px/)).toBe('140px');
    expect(value('views', '.content:has(.insp-top)', 'scroll-padding')).toBe('150px 0 80px');
    // Scroll padding and scroll margin add up; the old margins compensated for the bars on their own.
    expect(value('views', '.form-section', 'scroll-margin-top')).toBe('8px');
    expect(value('views', '.insp-item', 'scroll-margin')).toBe('12px');
  });
});

describe('touch targets', () => {
  const phone = /max-width: 767px/;
  it('gives the phone top bar buttons 44px targets without squeezing the title', () => {
    expect(value('shell', '.topbar .icon-btn', 'width', phone)).toBe('44px');
    expect(value('shell', '.topbar .icon-btn', 'height', phone)).toBe('44px');
    expect(value('shell', '.account-btn', 'height', phone)).toBe('44px');
    expect(value('shell', '.search-trigger', 'height', phone)).toBe('44px');
    // Visible at 320px: brand 28, search 44, sync 35, alert 44, add, account 44,
    // six gaps and 20px padding. Keep the room left for the title at 37px or more.
    const add = parseFloat(value('shell', '.add-btn', 'width', phone));
    const gap = parseFloat(value('shell', '.topbar', 'gap', phone));
    expect(320 - (20 + 28 + 44 + 35 + 44 + add + 44 + 6 * gap)).toBeGreaterThanOrEqual(37);
  });

  it('makes label remove buttons at least 24px on touch screens', () => {
    expect(value('components', '.tag button', 'width')).toBe('16px');
    expect(value('components', '.tag button', 'width', /pointer: coarse/)).toBe('24px');
    expect(value('components', '.tag button', 'height', /pointer: coarse/)).toBe('24px');
    // The tag grows so the button fits inside its border.
    expect(parseFloat(value('components', '.tag', 'height', /pointer: coarse/))).toBeGreaterThanOrEqual(24 + 2);
  });

  it('gives the phone list pager 44px previous and next buttons', () => {
    // grid.js renders them as .icon-btn.bordered.sm (30px).
    expect(value('views', '.pager .icon-btn', 'width', phone)).toBe('44px');
    expect(value('views', '.pager .icon-btn', 'height', phone)).toBe('44px');
  });
});

describe('phone dialogs', () => {
  it('wraps footer buttons instead of cutting them off', () => {
    // The photo viewer's footer is Delete, spacer, Previous, Next, Open:
    // about 370px of nowrap buttons in a 276px footer at 320px wide, and
    // the dialog clips its overflow.
    const sheet = /max-width: 640px/;
    expect(value('components', 'dialog.dialog', 'overflow')).toBe('hidden');
    expect(value('components', '.btn', 'white-space')).toBe('nowrap');
    expect(value('components', '.dialog-foot', 'flex-wrap', sheet)).toBe('wrap');
    expect(value('components', '.dialog-foot .spacer', 'display', sheet)).toBe('none');
  });
});

describe('line item totals', () => {
  it('lets the discount row wrap its amount instead of overflowing on phones', () => {
    // Discount row: label, a 72px field and the %/Amount select, then the
    // amount: about 300px against a 250px card body at 320px wide.
    expect(value('views', '.totals-in .input', 'width')).toBe('72px');
    expect(value('views', '.totals > div', 'flex-wrap')).toBe('wrap');
    expect(value('views', '.totals dd', 'margin')).toBe('0 0 0 auto');
  });
});

describe('attachment rows', () => {
  it('truncates long file names on the button so its focus ring is not clipped', () => {
    // common.js: li.file-row > span.grow.truncate > button.link-btn (the file name).
    expect(value('base', '.truncate', 'overflow')).toBe('hidden');
    expect(value('views', '.file-row > .truncate', 'overflow')).toBe('visible');
    expect(value('views', '.file-row .link-btn', 'overflow')).toBe('hidden');
    expect(value('views', '.file-row .link-btn', 'text-overflow')).toBe('ellipsis');
    expect(value('views', '.file-row .link-btn', 'max-width')).toBe('100%');
  });
});

describe('inspection results', () => {
  it('wraps long typed answers and notes instead of squeezing the item label', () => {
    // inspection-detail.js: li.result-row > icon, div.grow (label, note), span.result-value.
    // Text and choice answers are free text, and the value was nowrap.
    expect(value('views', '.result-value', 'white-space')).toBe('');
    expect(value('views', '.result-value', 'max-width')).toBe('50%');
    expect(value('views', '.result-value', 'overflow-wrap')).toBe('anywhere');
    expect(value('views', '.result-note', 'overflow-wrap')).toBe('anywhere');
    // Vehicle notes are a p.pre-wrap straight in a card body.
    expect(value('views', '.pre-wrap', 'overflow-wrap')).toBe('anywhere');
  });
});

describe('empty states', () => {
  it('sizes a page-level empty state heading like the others', () => {
    // emptyPage(), "Page not found" and the crash page use headingLevel 1.
    expect(value('components', '.empty h1', 'font-size')).toBe(value('components', '.empty h2', 'font-size'));
    // The crash page puts the error message in the text.
    expect(value('components', '.empty p', 'overflow-wrap')).toBe('anywhere');
  });
});

describe('short screens', () => {
  it('lets sticky bars scroll away when the screen is too short for them', () => {
    const short = /max-height: 500px/;
    for (const sel of ['.sticky-header', '.insp-top', '.insp-submit']) expect(value('views', sel, 'position', short), sel).toBe('static');
    expect(value('views', '.content:has(.insp-top)', 'scroll-padding', short)).toBe('16px 0 0');
    // It must come after the rules it undoes.
    const all = rules('views');
    const last = (pred) => all.map((r, i) => (pred(r) ? i : -1)).filter((i) => i >= 0).pop();
    expect(last((r) => r.conds.some((c) => short.test(c)))).toBeGreaterThan(last((r) => r.selector.startsWith('.content:has') && !r.conds.some((c) => short.test(c))));
  });
});
