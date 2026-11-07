"""Original AutoFit controls: a wide chart, picture, and indivisible glyph."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
from canvas_drawings_fixture import NS, A, add
root=Path(__file__).resolve().parents[1];W=NS['w'];R=NS['r'];P='http://schemas.openxmlformats.org/package/2006/relationships'
for kind,modern in [(k,m) for m in [False,True] for k in ['chart','picture','glyph']]:
    with ZipFile(root/'public/fixtures/chart-metadata-basic.docx') as z:parts={n:z.read(n) for n in z.namelist()}
    if modern:
        settings=E.fromstring(parts['word/settings.xml']);compat=settings.find('w:compat',NS)
        if compat is None:compat=add(settings,'w:compat')
        mode=next((n for n in compat if n.get('{'+W+'}name')=='compatibilityMode'),None)
        if mode is None:mode=add(compat,'w:compatSetting')
        for k,v in dict(name='compatibilityMode',uri='http://schemas.microsoft.com/office/word',val='15').items():mode.set('{'+W+'}'+k,v)
        parts['word/settings.xml']=E.tostring(settings,xml_declaration=True,encoding='UTF-8',standalone=True)
    doc=E.fromstring(parts['word/document.xml']);body=doc.find('w:body',NS)
    source=body.findall('w:p',NS)[1];body.remove(source)
    body.find('w:p/w:r/w:t',NS).text='AutoFit '+kind
    inline=source.find('.//wp:inline',NS);inline.find('wp:extent',NS).set('cx','6400800');inline.find('wp:extent',NS).set('cy','1828800')
    if kind=='picture':
        with ZipFile(root/'public/fixtures/charts-and-anchors.docx') as z:
            old=E.fromstring(z.read('word/document.xml'));graphic=old.find('.//wp:anchor/a:graphic',NS)
            pic=graphic.find('.//{http://schemas.openxmlformats.org/drawingml/2006/main}blip');pic.set('{'+R+'}embed','widePicture')
            parts['word/media/wide-control.png']=z.read('word/media/image1.png')
        inline.remove(inline.find('a:graphic',NS));inline.append(graphic)
        rel=E.fromstring(parts['word/_rels/document.xml.rels']);E.SubElement(rel,'{'+P+'}Relationship',Id='widePicture',Type=R+'/image',Target='media/wide-control.png');parts['word/_rels/document.xml.rels']=E.tostring(rel)
    if kind=='glyph':
        for node in list(source):source.remove(node)
        run=add(source,'w:r');rp=add(run,'w:rPr');face=add(rp,'w:rFonts');face.set('{'+W+'}ascii','Arial');face.set('{'+W+'}hAnsi','Arial');size=add(rp,'w:sz');size.set('{'+W+'}val','400');add(run,'w:t',text='W')
    table=E.Element('{'+W+'}tbl');pr=add(table,'w:tblPr')
    for tag,value in [('tblW','5760'),('tblInd','0')]:n=add(pr,'w:'+tag);n.set('{'+W+'}w',value);n.set('{'+W+'}type','dxa')
    align=add(pr,'w:jc');align.set('{'+W+'}val','center')
    pr.remove(align);pr.insert(1,align)
    borders=add(pr,'w:tblBorders')
    for side in ['top','left','bottom','right','insideH','insideV']:
        n=add(borders,'w:'+side)
        for k,v in dict(val='single',sz='8',color='00AA00').items():n.set('{'+W+'}'+k,v)
    margins=add(pr,'w:tblCellMar')
    for side in ['top','left','bottom','right']:
        n=add(margins,'w:'+side);n.set('{'+W+'}w','115' if side in ['left','right'] else '0');n.set('{'+W+'}type','dxa')
    col=add(add(table,'w:tblGrid'),'w:gridCol');col.set('{'+W+'}w','5760')
    cell=add(add(table,'w:tr'),'w:tc');width=add(add(cell,'w:tcPr'),'w:tcW');width.set('{'+W+'}w','5760');width.set('{'+W+'}type','dxa');cell.append(source)
    body.insert(1,table)
    section=body.find('w:sectPr',NS);margin=section.find('w:pgMar',NS)
    for side in ['left','right']:margin.set('{'+W+'}'+side,'3240')
    if kind=='glyph':
        for side in ['left','right']:margin.set('{'+W+'}'+side,'4680')
        for node in [pr.find('w:tblW',NS),width,col]:node.set('{'+W+'}w','2880')
    parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
    with ZipFile(root/f'public/fixtures/table-unbreakable-{"modern-" if modern else ""}{kind}.docx','w',ZIP_DEFLATED) as z:
        for path,data in parts.items():z.writestr(path,data)
