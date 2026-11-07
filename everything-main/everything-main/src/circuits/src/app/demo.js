// Example project: a 555 astable LED blinker with its board. Built from the
// built-in library so it always matches the current part definitions.

import { mil, mm } from '../core/units.js';
import { uid } from '../core/emitter.js';
import { findComponent, cloneDef } from '../model/library/builtin.js';
import { Project, newProjectData } from '../model/project.js';
import { placeSymbol } from '../model/place.js';
import { planSync, applySync } from '../model/sync.js';

const POWER_NETS = { VCC: 'bar', GND: 'gnd' };

/**
 * parts: [compId, designator, value, x, y, rot, { pinNum: netName }]
 * Each connected pin gets a short wire stub ending in a net label or power port.
 */
function buildSheet(project, sheetDoc, parts) {
  sheetDoc.store.transact('Example', (store) => {
    for (const [compId, designator, value, x, y, rot, nets] of parts) {
      const def = cloneDef(findComponent(compId));
      project.ensureComponent(def);
      const part = { id: uid(), t: 'part', comp: def.id, x: mil(x), y: mil(y), rot, designator, value, uid: uid('u') };
      store.add(part);
      for (const pin of placeSymbol(project.library[def.id], part).pins) {
        const net = nets[pin.num];
        if (!net) continue;
        const a = ((pin.rot + 180) % 360) * Math.PI / 180;
        const len = mil(200);
        const ex = pin.x + Math.round(Math.cos(a) * len), ey = pin.y + Math.round(Math.sin(a) * len);
        store.add({ t: 'wire', pts: [pin.x, pin.y, ex, ey] });
        const dir = (pin.rot + 180) % 360;
        if (POWER_NETS[net]) {
          const style = POWER_NETS[net];
          const prot = style === 'gnd' ? (dir + 90) % 360 : (dir + 270) % 360;
          store.add({ t: 'power', x: ex, y: ey, rot: prot, net, style });
        } else {
          store.add({ t: 'label', x: ex, y: ey, rot: dir === 180 ? 180 : dir === 270 ? 270 : dir === 90 ? 90 : 0, text: net });
        }
      }
    }
  });
}

export function createExampleProject() {
  const data = newProjectData('LED Blinker');
  const project = new Project(data);
  const sheet = project.sheets[0];
  sheet.store.transact('Title', (s) => s.update('sheet', { title: 'LED Blinker', revision: 'A', author: '' }));
  buildSheet(project, sheet, [
    ['ic-555-soic8', 'U1', 'NE555', 4600, 4000, 0, { 1: 'GND', 2: 'THR', 3: 'OUT', 4: 'VCC', 5: 'CV', 6: 'THR', 7: 'DIS', 8: 'VCC' }],
    ['res-0603', 'R1', '10k', 7600, 5600, 90, { 1: 'DIS', 2: 'VCC' }],
    ['res-0603', 'R2', '47k', 7600, 3600, 90, { 1: 'THR', 2: 'DIS' }],
    ['cap-0603', 'C1', '10uF', 2200, 3000, 90, { 1: 'THR', 2: 'GND' }],
    ['cap-0603', 'C2', '10nF', 1200, 3000, 90, { 1: 'CV', 2: 'GND' }],
    ['cap-0603', 'C3', '100nF', 2400, 5600, 90, { 1: 'GND', 2: 'VCC' }],
    ['res-0603', 'R3', '330', 9600, 4600, 0, { 1: 'OUT', 2: 'LED' }],
    ['led-0603-red', 'D1', 'Red', 9600, 3200, 90, { 1: 'GND', 2: 'LED' }],
    ['hdr-1x02', 'J1', 'Power', 1400, 5600, 0, { 1: 'VCC', 2: 'GND' }],
  ]);

  // Board: pull parts in from the schematic, then arrange them on the board.
  const board = project.boards[0];
  board.store.transact('Board shape', (s) => s.update('board', { outline: [0, 0, mm(40), 0, mm(40), mm(30), 0, mm(30)] }));
  applySync(board, planSync(project, board));
  const spots = { U1: [20, 16, 0], R1: [30, 22, 90], R2: [30, 12, 90], C1: [10, 12, 90], C2: [6, 16, 90], C3: [12, 22, 0], R3: [33, 6, 0], D1: [33, 2.6, 0], J1: [5, 25, 90] };
  board.store.transact('Arrange', (s) => {
    for (const o of [...board.items()]) {
      const spot = o.t === 'comp' && spots[o.designator];
      if (spot) s.update(o.id, { x: mm(spot[0]), y: mm(spot[1]), rot: spot[2] });
    }
    s.add({ t: 'pour', layer: 'bottom', net: 'GND', pts: [mm(1), mm(1), mm(39), mm(1), mm(39), mm(29), mm(1), mm(29)], clearance: mm(0.3), name: 'GND' });
    s.add({ t: 'text', layer: 'topOverlay', x: mm(2), y: mm(1.5), text: 'LED BLINKER REV A', h: mm(1.2), w: mm(0.15), rot: 0 });
  });
  for (const d of project.docs) d.store.clearHistory();
  project.markSaved();
  return project;
}
