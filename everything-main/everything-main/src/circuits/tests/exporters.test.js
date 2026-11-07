import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { exportGerbers, gerberExtension } from '../src/io/gerber.js';
import { exportDrill } from '../src/io/excellon.js';
import { buildBom, toCsv } from '../src/io/bom.js';
import { pickAndPlace } from '../src/io/pnp.js';
import { formatNetlist } from '../src/io/netlist.js';
import { schematicToSvg, boardToSvg } from '../src/io/svg.js';
import { buildFabricationZip } from '../src/io/fabrication.js';
import { csvField } from '../src/io/common.js';
import { sheetSize } from '../src/io/schgraphics.js';
import { mm, mil } from '../src/core/units.js';
import { defaultRules } from '../src/model/schema.js';

const RES = {
  id: 'res', name: 'Resistor', description: 'Chip resistor', prefix: 'R', value: '10k', params: { Tolerance: '1%' },
  symbol: {
    pins: [
      { num: '1', name: '1', x: -mil(200), y: 0, length: mil(100), rot: 0, type: 'passive', hideName: true },
      { num: '2', name: '2', x: mil(200), y: 0, length: mil(100), rot: 180, type: 'passive', hideName: true },
    ],
    graphics: [{ t: 'rect', x1: -mil(100), y1: -mil(40), x2: mil(100), y2: mil(40), w: mil(10), fill: true }],
    designatorPos: { x: -mil(100), y: mil(60) },
    valuePos: { x: -mil(100), y: -mil(110) },
  },
  footprint: {
    name: '0603',
    pads: [
      { num: '1', x: -mm(0.8), y: 0, shape: 'roundrect', w: mm(0.9), h: mm(1), side: 'top', radius: 0.25 },
      { num: '2', x: mm(0.8), y: 0, shape: 'rect', w: mm(0.9), h: mm(1), side: 'top' },
    ],
    graphics: [
      { t: 'line', x1: -mm(0.2), y1: mm(0.7), x2: mm(0.2), y2: mm(0.7), w: mm(0.12), layer: 'topOverlay' },
      { t: 'line', x1: -mm(0.2), y1: -mm(0.7), x2: mm(0.2), y2: -mm(0.7), w: mm(0.12), layer: 'topOverlay' },
    ],
    courtyard: { x1: -mm(1.5), y1: -mm(0.8), x2: mm(1.5), y2: mm(0.8) },
  },
};

const HDR = {
  id: 'hdr', name: 'Header 1x2', prefix: 'J', value: 'CONN',
  symbol: { pins: [{ num: '1', name: 'A', x: 0, y: 0, length: mil(100), rot: 0, type: 'passive' }, { num: '2', name: '~EN', x: 0, y: -mil(100), length: mil(100), rot: 0, type: 'input', shape: 'dot' }], graphics: [] },
  footprint: {
    name: 'PinHeader_1x02',
    pads: [
      { num: '1', x: 0, y: 0, shape: 'rect', w: mm(1.7), h: mm(1.7), side: 'thru', drill: mm(1) },
      { num: '2', x: 0, y: -mm(2.54), shape: 'oval', w: mm(1.7), h: mm(1.7), side: 'thru', drill: mm(1), rot: 30 },
    ],
    graphics: [],
  },
};

const library = { res: RES, hdr: HDR };

function board() {
  return {
    id: 'b1', kind: 'pcb', name: 'Test Board.pcb',
    board: { outline: [0, 0, mm(30), 0, mm(30), mm(20), 0, mm(20)], origin: { x: 0, y: 0 }, copper: 2, thickness: mm(1.6) },
    rules: defaultRules(),
    nets: { GND: {}, VCC: {} },
    objects: [
      { id: 'c1', t: 'comp', comp: 'res', x: mm(10), y: mm(10), rot: 90, side: 'top', designator: 'R1', value: '10k', uid: 'u1', padNets: { 1: 'VCC', 2: 'GND' } },
      { id: 'c2', t: 'comp', comp: 'res', x: mm(20), y: mm(10), rot: 0, side: 'bottom', designator: 'R2', uid: 'u2', padNets: { 1: 'VCC', 2: 'GND' } },
      { id: 'c3', t: 'comp', comp: 'hdr', x: mm(5), y: mm(15), rot: 0, side: 'top', designator: 'J1', uid: 'u3', padNets: { 1: 'VCC', 2: 'GND' } },
      { id: 't1', t: 'track', layer: 'top', x1: mm(5), y1: mm(15), x2: mm(10), y2: mm(15), w: mm(0.25), net: 'VCC' },
      { id: 'a1', t: 'arc', layer: 'top', cx: mm(15), cy: mm(15), r: mm(2), a0: 0, sweep: 90, w: mm(0.25), net: 'VCC' },
      { id: 'v1', t: 'via', x: mm(12), y: mm(12), d: mm(0.6), drill: mm(0.3), from: 'top', to: 'bottom', net: 'GND' },
      { id: 'h1', t: 'pad', x: mm(2), y: mm(2), shape: 'round', w: mm(3), h: mm(3), side: 'thru', drill: mm(3), plated: false },
      { id: 'p1', t: 'pour', layer: 'bottom', pts: [0, 0, mm(30), 0, mm(30), mm(20), 0, mm(20)], net: 'GND', clearance: mm(0.3) },
      { id: 's1', t: 'text', layer: 'topOverlay', x: mm(1), y: mm(18), text: 'REV A', h: mm(1), w: mm(0.15) },
    ],
  };
}

