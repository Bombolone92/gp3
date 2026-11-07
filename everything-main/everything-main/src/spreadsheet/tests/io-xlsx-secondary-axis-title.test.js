import {expect,it} from 'vitest';
import {JSDOM} from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import {Workbook} from '../src/core/workbook.js';
import {chartData,chartTitles,normalizeChart} from '../src/core/charts.js';
import {workbookFromFile,workbookToXlsx} from '../src/core/io.js';
import {renderChartSvg} from '../src/ui/chartsvg.js';
import {stackedChartXlsx} from './helpers/xlsx-stacked-chart-fixture.js';
const decode = part => new TextDecoder().decode(part.content);
const set = (part,xml) => {part.content=new TextEncoder().encode(xml);part.size=part.content.length;};
const parser = new (new JSDOM('').window.DOMParser)();
function fixture() {
  const zip=X.CFB.read(new Uint8Array(stackedChartXlsx({line:'visible'})),{type:'array'});
  const part=X.CFB.find(zip,'/xl/charts/cost.xml');
  const title = text => `<c:title><c:tx><c:rich><a:p><a:r><a:t>${text}</a:t></a:r></a:p></c:rich></c:tx></c:title>`;
  set(part,decode(part).replace('<c:axId val="2"/><c:numFmt',`<c:axId val="2"/>${title('Primary dollars')}<c:numFmt`)
    .replace('<c:axId val="3"/><c:scaling>', '<c:axId val="3"/><c:title><c:tx><c:strRef><c:f>Summary!$G$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Old secondary</c:v></c:pt></c:strCache></c:strRef></c:tx></c:title><c:scaling>'));
  return X.CFB.write(zip,{type:'array',fileType:'zip'});
}
it('retains an independent live secondary title through edits, duplication and native XLSX round trips', async () => {
  let wb=await workbookFromFile(fixture(),'titles.xlsx');
  wb.setInput(wb.sheets[0].id,0,6,'Rate & growth');
  for(let pass=0;pass<2;pass++) {
    const sheet=wb.sheets[0], chart=sheet.charts[0];
    expect(chart).toMatchObject({yTitle:'Primary dollars',y2TitleRef:'Summary!$G$1'});
    expect(chartTitles(wb,sheet.id,chart).y2Title).toBe('Rate & growth');
    const copy=wb.chartById(sheet.id,wb.duplicateChart(sheet.id,chart.id));
    expect(chartTitles(wb,sheet.id,copy).y2Title).toBe('Rate & growth');
    const svg=renderChartSvg(chartData(wb,sheet.id,copy),copy,700,500);
    expect(svg).toContain('>Primary dollars</text>');expect(svg).toContain('>Rate &amp; growth</text>');
    wb.deleteChart(sheet.id,copy.id);
    const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
    const part=zip.FileIndex[zip.FullPaths.findIndex(p=>/\/charts\/chart[^/]*\.xml$/.test(p))];
    const axes=[...decode(part).matchAll(/<c:valAx>([\s\S]*?)<\/c:valAx>/g)].map(m=>m[1]);
    expect(axes[0]).toContain('Primary dollars');expect(axes[0]).not.toContain('Summary!$G$1');
    expect(axes[1]).toContain('<c:f>Summary!$G$1</c:f>');expect(axes[1]).toContain('Rate &amp; growth');
    expect(axes[1]).not.toContain('Primary dollars');
    for (const axis of axes) expect(axis.match(/<c:title>[\s\S]*?<\/c:title>/)[0]).toContain('rot="-5400000"');
    const book=X.CFB.find(zip,'/xl/workbook.xml');set(book,decode(book).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));
    wb=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'native.xlsx');
  }
  const sheet=wb.sheets[0];wb.renameSheet(sheet.id,"Owner's summary");wb.insertRows(sheet.id,0,2);
  expect(sheet.charts[0].y2TitleRef).toBe("'Owner''s summary'!$G$3");
  const restored=new Workbook(wb.toJSON());
  expect(chartTitles(restored,sheet.id,restored.sheet(sheet.id).charts[0]).y2Title).toBe('Rate & growth');
  wb.setInput(sheet.id,2,6,'');expect(chartTitles(wb,sheet.id,sheet.charts[0]).y2Title).toBe('');
  wb.undo();expect(chartTitles(wb,sheet.id,sheet.charts[0]).y2Title).toBe('Rate & growth');
});
it.each([false,true])('places independent titles outside their own labels with reversed categories=%s', reverseCategories => {
  const chart=normalizeChart({type:'combo',secondaryAxis:true,yTitle:'Primary',y2Title:'Secondary',legend:false,
    range:{r1:0,c1:0,r2:1,c2:2},anchor:{r:0,c:0},appearance:{reverseCategories}});
  const data={categories:['A','B'],series:[{name:'One',values:[20,80]},{name:'Two',values:[2,8]}]};
  const doc=parser.parseFromString(renderChartSvg(data,chart,600,400),'image/svg+xml');
  const titles=['Primary','Secondary'].map(t=>[...doc.querySelectorAll('text')].find(n=>n.textContent===t));
  const xs=titles.map(n=>Number(n.getAttribute('transform').match(/translate\(([^ ]+)/)[1]));
  expect(xs.every(x=>x>0&&x<600)).toBe(true);
  expect(xs[0]<xs[1]).toBe(!reverseCategories);
  chart.appearance.hideY2Axis=true;
  expect(renderChartSvg(data,chart,600,400)).toContain('>Secondary</text>');
});
it('does not invent a secondary title from the primary title', async () => {
  const wb=await workbookFromFile(fixture(),'titles.xlsx'), sheet=wb.sheets[0];
  wb.updateChart(sheet.id,sheet.charts[0].id,{y2Title:'',y2TitleRef:undefined});
  const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
  const part=zip.FileIndex[zip.FullPaths.findIndex(p=>/\/charts\/chart[^/]*\.xml$/.test(p))];
  const secondary=[...decode(part).matchAll(/<c:valAx>([\s\S]*?)<\/c:valAx>/g)][1][1];
  expect(secondary).not.toContain('<c:title>');
});
