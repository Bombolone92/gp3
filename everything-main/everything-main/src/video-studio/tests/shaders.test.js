import { describe, it, expect } from 'vitest';
import * as S from '../src/engine/shaders.js';
import { EFFECTS, TRANSITIONS, FILTERS, ANIMATIONS, BLEND_MODES } from '../src/model/catalog.js';
import { DEFAULT_ADJUST } from '../src/model/project.js';

const ids = (list) => list.map((x) => x.id);
const dupes = (list) => list.filter((x, i) => list.indexOf(x) !== i);

/** Every complete shader source the compositor can compile, by name. */
function allSources() {
  const out = {
    QUAD_VS: S.QUAD_VS, FULL_VS: S.FULL_VS, LAYER_FS: S.LAYER_FS, COPY_FS: S.COPY_FS,
    BLUR_FS: S.BLUR_FS, GRADE_FS: S.GRADE_FS, BLEND_FS: S.BLEND_FS,
  };
  for (const id of Object.keys(S.EFFECT_SHADERS)) out[`effect:${id}`] = S.effectShader(id);
  for (const id of Object.keys(S.TRANSITION_SHADERS)) out[`transition:${id}`] = S.transitionShader(id);
  return out;
}

/** Strip comments so structural checks only see code. */
const code = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('catalog ids', () => {
  it('are unique within each list', () => {
    for (const list of [EFFECTS, TRANSITIONS, FILTERS, BLEND_MODES, ANIMATIONS.in, ANIMATIONS.out, ANIMATIONS.loop]) {
      expect(dupes(ids(list))).toEqual([]);
    }
  });

  it('give every filter only parameters the grading shader understands', () => {
    const known = new Set([...Object.keys(DEFAULT_ADJUST), 'mono', 'shadowTint', 'highlightTint', 'splitAmount']);
    for (const f of FILTERS) for (const k of Object.keys(f.p)) expect(known.has(k), `${f.id}.${k}`).toBe(true);
  });

  it('map every blend mode to a shader mode', () => {
    for (const b of BLEND_MODES) expect(S.BLEND_MODE_INDEX[b.id], b.id).toBeTypeOf('number');
    expect(dupes(Object.values(S.BLEND_MODE_INDEX))).toEqual([]);
  });
});

describe('shader coverage', () => {
  it('has a shader for every effect and no orphan effect shaders', () => {
    expect(ids(EFFECTS).filter((id) => !S.effectShader(id))).toEqual([]);
    expect(Object.keys(S.EFFECT_SHADERS).filter((id) => !ids(EFFECTS).includes(id))).toEqual([]);
    expect(S.effectShader('no-such-effect')).toBe(null);
  });

  it('has its own shader for every transition and falls back to a mix for unknown ids', () => {
    expect(ids(TRANSITIONS).filter((id) => !S.TRANSITION_SHADERS[id])).toEqual([]);
    expect(Object.keys(S.TRANSITION_SHADERS).filter((id) => !ids(TRANSITIONS).includes(id))).toEqual([]);
    expect(S.transitionShader('no-such-transition')).toBe(S.transitionShader('mix'));
  });
});

describe('shader sources', () => {
  const sources = Object.entries(allSources());

  it.each(sources)('%s is GLSL ES 3.00 with one main()', (name, src) => {
    expect(src.startsWith('#version 300 es\n')).toBe(true);
    expect(code(src).match(/\bvoid\s+main\s*\(\s*\)/g)).toHaveLength(1);
    expect(src).not.toMatch(/gl_FragColor|texture2D\s*\(|\bvarying\b|\battribute\b/);
  });

  it.each(sources.filter(([n]) => !n.endsWith('_VS')))('%s declares precision and writes outColor', (name, src) => {
    const c = code(src);
    expect(c).toMatch(/precision\s+highp\s+float;/);
    expect(c).toMatch(/\bout\s+vec4\s+outColor;/);
    const body = c.slice(c.search(/\bvoid\s+main\s*\(/));
    expect(body).toMatch(/\boutColor\s*=/);
  });

  it.each(sources.filter(([n]) => n.endsWith('_VS')))('%s writes gl_Position', (name, src) => {
    expect(code(src)).toMatch(/gl_Position\s*=/);
  });

  it.each(sources)('%s has balanced brackets', (name, src) => {
    const c = code(src);
    for (const [open, close] of [['(', ')'], ['{', '}'], ['[', ']']]) {
      let depth = 0;
      for (const ch of c) {
        if (ch === open) depth++;
        else if (ch === close) depth--;
        expect(depth, `${name} ${open}${close}`).toBeGreaterThanOrEqual(0);
      }
      expect(depth, `${name} ${open}${close}`).toBe(0);
    }
  });
});