const pourFills = {
  p1: [[
    [mm(1), mm(1), mm(29), mm(1), mm(29), mm(19), mm(1), mm(19)],
    [mm(11), mm(9), mm(11), mm(11), mm(13), mm(11), mm(13), mm(9)],
  ]],
};

function project() {
  return {
    format: 'circuits-project', version: 1, id: 'p', name: 'Demo',
    library,
    documents: [
      {
        id: 's1', kind: 'sch', name: 'Main.sch', sheet: { size: 'A4', orientation: 'landscape', title: 'Demo <&>' },
        objects: [
          { id: 'o1', t: 'part', comp: 'res', x: mil(1000), y: mil(1000), rot: 0, designator: 'R2', value: '10k', uid: 'u2' },
          { id: 'o2', t: 'part', comp: 'res', x: mil(2000), y: mil(1000), rot: 90, designator: 'R1', value: '10k', uid: 'u1', params: { MPN: 'RC0603, "1%"' } },
          { id: 'o3', t: 'part', comp: 'res', x: mil(3000), y: mil(1000), rot: 0, designator: 'R10', value: '4.7k', uid: 'u4' },
          { id: 'o4', t: 'part', comp: 'res', x: mil(3000), y: mil(2000), rot: 0, designator: 'R3', value: '10k', uid: 'u5', dnp: true },
          { id: 'o5', t: 'part', comp: 'hdr', x: mil(500), y: mil(500), rot: 180, mirror: true, designator: 'J1', uid: 'u3' },
          { id: 'w1', t: 'wire', pts: [mil(1200), mil(1000), mil(1800), mil(1000), mil(1800), mil(1500)] },
          { id: 'l1', t: 'label', x: mil(1200), y: mil(1000), rot: 0, text: 'SDA' },
          { id: 'g1', t: 'power', x: mil(800), y: mil(1000), rot: 0, net: 'GND', style: 'gnd' },
          { id: 'g2', t: 'power', x: mil(800), y: mil(1500), rot: 90, net: 'VCC', style: 'bar' },
          { id: 'g3', t: 'power', x: mil(900), y: mil(1500), rot: 0, net: '3V3', style: 'wave' },
          { id: 'pt', t: 'port', x: mil(2500), y: mil(2500), rot: 180, name: 'OUT', io: 'out' },
          { id: 'ne', t: 'noerc', x: mil(2600), y: mil(2600) },
          { id: 'tx', t: 'text', x: mil(100), y: mil(100), text: 'Note', size: mil(60) },
          { id: 'gr', t: 'grect', x1: 0, y1: 0, x2: mil(100), y2: mil(100), w: mil(10), fill: true },
          { id: 'gc', t: 'gcircle', cx: mil(200), cy: mil(200), r: mil(50), w: mil(10) },
          { id: 'gl', t: 'gline', pts: [0, 0, mil(100), mil(100)], w: 0 },
        ],
      },
      board(),
    ],
  };
}

/** Checks Gerber syntax: header, apertures defined before use, M02 at the end. */
function checkGerber(content) {
  const lines = content.trim().split('\n');
  expect(lines[0]).toMatch(/^%TF\.GenerationSoftware,Circuits/);
  expect(content).toContain('%FSLAX46Y46*%');
  expect(content).toContain('%MOMM*%');
  expect(lines[lines.length - 1]).toBe('M02*');
  const defined = new Set();
  for (const line of lines) {
    const ad = line.match(/^%ADD(\d+)/);
    if (ad) defined.add(Number(ad[1]));
    const use = line.match(/^D(\d+)\*$/);
    if (use && Number(use[1]) >= 10) expect(defined.has(Number(use[1])), `D${use[1]} defined before use`).toBe(true);
    if (!line.startsWith('%') && !line.endsWith('*%')) expect(line.endsWith('*'), line).toBe(true);
  }
  let regions = 0;
  for (const line of lines) {
    if (line === 'G36*') regions++;
    if (line === 'G37*') regions--;
    expect(regions === 0 || regions === 1).toBe(true);
  }
  expect(regions).toBe(0);
}

