// Main menu structure. Items reference commands by id; the menubar rebuilds
// when the active editor changes so each document type shows its own menus.

import { recentProjects, locationLabel } from './storage.js';

export function buildMenus(app) {
  const kind = app.activeEditor?.kind || null;
  const sch = kind === 'sch', pcb = kind === 'pcb', lib = kind === 'lib';
  const recent = () => {
    const list = recentProjects();
    if (!list.length) return [{ label: 'No recent projects', disabled: true, run: () => {} }];
    return list.slice(0, 8).map((r) => ({ label: `${r.name}`, shortcut: locationLabel(r.location), run: () => app.openLocation(r.location) }));
  };
  const file = {
    label: '&File',
    items: () => [
      { label: '&New', icon: 'new', items: [{ command: 'file.new' }, { command: 'project.addSheet' }, { command: 'project.addBoard' }, { command: 'lib.newComponent' }] },
      { command: 'file.open' },
      { label: 'Open &recent', icon: 'history', items: recent },
      { command: 'file.openExample' },
      { separator: true },
      { command: 'file.save' }, { command: 'file.saveAs' }, { command: 'file.download' },
      { command: 'file.history' }, { command: 'file.share' },
      { separator: true },
      { command: 'file.import' },
      { label: '&Import', icon: 'upload', items: [{ command: 'file.importKicad' }] },
      { label: '&Export', icon: 'download', items: [
        { command: 'export.fabrication' }, { command: 'export.gerber' }, { command: 'export.drill' },
        { separator: true },
        { command: 'export.bom' }, { command: 'export.pnp' }, { command: 'export.netlist' },
        { separator: true },
        { command: 'export.svg' },
      ] },
      { command: 'file.print' },
      { separator: true },
      { command: 'file.close' },
    ],
  };
  const edit = {
    label: '&Edit',
    items: () => [
      { command: 'edit.undo' }, { command: 'edit.redo' },
      { separator: true },
      { command: 'edit.cut' }, { command: 'edit.copy' }, { command: 'edit.paste' }, { command: 'edit.duplicate' }, { command: 'edit.delete' },
      { separator: true },
      { command: 'edit.selectAll' }, { command: 'edit.find' },
      { separator: true },
      sch ? { command: 'sch.rotate' } : pcb ? { command: 'pcb.rotate' } : null,
      sch ? { command: 'sch.mirrorX' } : null, sch ? { command: 'sch.mirrorY' } : null,
      pcb ? { command: 'pcb.flip' } : null,
      { label: '&Align', icon: 'align', items: [
        { command: 'edit.alignLeft' }, { command: 'edit.alignRight' }, { command: 'edit.alignTop' }, { command: 'edit.alignBottom' },
        { separator: true }, { command: 'edit.distributeH' }, { command: 'edit.distributeV' },
      ] },
      { separator: true },
      { command: 'edit.properties' },
      { command: 'app.preferences' },
    ].filter(Boolean),
  };
  const view = {
    label: '&View',
    items: () => [
      { command: 'view.fit' }, { command: 'view.fitContent' }, { command: 'view.fitSelection' },
      pcb ? { command: 'pcb.fitBoard' } : null,
      { command: 'view.zoomIn' }, { command: 'view.zoomOut' },
      { separator: true },
      pcb ? { command: 'pcb.view2d' } : null, pcb ? { command: 'pcb.toggle3d' } : null,
      pcb ? { command: 'pcb.singleLayer' } : null,
      pcb ? { command: 'pcb.nextLayer' } : null, pcb ? { command: 'pcb.prevLayer' } : null,
      { separator: true },
      { command: 'view.cycleGrid' }, { command: 'view.setGrid' }, { command: 'view.toggleUnits' },
      pcb ? { command: 'view.hud' } : null,
      { separator: true },
      { label: '&Panels', icon: 'panel-right', items: [{ command: 'panel.projects' }, { command: 'panel.navigator' }, { command: 'panel.properties' }, { command: 'panel.components' }, pcb ? { command: 'panel.layers' } : null, { command: 'panel.messages' }].filter(Boolean) },
      { label: '&Theme', icon: 'sun', items: [{ command: 'theme.system' }, { command: 'theme.light' }, { command: 'theme.dark' }] },
    ].filter(Boolean),
  };
  const project = {
    label: 'Proje&ct',
    items: () => [
      { command: 'project.compile' }, { command: 'sch.annotate' }, { command: 'project.updateBoard' },
      { separator: true },
      { command: 'project.addSheet' }, { command: 'project.addBoard' },
      { separator: true },
      { command: 'lib.manage' }, { command: 'lib.newComponent' }, { command: 'lib.blankComponent' }, { command: 'lib.footprintWizard' },
      { separator: true },
      { command: 'project.rename' },
    ],
  };
  const placeSch = {
    label: '&Place',
    items: () => [
      { command: 'sch.place.part' }, { command: 'sch.place.wire' }, { command: 'sch.place.bus' },
      { command: 'sch.place.label' }, { command: 'sch.place.power' }, { command: 'sch.place.ground' }, { command: 'sch.place.port' },
      { command: 'sch.place.junction' }, { command: 'sch.place.noerc' },
      { separator: true },
      { label: '&Drawing tools', icon: 'pencil', items: [{ command: 'sch.place.line' }, { command: 'sch.place.rect' }, { command: 'sch.place.circle' }] },
      { command: 'sch.place.text' },
    ],
  };
  const placePcb = {
    label: '&Place',
    items: () => [
      { command: 'pcb.place.component' }, { command: 'pcb.place.via' }, { command: 'pcb.place.pad' },
      { separator: true },
      { command: 'pcb.place.pour' }, { command: 'pcb.place.fill' }, { command: 'pcb.place.region' }, { command: 'pcb.place.keepout' },
      { separator: true },
      { command: 'pcb.place.line' }, { command: 'pcb.place.text' }, { command: 'pcb.place.dimension' },
    ],
  };
  const designSch = {
    label: '&Design',
    items: () => [{ command: 'project.updateBoard' }, { separator: true }, { command: 'sch.sheetOptions' }, { command: 'lib.newComponent' }],
  };
  const designPcb = {
    label: '&Design',
    items: () => [
      { command: 'project.updateBoard' },
      { separator: true },
      { command: 'pcb.rules' }, { command: 'pcb.layerStack' },
      { label: '&Board shape', icon: 'board', items: [{ command: 'pcb.boardSize' }, { command: 'pcb.redefineBoard' }, { command: 'pcb.addCutout' }, { command: 'pcb.setOrigin' }] },
      { command: 'pcb.boardOptions' },
    ],
  };
  const toolsSch = {
    label: '&Tools',
    items: () => [{ command: 'sch.annotate' }, { command: 'project.compile' }, { separator: true }, { command: 'sch.clearHighlight' }, { command: 'app.preferences' }],
  };
  const toolsPcb = {
    label: '&Tools',
    items: () => [
      { command: 'pcb.drc' }, { command: 'pcb.repour' },
      { separator: true },
      { command: 'pcb.measure' }, { command: 'pcb.clearHighlight' },
      { separator: true },
      { command: 'app.preferences' },
    ],
  };
  const route = {
    label: 'Ro&ute',
    items: () => [
      { command: 'pcb.route' },
      { separator: true },
      { command: 'pcb.autorouteAll' }, { command: 'pcb.autorouteNet' },
      { separator: true },
      { command: 'pcb.unrouteAll' }, { command: 'pcb.unrouteNet' },
      { separator: true },
      { command: 'pcb.routingMode' },
    ],
  };
  const reports = {
    label: '&Reports',
    items: () => [{ command: 'export.bom' }, { command: 'report.boardInfo' }, { command: 'export.netlist' }],
  };
  const windowMenu = {
    label: '&Window',
    items: () => [
      ...app.openTabs.map((id, i) => {
        const d = app.project?.getDoc(id);
        return d ? { label: `${i < 9 ? `&${i + 1} ` : ''}${d.name}`, checked: id === app.activeDocId, run: () => app.openDoc(id) } : null;
      }).filter(Boolean),
      { separator: true },
      { command: 'window.nextTab' }, { command: 'window.closeTab' }, { command: 'window.closeAll' },
      { separator: true },
      { command: 'window.resetLayout' },
    ],
  };
  const help = {
    label: '&Help',
    items: () => [{ command: 'help.gettingStarted' }, { command: 'help.shortcuts' }, { command: 'help.commands' }, { separator: true }, { command: 'help.github' }, { command: 'help.about' }],
  };
  const menus = [file, edit, view, project];
  if (sch) menus.push(placeSch, designSch, toolsSch);
  if (pcb) menus.push(placePcb, designPcb, toolsPcb, route);
  if (lib) {
    // Component editor: placing pins, pads and drawing, and component tools.
    menus.push({
      label: '&Place',
      items: () => [
        { command: 'libed.place.pin' }, { command: 'libed.place.pad' }, { command: 'libed.padArray' },
        { separator: true },
        { command: 'libed.place.line' }, { command: 'libed.place.rect' }, { command: 'libed.place.circle' }, { command: 'libed.place.arc' }, { command: 'libed.place.poly' }, { command: 'libed.place.text' },
      ],
    }, {
      label: '&Tools',
      items: () => [
        { command: 'libed.mode.symbol' }, { command: 'libed.mode.footprint' },
        { separator: true },
        { command: 'libed.pinTable' }, { command: 'libed.courtyard' }, { command: 'libed.validate' },
        { separator: true },
        { command: 'libed.rotate' }, { command: 'libed.mirrorX' }, { command: 'libed.mirrorY' },
        { separator: true },
        { command: 'libed.save' },
      ],
    });
  }
  menus.push(reports, windowMenu, help);
  return menus;
}
