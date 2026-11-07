"""Original cached charts for ordinary and percentage stacking, including signs/zeros."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
from canvas_drawings_fixture import chart_xml, NS, add, C, A

root = Path(__file__).resolve().parents[1]
with ZipFile(root / 'public/fixtures/charts-and-anchors.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
cases = [
    ('stacked-positive', 'stacked', [[2,4,0,3],[3,6,0,2],[5,10,0,5]]),
    ('percent-positive', 'percentStacked', [[2,4,0,3],[3,6,0,2],[5,10,0,5]]),
    ('percent-mixed', 'percentStacked', [[2,-2,0,3],[-3,4,0,-2],[5,-4,0,-5]]),
    ('percent-mixed-color', 'percentStacked', [[2,-2,0,3],[-3,4,0,-2],[5,-4,0,-5]]),
    ('percent-negative', 'percentStacked', [[-2,-4,0,-3],[-3,-6,0,-2],[-5,-10,0,-5]]),
    ('percent-negative-nofill', 'percentStacked', [[-2,-4,0,-3],[-3,-6,0,-2],[-5,-10,0,-5]]),
    ('percent-negative-outline', 'percentStacked', [[-2,-4,0,-3],[-3,-6,0,-2],[-5,-10,0,-5]]),
    ('percent-zero', 'percentStacked', [[0,0,0,0],[0,0,0,0],[0,0,0,0]]),
    *[(f'percent-overlap-{name}','percentStacked',[[2,4,0,3],[3,6,0,2],[5,10,0,5]]) for name in ['default','zero','half','gap']],
]
original = E.fromstring(parts['word/document.xml'])
inline = original.find('.//wp:inline', NS)
inline.find('wp:extent', NS).set('cx', '5486400')
inline.find('wp:extent', NS).set('cy', '3657600')
W = NS['w']
for name, grouping, values in cases:
    chart = E.fromstring(chart_xml())
    bars = chart.find('.//c:barChart', NS)
    bars.find('c:grouping', NS).set('val', grouping)
    overlap_value={'percent-overlap-default':None,'percent-overlap-zero':'0','percent-overlap-half':'50','percent-overlap-gap':'-50'}.get(name,'100')
    if overlap_value is not None:
        overlap = E.Element('{'+C+'}overlap', val=overlap_value)
        bars.insert(list(bars).index(bars.find('c:axId', NS)), overlap)
    bars.find('c:gapWidth', NS).set('val', '150')
    for series, data in zip(bars.findall('c:ser', NS), values):
        if name == 'percent-negative-nofill':
            shape=series.find('c:spPr',NS); fill=shape.find('a:solidFill',NS)
            index=list(shape).index(fill);shape.remove(fill);shape.insert(index,E.Element('{'+A+'}noFill'))
        if name == 'percent-negative-outline':
            line=series.find('c:spPr/a:ln',NS);line.clear()
            add(add(line,'a:solidFill'),'a:srgbClr',val='008800')
        if name == 'percent-mixed-color':
            series.insert(list(series).index(series.find('c:cat', NS)), E.Element('{'+C+'}invertIfNegative',val='0'))
        for pt in series.findall('.//c:val/c:numRef/c:numCache/c:pt', NS):
            pt.find('c:v', NS).text = str(data[int(pt.get('idx'))])
    legend = chart.find('c:chart/c:legend', NS)
    legend.getparent().remove(legend)
    if grouping == 'percentStacked':
        axis = chart.find('.//c:valAx', NS)
        fmt = E.Element('{'+C+'}numFmt', formatCode='0%', sourceLinked='0')
        axis.insert(list(axis).index(axis.find('c:majorTickMark', NS)), fmt)
    doc = E.Element('{'+W+'}document', nsmap={'w':W,'wp':NS['wp'],'a':A,'c':C,'r':NS['r']})
    body = add(doc, 'w:body')
    p = add(body, 'w:p'); props = add(p, 'w:pPr')
    spacing = add(props, 'w:spacing'); spacing.set('{'+W+'}after','0')
    title='percent-negative' if name.startswith('percent-negative-') else 'percent-positive' if name.startswith('percent-overlap-') else name
    add(add(p, 'w:r'), 'w:t', text=title)
    drawing = add(add(add(body, 'w:p'), 'w:r'), 'w:drawing')
    drawing.append(E.fromstring(E.tostring(inline)))
    add(add(add(body, 'w:p'), 'w:r'), 'w:t', text='After chart')
    section = add(body,'w:sectPr')
    size = add(section,'w:pgSz'); size.set('{'+W+'}w','12240'); size.set('{'+W+'}h','15840')
    margin = add(section,'w:pgMar')
    for k,v in dict(top=720,right=720,bottom=720,left=720,header=0,footer=0,gutter=0).items():margin.set('{'+W+'}'+k,str(v))
    parts['word/document.xml'] = E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
    parts['word/charts/chart1.xml'] = E.tostring(chart,xml_declaration=True,encoding='UTF-8',standalone=True)
    with ZipFile(root/f'public/fixtures/{name}.docx','w',ZIP_DEFLATED) as z:
        for n,d in parts.items():z.writestr(n,d)
