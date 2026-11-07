// USDA (text) layer parser. Independent recursive-descent implementation of the common subset
// of the USD text format: layer metadata, def/over/class prims with metadata, typed attributes
// (default values, timeSamples, connections), relationships, variant sets (selected variant
// only) and list-edited references. Produces the same `specsByPath` shape as the binary crate
// reader so one composer handles both.

export const SpecType = { Attribute: 1, Prim: 6, Relationship: 8, PseudoRoot: 7 } as const;

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Spec {
  specType: number;
  fields: Record<string, any>;
}
export type SpecsByPath = Record<string, Spec>;

type Tok = { t: 'id' | 'num' | 'str' | 'asset' | 'path' | 'punct' | 'eof'; v: string; pos: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  // skip header line
  if (src.startsWith('#usda')) i = src.indexOf('\n') + 1 || n;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
      continue;
    }
    if (c === '#') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    const start = i;
    if (c === '"' || c === "'") {
      const triple = src.startsWith(c.repeat(3), i);
      const q = triple ? c.repeat(3) : c;
      i += q.length;
      let s = '';
      while (i < n && !src.startsWith(q, i)) {
        if (src[i] === '\\' && i + 1 < n) {
          const e = src[i + 1];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
          i += 2;
        } else s += src[i++];
      }
      i += q.length;
      out.push({ t: 'str', v: s, pos: start });
      continue;
    }
    if (c === '@') {
      const triple = src.startsWith('@@@', i);
      const q = triple ? '@@@' : '@';
      i += q.length;
      const e = src.indexOf(q, i);
      const s = src.slice(i, e < 0 ? n : e);
      i = e < 0 ? n : e + q.length;
      out.push({ t: 'asset', v: s, pos: start });
      continue;
    }
    if (c === '<') {
      const e = src.indexOf('>', i);
      out.push({ t: 'path', v: src.slice(i + 1, e < 0 ? n : e), pos: start });
      i = e < 0 ? n : e + 1;
      continue;
    }
    if ('()[]{}=,;:'.includes(c)) {
      out.push({ t: 'punct', v: c, pos: start });
      i++;
      continue;
    }
    if (/[-+0-9.]/.test(c) && /[-+0-9.]/.test(c) && (c !== '-' || /[0-9.in]/.test(src[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < n && /[0-9eE.+\-a-zA-Z]/.test(src[j])) j++;
      const s = src.slice(i, j);
      if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) || /^-?(inf|nan)$/.test(s)) {
        out.push({ t: 'num', v: s, pos: start });
        i = j;
        continue;
      }
    }
    // identifier (allows namespaces, dots for .timeSamples/.connect, and [] type suffix)
    let j = i;
    while (j < n && /[A-Za-z0-9_:.\-|]/.test(src[j])) {
      if (src[j] === ':' && !/[A-Za-z_]/.test(src[j + 1] ?? '')) break;
      j++;
    }
    if (j === i) {
      i++;
      continue;
    }
    if (src.startsWith('[]', j)) j += 2; // array type suffix (float3[])
    out.push({ t: 'id', v: src.slice(i, j), pos: start });
    i = j;
  }
  out.push({ t: 'eof', v: '', pos: n });
  return out;
}

const FLOAT_TYPES = /^(half|float|double|point|normal|vector|color|texCoord|quat|matrix)/;
const DOUBLE_TYPES = /^(double|matrix|timecode)/;

