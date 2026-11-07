"""Original chart color controls, using the project's original stacked-chart shell."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
from canvas_drawings_fixture import NS, A, add

root = Path(__file__).resolve().parents[1]
for name in ['chart-theme-colors', 'chart-theme-remapped', 'chart-direct-colors']:
    with ZipFile(root/'public/fixtures/percent-positive.docx') as z:
        parts = {n:z.read(n) for n in z.namelist()}
    chart = E.fromstring(parts['word/charts/chart1.xml'])
    series = chart.findall('.//c:ser', NS)
    for i, s in enumerate(series):
        fill = s.find('c:spPr/a:solidFill', NS); fill.clear()
        if name == 'chart-direct-colors':
            if i == 0: add(fill, 'a:prstClr', val='coral')
            elif i == 1: add(fill, 'a:sysClr', val='windowText', lastClr='FF0000')
            else: add(fill, 'a:scrgbClr', r='20000', g='50000', b='80000')
        else:
            c = add(fill, 'a:schemeClr', val='accent1')
            if i == 0: add(c, 'a:shade', val=65000)
            if i == 2: add(c, 'a:tint', val=65000)
    for props in chart.findall('.//c:spPr', NS): add(props, 'a:effectLst')
    for path, token, transforms in [
        ('.//c:catAx/c:spPr/a:ln/a:solidFill','tx1',[('lumMod',15000),('lumOff',85000)]),
        ('.//c:valAx/c:majorGridlines/c:spPr/a:ln/a:solidFill','bg1',[('lumMod',50000)]),
    ]:
        fill=chart.find(path, NS);fill.clear();color=add(fill,'a:schemeClr',val=token)
        for tag,value in transforms: add(color,'a:'+tag,val=value)
    theme=E.fromstring(parts['word/theme/theme1.xml'])
    for token,value in [('accent1','2864B4'),('accent2','B45A28')]:
        entry=theme.find('.//a:clrScheme/a:'+token,NS);entry.clear();add(entry,'a:srgbClr',val=value)
    if name == 'chart-theme-remapped':
        settings=E.fromstring(parts['word/settings.xml'])
        mapping=settings.find('w:clrSchemeMapping', NS)
        if mapping is None: mapping=add(settings,'w:clrSchemeMapping')
        mapping.set('{'+NS['w']+'}accent1','accent2')
        parts['word/settings.xml']=E.tostring(settings,xml_declaration=True,encoding='UTF-8',standalone=True)
    for path,xml in [('word/charts/chart1.xml',chart),('word/theme/theme1.xml',theme)]:
        parts[path]=E.tostring(xml,xml_declaration=True,encoding='UTF-8',standalone=True)
    with ZipFile(root/f'public/fixtures/{name}.docx','w',ZIP_DEFLATED) as z:
        for path,data in parts.items(): z.writestr(path,data)