describe('Gerber export', () => {
  const files = exportGerbers(board(), library, { pourFills });
  const byLayer = Object.fromEntries(files.map((f) => [f.layer, f]));

  it('writes every manufacturing layer with neutral extensions', () => {
    expect(files.map((f) => f.name)).toEqual([
      'Test_Board.GTL', 'Test_Board.GBL', 'Test_Board.GTO', 'Test_Board.GBO', 'Test_Board.GTS',
      'Test_Board.GBS', 'Test_Board.GTP', 'Test_Board.GBP', 'Test_Board.GKO',
    ]);
    for (const f of files) checkGerber(f.content);
    expect(gerberExtension('in1', 4)).toBe('G1');
    expect(gerberExtension('in2', 4)).toBe('G2');
  });

  it('labels files with X2 file functions', () => {
    expect(byLayer.top.content).toContain('%TF.FileFunction,Copper,L1,Top*%');
    expect(byLayer.bottom.content).toContain('%TF.FileFunction,Copper,L2,Bot*%');
    expect(byLayer.topSolder.content).toContain('%TF.FilePolarity,Negative*%');
    expect(byLayer.profile.content).toContain('%TF.FileFunction,Profile,NP*%');
  });

  it('writes nanometre coordinates in 4.6 format', () => {
    // Track from (5, 15) mm to (10, 15) mm.
    expect(byLayer.top.content).toContain('X5000000Y15000000D02*');
    expect(byLayer.top.content).toContain('X10000000Y15000000D01*');
    expect(byLayer.top.content).toMatch(/%ADD\d+C,0\.25\*%/);
    // Arc from (17, 15) to (15, 17) around (15, 15).
    expect(byLayer.top.content).toContain('G03X15000000Y17000000I-2000000J0D01*');
  });

  it('flashes pads, vias and through-hole pads on the right layers', () => {
    const top = byLayer.top.content;
    // R1 rotated 90: rect pad 0.9 x 1 becomes 1 x 0.9.
    expect(top).toMatch(/%ADD\d+R,1X0\.9\*%/);
    expect(top).toMatch(/%AMM\d+\*/); // rounded rectangle and rotated oval macros
    expect(top).toContain('X12000000Y12000000D03*'); // via
    expect(top).toContain('%TA.AperFunction,ViaPad*%');
    expect(top).toContain('%TO.N,VCC*%');
    // R2 sits on the bottom: its pads appear on the bottom copper only.
    expect(byLayer.bottom.content).toContain('X19200000Y10000000D03*');
    expect(top).not.toContain('X19200000Y10000000D03*');
  });

  it('draws pour fills as dark regions with clear holes', () => {
    const bottom = byLayer.bottom.content;
    const lpc = bottom.indexOf('%LPC*%');
    expect(bottom.indexOf('G36*')).toBeGreaterThan(0);
    expect(lpc).toBeGreaterThan(bottom.indexOf('G36*'));
    expect(bottom.indexOf('%LPD*%', lpc)).toBeGreaterThan(lpc);
  });

  it('puts designators on the silkscreen of the side they sit on', () => {
    expect(byLayer.topOverlay.content.split('D01*').length).toBeGreaterThan(10);
    expect(byLayer.bottomOverlay.content.split('D01*').length).toBeGreaterThan(5);
  });

  it('writes paste openings for SMD pads only', () => {
    const paste = byLayer.topPaste.content;
    expect(paste).not.toContain('X5000000Y15000000D03*'); // J1 through-hole pad
    expect(paste.match(/D03\*/g).length).toBe(2);
  });

  it('adds inner copper layers on four-layer boards', () => {
    const b = board();
    b.board.copper = 4;
    const names = exportGerbers(b, library, {}).map((f) => f.name);
    expect(names).toContain('Test_Board.G1');
    expect(names).toContain('Test_Board.G2');
  });
});

describe('drill export', () => {
  it('splits plated and non-plated holes with a tool table', () => {
    const files = exportDrill(board(), library);
    expect(files.map((f) => f.name)).toEqual(['Test_Board-PTH.drl', 'Test_Board-NPTH.drl']);
    const pth = files[0].content;
    expect(pth.startsWith('M48\n')).toBe(true);
    expect(pth).toContain('METRIC');
    expect(pth).toContain('T1C0.300');
    expect(pth).toContain('T2C1.000');
    expect(pth).toContain('X12.000Y12.000');
    expect(pth.trim().endsWith('M30')).toBe(true);
    expect(pth.indexOf('%')).toBeLessThan(pth.indexOf('X12.000'));
    expect(files[0].count).toBe(3);
    expect(files[1].content).toContain('T1C3.000');
    expect(files[1].content).toContain('NonPlated');
  });
});

