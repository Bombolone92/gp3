// Raw interface records of compositor nodes (see data.gen.ts) and their conversion to node types.
import type { SocketValue } from '../../data/types';
import type { NodePropDef, SocketDef, SocketType } from '../../nodes/types';

export interface CompRawSocketOpts {
  d?: SocketValue;
  sub?: string;
  hv?: boolean;
  off?: boolean;
  items?: string[];
  dim?: number;
}
export type CompRawSocket = [name: string, identifier: string, type: string, opts?: CompRawSocketOpts];

export interface CompRawNode {
  label: string;
  width: number;
  inputs: CompRawSocket[];
  outputs: CompRawSocket[];
  props: NodePropDef[];
}

export function socketFromCompRaw(r: CompRawSocket): SocketDef {
  const [name, identifier, type, o] = r;
  const s: SocketDef = { name, identifier, type: type as SocketType };
  if (o) {
    if (o.d !== undefined) s.default = o.d;
    if (o.sub) s.subtype = o.sub;
    if (o.hv) s.hide_value = true;
    if (o.off) s.disabled = true;
    if (o.items) s.items = [...o.items];
    if (o.dim) s.dimensions = o.dim;
  }
  if (s.type === 'VECTOR' && !s.dimensions && Array.isArray(s.default)) s.dimensions = s.default.length;
  return s;
}