export function parseUsda(text: string): { specsByPath: SpecsByPath; warnings: string[] } {
  const toks = tokenize(text);
  let p = 0;
  const warnings: string[] = [];
  const specs: SpecsByPath = {};
  const peek = (o = 0) => toks[Math.min(p + o, toks.length - 1)];
  const next = () => toks[p++];
  const is = (v: string, o = 0) => {
    const t = peek(o);
    return (t.t === 'punct' || t.t === 'id') && t.v === v;
  };
  const expect = (v: string) => {
    const t = next();
    if (t.v !== v) throw new Error(`USDA parse error near offset ${t.pos}: expected "${v}" but found "${t.v}"`);
    return t;
  };

  // ------------------------------------------------------------ values
  const parseValue = (): any => {
    const t = peek();
    if (t.t === 'punct' && t.v === '[') {
      next();
      const arr: any[] = [];
      while (!is(']') && peek().t !== 'eof') {
        arr.push(parseValue());
        if (is(',')) next();
      }
      expect(']');
      return arr;
    }
    if (t.t === 'punct' && t.v === '(') {
      next();
      const tup: any[] = [];
      while (!is(')') && peek().t !== 'eof') {
        tup.push(parseValue());
        if (is(',')) next();
      }
      expect(')');
      return tup;
    }
    if (t.t === 'punct' && t.v === '{') return parseDict();
    next();
    if (t.t === 'num') return t.v.includes('inf') ? (t.v.startsWith('-') ? -Infinity : Infinity) : t.v.includes('nan') ? NaN : Number(t.v);
    if (t.t === 'str') return t.v;
    if (t.t === 'asset') return peek().t === 'path' ? { asset: t.v, primPath: next().v } : { asset: t.v };
    if (t.t === 'path') return { path: t.v };
    if (t.t === 'id') {
      if (t.v === 'true') return true;
      if (t.v === 'false') return false;
      if (t.v === 'None') return null;
      return t.v;
    }
    return null;
  };
  /** `{ ... }`: dictionaries (type name = value) or timeSamples (number: value) */
  const parseDict = (): any => {
    expect('{');
    const out: Record<string, any> = {};
    const samples: [number, any][] = [];
    while (!is('}') && peek().t !== 'eof') {
      const t = peek();
      if (t.t === 'num' && peek(1).v === ':') {
        next();
        next();
        samples.push([Number(t.v), parseValue()]);
      } else if ((t.t === 'id' || t.t === 'str') && peek(1).v === '=') {
        next();
        next();
        out[t.v] = parseValue();
      } else if (t.t === 'id' && (peek(1).t === 'id' || peek(1).t === 'str') && peek(2).v === '=') {
        // typed dictionary entry: `type name = value`
        next();
        const k = next().v;
        next();
        out[k] = parseValue();
      } else if (t.t === 'id' && t.v.endsWith('[]') && peek(1).t !== 'punct') {
        next();
        const k = next().v;
        if (is('=')) {
          next();
          out[k] = parseValue();
        }
      } else next();
      if (is(',') || is(';')) next();
    }
    expect('}');
    return samples.length ? { __samples: samples } : out;
  };

  // ------------------------------------------------------------ metadata blocks
  const parseMeta = (): Record<string, any> => {
    const meta: Record<string, any> = {};
    if (!is('(')) return meta;
    next();
    while (!is(')') && peek().t !== 'eof') {
      const t = peek();
      if (t.t === 'str') {
        next();
        meta.doc = t.v;
        continue;
      }
      let op = '';
      if (t.t === 'id' && ['prepend', 'append', 'add', 'delete', 'reorder'].includes(t.v) && peek(1).t === 'id') {
        op = next().v;
      }
      const key = next().v;
      if (is('=')) {
        next();
        const v = parseValue();
        meta[op ? `${op} ${key}` : key] = v;
        if (!op && key === 'variants') meta.variants = v;
      }
      if (is(';') || is(',')) next();
    }
    expect(')');
    return meta;
  };

  // ------------------------------------------------------------ conversion of values to typed form
  const typed = (type: string, v: any): any => {
    if (v === null || v === undefined) return v;
    const base = type.replace('[]', '');
    const isArr = type.endsWith('[]');
    const isQuat = base.startsWith('quat');
    const flat = (x: any): number[] => {
      if (Array.isArray(x)) {
        if (isQuat && x.length === 4 && x.every((y) => typeof y === 'number')) return [x[1], x[2], x[3], x[0]];
        return x.flatMap(flat);
      }
      return [Number(x)];
    };
    if (base === 'asset') return isArr ? (v as any[]).map((a) => a?.asset ?? a) : (v?.asset ?? v);
    if (base === 'token' || base === 'string') return v;
    if (base === 'bool') return isArr ? (v as any[]).map(Boolean) : Boolean(v);
    if (base === 'int' || base === 'uint' || base === 'int64' || base === 'uchar' || base === 'uint64') return isArr ? Int32Array.from(flat(v)) : Number(v);
    if (/^int[234]$/.test(base)) return isArr ? Int32Array.from(flat(v)) : flat(v);
    if (FLOAT_TYPES.test(base)) {
      const f = flat(v);
      if (isArr) return DOUBLE_TYPES.test(base) ? Float64Array.from(f) : Float32Array.from(f);
      return /[234]|quat|matrix/.test(base) ? f : f[0];
    }
    return v;
  };

  const absPath = (rel: string, primPath: string): string => {
    if (rel.startsWith('/')) return rel;
    const slash = rel.lastIndexOf('/');
    let dot = rel.indexOf('.', slash + 1);
    while (dot >= 0 && rel[dot + 1] === '.') dot = rel.indexOf('.', dot + 2); // skip '..'
    const pp = dot >= 0 ? rel.slice(0, dot) : rel;
    const prop = dot >= 0 ? rel.slice(dot + 1) : undefined;
    let base = primPath.split('/').filter(Boolean);
    for (const part of pp.split('/')) {
      if (part === '..') base = base.slice(0, -1);
      else if (part && part !== '.') base.push(part);
    }
    return `/${base.join('/')}${prop !== undefined ? `.${prop}` : ''}`;
  };

  // ------------------------------------------------------------ properties
  const parseProperty = (primPath: string, props: string[]) => {
    let uniform = false,
      op = '';
    for (;;) {
      const t = peek();
      if (t.t !== 'id') break;
      if (t.v === 'uniform' || t.v === 'config') uniform = true;
      else if (t.v === 'custom' || t.v === 'varying') {
        // qualifiers without effect on the imported data
      } else if (['prepend', 'append', 'add', 'delete', 'reorder'].includes(t.v)) op = t.v;
      else break;
      next();
    }
    if (is('rel')) {
      next();
      const name = next().v.replace(/\.default$/, '');
      const path = `${primPath}.${name}`;
      let targets: string[] = [];
      if (is('=')) {
        next();
        const v = parseValue();
        const list = Array.isArray(v) ? v : [v];
        targets = list.filter((x) => x && x.path !== undefined).map((x) => absPath(x.path, primPath));
      }
      const meta = parseMeta();
      if (op !== 'delete') {
        const prev = specs[path]?.fields.targetPaths ?? [];
        specs[path] = {
          specType: SpecType.Relationship,
          fields: { targetPaths: op === 'append' || op === 'add' ? [...prev, ...targets] : op === 'prepend' ? [...targets, ...prev] : targets, ...meta },
        };
        if (!props.includes(name)) props.push(name);
      }
      return;
    }
    const type = next().v;
    let name = next().v;
    let kind = '';
    if (name.endsWith('.timeSamples')) {
      kind = 'ts';
      name = name.slice(0, -12);
    } else if (name.endsWith('.connect')) {
      kind = 'connect';
      name = name.slice(0, -8);
    } else if (name.endsWith('.spline')) {
      kind = 'spline';
      name = name.slice(0, -7);
    }
    const path = `${primPath}.${name}`;
    const spec = (specs[path] ??= { specType: SpecType.Attribute, fields: { typeName: type } });
    spec.fields.typeName = type;
    if (uniform) spec.fields.variability = 1;
    if (is('=')) {
      next();
      if (kind === 'ts') {
        const v = parseValue();
        const samples: [number, any][] = v?.__samples ?? [];
        samples.sort((a, b) => a[0] - b[0]);
        spec.fields.timeSamples = { times: samples.map((s) => s[0]), values: samples.map((s) => typed(type, s[1])) };
      } else if (kind === 'connect') {
        const v = parseValue();
        const list = Array.isArray(v) ? v : [v];
        spec.fields.connectionPaths = list.filter((x) => x?.path !== undefined).map((x) => absPath(x.path, primPath));
      } else if (kind === 'spline') {
        warnings.push(`Spline-animated attribute ${path} is not supported`);
        skipBalanced();
      } else spec.fields.default = typed(type, parseValue());
    }
    const meta = parseMeta();
    for (const [k, v] of Object.entries(meta)) spec.fields[k] = v;
    if (!props.includes(name)) props.push(name);
  };
  const skipBalanced = () => {
    let depth = 0;
    do {
      const t = next();
      if (t.v === '{' || t.v === '(' || t.v === '[') depth++;
      else if (t.v === '}' || t.v === ')' || t.v === ']') depth--;
      if (t.t === 'eof') return;
    } while (depth > 0);
  };

  // ------------------------------------------------------------ prims
  const parsePrimBody = (path: string, fields: Record<string, any>, selections: Record<string, string>) => {
    const children: string[] = fields.primChildren ?? [];
    const props: string[] = fields.properties ?? [];
    expect('{');
    while (!is('}') && peek().t !== 'eof') {
      const t = peek();
      if (t.t === 'id' && (t.v === 'def' || t.v === 'over' || t.v === 'class')) {
        const name = parsePrim(path);
        if (name && !children.includes(name)) children.push(name);
      } else if (t.t === 'id' && t.v === 'variantSet') {
        next();
        const setName = next().v;
        expect('=');
        expect('{');
        while (!is('}') && peek().t !== 'eof') {
          const vname = next().v;
          parseMeta();
          if (selections[setName] === vname) parsePrimBody(path, Object.assign(fields, { primChildren: children, properties: props }), selections);
          else skipBalanced();
        }
        expect('}');
      } else if (t.t === 'id' && t.v === 'reorder') {
        next();
        next();
        expect('=');
        parseValue();
      } else if (t.t === 'punct' && t.v === ';') next();
      else parseProperty(path, props);
    }
    expect('}');
    fields.primChildren = children;
    fields.properties = props;
  };
  const parsePrim = (parent: string): string | null => {
    const spec = next().v;
    let typeName = '';
    if (peek().t === 'id') typeName = next().v;
    const name = next().v;
    const path = parent === '/' ? `/${name}` : `${parent}/${name}`;
    const meta = parseMeta();
    const prev = specs[path];
    const fields: Record<string, any> = prev?.fields ?? {};
    fields.specifier = spec === 'def' ? 0 : spec === 'over' ? 1 : 2;
    if (typeName) fields.typeName = typeName;
    const selections: Record<string, string> = {};
    for (const [k, v] of Object.entries(meta)) {
      if (k === 'variants' && v && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) selections[sk] = String(sv);
      else if (k.endsWith('apiSchemas')) fields.apiSchemas = v;
      else if (k.endsWith('references') || k.endsWith('payload')) {
        const list = Array.isArray(v) ? v : [v];
        fields.references = [...(fields.references ?? []), ...list.filter(Boolean)];
      } else fields[k] = v;
    }
    specs[path] = { specType: SpecType.Prim, fields };
    parsePrimBody(path, fields, selections);
    return name;
  };

  // ------------------------------------------------------------ layer
  const rootFields: Record<string, any> = {};
  const meta = parseMeta();
  for (const [k, v] of Object.entries(meta)) rootFields[k === 'doc' ? 'documentation' : k] = v;
  specs['/'] = { specType: SpecType.PseudoRoot, fields: rootFields };
  const rootChildren: string[] = [];
  while (peek().t !== 'eof') {
    const t = peek();
    if (t.t === 'id' && (t.v === 'def' || t.v === 'over' || t.v === 'class')) {
      const name = parsePrim('/');
      if (name && !rootChildren.includes(name)) rootChildren.push(name);
    } else next();
  }
  rootFields.primChildren = rootChildren;
  return { specsByPath: specs, warnings };
}
