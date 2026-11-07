/**
 * The shell and conversation side (review pass 25, lead): stylesheet rules
 * read from the source where a layout rule has no DOM to drive in node.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const components = () => readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('a menu opened by a long press on a touch-only screen', () => {
  it('shows its labels alone: the keyboard hints (R, U, L, P, S, Del beside the message actions) go where there is no key to press them on', () => {
    const s = components();
    // The hint stands in a menu item by default...
    expect(s).toMatch(/\.menu-item \.menu-kbd \{[^}]*font-size: 11px;/);
    // ...and goes on a screen that is touched and never hovered, the rule
    // written after the default so it wins at equal specificity.
    const rule = s.match(/@media \(hover: none\) and \(pointer: coarse\) \{\s*\.menu-item \.menu-kbd \{([^}]*)\}\s*\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/display: none;/);
    expect(rule.index).toBeGreaterThan(s.indexOf('.menu-item .menu-kbd {'));
  });
});

const app = () => readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('the conversation header short of room (a phone; a long name beside a status)', () => {
  it('keeps the name and lets the status give way, and nothing in the title button runs onto the buttons beside it', () => {
    const s = app();
    // The title button clips what it holds: a direct message's presence word
    // ran past its edge over the huddle and More buttons.
    const btn = s.match(/\.conv-title-btn \{([^}]*)\}/);
    expect(btn).not.toBeNull();
    expect(btn[1]).toMatch(/overflow: hidden;/);
    expect(btn[1]).toMatch(/min-width: 0;/);
    // The name shrinks last (weight 1), the status a hundred times as readily
    // (its 220px max-width used to be its floor in the row: the name went to
    // nothing and the header read as the status alone), pills and the
    // presence word never.
    expect(s).toMatch(/\.conv-title-btn \.conv-title \{[^}]*flex: 0 1 auto;[^}]*min-width: 0;/);
    expect(s).toMatch(/\.conv-title-btn \.status-chip \{[^}]*flex: 0 100 auto;[^}]*min-width: 0;[^}]*overflow: hidden;/);
    expect(s).toMatch(/\.conv-title-btn \.pill, \.conv-title-btn \.small \{[^}]*flex: none;/);
  });
});

describe('the channel header short of room: the name before the pills and the topic', () => {
  it('hides the pills beside the name on a phone, where they never shrank and the name shrank to nothing', () => {
    const s = app();
    const phone = s.match(/@media \(max-width: 719px\) \{\s*\.shell \{[\s\S]*?\n\}/);
    expect(phone).not.toBeNull();
    expect(phone[0]).toMatch(/\.conv-title-btn \.pill \{ display: none; \}/);
  });
  it('hides the pills as well wherever the header itself is under 640px, a tablet or a narrow window beside the sidebar', () => {
    const s = app();
    const header = s.match(/\.conv-header \{([^}]*)\}/);
    expect(header).not.toBeNull();
    expect(header[1]).toMatch(/container-type: inline-size;/);
    expect(s).toMatch(/@container \(max-width: 639px\) \{ \.conv-title-btn \.pill \{ display: none; \} \}/);
  });
  it('lets the topic give way a hundred times as readily as the title beside it', () => {
    const s = app();
    const topic = s.match(/\.conv-topic \{([^}]*)\}/);
    expect(topic).not.toBeNull();
    expect(topic[1]).toMatch(/flex: 1 100 auto;/);
    expect(topic[1]).toMatch(/min-width: 0;/);
  });
});