describe('BOM and placement', () => {
  it('groups parts by component, value and footprint, skipping DNP', () => {
    const rows = buildBom(project());
    expect(rows.map((r) => r.designators.join(' '))).toEqual(['J1', 'R1 R2', 'R10']);
    expect(rows[1].quantity).toBe(2);
    expect(rows[1].params.MPN).toBe('RC0603, "1%"');
    const csv = toCsv(rows);
    expect(csv.split('\r\n')[0]).toBe('Designator,Quantity,Value,Footprint,Description,Tolerance,MPN');
    expect(csv).toContain('"R1, R2",2,10k,0603,Chip resistor,1%,"RC0603, ""1%"""');
  });

  it('escapes CSV fields', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField('=1+1')).toBe("'=1+1");
    expect(csvField(null)).toBe('');
  });

  it('lists placements relative to the origin', () => {
    const b = board();
    b.board.origin = { x: mm(1), y: mm(1) };
    const lines = pickAndPlace(b, library).trim().split('\r\n');
    expect(lines[0]).toBe('Designator,Value,Footprint,X(mm),Y(mm),Rotation,Side');
    expect(lines[1]).toBe('J1,CONN,PinHeader_1x02,4.0000,14.0000,0,Top');
    expect(lines[2]).toBe('R1,10k,0603,9.0000,9.0000,90,Top');
    expect(lines[3]).toBe('R2,10k,0603,19.0000,9.0000,0,Bottom');
  });

  it('formats a netlist', () => {
    const text = formatNetlist({
      nets: [{ name: 'VCC', nodes: [{ ref: 'R2', pin: '1' }, { ref: 'R1', pin: '1' }] }, { name: 'GND', nodes: [{ ref: 'R1', pin: '2' }] }],
      parts: [{ ref: 'R1', value: '10k', footprint: '0603' }],
    });
    expect(text).toContain('NETS (2)');
    expect(text).toContain('  VCC: R1.1 R2.1');
    expect(text.indexOf('GND:')).toBeLessThan(text.indexOf('VCC:'));
  });
});

describe('SVG export', () => {
  const parse = (svg) => new DOMParser().parseFromString(svg, 'image/svg+xml');

  it('exports a well-formed schematic with frame and symbols', () => {
    const p = project();
    const svg = schematicToSvg(p.documents[0], library, { junctions: [{ x: mil(1800), y: mil(1000) }], info: { date: '2026-01-01' } });
    const doc = parse(svg);
    expect(doc.querySelector('parsererror')).toBeNull();
    const root = doc.documentElement;
    expect(root.getAttribute('width')).toBe('297mm');
    expect(root.getAttribute('viewBox')).toBe('0 0 297 210');
    expect(doc.querySelector('title').textContent).toBe('Demo <&>');
    expect(doc.querySelectorAll('path').length).toBeGreaterThan(20);
    expect(doc.querySelectorAll('circle').length).toBeGreaterThan(0);
    expect(sheetSize({ size: 'A3', orientation: 'portrait' })).toEqual({ w: mm(297), h: mm(420) });
  });

  it('exports a print version in black', () => {
    const svg = schematicToSvg(project().documents[0], library, { theme: 'print' });
    expect(svg).not.toContain('#1f4bd1');
    expect(parse(svg).querySelector('parsererror')).toBeNull();
  });

  it('exports a well-formed board, mirrored for the bottom view', () => {
    for (const mirror of [false, true]) {
      const svg = boardToSvg(board(), library, { pourFills, mirror });
      const doc = parse(svg);
      expect(doc.querySelector('parsererror')).toBeNull();
      expect(doc.querySelector('#layer-top')).not.toBeNull();
      expect(doc.querySelector('#layer-bottom path')).not.toBeNull();
      expect(doc.querySelectorAll('#holes circle').length).toBe(4);
    }
  });
});

describe('fabrication package', () => {
  it('zips Gerbers, drills, BOM, placement, netlist and a readme', () => {
    const p = project();
    const bytes = buildFabricationZip(p, 'b1', { pourFills, netlist: { nets: [], parts: [] }, date: new Date('2026-05-01T00:00:00Z') });
    const files = unzipSync(bytes);
    const names = Object.keys(files).sort();
    expect(names).toContain('gerber/Test_Board.GTL');
    expect(names).toContain('gerber/Test_Board.GKO');
    expect(names).toContain('drill/Test_Board-PTH.drl');
    expect(names).toContain('assembly/bom.csv');
    expect(names).toContain('assembly/pick-and-place.csv');
    expect(names).toContain('netlist.txt');
    const readme = strFromU8(files['README.txt']);
    expect(readme).toContain('Copper layers: 2');
    expect(readme).toContain('Test_Board.GTL');
    expect(() => buildFabricationZip(p, 'nope')).toThrow();
  });
});
