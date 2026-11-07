import * as X from '../../src/vendor/xlsx.mjs';
import { chartXlsx } from './xlsx-chart-fixture.js';

// Small DrawingML fixture: area baselines cross zero,
// columns share categories, and scatter lines omit X values (ordinal positions).
export function areaComboXlsx({ secondary = false, grouping = 'stacked' } = {}) {
  const zip = X.CFB.read(new Uint8Array(chartXlsx({ embedded: true })), { type: 'array' });
  const set = (name, xml) => {
    const file = X.CFB.find(zip, `/${name}`);
    file.content = new TextEncoder().encode(xml); file.size = file.content.length;
  };
  const vals = [[40, 100, 50, 20, 125], [41, -100, 250, 25, 120], [42, 50, 100, 30, 110]];
  set('xl/worksheets/sheet1.xml', `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>${vals.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}"><v>${v}</v></c>`).join('')}</row>`).join('')}</sheetData><drawing r:id="drawingRef"/></worksheet>`);
  const ref = col => `<c:numRef><c:f>Data!$${col}$1:$${col}$10</c:f><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>9999</c:v></c:pt></c:numCache></c:numRef>`;
  const series = (i, name, col, color, kind) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${name}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln w="38100">${kind === 'scatter' ? `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` : '<a:noFill/>'}</a:ln></c:spPr>${kind === 'scatter' ? '<c:marker><c:symbol val="none"/></c:marker>' : ''}${kind === 'area' ? `<c:cat>${ref('A')}</c:cat>` : ''}<c:${kind === 'scatter' ? 'yVal' : 'val'}>${ref(col)}</c:${kind === 'scatter' ? 'yVal' : 'val'}>${kind === 'scatter' ? '<c:smooth val="1"/>' : ''}</c:ser>`;
  const axes = second => `<c:axId val="1"/><c:axId val="${second ? 3 : 2}"/>`;
  set('xl/charts/run.xml', `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:plotArea><c:layout><c:manualLayout><c:x val=".1"/><c:y val=".1"/><c:w val=".8"/><c:h val=".8"/></c:manualLayout></c:layout><c:areaChart><c:grouping val="${grouping}"/>${series(0, 'Lower', 'B', 'FFFFFF', 'area')}${series(1, 'Band', 'C', '77CCAA', 'area')}${axes()}</c:areaChart><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${series(2, 'Withdrawals', 'D', 'FFAA00', 'column')}<c:gapWidth val="269"/>${axes()}</c:barChart><c:scatterChart><c:scatterStyle val="smoothMarker"/>${series(3, 'Balance', 'E', '123456', 'scatter')}${axes(secondary)}</c:scatterChart><c:catAx><c:axId val="1"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:min val="0"/><c:max val="200"/></c:scaling><c:axPos val="l"/><c:crossAx val="1"/><c:crossBetween val="between"/></c:valAx></c:plotArea><c:legend><c:legendPos val="b"/><c:legendEntry><c:idx val="0"/><c:delete val="1"/></c:legendEntry></c:legend></c:chart></c:chartSpace>`);
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
