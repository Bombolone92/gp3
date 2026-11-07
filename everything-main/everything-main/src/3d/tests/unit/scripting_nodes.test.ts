// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';

(globalThis as unknown as { requestAnimationFrame: (f: () => void) => number }).requestAnimationFrame = (f) => setTimeout(f, 0) as unknown as number;

import { App, setApp, app } from '../../src/app/app';
import { startupDocument } from '../../src/data/defaults';
import '../../src/nodes/shader/defs';
import { runJavaScript, output } from '../../src/scripting/runner';
import type { MaterialData } from '../../src/data/types';

/** Runs a script and returns what it printed; fails the test on an error. */
function run(code: string) {
  output.clear();
  const r = runJavaScript(code);
  if (!r.ok) throw new Error(`${r.error} (line ${r.line})`);
  return output.lines.map((l) => l.text).join('\n');
}
const material = (name: string) => Object.values(app.doc.materials).find((m) => m.name === name) as MaterialData;

beforeEach(() => setApp(new App(startupDocument())));

describe('shader nodes from scripts', () => {
  it('come with their default settings, which can be read and changed', () => {
    expect(run(`const t = D.materials.new('M').node_tree; const m = t.nodes.new('ShaderNodeMath'); print(m.operation); m.operation = 'MULTIPLY'; print(m.operation); const w = t.nodes.new('ShaderNodeTexWave'); print(w.wave_type)`)).toBe('ADD\nMULTIPLY\nBANDS');
    expect(run(`print(D.materials.new('N').node_tree.nodes.new('ShaderNodeTexNoise').inputs['Scale'].default_value)`)).toBe('5');
  });

  it("store values and links by the socket's identifier", () => {
    run(`const t = D.materials.new('Mixed').node_tree;
      const mix = t.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA';
      mix.inputs['A'].default_value = [1, 0, 0, 1];
      mix.inputs[7].default_value = [0, 0, 1, 1];
      t.links.new(mix.outputs['Result'], t.nodes.get('Principled BSDF').inputs['Base Color']);`);
    const tree = material('Mixed').tree;
    const mix = tree.nodes.find((n) => n.type === 'ShaderNodeMix')!;
    expect(mix.inputs).toEqual({ A_Color: [1, 0, 0, 1], B_Color: [0, 0, 1, 1] });
    expect(tree.links.map((l) => `${l.from_socket}->${l.to_socket}`)).toContain('Result_Color->Base Color');
  });

  it('list every socket in order with whether it is available', () => {
    expect(run(`const mix = D.materials.new('M').node_tree.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; print(mix.inputs.length, mix.inputs[6].name, mix.inputs[6].enabled, mix.inputs[2].enabled, mix.outputs[2].identifier)`)).toBe('8 A true false Result_Color');
  });

  it('raise on unknown sockets and node types, naming what there is', () => {
    expect(() => run(`D.materials.new('M').node_tree.nodes.get('Principled BSDF').inputs['Specular'].default_value = 1`)).toThrow(/key "Specular" not found.*"Specular IOR Level"/);
    expect(() => run(`D.materials.new('M').node_tree.nodes.new('ShaderNodeNope')`)).toThrow(/Node type ShaderNodeNope undefined/);
    expect(run(`print(D.materials.new('M').node_tree.nodes.get('Principled BSDF').inputs.get('Nope'))`)).toBe('null');
  });

  it('edit a color ramp through its elements', () => {
    expect(run(`const r = D.materials.new('Ramp').node_tree.nodes.new('ShaderNodeValToRGB').color_ramp;
      print(r.elements.length, r.interpolation);
      r.elements[0].color = [1, 0, 0, 1];
      const mid = r.elements.new(0.5); mid.color = [0, 1, 0, 1];
      r.elements[2].position = 0.9;
      print(r.elements.length, r.elements[1].position, r.evaluate(0.25));
      r.elements.remove(r.elements[1]);
      print(r.elements.length)`)).toBe('2 LINEAR\n3 0.5 [0.5, 0.5, 0, 1]\n2');
    const node = material('Ramp').tree.nodes.find((n) => n.type === 'ShaderNodeValToRGB')!;
    expect(node.props.color_ramp).toEqual([0, 1, 0, 0, 1, 0.9, 1, 1, 1, 1]);
  });
});
