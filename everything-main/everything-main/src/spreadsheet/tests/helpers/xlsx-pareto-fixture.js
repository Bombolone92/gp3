import * as X from '../../src/vendor/xlsx.mjs';
import { otherProgramsXlsx } from './xlsx-fixture.js';

// A cost-analysis workbook with the native features under test.
export function paretoXlsx({ externalImage = false, columnOnly = false, reverseAxes = false } = {}) {
  const ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const text = (addr, value, style = 0) => `<c r="${addr}" s="${style}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const bytes = otherProgramsXlsx({
    sheetXml: { Data: {
      head: '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><cols><col min="1" max="1" width="49.28515625"/><col min="2" max="3" width="35.42578125"/><col min="4" max="4" width="127.5703125"/></cols>',
      rows: `<row r="1" ht="120">${text('A1', 'Cost Analysis', 1)}</row><row r="2" ht="48">${text('A2', 'Cost center')}${text('B2', 'Annual cost')}${text('C2', 'Cumulative percent')}</row>`
        + [20, 10, 5].map((v, i) => `<row r="${i + 3}" ht="34.9">${text(`A${i + 3}`, ['Parts and materials', 'Manufacturing equipment', 'Salaries'][i])}<c r="B${i + 3}"><v>${v}</v></c><c r="C${i + 3}"><f>SUM($B$3:B${i + 3})/SUM($B$3:$B$5)</f><v>99</v></c></row>`).join(''),
      tail: '<drawing r:id="draw"/>',
    } },
    styles: { fonts: ['<font><b/><sz val="72"/><name val="Aharoni"/></font>'], cellXfs: ['<xf fontId="1"/>'] },
    patch: { '/xl/styles.xml': xml => xml.replace(/<font>[\s\S]*?<\/font>/, '<font><sz val="11"/><name val="Garamond"/></font>') },
  });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const add = (part, data) => X.CFB.utils.cfb_add(zip, part, typeof data === 'string' ? new TextEncoder().encode(data) : data);
  const rel = (id, type, target, external = false) => `<Relationship Id="${id}" Type="${ns}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`;
  const rels = body => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  add('xl/worksheets/_rels/sheet1.xml.rels', rels(rel('draw', 'drawing', '../drawings/cost.xml')));
  add('xl/drawings/_rels/cost.xml.rels', rels(rel('plot', 'chart', '../charts/pareto.xml')
    + rel('art', 'image', externalImage ? 'https://example.com/image.png' : '../media/art.png', externalImage)));
  const point = (tag, col, row, x, y) => `<xdr:${tag}><xdr:col>${col}</xdr:col><xdr:colOff>${x * 9525}</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${y * 9525}</xdr:rowOff></xdr:${tag}>`;
  add('xl/drawings/cost.xml', `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${ns}">`
    + `<xdr:twoCellAnchor>${point('from', 3, 2, 10, 4)}${point('to', 3, 5, 710, 34)}<xdr:graphicFrame><c:chart r:id="plot"/></xdr:graphicFrame></xdr:twoCellAnchor>`
    + `<xdr:twoCellAnchor>${point('from', 3, 0, 40, 10)}${point('to', 3, 1, 640, 20)}<xdr:pic><xdr:nvPicPr><xdr:cNvPr name="Artwork" descr="Cost analysis illustration"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="art"/></xdr:blipFill><xdr:spPr><a:xfrm flipH="1"/></xdr:spPr></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>`);
  add('xl/media/art.png', Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8ioAAAAASUVORK5CYII='), c => c.charCodeAt(0)));
  const ref = (col, format) => `<c:numRef><c:f>Data!$${col}$3:$${col}$5</c:f><c:numCache><c:formatCode>${format}</c:formatCode></c:numCache></c:numRef>`;
  const solid = color => `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
  const bars = `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:tx><c:v>Annual cost</c:v></c:tx><c:spPr>${solid('273E55')}</c:spPr><c:cat><c:strRef><c:f>Data!$A$3:$A$5</c:f></c:strRef></c:cat><c:val>${ref('B', '$#,##0.00')}</c:val></c:ser><c:gapWidth val="269"/><c:axId val="1"/><c:axId val="2"/></c:barChart>`;
  const line = `<c:lineChart><c:ser><c:tx><c:v>Cumulative percent</c:v></c:tx><c:spPr><a:ln w="38100">${solid('F3AEA7')}</a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker><c:val>${ref('C', '0.00%')}</c:val></c:ser><c:axId val="3"/><c:axId val="4"/></c:lineChart>`;
  const axis = (id, format, max = '') => `<c:valAx><c:axId val="${id}"/><c:scaling>${max}</c:scaling><c:numFmt formatCode="${format}"/></c:valAx>`;
  const axes = [axis(2, '$#,##0.00'), axis(4, '0.00%', '<c:max val="1"/>')];
  add('xl/charts/pareto.xml', `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:plotArea><c:layout><c:manualLayout><c:x val=".16"/><c:y val=".07"/><c:w val=".72"/><c:h val=".69"/></c:manualLayout></c:layout>${bars}${columnOnly ? '' : line}<c:catAx><c:axId val="1"/></c:catAx>${(reverseAxes ? axes.reverse() : axes).join('')}<c:catAx><c:axId val="3"/><c:delete val="1"/></c:catAx></c:plotArea></c:chart><c:spPr>${solid('FBE4E2')}<a:ln><a:noFill/></a:ln></c:spPr></c:chartSpace>`);
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
